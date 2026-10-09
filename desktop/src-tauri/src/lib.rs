use std::collections::VecDeque;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

#[cfg(feature = "desktop-dev")]
use elef_core::DocumentGraphDocument;
#[cfg(any(target_os = "macos", feature = "webdriver"))]
use elef_core::StagedUpdateStore;
use elef_core::diagnostics::{DiagnosticEvent, EventCode, EventProfile, EventResult};
use elef_core::{
    AuthoringRegistries, CoreError, DeckPreview, DeckSummary, ImportResolution, ImportResult,
    Library, LibraryConfig, OpenDeck, SaveResult, SourceSnapshot, UploadedAsset,
};
use serde::Serialize;
use tauri::RunEvent;
use tauri::http::{Request as ProtocolRequest, Response as ProtocolResponse, StatusCode, header};
use tauri::ipc::{InvokeBody, Request as IpcRequest};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
#[cfg(any(target_os = "macos", feature = "webdriver"))]
use tauri_plugin_updater::UpdaterExt;

#[derive(Default)]
struct DesktopState {
    library: RwLock<Option<Arc<Library>>>,
    root: RwLock<Option<PathBuf>>,
    pending_import: std::sync::Mutex<Option<PathBuf>>,
    open_files: std::sync::Mutex<VecDeque<PathBuf>>,
    #[cfg(any(target_os = "macos", feature = "webdriver"))]
    update_installing: std::sync::atomic::AtomicBool,
    app_ready: std::sync::atomic::AtomicBool,
}

impl DesktopState {
    fn use_library(&self, path: PathBuf) -> Result<LibraryStatus, CommandError> {
        let library = Arc::new(Library::open(path)?);
        let root = library.root().to_path_buf();
        let status = library_status(&library, &root)?;
        *self.library.write().expect("library state lock poisoned") = Some(library);
        *self.root.write().expect("root state lock poisoned") = Some(root.clone());
        Ok(status)
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

    fn with_details(
        code: &'static str,
        message: &str,
        retryable: bool,
        details: serde_json::Value,
    ) -> Self {
        Self {
            code,
            message: message.to_owned(),
            retryable,
            details: Some(details),
        }
    }
}

impl From<CoreError> for CommandError {
    fn from(error: CoreError) -> Self {
        match error {
            CoreError::Conflict {
                disk_hash,
                disk_source,
                disk_source_file,
            } => Self {
                code: "conflict",
                message: "The file changed outside Elef. Review the current version before saving."
                    .into(),
                retryable: false,
                details: Some(serde_json::json!({
                    "disk_hash": disk_hash,
                    "current": { "source": disk_source, "source_file": disk_source_file }
                })),
            },
            CoreError::AuthoringConflict => Self::new(
                "conflict",
                "Authoring settings changed outside Elef. Close and reopen settings before saving.",
                false,
            ),
            CoreError::ImportConflict {
                incoming_name,
                existing_name,
            } => Self::with_details(
                "import_conflict",
                "A deck with this identity already exists.",
                false,
                serde_json::json!({
                    "incoming_name": incoming_name,
                    "existing_name": existing_name
                }),
            ),
            other => Self {
                code: other.code(),
                message: other.to_string(),
                retryable: matches!(other, CoreError::Io(_)),
                details: None,
            },
        }
    }
}

fn record_diagnostic(
    app: &AppHandle,
    event_code: EventCode,
    result: EventResult,
    error_code: Option<&str>,
) {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    let profile = if cfg!(feature = "desktop-dev") {
        EventProfile::Dev
    } else {
        EventProfile::Stable
    };
    let event = DiagnosticEvent::new(event_code, result, error_code, profile);
    let _ = elef_core::diagnostics::append_event(&data_dir.join("logs"), &event);
}

fn record_command_result<T>(
    app: &AppHandle,
    event_code: EventCode,
    result: &Result<T, CommandError>,
) {
    match result {
        Ok(_) => record_diagnostic(app, event_code, EventResult::Success, None),
        Err(error) => record_diagnostic(app, event_code, EventResult::Failure, Some(error.code)),
    }
}

fn record_bool_command_result(
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
async fn confirm_app_ready(
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
    #[cfg(any(target_os = "macos", feature = "webdriver"))]
    let removed = if let Ok((live, _)) = installed_application(&app) {
        // Readiness is acknowledged only after successful frontend/editor boot.
        // Failure leaves the previous complete installation available.
        match tauri::async_runtime::spawn_blocking(move || {
            elef_core::update_install::cleanup_previous_installation(&live)
        })
        .await
        {
            Ok(Ok(removed)) => removed,
            _ => 0,
        }
    } else {
        0
    };
    #[cfg(not(any(target_os = "macos", feature = "webdriver")))]
    let removed = 0;
    record_diagnostic(&app, EventCode::Startup, EventResult::Success, None);
    Ok(removed)
}

#[cfg(any(target_os = "macos", feature = "webdriver"))]
struct UpdateLease<'a>(&'a std::sync::atomic::AtomicBool);

#[cfg(any(target_os = "macos", feature = "webdriver"))]
impl Drop for UpdateLease<'_> {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::Release);
    }
}

