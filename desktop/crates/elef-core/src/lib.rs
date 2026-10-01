use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::Builder as TempFileBuilder;
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

pub const MANIFEST_FILE: &str = "elef.json";
pub const MANIFEST_SCHEMA_VERSION: u32 = 1;
pub const MAX_SOURCE_BYTES: usize = 50 * 1024 * 1024;
pub const MAX_ARCHIVE_UNCOMPRESSED_BYTES: u64 = 500 * 1024 * 1024;
pub const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_ARCHIVE_FILE_BYTES: u64 = 600 * 1024 * 1024;
const STALE_TEMP_AGE_SECONDS: u64 = 24 * 60 * 60;
const MAX_ARCHIVE_COMPRESSION_RATIO: u64 = 1_000;
const MAX_ARCHIVE_RATIO_CHECK_BYTES: u64 = 1024 * 1024;
const LIBRARY_CONFIG_DIR: &str = ".elef";
const LIBRARY_CONFIG_FILE: &str = "config.json";
const LIBRARY_CONFIG_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeckManifest {
    pub id: Uuid,
    pub schema_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Fingerprint {
    pub modified_ms: u128,
    pub size: u64,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeckSummary {
    pub id: String,
    pub name: String,
    pub path: String,
    pub modified_ms: u128,
    pub source_file: String,
    pub kind: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenDeck {
    pub id: String,
    pub name: String,
    pub source: String,
    pub source_file: String,
    pub content_hash: String,
    pub fingerprint: Fingerprint,
    pub manifest: Option<DeckManifest>,
    pub notices: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceSnapshot {
    pub source: String,
    pub source_file: String,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SaveResult {
    pub ok: bool,
    pub saved_at_ms: u128,
    pub content_hash: String,
    pub fingerprint: Fingerprint,
    #[serde(skip)]
    pub check_to_rename_us: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LibraryConfig {
    pub schema_version: u32,
    pub theme: String,
    #[serde(default)]
    pub hotkeys: BTreeMap<String, String>,
}

impl Default for LibraryConfig {
    fn default() -> Self {
        Self {
            schema_version: LIBRARY_CONFIG_SCHEMA_VERSION,
            theme: "system".into(),
            hotkeys: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportResult {
    pub deck: DeckSummary,
    pub replaced: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportResolution {
    Replace,
    KeepBoth,
}

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("The library root is unavailable.")]
    InvalidLibrary,
    #[error("The deck could not be found.")]
    NotFound,
    #[error("The requested name or source is invalid.")]
    InvalidInput,
    #[error("The requested path is outside the library or is a symbolic link.")]
    PathRejected,
    #[error("The source is too large.")]
    TooLarge,
    #[error("The file changed outside Elef. Reload it or resolve the conflict before saving.")]
    Conflict {
        disk_hash: String,
        disk_source: String,
        disk_source_file: String,
    },
    #[error("A deck with this identity already exists in the library.")]
    ImportConflict {
        incoming_name: String,
        existing_name: String,
    },
    #[error("The file operation failed.")]
    Io(#[source] std::io::Error),
}

impl CoreError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidLibrary => "invalid_library",
            Self::NotFound => "not_found",
            Self::InvalidInput => "invalid_input",
            Self::PathRejected => "path_rejected",
            Self::TooLarge => "too_large",
            Self::Conflict { .. } => "conflict",
            Self::ImportConflict { .. } => "import_conflict",
            Self::Io(_) => "io_error",
        }
    }
}

impl From<std::io::Error> for CoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

#[derive(Debug, Clone)]
struct DeckRecord {
    id: String,
    path: PathBuf,
    source_path: PathBuf,
    source_file: String,
    manifest: Option<DeckManifest>,
    notices: Vec<String>,
    identity_repair: bool,
}

pub struct Library {
    root: PathBuf,
    records: RwLock<HashMap<String, DeckRecord>>,
    write_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
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
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn list_decks(&self) -> Result<Vec<DeckSummary>, CoreError> {
        let records = self.discover_decks()?;
        let mut summaries = records
            .values()
            .map(|record| self.summary(record))
            .collect::<Vec<_>>();
        summaries.sort_by_key(|deck| {
            (
                normalized_name(&deck.name),
                deck.path.to_lowercase(),
                deck.path.clone(),
            )
        });
        *self.records.write().expect("deck index lock poisoned") = records;
        Ok(summaries)
    }

    pub fn deck_summary(&self, id: &str) -> Result<DeckSummary, CoreError> {
        let record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        Ok(self.summary(&record))
    }

    pub fn read_config(&self) -> Result<LibraryConfig, CoreError> {
        let directory = self.root.join(LIBRARY_CONFIG_DIR);
        let metadata = match fs::symlink_metadata(&directory) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(LibraryConfig::default());
            }
            Err(error) => return Err(CoreError::Io(error)),
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(CoreError::PathRejected);
        }
        let canonical_directory = fs::canonicalize(&directory)?;
        if canonical_directory.parent() != Some(self.root.as_path()) {
            return Err(CoreError::PathRejected);
        }
        let path = canonical_directory.join(LIBRARY_CONFIG_FILE);
        match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(LibraryConfig::default());
            }
            Err(error) => return Err(CoreError::Io(error)),
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(CoreError::PathRejected);
            }
            Ok(_) => {}
        }
        let bytes = read_regular_file_limited(&path, 1024 * 1024)?;
        let config: LibraryConfig =
            serde_json::from_slice(&bytes).map_err(|_| CoreError::InvalidInput)?;
        validate_library_config(&config)?;
        Ok(config)
    }

    pub fn write_config(&self, config: &LibraryConfig) -> Result<(), CoreError> {
        validate_library_config(config)?;
        let directory = self.root.join(LIBRARY_CONFIG_DIR);
        match fs::symlink_metadata(&directory) {
            Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
                return Err(CoreError::PathRejected);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&directory)?;
            }
            Err(error) => return Err(CoreError::Io(error)),
        }
        let canonical_directory = fs::canonicalize(&directory)?;
        if canonical_directory.parent() != Some(self.root.as_path()) {
            return Err(CoreError::PathRejected);
        }
        let path = canonical_directory.join(LIBRARY_CONFIG_FILE);
        write_file_atomic(
            &path,
            &serde_json::to_vec_pretty(config).map_err(|_| CoreError::InvalidInput)?,
        )
    }

    pub fn open_deck(&self, id: &str) -> Result<OpenDeck, CoreError> {
        let mut record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        remove_stale_temps(&record.path)?;

        if record.identity_repair {
            let manifest = DeckManifest {
                id: Uuid::new_v4(),
                schema_version: MANIFEST_SCHEMA_VERSION,
            };
            match write_manifest_atomic(&record.path, &manifest) {
                Ok(()) => {
                    record.id = manifest.id.to_string();
                    record.manifest = Some(manifest);
                    record.identity_repair = false;
                    record.notices.clear();
                }
                Err(_) => {
                    record.notices.push(
                        "This duplicate deck identity could not be repaired because the folder is read-only. Its path is used as identity.".into(),
                    );
                }
            }
        } else if record.manifest.is_none() && !record.path.join(MANIFEST_FILE).exists() {
            let manifest = DeckManifest {
                id: Uuid::new_v4(),
                schema_version: MANIFEST_SCHEMA_VERSION,
            };
            match write_manifest_atomic(&record.path, &manifest) {
                Ok(()) => {
                    record.id = manifest.id.to_string();
                    record.manifest = Some(manifest);
                    record.identity_repair = false;
                    record.notices.clear();
                }
                Err(_) => {
                    record.notices.push(
                        "This folder is read-only. Its identity is based on its current path."
                            .into(),
                    );
                }
            }
        }

        let source = read_regular_file(&record.source_path)?;
        let fingerprint = fingerprint_bytes(&source, &record.source_path)?;
        let source = String::from_utf8(source).map_err(|_| CoreError::InvalidInput)?;
        let result = OpenDeck {
            id: record.id.clone(),
            name: file_name(&record.path),
            source,
            source_file: record.source_file.clone(),
            content_hash: fingerprint.content_hash.clone(),
            fingerprint,
            manifest: record.manifest.clone(),
            notices: record.notices.clone(),
        };
        self.refresh_record(record);
        Ok(result)
    }

    pub fn read_source_snapshot(&self, id: &str) -> Result<SourceSnapshot, CoreError> {
        let mut record = self.record(id)?;
        let path_missing = match self.validate_deck_path(&record.path) {
            Ok(()) => false,
            Err(CoreError::NotFound) => true,
            Err(error) => return Err(error),
        };
        let source_changed = !path_missing
            && choose_source_file(&record.path)?.as_deref() != Some(record.source_file.as_str());
        if path_missing || source_changed {
            self.list_decks()?;
            record = self.record(id)?;
        }
        self.validate_deck_path(&record.path)?;
        let bytes = read_regular_file(&record.source_path)?;
        let content_hash = sha256(&bytes);
        let source = String::from_utf8(bytes).map_err(|_| CoreError::InvalidInput)?;
        Ok(SourceSnapshot {
            source,
            source_file: record.source_file,
            content_hash,
        })
    }

    pub fn create_deck(&self, name: &str, kind: &str) -> Result<OpenDeck, CoreError> {
        validate_deck_name(name)?;
        if !matches!(kind, "presentation" | "document") {
            return Err(CoreError::InvalidInput);
        }

        let path = self.root.join(name);
        if path.exists() || self.name_collision_exists(name)? {
            return Err(CoreError::InvalidInput);
        }
        fs::create_dir(&path)?;

        let source_file = if kind == "document" {
            "document.md"
        } else {
            "presentation.md"
        };
        let source = format!("# {name}\n\n");
        write_new_file(&path.join(source_file), source.as_bytes())?;
        let manifest = DeckManifest {
            id: Uuid::new_v4(),
            schema_version: MANIFEST_SCHEMA_VERSION,
        };
        let mut notices = Vec::new();
        if write_manifest_atomic(&path, &manifest).is_err() {
            notices.push("The deck opened, but its identity manifest could not be saved.".into());
        }

        let canonical_path = fs::canonicalize(&path)?;
        let record = DeckRecord {
            id: if notices.is_empty() {
                manifest.id.to_string()
            } else {
                path_id(&canonical_path)
            },
            path: canonical_path.clone(),
            source_path: canonical_path.join(source_file),
            source_file: source_file.into(),
            manifest: if notices.is_empty() {
                Some(manifest)
            } else {
                None
            },
            notices,
            identity_repair: false,
        };
        let id = record.id.clone();
        self.refresh_record(record);
        self.open_deck(&id)
    }

    pub fn rename_deck(&self, id: &str, new_name: &str) -> Result<DeckSummary, CoreError> {
        validate_deck_name(new_name)?;
        let record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        if self.name_collision_exists(new_name)?
            && normalized_name(&file_name(&record.path)) != normalized_name(new_name)
        {
            return Err(CoreError::InvalidInput);
        }

        let target = self.root.join(new_name);
        if target.exists() && target != record.path {
            return Err(CoreError::InvalidInput);
        }
        fs::rename(&record.path, &target)?;
        let canonical_path = fs::canonicalize(&target)?;
        let source_path = canonical_path.join(&record.source_file);
        let renamed = DeckRecord {
            id: record.id,
            path: canonical_path,
            source_path,
            source_file: record.source_file,
            manifest: record.manifest,
            notices: record.notices,
            identity_repair: record.identity_repair,
        };
        let summary = self.summary(&renamed);
        self.refresh_record(renamed);
        Ok(summary)
    }

    pub fn delete_deck(&self, id: &str) -> Result<(), CoreError> {
        let record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        trash::delete(&record.path)
            .map_err(|_| CoreError::Io(std::io::Error::other("trash failed")))?;
        self.records
            .write()
            .expect("deck index lock poisoned")
            .remove(id);
        Ok(())
    }

    pub fn save_source(
        &self,
        id: &str,
        source: &str,
        base_hash: &str,
    ) -> Result<SaveResult, CoreError> {
        if source.len() > MAX_SOURCE_BYTES {
            return Err(CoreError::TooLarge);
        }
        if !is_sha256(base_hash) {
            return Err(CoreError::InvalidInput);
        }

        let lock = self.write_lock(id);
        let _guard = lock.lock().expect("deck write lock poisoned");
        let record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        let selected_source_file = source_file_for_write(&record.path, &record.source_path)?;
        if selected_source_file != record.source_file {
            self.list_decks()?;
            let current = self.record(id)?;
            let current_bytes = read_regular_file(&current.source_path)?;
            return Err(conflict_error(
                sha256(&current_bytes),
                current_bytes,
                current.source_file,
            ));
        }
        let disk_bytes = read_regular_file(&record.source_path)?;
        let disk_hash = sha256(&disk_bytes);
        if disk_hash != base_hash {
            return Err(conflict_error(
                disk_hash,
                disk_bytes,
                record.source_file.clone(),
            ));
        }

        let mut temp = TempFileBuilder::new()
            .prefix(".elef-save-")
            .suffix(".tmp")
            .tempfile_in(&record.path)?;
        let original_permissions = fs::metadata(&record.source_path)?.permissions();
        temp.as_file().set_permissions(original_permissions)?;
        temp.write_all(source.as_bytes())?;
        temp.as_file().sync_all()?;

        // Narrow the check/rename race immediately before replacing the target.
        let selected_source_file = source_file_for_write(&record.path, &record.source_path)?;
        if selected_source_file != record.source_file {
            self.list_decks()?;
            let current = self.record(id)?;
            let current_bytes = read_regular_file(&current.source_path)?;
            return Err(conflict_error(
                sha256(&current_bytes),
                current_bytes,
                current.source_file,
            ));
        }
        let current_bytes = read_regular_file(&record.source_path)?;
        let current_hash = sha256(&current_bytes);
        if current_hash != base_hash {
            return Err(conflict_error(
                current_hash,
                current_bytes,
                record.source_file.clone(),
            ));
        }

        let verified_at = Instant::now();
        temp.persist(&record.source_path)
            .map_err(|error| CoreError::Io(error.error))?;
        let check_to_rename_us = verified_at.elapsed().as_micros();
        sync_directory(&record.path)?;

        let now = now_ms();
        let fingerprint = fingerprint_bytes(source.as_bytes(), &record.source_path)?;
        Ok(SaveResult {
            ok: true,
            saved_at_ms: now,
            content_hash: fingerprint.content_hash.clone(),
            fingerprint,
            check_to_rename_us,
        })
    }

    pub fn export_elef<W: Write + Seek>(&self, id: &str, destination: W) -> Result<(), CoreError> {
        let record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        let mut items = Vec::new();
        collect_archive_items(&record.path, &record.path, &mut items)?;
        items.sort_by(|left, right| left.name.cmp(&right.name));

        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .compression_level(Some(6))
            .last_modified_time(DateTime::default())
            .unix_permissions(0o100644);
        let mut archive = ZipWriter::new(destination);
        let mut total_bytes = 0_u64;
        for item in items {
            if item.is_directory {
                archive
                    .add_directory(format!("{}/", item.name), options)
                    .map_err(map_zip_error)?;
                continue;
            }
            let metadata = fs::metadata(&item.path)?;
            total_bytes = total_bytes
                .checked_add(metadata.len())
                .ok_or(CoreError::TooLarge)?;
            if total_bytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES {
                return Err(CoreError::TooLarge);
            }
            archive
                .start_file(&item.name, options)
                .map_err(map_zip_error)?;
            let mut file = read_regular_file_handle(&item.path)?;
            std::io::copy(&mut file, &mut archive)?;
        }
        archive.finish().map_err(map_zip_error)?;
        Ok(())
    }

    pub fn import_elef(
        &self,
        archive_path: impl AsRef<Path>,
        resolution: Option<ImportResolution>,
    ) -> Result<ImportResult, CoreError> {
        let archive_path = archive_path.as_ref();
        let archive_metadata = fs::symlink_metadata(archive_path)?;
        if !archive_metadata.is_file() || archive_metadata.file_type().is_symlink() {
            return Err(CoreError::PathRejected);
        }
        if archive_metadata.len() > MAX_ARCHIVE_FILE_BYTES {
            return Err(CoreError::TooLarge);
        }
        let archive_file = open_regular_file(archive_path)?;
        if archive_file.metadata()?.len() > MAX_ARCHIVE_FILE_BYTES {
            return Err(CoreError::TooLarge);
        }
        let mut archive = ZipArchive::new(archive_file).map_err(|_| CoreError::InvalidInput)?;
        if archive.len() > MAX_ARCHIVE_ENTRIES {
            return Err(CoreError::TooLarge);
        }

        let staging = TempFileBuilder::new()
            .prefix(".elef-import-")
            .tempdir_in(&self.root)?;
        let archive_name = extract_archive(&mut archive, staging.path())?;
        let source_file = choose_source_file(staging.path())?.ok_or(CoreError::InvalidInput)?;
        let manifest = read_manifest(staging.path()).map_err(|_| CoreError::InvalidInput)?;
        let incoming_name = archive_name
            .or_else(|| {
                archive_path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| "Imported deck".into());
        validate_deck_name(&incoming_name)?;

        self.list_decks()?;
        let collision = manifest.as_ref().and_then(|manifest| {
            self.records
                .read()
                .expect("deck index lock poisoned")
                .values()
                .find(|record| record.id == manifest.id.to_string())
                .cloned()
        });
        if let Some(existing) = &collision
            && resolution.is_none()
        {
            return Err(CoreError::ImportConflict {
                incoming_name,
                existing_name: file_name(&existing.path),
            });
        }

        let replaced = matches!(resolution, Some(ImportResolution::Replace)) && collision.is_some();
        let destination_name = if replaced {
            file_name(&collision.as_ref().expect("collision checked").path)
        } else {
            self.available_deck_name(&incoming_name)?
        };
        let destination = self.root.join(&destination_name);

        if collision.is_some()
            && matches!(resolution, Some(ImportResolution::KeepBoth))
            && let Some(mut manifest) = manifest.clone()
        {
            manifest.id = Uuid::new_v4();
            write_manifest_atomic(staging.path(), &manifest)?;
        }

        if let Some(existing) = collision.filter(|_| replaced) {
            self.validate_deck_path(&existing.path)?;
            trash::delete(&existing.path)
                .map_err(|_| CoreError::Io(std::io::Error::other("trash failed")))?;
            self.records
                .write()
                .expect("deck index lock poisoned")
                .remove(&existing.id);
        }

        fs::rename(staging.path(), &destination)?;
        let canonical_path = fs::canonicalize(&destination)?;
        if canonical_path.parent() != Some(self.root.as_path()) {
            return Err(CoreError::PathRejected);
        }
        let source_path = canonical_path.join(source_file);
        if !source_path.is_file() {
            return Err(CoreError::InvalidInput);
        }
        self.list_decks()?;
        let deck = self
            .records
            .read()
            .expect("deck index lock poisoned")
            .values()
            .find(|record| record.path == canonical_path)
            .map(|record| self.summary(record))
            .ok_or(CoreError::InvalidInput)?;
        Ok(ImportResult { deck, replaced })
    }

    fn available_deck_name(&self, requested: &str) -> Result<String, CoreError> {
        if !self.name_collision_exists(requested)? {
            return Ok(requested.into());
        }
        for suffix in 2..=10_000 {
            let candidate = format!("{requested} ({suffix})");
            if !self.name_collision_exists(&candidate)? {
                return Ok(candidate);
            }
        }
        Err(CoreError::InvalidInput)
    }

    fn discover_decks(&self) -> Result<HashMap<String, DeckRecord>, CoreError> {
        let mut directories = fs::read_dir(&self.root)?
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let name = entry.file_name();
                if name.to_string_lossy().starts_with(".") {
                    return None;
                }
                let file_type = entry.file_type().ok()?;
                if !file_type.is_dir() || file_type.is_symlink() {
                    return None;
                }
                Some(entry.path())
            })
            .collect::<Vec<_>>();
        directories.sort_by_key(|path| {
            let text = path.to_string_lossy().into_owned();
            (text.to_lowercase(), text)
        });

        let mut records = Vec::new();
        for path in directories {
            let canonical_path = match fs::canonicalize(&path) {
                Ok(canonical) if canonical.parent() == Some(self.root.as_path()) => canonical,
                _ => continue,
            };
            let Some(source_file) = choose_source_file(&canonical_path)? else {
                continue;
            };
            let manifest = read_manifest(&canonical_path);
            let source_path = canonical_path.join(&source_file);
            let (id, notices) = match &manifest {
                Ok(Some(manifest)) => (manifest.id.to_string(), manifest_notices(manifest)),
                Ok(None) => (path_id(&canonical_path), Vec::new()),
                Err(()) => (
                    path_id(&canonical_path),
                    vec!["The deck manifest is invalid; its path is used as identity.".into()],
                ),
            };
            records.push(DeckRecord {
                id,
                path: canonical_path,
                source_path,
                source_file,
                manifest: manifest.ok().flatten(),
                notices,
                identity_repair: false,
            });
        }

        let mut groups: BTreeMap<String, Vec<DeckRecord>> = BTreeMap::new();
        for record in records {
            groups.entry(record.id.clone()).or_default().push(record);
        }

        let mut result = HashMap::new();
        for (_id, mut group) in groups {
            let duplicated = group.len() > 1;
            group.sort_by_key(|record| {
                let text = record.path.to_string_lossy().into_owned();
                (text.to_lowercase(), text)
            });
            for (index, mut record) in group.into_iter().enumerate() {
                if index > 0 && record.manifest.is_some() {
                    record.id = path_id(&record.path);
                    record.identity_repair = true;
                } else if duplicated && index > 0 {
                    record.id = path_id(&record.path);
                }
                result.insert(record.id.clone(), record);
            }
        }
        Ok(result)
    }

    fn record(&self, id: &str) -> Result<DeckRecord, CoreError> {
        self.records
            .read()
            .expect("deck index lock poisoned")
            .get(id)
            .cloned()
            .ok_or(CoreError::NotFound)
    }

    fn refresh_record(&self, record: DeckRecord) {
        let mut records = self.records.write().expect("deck index lock poisoned");
        records.retain(|_, existing| existing.path != record.path);
        records.insert(record.id.clone(), record);
    }

    fn summary(&self, record: &DeckRecord) -> DeckSummary {
        let metadata = fs::metadata(&record.path).ok();
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

    fn validate_deck_path(&self, path: &Path) -> Result<(), CoreError> {
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

    fn name_collision_exists(&self, name: &str) -> Result<bool, CoreError> {
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

    fn write_lock(&self, id: &str) -> Arc<Mutex<()>> {
        let mut locks = self.write_locks.lock().expect("write lock table poisoned");
        locks
            .entry(id.to_owned())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

#[derive(Debug)]
struct ArchiveItem {
    name: String,
    path: PathBuf,
    is_directory: bool,
}

#[derive(Debug)]
struct ArchiveMember {
    index: usize,
    name: String,
    is_directory: bool,
    size: u64,
}

fn collect_archive_items(
    deck_root: &Path,
    current: &Path,
    items: &mut Vec<ArchiveItem>,
) -> Result<(), CoreError> {
    let mut entries = fs::read_dir(current)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            return Err(CoreError::PathRejected);
        }
        let relative = path
            .strip_prefix(deck_root)
            .map_err(|_| CoreError::PathRejected)?;
        let name = relative
            .to_str()
            .ok_or(CoreError::InvalidInput)?
            .replace('\\', "/");
        if name.split('/').any(|component| {
            component.is_empty() || component == "." || component == ".." || component.contains(':')
        }) {
            return Err(CoreError::PathRejected);
        }
        let leaf_name = Path::new(&name)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if leaf_name.starts_with(".elef-save-") && leaf_name.ends_with(".tmp") {
            continue;
        }
        if file_type.is_dir() {
            items.push(ArchiveItem {
                name,
                path: path.clone(),
                is_directory: true,
            });
            collect_archive_items(deck_root, &path, items)?;
        } else if file_type.is_file() {
            items.push(ArchiveItem {
                name,
                path,
                is_directory: false,
            });
        } else {
            return Err(CoreError::PathRejected);
        }
    }
    Ok(())
}

fn extract_archive<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    staging_root: &Path,
) -> Result<Option<String>, CoreError> {
    if archive.is_empty() || archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(if archive.len() > MAX_ARCHIVE_ENTRIES {
            CoreError::TooLarge
        } else {
            CoreError::InvalidInput
        });
    }
    let mut members = Vec::with_capacity(archive.len());
    let mut seen = HashSet::new();
    let mut total_size = 0_u64;
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|_| CoreError::InvalidInput)?;
        if file.encrypted() || file.is_symlink() {
            return Err(CoreError::PathRejected);
        }
        let raw_name = std::str::from_utf8(file.name_raw()).map_err(|_| CoreError::InvalidInput)?;
        let is_directory = file.is_dir() || raw_name.ends_with('/');
        let name = validate_archive_path(raw_name, is_directory)?;
        let collision_key = normalized_name(&name);
        if !seen.insert(collision_key) {
            return Err(CoreError::InvalidInput);
        }
        if let Some(mode) = file.unix_mode() {
            let file_kind = mode & 0o170000;
            if file_kind != 0 && !matches!(file_kind, 0o100000 | 0o040000)
                || is_directory && file_kind == 0o100000
                || !is_directory && file_kind == 0o040000
            {
                return Err(CoreError::PathRejected);
            }
        }
        if !is_directory {
            total_size = total_size
                .checked_add(file.size())
                .ok_or(CoreError::TooLarge)?;
            if total_size > MAX_ARCHIVE_UNCOMPRESSED_BYTES {
                return Err(CoreError::TooLarge);
            }
            if file.size() >= MAX_ARCHIVE_RATIO_CHECK_BYTES
                && (file.compressed_size() == 0
                    || file.size() / file.compressed_size().max(1) > MAX_ARCHIVE_COMPRESSION_RATIO)
            {
                return Err(CoreError::TooLarge);
            }
        } else if file.size() != 0 {
            return Err(CoreError::InvalidInput);
        }
        members.push(ArchiveMember {
            index,
            name,
            is_directory,
            size: file.size(),
        });
    }

    let wrapper = single_wrapper_name(&members);
    let mut extracted_size = 0_u64;
    for member in members {
        let relative = if let Some(wrapper_name) = wrapper.as_deref() {
            if member.name == wrapper_name {
                continue;
            }
            member
                .name
                .strip_prefix(wrapper_name)
                .and_then(|tail| tail.strip_prefix('/'))
                .ok_or(CoreError::PathRejected)?
                .to_owned()
        } else {
            member.name.clone()
        };
        if relative.is_empty() {
            continue;
        }
        let relative_path = Path::new(&relative);
        let destination = staging_root.join(relative_path);
        if !destination.starts_with(staging_root) {
            return Err(CoreError::PathRejected);
        }
        if member.is_directory {
            fs::create_dir_all(&destination)?;
            continue;
        }
        let parent = destination.parent().ok_or(CoreError::PathRejected)?;
        fs::create_dir_all(parent)?;
        let canonical_parent = fs::canonicalize(parent)?;
        let canonical_root = fs::canonicalize(staging_root)?;
        if !canonical_parent.starts_with(&canonical_root) {
            return Err(CoreError::PathRejected);
        }
        let mut input = archive
            .by_index(member.index)
            .map_err(|_| CoreError::InvalidInput)?;
        let mut output = create_new_file(&destination)?;
        let copied = std::io::copy(&mut input, &mut output)?;
        extracted_size = extracted_size
            .checked_add(copied)
            .ok_or(CoreError::TooLarge)?;
        if copied != member.size || extracted_size > MAX_ARCHIVE_UNCOMPRESSED_BYTES {
            return Err(CoreError::InvalidInput);
        }
        output.sync_all()?;
    }
    Ok(wrapper)
}

