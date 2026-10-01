fn main() {
    let app_commands = &[
        "choose_library_root",
        "get_library_status",
        "list_decks",
        "create_deck",
        "open_deck",
        "rename_deck",
        "delete_deck",
        "save_source",
    ];
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(app_commands));
    tauri_build::try_build(attributes).expect("failed to build Tauri application manifest");
}
