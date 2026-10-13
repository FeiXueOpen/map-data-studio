use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct StorageSettings { pub excel_directory: String, pub image_directory: String, pub resource_directory: String, #[serde(default)] pub browser_proxy: String }
#[derive(Serialize)]
pub struct StorageConfig { pub settings: StorageSettings, pub defaults: StorageSettings, pub warning: Option<String> }
fn defaults_at(root: &Path) -> StorageSettings {
    let root=root.join("Map Data Studio");
    StorageSettings {excel_directory:root.join("Excel").to_string_lossy().into_owned(),image_directory:root.join("Images").to_string_lossy().into_owned(),resource_directory:root.join("Resources").to_string_lossy().into_owned(),browser_proxy:String::new()}
}
fn defaults(app: &AppHandle) -> Result<StorageSettings,String>{Ok(defaults_at(&app.path().document_dir().map_err(|e|e.to_string())?))}
fn path(app:&AppHandle)->Result<PathBuf,String>{Ok(app.path().app_config_dir().map_err(|e|e.to_string())?.join("storage-settings.json"))}
pub fn load(app:&AppHandle)->Result<StorageSettings,String>{
    let path=path(app)?;
    if path.exists(){return serde_json::from_slice(&std::fs::read(path).map_err(|e|e.to_string())?).map_err(|_|"存储目录设置损坏，请在设置中恢复默认".into())}
    let mut settings=defaults(app)?;
    if let Ok(bytes)=std::fs::read(app.path().app_config_dir().map_err(|e|e.to_string())?.join("image-settings.json")) {
        if let Ok(old)=serde_json::from_slice::<serde_json::Value>(&bytes) {
            if let Some(directory)=old["directory"].as_str().filter(|s|Path::new(s).is_absolute()){settings.image_directory=directory.into();}
        }
    }
    Ok(settings)
}
pub fn validate_proxy(proxy:&str)->Result<(),String>{if proxy.is_empty(){return Ok(())}let url=reqwest::Url::parse(proxy).map_err(|_|"代理地址无效")?;if !["http","https","socks5"].contains(&url.scheme())||url.host_str().is_none()||!url.username().is_empty()||url.password().is_some()||url.query().is_some()||url.fragment().is_some(){return Err("代理需为HTTP(S)/SOCKS5服务器地址，不含账号或其他参数".into())}Ok(())}
fn persist(path:&Path,settings:&StorageSettings)->Result<(),String>{
    validate_proxy(&settings.browser_proxy)?;
    for directory in [&settings.excel_directory,&settings.image_directory,&settings.resource_directory]{
        if directory.trim().is_empty() || !Path::new(directory).is_absolute(){return Err("存储目录必须为非空绝对路径".into())}
    }
    for directory in [&settings.excel_directory,&settings.image_directory,&settings.resource_directory]{std::fs::create_dir_all(directory).map_err(|e|format!("无法创建存储目录：{e}"))?;}
    std::fs::create_dir_all(path.parent().ok_or("设置目录无效")?).map_err(|e|e.to_string())?;
    let temp=path.with_file_name(format!("storage-{}.tmp",uuid::Uuid::new_v4()));
    std::fs::write(&temp,serde_json::to_vec_pretty(settings).unwrap()).map_err(|e|e.to_string())?;
    if let Err(e)=std::fs::rename(&temp,path){let _=std::fs::remove_file(temp);return Err(e.to_string())}Ok(())
}
#[tauri::command]
pub fn get_storage_settings(app:AppHandle)->Result<StorageConfig,String>{let defaults=defaults(&app)?;let (settings,warning)=match load(&app){Ok(settings)=>(settings,None),Err(e)=>(defaults.clone(),Some(e))};Ok(StorageConfig {settings,defaults,warning})}
#[tauri::command]
pub fn save_storage_settings(app:AppHandle,settings:StorageSettings)->Result<(),String>{persist(&path(&app)?,&settings)}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]fn defaults_and_saved_directories_are_complete_and_persistent(){
        let root=std::env::temp_dir().join(format!("storage-test-{}",uuid::Uuid::new_v4()));let settings=defaults_at(&root);let config=root.join("config/settings.json");
        persist(&config,&settings).unwrap();let loaded:StorageSettings=serde_json::from_slice(&std::fs::read(&config).unwrap()).unwrap();
        assert!(Path::new(&loaded.excel_directory).is_dir());assert!(Path::new(&loaded.image_directory).is_dir());assert!(Path::new(&loaded.resource_directory).is_dir());
        let mut invalid=settings;invalid.image_directory="relative".into();assert!(persist(&config,&invalid).is_err());std::fs::remove_dir_all(root).unwrap();
    }
}