fn validate_archive_path(raw_name: &str, is_directory: bool) -> Result<String, CoreError> {
    if raw_name.is_empty()
        || raw_name.starts_with('/')
        || raw_name.starts_with('\\')
        || raw_name.contains('\\')
        || raw_name.contains('\0')
        || raw_name.as_bytes().get(1) == Some(&b':')
    {
        return Err(CoreError::PathRejected);
    }
    let trimmed = if is_directory {
        raw_name.strip_suffix('/').unwrap_or(raw_name)
    } else {
        raw_name
    };
    if trimmed.is_empty() {
        return Err(CoreError::PathRejected);
    }
    let components = trimmed.split('/').collect::<Vec<_>>();
    if components.iter().any(|component| {
        component.is_empty()
            || *component == "."
            || *component == ".."
            || component.contains(':')
            || component.chars().any(char::is_control)
    }) {
        return Err(CoreError::PathRejected);
    }
    Ok(components.join("/"))
}

fn single_wrapper_name(members: &[ArchiveMember]) -> Option<String> {
    let first_file = members.iter().find(|member| !member.is_directory)?;
    let first_component = first_file.name.split('/').next()?;
    if first_component.is_empty() {
        return None;
    }
    let every_file_nested = members
        .iter()
        .filter(|member| !member.is_directory)
        .all(|member| member.name.split('/').count() >= 2);
    let every_entry_under_wrapper = members.iter().all(|member| {
        member.name == first_component && member.is_directory
            || member.name.starts_with(&format!("{first_component}/"))
    });
    (every_file_nested && every_entry_under_wrapper).then(|| first_component.to_owned())
}