#[cfg(any(target_os = "macos", feature = "webdriver"))]
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

async fn confirm_native_action(
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

#[cfg(any(target_os = "macos", feature = "webdriver"))]
#[tauri::command]
async fn install_update(
    app: AppHandle,
    state: State<'_, DesktopState>,
    version: String,
) -> Result<bool, CommandError> {
    let result = install_update_inner(app.clone(), state, version).await;
    record_bool_command_result(&app, EventCode::UpdateActivation, &result);
    result
}

#[cfg(any(target_os = "macos", feature = "webdriver"))]
#[tauri::command]
async fn stage_update(
    app: AppHandle,
    state: State<'_, DesktopState>,
    on_progress: tauri::ipc::Channel<serde_json::Value>,
) -> Result<Option<StagedUpdateInfo>, CommandError> {
    let result = stage_update_inner(app.clone(), state, on_progress).await;
    match &result {
        Ok(Some(_)) => record_diagnostic(&app, EventCode::UpdateStage, EventResult::Success, None),
        Ok(None) => record_diagnostic(&app, EventCode::UpdateStage, EventResult::Deferred, None),
        Err(error) => record_diagnostic(
            &app,
            EventCode::UpdateStage,
            EventResult::Failure,
            Some(error.code),
        ),
    }
    result
}

#[cfg(any(target_os = "macos", feature = "webdriver"))]
#[derive(Debug, Serialize)]
struct StagedUpdateInfo {
    version: String,
    notes: String,
}

#[cfg(any(target_os = "macos", feature = "webdriver"))]
async fn stage_update_inner(
    app: AppHandle,
    state: State<'_, DesktopState>,
    on_progress: tauri::ipc::Channel<serde_json::Value>,
) -> Result<Option<StagedUpdateInfo>, CommandError> {
    if state
        .update_installing
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
    let _lease = UpdateLease(&state.update_installing);
    let _ = installed_application(&app)?;
    let store = staged_update_store(&app)?;
    let updater = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|_| update_check_error())?;
    let update = updater.check().await.map_err(|_| {
        record_diagnostic(
            &app,
            EventCode::UpdateCheck,
            EventResult::Failure,
            Some("unavailable"),
        );
        update_check_error()
    })?;
    let Some(update) = update else {
        let clear_store = store.clone();
        tauri::async_runtime::spawn_blocking(move || clear_store.clear())
            .await
            .map_err(|_| update_stage_error())?
            .map_err(|_| update_stage_error())?;
        record_diagnostic(&app, EventCode::UpdateCheck, EventResult::Success, None);
        return Ok(None);
    };
    record_diagnostic(&app, EventCode::UpdateCheck, EventResult::Success, None);
    let version = update.version.clone();
    let notes = update.body.clone().unwrap_or_default();

    // Reuse a verified cache after a restart instead of downloading the same
    // archive again. The signed manifest remains the authority for eligibility.
    let cached = tauri::async_runtime::spawn_blocking({
        let store = store.clone();
        move || store.load()
    })
    .await
    .map_err(|_| update_stage_error())?;
    match cached {
        Ok(Some(cached)) => {
            let valid_manifest = same_staged_update(&update, &cached.metadata);
            let public_key = updater_public_key(&app)?;
            let metadata = cached.metadata;
            let payload = cached.payload;
            let valid_signature = if valid_manifest {
                tauri::async_runtime::spawn_blocking(move || {
                    elef_core::staged_update::verify_signature(
                        &payload,
                        &metadata.signature,
                        &public_key,
                        &metadata.version,
                    )
                    .is_ok()
                })
                .await
                .unwrap_or(false)
            } else {
                false
            };
            if valid_manifest && valid_signature {
                return Ok(Some(StagedUpdateInfo { version, notes }));
            }
            let clear_store = store.clone();
            tauri::async_runtime::spawn_blocking(move || clear_store.clear())
                .await
                .map_err(|_| update_stage_error())?
                .map_err(|_| update_stage_error())?;
        }
        Ok(None) => {}
        Err(_) => {
            // A corrupt/incomplete cache is discarded before a fresh verified
            // download is staged. The live app and library are untouched.
            let clear_store = store.clone();
            tauri::async_runtime::spawn_blocking(move || clear_store.clear())
                .await
                .map_err(|_| update_stage_error())?
                .map_err(|_| update_stage_error())?;
        }
    }

    let signature = update.signature.clone();
    let download_url = update.download_url.to_string();
    let _ = on_progress.send(serde_json::json!({"event": "Started"}));
    let progress = on_progress.clone();
    let bytes = update
        .download(
            move |chunk_length, content_length| {
                let _ = progress.send(serde_json::json!({"event": "Progress", "data": {"chunkLength": chunk_length, "contentLength": content_length}}));
            },
            || {},
        )
        .await
        .map_err(|_| update_stage_error())?;
    let _ = on_progress.send(serde_json::json!({"event": "Finished"}));
    let version_for_store = version.clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.save(&version_for_store, &signature, &download_url, &bytes)
    })
    .await
    .map_err(|_| update_stage_error())?
    .map_err(|_| update_stage_error())?;
    Ok(Some(StagedUpdateInfo { version, notes }))
}

