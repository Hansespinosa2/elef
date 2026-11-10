#[cfg(target_os = "macos")]
use std::path::Path;
#[cfg(any(
    target_os = "macos",
    all(feature = "desktop-dev", feature = "webdriver")
))]
use std::path::PathBuf;

use local_store::diagnostics::{EventCode, EventResult};
#[cfg(all(target_os = "linux", feature = "desktop-dev", feature = "webdriver"))]
use tauri::Manager;
use tauri::{AppHandle, State};
// The install path compiles only where the updater boundary allows it:
// macOS, or the Dev WebDriver harness that exercises the loopback fixture.
// Linux Stable never compiles install code; its capability denies the
// command as well (enforcement-by-capability plus cfg, not either alone).
#[cfg(any(
    target_os = "macos",
    all(feature = "desktop-dev", feature = "webdriver")
))]
use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogKind};
#[cfg(any(
    target_os = "macos",
    all(feature = "desktop-dev", feature = "webdriver")
))]
use tauri_plugin_updater::UpdaterExt;

#[cfg(any(
    target_os = "macos",
    all(feature = "desktop-dev", feature = "webdriver")
))]
use crate::diagnostics::record_bool_command_result;
use crate::diagnostics::record_diagnostic;
#[cfg(any(
    target_os = "macos",
    all(feature = "desktop-dev", feature = "webdriver")
))]
use crate::dialogs::confirm_native_action_with_buttons;
use crate::error::CommandError;
use crate::state::DesktopState;

#[tauri::command]
pub(crate) async fn confirm_app_ready(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<usize, CommandError> {
    let url = match window.url() {
        Ok(url) => url,
        Err(_) => {
            record_diagnostic(
                &app,
                EventCode::Startup,
                EventResult::Failure,
                Some("internal"),
            );
            return Err(update_install_error());
        }
    };
    let local_origin = url.scheme() == "tauri" && url.host_str() == Some("localhost")
        || matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost");
    if window.label() != "main" || !local_origin {
        record_diagnostic(
            &app,
            EventCode::Startup,
            EventResult::Failure,
            Some("unsupported"),
        );
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
    // The readiness ack itself is unconditional (boot depends on it), but
    // previous-installation cleanup exists only where installs can happen.
    #[cfg(any(
        target_os = "macos",
        all(feature = "desktop-dev", feature = "webdriver")
    ))]
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
    #[cfg(not(any(
        target_os = "macos",
        all(feature = "desktop-dev", feature = "webdriver")
    )))]
    let removed = 0;
    record_diagnostic(&app, EventCode::Startup, EventResult::Success, None);
    Ok(removed)
}

#[cfg(any(
    target_os = "macos",
    all(feature = "desktop-dev", feature = "webdriver")
))]
struct UpdateLease<'a>(&'a std::sync::atomic::AtomicBool);

#[cfg(any(
    target_os = "macos",
    all(feature = "desktop-dev", feature = "webdriver")
))]
impl Drop for UpdateLease<'_> {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::Release);
    }
}

#[cfg(any(
    target_os = "macos",
    all(feature = "desktop-dev", feature = "webdriver")
))]
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

#[cfg(any(
    target_os = "macos",
    all(feature = "desktop-dev", feature = "webdriver")
))]
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

#[cfg(any(
    target_os = "macos",
    all(feature = "desktop-dev", feature = "webdriver")
))]
fn requested_update_matches(requested: &str, offered: &str) -> bool {
    requested == offered
}
#[cfg(any(
    target_os = "macos",
    all(feature = "desktop-dev", feature = "webdriver")
))]
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

#[cfg(any(
    target_os = "macos",
    all(feature = "desktop-dev", feature = "webdriver")
))]
pub(crate) struct PreparedUpdate {
    version: String,
    stage: local_store::update_install::UpdateStage,
}

#[cfg(any(
    target_os = "macos",
    all(feature = "desktop-dev", feature = "webdriver")
))]
fn take_prepared_update(
    pending: &std::sync::Mutex<Option<PreparedUpdate>>,
    version: &str,
) -> Result<PreparedUpdate, CommandError> {
    let mut pending = pending.lock().map_err(|_| update_install_error())?;
    match pending.as_ref() {
        Some(update) if update.version == version => Ok(pending.take().unwrap()),
        Some(_) => Err(CommandError::new(
            "conflict",
            "The prepared update version changed.",
            false,
        )),
        None => Err(CommandError::new(
            "not_found",
            "Choose Install on Quit before activating an update.",
            false,
        )),
    }
}
#[cfg(any(
    target_os = "macos",
    all(feature = "desktop-dev", feature = "webdriver")
))]
#[tauri::command]
pub(crate) async fn install_update(
    app: AppHandle,
    state: State<'_, DesktopState>,
    version: String,
    prepare_only: Option<bool>,
    on_progress: tauri::ipc::Channel<serde_json::Value>,
) -> Result<bool, CommandError> {
    let prepare_only = prepare_only.unwrap_or(false);
    let result = install_update_inner(app.clone(), state, version, prepare_only, on_progress).await;
    record_bool_command_result(
        &app,
        if prepare_only {
            EventCode::UpdateStage
        } else {
            EventCode::UpdateActivation
        },
        &result,
    );
    result
}