fn validate_library_config(config: &LibraryConfig) -> Result<(), CoreError> {
    if config.schema_version == 0
        || !matches!(config.theme.as_str(), "system" | "light" | "dark")
        || config.hotkeys.len() > 100
        || config.hotkeys.iter().any(|(action, binding)| {
            action.is_empty()
                || action.len() > 80
                || binding.len() > 80
                || action.chars().any(char::is_control)
                || binding.chars().any(char::is_control)
        })
    {
        return Err(CoreError::InvalidInput);
    }
    Ok(())
}

fn write_file_atomic(path: &Path, bytes: &[u8]) -> Result<(), CoreError> {
    let parent = path.parent().ok_or(CoreError::PathRejected)?;
    if let Ok(metadata) = fs::symlink_metadata(path)
        && (metadata.file_type().is_symlink() || !metadata.is_file())
    {
        return Err(CoreError::PathRejected);
    }
    let mut temp = TempFileBuilder::new()
        .prefix(".elef-config-")
        .suffix(".tmp")
        .tempfile_in(parent)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path)
        .map_err(|error| CoreError::Io(error.error))?;
    sync_directory(parent)?;
    Ok(())
}

fn read_regular_file_handle(path: &Path) -> Result<File, CoreError> {
    open_regular_file(path)
}

