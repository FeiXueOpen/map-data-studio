use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Deserialize, Serialize)]
pub struct Region {
    id: u64,
    name: String,
    #[serde(default)]
    pinyin: String,
    #[serde(default)]
    first: String,
}

#[derive(Deserialize)]
struct Response {
    code: i32,
    data: Option<Vec<Region>>,
    #[serde(default)]
    msg: String,
}

pub fn city_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .build()
        .expect("failed to initialize city API client")
}

fn validate_response(response: Response) -> Result<Vec<Region>, String> {
    if response.code != 200 {
        return Err(format!("省市接口返回错误（{}）：{}", response.code, response.msg));
    }
    let regions = response.data.ok_or("省市接口未返回数据列表")?;
    if regions.iter().any(|region| region.id == 0 || region.name.trim().is_empty()) {
        return Err("省市接口返回了无效的地点信息".into());
    }
    Ok(regions)
}

async fn request(
    client: &reqwest::Client,
    endpoint: &str,
    body: serde_json::Value,
) -> Result<Vec<Region>, String> {
    let response = client
        .post(format!("https://api.lvxiaolue.com/api/common/city/{endpoint}"))
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "省市查询超时，请重试".to_string()
            } else {
                "无法连接省市接口，请检查网络后重试".to_string()
            }
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("省市接口请求失败（HTTP {status}）"));
    }
    let payload = response.json::<Response>().await.map_err(|_| "省市接口返回格式异常")?;
    validate_response(payload)
}

#[tauri::command]
pub async fn get_provinces(client: tauri::State<'_, reqwest::Client>) -> Result<Vec<Region>, String> {
    request(&client, "provinces", serde_json::json!({})).await
}

#[tauri::command]
pub async fn get_cities(
    client: tauri::State<'_, reqwest::Client>,
    province_id: u64,
) -> Result<Vec<Region>, String> {
    if province_id == 0 {
        return Err("请选择有效省份".into());
    }
    request(&client, "cities", serde_json::json!({"provinceId": province_id})).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_api_records_with_extra_city_fields() {
        let response = serde_json::from_str(r#"{"code":200,"data":[{"id":1264,"name":"南昌市","pinyin":"nanchang","first":"N","pid":3761,"scenicCount":0}],"msg":"success"}"#).unwrap();
        let regions = validate_response(response).unwrap();
        assert_eq!(regions[0].id, 1264);
        assert_eq!(regions[0].name, "南昌市");
    }

    #[test]
    fn rejects_business_errors_missing_data_and_invalid_records() {
        for json in [
            r#"{"code":401,"data":null,"msg":"unauthorized"}"#,
            r#"{"code":200,"msg":"success"}"#,
            r#"{"code":200,"data":[{"id":0,"name":"城市"}]}"#,
            r#"{"code":200,"data":[{"id":1,"name":" "}]}"#,
        ] {
            assert!(validate_response(serde_json::from_str(json).unwrap()).is_err());
        }
    }

    #[test]
    fn accepts_empty_city_lists() {
        let response = serde_json::from_str(r#"{"code":200,"data":[],"msg":"success"}"#).unwrap();
        assert!(validate_response(response).unwrap().is_empty());
    }
}
