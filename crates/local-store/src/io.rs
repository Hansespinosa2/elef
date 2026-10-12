//! Atomic file writes, regular-file reads, hashing, and time helpers.

use std::fs;
use std::fs::File;
use std::fs::OpenOptions;
use std::io::Read;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

use sha2::{Digest, Sha256};
use tempfile::Builder as TempFileBuilder;

use crate::consts::{AUTHORING_REGISTRY_MAX_BYTES, MAX_SOURCE_BYTES};
use crate::types::{CoreError, Fingerprint};

pub(crate) fn write_file_atomic(path: &Path, bytes: &[u8]) -> Result<(), CoreError> {
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

pub(crate) fn write_file_atomic_if_unchanged(
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

pub(crate) fn read_regular_file_handle(path: &Path) -> Result<File, CoreError> {
    open_regular_file(path)
}

pub(crate) fn open_regular_file(path: &Path) -> Result<File, CoreError> {
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

pub(crate) fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), CoreError> {
    let mut file = create_new_file(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    if let Some(parent) = path.parent() {
        sync_directory(parent)?;
    }
    Ok(())
}

pub(crate) fn create_new_file(path: &Path) -> Result<File, CoreError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW);
    Ok(options.open(path)?)
}

pub(crate) fn read_regular_file(path: &Path) -> Result<Vec<u8>, CoreError> {
    read_regular_file_limited(path, MAX_SOURCE_BYTES as u64)
}

pub(crate) fn read_regular_file_limited(path: &Path, max_bytes: u64) -> Result<Vec<u8>, CoreError> {
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

pub(crate) fn fingerprint_bytes(bytes: &[u8], path: &Path) -> Result<Fingerprint, CoreError> {
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

pub(crate) fn move_to_trash(path: &Path) -> Result<(), trash::Error> {
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};

        // The default macOS implementation automates Finder with AppleScript,
        // which can require an Automation permission prompt. NSFileManager
        // moves the same item to Trash without that prompt.
        let mut context = trash::TrashContext::new();
        context.set_delete_method(DeleteMethod::NsFileManager);
        context.delete(path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        trash::delete(path)
    }
}

#[cfg(test)]
pub(crate) fn save_fault_enabled(point: &str) -> bool {
    std::env::var("ELEF_CORE_TEST_SAVE_PAUSE").as_deref() == Ok(point)
}

#[cfg(not(test))]
pub(crate) fn save_fault_enabled(_point: &str) -> bool {
    false
}

#[cfg(test)]
pub(crate) fn pause_for_save_fault(point: &str) {
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
pub(crate) fn pause_for_save_fault(_point: &str) {}

#[cfg(test)]
pub(crate) fn store_fault_enabled(point: &str) -> bool {
    std::env::var("ELEF_CORE_TEST_STORE_PAUSE").as_deref() == Ok(point)
}

#[cfg(test)]
pub(crate) fn pause_for_store_fault(point: &str) {
    if store_fault_enabled(point) {
        let marker = std::env::var_os("ELEF_CORE_TEST_STORE_MARKER")
            .expect("the store fault test must provide a pause marker");
        fs::write(marker, b"paused").expect("the store fault marker must be writable");
        loop {
            std::thread::park_timeout(std::time::Duration::from_secs(1));
        }
    }
}

#[cfg(not(test))]
pub(crate) fn pause_for_store_fault(_point: &str) {}

pub(crate) fn sync_directory(path: &Path) -> Result<(), CoreError> {
    File::open(path)?.sync_all()?;
    Ok(())
}

pub(crate) fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub(crate) fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

pub(crate) fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

pub(crate) fn system_time_ms(time: SystemTime) -> Option<u128> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis())
}