fn open_regular_file(path: &Path) -> Result<File, CoreError> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(CoreError::PathRejected);
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    let file = options.open(path)?;
    if !file.metadata()?.is_file() {
        return Err(CoreError::PathRejected);
    }
    Ok(file)
}

fn map_zip_error(error: zip::result::ZipError) -> CoreError {
    match error {
        zip::result::ZipError::Io(error) => CoreError::Io(error),
        _ => CoreError::InvalidInput,
    }
}

fn choose_source_file(deck_path: &Path) -> Result<Option<String>, CoreError> {
    let mut candidates = fs::read_dir(deck_path)?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if !file_type.is_file() || file_type.is_symlink() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(".") || !Path::new(&name).extension()?.eq_ignore_ascii_case("md") {
                return None;
            }
            Some(name)
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|name| source_file_key(name));
    Ok(candidates.into_iter().next())
}

fn source_file_for_write(
    deck_path: &Path,
    previous_source_path: &Path,
) -> Result<String, CoreError> {
    if let Some(source_file) = choose_source_file(deck_path)? {
        return Ok(source_file);
    }
    if fs::symlink_metadata(previous_source_path)
        .is_ok_and(|metadata| metadata.file_type().is_symlink())
    {
        return Err(CoreError::PathRejected);
    }
    Err(CoreError::NotFound)
}

