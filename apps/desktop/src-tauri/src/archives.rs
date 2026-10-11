use std::fs::{self, File};
use std::path::{Path, PathBuf};

use local_store::diagnostics::EventCode;
use local_store::{CoreError, ImportResolution, ImportResult, Library};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::diagnostics::{record_bool_command_result, record_command_result};
use crate::dialogs::confirm_native_action;
use crate::error::CommandError;
use crate::state::{
    DesktopState, PendingImport, discard_pending_import, store_pending_import, take_pending_import,
};

async fn export_elef_impl(
    app: AppHandle,
    state: State<'_, DesktopState>,
    id: String,
    use_native_dialog: bool,
) -> Result<bool, CommandError> {
    let result = export_elef_inner(&app, state, id, use_native_dialog).await;
    record_bool_command_result(&app, EventCode::Export, &result);
    result
}

async fn export_elef_inner(
    app: &AppHandle,
    state: State<'_, DesktopState>,
    id: String,
    use_native_dialog: bool,
) -> Result<bool, CommandError> {
    let library = state.current_library()?;
    let work_folder = library.work_folder_summary(&id)?;
    #[cfg(feature = "webdriver")]
    if !use_native_dialog && let Some(destination) = std::env::var_os("ELEF_E2E_EXPORT_PATH") {
        export_elef_to_path(&library, &id, PathBuf::from(destination))?;
        return Ok(true);
    }
    #[cfg(not(feature = "webdriver"))]
    let _ = use_native_dialog;
    let Some(selection) = app
        .dialog()
        .file()
        .set_title("Export Elef Work")
        .set_file_name(format!("{}.elef", work_folder.name))
        .add_filter("Elef Work", &["elef"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let destination = selection
        .into_path()
        .map_err(|_| CommandError::new("invalid_input", "Choose a local file.", false))?;
    export_elef_to_path(&library, &id, destination)?;
    Ok(true)
}

#[cfg(feature = "webdriver")]
#[tauri::command]
pub(crate) async fn export_elef(
    app: AppHandle,
    state: State<'_, DesktopState>,
    id: String,
    use_native_dialog: Option<bool>,
) -> Result<bool, CommandError> {
    export_elef_impl(app, state, id, use_native_dialog.unwrap_or(false)).await
}

#[cfg(not(feature = "webdriver"))]
#[tauri::command]
pub(crate) async fn export_elef(
    app: AppHandle,
    state: State<'_, DesktopState>,
    id: String,
) -> Result<bool, CommandError> {
    export_elef_impl(app, state, id, false).await
}

fn export_elef_to_path(
    library: &Library,
    id: &str,
    mut destination: PathBuf,
) -> Result<(), CommandError> {
    match destination.extension().and_then(|value| value.to_str()) {
        None => {
            destination.set_extension("elef");
        }
        Some(extension) if extension.eq_ignore_ascii_case("elef") => {}
        Some(_) => {
            return Err(CommandError::new(
                "invalid_input",
                "The exported Work must use the .elef extension.",
                false,
            ));
        }
    }
    write_elef_archive(library, id, &destination)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn import_elef(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<Option<ImportResult>, CommandError> {
    let result = (|| {
        let Some(selection) = app
            .dialog()
            .file()
            .set_title("Import Elef Work")
            .add_filter("Elef Work", &["elef"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let archive_path = selection
            .into_path()
            .map_err(|_| CommandError::new("invalid_input", "Choose a local file.", false))?;
        let library = state.current_library()?;
        import_archive(&state, &library, archive_path, false)
    })();
    record_command_result(&app, EventCode::Import, &result);
    result
}

#[tauri::command]
pub(crate) fn import_opened_elef(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<Option<ImportResult>, CommandError> {
    let result = (|| {
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
        import_archive(&state, &library, archive_path, false)
    })();
    record_command_result(&app, EventCode::Import, &result);
    result
}

#[tauri::command]
pub(crate) fn pending_open_elef_count(state: State<'_, DesktopState>) -> usize {
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
    staged: bool,
) -> Result<Option<ImportResult>, CommandError> {
    match library.import_elef(&archive_path, None) {
        Ok(result) => Ok(Some(result)),
        Err(error @ CoreError::ImportConflict { .. }) => {
            store_pending_import(state, archive_path, staged);
            Err(error.into())
        }
        Err(error) => Err(error.into()),
    }
}

fn complete_pending_import(
    library: &Library,
    pending: &PendingImport,
    choice: ImportResolution,
) -> Result<Option<ImportResult>, CommandError> {
    let result = library.import_elef(&pending.path, Some(choice))?;
    discard_pending_import(pending);
    Ok(Some(result))
}

#[tauri::command]
pub(crate) async fn resolve_import_conflict(
    app: AppHandle,
    state: State<'_, DesktopState>,
    resolution: String,
) -> Result<Option<ImportResult>, CommandError> {
    let result = resolve_import_conflict_inner(&app, state, resolution).await;
    record_command_result(&app, EventCode::Import, &result);
    result
}

async fn resolve_import_conflict_inner(
    app: &AppHandle,
    state: State<'_, DesktopState>,
    resolution: String,
) -> Result<Option<ImportResult>, CommandError> {
    if resolution == "cancel" {
        if let Some(pending) = take_pending_import(&state) {
            discard_pending_import(&pending);
        }
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
    let pending = take_pending_import(&state).ok_or_else(|| {
        CommandError::new(
            "not_found",
            "There is no import waiting for a choice.",
            false,
        )
    })?;
    let library = state.current_library()?;
    if choice == ImportResolution::Replace {
        let preview = match library.import_elef(&pending.path, None) {
            Err(CoreError::ImportConflict { existing_name, .. }) => existing_name,
            Ok(_) => {
                return Err(CommandError::new(
                    "invalid_input",
                    "The archive no longer conflicts with a Work in this library.",
                    false,
                ));
            }
            Err(error) => return Err(error.into()),
        };
        let confirmed = confirm_native_action(
            app,
            format!("Move “{preview}” to the system Trash and replace it with the imported Work?"),
            "Replace existing Work",
            MessageDialogKind::Warning,
        )
        .await?;
        if !confirmed {
            discard_pending_import(&pending);
            return Ok(None);
        }
    }
    complete_pending_import(&library, &pending, choice)
}

fn write_elef_archive(
    library: &Library,
    work_id: &str,
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
    library.export_elef(work_id, &mut temporary)?;
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
pub(crate) fn import_elef_bytes(
    app: AppHandle,
    state: State<'_, DesktopState>,
    bytes: Vec<u8>,
) -> Result<Option<ImportResult>, CommandError> {
    let result = import_elef_bytes_impl(&state, &bytes);
    record_command_result(&app, EventCode::Import, &result);
    result
}

fn import_elef_bytes_impl(
    state: &DesktopState,
    bytes: &[u8],
) -> Result<Option<ImportResult>, CommandError> {
    if bytes.is_empty() {
        return Err(CommandError::new(
            "invalid_input",
            "Choose an .elef archive to import.",
            false,
        ));
    }
    let staged = tempfile::Builder::new()
        .prefix("elef-import-")
        .suffix(".elef")
        .tempfile()
        .map_err(|_| CommandError::new("io_error", "The archive could not be staged.", true))?;
    std::io::Write::write_all(&mut &staged, bytes)
        .map_err(|_| CommandError::new("io_error", "The archive could not be staged.", true))?;
    let path = staged
        .into_temp_path()
        .keep()
        .map_err(|_| CommandError::new("io_error", "The archive could not be staged.", true))?;
    let library = state.current_library()?;
    let result = import_archive(state, &library, path.clone(), true);
    // A conflict stores the staged archive as the pending import, so the
    // file must survive until the conflict is resolved or cancelled.
    let pending_mine = state
        .pending_import
        .lock()
        .expect("pending import lock poisoned")
        .as_ref()
        .is_some_and(|pending| pending.path == path);
    if !pending_mine {
        let _ = fs::remove_file(&path);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staged_bytes_import_survives_conflict_until_keep_both_resolution() {
        use std::io::Cursor;
        let temp = tempfile::TempDir::new().unwrap();
        let root = temp.path().join("library");
        fs::create_dir(&root).unwrap();
        let state = DesktopState::default();
        state.use_library(root).unwrap();
        let library = state.current_library().unwrap();
        let work_folder = library.create_work_folder("Transfer", "document").unwrap();
        let mut archive = Cursor::new(Vec::new());
        library.export_elef(&work_folder.id, &mut archive).unwrap();
        let bytes = archive.into_inner();
        assert!(!bytes.is_empty());

        // The work folder is still present, so the byte import conflicts and the
        // staged archive becomes the pending import.
        let error = import_elef_bytes_impl(&state, &bytes).unwrap_err();
        assert_eq!(error.code, "import_conflict");
        let staged = take_pending_import(&state).expect("conflict stays pending");
        assert!(staged.staged);
        assert!(staged.path.exists());

        // Resolving through the real completion path re-imports the staged
        // archive instead of failing on the deleted file, then cleans up.
        // Byte imports carry no work-folder-name metadata, so keep_both mints a
        // fresh identity under the staged file's stem, not a name collision.
        let resolved = complete_pending_import(&library, &staged, ImportResolution::KeepBoth)
            .unwrap()
            .unwrap();
        assert_ne!(resolved.work_folder.id, work_folder.id);
        let reread = library.open_work_folder(&resolved.work_folder.id).unwrap();
        assert!(reread.source.contains("# Transfer"));
        assert!(!staged.path.exists());
        assert!(take_pending_import(&state).is_none());
    }
}
