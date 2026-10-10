//! Deterministic `.elef` archive export/import.

use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::io::Seek;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;

use tempfile::Builder as TempFileBuilder;
use uuid::Uuid;
use zip::CompressionMethod;
use zip::DateTime;
use zip::ZipArchive;
use zip::ZipWriter;
use zip::write::SimpleFileOptions;

use crate::consts::{
    MAX_ARCHIVE_COMPRESSION_RATIO, MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_FILE_BYTES,
    MAX_ARCHIVE_RATIO_CHECK_BYTES, MAX_ARCHIVE_UNCOMPRESSED_BYTES,
};
use crate::decks::{normalized_name, validate_deck_name};
use crate::discovery::choose_source_file;
use crate::io::{
    create_new_file, file_name, move_to_trash, open_regular_file, read_regular_file_handle,
};
use crate::library::Library;
use crate::manifest::{read_manifest, write_manifest_atomic};
use crate::types::{CoreError, ImportResolution, ImportResult};

#[derive(Debug)]
pub(crate) struct ArchiveItem {
    pub(crate) name: String,
    pub(crate) path: PathBuf,
    pub(crate) is_directory: bool,
}

#[derive(Debug)]
pub(crate) struct ArchiveMember {
    pub(crate) index: usize,
    pub(crate) name: String,
    pub(crate) is_directory: bool,
    pub(crate) size: u64,
}

pub(crate) fn collect_archive_items(
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

pub(crate) fn extract_archive<R: Read + Seek>(
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

pub(crate) fn validate_archive_path(
    raw_name: &str,
    is_directory: bool,
) -> Result<String, CoreError> {
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

pub(crate) fn single_wrapper_name(members: &[ArchiveMember]) -> Option<String> {
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

pub(crate) fn map_zip_error(error: zip::result::ZipError) -> CoreError {
    match error {
        zip::result::ZipError::Io(error) => CoreError::Io(error),
        _ => CoreError::InvalidInput,
    }
}

impl Library {
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
            move_to_trash(&existing.path)
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
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::Cursor;
    use std::io::Write;

    use uuid::Uuid;
    use zip::CompressionMethod;
    use zip::DateTime;
    use zip::ZipWriter;
    use zip::write::SimpleFileOptions;

    use crate::consts::{MANIFEST_FILE, MANIFEST_SCHEMA_VERSION};
    use crate::discovery::path_id;
    use crate::library::Library;
    use crate::test_support::{
        library, mark_first_central_entry_as_symlink, tree_bytes, write_deck,
    };
    use crate::types::{CoreError, DeckManifest, ImportResolution};

    #[test]
    fn archive_export_is_deterministic_and_round_trips_all_file_bytes() {
        let (temp, library) = library();
        let deck = write_deck(
            temp.path(),
            "Source Deck",
            &[(
                "document.md",
                "---\nelef_document_key: \"portable-key\"\nelef_aliases: [\"Earlier title\"]\n---\n# Notes",
            )],
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
}
