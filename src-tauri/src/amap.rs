use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(test)]
use serde_json::json;
use std::{path::{Path, PathBuf}, time::Duration, sync::RwLock, io::Write};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::Mutex;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    web_key: String,
    js_key: String,
    security_js_code: String,
}

pub struct AmapState {
    config: RwLock<Config>,
    gate: Mutex<()>,
}

pub fn load(app: &AppHandle) -> Result<AmapState, Box<dyn std::error::Error>> {
    let saved = app.path().app_config_dir()?.join("map-keys.json");
    let bundled = app.path().resource_dir()?.join("config.example.json");
    let config = read_config(&saved);
    // Local developer credentials must never become release defaults or bundled resources.
    #[cfg(debug_assertions)]
    let config = config.or_else(|| read_config(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("config.local.json")));
    let config = config.or_else(|| read_config(&bundled)).unwrap_or_default();
    Ok(AmapState { config: RwLock::new(config), gate: Mutex::new(()) })
}

fn read_config(path: &Path) -> Option<Config> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

fn validate_config(config: Config) -> Result<Config, String> {
    let config = Config { web_key: config.web_key.trim().into(), js_key: config.js_key.trim().into(), security_js_code: config.security_js_code.trim().into() };
    for (label, value) in [("Web API Key", &config.web_key), ("Web JS Key", &config.js_key), ("安全密钥", &config.security_js_code)] {
        if value.len() != 32 || !value.chars().all(|c| c.is_ascii_hexdigit()) { return Err(format!("{label} 应为 32 位密钥（0–9、a–f），请检查填写内容")); }
    }
    Ok(config)
}

fn write_config(path: &Path, config: &Config) -> Result<(), String> {
    let directory = path.parent().ok_or("配置保存目录无效")?;
    std::fs::create_dir_all(directory).map_err(|_| "无法创建配置目录")?;
    let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "系统时间无效")?.as_nanos();
    let temp = directory.join(format!("map-keys-{}-{unique}.tmp", std::process::id()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp).map_err(|_| "无法创建配置文件，请检查目录权限")?;
    let result = (|| {
        let bytes = serde_json::to_vec_pretty(config).map_err(|_| "配置序列化失败")?;
        file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|_| "无法写入配置文件")?;
        drop(file);
        std::fs::rename(&temp, path).map_err(|_| "无法保存配置文件")
    })();
    if result.is_err() { let _ = std::fs::remove_file(&temp); }
    result.map_err(str::to_string)
}

#[tauri::command]
pub fn get_api_settings(state: State<'_, AmapState>) -> Result<Config, String> {
    Ok(state.config.read().map_err(|_| "无法读取配置")?.clone())
}