#[cfg(any(target_os = "macos", feature = "webdriver"))]
async fn install_update_inner(
    app: AppHandle,
    state: State<'_, DesktopState>,
    version: String,
) -> Result<bool, CommandError> {
    if version.len() > 64
        || version.is_empty()
        || !version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b".+-".contains(&byte))
    {
        return Err(CommandError::new(
            "invalid_input",
            "Choose a valid update version.",
            false,
        ));
    }
    if state
        .update_installing
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
            "An update operation is already running.",
            false,
        ));
    }
    let _lease = UpdateLease(&state.update_installing);
    let store = staged_update_store(&app)?;
    let staged_update = tauri::async_runtime::spawn_blocking({
        let store = store.clone();
        move || store.load()
    })
    .await
    .map_err(|_| update_install_error())?
    .map_err(|_| update_install_error())?;
    let Some(staged_update) = staged_update else {
        return Ok(false);
    };
    if staged_update.metadata.version != version {
        return Ok(false);
    }

    // Check the controlled feed before making a second copy of the installed app.
    let eligible = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|_| update_check_error())?
        .check()
        .await
        .map_err(|_| update_check_error())?;
    let Some(eligible) = eligible else {
        let clear_store = store.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || clear_store.clear()).await;
        return Ok(false);
    };
    if !same_staged_update(&eligible, &staged_update.metadata) {
        let clear_store = store.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || clear_store.clear()).await;
        return Ok(false);
    }

    let (live, relative_executable) = installed_application(&app)?;
    let stage = tauri::async_runtime::spawn_blocking(move || {
        elef_core::update_install::UpdateStage::new(&live)
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
    // Recheck the safe feed immediately before activation. IPC cannot supply a
    // URL, key, destination, signature, or arbitrary package bytes.
    let update = updater.check().await.map_err(|_| update_check_error())?;
    let Some(update) = update else {
        let clear_store = store.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || clear_store.clear()).await;
        return Ok(false);
    };
    if !same_staged_update(&update, &staged_update.metadata) {
        let clear_store = store.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || clear_store.clear()).await;
        return Ok(false);
    }

    let public_key = updater_public_key(&app)?;
    let signature = staged_update.metadata.signature.clone();
    let expected_version = staged_update.metadata.version.clone();
    let payload = staged_update.payload;
    let stage = tauri::async_runtime::spawn_blocking(move || {
        elef_core::staged_update::verify_signature(
            &payload,
            &signature,
            &public_key,
            &expected_version,
        )
        .map_err(|_| update_integrity_error())?;
        // Tauri installs only into the private copy. It never touches the live app.
        update
            .install(payload)
            .map_err(|_| update_install_error())?;
        #[cfg(feature = "webdriver")]
        interrupt_update_install_for_e2e();
        Ok::<_, CommandError>(stage)
    })
    .await
    .map_err(|_| update_install_error())??;

    // Installation has only modified the disposable copy. Check the central
    // safe feed again immediately before the atomic app-bundle swap.
    let latest = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|_| update_check_error())?
        .check()
        .await
        .map_err(|_| update_check_error())?;
    if !latest
        .as_ref()
        .is_some_and(|latest| same_staged_update(latest, &staged_update.metadata))
    {
        let clear_store = store.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || clear_store.clear()).await;
        return Ok(false);
    }
    tauri::async_runtime::spawn_blocking(move || stage.activate())
        .await
        .map_err(|_| update_install_error())?
        .map_err(|_| update_install_error())?;
    let _ = tauri::async_runtime::spawn_blocking(move || store.clear()).await;
    Ok(true)
}

#[cfg(any(target_os = "macos", feature = "webdriver"))]
fn staged_update_store(app: &AppHandle) -> Result<StagedUpdateStore, CommandError> {
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|_| update_stage_error())?;
    Ok(StagedUpdateStore::new(cache.join("updates")))
}

#[cfg(any(target_os = "macos", feature = "webdriver"))]
fn updater_public_key(app: &AppHandle) -> Result<String, CommandError> {
    if let Ok(public_key) = std::env::var("ELEF_E2E_UPDATER_PUBLIC_KEY") {
        return Ok(public_key);
    }
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(update_integrity_error)
}

#[cfg(any(target_os = "macos", feature = "webdriver"))]
fn same_staged_update(
    update: &tauri_plugin_updater::Update,
    staged: &elef_core::staged_update::StagedUpdateMetadata,
) -> bool {
    update.version == staged.version
        && update.signature == staged.signature
        && update.download_url.as_str() == staged.download_url
}

#[cfg(any(target_os = "macos", feature = "webdriver"))]
fn update_check_error() -> CommandError {
    CommandError::new(
        "unavailable",
        "The safe update feed could not be checked.",
        true,
    )
}

#[cfg(any(target_os = "macos", feature = "webdriver"))]
fn update_stage_error() -> CommandError {
    CommandError::new("io_error", "The verified update could not be staged.", true)
}