fn source_file_key(name: &str) -> (u8, usize, String, String) {
    let preferred = if name.eq_ignore_ascii_case("presentation.md") {
        0
    } else if name.eq_ignore_ascii_case("document.md") {
        1
    } else {
        2
    };
    (
        preferred,
        name.chars().count(),
        name.to_lowercase(),
        name.to_owned(),
    )
}

fn read_manifest(deck_path: &Path) -> Result<Option<DeckManifest>, ()> {
    let path = deck_path.join(MANIFEST_FILE);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(());
    }
    let bytes = read_regular_file_limited(&path, 64 * 1024).map_err(|_| ())?;
    let raw: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| ())?;
    let id = raw
        .get("id")
        .and_then(serde_json::Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or(())?;
    let schema_version = raw
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or(())?;
    Ok(Some(DeckManifest { id, schema_version }))
}

fn manifest_notices(manifest: &DeckManifest) -> Vec<String> {
    if manifest.schema_version > MANIFEST_SCHEMA_VERSION {
        vec!["This deck uses a newer Elef folder format; known fields were read.".into()]
    } else {
        Vec::new()
    }
}

fn write_manifest_atomic(deck_path: &Path, manifest: &DeckManifest) -> Result<(), CoreError> {
    let bytes = serde_json::to_vec_pretty(manifest).map_err(|_| CoreError::InvalidInput)?;
    let mut temp = TempFileBuilder::new()
        .prefix(".elef-manifest-")
        .suffix(".tmp")
        .tempfile_in(deck_path)?;
    temp.write_all(&bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(deck_path.join(MANIFEST_FILE))
        .map_err(|error| CoreError::Io(error.error))?;
    sync_directory(deck_path)
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), CoreError> {
    let mut file = create_new_file(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    if let Some(parent) = path.parent() {
        sync_directory(parent)?;
    }
    Ok(())
}

fn create_new_file(path: &Path) -> Result<File, CoreError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW);
    Ok(options.open(path)?)
}

fn read_regular_file(path: &Path) -> Result<Vec<u8>, CoreError> {
    read_regular_file_limited(path, MAX_SOURCE_BYTES as u64)
}

fn read_regular_file_limited(path: &Path, max_bytes: u64) -> Result<Vec<u8>, CoreError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            CoreError::NotFound
        } else {
            CoreError::Io(error)
        }
    })?;
    if metadata.len() > max_bytes {
        return Err(CoreError::TooLarge);
    }
    let file = open_regular_file(path)?;
    let mut bytes = Vec::new();
    file.take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max_bytes {
        return Err(CoreError::TooLarge);
    }
    Ok(bytes)
}

