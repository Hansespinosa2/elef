#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    elef_desktop_lib::run(tauri::generate_context!());
}
