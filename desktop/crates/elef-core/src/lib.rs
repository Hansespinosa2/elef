use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use caseless::default_case_fold_str;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::Builder as TempFileBuilder;
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter};

pub mod update_install;

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

pub const MANIFEST_FILE: &str = "elef.json";
pub const MANIFEST_SCHEMA_VERSION: u32 = 1;
pub const MAX_SOURCE_BYTES: usize = 50 * 1024 * 1024;
pub const MAX_LIBRARY_PREVIEW_SOURCE_BYTES: u64 = 256 * 1024;
pub const MAX_ASSET_BYTES: usize = 50 * 1024 * 1024;
pub const MAX_ARCHIVE_UNCOMPRESSED_BYTES: u64 = 500 * 1024 * 1024;
pub const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_DECK_MEDIA_BYTES: u64 = 400 * 1024 * 1024;
const MAX_ARCHIVE_FILE_BYTES: u64 = 600 * 1024 * 1024;
const STALE_TEMP_AGE_SECONDS: u64 = 24 * 60 * 60;
const MAX_ARCHIVE_COMPRESSION_RATIO: u64 = 1_000;
const MAX_ARCHIVE_RATIO_CHECK_BYTES: u64 = 1024 * 1024;
const LIBRARY_CONFIG_DIR: &str = ".elef";
const LIBRARY_CONFIG_FILE: &str = "config.json";
const LIBRARY_CONFIG_SCHEMA_VERSION: u32 = 1;
const AUTHORING_REGISTRY_SCHEMA_VERSION: u32 = 1;
const AUTHORING_REGISTRY_MAX_BYTES: u64 = 4 * 1024 * 1024;
const AUTHORING_REGISTRY_MAX_ENTRIES: usize = 1_000;
const ASSET_TYPES: [(&str, &str); 9] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("gif", "image/gif"),
    ("bmp", "image/bmp"),
    ("tif", "image/tiff"),
    ("webp", "image/webp"),
    ("avif", "image/avif"),
    ("heic", "image/heic"),
    ("mp4", "video/mp4"),
];

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
pub struct DocumentGraphDocument {
    pub id: String,
    pub name: String,
    pub source: String,
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
pub struct DeckPreview {
    pub source: String,
    pub source_file: String,
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
pub struct UploadedAsset {
    pub digest: String,
    pub content_type: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LibraryConfig {
    pub schema_version: u32,
    pub theme: String,
    #[serde(default)]
    pub hotkeys: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthoringRegistries {
    pub snippets: Vec<serde_json::Value>,
    pub math_shortcuts: Vec<serde_json::Value>,
    pub hashes: AuthoringRegistryHashes,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthoringRegistryHashes {
    pub snippets: String,
    pub math_shortcuts: String,
}

impl Default for AuthoringRegistries {
    fn default() -> Self {
        Self {
            snippets: Vec::new(),
            math_shortcuts: Vec::new(),
            hashes: AuthoringRegistryHashes {
                snippets: sha256(&[]),
                math_shortcuts: sha256(&[]),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct AuthoringRegistryFile {
    schema_version: u32,
    #[serde(default)]
    entries: Vec<serde_json::Value>,
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
    pub name_collision: bool,
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
    #[error("Authoring settings changed outside Elef. Reload them before saving.")]
    AuthoringConflict,
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
            Self::AuthoringConflict => "conflict",
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

    pub fn document_graph(&self) -> Result<Vec<DocumentGraphDocument>, CoreError> {
        let summaries = self
            .list_decks()?
            .into_iter()
            .filter(|deck| deck.kind == "document")
            .collect::<Vec<_>>();
        let mut documents = Vec::with_capacity(summaries.len());
        for summary in summaries {
            let record = self.record(&summary.id)?;
            self.validate_deck_path(&record.path)?;
            let bytes = read_regular_file(&record.source_path)?;
            let source = String::from_utf8(bytes).map_err(|_| CoreError::InvalidInput)?;
            documents.push(DocumentGraphDocument {
                id: summary.id,
                name: summary.name,
                source,
            });
        }
        Ok(documents)
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

    pub fn read_authoring_registries(&self) -> Result<AuthoringRegistries, CoreError> {
        let (snippets, snippets_hash) = self.read_authoring_entries("snippets.json", false)?;
        let (math_shortcuts, math_shortcuts_hash) =
            self.read_authoring_entries("math-shortcuts.json", true)?;
        Ok(AuthoringRegistries {
            snippets,
            math_shortcuts,
            hashes: AuthoringRegistryHashes {
                snippets: snippets_hash,
                math_shortcuts: math_shortcuts_hash,
            },
        })
    }

    pub fn write_authoring_registry(
        &self,
        registry: &str,
        entries: &[serde_json::Value],
        base_hash: &str,
    ) -> Result<String, CoreError> {
        let (file_name, is_math) = match registry {
            "snippets" => ("snippets.json", false),
            "math_shortcuts" => ("math-shortcuts.json", true),
            _ => return Err(CoreError::InvalidInput),
        };
        if !is_sha256(base_hash) {
            return Err(CoreError::InvalidInput);
        }
        validate_authoring_entries(entries, is_math)?;

        // Keep concurrent in-app edits to one registry from both passing the
        // same hash check. External writers do not honor this lock, so the
        // on-disk hash check remains necessary as well.
        let lock = self.write_lock(&format!("authoring:{registry}"));
        let _guard = lock.lock().expect("authoring registry write lock poisoned");

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
        let path = canonical_directory.join(file_name);
        let document = AuthoringRegistryFile {
            schema_version: AUTHORING_REGISTRY_SCHEMA_VERSION,
            entries: entries.to_vec(),
        };
        let bytes = serde_json::to_vec_pretty(&document).map_err(|_| CoreError::InvalidInput)?;
        // Recheck immediately before the atomic replacement so an edit made
        // while the settings UI is open is surfaced instead of discarded.
        self.read_authoring_entries(file_name, is_math)?;
        write_file_atomic_if_unchanged(&path, &bytes, base_hash)?;
        Ok(sha256(&bytes))
    }

    fn read_authoring_entries(
        &self,
        file_name: &str,
        is_math: bool,
    ) -> Result<(Vec<serde_json::Value>, String), CoreError> {
        let directory = self.root.join(LIBRARY_CONFIG_DIR);
        let metadata = match fs::symlink_metadata(&directory) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok((Vec::new(), sha256(&[])));
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
        let path = canonical_directory.join(file_name);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok((Vec::new(), sha256(&[])));
            }
            Err(error) => return Err(CoreError::Io(error)),
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(CoreError::PathRejected);
        }
        let bytes = read_regular_file_limited(&path, AUTHORING_REGISTRY_MAX_BYTES)?;
        let file: AuthoringRegistryFile =
            serde_json::from_slice(&bytes).map_err(|_| CoreError::InvalidInput)?;
        if file.schema_version == 0 {
            return Err(CoreError::InvalidInput);
        }
        validate_authoring_entries(&file.entries, is_math)?;
        Ok((file.entries, sha256(&bytes)))
    }

    pub fn open_deck(&self, id: &str) -> Result<OpenDeck, CoreError> {
        let lock = self.write_lock(id);
        let _guard = lock.lock().expect("deck write lock poisoned");
        let mut record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        remove_stale_temps(&record.path)?;
        remove_stale_asset_temps(&record.path.join("images"))?;

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

    /// Read a bounded, read-only source sample for the library card preview.
    /// This deliberately does not create or repair `elef.json` during listing.
    pub fn read_deck_preview(&self, id: &str) -> Result<DeckPreview, CoreError> {
        let record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        let bytes =
            read_regular_file_limited(&record.source_path, MAX_LIBRARY_PREVIEW_SOURCE_BYTES)?;
        let source = String::from_utf8(bytes).map_err(|_| CoreError::InvalidInput)?;
        Ok(DeckPreview {
            source,
            source_file: record.source_file,
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
        pause_for_save_fault("before_temp_write");
        if save_fault_enabled("mid_temp_write") {
            let bytes = source.as_bytes();
            let split = (bytes.len() / 2).max(1).min(bytes.len());
            temp.write_all(&bytes[..split])?;
            temp.as_file().sync_all()?;
            pause_for_save_fault("mid_temp_write");
        }
        temp.write_all(source.as_bytes())?;
        temp.as_file().sync_all()?;

        // Measure the full final validation-to-rename window. This cannot make
        // external writers atomic with our replacement, but keeps the accepted
        // race window bounded and observable in CI.
        let verified_at = Instant::now();
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

        pause_for_save_fault("after_flush_before_rename");
        temp.persist(&record.source_path)
            .map_err(|error| CoreError::Io(error.error))?;
        pause_for_save_fault("after_rename");
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

    pub fn upload_asset(
        &self,
        id: &str,
        filename: &str,
        declared_type: &str,
        bytes: &[u8],
        fit: &str,
    ) -> Result<UploadedAsset, CoreError> {
        if bytes.is_empty() || bytes.len() > MAX_ASSET_BYTES {
            return Err(CoreError::TooLarge);
        }
        if filename.len() > 255 || !matches!(fit, "contain" | "cover") {
            return Err(CoreError::InvalidInput);
        }

        let lock = self.write_lock(id);
        let _guard = lock.lock().expect("deck write lock poisoned");
        let record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        let (extension, content_type) = detect_asset_type(bytes)?;
        let declared_type = declared_type.split(';').next().unwrap_or("").trim();
        if !declared_type.is_empty() && declared_type != content_type {
            return Err(CoreError::InvalidInput);
        }
        if content_type == "video/mp4" && record.source_file == "document.md" {
            return Err(CoreError::InvalidInput);
        }

        let images = record.path.join("images");
        match fs::symlink_metadata(&images) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(CoreError::PathRejected);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir(&images)?,
            Err(error) => return Err(CoreError::Io(error)),
        }
        let canonical_images = fs::canonicalize(&images).map_err(|_| CoreError::PathRejected)?;
        if canonical_images.parent() != Some(record.path.as_path()) {
            return Err(CoreError::PathRejected);
        }
        remove_stale_asset_temps(&canonical_images)?;

        let digest = sha256(bytes);
        let stored_path = canonical_images.join(format!("{digest}.{extension}"));
        match fs::symlink_metadata(&stored_path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(CoreError::PathRejected);
            }
            Ok(_) => {
                let existing = read_regular_file_limited(&stored_path, MAX_ASSET_BYTES as u64)?;
                if sha256(&existing) != digest {
                    return Err(CoreError::PathRejected);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                check_asset_quota(&canonical_images, bytes.len() as u64)?;
                let mut temp = TempFileBuilder::new()
                    .prefix(".elef-asset-")
                    .suffix(".tmp")
                    .tempfile_in(&canonical_images)?;
                temp.write_all(bytes)?;
                temp.as_file().sync_all()?;
                match temp.persist_noclobber(&stored_path) {
                    Ok(_) => sync_directory(&canonical_images)?,
                    Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
                        let existing =
                            read_regular_file_limited(&stored_path, MAX_ASSET_BYTES as u64)?;
                        if sha256(&existing) != digest {
                            return Err(CoreError::PathRejected);
                        }
                    }
                    Err(error) => return Err(CoreError::Io(error.error)),
                }
            }
            Err(error) => return Err(CoreError::Io(error)),
        }

        let alt = markdown_alt_text(filename);
        Ok(UploadedAsset {
            digest: digest.clone(),
            content_type: content_type.into(),
            source: format!("![{alt}](elef-asset:{digest} \"fit:{fit}\")"),
        })
    }

    pub fn read_asset(&self, id: &str, digest: &str) -> Result<(Vec<u8>, &'static str), CoreError> {
        if !is_sha256(digest) {
            return Err(CoreError::NotFound);
        }
        let record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        let images = record.path.join("images");
        let metadata = fs::symlink_metadata(&images).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                CoreError::NotFound
            } else {
                CoreError::Io(error)
            }
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(CoreError::PathRejected);
        }
        let canonical_images = fs::canonicalize(&images).map_err(|_| CoreError::PathRejected)?;
        if canonical_images.parent() != Some(record.path.as_path()) {
            return Err(CoreError::PathRejected);
        }

        for (extension, content_type) in ASSET_TYPES {
            let path = canonical_images.join(format!("{digest}.{extension}"));
            match fs::symlink_metadata(&path) {
                Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                    return Err(CoreError::PathRejected);
                }
                Ok(_) => {
                    let bytes = read_regular_file_limited(&path, MAX_ASSET_BYTES as u64)?;
                    if sha256(&bytes) != digest {
                        return Err(CoreError::NotFound);
                    }
                    return Ok((bytes, content_type));
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(CoreError::Io(error)),
            }
        }
        Err(CoreError::NotFound)
    }

    pub fn read_asset_path(
        &self,
        id: &str,
        relative_path: &Path,
    ) -> Result<(Vec<u8>, &'static str), CoreError> {
        let components = relative_path.components().collect::<Vec<_>>();
        if components.len() < 2
            || components[0].as_os_str() != "images"
            || components
                .iter()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(CoreError::PathRejected);
        }

        let record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        let images = record.path.join("images");
        let images_metadata = fs::symlink_metadata(&images).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                CoreError::NotFound
            } else {
                CoreError::Io(error)
            }
        })?;
        if images_metadata.file_type().is_symlink() || !images_metadata.is_dir() {
            return Err(CoreError::PathRejected);
        }
        let canonical_images = fs::canonicalize(&images).map_err(|_| CoreError::PathRejected)?;
        if canonical_images.parent() != Some(record.path.as_path()) {
            return Err(CoreError::PathRejected);
        }

        let mut path = canonical_images.clone();
        for (index, component) in components.iter().skip(1).enumerate() {
            path.push(component.as_os_str());
            let metadata = fs::symlink_metadata(&path).map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    CoreError::NotFound
                } else {
                    CoreError::Io(error)
                }
            })?;
            if metadata.file_type().is_symlink() {
                return Err(CoreError::PathRejected);
            }
            let final_component = index + 2 == components.len();
            if (final_component && !metadata.is_file()) || (!final_component && !metadata.is_dir())
            {
                return Err(CoreError::PathRejected);
            }
        }
        let canonical_path = fs::canonicalize(&path).map_err(|_| CoreError::PathRejected)?;
        if !canonical_path.starts_with(&canonical_images) {
            return Err(CoreError::PathRejected);
        }
        let bytes = read_regular_file_limited(&canonical_path, MAX_ASSET_BYTES as u64)?;
        let (_, content_type) = detect_asset_type(&bytes)?;
        Ok((bytes, content_type))
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
        let name_collision = self.name_collision_exists(&incoming_name)?;
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
        Ok(ImportResult {
            deck,
            replaced,
            name_collision: name_collision && !replaced,
        })
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

fn validate_authoring_entries(
    entries: &[serde_json::Value],
    is_math: bool,
) -> Result<(), CoreError> {
    if entries.len() > AUTHORING_REGISTRY_MAX_ENTRIES {
        return Err(CoreError::TooLarge);
    }
    let serialized = serde_json::to_vec(entries).map_err(|_| CoreError::InvalidInput)?;
    if serialized.len() as u64 > AUTHORING_REGISTRY_MAX_BYTES {
        return Err(CoreError::TooLarge);
    }
    for entry in entries {
        let Some(object) = entry.as_object() else {
            return Err(CoreError::InvalidInput);
        };
        let identifier = object.get("id").ok_or(CoreError::InvalidInput)?;
        let valid_id = identifier.as_str().is_some_and(|value| {
            !value.is_empty() && value.len() <= 200 && !value.chars().any(char::is_control)
        }) || identifier.as_u64().is_some();
        if !valid_id || object.get("built_in").and_then(|value| value.as_bool()) == Some(true) {
            return Err(CoreError::InvalidInput);
        }
        validate_authoring_text(object.get("name"), 500)?;
        validate_authoring_optional_text(object.get("description"), 500)?;
        if is_math {
            validate_authoring_text(object.get("prefix"), 8)?;
            validate_authoring_text(object.get("expansion"), 20_000)?;
            validate_authoring_string_array(object.get("aliases"), 100, 120)?;
        } else {
            validate_authoring_text(object.get("trigger"), 120)?;
            validate_authoring_text(object.get("category"), 80)?;
            validate_authoring_text(object.get("body"), 20_000)?;
        }
        if object
            .get("behavior")
            .is_some_and(|value| !value.is_object())
            || object
                .get("contexts")
                .is_some_and(|value| validate_authoring_string_array(Some(value), 20, 80).is_err())
            || object.get("search_terms").is_some_and(|value| {
                validate_authoring_string_array(Some(value), 100, 500).is_err()
            })
        {
            return Err(CoreError::InvalidInput);
        }
    }
    Ok(())
}

fn validate_authoring_text(
    value: Option<&serde_json::Value>,
    max_bytes: usize,
) -> Result<(), CoreError> {
    let Some(text) = value.and_then(|value| value.as_str()) else {
        return Err(CoreError::InvalidInput);
    };
    if text.is_empty() || text.len() > max_bytes || text.chars().any(char::is_control) {
        return Err(CoreError::InvalidInput);
    }
    Ok(())
}

fn validate_authoring_optional_text(
    value: Option<&serde_json::Value>,
    max_bytes: usize,
) -> Result<(), CoreError> {
    let Some(text) = value.and_then(|value| value.as_str()) else {
        return Err(CoreError::InvalidInput);
    };
    if text.len() > max_bytes || text.chars().any(char::is_control) {
        return Err(CoreError::InvalidInput);
    }
    Ok(())
}

fn validate_authoring_string_array(
    value: Option<&serde_json::Value>,
    max_items: usize,
    max_bytes: usize,
) -> Result<(), CoreError> {
    let Some(items) = value.and_then(|value| value.as_array()) else {
        return Err(CoreError::InvalidInput);
    };
    if items.len() > max_items
        || items.iter().any(|item| {
            item.as_str()
                .is_none_or(|text| text.len() > max_bytes || text.chars().any(char::is_control))
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

fn write_file_atomic_if_unchanged(
    path: &Path,
    bytes: &[u8],
    expected_hash: &str,
) -> Result<(), CoreError> {
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

    let current_bytes = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(CoreError::PathRejected);
        }
        Ok(_) => read_regular_file_limited(path, AUTHORING_REGISTRY_MAX_BYTES)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(CoreError::Io(error)),
    };
    if sha256(&current_bytes) != expected_hash {
        return Err(CoreError::AuthoringConflict);
    }

    temp.persist(path)
        .map_err(|error| CoreError::Io(error.error))?;
    sync_directory(parent)
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
        let _ = fs::remove_file(entry.path());
    }
    Ok(())
}

#[cfg(test)]
fn save_fault_enabled(point: &str) -> bool {
    std::env::var("ELEF_CORE_TEST_SAVE_PAUSE").as_deref() == Ok(point)
}

#[cfg(not(test))]
fn save_fault_enabled(_point: &str) -> bool {
    false
}

#[cfg(test)]
fn pause_for_save_fault(point: &str) {
    if save_fault_enabled(point) {
        let marker = std::env::var_os("ELEF_CORE_TEST_SAVE_MARKER")
            .expect("the save fault test must provide a pause marker");
        fs::write(marker, b"paused").expect("the save fault marker must be writable");
        loop {
            std::thread::park_timeout(std::time::Duration::from_secs(1));
        }
    }
}

#[cfg(not(test))]
fn pause_for_save_fault(_point: &str) {}

fn remove_stale_asset_temps(images_dir: &Path) -> Result<(), CoreError> {
    match fs::symlink_metadata(images_dir) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(CoreError::Io(error)),
    }
    let now = SystemTime::now();
    for entry in fs::read_dir(images_dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with(".elef-asset-") || !name.ends_with(".tmp") {
            continue;
        }
        let file_type = entry.file_type()?;
        if !file_type.is_file() || file_type.is_symlink() {
            continue;
        }
        let old_enough = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age.as_secs() >= STALE_TEMP_AGE_SECONDS);
        if old_enough {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

fn check_asset_quota(images_dir: &Path, additional_bytes: u64) -> Result<(), CoreError> {
    check_asset_quota_with_limit(
        images_dir,
        additional_bytes,
        MAX_DECK_MEDIA_BYTES,
        MAX_ARCHIVE_ENTRIES,
    )
}

fn check_asset_quota_with_limit(
    images_dir: &Path,
    additional_bytes: u64,
    max_bytes: u64,
    max_entries: usize,
) -> Result<(), CoreError> {
    let mut pending = vec![images_dir.to_path_buf()];
    let mut bytes = additional_bytes;
    let mut entries = 0usize;

    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let metadata = fs::symlink_metadata(entry.path())?;
            let file_type = metadata.file_type();
            if file_type.is_symlink() {
                return Err(CoreError::PathRejected);
            }
            if file_type.is_dir() {
                entries = entries.checked_add(1).ok_or(CoreError::TooLarge)?;
                pending.push(entry.path());
                continue;
            }
            if !file_type.is_file() {
                return Err(CoreError::PathRejected);
            }

            entries = entries.checked_add(1).ok_or(CoreError::TooLarge)?;
            if entries > max_entries {
                return Err(CoreError::TooLarge);
            }
            bytes = bytes
                .checked_add(metadata.len())
                .ok_or(CoreError::TooLarge)?;
            if bytes > max_bytes {
                return Err(CoreError::TooLarge);
            }
        }
    }

