use std::fs;
use std::path::{Path, PathBuf};

use local_store::{AuthoringRegistries, Library, LibraryConfig, WorkFolderSummary};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::error::CommandError;
use crate::state::DesktopState;

#[derive(Debug, Serialize)]
pub(crate) struct LibraryStatus {
    root: String,
    work_folders: Vec<WorkFolderSummary>,
    config: LibraryConfig,
    config_notice: Option<String>,
}

pub(crate) fn library_status(
    library: &Library,
    root: &Path,
) -> Result<LibraryStatus, CommandError> {
    let (config, config_notice) = match library.read_config() {
        Ok(config) => (config, None),
        Err(_) => (
            LibraryConfig::default(),
            Some("Library settings could not be read; defaults are in use.".into()),
        ),
    };
    Ok(LibraryStatus {
        root: root.to_string_lossy().into_owned(),
        work_folders: library.list_work_folders()?,
        config,
        config_notice,
    })
}
#[derive(Debug, Serialize)]
pub(crate) struct AuthoringRegistryWriteResult {
    content_hash: String,
}

#[tauri::command]
pub(crate) async fn choose_library_root(
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
pub(crate) fn get_library_status(
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
pub(crate) fn read_library_config(
    state: State<'_, DesktopState>,
) -> Result<LibraryConfig, CommandError> {
    Ok(state.current_library()?.read_config()?)
}

#[tauri::command]
pub(crate) fn write_library_config(
    state: State<'_, DesktopState>,
    config: LibraryConfig,
) -> Result<(), CommandError> {
    state.current_library()?.write_config(&config)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn read_authoring_registries(
    state: State<'_, DesktopState>,
) -> Result<AuthoringRegistries, CommandError> {
    Ok(state.current_library()?.read_authoring_registries()?)
}

#[tauri::command]
pub(crate) fn write_authoring_registry(
    state: State<'_, DesktopState>,
    registry: String,
    entries: Vec<serde_json::Value>,
    base_hash: String,
) -> Result<AuthoringRegistryWriteResult, CommandError> {
    let content_hash = state
        .current_library()?
        .write_authoring_registry(&registry, &entries, &base_hash)?;
    Ok(AuthoringRegistryWriteResult { content_hash })
}
fn persisted_root_path(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(app.path().app_data_dir()?.join("library-root.json"))
}

pub(crate) fn persist_library_root(app: &AppHandle, root: &str) -> Result<(), CommandError> {
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

pub(crate) fn restore_library_root(app: &AppHandle, state: &DesktopState) {
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
