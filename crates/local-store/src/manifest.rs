//! Work folder manifest (`elef.json`) read/write helpers.

use std::fs;
use std::io::Write;
use std::path::Path;

use tempfile::Builder as TempFileBuilder;
use uuid::Uuid;

use crate::consts::{MANIFEST_FILE, MANIFEST_SCHEMA_VERSION};
use crate::io::{read_regular_file_limited, sync_directory};
use crate::types::{CoreError, WorkFolderManifest};

pub(crate) fn read_manifest(work_folder_path: &Path) -> Result<Option<WorkFolderManifest>, ()> {
    let path = work_folder_path.join(MANIFEST_FILE);
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
    Ok(Some(WorkFolderManifest { id, schema_version }))
}

pub(crate) fn manifest_notices(manifest: &WorkFolderManifest) -> Vec<String> {
    if manifest.schema_version > MANIFEST_SCHEMA_VERSION {
        vec!["This Work uses a newer Elef folder format; known fields were read.".into()]
    } else {
        Vec::new()
    }
}

pub(crate) fn write_manifest_atomic(
    work_folder_path: &Path,
    manifest: &WorkFolderManifest,
) -> Result<(), CoreError> {
    let bytes = serde_json::to_vec_pretty(manifest).map_err(|_| CoreError::InvalidInput)?;
    let mut temp = TempFileBuilder::new()
        .prefix(".elef-manifest-")
        .suffix(".tmp")
        .tempfile_in(work_folder_path)?;
    temp.write_all(&bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(work_folder_path.join(MANIFEST_FILE))
        .map_err(|error| CoreError::Io(error.error))?;
    sync_directory(work_folder_path)
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use crate::consts::MANIFEST_SCHEMA_VERSION;
    use crate::manifest::manifest_notices;
    use crate::types::WorkFolderManifest;

    #[test]
    fn newer_manifest_versions_are_read_with_a_notice() {
        let manifest = WorkFolderManifest {
            id: Uuid::new_v4(),
            schema_version: MANIFEST_SCHEMA_VERSION + 2,
        };
        assert_eq!(manifest_notices(&manifest).len(), 1);
    }
}