    if bytes > max_bytes || entries > max_entries {
        return Err(CoreError::TooLarge);
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

fn detect_asset_type(bytes: &[u8]) -> Result<(&'static str, &'static str), CoreError> {
    let starts_with = |signature: &[u8]| bytes.starts_with(signature);
    if starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok(("png", "image/png"));
    }
    if starts_with(b"\xff\xd8\xff") {
        return Ok(("jpg", "image/jpeg"));
    }
    if starts_with(b"GIF87a") || starts_with(b"GIF89a") {
        return Ok(("gif", "image/gif"));
    }
    if starts_with(b"BM") {
        return Ok(("bmp", "image/bmp"));
    }
    if starts_with(b"II*\0") || starts_with(b"MM\0*") {
        return Ok(("tif", "image/tiff"));
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Ok(("webp", "image/webp"));
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        let brand = String::from_utf8_lossy(&bytes[8..bytes.len().min(32)]).to_ascii_lowercase();
        if brand.contains("avif") || brand.contains("avis") {
            return Ok(("avif", "image/avif"));
        }
        if [
            "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1",
        ]
        .iter()
        .any(|value| brand.contains(value))
        {
            return Ok(("heic", "image/heic"));
        }
        if brand.contains("isom") || brand.contains("mp41") || brand.contains("mp42") {
            return Ok(("mp4", "video/mp4"));
        }
    }
    Err(CoreError::InvalidInput)
}

fn markdown_alt_text(filename: &str) -> String {
    let filename = filename
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("image")
        .to_owned();
    let basename = filename
        .rsplit_once('.')
        .filter(|(stem, extension)| !stem.is_empty() && !extension.is_empty())
        .map(|(stem, _extension)| stem)
        .unwrap_or(&filename)
        .chars()
        .filter(|character| !character.is_control())
        .take(255)
        .collect::<String>();
    let basename = basename.trim();
    let basename = if basename.is_empty() {
        "image"
    } else {
        basename
    };
    basename
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]")
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
    default_case_fold_str(&name.nfc().collect::<String>())
        .nfc()
        .collect()
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
    use std::process::{Command, Stdio};
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