fn fingerprint_bytes(bytes: &[u8], path: &Path) -> Result<Fingerprint, CoreError> {
    let modified_ms = fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(system_time_ms)
        .unwrap_or_default();
    Ok(Fingerprint {
        modified_ms,
        size: bytes.len() as u64,
        content_hash: sha256(bytes),
    })
}

fn conflict_error(disk_hash: String, disk_bytes: Vec<u8>, disk_source_file: String) -> CoreError {
    CoreError::Conflict {
        disk_hash,
        disk_source: String::from_utf8_lossy(&disk_bytes).into_owned(),
        disk_source_file,
    }
}

fn remove_stale_temps(deck_path: &Path) -> Result<(), CoreError> {
    let now = SystemTime::now();
    for entry in fs::read_dir(deck_path)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with(".elef-save-") || !name.ends_with(".tmp") {
            continue;
        }
        let metadata = entry.file_type()?;
        if !metadata.is_file() || metadata.is_symlink() {
            continue;
        }
        let old_enough = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .map(|age| age.as_secs() >= STALE_TEMP_AGE_SECONDS)
            .unwrap_or(false);
        if old_enough {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

fn sync_directory(path: &Path) -> Result<(), CoreError> {
    File::open(path)?.sync_all()?;
    Ok(())
}

fn path_id(path: &Path) -> String {
    format!("path:{}", sha256(path.to_string_lossy().as_bytes()))
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn system_time_ms(time: SystemTime) -> Option<u128> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis())
}

fn validate_deck_name(name: &str) -> Result<(), CoreError> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed != name
        || name == "."
        || name == ".."
        || name.starts_with('.')
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
        || Path::new(name)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(CoreError::InvalidInput);
    }
    Ok(())
}

fn normalized_name(name: &str) -> String {
    name.nfc().collect::<String>().to_lowercase()
}

fn name_warnings(name: &str) -> Vec<String> {
    let mut warnings = Vec::new();
    if name
        .chars()
        .any(|character| "/\\:*?\"<>|".contains(character))
        || name.ends_with('.')
        || name.ends_with(' ')
        || is_reserved_device_name(name)
    {
        warnings.push("This folder name may not work on every supported filesystem.".into());
    }
    warnings
}