#[cfg(any(target_os = "macos", feature = "webdriver"))]
fn update_integrity_error() -> CommandError {
    CommandError::new(
        "integrity",
        "The staged update did not pass integrity verification.",
        false,
    )
}

#[cfg(feature = "webdriver")]
fn interrupt_update_install_for_e2e() {
    if std::env::var_os("ELEF_E2E_INTERRUPT_UPDATE_AFTER_STAGE_INSTALL").is_some() {
        // Test-only abrupt exit after the updater has modified its disposable
        // copy and before UpdateStage can exchange it with the live app.
        std::process::exit(86);
    }
}

#[derive(Debug, Serialize)]
struct LibraryStatus {
    root: String,
    decks: Vec<DeckSummary>,
    config: LibraryConfig,
    config_notice: Option<String>,
}

fn library_status(library: &Library, root: &Path) -> Result<LibraryStatus, CommandError> {
    let (config, config_notice) = match library.read_config() {
        Ok(config) => (config, None),
        Err(_) => (
            LibraryConfig::default(),
            Some("Library settings could not be read; defaults are in use.".into()),
        ),
    };
    Ok(LibraryStatus {
        root: root.to_string_lossy().into_owned(),
        decks: library.list_decks()?,
        config,
        config_notice,
    })
}

#[derive(Debug, Serialize)]
struct DeleteResult {
    deleted: bool,
}

#[derive(Debug, Serialize)]
struct AuthoringRegistryWriteResult {
    content_hash: String,
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
    let library = state.current_library()?;
    Ok(Some(library_status(&library, &root)?))
}

#[tauri::command]
fn list_decks(state: State<'_, DesktopState>) -> Result<Vec<DeckSummary>, CommandError> {
    Ok(state.current_library()?.list_decks()?)
}

#[cfg(feature = "desktop-dev")]
#[tauri::command]
fn document_graph(
    state: State<'_, DesktopState>,
) -> Result<Vec<DocumentGraphDocument>, CommandError> {
    Ok(state.current_library()?.document_graph()?)
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
fn open_deck(
    app: AppHandle,
    state: State<'_, DesktopState>,
    id: String,
) -> Result<OpenDeck, CommandError> {
    let result = state
        .current_library()
        .and_then(|library| library.open_deck(&id).map_err(CommandError::from));
    record_command_result(&app, EventCode::Open, &result);
    result
}

#[tauri::command]
fn read_deck_preview(
    app: AppHandle,
    state: State<'_, DesktopState>,
    id: String,
) -> Result<DeckPreview, CommandError> {
    let result = state
        .current_library()
        .and_then(|library| library.read_deck_preview(&id).map_err(CommandError::from));
    record_command_result(&app, EventCode::Render, &result);
    result
}

#[tauri::command]
fn read_source_snapshot(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<SourceSnapshot, CommandError> {
    Ok(state.current_library()?.read_source_snapshot(&id)?)
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
fn read_library_config(state: State<'_, DesktopState>) -> Result<LibraryConfig, CommandError> {
    Ok(state.current_library()?.read_config()?)
}

#[tauri::command]
fn write_library_config(
    state: State<'_, DesktopState>,
    config: LibraryConfig,
) -> Result<(), CommandError> {
    state.current_library()?.write_config(&config)?;
    Ok(())
}

#[tauri::command]
fn read_authoring_registries(
    state: State<'_, DesktopState>,
) -> Result<AuthoringRegistries, CommandError> {
    Ok(state.current_library()?.read_authoring_registries()?)
}

#[tauri::command]
fn write_authoring_registry(
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
    let deck = library.deck_summary(&id)?;
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
        .set_title("Export Elef deck")
        .set_file_name(format!("{}.elef", deck.name))
        .add_filter("Elef deck", &["elef"])
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
async fn export_elef(
    app: AppHandle,
    state: State<'_, DesktopState>,
    id: String,
    use_native_dialog: Option<bool>,
) -> Result<bool, CommandError> {
    export_elef_impl(app, state, id, use_native_dialog.unwrap_or(false)).await
}

#[cfg(not(feature = "webdriver"))]
#[tauri::command]
async fn export_elef(
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
                "The exported deck must use the .elef extension.",
                false,
            ));
        }
    }
    write_elef_archive(library, id, &destination)?;
    Ok(())
}

