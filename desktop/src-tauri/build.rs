fn main() {
    macro_rules! command_list {
        ($($extra:literal),* $(,)?) => {
            &[
                "choose_library_root",
                "get_library_status",
                "read_library_config",
                "write_library_config",
                "read_authoring_registries",
                "write_authoring_registry",
                "list_decks",
                "create_deck",
                "open_deck",
                "read_deck_preview",
                "read_source_snapshot",
                "rename_deck",
                "delete_deck",
                "save_source",
                "upload_asset",
                "export_elef",
                "import_elef",
                "import_opened_elef",
                "pending_open_elef_count",
                "resolve_import_conflict",
                "confirm_app_ready",
                "export_diagnostics",
                $($extra),*
            ]
        };
    }
    let desktop_dev = std::env::var_os("CARGO_FEATURE_DESKTOP_DEV").is_some();
    let webdriver = std::env::var_os("CARGO_FEATURE_WEBDRIVER").is_some();
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let has_update_command = target_os == "macos" || (desktop_dev && webdriver);
    let app_commands: &'static [&'static str] = match (desktop_dev, has_update_command, webdriver) {
        (true, true, true) => command_list!(
            "document_graph",
            "stage_update",
            "install_update",
            "export_diagnostics_fixture"
        ),
        (true, true, false) => command_list!("document_graph", "stage_update", "install_update"),
        (true, false, true) => command_list!("document_graph", "export_diagnostics_fixture"),
        (true, false, false) => command_list!("document_graph"),
        (false, true, true) => {
            command_list!(
                "stage_update",
                "install_update",
                "export_diagnostics_fixture"
            )
        }
        (false, true, false) => command_list!("stage_update", "install_update"),
        (false, false, true) => command_list!("export_diagnostics_fixture"),
        (false, false, false) => command_list!(),
    };
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(app_commands));
    tauri_build::try_build(attributes).expect("failed to build Tauri application manifest");
}
