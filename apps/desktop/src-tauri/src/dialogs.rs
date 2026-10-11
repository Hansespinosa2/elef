use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::error::CommandError;

pub(crate) async fn confirm_native_action(
    app: &AppHandle,
    message: String,
    title: &str,
    kind: MessageDialogKind,
) -> Result<bool, CommandError> {
    let parent = app.get_webview_window("main").ok_or_else(|| {
        CommandError::new(
            "not_found",
            "Open the application before confirming this action.",
            false,
        )
    })?;
    // A parent keeps macOS confirmations in Elef's own window rather than a
    // global CFUserNotification. Never block the UI or async executor thread.
    let dialog = app
        .dialog()
        .message(message)
        .title(title)
        .kind(kind)
        .parent(&parent)
        .buttons(MessageDialogButtons::OkCancel);
    tauri::async_runtime::spawn_blocking(move || dialog.blocking_show())
        .await
        .map_err(|_| CommandError::new("internal", "The confirmation could not be opened.", true))
}
