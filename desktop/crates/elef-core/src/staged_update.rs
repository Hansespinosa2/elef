//! Persistent, integrity-checked storage for a downloaded desktop update.
//!
//! The update is only an opaque verified payload here. Eligibility and the
//! Minisign signature are rechecked by the Tauri updater immediately before
//! installation.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MAX_PAYLOAD_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_METADATA_BYTES: u64 = 16 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct StagedUpdateMetadata {
    pub version: String,
    pub signature: String,
    pub download_url: String,
    pub payload_sha256: String,
    pub payload_size: u64,
    pub staged_at_unix_ms: u128,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StagedUpdate {
    pub metadata: StagedUpdateMetadata,
    pub payload: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct StagedUpdateStore {
    root: PathBuf,
}

/// Verify the stored Tauri signature and bind its signed version to the
/// metadata before allowing a cached payload to reach the installer.
pub fn verify_signature(
    payload: &[u8],
    encoded_signature: &str,
    encoded_public_key: &str,
    expected_version: &str,
) -> io::Result<()> {
    if payload.is_empty()
        || payload.len() as u64 > MAX_PAYLOAD_BYTES
        || encoded_signature.len() > 16 * 1024
        || encoded_public_key.len() > 4096
        || expected_version.is_empty()
        || expected_version.len() > 64
    {
        return Err(invalid_record());
    }
    let key_text = decode_base64_text(encoded_public_key)?;
    let signature_text = decode_base64_text(encoded_signature)?;
    let public_key = PublicKey::decode(&key_text).map_err(|_| invalid_record())?;
    let signature = Signature::decode(&signature_text).map_err(|_| invalid_record())?;
    public_key
        .verify(payload, &signature, true)
        .map_err(|_| invalid_record())?;
    let signed_version = signature
        .trusted_comment()
        .split('\t')
        .find_map(|field| field.strip_prefix("version:"));
    if signed_version != Some(expected_version) {
        return Err(invalid_record());
    }
    Ok(())
}

impl StagedUpdateStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// Write the payload and metadata into a private temporary directory, then
    /// replace the pending record as one directory rename.
    pub fn save(
        &self,
        version: &str,
        signature: &str,
        download_url: &str,
        payload: &[u8],
    ) -> io::Result<StagedUpdateMetadata> {
        validate_record(version, signature, download_url, payload)?;
        self.ensure_root()?;

        let mut builder = tempfile::Builder::new();
        builder.prefix(".pending-update-");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            builder.permissions(fs::Permissions::from_mode(0o700));
        }
        let temporary = builder.tempdir_in(&self.root)?;
        let metadata = StagedUpdateMetadata {
            version: version.to_owned(),
            signature: signature.to_owned(),
            download_url: download_url.to_owned(),
            payload_sha256: sha256(payload),
            payload_size: payload.len() as u64,
            staged_at_unix_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
        };

        write_private_file(&temporary.path().join("payload"), payload)?;
        let serialized = serde_json::to_vec(&metadata)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "Invalid update metadata"))?;
        write_private_file(&temporary.path().join("metadata.json"), &serialized)?;
        File::open(temporary.path())?.sync_all()?;

        let pending = self.root.join("pending");
        remove_existing_pending(&pending)?;
        let temporary_path = temporary.keep();
        fs::rename(&temporary_path, &pending)?;
        File::open(&self.root)?.sync_all()?;
        Ok(metadata)
    }

    /// Load only a regular, bounded record whose SHA-256 matches its payload.
    pub fn load(&self) -> io::Result<Option<StagedUpdate>> {
        match fs::symlink_metadata(&self.root) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(invalid_record());
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        }
        let pending = self.root.join("pending");
        let directory_metadata = match fs::symlink_metadata(&pending) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        if directory_metadata.file_type().is_symlink() || !directory_metadata.is_dir() {
            return Err(invalid_record());
        }

        let metadata_path = pending.join("metadata.json");
        let payload_path = pending.join("payload");
        regular_file(&metadata_path, MAX_METADATA_BYTES)?;
        let payload_file = regular_file(&payload_path, MAX_PAYLOAD_BYTES)?;
        let metadata_bytes = fs::read(metadata_path)?;
        let metadata: StagedUpdateMetadata =
            serde_json::from_slice(&metadata_bytes).map_err(|_| invalid_record())?;
        validate_metadata(&metadata)?;
        if payload_file.len() != metadata.payload_size {
            return Err(invalid_record());
        }
        let payload = fs::read(payload_path)?;
        if sha256(&payload) != metadata.payload_sha256 {
            return Err(invalid_record());
        }
        Ok(Some(StagedUpdate { metadata, payload }))
    }

    /// Remove only Elef's regular pending directory; a symlink is never followed.
    pub fn clear(&self) -> io::Result<bool> {
        match fs::symlink_metadata(&self.root) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(invalid_record());
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error),
        }
        let pending = self.root.join("pending");
        match fs::symlink_metadata(&pending) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                Err(invalid_record())
            }
            Ok(_) => {
                fs::remove_dir_all(pending)?;
                File::open(&self.root)?.sync_all()?;
                Ok(true)
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error),
        }
    }

    fn ensure_root(&self) -> io::Result<()> {
        fs::create_dir_all(&self.root)?;
        let metadata = fs::symlink_metadata(&self.root)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(invalid_record());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.root, fs::Permissions::from_mode(0o700))?;
        }
        Ok(())
    }
}

