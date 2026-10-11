#[cfg(target_os = "macos")]
use std::path::Path;
use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::MessageDialogKind;
use tauri_plugin_updater::UpdaterExt;

use crate::dialogs::confirm_native_action;
use crate::error::CommandError;
use crate::state::DesktopState;

#[tauri::command]
pub(crate) async fn confirm_app_ready(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<usize, CommandError> {
    let url = window.url().map_err(|_| update_install_error())?;
    let local_origin = url.scheme() == "tauri" && url.host_str() == Some("localhost")
        || matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost");
    if window.label() != "main" || !local_origin {
        return Err(CommandError::new(
            "unsupported",
            "Application readiness was rejected.",
            false,
        ));
    }
    if state
        .app_ready
        .swap(true, std::sync::atomic::Ordering::AcqRel)
    {
        return Ok(0);
    }
    let removed = if let Ok((live, _)) = installed_application(&app) {
        // Readiness is acknowledged only after successful frontend/editor boot.
        // Failure leaves the previous complete installation available.
        match tauri::async_runtime::spawn_blocking(move || {
            local_store::update_install::cleanup_previous_installation(&live)
        })
        .await
        {
            Ok(Ok(removed)) => removed,
            _ => 0,
        }
    } else {
        0
    };
    Ok(removed)
}

struct UpdateLease<'a>(&'a std::sync::atomic::AtomicBool);

impl Drop for UpdateLease<'_> {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::Release);
    }
}

fn validate_update_version(version: &str) -> Result<(), CommandError> {
    if version.len() <= 64
        && !version.is_empty()
        && version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b".+-".contains(&byte))
    {
        Ok(())
    } else {
        Err(CommandError::new(
            "invalid_input",
            "Choose a valid update version.",
            false,
        ))
    }
}

fn acquire_update_lease(
    update_installing: &std::sync::atomic::AtomicBool,
) -> Result<UpdateLease<'_>, CommandError> {
    if update_installing
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::Acquire,
            std::sync::atomic::Ordering::Relaxed,
        )
        .is_err()
    {
        return Err(CommandError::new(
            "invalid_input",
            "An update is already being installed.",
            false,
        ));
    }
    Ok(UpdateLease(update_installing))
}

fn requested_update_matches(requested: &str, offered: &str) -> bool {
    requested == offered
}
fn installed_application(app: &AppHandle) -> Result<(PathBuf, PathBuf), CommandError> {
    #[cfg(target_os = "linux")]
    if let Some(path) = app.env().appimage {
        return Ok((path.into(), PathBuf::new()));
    }
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        let executable = std::env::current_exe().map_err(|_| update_install_error())?;
        if let Some(bundle) = executable
            .ancestors()
            .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        {
            let relative = executable
                .strip_prefix(bundle)
                .map_err(|_| update_install_error())?
                .to_path_buf();
            if relative.parent() == Some(Path::new("Contents/MacOS")) {
                return Ok((bundle.to_path_buf(), relative));
            }
        }
    }
    Err(CommandError::new(
        "unsupported",
        "Install the packaged application before using automatic updates.",
        false,
    ))
}

fn update_install_error() -> CommandError {
    CommandError::new(
        "io_error",
        "The update could not be installed. The existing installation was kept.",
        true,
    )
}
#[tauri::command]
pub(crate) async fn install_update(
    app: AppHandle,
    state: State<'_, DesktopState>,
    version: String,
    on_progress: tauri::ipc::Channel<serde_json::Value>,
) -> Result<bool, CommandError> {
    validate_update_version(&version)?;
    let _lease = acquire_update_lease(&state.update_installing)?;
    let (live, relative_executable) = installed_application(&app)?;
    let confirmed = confirm_native_action(
        &app,
        format!("Install Elef {version}? Elef will restart after installation."),
        "Install Elef update",
        MessageDialogKind::Info,
    )
    .await?;
    if !confirmed {
        return Ok(false);
    }
    let stage = tauri::async_runtime::spawn_blocking(move || {
        local_store::update_install::UpdateStage::new(&live)
    })
    .await
    .map_err(|_| update_install_error())?
    .map_err(|_| update_install_error())?;
    let staged_executable = if relative_executable.as_os_str().is_empty() {
        stage.path().to_path_buf()
    } else {
        stage.path().join(relative_executable)
    };
    let updater = app
        .updater_builder()
        .executable_path(staged_executable)
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|_| update_install_error())?;
    // Re-read the configured release endpoint. IPC cannot supply a URL, key,
    // destination, signature or arbitrary package bytes.
    let update = updater
        .check()
        .await
        .map_err(|_| update_install_error())?
        .ok_or_else(|| {
            CommandError::new("not_found", "This update is no longer available.", false)
        })?;
    if !requested_update_matches(&version, &update.version) {
        return Err(CommandError::new(
            "conflict",
            "The available update changed. Check for updates again.",
            false,
        ));
    }
    let _ = on_progress.send(serde_json::json!({"event": "Started"}));
    let progress = on_progress.clone();
    let bytes = update.download(move |chunk_length, content_length| {
        let _ = progress.send(serde_json::json!({"event": "Progress", "data": {"chunkLength": chunk_length, "contentLength": content_length}}));
    }, || {}).await.map_err(|_| update_install_error())?;
    let _ = on_progress.send(serde_json::json!({"event": "Finished"}));
    tauri::async_runtime::spawn_blocking(move || {
        // Tauri installs only into the private copy. It never touches the live app.
        update.install(bytes).map_err(|_| update_install_error())?;
        stage.activate().map_err(|_| update_install_error())?;
        Ok::<_, CommandError>(())
    })
    .await
    .map_err(|_| update_install_error())??;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_version_validation_accepts_safe_versions_and_rejects_invalid_input() {
        assert!(validate_update_version("0.2.0").is_ok());
        assert!(validate_update_version("2.0.0-rc.1+build.4").is_ok());
        for invalid in ["", "../0.2.0", "0.2.0/evil", "0.2.0\\evil", "0.2.0?x"] {
            assert_eq!(
                validate_update_version(invalid).unwrap_err().code,
                "invalid_input",
                "invalid version should be rejected: {invalid:?}"
            );
        }
        assert!(validate_update_version(&"a".repeat(65)).is_err());
    }

    #[test]
    fn update_install_lease_rejects_concurrent_work_and_releases_after_drop() {
        let installing = std::sync::atomic::AtomicBool::new(false);
        let lease = acquire_update_lease(&installing).unwrap();
        assert!(matches!(
            acquire_update_lease(&installing),
            Err(error) if error.code == "invalid_input"
        ));
        drop(lease);
        assert!(acquire_update_lease(&installing).is_ok());
    }

    #[test]
    fn update_install_requires_the_checked_release_version_to_match_exactly() {
        assert!(requested_update_matches("0.2.0", "0.2.0"));
        assert!(!requested_update_matches("0.2.0", "0.2.1"));
        assert!(!requested_update_matches("0.2.0", "v0.2.0"));
    }
}
