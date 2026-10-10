//! Public data types, error type, and shared record types.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::Deserialize;
use serde::Serialize;
use thiserror::Error;
use uuid::Uuid;

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
pub struct SnapshotInfo {
    pub id: String,
    pub taken_at_ms: u128,
    pub reason: String,
    pub byte_len: usize,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RestoreOutcome {
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UploadedAsset {
    pub digest: String,
    pub content_type: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredAsset {
    pub digest: String,
    pub content_type: String,
    pub size: u64,
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
pub(crate) struct DeckRecord {
    pub(crate) id: String,
    pub(crate) path: PathBuf,
    pub(crate) source_path: PathBuf,
    pub(crate) source_file: String,
    pub(crate) manifest: Option<DeckManifest>,
    pub(crate) notices: Vec<String>,
    pub(crate) identity_repair: bool,
    /// Last persisted source text known to this process, used as the merge
    /// ancestor. `None` until the deck is opened or saved here; a crash loses
    /// it, and merging without an ancestor always takes the conflict path.
    pub(crate) persisted_source: Option<String>,
}

/// A coalesced external filesystem change affecting one deck's source file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileEvent {
    pub deck_id: String,
    pub kind: FileEventKind,
}

/// Source content changed (create/modify/rename-over) or the source vanished.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum FileEventKind {
    SourceChanged,
    SourceRemoved,
}
