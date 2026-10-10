//! Deck listing, summaries, and source-file selection.

use std::collections::BTreeMap;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::decks::normalized_name;
use crate::io::{read_regular_file, sha256};
use crate::library::Library;
use crate::manifest::{manifest_notices, read_manifest};
use crate::types::{CoreError, DeckRecord, DeckSummary, DocumentGraphDocument};

pub(crate) fn choose_source_file(deck_path: &Path) -> Result<Option<String>, CoreError> {
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

pub(crate) fn source_file_for_write(
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

pub(crate) fn source_file_key(name: &str) -> (u8, usize, String, String) {
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

pub(crate) fn path_id(path: &Path) -> String {
    format!("path:{}", sha256(path.to_string_lossy().as_bytes()))
}

impl Library {
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

    pub(crate) fn available_deck_name(&self, requested: &str) -> Result<String, CoreError> {
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

    pub(crate) fn discover_decks(&self) -> Result<HashMap<String, DeckRecord>, CoreError> {
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
                persisted_source: None,
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
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::fs::File;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use std::time::SystemTime;

    use uuid::Uuid;

    use crate::consts::MANIFEST_FILE;
    use crate::discovery::choose_source_file;
    use crate::io::system_time_ms;
    use crate::manifest::read_manifest;
    use crate::test_support::{library, write_deck};
    use crate::types::DeckManifest;

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
}
