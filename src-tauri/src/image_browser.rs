use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap,io::{BufRead,BufReader,Write},process::{Command,Stdio},sync::{atomic::{AtomicBool,AtomicU64,Ordering},Mutex},time::{Duration,Instant}};
use tauri::{AppHandle,Emitter,Manager,State};
#[derive(Clone,Serialize,Default)]
#[serde(rename_all="camelCase")]
pub struct BrowserStatus {pub state:String,pub message:String,pub poi_id:String,pub poi_name:String}
#[derive(Default)]
pub struct ImageBrowserState {pub cancelled:AtomicBool,pub generation:AtomicU64,pub status:Mutex<BrowserStatus>,batches:Mutex<HashMap<String,HashMap<String,QueryResult>>>}
#[derive(Clone,Deserialize)]
pub struct Candidate {pub url:String,pub page:String}
#[derive(Clone,Deserialize,Serialize)]
pub struct SearchQuery {id:String,name:String,query:String}
#[derive(Clone,Deserialize)]
struct QueryResult {#[serde(default)] candidates:Vec<Candidate>,error:Option<String>}
fn update(app:&AppHandle,status:BrowserStatus){if let Ok(mut saved)=app.state::<ImageBrowserState>().status.lock(){*saved=status.clone()}let _=app.emit("image-browser-status",status);}
#[tauri::command]
pub fn get_image_browser_status(state:State<'_,ImageBrowserState>)->Result<BrowserStatus,String>{state.status.lock().map(|s|s.clone()).map_err(|_|"无法读取浏览器状态".into())}
#[tauri::command]
pub fn cancel_image_download(state:State<'_,ImageBrowserState>){state.cancelled.store(true,Ordering::Relaxed);state.generation.fetch_add(1,Ordering::Relaxed);}
#[tauri::command]
pub fn clear_baidu_batch(state:State<'_,ImageBrowserState>,batch_id:String){if let Ok(mut batches)=state.batches.lock(){batches.remove(&batch_id);}}
pub fn candidates(app:&AppHandle,batch_id:&str,id:&str)->Result<Vec<Candidate>,String>{
 let state=app.state::<ImageBrowserState>();let batches=state.batches.lock().map_err(|_|"百度批次状态不可用")?;
 let row=batches.get(batch_id).and_then(|b|b.get(id)).ok_or("点位不在本次百度搜索批次内")?;
 if let Some(e)=&row.error{return Err(e.clone())}Ok(row.candidates.clone())
}
fn runtime_path(app:&AppHandle)->Result<std::path::PathBuf,String>{
 let bundled=app.path().resource_dir().map_err(|e|e.to_string())?.join("image-runtime");if bundled.join("runtime.json").is_file(){return Ok(bundled)}
 #[cfg(debug_assertions)]{let dev=std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("image-runtime");if dev.join("runtime.json").is_file(){return Ok(dev)}}
 Err("缺少内置图片浏览器，请安装完整客户端".into())
}
#[tauri::command]
pub async fn prepare_baidu_batch(app:AppHandle,queries:Vec<SearchQuery>,mut options:Value)->Result<String,String>{
 if queries.is_empty()||queries.len()>1000||queries.iter().any(|q|q.id.is_empty()||q.name.len()>500||q.query.is_empty()||q.query.len()>800){return Err("百度搜索批次无效".into())}
 let interval=options["intervalSeconds"].as_u64().unwrap_or(8);if !(3..=60).contains(&interval){return Err("景区搜索间隔需为3至60秒".into())}
 if options.get("proxy").and_then(Value::as_str).filter(|p|!p.is_empty()).is_none(){let proxy=crate::storage::load(&app)?.browser_proxy;if !proxy.is_empty(){options["proxy"]=json!(proxy)}}
 if let Some(proxy)=options["proxy"].as_str().filter(|p|!p.is_empty()){crate::storage::validate_proxy(proxy)?;}
 static GATE:tokio::sync::Mutex<()>=tokio::sync::Mutex::const_new(());let generation=app.state::<ImageBrowserState>().generation.load(Ordering::Relaxed);let _guard=GATE.lock().await;
 if generation!=app.state::<ImageBrowserState>().generation.load(Ordering::Relaxed){return Err("百度搜索已取消".into())}
 app.state::<ImageBrowserState>().cancelled.store(false,Ordering::Relaxed);
 tauri::async_runtime::spawn_blocking(move||{
  let runtime=runtime_path(&app)?;let profile=app.path().app_data_dir().map_err(|e|e.to_string())?.join("image-browser/baidu-profile");let cache=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("image-browser");
  std::fs::create_dir_all(&profile).map_err(|e|e.to_string())?;std::fs::create_dir_all(&cache).map_err(|e|e.to_string())?;
  options["queries"]=json!(queries);options["profile"]=json!(profile);options["intervalSeconds"]=json!(interval);
  let request=cache.join(format!("{}.json",uuid::Uuid::new_v4()));std::fs::write(&request,serde_json::to_vec(&options).unwrap()).map_err(|e|e.to_string())?;
  let mut process=match Command::new(runtime.join(if cfg!(windows){"node.exe"}else{"node"})).arg(runtime.join("worker/search-baidu.mjs")).arg(&request).env("PLAYWRIGHT_BROWSERS_PATH",runtime.join("browser")).env_remove("NODE_OPTIONS").env_remove("NODE_TLS_REJECT_UNAUTHORIZED").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn(){Ok(p)=>p,Err(e)=>{let _=std::fs::remove_file(&request);return Err(e.to_string())}};
  let stdout=process.stdout.take().ok_or("无法读取浏览器输出")?;let(sender,receiver)=std::sync::mpsc::channel();
  let reader=std::thread::spawn(move||{for line in BufReader::new(stdout).lines(){match line{Ok(line)if line.len()<=1024*1024=>if sender.send(line).is_err(){break},_=>break}}});
  let start=Instant::now();let mut cancelled=None;let mut rows=HashMap::new();let mut error=None;let mut completed=false;
  loop {
   if app.state::<ImageBrowserState>().cancelled.load(Ordering::Relaxed)||start.elapsed()>Duration::from_secs((queries.len() as u64*370+60).min(7200)){
    if cancelled.is_none(){cancelled=Some(Instant::now());if let Some(stdin)=process.stdin.as_mut(){let _=stdin.write_all(b"cancel\n");}error=Some("百度搜索已取消或超时".to_string());}
    if cancelled.is_some_and(|t|t.elapsed()>Duration::from_secs(5)){let _=process.kill();break}
   }
   match receiver.recv_timeout(Duration::from_millis(100)){
    Ok(line)=>if let Ok(value)=serde_json::from_str::<Value>(&line){match value["type"].as_str(){
     Some("status")if cancelled.is_none()=>update(&app,BrowserStatus{state:value["state"].as_str().unwrap_or("searching").into(),message:value["message"].as_str().unwrap_or("").into(),poi_id:value["poiId"].as_str().unwrap_or("").into(),poi_name:value["poiName"].as_str().unwrap_or("").into()}),
     Some("query_result")=>if let (Some(id),Ok(row))=(value["id"].as_str(),serde_json::from_value::<QueryResult>(value.clone())){rows.insert(id.to_string(),row);},
     Some("batch_completed")=>completed=true,Some("error")=>error=Some(value["message"].as_str().unwrap_or("百度搜索失败").into()),_=>{}
    }},Err(std::sync::mpsc::RecvTimeoutError::Disconnected)=>break,Err(std::sync::mpsc::RecvTimeoutError::Timeout)=>{}
   }
  }
  let exit=process.wait();let _=reader.join();let _=std::fs::remove_file(request);
  if let Some(e)=error{update(&app,BrowserStatus{state:if cancelled.is_some(){"cancelled"}else{"failed"}.into(),message:e.clone(),..Default::default()});return Err(e)}
  if !completed||!exit.map(|e|e.success()).unwrap_or(false){update(&app,BrowserStatus{state:"failed".into(),message:"百度搜索批次未完成".into(),..Default::default()});return Err("百度搜索批次未完成".into())}
  let failures=rows.values().filter(|r|r.error.is_some()).count();
  update(&app,BrowserStatus{state:if failures==rows.len(){"failed"}else{"completed"}.into(),message:format!("百度搜索结束：{} 个点位，{} 个失败；浏览器已关闭",rows.len(),failures),..Default::default()});
  let batch=uuid::Uuid::new_v4().to_string();let state=app.state::<ImageBrowserState>();let mut batches=state.batches.lock().map_err(|_|"无法保存百度批次")?;batches.clear();batches.insert(batch.clone(),rows);Ok(batch)
 }).await.map_err(|e|e.to_string())?
}