    #[test]
    fn asset_upload_is_content_addressed_and_read_only_lookup_verifies_the_digest() {
        let (temp, library) = library();
        let deck_path = write_deck(temp.path(), "Asset deck", &[("presentation.md", "# Talk")]);
        let id = library.list_decks().unwrap()[0].id.clone();
        let png = b"\x89PNG\r\n\x1a\nvalid test bytes";

        let uploaded = library
            .upload_asset(&id, "photo[1].png", "image/png", png, "cover")
            .unwrap();
        assert_eq!(uploaded.content_type, "image/png");
        assert!(uploaded.source.starts_with("![photo\\[1\\]](elef-asset:"));
        assert!(uploaded.source.ends_with(" \"fit:cover\")"));
        assert_eq!(
            fs::read(
                deck_path
                    .join("images")
                    .join(format!("{}.png", uploaded.digest))
            )
            .unwrap(),
            png
        );
        assert_eq!(
            library.read_asset(&id, &uploaded.digest).unwrap(),
            (png.to_vec(), "image/png")
        );
    }

    #[test]
    fn existing_relative_image_assets_are_scoped_to_the_deck_images_tree() {
        let (temp, library) = library();
        let deck_path = write_deck(
            temp.path(),
            "Existing assets",
            &[("presentation.md", "# Talk")],
        );
        let id = library.list_decks().unwrap()[0].id.clone();
        let png = b"\x89PNG\r\n\x1a\nexisting image";
        fs::create_dir_all(deck_path.join("images/nested")).unwrap();
        fs::write(deck_path.join("images/nested/diagram.png"), png).unwrap();

        assert_eq!(
            library
                .read_asset_path(&id, Path::new("images/nested/diagram.png"))
                .unwrap(),
            (png.to_vec(), "image/png")
        );
        assert!(matches!(
            library.read_asset_path(&id, Path::new("images/../presentation.md")),
            Err(CoreError::PathRejected)
        ));
    }

