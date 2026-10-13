use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, path::{Path, PathBuf}, time::Duration};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSettings { pub directory: String }
#[tauri::command]
pub fn get_image_settings(app: AppHandle) -> Result<ImageSettings, String> {Ok(ImageSettings {directory:crate::storage::load(&app)?.image_directory})}
#[tauri::command]
pub fn save_image_settings(app: AppHandle, directory: String) -> Result<(), String> {
    let mut settings=crate::storage::load(&app)?;settings.image_directory=directory;
    crate::storage::save_storage_settings(app,settings)
}
#[tauri::command]
pub async fn pick_image_directory(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder().map(|p| p.into_path().map(|p| p.to_string_lossy().into_owned()).map_err(|e| e.to_string())).transpose()).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn reveal_image_folder(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = PathBuf::from(path);
    if !path.is_absolute() || !path.is_dir() { return Err("图片目录不存在".into()); }
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}
fn folder_name(name: &str) -> String {
    let name: String = name.chars().map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { '_' } else { c }).take(80).collect();
    let name = name.trim().trim_matches('.').trim();
    if name.is_empty() { "未命名点位".into() } else { name.into() }
}
fn hash(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn public_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v) => !v.is_private() && !v.is_loopback() && !v.is_link_local() && !v.is_unspecified() && !v.is_broadcast() && !v.is_multicast() && v.octets()[0] != 0 && v.octets()[0] < 240,
        std::net::IpAddr::V6(v) => if let Some(v4) = v.to_ipv4_mapped() { public_ip(v4.into()) } else { !v.is_loopback() && !v.is_unspecified() && !v.is_multicast() && (v.segments()[0] & 0xfe00) != 0xfc00 && (v.segments()[0] & 0xffc0) != 0xfe80 },
    }
}
async fn fetch(url: &str, max: usize) -> Result<Vec<u8>, String> {
    let mut url = reqwest::Url::parse(url).map_err(|_| "图片链接无效")?;
    for _ in 0..5 {
        if !["http", "https"].contains(&url.scheme()) || !url.username().is_empty() || url.password().is_some() { return Err("图片仅支持公开 HTTP(S) 链接".into()); }
        let host = url.host_str().ok_or("链接没有域名")?.to_string();
        let port = url.port_or_known_default().ok_or("端口无效")?;
        let addrs: Vec<_> = tokio::time::timeout(Duration::from_secs(10), tokio::net::lookup_host((host.as_str(), port))).await.map_err(|_| "图片域名解析超时")?.map_err(|e| e.to_string())?.filter(|a| public_ip(a.ip())).collect();
        if addrs.is_empty() { return Err("不支持本机或内网图片地址".into()); }
        let client = reqwest::Client::builder().no_proxy().resolve_to_addrs(&host, &addrs).redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(25)).user_agent("Mozilla/5.0 MapDataStudio/0.1").build().map_err(|e| e.to_string())?;
        let mut response = client.get(url.clone()).send().await.map_err(|e| format!("请求失败：{e}"))?;
        if response.status().is_redirection() {
            let location = response.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()).ok_or("重定向地址无效")?;
            url = url.join(location).map_err(|_| "重定向地址无效")?; continue;
        }
        if !response.status().is_success() { return Err(format!("图片服务返回 {}", response.status())); }
        if response.content_length().is_some_and(|n| n > max as u64) { return Err("文件超过下载大小限制".into()); }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if bytes.len() + chunk.len() > max { return Err("文件超过下载大小限制".into()); }
            bytes.extend_from_slice(&chunk);
        }
        return Ok(bytes);
    }
    Err("重定向次数过多".into())
}
fn transient_image_error(message: &str) -> bool {
    message.starts_with("请求失败：") || message.contains("error decoding response body") || message.contains("timed out") || message.contains("connection") || message.contains("图片服务返回 429") || message.contains("图片服务返回 5")
}
async fn retry_image_request<F, Fut>(mut request:F,delay:Duration)->Result<Vec<u8>,String>
where F:FnMut()->Fut,Fut:std::future::Future<Output=Result<Vec<u8>,String>> {
    for attempt in 0..3 {
        match request().await {Ok(bytes)=>return Ok(bytes),Err(e)=>{
            if attempt==2 || !transient_image_error(&e){return Err(e)}
            tokio::time::sleep(delay * (attempt+1)).await;
        }}
    }
    unreachable!()
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedImage { pub url: String, pub source_url: String, pub source: String, pub path: String, pub width: u32, pub height: u32, pub ratio: String, #[serde(default)] pub original_path: String, #[serde(default)] pub original_width: u32, #[serde(default)] pub original_height: u32 }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult { directory: String, images: Vec<DownloadedImage>, failures: Vec<String>, requested: usize }
#[derive(Clone)]
struct Candidate { url: String, page: String }
fn unescape(s: &str) -> String { s.replace("&quot;", "\"").replace("&#34;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&") }
fn bing_candidates(html: &str) -> Vec<Candidate> {
    html.split(" m=\"").skip(1).filter_map(|part| {
        let text = unescape(part.split('"').next()?);
        let value: Value = serde_json::from_str(&text).ok()?;
        Some(Candidate { url: value["murl"].as_str()?.into(), page: value["purl"].as_str().unwrap_or("").into() })
    }).collect()
}
async fn search(engine: &str, query: &str, page: usize, ratio: &str) -> Result<Vec<Candidate>, String> {
    if engine == "bing" {
        let mut url = reqwest::Url::parse("https://www.bing.com/images/async").unwrap();
        url.query_pairs_mut().append_pair("q", query).append_pair("first", &(page * 35).to_string()).append_pair("count", "35");
        if ratio != "original" { let layout = match aspect_ratio(ratio)? {Some((w,h)) if w==h=>"square",Some((w,h)) if w<h=>"tall",_=>"wide"}; url.query_pairs_mut().append_pair("qft", &format!("+filterui:aspect-{layout}")); }
        let html = fetch(url.as_str(), 5 * 1024 * 1024).await?;
        return Ok(bing_candidates(&String::from_utf8_lossy(&html)));
    }
    Err("百度图片需使用内置浏览器查询".into())
}
fn aspect_ratio(ratio:&str)->Result<Option<(u32,u32)>,String>{
    if ratio=="original" {return Ok(None)}
    let native=match ratio {"portrait"=>Some((3,4)),"landscape"=>Some((4,3)),"square"=>Some((1,1)),"tall"=>Some((1,3)),"wide"=>Some((3,1)),_=>None};if native.is_some(){return Ok(native)}
    let (w,h)=ratio.split_once(':').ok_or("比例需为 original 或正整数宽:高，如 3:4")?;
    let (w,h)=(w.parse::<u32>().map_err(|_|"比例无效")?,h.parse::<u32>().map_err(|_|"比例无效")?);
    if w==0 || h==0 || w>9999 || h>9999 {return Err("比例数值需为 1 至 9999".into())}
    Ok(Some((w,h)))
}
struct PreparedImage { bytes:Vec<u8>, width:u32, height:u32, ext:&'static str, original_width:u32, original_height:u32 }
fn prepare_sized(bytes:Vec<u8>,ratio:&str,min_width:u32,min_height:u32,target_width:u32,target_height:u32)->Result<PreparedImage,String>{
    let requested=aspect_ratio(ratio)?;
    if (target_width==0)!=(target_height==0) || target_width>6000 || target_height>6000 {return Err("搜索宽高需同时填写，范围为 1 至 6000；不指定时均为 0".into())}
    let original_ext=match image::guess_format(&bytes).map_err(|_|"不是有效图片")? {image::ImageFormat::Jpeg=>"jpg",image::ImageFormat::Png=>"png",image::ImageFormat::WebP=>"webp",image::ImageFormat::Gif=>"gif",_=>return Err("仅支持 JPEG/PNG/WebP/GIF 原图".into())};
    let mut reader=image::ImageReader::new(std::io::Cursor::new(&bytes)).with_guessed_format().map_err(|e|e.to_string())?;
    let mut limits=image::Limits::default();limits.max_image_width=Some(12000);limits.max_image_height=Some(12000);limits.max_alloc=Some(128*1024*1024);reader.limits(limits);
    let img=reader.decode().map_err(|_|"图片无法解码或尺寸过大")?;
    let (ow,oh)=(img.width(),img.height());
    if ow<min_width || oh<min_height{return Err("原图小于最小宽高要求".into())}
    if target_width>0 && (ow!=target_width || oh!=target_height){return Err(format!("原图尺寸 {ow}×{oh} 不符合搜索条件 {target_width}×{target_height}"))}
    let native_matches=match ratio {"portrait"=>ow<oh,"landscape"=>ow>oh,"square"=>ow==oh,"tall"=>(ow as u64)*2<oh as u64,"wide"=>ow as u64>(oh as u64)*2,_=>requested.map(|(w,h)|if w==h {ow==oh}else if w<h {ow<oh}else{ow>oh}).unwrap_or(true)};
    if !native_matches{return Err("原图比例分类不符合搜索条件".into())}
    Ok(PreparedImage {bytes,width:ow,height:oh,ext:original_ext,original_width:ow,original_height:oh})
}
#[cfg(test)]
fn prepare(bytes:Vec<u8>,ratio:&str,min_width:u32)->Result<(Vec<u8>,u32,u32,&'static str),String>{let p=prepare_sized(bytes,ratio,min_width,0,0,0)?;Ok((p.bytes,p.width,p.height,p.ext))}
fn write_image(path:&Path,bytes:&[u8])->Result<(),String>{
    if path.is_symlink(){return Err("图片文件不能为符号链接".into())}
    if !path.exists(){use std::io::Write;let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|e|e.to_string())?;file.write_all(bytes).map_err(|e|e.to_string())?;}Ok(())
}
fn image_folder(root: &Path, name: &str, id: &str) -> Result<PathBuf, String> {
    let mut folder = root.join(folder_name(name));
    if let Ok(bytes) = std::fs::read(folder.join("images.json")) {
        let old: Value = serde_json::from_slice(&bytes).map_err(|_| "图片记录文件损坏，请检查目录")?;
        if old["id"].as_str() != Some(id) { folder = root.join(format!("{}-{}", folder_name(name), &hash(id.as_bytes())[..8])); }
    }
    if folder.is_symlink() { return Err("点位图片目录不能是符号链接".into()); }
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    Ok(folder)
}
#[tauri::command]
pub async fn download_poi_images(app: AppHandle, batch_id: Option<String>, id: String, name: String, query: String, engine: String, count: usize, ratio: String, min_width: u32, size:Option<String>, min_height: Option<u32>, width: Option<u32>, height: Option<u32>, urls: Vec<String>, directory: Option<String>) -> Result<DownloadResult, String> {
    let (min_height,width,height)=(min_height.unwrap_or(0),width.unwrap_or(0),height.unwrap_or(0));
    let _=aspect_ratio(&ratio)?;
    let size=size.unwrap_or("all".into());
    if !["all","small","medium","large","wallpaper"].contains(&size.as_str()){return Err("搜索尺寸选项无效".into())}
    if min_height>6000 || width>6000 || height>6000 || (width==0)!=(height==0){return Err("搜索尺寸或最小高度无效".into())}
    if id.is_empty() || name.trim().is_empty() || name.len() > 500 || query.len() > 800 || !(1..=if engine == "amap" { 1000 } else { 30 }).contains(&count) || min_width > 4000 || !["amap", "bing", "baidu"].contains(&engine.as_str()) || urls.len() > 1000 { return Err("图片下载参数无效".into()); }
    static DOWNLOAD_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let generation = app.state::<crate::image_browser::ImageBrowserState>().generation.load(std::sync::atomic::Ordering::Relaxed);
    let _guard = DOWNLOAD_GATE.lock().await;
    if generation != app.state::<crate::image_browser::ImageBrowserState>().generation.load(std::sync::atomic::Ordering::Relaxed) {return Err("图片下载已取消".into());}
    app.state::<crate::image_browser::ImageBrowserState>().cancelled.store(false, std::sync::atomic::Ordering::Relaxed);
    let root = PathBuf::from(directory.unwrap_or(get_image_settings(app.clone())?.directory));
    if !root.is_absolute() { return Err("图片保存目录必须是绝对路径".into()); }
    let folder = image_folder(&root, &name, &id)?;
    let manifest = folder.join("images.json");
    if manifest.is_symlink() { return Err("图片记录文件不能是符号链接".into()); }
    let mut history: Vec<DownloadedImage> = match std::fs::read(&manifest) { Ok(bytes) => serde_json::from_slice::<Value>(&bytes).ok().and_then(|v| serde_json::from_value(v["images"].clone()).ok()).unwrap_or_default(), Err(_) => vec![] };
    let mut result = DownloadResult { directory: folder.to_string_lossy().into_owned(), images: vec![], failures: vec![], requested: count };
    let started = std::time::Instant::now();
    let mut seen = HashSet::new();
    for page in 0..4 {
        if app.state::<crate::image_browser::ImageBrowserState>().cancelled.load(std::sync::atomic::Ordering::Relaxed) { result.failures.push("图片下载已取消".into());break; }
        let candidates = if engine == "baidu" {
            match batch_id.as_deref().ok_or_else(||"百度搜索需要批次".to_string()).and_then(|batch|crate::image_browser::candidates(&app,batch,&id)) {
                Ok(rows) => rows.into_iter().map(|c|Candidate {url:c.url,page:c.page}).collect(),
                Err(e) => {result.failures.push(e);break;}
            }
        } else if engine == "amap" { urls.iter().map(|url| Candidate { url: url.clone(), page: url.clone() }).collect() } else {
            match search(&engine, &query, page, &ratio).await { Ok(rows) => rows, Err(e) => { result.failures.push(e); break; } }
        };
        if candidates.is_empty() { result.failures.push("搜索未返回候选图片（可能被验证码拦截）".into()); break; }
        for c in candidates.into_iter().take(if engine == "amap" { 1000 } else { 60 }) {
            if app.state::<crate::image_browser::ImageBrowserState>().cancelled.load(std::sync::atomic::Ordering::Relaxed) {result.failures.push("图片下载已取消".into());break;}
            if started.elapsed() > Duration::from_secs(if engine == "baidu" { 480 } else {120}) { result.failures.push("单点下载已达到时限，保留已下载文件".into()); break; }
            if result.images.len() >= count { break; }
            if !seen.insert(c.url.clone()) { continue; }
            if let Some(previous) = history.iter().find(|i| i.url == c.url && i.ratio == ratio && i.width >= min_width && i.height>=min_height && (width==0 || (i.width==width && i.height==height)) && !i.original_path.is_empty() && i.path==i.original_path && (engine!="baidu" || (!i.original_path.is_empty() && Path::new(&i.original_path).is_file())) && Path::new(&i.path).is_file()) {
                if !result.images.iter().any(|i| i.path == previous.path) { result.images.push(previous.clone()); }
                continue;
            }
            let bytes = match retry_image_request(|| async {
                if app.state::<crate::image_browser::ImageBrowserState>().cancelled.load(std::sync::atomic::Ordering::Relaxed) {return Err("图片下载已取消".into())}
                fetch(&c.url,20*1024*1024).await
            },Duration::from_millis(300)).await { Ok(b) => b, Err(e) => { result.failures.push(format!("{}：{e}", c.url)); continue; } };
            let crop_ratio = ratio.clone();
            let prepared = tauri::async_runtime::spawn_blocking(move || prepare_sized(bytes, &crop_ratio, min_width,min_height,width,height)).await.map_err(|e| e.to_string())?;
            let p=match prepared {Ok(v)=>v,Err(e)=>{result.failures.push(e);continue;}};
            let path=folder.join(format!("{}-{}.{}",engine,&hash(&p.bytes)[..24],p.ext));
            write_image(&path,&p.bytes)?;
            let original_path=path.clone();
            let record=DownloadedImage {url:c.url,source_url:c.page,source:engine.clone(),path:path.to_string_lossy().into_owned(),width:p.width,height:p.height,ratio:ratio.clone(),original_path:original_path.to_string_lossy().into_owned(),original_width:p.original_width,original_height:p.original_height};
            if result.images.iter().any(|i| i.path == record.path) { continue; }
            history.push(record.clone()); result.images.push(record);
            std::fs::write(&manifest, serde_json::to_vec_pretty(&json!({"id":id,"name":name,"query":query,"images":history})).unwrap()).map_err(|e| e.to_string())?;
        }
        if engine == "amap" || engine == "baidu" || result.images.len() >= count || started.elapsed() > Duration::from_secs(120) { break; }
    }
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "requires live Bing and external image sites"]
    async fn live_bing_download_three_portraits() {
        let root = std::env::temp_dir().join("map-data-image-download-test").join("橘子洲");
        std::fs::create_dir_all(&root).unwrap();
        let candidates = search("bing", "长沙 橘子洲 实景", 0, "3:4").await.unwrap();
        assert!(!candidates.is_empty(), "Bing returned no candidates");
        let mut saved = vec![];
        for candidate in candidates.into_iter().take(30) {
            if saved.len() == 3 { break; }
            let bytes = match fetch(&candidate.url, 20 * 1024 * 1024).await { Ok(b) => b, Err(_) => continue };
            let (bytes, width, height, ext) = match prepare(bytes, "3:4", 300) { Ok(v) => v, Err(_) => continue };
            let path = root.join(format!("test-{}.{}", &hash(&bytes)[..24], ext));
            if saved.iter().any(|v: &Value| v["path"] == path.to_string_lossy().as_ref()) { continue; }
            std::fs::write(&path, bytes).unwrap();
            saved.push(json!({"path":path,"url":candidate.url,"sourceUrl":candidate.page,"width":width,"height":height}));
        }
        std::fs::write(root.join("test-result.json"),serde_json::to_vec_pretty(&saved).unwrap()).unwrap();
        assert_eq!(saved.len(), 3, "Only downloaded {} images", saved.len());
    }
    #[test] fn search_size_checks_dimensions_without_modifying_original_bytes(){
        let mut buffer=std::io::Cursor::new(Vec::new());image::DynamicImage::new_rgb8(900,1200).write_to(&mut buffer,image::ImageFormat::Png).unwrap();let bytes=buffer.into_inner();
        let p=prepare_sized(bytes.clone(),"portrait",600,800,900,1200).unwrap();assert_eq!((p.width,p.height),(900,1200));assert_eq!(p.bytes,bytes);
        assert!(prepare_sized(bytes.clone(),"portrait",0,0,500,700).is_err());assert!(prepare_sized(bytes.clone(),"landscape",0,0,0,0).is_err());
        let p=prepare_sized(bytes.clone(),"3:4",0,0,0,0).unwrap();assert_eq!(p.bytes,bytes);
    }
    #[test] fn animated_gif_is_saved_without_losing_frames(){
        let frame=image::RgbaImage::from_pixel(8,6,image::Rgba([255,0,0,255]));let mut bytes=Vec::new();
        {let mut encoder=image::codecs::gif::GifEncoder::new(&mut bytes);encoder.encode_frame(image::Frame::new(frame.clone())).unwrap();encoder.encode_frame(image::Frame::new(frame)).unwrap();}
        let p=prepare_sized(bytes.clone(),"original",0,0,0,0).unwrap();assert_eq!(p.ext,"gif");assert_eq!(p.bytes,bytes);assert_eq!((p.width,p.height),(8,6));
    }
    #[tokio::test] async fn image_retry_recovers_transient_errors_but_not_permanent_failures(){
        let calls=std::cell::Cell::new(0);let bytes=retry_image_request(||{let n=calls.get();calls.set(n+1);async move{if n<2 {Err("error decoding response body".into())}else{Ok(vec![1,2,3])}}},Duration::ZERO).await.unwrap();assert_eq!(bytes,vec![1,2,3]);assert_eq!(calls.get(),3);
        let calls=std::cell::Cell::new(0);assert!(retry_image_request(||{calls.set(calls.get()+1);async{Err("图片服务返回 404".into())}},Duration::ZERO).await.is_err());assert_eq!(calls.get(),1);
    }
    #[test] fn names_and_urls_are_safe() { assert_eq!(folder_name("../测试/点位"), "_测试_点位"); assert!(!public_ip("127.0.0.1".parse().unwrap())); assert!(!public_ip("::ffff:192.168.0.1".parse().unwrap())); assert!(public_ip("8.8.8.8".parse().unwrap())); }
    #[test] fn bing_metadata_preserves_original_and_source_urls() { let rows = bing_candidates(r#"<a m="{&quot;murl&quot;:&quot;https://a/img.jpg&quot;,&quot;purl&quot;:&quot;https://a/page&quot;}">"#); assert_eq!(rows.len(),1); assert_eq!(rows[0].page,"https://a/page"); }
    #[test] fn search_ratio_does_not_crop_original_bytes() {
        let mut bytes = std::io::Cursor::new(Vec::new()); image::DynamicImage::new_rgb8(1000,800).write_to(&mut bytes,image::ImageFormat::Png).unwrap(); let original=bytes.into_inner();
        let (same,w,h,_) = prepare(original.clone(),"original",0).unwrap(); assert_eq!(same,original); assert_eq!((w,h),(1000,800));
        let (saved,w,h,_) = prepare(original.clone(),"landscape",300).unwrap(); assert_eq!(saved,original);assert_eq!((w,h),(1000,800));
    }
}