fn validate_record(version: &str, signature: &str, url: &str, payload: &[u8]) -> io::Result<()> {
    if version.is_empty()
        || version.len() > 64
        || !version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b".+-".contains(&byte))
        || signature.is_empty()
        || signature.len() > 8192
        || signature.bytes().any(|byte| byte.is_ascii_control())
        || url.is_empty()
        || url.len() > 8192
        || !(url.starts_with("https://") || url.starts_with("http://127.0.0.1"))
        || url.bytes().any(|byte| byte.is_ascii_control())
        || payload.is_empty()
        || payload.len() as u64 > MAX_PAYLOAD_BYTES
    {
        return Err(invalid_record());
    }
    Ok(())
}

fn validate_metadata(metadata: &StagedUpdateMetadata) -> io::Result<()> {
    if metadata.version.is_empty()
        || metadata.version.len() > 64
        || !metadata
            .version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b".+-".contains(&byte))
        || metadata.signature.is_empty()
        || metadata.signature.len() > 8192
        || metadata
            .signature
            .bytes()
            .any(|byte| byte.is_ascii_control())
        || metadata.download_url.is_empty()
        || metadata.download_url.len() > 8192
        || !(metadata.download_url.starts_with("https://")
            || metadata.download_url.starts_with("http://127.0.0.1"))
        || metadata
            .download_url
            .bytes()
            .any(|byte| byte.is_ascii_control())
        || metadata.payload_size == 0
        || metadata.payload_size > MAX_PAYLOAD_BYTES
        || metadata.payload_sha256.len() != 64
        || !metadata
            .payload_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(invalid_record());
    }
    Ok(())
}

fn regular_file(path: &Path, maximum_size: u64) -> io::Result<fs::Metadata> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > maximum_size {
        return Err(invalid_record());
    }
    Ok(metadata)
}

fn write_private_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

