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
                "list_work_folders",
                "document_graph",
                "create_work_folder",
                "open_work_folder",
                "read_work_folder_preview",
                "read_source_snapshot",
                "rename_work_folder",
                "delete_work_folder",
                "save_source",
                "poll_file_events",
                "take_snapshot",
                "list_snapshots",
                "restore_snapshot",
                "merge_external_change",
                "upload_asset",
                "list_media",
                "remove_media",
                "import_elef_bytes",
                "export_elef",
                "import_elef",
                "import_opened_elef",
                "pending_open_elef_count",
                "resolve_import_conflict",
                "install_update",
                "confirm_app_ready",
                "confirm_discard_unsaved_changes",
                "export_diagnostics",
                "record_preview_failure",
                "record_bootstrap_failure",
                $($extra),*
            ]
        };
    }
    // Test-only commands never ship in production builds. The architecture
    // checker asserts this split: the macro base matches the production
    // capability, extras match only the E2E capability.
    let app_commands: &'static [&'static str] =
        if std::env::var_os("CARGO_FEATURE_WEBDRIVER").is_some() {
            command_list!("export_diagnostics_fixture")
        } else {
            command_list!()
        };
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(app_commands));
    tauri_build::try_build(attributes).expect("failed to build Tauri application manifest");
}
