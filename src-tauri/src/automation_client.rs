//! Headless modes of the shipped desktop executable; no external runtime required.
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs,
    io::{self, BufRead, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Deserialize)]
struct Connection {
    endpoint: String,
    token: String,
}
const MAX_CLI_ARGUMENT_BYTES: u64 = 16 * 1024 * 1024;
fn default_connection_file() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Library/Application Support"));
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")));
    Ok(base
        .ok_or("无法定位用户配置目录，请指定 --connection-file")?
        .join("com.mapdatastudio.desktop/automation-connection.json"))
}
fn arguments(mut args: Vec<String>) -> Result<(PathBuf, Vec<String>), String> {
    let mut file = None;
    while let Some(index) = args.iter().position(|arg| arg == "--connection-file") {
        if file.is_some() {
            return Err("--connection-file 不能重复".into());
        }
        if index + 1 >= args.len() || args[index + 1].starts_with("--") {
            return Err("--connection-file 需要路径".into());
        }
        file = Some(PathBuf::from(args.remove(index + 1)));
        args.remove(index);
    }
    Ok((
        match file {
            Some(path) => path,
            None => default_connection_file()?,
        },
        args,
    ))
}
fn connection(path: &std::path::Path) -> Result<Connection, String> {
    let bytes = std::fs::read(path).map_err(|_| {
        "请打开 Map Data Studio 并在设置中开启 AI 控制；或指定正确的 --connection-file"
    })?;
    let connection: Connection = serde_json::from_slice(&bytes).map_err(|_| "本地连接配置无效")?;
    let url = reqwest::Url::parse(&connection.endpoint).map_err(|_| "本地连接配置无效")?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || url.path() != "/mcp"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || connection.token.is_empty()
        || connection.token.contains(['\r', '\n'])
    {
        return Err("本地连接配置无效".into());
    }
    Ok(connection)
}
fn user_home() -> Result<PathBuf, String> {
    std::env::var_os("MAP_DATA_AI_HOME")
        .or_else(|| std::env::var_os("HOME"))
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "无法定位用户目录".to_string())
}
fn resource_path(relative: &str) -> Option<PathBuf> {
    if let Some(root) = std::env::var_os("MAP_DATA_RESOURCE_ROOT") {
        let path = PathBuf::from(root).join(relative);
        if path.exists() {
            return Some(path);
        }
    }
    let executable = std::env::current_exe().ok()?;
    let directory = executable.parent()?;
    let mut candidates = vec![directory.join(relative)];
    if directory.file_name().and_then(|v| v.to_str()) == Some("MacOS") {
        if let Some(contents) = directory.parent() {
            candidates.push(contents.join("Resources").join(relative));
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()?
            .join(relative),
    );
    candidates.into_iter().find(|path| path.exists())
}
fn copy_directory(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|_| format!("无法创建 {}", target.display()))?;
    for item in fs::read_dir(source).map_err(|_| "无法读取内置 Skill")? {
        let item = item.map_err(|_| "无法读取内置 Skill")?;
        let destination = target.join(item.file_name());
        let kind = item.file_type().map_err(|_| "无法读取内置 Skill")?;
        if kind.is_dir() {
            copy_directory(&item.path(), &destination)?;
        } else if kind.is_file() {
            fs::copy(item.path(), destination).map_err(|_| "无法复制 Skill")?;
        }
    }
    Ok(())
}
fn install_skill(client: &str) -> Result<Value, String> {
    if !["auto", "all", "doubao", "codex", "claude"].contains(&client) {
        return Err("--client 仅支持 auto、all、doubao、codex、claude".into());
    }
    let source =
        resource_path("automation/map-data-studio").ok_or("安装包中缺少 map-data-studio Skill")?;
    let home = user_home()?;
    let shared = home.join(".agents/skills/map-data-studio");
    let mut targets = vec![shared];
    let codex_root = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".codex"));
    if client == "codex" || client == "all" || (client == "auto" && codex_root.exists()) {
        targets.push(codex_root.join("skills/map-data-studio"));
    }
    let claude_root = home.join(".claude");
    if client == "claude" || client == "all" || (client == "auto" && claude_root.exists()) {
        targets.push(claude_root.join("skills/map-data-studio"));
    }
    targets.sort();
    targets.dedup();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut installed = Vec::new();
    for target in targets {
        let staging = target.with_file_name(format!("map-data-studio.installing-{stamp}"));
        if staging.exists() {
            fs::remove_dir_all(&staging).map_err(|_| "无法清理 Skill 临时目录")?;
        }
        copy_directory(&source, &staging)?;
        let mut backup = None;
        if target.exists() {
            let saved = target.with_file_name(format!("map-data-studio.backup-{stamp}"));
            fs::rename(&target, &saved).map_err(|_| format!("无法备份 {}", target.display()))?;
            backup = Some(saved);
        }
        if let Err(error) = fs::rename(&staging, &target) {
            if let Some(saved) = backup {
                let _ = fs::rename(saved, &target);
            }
            return Err(format!("无法安装 {}：{error}", target.display()));
        }
        installed.push(target.display().to_string());
    }
    Ok(
        json!({"ok":true,"client":client,"source":source,"installed":installed,"restartRequired":true}),
    )
}
fn open_application() -> Result<Value, String> {
    let executable = std::env::current_exe().map_err(|_| "无法定位桌面程序")?;
    let child = Command::new(&executable)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "无法启动 Map Data Studio")?;
    Ok(json!({"ok":true,"executable":executable,"pid":child.id()}))
}
fn wait_for_connection(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    open_application()?;
    for _ in 0..60 {
        if path.exists() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err("已尝试启动 Map Data Studio，但本地控制服务尚未就绪".into())
}
fn describe() -> Result<Value, String> {
    let path = resource_path("automation/tools.json").ok_or("安装包中缺少工具描述")?;
    let tools: Value = serde_json::from_slice(&fs::read(&path).map_err(|_| "无法读取工具描述")?)
        .map_err(|_| "工具描述格式无效")?;
    Ok(
        json!({"name":"map-data-studio","version":env!("CARGO_PKG_VERSION"),"defaultTransport":"cli","transports":["cli","mcp-stdio","streamable-http"],"requiresSystemNodeOrPython":false,"tools":tools}),
    )
}
async fn rpc(
    client: &reqwest::Client,
    file: &std::path::Path,
    request: &Value,
) -> Result<Option<Value>, String> {
    // Re-read for every message so a service restart can rotate its port and token.
    let connection = connection(file)?;
    let response = client
        .post(connection.endpoint)
        .bearer_auth(connection.token)
        .header("Accept", "application/json, text/event-stream")
        .json(request)
        .send()
        .await
        .map_err(|_| "无法连接本地工作台，检查软件是否打开且 AI 控制已开启")?;
    if !response.status().is_success() {
        return Err(format!(
            "本地控制请求失败（HTTP {}），请检查设置中的连接配置",
            response.status().as_u16()
        ));
    }
    if response.status().as_u16() == 202 {
        return Ok(None);
    }
    response
        .json()
        .await
        .map(Some)
        .map_err(|_| "控制服务返回格式无效".into())
}
fn error(id: Value, code: i32, message: &str) -> Value {
    json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})
}
fn write_message(out: &mut impl Write, message: &Value) -> Result<(), String> {
    writeln!(out, "{message}")
        .and_then(|_| out.flush())
        .map_err(|_| "无法写入 MCP 输出".into())
}
fn read_json_object(mut reader: impl Read, source: &str) -> Result<Value, String> {
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take(MAX_CLI_ARGUMENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| format!("无法读取 {source}"))?;
    if bytes.len() as u64 > MAX_CLI_ARGUMENT_BYTES {
        return Err(format!("{source} 超过 16 MiB 限制"));
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| format!("{source} 必须为有效 JSON 对象"))?;
    if !value.is_object() {
        return Err(format!("{source} 必须为 JSON 对象"));
    }
    Ok(value)
}
fn call_arguments(args: &[String]) -> Result<Value, String> {
    match args {
        [_, _] => Ok(json!({})),
        [_, _, option, value] if option == "--args" => read_json_object(value.as_bytes(), "--args"),
        [_, _, option, path] if option == "--args-file" => {
            let file = fs::File::open(path).map_err(|_| "无法读取 --args-file 指定的文件")?;
            read_json_object(file, "--args-file")
        }
        [_, _, option] if option == "--stdin" => read_json_object(io::stdin(), "--stdin"),
        _ => Err("命令格式：call <tool> [--args JSON | --args-file 文件 | --stdin]".into()),
    }
}
async fn stdio(client: &reqwest::Client, file: &std::path::Path) -> Result<(), String> {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line.map_err(|_| "无法读取 MCP 输入")?;
        if line.trim().is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => {
                write_message(&mut stdout, &error(Value::Null, -32700, "Invalid JSON"))?;
                continue;
            }
        };
        match rpc(client, file, &request).await {
            Ok(Some(response)) => write_message(&mut stdout, &response)?,
            Ok(None) => {}
            Err(message) => {
                if let Some(id) = request.get("id") {
                    write_message(&mut stdout, &error(id.clone(), -32603, &message))?;
                } else {
                    eprintln!("{message}");
                }
            }
        }
    }
    Ok(())
}
fn cli_request(args: &[String]) -> Result<Option<Value>, String> {
    let Some(command) = args.first().map(String::as_str) else {
        return Ok(None);
    };
    let (method, params) = match command {
        "help" if args.len() == 1 => return Ok(None),
        "tools" if args.len() == 1 => ("tools/list", json!({})),
        "status" if args.len() == 1 => ("tools/call", json!({"name":"get_status","arguments":{}})),
        "call" => {
            let input = call_arguments(args)?;
            ("tools/call", json!({"name":args[1],"arguments":input}))
        }
        _ => return Err("命令格式：status | tools | call <tool> [--args JSON | --args-file 文件 | --stdin] | describe | doctor | open | skill install [--client auto] | help".into()),
    };
    Ok(Some(
        json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}),
    ))
}
async fn cli(
    client: &reqwest::Client,
    file: &std::path::Path,
    args: &[String],
) -> Result<(), String> {
    let mut args = args.to_vec();
    args.retain(|arg| arg != "--json");
    if args.as_slice() == ["describe"] {
        println!(
            "{}",
            serde_json::to_string_pretty(&describe()?).map_err(|_| "无法生成能力描述")?
        );
        return Ok(());
    }
    if args.as_slice() == ["open"] {
        println!(
            "{}",
            serde_json::to_string_pretty(&open_application()?).map_err(|_| "无法生成启动结果")?
        );
        return Ok(());
    }
    if args.first().map(String::as_str) == Some("skill") {
        let selected = match args.as_slice() {
            [skill, install] if skill == "skill" && install == "install" => "auto",
            [skill, install, option, value]
                if skill == "skill" && install == "install" && option == "--client" =>
            {
                value.as_str()
            }
            _ => {
                return Err(
                    "命令格式：skill install [--client auto|all|doubao|codex|claude]".into(),
                )
            }
        };
        println!(
            "{}",
            serde_json::to_string_pretty(&install_skill(selected)?)
                .map_err(|_| "无法生成安装结果")?
        );
        return Ok(());
    }
    if args.as_slice() == ["doctor"] {
        let source = resource_path("automation/map-data-studio");
        let configured = connection(file).is_ok();
        let reachable = if configured {
            rpc(client, file, &json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_status","arguments":{}}})).await.is_ok()
        } else {
            false
        };
        println!("{}", serde_json::to_string_pretty(&json!({"ok":configured&&reachable&&source.is_some(),"version":env!("CARGO_PKG_VERSION"),"executable":std::env::current_exe().ok(),"connectionFile":file,"connectionConfigured":configured,"serviceReachable":reachable,"skillBundled":source.is_some(),"skillSource":source})).map_err(|_| "无法生成诊断结果")?);
        return Ok(());
    }
    let Some(request) = cli_request(&args)? else {
        println!("Map Data Studio CLI（内置，无需 Node.js）\n  status --json\n  tools --json\n  call <tool> [--args JSON | --args-file 文件 | --stdin]\n  describe --json\n  doctor --json\n  open --json\n  skill install [--client auto|all|doubao|codex|claude] --json\n兼容旧写法：--cli <命令>\n可选：--connection-file <automation-connection.json路径>\n大参数优先使用 --args-file 或 --stdin；单次输入上限 16 MiB。");
        return Ok(());
    };
    wait_for_connection(file)?;
    let response = rpc(client, file, &request)
        .await?
        .ok_or("控制服务未返回结果")?;
    if let Some(e) = response.get("error") {
        return Err(e["message"].as_str().unwrap_or("控制请求失败").into());
    }
    let result = &response["result"];
    if result["isError"] == true {
        return Err(result["content"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_else(|| "工具执行失败".into()));
    }
    println!(
        "{}",
        serde_json::to_string_pretty(result.get("structuredContent").unwrap_or(result))
            .map_err(|_| "无法读取控制结果")?
    );
    Ok(())
}
/// Called before Tauri initialisation: MCP/CLI never creates a window or touches map keys.
pub fn run_if_requested() -> Option<i32> {
    let mut args: Vec<_> = std::env::args().skip(1).collect();
    let mode = args.first()?.clone();
    let cli_commands = [
        "status", "tools", "call", "describe", "doctor", "open", "skill", "help",
    ];
    if mode != "--mcp-stdio" && mode != "--cli" && !cli_commands.contains(&mode.as_str()) {
        return None;
    }
    let stdio_mode = mode == "--mcp-stdio";
    if stdio_mode || mode == "--cli" {
        args.remove(0);
    }
    let result = (|| -> Result<(), String> {
        let (file, args) = arguments(args)?;
        if stdio_mode && !args.is_empty() {
            return Err("stdio 模式只接受 --connection-file".into());
        }
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| "无法启动内置控制客户端")?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(25))
            .build()
            .map_err(|_| "无法初始化本地连接")?;
        runtime.block_on(async {
            if stdio_mode {
                stdio(&client, &file).await
            } else {
                cli(&client, &file, &args).await
            }
        })
    })();
    match result {
        Ok(()) => Some(0),
        Err(message) => {
            eprintln!("{message}");
            Some(1)
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cli_arguments_are_checked_before_any_request() {
        assert!(cli_request(&[
            "call".into(),
            "get_status".into(),
            "--args".into(),
            "[]".into()
        ])
        .is_err());
        assert!(cli_request(&["status".into(), "extra".into()]).is_err());
        assert_eq!(
            cli_request(&["status".into()]).unwrap().unwrap()["params"]["name"],
            "get_status"
        );
        assert!(arguments(vec!["--connection-file".into()]).is_err());
        let (file, args) = arguments(vec![
            "status".into(),
            "--connection-file".into(),
            "space path.json".into(),
        ])
        .unwrap();
        assert_eq!(file, PathBuf::from("space path.json"));
        assert_eq!(args, vec!["status"]);
    }
    #[test]
    fn rejects_remote_urls_without_revealing_tokens() {
        let path =
            std::env::temp_dir().join(format!("map-data-client-{}.json", uuid::Uuid::new_v4()));
        for endpoint in [
            "https://example.com/mcp",
            "http://127.0.0.1:1234/other",
            "http://user:password@127.0.0.1:1234/mcp",
            "http://127.0.0.1:1234/mcp?token=x",
        ] {
            std::fs::write(
                &path,
                json!({"endpoint":endpoint,"token":"private-control-token"}).to_string(),
            )
            .unwrap();
            let message = connection(&path).err().unwrap();
            assert!(!message.contains("private-control-token"));
        }
        std::fs::remove_file(path).unwrap();
    }
}
