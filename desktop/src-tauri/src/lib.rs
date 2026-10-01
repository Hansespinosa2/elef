use std::collections::VecDeque;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use elef_core::{
    CoreError, DeckSummary, ImportResolution, ImportResult, Library, LibraryConfig, OpenDeck,
    SaveResult, SourceSnapshot,
};
use serde::Serialize;
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[derive(Default)]
struct DesktopState {
    library: RwLock<Option<Arc<Library>>>,
    root: RwLock<Option<PathBuf>>,
    pending_import: std::sync::Mutex<Option<PathBuf>>,
    open_files: std::sync::Mutex<VecDeque<PathBuf>>,
}

impl DesktopState {
    fn use_library(&self, path: PathBuf) -> Result<LibraryStatus, CommandError> {
        let library = Arc::new(Library::open(path)?);
        let root = library.root().to_path_buf();
        let status = library_status(&library, &root)?;
        *self.library.write().expect("library state lock poisoned") = Some(library);
        *self.root.write().expect("root state lock poisoned") = Some(root.clone());
        Ok(status)
    }

    fn current_library(&self) -> Result<Arc<Library>, CommandError> {
        self.library
            .read()
            .expect("library state lock poisoned")
            .clone()
            .ok_or_else(|| CommandError::new("not_found", "Choose a library folder first.", false))
    }
}

#[derive(Debug, Serialize)]
struct CommandError {
    code: &'static str,
    message: String,
    retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<serde_json::Value>,
}

impl CommandError {
    fn new(code: &'static str, message: &str, retryable: bool) -> Self {
        Self {
            code,
            message: message.to_owned(),
            retryable,
            details: None,
        }
    }

    fn with_details(
        code: &'static str,
        message: &str,
        retryable: bool,
        details: serde_json::Value,
    ) -> Self {
        Self {
            code,
            message: message.to_owned(),
            retryable,
            details: Some(details),
        }
    }
}

impl From<CoreError> for CommandError {
    fn from(error: CoreError) -> Self {
        match error {
            CoreError::Conflict {
                disk_hash,
                disk_source,
                disk_source_file,
            } => Self {
                code: "conflict",
                message: "The file changed outside Elef. Review the current version before saving."
                    .into(),
                retryable: false,
                details: Some(serde_json::json!({
                    "disk_hash": disk_hash,
                    "current": { "source": disk_source, "source_file": disk_source_file }
                })),
            },
            CoreError::ImportConflict {
                incoming_name,
                existing_name,
            } => Self::with_details(
                "import_conflict",
                "A deck with this identity already exists.",
                false,
                serde_json::json!({
                    "incoming_name": incoming_name,
                    "existing_name": existing_name
                }),
            ),
            other => Self {
                code: other.code(),
                message: other.to_string(),
                retryable: matches!(other, CoreError::Io(_)),
                details: None,
            },
        }
    }
}

#[derive(Debug, Serialize)]
struct LibraryStatus {
    root: String,
    decks: Vec<DeckSummary>,
    config: LibraryConfig,
    config_notice: Option<String>,
}

fn library_status(library: &Library, root: &Path) -> Result<LibraryStatus, CommandError> {
    let (config, config_notice) = match library.read_config() {
        Ok(config) => (config, None),
        Err(_) => (
            LibraryConfig::default(),
            Some("Library settings could not be read; defaults are in use.".into()),
        ),
    };
    Ok(LibraryStatus {
        root: root.to_string_lossy().into_owned(),
        decks: library.list_decks()?,
        config,
        config_notice,
    })
}

#[derive(Debug, Serialize)]
struct DeleteResult {
    deleted: bool,
}