#[tauri::command]
pub async fn save_api_settings(app: AppHandle, state: State<'_, AmapState>, config: Config) -> Result<(), String> {
    let config = validate_config(config)?;
    let _guard = state.gate.lock().await;
    let path = app.path().app_config_dir().map_err(|_| "配置目录不可用")?.join("map-keys.json");
    let mut current = state.config.write().map_err(|_| "无法更新配置")?;
    write_config(&path, &config)?;
    *current = config;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapConfig {
    js_key: String,
    security_js_code: String,
    categories: Vec<Category>,
}

#[derive(Serialize)]
pub struct Category { name: &'static str, code: &'static str }

fn categories() -> Vec<Category> {
    vec![Category { name: "景点", code: "110000" }, Category { name: "商场", code: "060100" }, Category { name: "酒店", code: "100000" }, Category { name: "餐饮", code: "050000" }]
}

#[tauri::command]
pub fn get_map_config(state: State<'_, AmapState>) -> Result<MapConfig, String> {
    let config = state.config.read().map_err(|_| "无法读取地图配置")?;
    Ok(MapConfig { js_key: config.js_key.clone(), security_js_code: config.security_js_code.clone(), categories: categories() })
}

fn value_text(value: &Value) -> String {
    match value { Value::String(text) => text.clone(), Value::Number(n) => n.to_string(), _ => String::new() }
}

fn coordinates(value: &Value) -> Option<[f64; 2]> {
    let text = value.as_str()?;
    let (lng, lat) = text.split_once(',')?;
    let point = [lng.parse::<f64>().ok()?, lat.parse::<f64>().ok()?];
    if point.iter().all(|n| n.is_finite()) && (-180.0..=180.0).contains(&point[0]) && (-90.0..=90.0).contains(&point[1]) { Some(point) } else { None }
}

fn check_response(value: Value) -> Result<Value, String> {
    if value_text(&value["status"]) != "1" {
        let code = value_text(&value["infocode"]);
        let reason = match code.as_str() {
            "10001" => "Key 无效，请检查 Web 服务 Key",
            "10003" | "10004" | "10044" | "10045" => "请求频率或配额受限，请稍后重试",
            "10005" | "10006" | "10007" | "10009" | "10012" | "10013" | "10020" => "Key 权限或白名单配置不允许此请求",
            _ => "高德接口拒绝请求",
        };
        return Err(format!("{reason}（{code} / {}）", value_text(&value["info"])));
    }
    Ok(value)
}

async fn request(client: &reqwest::Client, state: &AmapState, path: &str, mut params: Vec<(&str, String)>) -> Result<Value, String> {
    let _guard = state.gate.lock().await;
    tokio::time::sleep(Duration::from_millis(550)).await;
    let key = state.config.read().map_err(|_| "无法读取查询配置")?.web_key.clone();
    if key.is_empty() { return Err("请先在设置中填写高德 Web API Key".into()); }
    params.push(("key", key));
    let mut url = reqwest::Url::parse(&format!("https://restapi.amap.com/{path}")).map_err(|_| "高德服务地址无效")?;
    url.query_pairs_mut().extend_pairs(params);
    let response = client.get(url).send().await
        .map_err(|e| if e.is_timeout() { "高德请求超时，请重试" } else { "无法连接高德，请检查网络" })?;
    if !response.status().is_success() { return Err(format!("高德服务异常（HTTP {}）", response.status())); }
    check_response(response.json::<Value>().await.map_err(|_| "高德返回格式异常")?)
}

#[derive(Clone, Serialize)]
pub struct District { name: String, adcode: String, center: [f64; 2], boundaries: Vec<Vec<[f64; 2]>> }

async fn district_request(client: &reqwest::Client, state: &AmapState, name: &str, filter: &str, full: bool) -> Result<Value, String> {
    let mut params = vec![("keywords", name.to_string()), ("subdistrict", "0".into()), ("extensions", if full { "all" } else { "base" }.into())];
    if !filter.is_empty() { params.push(("filter", filter.into())); }
    request(client, state, "v3/config/district", params).await
}

#[tauri::command]
pub async fn resolve_district(client: State<'_, reqwest::Client>, state: State<'_, AmapState>, city: String, province: String) -> Result<District, String> {
    if city.trim().is_empty() || city.len() > 100 || province.len() > 100 { return Err("请选择有效城市".into()); }
    let mut filter = String::new();
    if !province.is_empty() && province != city {
        let parent = district_request(&client, &state, &province, "", false).await?;
        filter = parent["districts"].as_array().and_then(|list| list.iter().find(|item| value_text(&item["name"]) == province)).map(|item| value_text(&item["adcode"])).ok_or("未找到所选省份的行政区")?;
    }
    let payload = district_request(&client, &state, &city, &filter, true).await?;
    let district = payload["districts"].as_array().and_then(|list| list.iter().find(|item| {
        let name = value_text(&item["name"]);
        name == city || name.trim_end_matches('市') == city.trim_end_matches('市')
    })).ok_or("未找到对应城市的高德行政区")?;
    let center = coordinates(&district["center"]).ok_or("城市中心坐标无效")?;
    let boundaries = value_text(&district["polyline"]).split('|').filter_map(|ring| {
        let points: Vec<_> = ring.split(';').filter_map(|point| coordinates(&Value::String(point.into()))).collect();
        (points.len() >= 3).then_some(points)
    }).collect();
    Ok(District { name: value_text(&district["name"]), adcode: value_text(&district["adcode"]), center, boundaries })
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Poi {
    id: String, name: String, category: String, typecode: String,
    location: Option<[f64; 2]>, address: String, province: String, city: String, district: String,
    hours: String, week_hours: String, tel: String, tag: String, photos: Vec<String>,
    source: String, collected_at: String, parent_id: String, children: Vec<Poi>, raw: Value, raw_records: Vec<Value>,
}

fn parse_poi(item: &Value, parent: &str) -> Option<Poi> {
    let id = value_text(&item["id"]);
    let name = value_text(&item["name"]);
    if id.is_empty() || name.is_empty() { return None; }
    let typecode = value_text(&item["typecode"]);
    let category = if typecode.starts_with("11") { "景点" } else if typecode.starts_with("06") { "商场" } else if typecode.starts_with("10") { "酒店" } else if typecode.starts_with("05") { "餐饮" } else { "其他" };
    let children = item["children"].as_array().map(|list| list.iter().filter_map(|child| parse_poi(child, &id)).collect()).unwrap_or_default();
    let photos = item["photos"].as_array().map(|list| list.iter().filter_map(|p| {
        let url = p["url"].as_str()?;
        (url.starts_with("https://") || url.starts_with("http://")).then(|| url.to_string())
    }).collect()).unwrap_or_default();
    Some(Poi { id, name, category: category.into(), typecode, location: coordinates(&item["location"]),
        address: value_text(&item["address"]), province: value_text(&item["pname"]), city: value_text(&item["cityname"]), district: value_text(&item["adname"]),
        hours: value_text(&item["business"]["opentime_today"]), week_hours: value_text(&item["business"]["opentime_week"]), tel: value_text(&item["business"]["tel"]), tag: value_text(&item["business"]["tag"]), photos,
        source: "amap".into(), collected_at: String::new(), parent_id: parent.into(), children, raw: item.clone(), raw_records: vec![item.clone()] })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult { pois: Vec<Poi>, has_more: bool, page: u32 }

#[tauri::command]
pub async fn search_pois(client: State<'_, reqwest::Client>, state: State<'_, AmapState>, adcode: String, codes: Vec<String>, keywords: String, page: u32) -> Result<SearchResult, String> {
    if adcode.len() != 6 || !adcode.chars().all(|c| c.is_ascii_digit()) || !(1..=100).contains(&page) || keywords.len() > 200 { return Err("检索参数无效".into()); }
    if codes.len() > 30 || codes.iter().any(|code| code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit())) { return Err("POI 分类无效，最多选择 30 类".into()); }
    if codes.is_empty() && keywords.trim().is_empty() { return Err("请选择 POI 类型或输入关键词".into()); }
    let payload = request(&client, &state, "v5/place/text", vec![("region", adcode), ("city_limit", "true".into()), ("types", codes.join("|")), ("keywords", keywords), ("page_size", "25".into()), ("page_num", page.to_string()), ("show_fields", "business,photos".into())]).await?;
    let records = payload["pois"].as_array().ok_or("高德未返回 POI 列表")?;
    Ok(SearchResult { pois: records.iter().filter_map(|p| parse_poi(p, "")).collect(), has_more: records.len() == 25, page })
}

#[derive(Serialize)]
pub struct AoiBoundary { boundaries: Vec<Vec<[f64; 2]>>, raw: Value }

fn aoi_rings(payload: &Value, id: &str) -> Vec<Vec<[f64; 2]>> {
    payload["aois"].as_array().into_iter().flatten()
        .filter(|aoi| value_text(&aoi["id"]) == id)
        .flat_map(|aoi| value_text(&aoi["polyline"]).split('|').map(|ring| {
            let points: Option<Vec<_>> = ring.split('_').map(|point| coordinates(&Value::String(point.into()))).collect();
            points.unwrap_or_default()
        }).collect::<Vec<_>>())
        .filter(|ring| ring.len() >= 3 && ring.len() <= 10000 && ring.iter().zip(ring.iter().cycle().skip(1)).take(ring.len()).map(|(p, q)| (p[0] - ring[0][0]) * (q[1] - ring[0][1]) - (p[1] - ring[0][1]) * (q[0] - ring[0][0])).sum::<f64>().abs() > 1e-14)
        .collect()
}

#[tauri::command]
pub async fn poi_aoi(client: State<'_, reqwest::Client>, state: State<'_, AmapState>, id: String) -> Result<AoiBoundary, String> {
    if id.is_empty() || id.len() > 40 || !id.chars().all(|c| c.is_ascii_alphanumeric()) { return Err("高德 POI ID 无效".into()); }
    let raw = request(&client, &state, "v5/aoi/polyline", vec![("id", id.clone())]).await?;
    Ok(AoiBoundary { boundaries: aoi_rings(&raw, &id), raw })
}

#[tauri::command]
pub async fn search_area(client: State<'_, reqwest::Client>, state: State<'_, AmapState>, polygon: Vec<[f64; 2]>, page: u32) -> Result<SearchResult, String> {
    if !(3..=100).contains(&polygon.len()) || !(1..=8).contains(&page) || polygon.iter().any(|p| !p.iter().all(|n| n.is_finite()) || !(-180.0..=180.0).contains(&p[0]) || !(-90.0..=90.0).contains(&p[1])) { return Err("请圈选有效范围，最多 100 个顶点".into()); }
    let mut points = polygon;
    if points.first() != points.last() { points.push(points[0]); }
    let boundary = points.iter().map(|p| format!("{:.6},{:.6}", p[0], p[1])).collect::<Vec<_>>().join("|");
    // Explicitly include every major category; an omitted types parameter defaults
    // to business residences and transportation facilities, hiding scenic spots.
    let types = (1..=20).chain([22, 97, 99]).map(|code| format!("{code:02}0000")).collect::<Vec<_>>().join("|");
    let payload = request(&client, &state, "v5/place/polygon", vec![("polygon", boundary), ("types", types), ("page_size", "25".into()), ("page_num", page.to_string()), ("show_fields", "business,photos".into())]).await?;
    let records = payload["pois"].as_array().ok_or("高德未返回范围点位列表")?;
    Ok(SearchResult { pois: records.iter().filter_map(|p| parse_poi(p, "")).collect(), has_more: records.len() == 25, page })
}

#[tauri::command]
pub async fn poi_details(client: State<'_, reqwest::Client>, state: State<'_, AmapState>, ids: Vec<String>) -> Result<Vec<Poi>, String> {
    if ids.is_empty() || ids.len() > 10 || ids.iter().any(|id| id.len() > 40 || !id.chars().all(|c| c.is_ascii_alphanumeric())) { return Err("POI ID 无效，一次最多查询 10 条".into()); }
    let payload = request(&client, &state, "v5/place/detail", vec![("id", ids.join("|")), ("show_fields", "business,photos,children".into())]).await?;
    Ok(payload["pois"].as_array().ok_or("高德未返回详情列表")?.iter().filter_map(|p| parse_poi(p, "")).collect())
}

#[tauri::command]
pub async fn save_export(app: AppHandle, bytes: Vec<u8>, file_name: String) -> Result<Option<String>, String> {
    if bytes.len() > 25 * 1024 * 1024 || bytes.get(0..2) != Some(b"PK") { return Err("导出文件格式或大小无效".into()); }
    let safe_name: String = file_name.chars().filter(|c| c.is_alphanumeric() || "-_.".contains(*c)).take(100).collect();
    let directory = crate::storage::load(&app)?.excel_directory;
    std::fs::create_dir_all(&directory).map_err(|e|format!("无法创建 Excel 目录：{e}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let file = app.dialog().file().set_directory(&directory).set_file_name(&safe_name).add_filter("Excel 工作簿", &["xlsx"]).blocking_save_file();
        let Some(file) = file else { return Ok(None); };
        let mut path = file.into_path().map_err(|_| "保存路径无效")?;
        path.set_extension("xlsx");
        std::fs::write(&path, bytes).map_err(|_| "无法写入文件，请检查保存目录权限")?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }).await.map_err(|_| "保存文件任务失败".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn aoi_boundary_parsing_matches_id_and_rejects_invalid_or_degenerate_rings() {
        let payload = serde_json::json!({"aois":[
            {"id":"other","polyline":"112,28_113,28_113,29"},
            {"id":"target","polyline":"112,28_113,28_113,29_112,29|bad_113,28_113,29|112,28_113,28_114,28"}
        ]});
        let rings = aoi_rings(&payload, "target");
        assert_eq!(rings.len(), 1);
        assert_eq!(rings[0].len(), 4);
        assert!(aoi_rings(&payload, "missing").is_empty());
    }
    #[test]
    fn configuration_validation_trims_fields_without_exposing_keys() {
        let config = validate_config(Config { web_key: format!(" {} ", "a".repeat(32)), js_key: "b".repeat(32), security_js_code: "c".repeat(32) }).unwrap();
        assert_eq!(config.web_key.len(), 32);
        let error = validate_config(Config { web_key: "private-invalid-value".into(), ..config }).err().unwrap();
        assert!(error.contains("Web API Key"));
        assert!(!error.contains("private-invalid-value"));
    }
    #[test]
    fn saved_configuration_replaces_previous_values_and_survives_reload() {
        let directory = std::env::temp_dir().join(format!("map-data-config-test-{}", std::process::id()));
        let path = directory.join("map-keys.json");
        let config = Config { web_key: "a".repeat(32), js_key: "b".repeat(32), security_js_code: "c".repeat(32) };
        write_config(&path, &config).unwrap();
        let changed = Config { web_key: "d".repeat(32), ..config };
        write_config(&path, &changed).unwrap();
        let saved = read_config(&path).unwrap();
        assert_eq!(saved.web_key, changed.web_key);
        assert_eq!(saved.js_key, changed.js_key);
        assert_eq!(saved.security_js_code, changed.security_js_code);
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn missing_fields_and_bad_coordinates_are_not_fabricated() {
        let poi = parse_poi(&json!({"id":"B01","name":"地点","location":"NaN,30","business":[],"photos":[],"typecode":"110101"}), "").unwrap();
        assert!(poi.location.is_none()); assert!(poi.hours.is_empty()); assert_eq!(poi.category, "景点");
        assert!(parse_poi(&json!({"name":"没有ID"}), "").is_none());
    }
    #[test]
    fn preserves_every_raw_field_for_parent_and_child() {
        let input = json!({"id":"P","name":"父点","business":{"rating":"4.7","keytag":"4A景区","rectag":"春节亲子","alias":"别名","extra":{"flag":false}},"photos":[{"title":"原图片标题","url":"https://example.com/a"}],"unknown":[1,2],"children":[{"id":"C","name":"子点","business":{"rating":0,"cost":"12"}}]});
        let poi = parse_poi(&input, "").unwrap();
        assert_eq!(poi.raw, input);
        assert_eq!(poi.raw_records, vec![input.clone()]);
        assert_eq!(poi.children[0].raw, input["children"][0]);
    }
    #[test]
    fn child_relationships_and_api_errors() {
        let poi = parse_poi(&json!({"id":"P","name":"父点","children":[{"id":"C","name":"子点","location":"120,30"}]}), "").unwrap();
        assert_eq!(poi.children[0].parent_id, "P");
        assert!(check_response(json!({"status":"0","infocode":"10003","info":"DAILY_QUERY_OVER_LIMIT"})).unwrap_err().contains("配额"));
        assert_eq!(coordinates(&json!("120,30")), Some([120.0,30.0]));
    }
}
