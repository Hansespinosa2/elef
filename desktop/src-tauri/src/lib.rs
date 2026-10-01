use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use elef_core::{CoreError, DeckSummary, Library, OpenDeck, SaveResult};
use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

#[derive(Default)]
struct DesktopState {
    library: RwLock<Option<Arc<Library>>>,
    root: RwLock<Option<PathBuf>>,
}

impl DesktopState {
    fn use_library(&self, path: PathBuf) -> Result<LibraryStatus, CommandError> {
        let library = Arc::new(Library::open(path)?);
        let decks = library.list_decks()?;
        let root = library.root().to_path_buf();
        *self.library.write().expect("library state lock poisoned") = Some(library);
        *self.root.write().expect("root state lock poisoned") = Some(root.clone());
        Ok(LibraryStatus {
            root: root.to_string_lossy().into_owned(),
            decks,
        })
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
}

impl From<CoreError> for CommandError {
    fn from(error: CoreError) -> Self {
        match error {
            CoreError::Conflict {
                disk_hash,
                disk_source,
            } => Self {
                code: "conflict",
                message: "The file changed outside Elef. Review the current version before saving."
                    .into(),
                retryable: false,
                details: Some(serde_json::json!({
                    "disk_hash": disk_hash,
                    "current": { "source": disk_source }
                })),
            },
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
    let decks = state.current_library()?.list_decks()?;
    Ok(Some(LibraryStatus {
        root: root.to_string_lossy().into_owned(),
        decks,
    }))
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
    let deck_name = library
        .list_decks()?
        .into_iter()
        .find(|deck| deck.id == id)
        .map(|deck| deck.name)
        .ok_or_else(|| CommandError::new("not_found", "The deck no longer exists.", false))?;
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
    let file_separator = PredefinedMenuItem::separator(app)?;
    let quit = PredefinedMenuItem::quit(app, None)?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &open_library,
            &new_presentation,
            &new_document,
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
    let view = Submenu::with_items(app, "View", true, &[&fullscreen])?;
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
    let about = MenuItem::with_id(app, "about", "About Elef", true, None::<&str>)?;
    let help = Submenu::with_items(app, "Help", true, &[&about])?;

    let menu = Menu::with_items(app, &[&file, &edit, &view, &presentation, &window, &help])?;
    Ok(menu)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .manage(DesktopState::default())
        .setup(|app| {
            restore_library_root(app.handle(), &app.state::<DesktopState>());
            app.set_menu(build_menu(app.handle())?)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
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
            list_decks,
            create_deck,
            open_deck,
            rename_deck,
            delete_deck,
            save_source,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Elef Desktop");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conflict_errors_have_the_adapter_shape_and_preserve_current_source() {
        let error = CommandError::from(CoreError::Conflict {
            disk_hash: "a".repeat(64),
            disk_source: "outside edit".into(),
        });
        let value = serde_json::to_value(error).unwrap();
        assert_eq!(value["code"], "conflict");
        assert_eq!(value["retryable"], false);
        assert_eq!(value["details"]["current"]["source"], "outside edit");
    }
}
