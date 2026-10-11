use local_store::{
    DocumentGraphDocument, FileEvent, MergeOutcome, OpenWorkFolder, RestoreOutcome, SaveResult,
    SnapshotInfo, SourceSnapshot, WorkFolderPreview, WorkFolderSummary,
};
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::MessageDialogKind;

use crate::dialogs::confirm_native_action;
use crate::error::CommandError;
use crate::state::DesktopState;

#[derive(Debug, Serialize)]
pub(crate) struct DeleteResult {
    deleted: bool,
}
#[tauri::command]
pub(crate) fn list_work_folders(
    state: State<'_, DesktopState>,
) -> Result<Vec<WorkFolderSummary>, CommandError> {
    Ok(state.current_library()?.list_work_folders()?)
}

#[tauri::command]
pub(crate) fn document_graph(
    state: State<'_, DesktopState>,
) -> Result<Vec<DocumentGraphDocument>, CommandError> {
    Ok(state.current_library()?.document_graph()?)
}

#[tauri::command]
pub(crate) fn create_work_folder(
    state: State<'_, DesktopState>,
    name: String,
    kind: String,
) -> Result<OpenWorkFolder, CommandError> {
    Ok(state.current_library()?.create_work_folder(&name, &kind)?)
}

#[tauri::command]
pub(crate) fn open_work_folder(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<OpenWorkFolder, CommandError> {
    Ok(state.current_library()?.open_work_folder(&id)?)
}

#[tauri::command]
pub(crate) fn read_work_folder_preview(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<WorkFolderPreview, CommandError> {
    Ok(state.current_library()?.read_work_folder_preview(&id)?)
}

#[tauri::command]
pub(crate) fn read_source_snapshot(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<SourceSnapshot, CommandError> {
    Ok(state.current_library()?.read_source_snapshot(&id)?)
}

#[tauri::command]
pub(crate) fn rename_work_folder(
    state: State<'_, DesktopState>,
    id: String,
    name: String,
) -> Result<WorkFolderSummary, CommandError> {
    Ok(state.current_library()?.rename_work_folder(&id, &name)?)
}

#[tauri::command]
pub(crate) async fn delete_work_folder(
    app: AppHandle,
    state: State<'_, DesktopState>,
    id: String,
) -> Result<DeleteResult, CommandError> {
    let library = state.current_library()?;
    let work_folder_name = library.work_folder_summary(&id)?.name;
    let confirmed = confirm_native_action(
        &app,
        format!("Move ‘{work_folder_name}’ to the system Trash?"),
        "Move Work to Trash",
        MessageDialogKind::Warning,
    )
    .await?;
    if !confirmed {
        return Ok(DeleteResult { deleted: false });
    }
    library.delete_work_folder(&id)?;
    Ok(DeleteResult { deleted: true })
}

#[tauri::command]
pub(crate) async fn confirm_discard_unsaved_changes(app: AppHandle) -> Result<bool, CommandError> {
    confirm_native_action(
        &app,
        "Elef could not save your latest edits. Quit without saving them?".into(),
        "Quit Without Saving",
        MessageDialogKind::Warning,
    )
    .await
}
#[tauri::command]
pub(crate) fn save_source(
    state: State<'_, DesktopState>,
    id: String,
    source: String,
    base_hash: String,
) -> Result<SaveResult, CommandError> {
    Ok(state
        .current_library()?
        .save_source(&id, &source, &base_hash)?)
}

#[tauri::command]
pub(crate) fn poll_file_events(
    state: State<'_, DesktopState>,
) -> Result<Vec<FileEvent>, CommandError> {
    Ok(state.current_library()?.poll_file_events())
}

#[tauri::command]
pub(crate) fn take_snapshot(
    state: State<'_, DesktopState>,
    id: String,
    reason: String,
    source: Option<String>,
) -> Result<SnapshotInfo, CommandError> {
    Ok(state
        .current_library()?
        .take_snapshot(&id, &reason, source.as_deref())?)
}

#[tauri::command]
pub(crate) fn list_snapshots(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<Vec<SnapshotInfo>, CommandError> {
    Ok(state.current_library()?.list_snapshots(&id)?)
}

#[tauri::command]
pub(crate) fn restore_snapshot(
    state: State<'_, DesktopState>,
    id: String,
    snapshot_id: String,
) -> Result<RestoreOutcome, CommandError> {
    Ok(state
        .current_library()?
        .restore_snapshot(&id, &snapshot_id)?)
}

#[tauri::command]
pub(crate) fn merge_external_change(
    state: State<'_, DesktopState>,
    id: String,
    local_source: String,
) -> Result<MergeOutcome, CommandError> {
    Ok(state
        .current_library()?
        .merge_external_change(&id, &local_source)?)
}
