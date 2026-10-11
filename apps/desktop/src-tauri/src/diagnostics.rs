#[cfg(feature = "webdriver")]
use std::path::PathBuf;

use local_store::diagnostics::{DiagnosticEvent, EventCode, EventProfile, EventResult};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::error::CommandError;

pub(crate) fn record_diagnostic(
    app: &AppHandle,
    event_code: EventCode,
    result: EventResult,
    error_code: Option<&str>,
) {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    let event = DiagnosticEvent::new(event_code, result, error_code, event_profile());
    let _ = local_store::diagnostics::append_event(&data_dir.join("logs"), &event);
}

// TODO(slice-A): return Dev under the desktop-dev feature once the
// Stable/Dev profile split lands. Every current build is Stable-equivalent.
fn event_profile() -> EventProfile {
    EventProfile::Stable
}

pub(crate) fn record_command_result<T>(
    app: &AppHandle,
    event_code: EventCode,
    result: &Result<T, CommandError>,
) {
    match result {
        Ok(_) => record_diagnostic(app, event_code, EventResult::Success, None),
        Err(error) => record_diagnostic(app, event_code, EventResult::Failure, Some(error.code)),
    }
}

pub(crate) fn record_bool_command_result(
    app: &AppHandle,
    event_code: EventCode,
    result: &Result<bool, CommandError>,
) {
    match result {
        Ok(true) => record_diagnostic(app, event_code, EventResult::Success, None),
        Ok(false) => record_diagnostic(app, event_code, EventResult::Deferred, None),
        Err(error) => record_diagnostic(app, event_code, EventResult::Failure, Some(error.code)),
    }
}

#[tauri::command]
pub(crate) fn record_preview_failure(app: AppHandle) {
    record_diagnostic(
        &app,
        EventCode::Render,
        EventResult::Failure,
        Some("internal"),
    );
}

#[tauri::command]
pub(crate) fn record_bootstrap_failure(app: AppHandle) {
    record_diagnostic(
        &app,
        EventCode::Startup,
        EventResult::Failure,
        Some("internal"),
    );
}

#[tauri::command]
pub(crate) async fn export_diagnostics(app: AppHandle) -> Result<bool, CommandError> {
    let result = export_diagnostics_inner(&app).await;
    record_bool_command_result(&app, EventCode::DiagnosticsExport, &result);
    result
}

async fn export_diagnostics_inner(app: &AppHandle) -> Result<bool, CommandError> {
    let Some(selection) = app
        .dialog()
        .file()
        .set_title("Export Elef Diagnostics")
        .set_file_name("elef-diagnostics.zip")
        .add_filter("ZIP archive", &["zip"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let destination = selection
        .into_path()
        .map_err(|_| CommandError::new("invalid_input", "Choose a local file.", false))?;
    let log_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| CommandError::new("io_error", "Diagnostics are unavailable.", true))?
        .join("logs");
    tauri::async_runtime::spawn_blocking(move || {
        local_store::diagnostics::export_diagnostics(&log_dir, &destination)
            .map_err(|_| CommandError::new("io_error", "Diagnostics could not be exported.", true))
    })
    .await
    .map_err(|_| CommandError::new("internal", "Diagnostics could not be exported.", true))??;
    Ok(true)
}

/// Test-only path that exercises the real diagnostics writer and ZIP exporter
/// without opening a native save panel. It is compiled only in WebDriver builds.
#[cfg(feature = "webdriver")]
#[tauri::command]
pub(crate) async fn export_diagnostics_fixture(app: AppHandle) -> Result<bool, CommandError> {
    let result = export_diagnostics_fixture_inner(&app).await;
    record_bool_command_result(&app, EventCode::DiagnosticsExport, &result);
    result
}

#[cfg(feature = "webdriver")]
async fn export_diagnostics_fixture_inner(app: &AppHandle) -> Result<bool, CommandError> {
    let destination = std::env::var_os("ELEF_E2E_DIAGNOSTICS_EXPORT_PATH")
        .map(PathBuf::from)
        .ok_or_else(|| {
            CommandError::new(
                "invalid_input",
                "Diagnostics export fixture is unavailable.",
                false,
            )
        })?;
    let log_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| CommandError::new("io_error", "Diagnostics are unavailable.", true))?
        .join("logs");
    let hostile_failure: Result<(), CommandError> = Err(CommandError::with_details(
        "ELF_PRIVACY_EXCEPTION_94A72C",
        "ELF_PRIVACY_SOURCE_7F1E9B",
        true,
        serde_json::json!({
            "title": "ELF_PRIVACY_TITLE_2D83AC",
            "filename": "ELF_PRIVACY_FILENAME_9130DE",
            "path": "/tmp/ELF_PRIVACY_PATH_6C4A20",
            "token": "ELF_PRIVACY_TOKEN_0B7F11",
            "secret": "ELF_PRIVACY_SECRET_E35D92",
            "ipc_payload": "ELF_PRIVACY_IPC_118F05"
        }),
    ));
    record_command_result(app, EventCode::Save, &hostile_failure);
    let import_failure: Result<(), CommandError> = Err(CommandError::new(
        "io_error",
        "The import fixture is unavailable.",
        true,
    ));
    record_command_result(app, EventCode::Import, &import_failure);
    let profile = event_profile();
    let exported = tauri::async_runtime::spawn_blocking(move || -> std::io::Result<()> {
        let sentinels: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../apps/web/test/fixtures/desktop/release/redaction-sentinels.json"
        ))
        .map_err(|_| std::io::Error::other("diagnostics fixture is invalid"))?;
        let fields = sentinels
            .as_object()
            .ok_or_else(|| std::io::Error::other("diagnostics fixture is invalid"))?;
        for value in fields.values() {
            let sentinel = value
                .as_str()
                .ok_or_else(|| std::io::Error::other("diagnostics fixture is invalid"))?;
            let event = DiagnosticEvent::new(
                EventCode::Save,
                EventResult::Failure,
                Some(sentinel),
                profile,
            );
            local_store::diagnostics::append_event(&log_dir, &event)?;
        }
        local_store::diagnostics::export_diagnostics(&log_dir, &destination)
    })
    .await
    .map_err(|_| CommandError::new("internal", "Diagnostics could not be exported.", true))?;
    exported
        .map_err(|_| CommandError::new("io_error", "Diagnostics could not be exported.", true))?;
    Ok(true)
}
