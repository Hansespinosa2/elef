fn main() {
    let app_commands = &[
        "choose_library_root",
        "get_library_status",
        "read_library_config",
        "write_library_config",
        "list_decks",
        "create_deck",
        "open_deck",
        "read_source_snapshot",
        "rename_deck",
        "delete_deck",
        "save_source",
        "export_elef",
        "import_elef",
        "import_opened_elef",
        "pending_open_elef_count",
        "resolve_import_conflict",
    ];
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(app_commands));
    tauri_build::try_build(attributes).expect("failed to build Tauri application manifest");
}
