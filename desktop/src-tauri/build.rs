fn main() {
    let app_commands = &[
        "choose_library_root",
        "get_library_status",
        "read_library_config",
        "write_library_config",
        "read_authoring_registries",
        "write_authoring_registry",
        "list_decks",
        "document_graph",
        "create_deck",
        "open_deck",
        "read_deck_preview",
        "read_source_snapshot",
        "rename_deck",
        "delete_deck",
        "save_source",
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
    ];
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(app_commands));
    tauri_build::try_build(attributes).expect("failed to build Tauri application manifest");
}
