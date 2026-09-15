#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(all(feature = "wdio", not(debug_assertions)))]
compile_error!("The wdio feature is only supported by debug builds");

fn main() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init());

  #[cfg(all(debug_assertions, feature = "wdio"))]
  let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

  builder
    .run(tauri::generate_context!())
    .expect("error while running Elef");
}