    #[test]
    fn asset_upload_rejects_mismatched_media_types_and_document_video() {
        let (temp, library) = library();
        let raster_path = write_deck(temp.path(), "Raster", &[("presentation.md", "# Talk")]);
        let document_path = write_deck(temp.path(), "Document", &[("document.md", "# Notes")]);
        let raster_id = library.list_decks().unwrap()[1].id.clone();
        let document_id = library
            .deck_summary(&library.list_decks().unwrap()[0].id)
            .unwrap()
            .id;
        let png = b"\x89PNG\r\n\x1a\nvalid test bytes";
        assert!(matches!(
            library.upload_asset(&raster_id, "photo.png", "image/jpeg", png, "contain"),
            Err(CoreError::InvalidInput)
        ));

        let mp4 = b"\0\0\0\x18ftypisom0000test";
        assert!(matches!(
            library.upload_asset(&document_id, "clip.mp4", "video/mp4", mp4, "contain"),
            Err(CoreError::InvalidInput)
        ));
        assert!(!raster_path.join("images").exists());
        assert!(!document_path.join("images").exists());
    }

    #[test]
    fn asset_quota_counts_existing_files_and_fails_closed_on_symlinks() {
        let (temp, _library) = library();
        let images = temp.path().join("images");
        fs::create_dir(&images).unwrap();
        fs::write(images.join("existing.png"), b"1234").unwrap();
        fs::create_dir(images.join("nested")).unwrap();
        fs::write(images.join("nested").join("other.png"), b"12").unwrap();

        assert!(check_asset_quota_with_limit(&images, 1, 7, 4).is_ok());
        assert!(matches!(
            check_asset_quota_with_limit(&images, 2, 7, 4),
            Err(CoreError::TooLarge)
        ));
        assert!(matches!(
            check_asset_quota_with_limit(&images, 0, 20, 2),
            Err(CoreError::TooLarge)
        ));

        #[cfg(unix)]
        {
            symlink(temp.path().join("outside"), images.join("escape")).unwrap();
            assert!(matches!(
                check_asset_quota_with_limit(&images, 0, 20, 10),
                Err(CoreError::PathRejected)
            ));
        }
    }