fn remove_existing_pending(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            Err(invalid_record())
        }
        Ok(_) => fs::remove_dir_all(path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn decode_base64_text(value: &str) -> io::Result<String> {
    let decoded = STANDARD.decode(value).map_err(|_| invalid_record())?;
    String::from_utf8(decoded).map_err(|_| invalid_record())
}

fn invalid_record() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "Invalid staged update")
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn staged_update_retains_version_signature_and_integrity_across_store_instances() {
        let root = tempfile::tempdir().unwrap();
        let first = StagedUpdateStore::new(root.path().join("cache"));
        let payload = b"verified updater archive";
        let metadata = first
            .save(
                "0.2.0",
                "signed metadata",
                "https://example.test/update.tar.gz",
                payload,
            )
            .unwrap();
        let restarted = StagedUpdateStore::new(root.path().join("cache"));
        let staged = restarted.load().unwrap().unwrap();
        assert_eq!(staged.metadata, metadata);
        assert_eq!(staged.metadata.version, "0.2.0");
        assert_eq!(staged.metadata.signature, "signed metadata");
        assert_eq!(staged.metadata.payload_sha256, sha256(payload));
        assert_eq!(staged.payload, payload);
    }

    #[test]
    fn payload_tampering_is_rejected_before_it_can_reach_the_installer() {
        let root = tempfile::tempdir().unwrap();
        let store = StagedUpdateStore::new(root.path().join("cache"));
        store
            .save(
                "0.2.0",
                "signed metadata",
                "https://example.test/update.tar.gz",
                b"verified",
            )
            .unwrap();
        fs::write(root.path().join("cache/pending/payload"), b"changed").unwrap();
        assert_eq!(store.load().unwrap_err().kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn symlinked_pending_directory_and_payload_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let store = StagedUpdateStore::new(root.path().join("cache"));
        let outside = root.path().join("outside");
        fs::create_dir(&outside).unwrap();
        symlink(&outside, root.path().join("cache")).unwrap();
        assert_eq!(
            store
                .save("0.2.0", "sig", "https://example.test/a", b"bytes")
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidData
        );
        assert_eq!(store.load().unwrap_err().kind(), io::ErrorKind::InvalidData);
        assert_eq!(
            store.clear().unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );

        fs::remove_file(root.path().join("cache")).unwrap();
        fs::create_dir(root.path().join("cache")).unwrap();
        symlink(&outside, root.path().join("cache/pending")).unwrap();
        assert_eq!(store.load().unwrap_err().kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn clear_removes_only_an_existing_regular_pending_directory() {
        let root = tempfile::tempdir().unwrap();
        let store = StagedUpdateStore::new(root.path().join("cache"));
        assert!(!store.clear().unwrap());
        store
            .save("0.2.0", "sig", "https://example.test/a", b"bytes")
            .unwrap();
        assert!(store.clear().unwrap());
        assert!(store.load().unwrap().is_none());
    }

    #[test]
    fn signature_verification_binds_cached_bytes_and_signed_version() {
        const KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IGZpeHR1cmUKUldSQnB5ZWVYTStnY1dWdjlNdDh3RmJKb1lrVGVHTXEzRnhTYXEyTEpycWZyUGV5N1JzTHZXZ3UK";
        const SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IGZpeHR1cmUgc2lnbmF0dXJlClJVUkJweWVlWE0rZ2NaWFhYMHdBU0JHbUlhZUswWjZDaSsrRlhGc3NucE1ZVjVBNVpIV2MrM0U1Z0l4YjdtUFdaVVlIQkJZVXVJREJvNGNpdTA2SWhTVDNCU0Z5cEpJSHp3VT0KdHJ1c3RlZCBjb21tZW50OiB0aW1lc3RhbXA6MAl2ZXJzaW9uOjAuMi4wCWZpbGU6Zml4dHVyZS5iaW4KWVNzTGxzYmdOYllweTlJRG5XbjIzNWU0bWFzc1BaVzk1am1ZRVozWUxJUEtkVmxJWTdTZm1rS0hCcHVqZ3dHOUtvVGJYTTB5VXNZMklKUlBMcGV1Qnc9PQo=";
        let payload = b"persistent update fixture";
        assert!(verify_signature(payload, SIGNATURE, KEY, "0.2.0").is_ok());
        assert!(verify_signature(payload, SIGNATURE, KEY, "0.3.0").is_err());
        assert!(verify_signature(b"changed payload", SIGNATURE, KEY, "0.2.0").is_err());
    }
}
