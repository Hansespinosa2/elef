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

fn read_persisted_library_root(path: &Path) -> Option<PathBuf> {
    let bytes = fs::read(path).ok()?;
    let config = serde_json::from_slice::<serde_json::Value>(&bytes).ok()?;
    let root = config.get("library_root")?.as_str()?;
    Some(PathBuf::from(root))
}

pub(crate) fn restore_library_root(app: &AppHandle, state: &DesktopState) {
    let Ok(path) = persisted_root_path(app) else {
        return;
    };
    let Some(root) = read_persisted_library_root(&path) else {
        return;
    };
    let _ = state.use_library(root);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pre_release_app_state_fixture_restores_existing_library_without_resetting_selection() {
        const LIBRARY_ROOT_TOKEN: &str = "${ELEF_RELEASE_FIXTURE_LIBRARY_ROOT}";
        const LEGACY_WORK_ID: &str = "550e8400-e29b-41d4-a716-446655440000";
        let fixture_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../apps/web/test/fixtures/desktop/release/pre-release-app-state");
        let temp = tempfile::tempdir().expect("create isolated legacy app-state fixture");
        let library_root = temp.path().join("Selected library");
        let legacy_work = library_root.join("Legacy presentation");
        fs::create_dir_all(&legacy_work).expect("create fixture work directory");
        fs::copy(
            fixture_root.join("Selected library/Legacy presentation/presentation.md"),
            legacy_work.join("presentation.md"),
        )
        .expect("copy legacy presentation source");
        fs::copy(
            fixture_root.join("Selected library/Legacy presentation/elef.json"),
            legacy_work.join("elef.json"),
        )
        .expect("copy legacy work identity");

        let app_data_dir = temp.path().join("com.elef.desktop");
        fs::create_dir_all(&app_data_dir).expect("create Stable app-data fixture");
        let state_path = app_data_dir.join("library-root.json");
        let template = fs::read_to_string(fixture_root.join("library-root.json.template"))
            .expect("read pre-release Stable state template");
        assert!(template.contains(LIBRARY_ROOT_TOKEN));
        let serialized_state =
            template.replace(LIBRARY_ROOT_TOKEN, &library_root.to_string_lossy());
        fs::write(&state_path, serialized_state.as_bytes()).expect("seed pre-release Stable state");

        let restored_root = read_persisted_library_root(&state_path)
            .expect("restore the existing selected-library preference");
        assert_eq!(restored_root, library_root);
        let state = DesktopState::default();
        state
            .use_library(restored_root.clone())
            .expect("open the library selected by the previous Stable release");
        let canonical_library_root =
            fs::canonicalize(&library_root).expect("canonicalize the opened library root");
        assert_eq!(
            state
                .root
                .read()
                .expect("read selected library root")
                .as_ref(),
            Some(&canonical_library_root)
        );
        let library = state.current_library().expect("restored library is active");
        let work = library
            .open_work_folder(LEGACY_WORK_ID)
            .expect("open the existing presentation without migrating its identity");
        let expected_source = fs::read_to_string(
            fixture_root.join("Selected library/Legacy presentation/presentation.md"),
        )
        .expect("read expected presentation source");
        assert_eq!(work.source, expected_source);
        assert_eq!(
            fs::read(&state_path).expect("read persisted selection after launch"),
            serialized_state.as_bytes(),
            "launch must not reset or rewrite the existing app-state file"
        );
    }
}