    #[test]
    fn document_graph_command_returns_documents_for_shared_frontend_resolution() {
        let (temp, library) = library();
        write_deck(
            temp.path(),
            "A",
            &[(
                "document.md",
                "---\ntheme: light\n---\n# First Document\n\n[[Second Document|next]] [[Second Document]] `[[Inline Code]]` \\[[Escaped]]\n\n```md\n[[Fenced Code]]\n```\n    [[Indented Code]]\n",
            )],
        );
        write_deck(temp.path(), "B", &[("document.md", "# Second Document\n")]);
        write_deck(
            temp.path(),
            "Slides",
            &[("presentation.md", "# Slides\n\n[[Second Document]]")],
        );

        let summaries = library.list_decks().unwrap();
        let graph_documents = library.document_graph().unwrap();
        let first_id = summaries
            .iter()
            .find(|deck| deck.name == "A")
            .unwrap()
            .id
            .clone();
        let second_id = summaries
            .iter()
            .find(|deck| deck.name == "B")
            .unwrap()
            .id
            .clone();
        assert_eq!(graph_documents.len(), 2);
        let first = graph_documents
            .iter()
            .find(|document| document.id == first_id)
            .unwrap();
        assert_eq!(first.name, "A");
        assert!(first.source.contains("[[Second Document|next]]"));
        assert_eq!(
            graph_documents
                .iter()
                .find(|document| document.id == second_id)
                .unwrap()
                .name,
            "B"
        );
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
    fn deck_summary_uses_the_source_file_modification_time() {
        let (temp, library) = library();
        let deck_path = write_deck(
            temp.path(),
            "Source timestamp",
            &[("presentation.md", "# Talk")],
        );
        let source_path = deck_path.join("presentation.md");
        let expected = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000);
        File::open(source_path)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(expected))
            .unwrap();