#[tauri::command]
async fn import_elef(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<Option<ImportResult>, CommandError> {
    let Some(selection) = app
        .dialog()
        .file()
        .set_title("Import Elef deck")
        .add_filter("Elef deck", &["elef"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let archive_path = selection
        .into_path()
        .map_err(|_| CommandError::new("invalid_input", "Choose a local file.", false))?;
    let library = state.current_library()?;
    import_archive(&state, &library, archive_path)
}

#[tauri::command]
fn import_opened_elef(
    state: State<'_, DesktopState>,
) -> Result<Option<ImportResult>, CommandError> {
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
    import_archive(&state, &library, archive_path)
}

#[tauri::command]
fn pending_open_elef_count(state: State<'_, DesktopState>) -> usize {
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
) -> Result<Option<ImportResult>, CommandError> {
    match library.import_elef(&archive_path, None) {
        Ok(result) => Ok(Some(result)),
        Err(error @ CoreError::ImportConflict { .. }) => {
            *state
                .pending_import
                .lock()
                .expect("pending import lock poisoned") = Some(archive_path);
            Err(error.into())
        }
        Err(error) => Err(error.into()),
    }
}

#[tauri::command]
async fn resolve_import_conflict(
    app: AppHandle,
    state: State<'_, DesktopState>,
    resolution: String,
) -> Result<Option<ImportResult>, CommandError> {
    if resolution == "cancel" {
        state
            .pending_import
            .lock()
            .expect("pending import lock poisoned")
            .take();
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
    let archive_path = state
        .pending_import
        .lock()
        .expect("pending import lock poisoned")
        .take()
        .ok_or_else(|| {
            CommandError::new(
                "not_found",
                "There is no import waiting for a choice.",
                false,
            )
        })?;
    let library = state.current_library()?;
    if choice == ImportResolution::Replace {
        let preview = match library.import_elef(&archive_path, None) {
            Err(CoreError::ImportConflict { existing_name, .. }) => existing_name,
            Ok(_) => {
                return Err(CommandError::new(
                    "invalid_input",
                    "The archive no longer conflicts with a deck in this library.",
                    false,
                ));
            }
            Err(error) => return Err(error.into()),
        };
        let confirmed = confirm_native_action(
            &app,
            format!("Move “{preview}” to the system Trash and replace it with the imported deck?"),
            "Replace existing deck",
            MessageDialogKind::Warning,
        )
        .await?;
        if !confirmed {
            return Ok(None);
        }
    }
    Ok(Some(library.import_elef(&archive_path, Some(choice))?))
}

fn write_elef_archive(
    library: &Library,
    deck_id: &str,
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
    library.export_elef(deck_id, &mut temporary)?;
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
fn save_source(
    app: AppHandle,
    state: State<'_, DesktopState>,
    id: String,
    source: String,
    base_hash: String,
) -> Result<SaveResult, CommandError> {
    let result = state.current_library().and_then(|library| {
        library
            .save_source(&id, &source, &base_hash)
            .map_err(CommandError::from)
    });
    record_command_result(&app, EventCode::Save, &result);
    result
}

#[tauri::command]
async fn export_diagnostics(app: AppHandle) -> Result<bool, CommandError> {
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
        elef_core::diagnostics::export_diagnostics(&log_dir, &destination)
            .map_err(|_| CommandError::new("io_error", "Diagnostics could not be exported.", true))
    })
    .await
    .map_err(|_| CommandError::new("internal", "Diagnostics could not be exported.", true))??;
    Ok(true)
}

fn asset_protocol_response(
    app: &AppHandle,
    request: &ProtocolRequest<Vec<u8>>,
) -> ProtocolResponse<Vec<u8>> {
    let not_found = || {
        ProtocolResponse::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .expect("static asset response is valid")
    };
    if request.method() != tauri::http::Method::GET {
        return ProtocolResponse::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .header(header::ALLOW, "GET")
            .body(Vec::new())
            .expect("static asset response is valid");
    }
    let Some(asset_path) = parse_asset_protocol_path(request.uri().path()) else {
        return not_found();
    };
    let state = app.state::<DesktopState>();
    let Ok(library) = state.current_library() else {
        return not_found();
    };
    let immutable = matches!(&asset_path.source, AssetProtocolSource::Digest(_));
    let asset_result = match asset_path.source {
        AssetProtocolSource::Digest(digest) => library.read_asset(&asset_path.id, &digest),
        AssetProtocolSource::RelativePath(path) => library.read_asset_path(&asset_path.id, &path),
    };
    let Ok((bytes, content_type)) = asset_result else {
        return not_found();
    };
    ProtocolResponse::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(
            header::CACHE_CONTROL,
            if immutable {
                "private, max-age=31536000, immutable"
            } else {
                "no-cache"
            },
        )
        .header("x-content-type-options", "nosniff")
        .body(bytes)
        .expect("static asset response is valid")
}

#[derive(Debug, PartialEq, Eq)]
struct AssetProtocolPath {
    id: String,
    source: AssetProtocolSource,
}

#[derive(Debug, PartialEq, Eq)]
enum AssetProtocolSource {
    Digest(String),
    RelativePath(PathBuf),
}

fn parse_asset_protocol_path(path: &str) -> Option<AssetProtocolPath> {
    let mut parts = path.strip_prefix('/')?.split('/');
    let id = decode_asset_path_component(parts.next()?)?;
    if id.is_empty() || matches!(id.as_str(), "." | "..") {
        return None;
    }
    let second = parts.next()?;
    if second == "path" {
        let mut relative_path = PathBuf::new();
        let mut count = 0usize;
        for raw_component in parts {
            let component = decode_asset_path_component(raw_component)?;
            if component.is_empty() || matches!(component.as_str(), "." | "..") {
                return None;
            }
            relative_path.push(component);
            count += 1;
        }
        return (count > 1 && relative_path.components().next()?.as_os_str() == "images")
            .then_some(AssetProtocolPath {
                id,
                source: AssetProtocolSource::RelativePath(relative_path),
            });
    }

    if parts.next().is_some()
        || second.len() != 64
        || !second.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    Some(AssetProtocolPath {
        id,
        source: AssetProtocolSource::Digest(second.to_ascii_lowercase()),
    })
}

fn decode_asset_path_component(component: &str) -> Option<String> {
    let input = component.as_bytes();
    let mut decoded = Vec::with_capacity(input.len());
    let mut index = 0;
    while index < input.len() {
        if input[index] == b'%' {
            let high = *input.get(index + 1)?;
            let low = *input.get(index + 2)?;
            decoded.push((hex_nibble(high)? << 4) | hex_nibble(low)?);
            index += 3;
        } else {
            decoded.push(input[index]);
            index += 1;
        }
    }
    if decoded
        .iter()
        .any(|byte| *byte == b'/' || *byte == b'\\' || byte.is_ascii_control())
    {
        return None;
    }
    String::from_utf8(decoded).ok()
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[tauri::command]
fn upload_asset(
    request: IpcRequest<'_>,
    state: State<'_, DesktopState>,
) -> Result<UploadedAsset, CommandError> {
    let header_value = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
    };
    let id = header_value("x-elef-deck-id").ok_or_else(|| {
        CommandError::new("invalid_input", "Choose a deck before adding media.", false)
    })?;
    let filename = header_value("x-elef-filename").unwrap_or("image");
    let media_type = header_value("x-elef-declared-media-type").unwrap_or("");
    let fit = header_value("x-elef-fit").unwrap_or("contain");
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(CommandError::new(
            "invalid_input",
            "The media upload did not contain a binary file.",
            false,
        ));
    };
    Ok(state
        .current_library()?
        .upload_asset(id, filename, media_type, bytes, fit)?)
}

fn persisted_root_path(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    Ok(app.path().app_data_dir()?.join("library-root.json"))
}

fn read_persisted_library_root(path: &Path) -> Option<PathBuf> {
    let bytes = fs::read(path).ok()?;
    let config = serde_json::from_slice::<serde_json::Value>(&bytes).ok()?;
    let root = config.get("library_root")?.as_str()?;
    Some(PathBuf::from(root))
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
    let Some(root) = read_persisted_library_root(&path) else {
        return;
    };
    let _ = state.use_library(root);
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = MenuItem::with_id(app, "about", "About Elef", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
    let application_menu_separator = PredefinedMenuItem::separator(app)?;
    let application_menu_quit_separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Elef", true, Some("CmdOrCtrl+Q"))?;
    let application_menu = Submenu::with_items(
        app,
        "Elef",
        true,
        &[
            &about,
            &application_menu_separator,
            &settings,
            &application_menu_quit_separator,
            &quit,
        ],
    )?;

    let open_deck = MenuItem::with_id(app, "open-deck", "Open Deck…", true, Some("CmdOrCtrl+O"))?;
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
    let save = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
    let export = MenuItem::with_id(app, "export-elef", "Export Deck…", true, None::<&str>)?;
    let import = MenuItem::with_id(app, "import-elef", "Import .elef…", true, None::<&str>)?;
    let print = MenuItem::with_id(app, "print", "Print…", true, Some("CmdOrCtrl+P"))?;
    let file_separator = PredefinedMenuItem::separator(app)?;
    let file = if cfg!(target_os = "macos") {
        Submenu::with_items(
            app,
            "File",
            true,
            &[
                &open_deck,
                &open_library,
                &new_presentation,
                &new_document,
                &save,
                &export,
                &import,
                &print,
            ],
        )?
    } else {
        Submenu::with_items(
            app,
            "File",
            true,
            &[
                &open_deck,
                &open_library,
                &new_presentation,
                &new_document,
                &save,
                &export,
                &import,
                &print,
                &file_separator,
                &quit,
            ],
        )?
    };

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
    let show_library = MenuItem::with_id(app, "open-deck", "Show Library", true, None::<&str>)?;
    let refresh_library = MenuItem::with_id(
        app,
        "refresh-library",
        "Refresh Library",
        true,
        None::<&str>,
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[&fullscreen, &show_library, &refresh_library],
    )?;
    let present = MenuItem::with_id(
        app,
        "start-presentation",
        "Start Presentation",
        true,
        None::<&str>,
    )?;
    let presentation = Submenu::with_items(app, "Presentation", true, &[&present])?;
    let minimize = PredefinedMenuItem::minimize(app, None)?;
    let close = PredefinedMenuItem::close_window(app, None)?;
    let window = Submenu::with_items(app, "Window", true, &[&minimize, &close])?;
    #[cfg(all(target_os = "macos", not(feature = "desktop-dev")))]
    let check_updates = MenuItem::with_id(
        app,
        "check-for-updates",
        "Check for Updates…",
        true,
        None::<&str>,
    )?;
    let export_diagnostics = MenuItem::with_id(
        app,
        "export-diagnostics",
        "Export Diagnostics…",
        true,
        None::<&str>,
    )?;
    let help_separator = PredefinedMenuItem::separator(app)?;
    #[cfg(all(target_os = "macos", not(feature = "desktop-dev")))]
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[&check_updates, &help_separator, &export_diagnostics],
    )?;
    #[cfg(not(all(target_os = "macos", not(feature = "desktop-dev"))))]
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[&about, &settings, &help_separator, &export_diagnostics],
    )?;

    let menu = if cfg!(target_os = "macos") {
        Menu::with_items(
            app,
            &[
                &application_menu,
                &file,
                &edit,
                &view,
                &presentation,
                &window,
                &help,
            ],
        )?
    } else {
        Menu::with_items(app, &[&file, &edit, &view, &presentation, &window, &help])?
    };
    Ok(menu)
}

macro_rules! app_commands {
    ($($extra:ident),* $(,)?) => {
        tauri::generate_handler![
            choose_library_root,
            get_library_status,
            read_library_config,
            write_library_config,
            read_authoring_registries,
            write_authoring_registry,
            list_decks,
            create_deck,
            open_deck,
            read_deck_preview,
            read_source_snapshot,
            rename_deck,
            delete_deck,
            save_source,
            upload_asset,
            export_elef,
            import_elef,
            import_opened_elef,
            pending_open_elef_count,
            resolve_import_conflict,
            confirm_app_ready,
            export_diagnostics,
            $($extra),*
        ]
    };
}

pub fn run() {
    #[cfg(any(target_os = "macos", feature = "webdriver"))]
    let updater = tauri_plugin_updater::Builder::new();
    #[cfg(feature = "webdriver")]
    let updater = match std::env::var("ELEF_E2E_UPDATER_PUBLIC_KEY") {
        Ok(public_key) => updater.pubkey(public_key),
        Err(_) => updater,
    };
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            let state = app.state::<DesktopState>();
            let added = queue_cli_files(&state, argv, &cwd);
            if added > 0 {
                let _ = app.emit("desktop-open-elef", ());
            }
        }));

    #[cfg(any(target_os = "macos", feature = "webdriver"))]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(updater.build());

    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio::init());

    let builder = builder
        .register_asynchronous_uri_scheme_protocol("elefasset", |context, request, responder| {
            responder.respond(asset_protocol_response(context.app_handle(), &request));
        })
        .manage(DesktopState::default())
        .setup(|app| {
            let state = app.state::<DesktopState>();
            let args = std::env::args().collect::<Vec<_>>();
            let _ = queue_cli_files(
                &state,
                args,
                &std::env::current_dir()
                    .unwrap_or_default()
                    .to_string_lossy(),
            );
            #[cfg(feature = "webdriver")]
            if let Some(root) = std::env::var_os("ELEF_E2E_LIBRARY_ROOT") {
                app.state::<DesktopState>()
                    .use_library(PathBuf::from(root))
                    .expect("the dedicated E2E library must open");
            } else {
                restore_library_root(app.handle(), &app.state::<DesktopState>());
            }
            #[cfg(not(feature = "webdriver"))]
            restore_library_root(app.handle(), &app.state::<DesktopState>());
            app.set_menu(build_menu(app.handle())?)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                "open-deck" | "refresh-library" | "save" | "export-elef" | "import-elef"
                | "print" | "settings" | "export-diagnostics" => {
                    let _ = app.emit("desktop-menu-action", id);
                }
                #[cfg(all(target_os = "macos", not(feature = "desktop-dev")))]
                "check-for-updates" => {
                    let _ = app.emit("desktop-menu-action", id);
                }
                "quit" => {
                    let _ = app.emit("desktop-menu-action", "quit");
                }
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
        });

    #[cfg(all(feature = "desktop-dev", feature = "webdriver"))]
    let builder =
        builder.invoke_handler(app_commands!(document_graph, stage_update, install_update));
    #[cfg(all(feature = "desktop-dev", not(feature = "webdriver")))]
    let builder = builder.invoke_handler(app_commands!(document_graph));
    #[cfg(all(not(feature = "desktop-dev"), target_os = "macos"))]
    let builder = builder.invoke_handler(app_commands!(stage_update, install_update));
    #[cfg(all(not(feature = "desktop-dev"), not(target_os = "macos")))]
    let builder = builder.invoke_handler(app_commands!());

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building Elef Desktop");

    app.run(|app, event| {
        if let RunEvent::ExitRequested {
            code: None, api, ..
        } = &event
            && app.get_webview_window("main").is_some()
        {
            // OS Quit must take the same save/conflict path as a window close.
            // Restart requests have an explicit exit code and are already
            // guarded by save-before-install in the frontend update flow.
            api.prevent_exit();
            let _ = app.emit("desktop-menu-action", "quit");
        }
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = event {
            let paths = urls.into_iter().filter_map(|url| url.to_file_path().ok());
            let state = app.state::<DesktopState>();
            if queue_open_files(&state, paths) > 0 {
                let _ = app.emit("desktop-open-elef", ());
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}

fn queue_cli_files(state: &DesktopState, args: Vec<String>, cwd: &str) -> usize {
    let cwd = PathBuf::from(cwd);
    queue_open_files(
        state,
        // The initial process receives argv[0], while single-instance
        // callbacks vary by platform/plugin version in whether they include
        // it. Extension filtering below safely ignores the executable path.
        args.into_iter().map(|argument| {
            let path = PathBuf::from(argument);
            if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            }
        }),
    )
}

fn queue_open_files(state: &DesktopState, paths: impl IntoIterator<Item = PathBuf>) -> usize {
    let candidates = paths
        .into_iter()
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("elef"))
        })
        .collect::<Vec<_>>();
    let count = candidates.len();
    state
        .open_files
        .lock()
        .expect("opened file queue poisoned")
        .extend(candidates);
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pre_release_app_state_fixture_restores_existing_library_without_resetting_selection() {
        const LIBRARY_ROOT_TOKEN: &str = "${ELEF_RELEASE_FIXTURE_LIBRARY_ROOT}";
        const LEGACY_DECK_ID: &str = "550e8400-e29b-41d4-a716-446655440000";
        let fixture_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../test/fixtures/desktop/release/pre-release-app-state");
        let temp = tempfile::tempdir().expect("create isolated legacy app-state fixture");
        let library_root = temp.path().join("Selected library");
        let legacy_deck = library_root.join("Legacy presentation");
        fs::create_dir_all(&legacy_deck).expect("create fixture deck directory");
        fs::copy(
            fixture_root.join("Selected library/Legacy presentation/presentation.md"),
            legacy_deck.join("presentation.md"),
        )
        .expect("copy legacy presentation source");
        fs::copy(
            fixture_root.join("Selected library/Legacy presentation/elef.json"),
            legacy_deck.join("elef.json"),
        )
        .expect("copy legacy deck identity");

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
        assert_eq!(
            state
                .root
                .read()
                .expect("read selected library root")
                .as_ref(),
            Some(&library_root)
        );
        let library = state.current_library().expect("restored library is active");
        let deck = library
            .open_deck(LEGACY_DECK_ID)
            .expect("open the existing presentation without migrating its identity");
        let expected_source = fs::read_to_string(
            fixture_root.join("Selected library/Legacy presentation/presentation.md"),
        )
        .expect("read expected presentation source");
        assert_eq!(deck.source, expected_source);
        assert_eq!(
            fs::read(&state_path).expect("read persisted selection after launch"),
            serialized_state.as_bytes(),
            "launch must not reset or rewrite the existing app-state file"
        );
    }

    #[test]
    fn cli_open_file_queue_accepts_arguments_with_or_without_argv_zero() {
        let state = DesktopState::default();
        let count = queue_cli_files(
            &state,
            vec![
                "/usr/bin/elef-desktop".into(),
                "/tmp/first.elef".into(),
                "second.ELEF".into(),
                "notes.md".into(),
            ],
            "/home/user",
        );
        assert_eq!(count, 2);
        assert_eq!(
            state
                .open_files
                .lock()
                .expect("opened file queue poisoned")
                .len(),
            2
        );
        assert_eq!(
            queue_cli_files(&state, vec!["third.elef".into()], "/tmp"),
            1
        );
    }

    #[test]
    fn asset_protocol_accepts_digest_and_scoped_relative_asset_paths() {
        let digest = "a".repeat(64);
        assert_eq!(
            parse_asset_protocol_path(&format!("/deck-id/{digest}")),
            Some(AssetProtocolPath {
                id: "deck-id".into(),
                source: AssetProtocolSource::Digest(digest.clone())
            })
        );
        assert_eq!(
            parse_asset_protocol_path(&format!("/deck-id/{digest}/extra")),
            None
        );
        assert_eq!(parse_asset_protocol_path("/deck-id/%2e%2e"), None);
        assert_eq!(parse_asset_protocol_path("//digest"), None);
        assert_eq!(
            parse_asset_protocol_path("/deck-id/path/images/%2e%2e/file.png"),
            None
        );
        assert_eq!(
            parse_asset_protocol_path("/deck-id/path/images/%2Fetc/passwd"),
            None
        );
        assert_eq!(
            parse_asset_protocol_path("/path%3Aabc/path/images/nested/diagram%20one.png"),
            Some(AssetProtocolPath {
                id: "path:abc".into(),
                source: AssetProtocolSource::RelativePath(PathBuf::from(
                    "images/nested/diagram one.png"
                ))
            })
        );
    }

    #[test]
    fn conflict_errors_have_the_adapter_shape_and_preserve_current_source() {
        let error = CommandError::from(CoreError::Conflict {
            disk_hash: "a".repeat(64),
            disk_source: "outside edit".into(),
            disk_source_file: "presentation.md".into(),
        });
        let value = serde_json::to_value(error).unwrap();
        assert_eq!(value["code"], "conflict");
        assert_eq!(value["retryable"], false);
        assert_eq!(value["details"]["current"]["source"], "outside edit");
        assert_eq!(
            value["details"]["current"]["source_file"],
            "presentation.md"
        );
    }
}
