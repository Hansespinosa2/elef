use std::collections::VecDeque;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use local_store::Library;

use crate::error::CommandError;
use crate::library::{LibraryStatus, library_status};

#[derive(Default)]
pub(crate) struct DesktopState {
    pub(crate) library: RwLock<Option<Arc<Library>>>,
    pub(crate) root: RwLock<Option<PathBuf>>,
    pub(crate) pending_import: std::sync::Mutex<Option<PendingImport>>,
    pub(crate) open_files: std::sync::Mutex<VecDeque<PathBuf>>,
    #[cfg(any(
        target_os = "macos",
        all(feature = "desktop-dev", feature = "webdriver")
    ))]
    pub(crate) update_installing: std::sync::atomic::AtomicBool,
    pub(crate) app_ready: std::sync::atomic::AtomicBool,
}

/// An archive waiting for an import-conflict choice. Byte imports stage the
/// archive in a temp file owned by the app; dialog imports reference the
/// user's file, which the app must never delete.
#[derive(Debug)]
pub(crate) struct PendingImport {
    pub(crate) path: PathBuf,
    pub(crate) staged: bool,
}

pub(crate) fn store_pending_import(state: &DesktopState, path: PathBuf, staged: bool) {
    *state
        .pending_import
        .lock()
        .expect("pending import lock poisoned") = Some(PendingImport { path, staged });
}

pub(crate) fn take_pending_import(state: &DesktopState) -> Option<PendingImport> {
    state
        .pending_import
        .lock()
        .expect("pending import lock poisoned")
        .take()
}

pub(crate) fn discard_pending_import(pending: &PendingImport) {
    if pending.staged {
        let _ = fs::remove_file(&pending.path);
    }
}

impl DesktopState {
    pub(crate) fn use_library(&self, path: PathBuf) -> Result<LibraryStatus, CommandError> {
        let library = Arc::new(Library::open(path)?);
        library.enable_watching()?;
        let root = library.root().to_path_buf();
        let status = library_status(&library, &root)?;
        *self.library.write().expect("library state lock poisoned") = Some(library);
        *self.root.write().expect("root state lock poisoned") = Some(root.clone());
        Ok(status)
    }

    pub(crate) fn current_library(&self) -> Result<Arc<Library>, CommandError> {
        self.library
            .read()
            .expect("library state lock poisoned")
            .clone()
            .ok_or_else(|| CommandError::new("not_found", "Choose a library folder first.", false))
    }
}