#[cfg(any(
    target_os = "macos",
    all(feature = "desktop-dev", feature = "webdriver")
))]
async fn install_update_inner(
    app: AppHandle,
    state: State<'_, DesktopState>,
    version: String,
    prepare_only: bool,
    on_progress: tauri::ipc::Channel<serde_json::Value>,
) -> Result<bool, CommandError> {
    validate_update_version(&version)?;
    let _lease = acquire_update_lease(&state.update_installing)?;
    if !prepare_only {
        // Activation cannot fetch, prompt, or accept package bytes. Only a
        // native-held copy prepared after explicit consent can reach the live app.
        let prepared = take_prepared_update(&state.prepared_update, &version)?;
        tauri::async_runtime::spawn_blocking(move || prepared.stage.activate())
            .await
            .map_err(|_| update_install_error())?
            .map_err(|_| update_install_error())?;
        return Ok(true);
    }
    let (live, relative_executable) = installed_application(&app)?;
    let confirmed = confirm_native_action_with_buttons(
        &app,
        format!(
            "Download Elef {version} now and install it when you quit? You can keep working while it downloads."
        ),
        "Elef Update",
        MessageDialogKind::Info,
        MessageDialogButtons::OkCancelCustom("Install on Quit".into(), "Later".into()),
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
    let mut update = updater
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
    // The plugin's check timeout is not inherited by its download handle.
    // A stalled background download must not hold a later quit indefinitely.
    update.timeout = Some(std::time::Duration::from_secs(120));
    let _ = on_progress.send(serde_json::json!({"event": "Started"}));
    let progress = on_progress.clone();
    let bytes = update.download(move |chunk_length, content_length| {
        let _ = progress.send(serde_json::json!({"event": "Progress", "data": {"chunkLength": chunk_length, "contentLength": content_length}}));
    }, || {}).await.map_err(|_| update_install_error())?;
    let stage = tauri::async_runtime::spawn_blocking(move || {
        // Tauri installs only into the private copy. It never touches the live app.
        update.install(bytes).map_err(|_| update_install_error())?;
        Ok::<_, CommandError>(stage)
    })
    .await
    .map_err(|_| update_install_error())??;
    *state
        .prepared_update
        .lock()
        .map_err(|_| update_install_error())? = Some(PreparedUpdate { version, stage });
    let _ = on_progress.send(serde_json::json!({"event": "Finished"}));
    Ok(true)
}

#[cfg(test)]
mod tests {
    #[cfg(any(
        target_os = "macos",
        all(feature = "desktop-dev", feature = "webdriver")
    ))]
    use super::*;

    #[cfg(any(
        target_os = "macos",
        all(feature = "desktop-dev", feature = "webdriver")
    ))]
    #[test]
    fn activation_requires_the_exact_prepared_version_and_consumes_it_once() {
        let pending = std::sync::Mutex::new(None);
        assert!(
            matches!(take_prepared_update(&pending, "0.2.0"), Err(error) if error.code == "not_found")
        );
        let root = tempfile::tempdir().unwrap();
        let live = root.path().join("Elef.AppImage");
        std::fs::write(&live, "old app").unwrap();
        let stage = local_store::update_install::UpdateStage::new(&live).unwrap();
        std::fs::write(stage.path(), "verified new app").unwrap();
        *pending.lock().unwrap() = Some(PreparedUpdate {
            version: "0.2.0".into(),
            stage,
        });
        assert!(
            matches!(take_prepared_update(&pending, "0.3.0"), Err(error) if error.code == "conflict")
        );
        assert_eq!(std::fs::read_to_string(&live).unwrap(), "old app");
        let prepared = take_prepared_update(&pending, "0.2.0").unwrap();
        prepared.stage.activate().unwrap();
        assert_eq!(std::fs::read_to_string(&live).unwrap(), "verified new app");
        assert!(
            matches!(take_prepared_update(&pending, "0.2.0"), Err(error) if error.code == "not_found")
        );
    }

    #[cfg(any(
        target_os = "macos",
        all(feature = "desktop-dev", feature = "webdriver")
    ))]
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

    #[cfg(any(
        target_os = "macos",
        all(feature = "desktop-dev", feature = "webdriver")
    ))]
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

    #[cfg(any(
        target_os = "macos",
        all(feature = "desktop-dev", feature = "webdriver")
    ))]
    #[test]
    fn update_install_requires_the_checked_release_version_to_match_exactly() {
        assert!(requested_update_matches("0.2.0", "0.2.0"));
        assert!(!requested_update_matches("0.2.0", "0.2.1"));
        assert!(!requested_update_matches("0.2.0", "v0.2.0"));
    }
}
