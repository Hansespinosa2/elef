//! The `Library` handle and its record helpers.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::RwLock;

use crate::decks::{name_warnings, normalized_name};
use crate::io::{file_name, system_time_ms};
use crate::types::{CoreError, DeckRecord, DeckSummary};
use crate::watch::WatchState;

pub struct Library {
    pub(crate) root: PathBuf,
    pub(crate) records: RwLock<HashMap<String, DeckRecord>>,
    pub(crate) write_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    pub(crate) file_watcher: Mutex<Option<WatchState>>,
}

impl Library {
    pub fn open(root: impl AsRef<Path>) -> Result<Self, CoreError> {
        let root = fs::canonicalize(root).map_err(|_| CoreError::InvalidLibrary)?;
        if !root.is_dir() {
            return Err(CoreError::InvalidLibrary);
        }

        Ok(Self {
            root,
            records: RwLock::new(HashMap::new()),
            write_locks: Mutex::new(HashMap::new()),
            file_watcher: Mutex::new(None),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn record(&self, id: &str) -> Result<DeckRecord, CoreError> {
        self.records
            .read()
            .expect("deck index lock poisoned")
            .get(id)
            .cloned()
            .ok_or(CoreError::NotFound)
    }

    pub(crate) fn refresh_record(&self, record: DeckRecord) {
        let mut records = self.records.write().expect("deck index lock poisoned");
        records.retain(|_, existing| existing.path != record.path);
        records.insert(record.id.clone(), record);
    }

    pub(crate) fn summary(&self, record: &DeckRecord) -> DeckSummary {
        let metadata = fs::symlink_metadata(&record.source_path)
            .ok()
            .or_else(|| fs::metadata(&record.path).ok());
        let modified_ms = metadata
            .and_then(|metadata| metadata.modified().ok())
            .and_then(system_time_ms)
            .unwrap_or_default();
        let mut warnings = name_warnings(&file_name(&record.path));
        warnings.extend(record.notices.clone());
        DeckSummary {
            id: record.id.clone(),
            name: file_name(&record.path),
            path: record.path.to_string_lossy().into_owned(),
            modified_ms,
            source_file: record.source_file.clone(),
            kind: if record.source_file == "document.md" {
                "document"
            } else {
                "presentation"
            }
            .into(),
            warnings,
        }
    }

    pub(crate) fn validate_deck_path(&self, path: &Path) -> Result<(), CoreError> {
        let metadata = fs::symlink_metadata(path).map_err(|_| CoreError::NotFound)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(CoreError::PathRejected);
        }
        let canonical = fs::canonicalize(path).map_err(|_| CoreError::PathRejected)?;
        if canonical.parent() != Some(self.root.as_path()) {
            return Err(CoreError::PathRejected);
        }
        Ok(())
    }

    pub(crate) fn name_collision_exists(&self, name: &str) -> Result<bool, CoreError> {
        let normalized = normalized_name(name);
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_dir()
                && !file_type.is_symlink()
                && normalized_name(&file_name(&entry.path())) == normalized
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub(crate) fn write_lock(&self, id: &str) -> Arc<Mutex<()>> {
        let mut locks = self.write_locks.lock().expect("write lock table poisoned");
        locks
            .entry(id.to_owned())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}