        let summary = library.list_decks().unwrap().remove(0);
        assert_eq!(summary.modified_ms, system_time_ms(expected).unwrap());
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
    fn library_preview_is_bounded_read_only_and_uses_the_selected_source() {
        let (temp, library) = library();
        let deck = write_deck(temp.path(), "Preview", &[("talk.md", "# A preview")]);
        let id = path_id(&deck.canonicalize().unwrap());
        library.list_decks().unwrap();

        let preview = library.read_deck_preview(&id).unwrap();
        assert_eq!(preview.source, "# A preview");
        assert_eq!(preview.source_file, "talk.md");
        assert!(!deck.join(MANIFEST_FILE).exists());

        fs::write(
            deck.join("talk.md"),
            vec![b'x'; MAX_LIBRARY_PREVIEW_SOURCE_BYTES as usize + 1],
        )
        .unwrap();
        assert!(matches!(
            library.read_deck_preview(&id),
            Err(CoreError::TooLarge)
        ));
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

    #[test]
    fn authoring_registries_are_portable_versioned_and_validated() {
        let (temp, library) = library();
        let initial = library.read_authoring_registries().unwrap();
        assert_eq!(initial, AuthoringRegistries::default());
        let snippets = vec![serde_json::json!({
            "id": "personal-bold",
            "name": "Bold note",
            "description": "",
            "trigger": "bold-note",
            "category": "Markdown",
            "body": "**${1:text}**",
            "built_in": false
        })];
        let math_shortcuts = vec![serde_json::json!({
            "id": 42,
            "name": "Alpha",
            "description": "",
            "prefix": "@",
            "aliases": ["alpha"],
            "expansion": "\\alpha"
        })];
        let snippets_hash = library
            .write_authoring_registry("snippets", &snippets, &initial.hashes.snippets)
            .unwrap();
        let after_snippets = library.read_authoring_registries().unwrap();
        let math_hash = library
            .write_authoring_registry(
                "math_shortcuts",
                &math_shortcuts,
                &after_snippets.hashes.math_shortcuts,
            )
            .unwrap();
        let persisted = library.read_authoring_registries().unwrap();
        assert_eq!(persisted.snippets, snippets);
        assert_eq!(persisted.math_shortcuts, math_shortcuts);
        assert_eq!(persisted.hashes.snippets, snippets_hash);
        assert_eq!(persisted.hashes.math_shortcuts, math_hash);
        assert!(temp.path().join(".elef/snippets.json").is_file());
        assert!(temp.path().join(".elef/math-shortcuts.json").is_file());
        assert!(matches!(
            library.write_authoring_registry("unknown", &[], &sha256(&[])),
            Err(CoreError::InvalidInput)
        ));
        assert!(matches!(
            library.write_authoring_registry(
                "snippets",
                &[serde_json::json!({
                    "id": "fake-default",
                    "name": "Fake default",
                    "description": "Cannot shadow built-ins",
                    "trigger": "x",
                    "category": "Markdown",
                    "body": "x",
                    "built_in": true
                })],
                &persisted.hashes.snippets
            ),
            Err(CoreError::InvalidInput)
        ));
    }

    #[test]
    fn authoring_registry_write_does_not_overwrite_external_changes() {
        let (temp, library) = library();
        let initial = library.read_authoring_registries().unwrap();
        let edited = vec![serde_json::json!({
            "id": "personal-note",
            "name": "Personal note",
            "description": "Local edit",
            "trigger": "note",
            "category": "Markdown",
            "body": "# ${1:Note}",
            "built_in": false
        })];
        let settings_path = temp.path().join(".elef/snippets.json");
        fs::create_dir(temp.path().join(LIBRARY_CONFIG_DIR)).unwrap();
        fs::write(&settings_path, br#"{"schema_version":1,"entries":[]}"#).unwrap();

        assert!(matches!(
            library.write_authoring_registry("snippets", &edited, &initial.hashes.snippets),
            Err(CoreError::AuthoringConflict)
        ));
        assert_eq!(
            fs::read(&settings_path).unwrap(),
            br#"{"schema_version":1,"entries":[]}"#
        );
    }

    #[test]
    fn concurrent_authoring_registry_writes_serialize_and_reject_the_stale_one() {
        let (temp, library) = library();
        let library = Arc::new(library);
        let initial = library.read_authoring_registries().unwrap();
        let start = Arc::new(std::sync::Barrier::new(3));
        let entries = [
            vec![serde_json::json!({
                "id": "personal-first",
                "name": "First",
                "description": "First concurrent edit",
                "trigger": "first",
                "category": "Markdown",
                "body": "First"
            })],
            vec![serde_json::json!({
                "id": "personal-second",
                "name": "Second",
                "description": "Second concurrent edit",
                "trigger": "second",
                "category": "Markdown",
                "body": "Second"
            })],
        ];

        let writers = entries
            .into_iter()
            .map(|entry| {
                let library = Arc::clone(&library);
                let start = Arc::clone(&start);
                let base_hash = initial.hashes.snippets.clone();
                std::thread::spawn(move || {
                    start.wait();
                    library.write_authoring_registry("snippets", &entry, &base_hash)
                })
            })
            .collect::<Vec<_>>();
        start.wait();
        let results = writers
            .into_iter()
            .map(|writer| writer.join().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(CoreError::AuthoringConflict)))
                .count(),
            1
        );
        let persisted = library.read_authoring_registries().unwrap();
        assert_eq!(persisted.snippets.len(), 1);
        assert!(temp.path().join(".elef/snippets.json").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn authoring_registries_reject_symlinked_files() {
        let (temp, library) = library();
        let outside = temp.path().join("outside.json");
        fs::write(&outside, r#"{"schema_version":1,"entries":[]}"#).unwrap();
        fs::create_dir(temp.path().join(LIBRARY_CONFIG_DIR)).unwrap();
        symlink(
            &outside,
            temp.path().join(LIBRARY_CONFIG_DIR).join("snippets.json"),
        )
        .unwrap();
        assert!(matches!(
            library.read_authoring_registries(),
            Err(CoreError::PathRejected)
        ));
        assert!(matches!(
            library.write_authoring_registry("snippets", &[], &sha256(&[])),
            Err(CoreError::PathRejected)
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
    fn archive_import_reports_unicode_casefold_name_collision() {
        let (temp, library) = library();
        let existing = write_deck(temp.path(), "Straße", &[("presentation.md", "# Existing")]);
        library.list_decks().unwrap();

        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .last_modified_time(DateTime::default());
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file("STRASSE/presentation.md", options).unwrap();
        zip.write_all(b"# Imported").unwrap();
        let archive_path = temp.path().join("strasse.elef");
        fs::write(&archive_path, zip.finish().unwrap().into_inner()).unwrap();

        let imported = library.import_elef(&archive_path, None).unwrap();

        assert!(imported.name_collision);
        assert_eq!(imported.deck.name, "STRASSE (2)");
        assert!(existing.join("presentation.md").exists());
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
    fn save_crash_worker() {
        let Ok(root) = std::env::var("ELEF_CORE_TEST_SAVE_ROOT") else {
            return;
        };
        let library = Library::open(root).unwrap();
        let deck = library.list_decks().unwrap().into_iter().next().unwrap();
        let opened = library.open_deck(&deck.id).unwrap();
        let new_source = "# New source\n".repeat(4096);
        library
            .save_source(&opened.id, &new_source, &opened.content_hash)
            .unwrap();
    }

    #[test]
    fn killing_a_process_at_each_save_point_preserves_complete_bytes_and_cleans_temp_files() {
        const POINTS: [&str; 4] = [
            "before_temp_write",
            "mid_temp_write",
            "after_flush_before_rename",
            "after_rename",
        ];
        const RUNS_PER_POINT: usize = 50;
        let executable = std::env::current_exe().unwrap();
        let new_source = "# New source\n".repeat(4096);

        for point in POINTS {
            for _ in 0..RUNS_PER_POINT {
                let temp = TempDir::new().unwrap();
                let deck_path = write_deck(
                    temp.path(),
                    "Crash fixture",
                    &[("presentation.md", "# Old source\n")],
                );
                let marker = temp.path().join("save-paused");
                let mut child = Command::new(&executable)
                    .args(["--exact", "tests::save_crash_worker", "--nocapture"])
                    .env("ELEF_CORE_TEST_SAVE_ROOT", temp.path())
                    .env("ELEF_CORE_TEST_SAVE_PAUSE", point)
                    .env("ELEF_CORE_TEST_SAVE_MARKER", &marker)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .unwrap();

                let mut reached_save_point = false;
                for _ in 0..500 {
                    if marker.exists() {
                        reached_save_point = true;
                        break;
                    }
                    if let Some(status) = child.try_wait().unwrap() {
                        panic!("save worker exited before {point}: {status}");
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                assert!(reached_save_point, "save worker did not reach {point}");
                child.kill().unwrap();
                assert!(!child.wait().unwrap().success());

                let expected = if point == "after_rename" {
                    new_source.as_str()
                } else {
                    "# Old source\n"
                };
                assert_eq!(
                    fs::read_to_string(deck_path.join("presentation.md")).unwrap(),
                    expected
                );

                let library = Library::open(temp.path()).unwrap();
                let deck = library
                    .list_decks()
                    .unwrap()
                    .into_iter()
                    .find(|summary| summary.name == "Crash fixture")
                    .unwrap();
                library.open_deck(&deck.id).unwrap();
                assert!(fs::read_dir(&deck_path).unwrap().all(|entry| {
                    !entry
                        .unwrap()
                        .file_name()
                        .to_string_lossy()
                        .starts_with(".elef-save-")
                }));
            }
        }
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
        assert_eq!(normalized_name("Straße"), normalized_name("STRASSE"));
        assert_eq!(normalized_name("ΟΣ"), normalized_name("ος"));
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
