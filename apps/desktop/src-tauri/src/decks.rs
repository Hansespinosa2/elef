use local_store::{
    DeckPreview, DeckSummary, DocumentGraphDocument, FileEvent, MergeOutcome, OpenDeck,
    RestoreOutcome, SaveResult, SnapshotInfo, SourceSnapshot,
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
pub(crate) fn list_decks(state: State<'_, DesktopState>) -> Result<Vec<DeckSummary>, CommandError> {
    Ok(state.current_library()?.list_decks()?)
}

#[tauri::command]
pub(crate) fn document_graph(
    state: State<'_, DesktopState>,
) -> Result<Vec<DocumentGraphDocument>, CommandError> {
    Ok(state.current_library()?.document_graph()?)
}

#[tauri::command]
pub(crate) fn create_deck(
    state: State<'_, DesktopState>,
    name: String,
    kind: String,
) -> Result<OpenDeck, CommandError> {
    Ok(state.current_library()?.create_deck(&name, &kind)?)
}

#[tauri::command]
pub(crate) fn open_deck(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<OpenDeck, CommandError> {
    Ok(state.current_library()?.open_deck(&id)?)
}

#[tauri::command]
pub(crate) fn read_deck_preview(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<DeckPreview, CommandError> {
    Ok(state.current_library()?.read_deck_preview(&id)?)
}

#[tauri::command]
pub(crate) fn read_source_snapshot(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<SourceSnapshot, CommandError> {
    Ok(state.current_library()?.read_source_snapshot(&id)?)
}

#[tauri::command]
pub(crate) fn rename_deck(
    state: State<'_, DesktopState>,
    id: String,
    name: String,
) -> Result<DeckSummary, CommandError> {
    Ok(state.current_library()?.rename_deck(&id, &name)?)
}

#[tauri::command]
pub(crate) async fn delete_deck(
    app: AppHandle,
    state: State<'_, DesktopState>,
    id: String,
) -> Result<DeleteResult, CommandError> {
    let library = state.current_library()?;
    let deck_name = library.deck_summary(&id)?.name;
    let confirmed = confirm_native_action(
        &app,
        format!("Move ‘{deck_name}’ to the system Trash?"),
        "Move deck to Trash",
        MessageDialogKind::Warning,
    )
    .await?;
    if !confirmed {
        return Ok(DeleteResult { deleted: false });
    }
    library.delete_deck(&id)?;
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
