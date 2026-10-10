//! Content-addressed media assets.

use std::fs;
use std::io::Write;
use std::path::Component;
use std::path::Path;
use std::time::SystemTime;

use tempfile::Builder as TempFileBuilder;

use crate::consts::{
    ASSET_TYPES, MAX_ARCHIVE_ENTRIES, MAX_ASSET_BYTES, MAX_DECK_MEDIA_BYTES, STALE_TEMP_AGE_SECONDS,
};
use crate::io::{move_to_trash, read_regular_file_limited, sha256, sync_directory};
use crate::library::Library;
use crate::types::{CoreError, StoredAsset, UploadedAsset};

pub(crate) fn remove_stale_asset_temps(images_dir: &Path) -> Result<(), CoreError> {
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

pub(crate) fn check_asset_quota(images_dir: &Path, additional_bytes: u64) -> Result<(), CoreError> {
    check_asset_quota_with_limit(
        images_dir,
        additional_bytes,
        MAX_DECK_MEDIA_BYTES,
        MAX_ARCHIVE_ENTRIES,
    )
}

pub(crate) fn check_asset_quota_with_limit(
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

pub(crate) fn detect_asset_type(bytes: &[u8]) -> Result<(&'static str, &'static str), CoreError> {
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

pub(crate) fn markdown_alt_text(filename: &str) -> String {
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

pub(crate) fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

impl Library {
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

    pub fn list_assets(&self, id: &str) -> Result<Vec<StoredAsset>, CoreError> {
        let record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        let images = record.path.join("images");
        let metadata = match fs::symlink_metadata(&images) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Vec::new());
            }
            Err(error) => return Err(CoreError::Io(error)),
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(CoreError::PathRejected);
        }
        let canonical_images = fs::canonicalize(&images).map_err(|_| CoreError::PathRejected)?;
        if canonical_images.parent() != Some(record.path.as_path()) {
            return Err(CoreError::PathRejected);
        }

        let mut assets = Vec::new();
        for entry in fs::read_dir(&canonical_images)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some((digest, extension)) = name.rsplit_once('.') else {
                continue;
            };
            if !is_sha256(digest) {
                continue;
            }
            let Some(content_type) = ASSET_TYPES
                .iter()
                .find(|(known, _)| *known == extension)
                .map(|(_, content_type)| *content_type)
            else {
                continue;
            };
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                return Err(CoreError::PathRejected);
            }
            if !file_type.is_file() {
                continue;
            }
            let bytes = read_regular_file_limited(&entry.path(), MAX_ASSET_BYTES as u64)?;
            if sha256(&bytes) != digest {
                continue;
            }
            assets.push(StoredAsset {
                digest: digest.into(),
                content_type: content_type.into(),
                size: bytes.len() as u64,
            });
        }
        assets.sort_by(|left, right| left.digest.cmp(&right.digest));
        Ok(assets)
    }

    pub fn remove_asset(&self, id: &str, digest: &str) -> Result<bool, CoreError> {
        if !is_sha256(digest) {
            return Err(CoreError::NotFound);
        }
        let lock = self.write_lock(id);
        let _guard = lock.lock().expect("deck write lock poisoned");
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

        for (extension, _) in ASSET_TYPES {
            let path = canonical_images.join(format!("{digest}.{extension}"));
            match fs::symlink_metadata(&path) {
                Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                    return Err(CoreError::PathRejected);
                }
                Ok(_) => {
                    let bytes = read_regular_file_limited(&path, MAX_ASSET_BYTES as u64)?;
                    if sha256(&bytes) != digest {
                        continue;
                    }
                    move_to_trash(&path)
                        .map_err(|_| CoreError::Io(std::io::Error::other("trash failed")))?;
                    return Ok(true);
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(CoreError::Io(error)),
            }
        }
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use std::path::Path;

    use crate::assets::check_asset_quota_with_limit;
    use crate::test_support::{library, write_deck};
    use crate::types::CoreError;

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
    fn asset_list_reports_verified_uploads_and_remove_trashes_them() {
        let (temp, library) = library();
        write_deck(temp.path(), "Assets", &[("presentation.md", "# Talk")]);
        let id = library.list_decks().unwrap()[0].id.clone();
        assert_eq!(library.list_assets(&id).unwrap(), Vec::new());

        let png = b"\x89PNG\r\n\x1a\nlisted image";
        let uploaded = library
            .upload_asset(&id, "photo.png", "image/png", png, "contain")
            .unwrap();
        let listed = library.list_assets(&id).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].digest, uploaded.digest);
        assert_eq!(listed[0].content_type, "image/png");
        assert_eq!(listed[0].size, png.len() as u64);

        assert!(library.remove_asset(&id, &uploaded.digest).unwrap());
        assert_eq!(library.list_assets(&id).unwrap(), Vec::new());
        assert!(!library.remove_asset(&id, &uploaded.digest).unwrap());
        assert!(matches!(
            library.read_asset(&id, &uploaded.digest),
            Err(CoreError::NotFound)
        ));
        assert!(matches!(
            library.remove_asset(&id, "not-a-digest"),
            Err(CoreError::NotFound)
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
}
