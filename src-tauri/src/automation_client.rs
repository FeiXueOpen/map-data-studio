//! Headless modes of the shipped desktop executable; no external runtime required.
use serde::Deserialize;
use serde_json::{json, Value};
use std::{io::{self, BufRead, Write}, path::PathBuf, time::Duration};

#[derive(Deserialize)]
struct Connection { endpoint: String, token: String }
fn default_connection_file() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Application Support"));
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let base = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")));
    Ok(base.ok_or("无法定位用户配置目录，请指定 --connection-file")?.join("com.mapdatastudio.desktop/automation-connection.json"))
}
fn arguments(mut args: Vec<String>) -> Result<(PathBuf, Vec<String>), String> {
    let mut file = None;
    while let Some(index) = args.iter().position(|arg| arg == "--connection-file") {
        if file.is_some() { return Err("--connection-file 不能重复".into()); }
        if index + 1 >= args.len() || args[index + 1].starts_with("--") { return Err("--connection-file 需要路径".into()); }
        file = Some(PathBuf::from(args.remove(index + 1))); args.remove(index);
    }
    Ok((match file { Some(path) => path, None => default_connection_file()? }, args))
}
fn connection(path: &std::path::Path) -> Result<Connection, String> {
    let bytes = std::fs::read(path).map_err(|_| "请打开 Map Data Studio 并在设置中开启 AI 控制；或指定正确的 --connection-file")?;
    let connection: Connection = serde_json::from_slice(&bytes).map_err(|_| "本地连接配置无效")?;
    let url = reqwest::Url::parse(&connection.endpoint).map_err(|_| "本地连接配置无效")?;
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") || url.port().is_none() || url.path() != "/mcp" || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() || connection.token.is_empty() || connection.token.contains(['\r', '\n']) {
        return Err("本地连接配置无效".into());
    }
    Ok(connection)
}
async fn rpc(client: &reqwest::Client, file: &std::path::Path, request: &Value) -> Result<Option<Value>, String> {
    // Re-read for every message so a service restart can rotate its port and token.
    let connection = connection(file)?;
    let response = client.post(connection.endpoint).bearer_auth(connection.token)
      .header("Accept", "application/json, text/event-stream").json(request).send().await
      .map_err(|_| "无法连接本地工作台，检查软件是否打开且 AI 控制已开启")?;
    if !response.status().is_success() { return Err(format!("本地控制请求失败（HTTP {}），请检查设置中的连接配置", response.status().as_u16())); }
    if response.status().as_u16() == 202 { return Ok(None); }
    response.json().await.map(Some).map_err(|_| "控制服务返回格式无效".into())
}
fn error(id: Value, code: i32, message: &str) -> Value { json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}}) }
fn write_message(out: &mut impl Write, message: &Value) -> Result<(), String> {
    writeln!(out, "{message}").and_then(|_| out.flush()).map_err(|_| "无法写入 MCP 输出".into())
}
async fn stdio(client: &reqwest::Client, file: &std::path::Path) -> Result<(), String> {
    let stdin = io::stdin(); let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line.map_err(|_| "无法读取 MCP 输入")?;
        if line.trim().is_empty() { continue; }
        let request: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => { write_message(&mut stdout, &error(Value::Null, -32700, "Invalid JSON"))?; continue; }
        };
        match rpc(client, file, &request).await {
            Ok(Some(response)) => write_message(&mut stdout, &response)?,
            Ok(None) => {},
            Err(message) => {
                if let Some(id) = request.get("id") { write_message(&mut stdout, &error(id.clone(), -32603, &message))?; }
                else { eprintln!("{message}"); }
            }
        }
    } Ok(())
}
fn cli_request(args: &[String]) -> Result<Option<Value>, String> {
    let Some(command) = args.first().map(String::as_str) else { return Ok(None) };
    let (method, params) = match command {
        "help" if args.len() == 1 => return Ok(None),
        "tools" if args.len() == 1 => ("tools/list", json!({})),
        "status" if args.len() == 1 => ("tools/call", json!({"name":"get_status","arguments":{}})),
        "call" if args.len() == 2 || (args.len() == 4 && args[2] == "--args") => {
            let input: Value = if args.len() == 4 { serde_json::from_str(&args[3]).map_err(|_| "--args 必须为有效 JSON 对象")? } else { json!({}) };
            if !input.is_object() { return Err("--args 必须为 JSON 对象".into()); }
            ("tools/call", json!({"name":args[1],"arguments":input}))
        }
        _ => return Err("命令格式：--cli status | tools | call <tool> [--args JSON] | help".into()),
    }; Ok(Some(json!({"jsonrpc":"2.0","id":1,"method":method,"params":params})))
}
async fn cli(client: &reqwest::Client, file: &std::path::Path, args: &[String]) -> Result<(), String> {
    let Some(request) = cli_request(args)? else {
        println!("Map Data Studio CLI（内置，无需 Node.js）\n  --cli status\n  --cli tools\n  --cli call <tool> [--args JSON]\n可选：--connection-file <设置中显示的连接文件路径>"); return Ok(());
    };
    let response = rpc(client, file, &request).await?.ok_or("控制服务未返回结果")?;
    if let Some(e) = response.get("error") { return Err(e["message"].as_str().unwrap_or("控制请求失败").into()); }
    let result = &response["result"];
    if result["isError"] == true { return Err(result["content"].as_array().map(|items| items.iter().filter_map(|item| item["text"].as_str()).collect::<Vec<_>>().join("\n")).unwrap_or_else(|| "工具执行失败".into())); }
    println!("{}", serde_json::to_string_pretty(result.get("structuredContent").unwrap_or(result)).map_err(|_| "无法读取控制结果")?); Ok(())
}
/// Called before Tauri initialisation: MCP/CLI never creates a window or touches map keys.
pub fn run_if_requested() -> Option<i32> {
    let mut args: Vec<_> = std::env::args().skip(1).collect();
    let mode = args.first()?.clone();
    if mode != "--mcp-stdio" && mode != "--cli" { return None; }
    args.remove(0);
    let result = (|| -> Result<(), String> {
        let (file, args) = arguments(args)?;
        if mode == "--mcp-stdio" && !args.is_empty() { return Err("stdio 模式只接受 --connection-file".into()); }
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|_| "无法启动内置控制客户端")?;
        let client = reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(25)).build().map_err(|_| "无法初始化本地连接")?;
        runtime.block_on(async { if mode == "--mcp-stdio" { stdio(&client, &file).await } else { cli(&client, &file, &args).await } })
    })();
    match result { Ok(()) => Some(0), Err(message) => { eprintln!("{message}"); Some(1) } }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn cli_arguments_are_checked_before_any_request() {
        assert!(cli_request(&["call".into(),"get_status".into(),"--args".into(),"[]".into()]).is_err());
        assert!(cli_request(&["status".into(),"extra".into()]).is_err());
        assert_eq!(cli_request(&["status".into()]).unwrap().unwrap()["params"]["name"], "get_status");
        assert!(arguments(vec!["--connection-file".into()]).is_err());
        let (file, args) = arguments(vec!["status".into(),"--connection-file".into(),"space path.json".into()]).unwrap();
        assert_eq!(file, PathBuf::from("space path.json")); assert_eq!(args, vec!["status"]);
    }
    #[test] fn rejects_remote_urls_without_revealing_tokens() {
        let path = std::env::temp_dir().join(format!("map-data-client-{}.json",uuid::Uuid::new_v4()));
        for endpoint in ["https://example.com/mcp","http://127.0.0.1:1234/other","http://user:password@127.0.0.1:1234/mcp","http://127.0.0.1:1234/mcp?token=x"] {
            std::fs::write(&path,json!({"endpoint":endpoint,"token":"private-control-token"}).to_string()).unwrap();
            let message = connection(&path).err().unwrap(); assert!(!message.contains("private-control-token"));
        }
        std::fs::remove_file(path).unwrap();
    }
}