#[tauri::command]
async fn choose_library_root(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<Option<LibraryStatus>, CommandError> {
    let Some(selection) = app
        .dialog()
        .file()
        .set_title("Choose your Elef library folder")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let path = selection
        .into_path()
        .map_err(|_| CommandError::new("invalid_input", "Choose a local folder.", false))?;
    let status = state.use_library(path)?;
    persist_library_root(&app, &status.root)?;
    Ok(Some(status))
}

#[tauri::command]
fn get_library_status(
    state: State<'_, DesktopState>,
) -> Result<Option<LibraryStatus>, CommandError> {
    let root = state.root.read().expect("root state lock poisoned").clone();
    let Some(root) = root else {
        return Ok(None);
    };
    let library = state.current_library()?;
    Ok(Some(library_status(&library, &root)?))
}

#[tauri::command]
fn list_decks(state: State<'_, DesktopState>) -> Result<Vec<DeckSummary>, CommandError> {
    Ok(state.current_library()?.list_decks()?)
}

#[tauri::command]
fn create_deck(
    state: State<'_, DesktopState>,
    name: String,
    kind: String,
) -> Result<OpenDeck, CommandError> {
    Ok(state.current_library()?.create_deck(&name, &kind)?)
}

#[tauri::command]
fn open_deck(state: State<'_, DesktopState>, id: String) -> Result<OpenDeck, CommandError> {
    Ok(state.current_library()?.open_deck(&id)?)
}

#[tauri::command]
fn read_source_snapshot(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<SourceSnapshot, CommandError> {
    Ok(state.current_library()?.read_source_snapshot(&id)?)
}

#[tauri::command]
fn rename_deck(
    state: State<'_, DesktopState>,
    id: String,
    name: String,
) -> Result<DeckSummary, CommandError> {
    Ok(state.current_library()?.rename_deck(&id, &name)?)
}

#[tauri::command]
async fn delete_deck(
    app: AppHandle,
    state: State<'_, DesktopState>,
    id: String,
) -> Result<DeleteResult, CommandError> {
    let library = state.current_library()?;
    let deck_name = library.deck_summary(&id)?.name;
    let confirmed = app
        .dialog()
        .message(format!("Move ‘{deck_name}’ to the system Trash?"))
        .title("Move deck to Trash")
        .buttons(MessageDialogButtons::OkCancel)
        .blocking_show();
    if !confirmed {
        return Ok(DeleteResult { deleted: false });
    }
    library.delete_deck(&id)?;
    Ok(DeleteResult { deleted: true })
}

#[tauri::command]
fn read_library_config(state: State<'_, DesktopState>) -> Result<LibraryConfig, CommandError> {
    Ok(state.current_library()?.read_config()?)
}

#[tauri::command]
fn write_library_config(
    state: State<'_, DesktopState>,
    config: LibraryConfig,
) -> Result<(), CommandError> {
    state.current_library()?.write_config(&config)?;
    Ok(())
}

#[tauri::command]
async fn export_elef(
    app: AppHandle,
    state: State<'_, DesktopState>,
    id: String,
) -> Result<bool, CommandError> {
    let library = state.current_library()?;
    let deck = library.deck_summary(&id)?;
    let Some(selection) = app
        .dialog()
        .file()
        .set_title("Export Elef deck")
        .set_file_name(format!("{}.elef", deck.name))
        .add_filter("Elef deck", &["elef"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let mut destination = selection
        .into_path()
        .map_err(|_| CommandError::new("invalid_input", "Choose a local file.", false))?;
    match destination.extension().and_then(|value| value.to_str()) {
        None => {
            destination.set_extension("elef");
        }
        Some(extension) if extension.eq_ignore_ascii_case("elef") => {}
        Some(_) => {
            return Err(CommandError::new(
                "invalid_input",
                "The exported deck must use the .elef extension.",
                false,
            ));
        }
    }
    write_elef_archive(&library, &id, &destination)?;
    Ok(true)
}

#[tauri::command]
async fn import_elef(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<Option<ImportResult>, CommandError> {
    let Some(selection) = app
        .dialog()
        .file()
        .set_title("Import Elef deck")
        .add_filter("Elef deck", &["elef"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let archive_path = selection
        .into_path()
        .map_err(|_| CommandError::new("invalid_input", "Choose a local file.", false))?;
    let library = state.current_library()?;
    import_archive(&state, &library, archive_path)
}

#[tauri::command]
fn import_opened_elef(
    state: State<'_, DesktopState>,
) -> Result<Option<ImportResult>, CommandError> {
    if state
        .open_files
        .lock()
        .expect("opened file queue poisoned")
        .is_empty()
    {
        return Ok(None);
    }
    let library = state.current_library()?;
    let archive_path = state
        .open_files
        .lock()
        .expect("opened file queue poisoned")
        .pop_front();
    let Some(archive_path) = archive_path else {
        return Ok(None);
    };
    if state
        .pending_import
        .lock()
        .expect("pending import lock poisoned")
        .is_some()
    {
        state
            .open_files
            .lock()
            .expect("opened file queue poisoned")
            .push_front(archive_path);
        return Ok(None);
    }
    import_archive(&state, &library, archive_path)
}

#[tauri::command]
fn pending_open_elef_count(state: State<'_, DesktopState>) -> usize {
    state
        .open_files
        .lock()
        .expect("opened file queue poisoned")
        .len()
}

fn import_archive(
    state: &DesktopState,
    library: &Library,
    archive_path: PathBuf,
) -> Result<Option<ImportResult>, CommandError> {
    match library.import_elef(&archive_path, None) {
        Ok(result) => Ok(Some(result)),
        Err(error @ CoreError::ImportConflict { .. }) => {
            *state
                .pending_import
                .lock()
                .expect("pending import lock poisoned") = Some(archive_path);
            Err(error.into())
        }
        Err(error) => Err(error.into()),
    }
}

#[tauri::command]
async fn resolve_import_conflict(
    app: AppHandle,
    state: State<'_, DesktopState>,
    resolution: String,
) -> Result<Option<ImportResult>, CommandError> {
    if resolution == "cancel" {
        state
            .pending_import
            .lock()
            .expect("pending import lock poisoned")
            .take();
        return Ok(None);
    }
    let choice = match resolution.as_str() {
        "replace" => ImportResolution::Replace,
        "keep_both" => ImportResolution::KeepBoth,
        _ => {
            return Err(CommandError::new(
                "invalid_input",
                "Choose replace, keep both, or cancel.",
                false,
            ));
        }
    };
    let archive_path = state
        .pending_import
        .lock()
        .expect("pending import lock poisoned")
        .take()
        .ok_or_else(|| {
            CommandError::new(
                "not_found",
                "There is no import waiting for a choice.",
                false,
            )
        })?;
    let library = state.current_library()?;
    if choice == ImportResolution::Replace {
        let preview = match library.import_elef(&archive_path, None) {
            Err(CoreError::ImportConflict { existing_name, .. }) => existing_name,
            Ok(_) => {
                return Err(CommandError::new(
                    "invalid_input",
                    "The archive no longer conflicts with a deck in this library.",
                    false,
                ));
            }
            Err(error) => return Err(error.into()),
        };
        let confirmed = app
            .dialog()
            .message(format!(
                "Move “{preview}” to the system Trash and replace it with the imported deck?"
            ))
            .title("Replace existing deck")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancel)
            .blocking_show();
        if !confirmed {
            return Ok(None);
        }
    }
    Ok(Some(library.import_elef(&archive_path, Some(choice))?))
}

fn write_elef_archive(
    library: &Library,
    deck_id: &str,
    destination: &Path,
) -> Result<(), CommandError> {
    let parent = destination.parent().ok_or_else(|| {
        CommandError::new("path_rejected", "Choose a valid export folder.", false)
    })?;
    let parent = fs::canonicalize(parent)
        .map_err(|_| CommandError::new("path_rejected", "Choose a valid export folder.", false))?;
    let file_name = destination.file_name().ok_or_else(|| {
        CommandError::new("path_rejected", "Choose a valid export file name.", false)
    })?;
    let destination = parent.join(file_name);
    if let Ok(metadata) = fs::symlink_metadata(&destination)
        && (metadata.file_type().is_symlink() || !metadata.is_file())
    {
        return Err(CommandError::new(
            "path_rejected",
            "The selected export destination is not a regular file.",
            false,
        ));
    }
    let mut temporary = tempfile::Builder::new()
        .prefix(".elef-export-")
        .suffix(".tmp")
        .tempfile_in(&parent)
        .map_err(CoreError::Io)?;
    library.export_elef(deck_id, &mut temporary)?;
    temporary.as_file().sync_all().map_err(CoreError::Io)?;
    temporary
        .persist(&destination)
        .map_err(|error| CoreError::Io(error.error))?;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(CoreError::Io)?;
    Ok(())
}

#[tauri::command]
fn save_source(
    state: State<'_, DesktopState>,
    id: String,
    source: String,
    base_hash: String,
) -> Result<SaveResult, CommandError> {
    Ok(state
        .current_library()?
        .save_source(&id, &source, &base_hash)?)
}

fn persisted_root_path(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(app.path().app_data_dir()?.join("library-root.json"))
}

fn persist_library_root(app: &AppHandle, root: &str) -> Result<(), CommandError> {
    let path = persisted_root_path(app).map_err(|_| {
        CommandError::new("io_error", "Could not store the library preference.", true)
    })?;
    let parent = path.parent().ok_or_else(|| {
        CommandError::new("io_error", "Could not store the library preference.", true)
    })?;
    fs::create_dir_all(parent).map_err(|_| {
        CommandError::new("io_error", "Could not store the library preference.", true)
    })?;
    let bytes = serde_json::to_vec(&serde_json::json!({ "library_root": root })).map_err(|_| {
        CommandError::new("internal", "Could not store the library preference.", false)
    })?;
    fs::write(path, bytes)
        .map_err(|_| CommandError::new("io_error", "Could not store the library preference.", true))
}

fn restore_library_root(app: &AppHandle, state: &DesktopState) {
    let Ok(path) = persisted_root_path(app) else {
        return;
    };
    let Ok(bytes) = fs::read(path) else {
        return;
    };
    let Ok(config) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return;
    };
    let Some(root) = config
        .get("library_root")
        .and_then(serde_json::Value::as_str)
    else {
        return;
    };
    let _ = state.use_library(PathBuf::from(root));
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = MenuItem::with_id(app, "about", "About Elef", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
    let application_menu = Submenu::with_items(app, "Elef", true, &[&about, &settings])?;

    let open_deck = MenuItem::with_id(app, "open-deck", "Open Deck…", true, Some("CmdOrCtrl+O"))?;
    let open_library =
        MenuItem::with_id(app, "choose-library", "Choose Library…", true, None::<&str>)?;
    let new_presentation = MenuItem::with_id(
        app,
        "new-presentation",
        "New Presentation",
        true,
        Some("CmdOrCtrl+N"),
    )?;
    let new_document = MenuItem::with_id(app, "new-document", "New Document", true, None::<&str>)?;
    let save = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
    let export = MenuItem::with_id(app, "export-elef", "Export Deck…", true, None::<&str>)?;
    let import = MenuItem::with_id(app, "import-elef", "Import .elef…", true, None::<&str>)?;
    let print = MenuItem::with_id(app, "print", "Print…", true, Some("CmdOrCtrl+P"))?;
    let file_separator = PredefinedMenuItem::separator(app)?;
    let quit = PredefinedMenuItem::quit(app, None)?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &open_deck,
            &open_library,
            &new_presentation,
            &new_document,
            &save,
            &export,
            &import,
            &print,
            &file_separator,
            &quit,
        ],
    )?;

    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let edit_separator = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &undo,
            &redo,
            &edit_separator,
            &cut,
            &copy,
            &paste,
            &select_all,
        ],
    )?;

    let fullscreen = PredefinedMenuItem::fullscreen(app, None)?;
    let show_library = MenuItem::with_id(app, "open-deck", "Show Library", true, None::<&str>)?;
    let refresh_library = MenuItem::with_id(
        app,
        "refresh-library",
        "Refresh Library",
        true,
        None::<&str>,
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[&fullscreen, &show_library, &refresh_library],
    )?;
    let present = MenuItem::with_id(
        app,
        "start-presentation",
        "Start Presentation",
        false,
        None::<&str>,
    )?;
    let presentation = Submenu::with_items(app, "Presentation", true, &[&present])?;
    let minimize = PredefinedMenuItem::minimize(app, None)?;
    let close = PredefinedMenuItem::close_window(app, None)?;
    let window = Submenu::with_items(app, "Window", true, &[&minimize, &close])?;
    let check_updates = MenuItem::with_id(
        app,
        "check-for-updates",
        "Check for Updates…",
        true,
        None::<&str>,
    )?;
    let help = if cfg!(target_os = "macos") {
        Submenu::with_items(app, "Help", true, &[&check_updates])?
    } else {
        Submenu::with_items(app, "Help", true, &[&about, &settings, &check_updates])?
    };

    let menu = if cfg!(target_os = "macos") {
        Menu::with_items(
            app,
            &[
                &application_menu,
                &file,
                &edit,
                &view,
                &presentation,
                &window,
                &help,
            ],
        )?
    } else {
        Menu::with_items(app, &[&file, &edit, &view, &presentation, &window, &help])?
    };
    Ok(menu)
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            let state = app.state::<DesktopState>();
            let added = queue_cli_files(&state, argv, &cwd);
            if added > 0 {
                let _ = app.emit("desktop-open-elef", ());
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            restore_library_root(app.handle(), &app.state::<DesktopState>());
            app.set_menu(build_menu(app.handle())?)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                "open-deck" | "refresh-library" | "save" | "export-elef" | "import-elef"
                | "print" | "settings" | "check-for-updates" => {
                    let _ = app.emit("desktop-menu-action", id);
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
        .invoke_handler(tauri::generate_handler![
            choose_library_root,
            get_library_status,
            read_library_config,
            write_library_config,
            list_decks,
            create_deck,
            open_deck,
            read_source_snapshot,
            rename_deck,
            delete_deck,
            save_source,
            export_elef,
            import_elef,
            import_opened_elef,
            pending_open_elef_count,
            resolve_import_conflict,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Elef Desktop");

    app.run(|app, event| {
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
        args.into_iter().skip(1).map(|argument| {
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
    fn conflict_errors_have_the_adapter_shape_and_preserve_current_source() {
        let error = CommandError::from(CoreError::Conflict {
            disk_hash: "a".repeat(64),
            disk_source: "outside edit".into(),
            disk_source_file: "presentation.md".into(),
        });
        let value = serde_json::to_value(error).unwrap();
        assert_eq!(value["code"], "conflict");
        assert_eq!(value["retryable"], false);
        assert_eq!(value["details"]["current"]["source"], "outside edit");
        assert_eq!(
            value["details"]["current"]["source_file"],
            "presentation.md"
        );
    }
}
