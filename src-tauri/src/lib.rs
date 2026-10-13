#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(cities::city_client())
        .manage(automation::AutomationState::default())
        .manage(image_browser::ImageBrowserState::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;
            app.manage(amap::load(app.handle())?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![storage::get_storage_settings, storage::save_storage_settings, image_browser::prepare_baidu_batch, image_browser::clear_baidu_batch, image_browser::get_image_browser_status, image_browser::cancel_image_download, images::reveal_image_folder, images::get_image_settings, images::save_image_settings, images::pick_image_directory, images::download_poi_images, cities::get_provinces, cities::get_cities,
            amap::get_map_config, amap::get_api_settings, amap::save_api_settings, amap::resolve_district, amap::search_pois, amap::search_area, amap::poi_aoi, amap::poi_details, amap::save_export, automation::automation_info, automation::automation_ready, automation::automation_enable, automation::automation_reply, automation::save_export_path, automation::read_excel_template])
        .plugin(tauri_plugin_opener::init())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) { automation::shutdown(app); }
        });
}
mod cities;
mod amap;


mod automation;

pub mod automation_client;

mod images;

mod image_browser;

mod storage;
