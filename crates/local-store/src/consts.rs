//! Shared limits, file names, and schema versions.

pub const MANIFEST_FILE: &str = "elef.json";

pub const MANIFEST_SCHEMA_VERSION: u32 = 1;

pub const MAX_SOURCE_BYTES: usize = 50 * 1024 * 1024;

pub const MAX_LIBRARY_PREVIEW_SOURCE_BYTES: u64 = 256 * 1024;

pub const MAX_ASSET_BYTES: usize = 50 * 1024 * 1024;

pub const MAX_ARCHIVE_UNCOMPRESSED_BYTES: u64 = 500 * 1024 * 1024;

pub const MAX_ARCHIVE_ENTRIES: usize = 10_000;

pub(crate) const MAX_DECK_MEDIA_BYTES: u64 = 400 * 1024 * 1024;

pub(crate) const MAX_ARCHIVE_FILE_BYTES: u64 = 600 * 1024 * 1024;

pub(crate) const STALE_TEMP_AGE_SECONDS: u64 = 24 * 60 * 60;

pub(crate) const MAX_ARCHIVE_COMPRESSION_RATIO: u64 = 1_000;

pub(crate) const MAX_ARCHIVE_RATIO_CHECK_BYTES: u64 = 1024 * 1024;

pub(crate) const LIBRARY_CONFIG_DIR: &str = ".elef";

pub(crate) const SNAPSHOT_DIR: &str = ".elef-history";

pub(crate) const SNAPSHOT_RETENTION_MS: u128 = 7 * 24 * 60 * 60 * 1000;

pub(crate) const WATCH_DEBOUNCE_MS: u128 = 500;

pub(crate) const LIBRARY_CONFIG_FILE: &str = "config.json";

pub(crate) const LIBRARY_CONFIG_SCHEMA_VERSION: u32 = 1;

pub(crate) const AUTHORING_REGISTRY_SCHEMA_VERSION: u32 = 1;

pub(crate) const AUTHORING_REGISTRY_MAX_BYTES: u64 = 4 * 1024 * 1024;

pub(crate) const AUTHORING_REGISTRY_MAX_ENTRIES: usize = 1_000;

pub(crate) const ASSET_TYPES: [(&str, &str); 9] = [
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
