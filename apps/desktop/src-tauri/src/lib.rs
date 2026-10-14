mod archives;
mod assets;
mod diagnostics;
mod dialogs;
mod error;
mod exports;
mod library;
mod menus;
mod remote_images;
mod state;
mod updates;
mod work_folders;

use std::path::PathBuf;

use tauri::{Emitter, Manager, RunEvent};

use crate::archives::{
    export_elef, import_elef, import_elef_bytes, import_opened_elef, pending_open_elef_count,
    resolve_import_conflict,
};
use crate::assets::{
    asset_protocol_response, list_media, read_pptx_asset, remove_media, upload_asset,
};
#[cfg(feature = "webdriver")]
use crate::diagnostics::export_diagnostics_fixture;
use crate::diagnostics::{export_diagnostics, record_bootstrap_failure, record_preview_failure};
use crate::exports::save_pptx_bytes;
use crate::library::{
    choose_library_root, get_library_status, read_authoring_registries, read_library_config,
    restore_library_root, write_authoring_registry, write_library_config,
};
use crate::menus::build_menu;
use crate::remote_images::fetch_remote_image;
use crate::state::DesktopState;
use crate::updates::confirm_app_ready;
#[cfg(any(
    target_os = "macos",
    all(feature = "desktop-dev", feature = "webdriver")
))]
use crate::updates::install_update;
#[cfg(feature = "desktop-dev")]
use crate::work_folders::document_graph;
use crate::work_folders::{
    confirm_discard_unsaved_changes, create_work_folder, delete_work_folder, list_snapshots,
    list_work_folders, merge_external_change, open_work_folder, poll_file_events,
    read_source_snapshot, read_work_folder_preview, rename_work_folder, restore_snapshot,
    save_source, take_snapshot,
};

macro_rules! app_commands {
    ($($extra:ident),* $(,)?) => {
        tauri::generate_handler![
            choose_library_root,
            get_library_status,
            read_library_config,
            write_library_config,
            read_authoring_registries,
            write_authoring_registry,
            list_work_folders,
            create_work_folder,
            open_work_folder,
            read_work_folder_preview,
            read_source_snapshot,
            rename_work_folder,
            delete_work_folder,
            save_source,
            poll_file_events,
            take_snapshot,
            list_snapshots,
            restore_snapshot,
            merge_external_change,
            upload_asset,
            list_media,
            remove_media,
            import_elef_bytes,
            export_elef,
            save_pptx_bytes,
            read_pptx_asset,
            fetch_remote_image,
            import_elef,
            import_opened_elef,
            pending_open_elef_count,
            resolve_import_conflict,
            confirm_app_ready,
            confirm_discard_unsaved_changes,
            export_diagnostics,
            record_preview_failure,
            record_bootstrap_failure,
            $($extra),*
        ]
    };
}