fn is_reserved_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or_default().to_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem
                .chars()
                .last()
                .is_some_and(|number| ('1'..='9').contains(&number)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use tempfile::TempDir;

    fn library() -> (TempDir, Library) {
        let temp = TempDir::new().unwrap();
        let library = Library::open(temp.path()).unwrap();
        (temp, library)
    }

    fn write_deck(root: &Path, name: &str, files: &[(&str, &str)]) -> PathBuf {
        let path = root.join(name);
        fs::create_dir(&path).unwrap();
        for (file, content) in files {
            fs::write(path.join(file), content).unwrap();
        }
        path
    }

    #[test]
    fn source_file_rule_prefers_named_then_shorter_then_alphabetical() {
        let (temp, _) = library();
        let path = write_deck(
            temp.path(),
            "Talk",
            &[
                ("talk (conflicted copy).md", "conflict"),
                ("z.md", "z"),
                ("a.md", "a"),
                ("presentation.md", "preferred"),
                ("document.md", "second"),
            ],
        );
        assert_eq!(
            choose_source_file(&path).unwrap().as_deref(),
            Some("presentation.md")
        );
        fs::remove_file(path.join("presentation.md")).unwrap();
        assert_eq!(
            choose_source_file(&path).unwrap().as_deref(),
            Some("document.md")
        );
        fs::remove_file(path.join("document.md")).unwrap();
        assert_eq!(choose_source_file(&path).unwrap().as_deref(), Some("a.md"));
    }

    #[cfg(unix)]
    #[test]
    fn scan_ignores_dot_folders_nested_markdown_and_symlink_decks() {
        let (temp, library) = library();
        write_deck(temp.path(), "Good", &[("presentation.md", "# good")]);
        let notes = temp.path().join("Notes");
        fs::create_dir(&notes).unwrap();
        fs::create_dir(notes.join("nested")).unwrap();
        fs::write(notes.join("nested/deep.md"), "not a deck").unwrap();
        write_deck(temp.path(), ".hidden", &[("notes.md", "hidden")]);
        symlink(temp.path().join("Good"), temp.path().join("Linked")).unwrap();

        let decks = library.list_decks().unwrap();
        assert_eq!(decks.len(), 1);
        assert_eq!(decks[0].name, "Good");
    }

    #[test]
    fn first_open_creates_manifest_and_returns_content_fingerprint() {
        let (temp, library) = library();
        let deck = write_deck(temp.path(), "My Deck", &[("talk.md", "# Notes\n")]);
        let id = path_id(&deck.canonicalize().unwrap());
        library.list_decks().unwrap();

        let opened = library.open_deck(&id).unwrap();
        assert_eq!(opened.source, "# Notes\n");
        assert_eq!(opened.fingerprint.content_hash, sha256(b"# Notes\n"));
        assert!(opened.manifest.is_some());
        assert!(deck.join(MANIFEST_FILE).is_file());
    }

    #[test]
    fn source_snapshot_detects_external_bytes_without_writing_manifest() {
        let (temp, library) = library();
        let deck = write_deck(temp.path(), "External", &[("presentation.md", "first")]);
        let id = path_id(&deck.canonicalize().unwrap());
        library.list_decks().unwrap();

        let first = library.read_source_snapshot(&id).unwrap();
        assert_eq!(first.source, "first");
        assert_eq!(first.source_file, "presentation.md");
        assert_eq!(first.content_hash, sha256(b"first"));
        assert!(!deck.join(MANIFEST_FILE).exists());

        fs::write(deck.join("presentation.md"), "external").unwrap();
        let changed = library.read_source_snapshot(&id).unwrap();
        assert_eq!(changed.source, "external");
        assert_eq!(changed.source_file, "presentation.md");
        assert_ne!(changed.content_hash, first.content_hash);
        assert!(!deck.join(MANIFEST_FILE).exists());
    }

    #[test]
    fn source_snapshot_tracks_source_rule_changes_without_creating_a_manifest() {
        let (temp, library) = library();
        let deck = write_deck(temp.path(), "Source Choice", &[("talk.md", "same bytes")]);
        let id = path_id(&deck.canonicalize().unwrap());
        library.list_decks().unwrap();

        let first = library.read_source_snapshot(&id).unwrap();
        assert_eq!(first.source_file, "talk.md");
        fs::write(deck.join("presentation.md"), "preferred source").unwrap();

        let changed = library.read_source_snapshot(&id).unwrap();
        assert_eq!(changed.source_file, "presentation.md");
        assert_eq!(changed.source, "preferred source");
        assert!(!deck.join(MANIFEST_FILE).exists());
    }

    #[test]
    fn save_conflicts_if_external_files_change_the_selected_source_file() {
        let (temp, library) = library();
        let deck = write_deck(temp.path(), "Source Race", &[("talk.md", "old source")]);
        let id = path_id(&deck.canonicalize().unwrap());
        library.list_decks().unwrap();
        let opened = library.open_deck(&id).unwrap();
        fs::write(deck.join("presentation.md"), "new selected source").unwrap();

        let error = library
            .save_source(&opened.id, "my edit", &opened.content_hash)
            .unwrap_err();
        assert!(matches!(
            error,
            CoreError::Conflict {
                disk_source_file,
                disk_source,
                ..
            } if disk_source_file == "presentation.md" && disk_source == "new selected source"
        ));
        assert_eq!(
            fs::read_to_string(deck.join("talk.md")).unwrap(),
            "old source"
        );
        assert_eq!(
            fs::read_to_string(deck.join("presentation.md")).unwrap(),
            "new selected source"
        );
    }

    #[test]
    fn source_snapshot_finds_a_renamed_deck_by_its_manifest_identity() {
        let (temp, library) = library();
        let deck = write_deck(temp.path(), "Before Rename", &[("talk.md", "source")]);
        let id = path_id(&deck.canonicalize().unwrap());
        library.list_decks().unwrap();
        let opened = library.open_deck(&id).unwrap();
        let stable_id = opened.id;
        fs::rename(&deck, temp.path().join("After Rename")).unwrap();

        let snapshot = library.read_source_snapshot(&stable_id).unwrap();
        assert_eq!(snapshot.source, "source");
        assert_eq!(snapshot.source_file, "talk.md");
    }

    #[test]
    fn duplicate_manifest_ids_are_resolved_deterministically() {
        let (temp, library) = library();
        let id = Uuid::new_v4();
        let manifest = serde_json::to_vec(&DeckManifest {
            id,
            schema_version: 1,
        })
        .unwrap();
        let first = write_deck(temp.path(), "A deck", &[("talk.md", "a")]);
        let second = write_deck(temp.path(), "B deck", &[("talk.md", "b")]);
        fs::write(first.join(MANIFEST_FILE), &manifest).unwrap();
        fs::write(second.join(MANIFEST_FILE), &manifest).unwrap();

        let decks = library.list_decks().unwrap();
        assert_eq!(decks.len(), 2);
        assert_eq!(decks[0].id, id.to_string());
        assert_ne!(decks[1].id, id.to_string());
        assert_eq!(
            read_manifest(&first).unwrap().unwrap().id,
            read_manifest(&second).unwrap().unwrap().id,
            "listing is read-only; duplicate repair waits until the deck is opened"
        );

        library.open_deck(&decks[1].id).unwrap();
        assert_ne!(
            read_manifest(&first).unwrap().unwrap().id,
            read_manifest(&second).unwrap().unwrap().id
        );
    }

    #[test]
    fn library_config_is_portable_and_validated() {
        let (temp, library) = library();
        assert_eq!(library.read_config().unwrap(), LibraryConfig::default());
        let config = LibraryConfig {
            schema_version: 1,
            theme: "dark".into(),
            hotkeys: BTreeMap::from([("open".into(), "CmdOrCtrl+O".into())]),
        };
        library.write_config(&config).unwrap();
        assert_eq!(library.read_config().unwrap(), config);
        assert!(temp.path().join(".elef/config.json").is_file());
        assert!(matches!(
            library.write_config(&LibraryConfig {
                theme: "javascript:alert(1)".into(),
                ..LibraryConfig::default()
            }),
            Err(CoreError::InvalidInput)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn library_config_rejects_symlinked_config_paths() {
        let (temp, library) = library();
        let outside = temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join(LIBRARY_CONFIG_FILE), b"{}\n").unwrap();
        symlink(&outside, temp.path().join(LIBRARY_CONFIG_DIR)).unwrap();
        assert!(matches!(
            library.read_config(),
            Err(CoreError::PathRejected)
        ));
        assert!(matches!(
            library.write_config(&LibraryConfig::default()),
            Err(CoreError::PathRejected)
        ));

        fs::remove_file(temp.path().join(LIBRARY_CONFIG_DIR)).unwrap();
        let directory = temp.path().join(LIBRARY_CONFIG_DIR);
        fs::create_dir(&directory).unwrap();
        fs::remove_file(outside.join(LIBRARY_CONFIG_FILE)).unwrap();
        symlink(
            outside.join("missing.json"),
            directory.join(LIBRARY_CONFIG_FILE),
        )
        .unwrap();
        assert!(matches!(
            library.read_config(),
            Err(CoreError::PathRejected)
        ));
    }

    #[test]
    fn archive_export_is_deterministic_and_round_trips_all_file_bytes() {
        let (temp, library) = library();
        let deck = write_deck(
            temp.path(),
            "Source Deck",
            &[("presentation.md", "# Notes")],
        );
        fs::create_dir(deck.join("images")).unwrap();
        fs::write(deck.join("images/map.svg"), "<svg/>").unwrap();
        fs::write(deck.join("notes.txt"), "plain files").unwrap();
        library.list_decks().unwrap();
        let opened = library
            .open_deck(&path_id(&deck.canonicalize().unwrap()))
            .unwrap();

        let mut first = Cursor::new(Vec::new());
        let mut second = Cursor::new(Vec::new());
        library.export_elef(&opened.id, &mut first).unwrap();
        library.export_elef(&opened.id, &mut second).unwrap();
        assert_eq!(first.get_ref(), second.get_ref());
        let archive_path = temp.path().join("Portable Deck.elef");
        fs::write(&archive_path, first.into_inner()).unwrap();

        let target_root = temp.path().join("target");
        fs::create_dir(&target_root).unwrap();
        let target = Library::open(&target_root).unwrap();
        let imported = target.import_elef(&archive_path, None).unwrap();
        assert_eq!(imported.deck.name, "Portable Deck");
        assert_eq!(
            tree_bytes(&deck),
            tree_bytes(&target_root.join("Portable Deck"))
        );
    }

    #[test]
    fn archive_import_accepts_one_finder_wrapper_and_keep_both_changes_identity() {
        let (temp, library) = library();
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .last_modified_time(DateTime::default());
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        let imported_id = Uuid::new_v4();
        zip.start_file("Wrapped Deck/presentation.md", options)
            .unwrap();
        zip.write_all(b"# Wrapped").unwrap();
        zip.start_file("Wrapped Deck/elef.json", options).unwrap();
        zip.write_all(
            &serde_json::to_vec(&DeckManifest {
                id: imported_id,
                schema_version: MANIFEST_SCHEMA_VERSION,
            })
            .unwrap(),
        )
        .unwrap();
        let archive_path = temp.path().join("wrapped.elef");
        fs::write(&archive_path, zip.finish().unwrap().into_inner()).unwrap();

        let imported = library.import_elef(&archive_path, None).unwrap();
        assert_eq!(imported.deck.name, "Wrapped Deck");
        let archive_path = temp.path().join("same.elef");
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file("presentation.md", options).unwrap();
        zip.write_all(b"# Changed copy").unwrap();
        zip.start_file(MANIFEST_FILE, options).unwrap();
        zip.write_all(
            &serde_json::to_vec(&DeckManifest {
                id: imported_id,
                schema_version: MANIFEST_SCHEMA_VERSION,
            })
            .unwrap(),
        )
        .unwrap();
        fs::write(&archive_path, zip.finish().unwrap().into_inner()).unwrap();

        assert!(matches!(
            library.import_elef(&archive_path, None),
            Err(CoreError::ImportConflict { .. })
        ));
        let kept = library
            .import_elef(&archive_path, Some(ImportResolution::KeepBoth))
            .unwrap();
        assert_ne!(kept.deck.id, imported.deck.id);
        assert_eq!(kept.deck.name, "same");
        assert_eq!(library.list_decks().unwrap().len(), 2);
    }

    #[test]
    fn archive_import_rejects_traversal_and_absurd_compression_ratios() {
        let (temp, library) = library();
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .last_modified_time(DateTime::default());
        let traversal = temp.path().join("traversal.elef");
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file("../outside.md", options).unwrap();
        zip.write_all(b"outside").unwrap();
        fs::write(&traversal, zip.finish().unwrap().into_inner()).unwrap();
        assert!(matches!(
            library.import_elef(&traversal, None),
            Err(CoreError::PathRejected)
        ));
        assert!(!temp.path().join("outside.md").exists());

        let bomb = temp.path().join("ratio.elef");
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file("presentation.md", options).unwrap();
        zip.write_all(&vec![b'A'; 20 * 1024 * 1024]).unwrap();
        fs::write(&bomb, zip.finish().unwrap().into_inner()).unwrap();
        assert!(matches!(
            library.import_elef(&bomb, None),
            Err(CoreError::TooLarge)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn archive_import_rejects_symlink_entries() {
        let (temp, library) = library();
        let archive_path = temp.path().join("symlink.elef");
        let options = SimpleFileOptions::default()
            .unix_permissions(0o120777)
            .last_modified_time(DateTime::default());
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file("presentation.md", options.unix_permissions(0o777))
            .unwrap();
        zip.write_all(b"outside.md").unwrap();
        let mut bytes = zip.finish().unwrap().into_inner();
        mark_first_central_entry_as_symlink(&mut bytes);
        fs::write(archive_path, bytes).unwrap();
        assert!(matches!(
            library.import_elef(temp.path().join("symlink.elef"), None),
            Err(CoreError::PathRejected)
        ));
    }

    #[test]
    fn save_is_atomic_and_conflicts_keep_external_bytes() {
        let (temp, library) = library();
        let deck = write_deck(temp.path(), "Notes", &[("presentation.md", "old")]);
        let id = path_id(&deck.canonicalize().unwrap());
        library.list_decks().unwrap();
        let opened = library.open_deck(&id).unwrap();

        let saved = library
            .save_source(&opened.id, "new", &opened.content_hash)
            .unwrap();
        assert!(saved.ok);
        assert_eq!(
            fs::read_to_string(deck.join("presentation.md")).unwrap(),
            "new"
        );

        fs::write(deck.join("presentation.md"), "external").unwrap();
        let error = library
            .save_source(&opened.id, "local", &saved.content_hash)
            .unwrap_err();
        assert_eq!(error.code(), "conflict");
        assert!(
            matches!(error, CoreError::Conflict { disk_source, .. } if disk_source == "external")
        );
        assert_eq!(
            fs::read_to_string(deck.join("presentation.md")).unwrap(),
            "external"
        );
    }

    #[test]
    fn final_fingerprint_check_to_rename_window_stays_below_250ms_p95() {
        let (temp, library) = library();
        let deck = write_deck(temp.path(), "Window", &[("presentation.md", "old")]);
        let id = path_id(&deck.canonicalize().unwrap());
        library.list_decks().unwrap();
        let opened = library.open_deck(&id).unwrap();
        let mut base_hash = opened.content_hash;
        let mut windows = Vec::with_capacity(50);

        for index in 0..50 {
            let saved = library
                .save_source(&opened.id, &format!("revision {index}"), &base_hash)
                .unwrap();
            base_hash = saved.content_hash;
            windows.push(saved.check_to_rename_us);
        }

        windows.sort_unstable();
        let p95 = windows[windows.len() * 95 / 100];
        assert!(
            p95 < 250_000,
            "final fingerprint-check-to-rename p95 was {p95} µs (budget 250000 µs)"
        );
    }

    #[cfg(unix)]
    #[test]
    fn save_rejects_a_symlink_source() {
        let (temp, library) = library();
        let deck = write_deck(temp.path(), "Notes", &[("presentation.md", "old")]);
        let id = path_id(&deck.canonicalize().unwrap());
        library.list_decks().unwrap();
        let external = temp.path().join("outside.md");
        fs::write(&external, "outside").unwrap();
        let source = deck.join("presentation.md");
        fs::remove_file(&source).unwrap();
        symlink(&external, &source).unwrap();

        let error = library
            .save_source(&id, "new", &sha256(b"outside"))
            .unwrap_err();
        assert_eq!(error.code(), "path_rejected");
        assert_eq!(fs::read_to_string(external).unwrap(), "outside");
    }

    #[test]
    fn deck_names_are_single_safe_path_components_and_collisions_are_normalized() {
        assert!(validate_deck_name("Notes").is_ok());
        assert!(validate_deck_name("../outside").is_err());
        assert!(validate_deck_name("with/slash").is_err());
        assert_eq!(normalized_name("Cafe\u{301}"), normalized_name("Café"));
        assert_eq!(normalized_name("My Deck"), normalized_name("my deck"));
    }

    #[test]
    fn newer_manifest_versions_are_read_with_a_notice() {
        let manifest = DeckManifest {
            id: Uuid::new_v4(),
            schema_version: MANIFEST_SCHEMA_VERSION + 2,
        };
        assert_eq!(manifest_notices(&manifest).len(), 1);
    }

    #[test]
    fn unsafe_cross_platform_names_are_warned_about() {
        assert_eq!(name_warnings("My:Deck").len(), 1);
        assert_eq!(name_warnings("CON").len(), 1);
        assert!(name_warnings("My Deck").is_empty());
    }

    fn tree_bytes(root: &Path) -> BTreeMap<String, Vec<u8>> {
        fn visit(root: &Path, current: &Path, files: &mut BTreeMap<String, Vec<u8>>) {
            for entry in fs::read_dir(current).unwrap() {
                let entry = entry.unwrap();
                let path = entry.path();
                if entry.file_type().unwrap().is_dir() {
                    visit(root, &path, files);
                } else {
                    let name = path
                        .strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/");
                    files.insert(name, fs::read(path).unwrap());
                }
            }
        }
        let mut files = BTreeMap::new();
        visit(root, root, &mut files);
        files
    }

    fn mark_first_central_entry_as_symlink(bytes: &mut [u8]) {
        let signature = [0x50, 0x4b, 0x01, 0x02];
        let offset = bytes
            .windows(signature.len())
            .position(|window| window == signature)
            .expect("zip central directory entry");
        bytes[offset + 5] = 3;
        bytes[offset + 38..offset + 42].copy_from_slice(&(0o120777_u32 << 16).to_le_bytes());
    }
}
