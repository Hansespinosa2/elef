//! Deck open/read/create/rename/delete and name rules.

use std::fs;
use std::path::Component;
use std::path::Path;

use caseless::default_case_fold_str;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::assets::remove_stale_asset_temps;
use crate::consts::{MANIFEST_FILE, MANIFEST_SCHEMA_VERSION, MAX_LIBRARY_PREVIEW_SOURCE_BYTES};
use crate::discovery::{choose_source_file, path_id};
use crate::io::{
    file_name, fingerprint_bytes, move_to_trash, read_regular_file, read_regular_file_limited,
    sha256, write_new_file,
};
use crate::library::Library;
use crate::manifest::write_manifest_atomic;
use crate::types::{
    CoreError, DeckManifest, DeckPreview, DeckRecord, DeckSummary, OpenDeck, SourceSnapshot,
};
use crate::writes::remove_stale_temps;

pub(crate) fn validate_deck_name(name: &str) -> Result<(), CoreError> {
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

pub(crate) fn normalized_name(name: &str) -> String {
    default_case_fold_str(&name.nfc().collect::<String>())
        .nfc()
        .collect()
}

pub(crate) fn name_warnings(name: &str) -> Vec<String> {
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

pub(crate) fn is_reserved_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or_default().to_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem
                .chars()
                .last()
                .is_some_and(|number| ('1'..='9').contains(&number)))
}

impl Library {
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
        record.persisted_source = Some(source.clone());
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
            persisted_source: Some(source.clone()),
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
            persisted_source: record.persisted_source,
        };
        let summary = self.summary(&renamed);
        self.refresh_record(renamed);
        Ok(summary)
    }

    pub fn delete_deck(&self, id: &str) -> Result<(), CoreError> {
        let record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        move_to_trash(&record.path)
            .map_err(|_| CoreError::Io(std::io::Error::other("trash failed")))?;
        self.records
            .write()
            .expect("deck index lock poisoned")
            .remove(id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::consts::{MANIFEST_FILE, MAX_LIBRARY_PREVIEW_SOURCE_BYTES};
    use crate::decks::{name_warnings, normalized_name, validate_deck_name};
    use crate::discovery::path_id;
    use crate::io::sha256;
    use crate::test_support::{library, write_deck};
    use crate::types::CoreError;

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
    fn unsafe_cross_platform_names_are_warned_about() {
        assert_eq!(name_warnings("My:Deck").len(), 1);
        assert_eq!(name_warnings("CON").len(), 1);
        assert!(name_warnings("My Deck").is_empty());
    }
}