pub fn run(context: tauri::Context<tauri::Wry>) {
    // Updater and restart plugins exist only where the updater boundary
    // allows installs: macOS, or the Dev WebDriver harness. Linux Stable
    // keeps no updater plugin, no install command, and no updater
    // permissions; its package manager owns upgrades.
    #[cfg(any(
        target_os = "macos",
        all(feature = "desktop-dev", feature = "webdriver")
    ))]
    let updater = tauri_plugin_updater::Builder::new();
    #[cfg(all(
        feature = "webdriver",
        any(target_os = "macos", feature = "desktop-dev")
    ))]
    let updater = match std::env::var("ELEF_E2E_UPDATER_PUBLIC_KEY") {
        Ok(public_key) => updater.pubkey(public_key),
        Err(_) => updater,
    };
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            let state = app.state::<DesktopState>();
            let added = queue_cli_files(&state, argv, &cwd);
            if added > 0 {
                let _ = app.emit("desktop-open-elef", ());
            }
        }));

    #[cfg(any(
        target_os = "macos",
        all(feature = "desktop-dev", feature = "webdriver")
    ))]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(updater.build());

    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio::init());

    #[cfg(all(feature = "desktop-dev", feature = "webdriver"))]
    let builder = builder.invoke_handler(app_commands!(
        document_graph,
        install_update,
        export_diagnostics_fixture
    ));
    #[cfg(all(
        feature = "desktop-dev",
        not(feature = "webdriver"),
        target_os = "macos"
    ))]
    let builder = builder.invoke_handler(app_commands!(document_graph, install_update));
    #[cfg(all(
        feature = "desktop-dev",
        not(feature = "webdriver"),
        not(target_os = "macos")
    ))]
    let builder = builder.invoke_handler(app_commands!(document_graph));
    #[cfg(all(
        not(feature = "desktop-dev"),
        target_os = "macos",
        feature = "webdriver"
    ))]
    let builder = builder.invoke_handler(app_commands!(install_update, export_diagnostics_fixture));
    #[cfg(all(
        not(feature = "desktop-dev"),
        target_os = "macos",
        not(feature = "webdriver")
    ))]
    let builder = builder.invoke_handler(app_commands!(install_update));
    #[cfg(all(
        not(feature = "desktop-dev"),
        not(target_os = "macos"),
        feature = "webdriver"
    ))]
    let builder = builder.invoke_handler(app_commands!(export_diagnostics_fixture));
    #[cfg(all(
        not(feature = "desktop-dev"),
        not(target_os = "macos"),
        not(feature = "webdriver")
    ))]
    let builder = builder.invoke_handler(app_commands!());

    let app = builder
        .register_asynchronous_uri_scheme_protocol("elefasset", |context, request, responder| {
            responder.respond(asset_protocol_response(context.app_handle(), &request));
        })
        .manage(DesktopState::default())
        .setup(|app| {
            let state = app.state::<DesktopState>();
            let args = std::env::args().collect::<Vec<_>>();
            let _ = queue_cli_files(
                &state,
                args,
                &std::env::current_dir()
                    .unwrap_or_default()
                    .to_string_lossy(),
            );
            #[cfg(feature = "webdriver")]
            if let Some(root) = std::env::var_os("ELEF_E2E_LIBRARY_ROOT") {
                app.state::<DesktopState>()
                    .use_library(PathBuf::from(root))
                    .expect("the dedicated E2E library must open");
            } else {
                restore_library_root(app.handle(), &app.state::<DesktopState>());
            }
            #[cfg(not(feature = "webdriver"))]
            restore_library_root(app.handle(), &app.state::<DesktopState>());
            app.set_menu(build_menu(app.handle())?)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                "open-work" | "refresh-library" | "save" | "export-elef" | "export-pptx"
                | "import-elef" | "print" | "settings" | "export-diagnostics" => {
                    let _ = app.emit("desktop-menu-action", id);
                }
                "show-library" => {
                    let _ = app.emit("desktop-menu-action", "show-library");
                }
                #[cfg(all(target_os = "macos", not(feature = "desktop-dev")))]
                "check-for-updates" => {
                    let _ = app.emit("desktop-menu-action", id);
                }
                "quit" => {
                    let _ = app.emit("desktop-menu-action", "quit");
                }
                "choose-library" => {
                    let _ = app.emit("desktop-menu-action", "choose-library");
                }
                "new-presentation" => {
                    let _ = app.emit("desktop-menu-action", "new-presentation");
                }
                "new-document" => {
                    let _ = app.emit("desktop-menu-action", "new-document");
                }
                "about" => {
                    let _ = app.emit("desktop-menu-action", "about");
                }
                "start-presentation" => {
                    let _ = app.emit("desktop-menu-action", "start-presentation");
                }
                _ => {}
            }
        })
        .build(context)
        .expect("error while building Elef Desktop");

    app.run(|app, event| {
        if let RunEvent::ExitRequested {
            code: None, api, ..
        } = &event
            && app.get_webview_window("main").is_some()
        {
            // OS Quit must take the same save/conflict path as a window close.
            // Restart requests have an explicit exit code and are already
            // guarded by save-before-install in the frontend update flow.
            api.prevent_exit();
            let _ = app.emit("desktop-menu-action", "quit");
        }
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = event {
            let paths = urls.into_iter().filter_map(|url| url.to_file_path().ok());
            let state = app.state::<DesktopState>();
            if queue_open_files(&state, paths) > 0 {
                let _ = app.emit("desktop-open-elef", ());
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}

fn queue_cli_files(state: &DesktopState, args: Vec<String>, cwd: &str) -> usize {
    let cwd = PathBuf::from(cwd);
    queue_open_files(
        state,
        // The initial process receives argv[0], while single-instance
        // callbacks vary by platform/plugin version in whether they include
        // it. Extension filtering below safely ignores the executable path.
        args.into_iter().map(|argument| {
            let path = PathBuf::from(argument);
            if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            }
        }),
    )
}

fn queue_open_files(state: &DesktopState, paths: impl IntoIterator<Item = PathBuf>) -> usize {
    let candidates = paths
        .into_iter()
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("elef"))
        })
        .collect::<Vec<_>>();
    let count = candidates.len();
    state
        .open_files
        .lock()
        .expect("opened file queue poisoned")
        .extend(candidates);
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_capability_denies_custom_ipc_from_remote_content() {
        let app = tauri::test::mock_builder()
            .manage(DesktopState::default())
            .invoke_handler(tauri::generate_handler![pending_open_elef_count])
            .build(tauri::generate_context!())
            .unwrap();
        app.state::<DesktopState>()
            .open_files
            .lock()
            .unwrap()
            .push_back(PathBuf::from("/tmp/pending.elef"));
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let request = |url: &str| tauri::webview::InvokeRequest {
            cmd: "pending_open_elef_count".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: url.parse().unwrap(),
            body: tauri::ipc::InvokeBody::default(),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        };

        assert!(
            tauri::test::get_ipc_response(&webview, request("https://untrusted.example/")).is_err()
        );
        let local = if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        };
        let response = tauri::test::get_ipc_response(&webview, request(local)).unwrap();
        assert_eq!(response.deserialize::<usize>().unwrap(), 1);
    }

    #[test]
    fn cli_open_file_queue_accepts_arguments_with_or_without_argv_zero() {
        let state = DesktopState::default();
        let count = queue_cli_files(
            &state,
            vec![
                "/usr/bin/elef-desktop".into(),
                "/tmp/first.elef".into(),
                "second.ELEF".into(),
                "notes.md".into(),
            ],
            "/home/user",
        );
        assert_eq!(count, 2);
        assert_eq!(
            state
                .open_files
                .lock()
                .expect("opened file queue poisoned")
                .len(),
            2
        );
        assert_eq!(
            queue_cli_files(&state, vec!["third.elef".into()], "/tmp"),
            1
        );
    }
}
