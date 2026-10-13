fn main() {
    if let Some(code) = map_data_studio_lib::automation_client::run_if_requested() { std::process::exit(code); }
    map_data_studio_lib::run();
}
