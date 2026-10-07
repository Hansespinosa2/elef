use std::collections::VecDeque;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use local_store::{
    AuthoringRegistries, CoreError, DeckPreview, DeckSummary, DocumentGraphDocument,
    ImportResolution, ImportResult, Library, LibraryConfig, OpenDeck, SaveResult, SourceSnapshot,
    UploadedAsset,
};
use serde::Serialize;
use tauri::RunEvent;
use tauri::http::{Request as ProtocolRequest, Response as ProtocolResponse, StatusCode, header};
use tauri::ipc::{InvokeBody, Request as IpcRequest};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

#[derive(Default)]
struct DesktopState {
    library: RwLock<Option<Arc<Library>>>,
    root: RwLock<Option<PathBuf>>,
    pending_import: std::sync::Mutex<Option<PathBuf>>,
    open_files: std::sync::Mutex<VecDeque<PathBuf>>,
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

#[tauri::command]
async fn confirm_app_ready(
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

#[tauri::command]
async fn install_update(
    app: AppHandle,
    state: State<'_, DesktopState>,
    version: String,
    on_progress: tauri::ipc::Channel<serde_json::Value>,
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
            "An update is already being installed.",
            false,
        ));
    }
    let _lease = UpdateLease(&state.update_installing);
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
    if update.version != version {
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
fn open_deck(state: State<'_, DesktopState>, id: String) -> Result<OpenDeck, CommandError> {
    Ok(state.current_library()?.open_deck(&id)?)
}

#[tauri::command]
fn read_deck_preview(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<DeckPreview, CommandError> {
    Ok(state.current_library()?.read_deck_preview(&id)?)
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
    state: State<'_, DesktopState>,
    id: String,
    source: String,
    base_hash: String,
) -> Result<SaveResult, CommandError> {
    Ok(state
        .current_library()?
        .save_source(&id, &source, &base_hash)?)
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
    let check_updates = MenuItem::with_id(
        app,
        "check-for-updates",
        "Check for Updates…",
        true,
        None::<&str>,
    )?;
    let help = if cfg!(target_os = "macos") {
        Submenu::with_items(app, "Help", true, &[&check_updates])?
    } else {
        Submenu::with_items(app, "Help", true, &[&about, &settings, &check_updates])?
    };

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

pub fn run() {
    let updater = tauri_plugin_updater::Builder::new();
    #[cfg(feature = "webdriver")]
    let updater = match std::env::var("ELEF_E2E_UPDATER_PUBLIC_KEY") {
        Ok(public_key) => updater.pubkey(public_key),
        Err(_) => updater,
    };
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            let state = app.state::<DesktopState>();
            let added = queue_cli_files(&state, argv, &cwd);
            if added > 0 {
                let _ = app.emit("desktop-open-elef", ());
            }
        }))
        .plugin(updater.build());

    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio::init());

    let app = builder
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
                | "print" | "settings" | "check-for-updates" => {
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
        })
        .invoke_handler(tauri::generate_handler![
            choose_library_root,
            get_library_status,
            read_library_config,
            write_library_config,
            read_authoring_registries,
            write_authoring_registry,
            list_decks,
            document_graph,
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
            install_update,
            confirm_app_ready,
        ])
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
