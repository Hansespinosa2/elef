pub mod update_install;

mod archives;
mod assets;
mod config;
mod consts;
mod decks;
mod discovery;
mod io;
mod library;
mod manifest;
mod merge;
mod snapshots;
mod types;
mod watch;
mod writes;

#[cfg(test)]
mod test_support;

pub use consts::{
    MANIFEST_FILE, MANIFEST_SCHEMA_VERSION, MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_UNCOMPRESSED_BYTES,
    MAX_ASSET_BYTES, MAX_LIBRARY_PREVIEW_SOURCE_BYTES, MAX_SOURCE_BYTES,
};
pub use library::Library;
pub use merge::MergeOutcome;
pub use types::{
    AuthoringRegistries, AuthoringRegistryHashes, CoreError, DeckManifest, DeckPreview,
    DeckSummary, DocumentGraphDocument, FileEvent, FileEventKind, Fingerprint, ImportResolution,
    ImportResult, LibraryConfig, OpenDeck, RestoreOutcome, SaveResult, SnapshotInfo,
    SourceSnapshot, StoredAsset, UploadedAsset,
};
