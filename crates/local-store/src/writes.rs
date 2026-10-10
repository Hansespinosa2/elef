//! Source saves, external-change merging entry, save temp cleanup.

use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::Instant;

use tempfile::Builder as TempFileBuilder;

use crate::assets::is_sha256;
use crate::consts::MAX_SOURCE_BYTES;
use crate::discovery::source_file_for_write;
use crate::io::{
    fingerprint_bytes, now_ms, pause_for_save_fault, read_regular_file, save_fault_enabled, sha256,
    sync_directory,
};
use crate::library::Library;
use crate::merge::{MergeOutcome, merge_sources};
use crate::types::{CoreError, SaveResult};

pub(crate) fn conflict_error(
    disk_hash: String,
    disk_bytes: Vec<u8>,
    disk_source_file: String,
) -> CoreError {
    CoreError::Conflict {
        disk_hash,
        disk_source: String::from_utf8_lossy(&disk_bytes).into_owned(),
        disk_source_file,
    }
}

pub(crate) fn remove_stale_temps(deck_path: &Path) -> Result<(), CoreError> {
    for entry in fs::read_dir(deck_path)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if (!name.starts_with(".elef-save-") && !name.starts_with(".elef-restore-"))
            || !name.ends_with(".tmp")
        {
            continue;
        }
        let metadata = entry.file_type()?;
        if !metadata.is_file() || metadata.is_symlink() {
            continue;
        }
        let _ = fs::remove_file(entry.path());
    }
    Ok(())
}

impl Library {
    pub fn save_source(
        &self,
        id: &str,
        source: &str,
        base_hash: &str,
    ) -> Result<SaveResult, CoreError> {
        if source.len() > MAX_SOURCE_BYTES {
            return Err(CoreError::TooLarge);
        }
        if !is_sha256(base_hash) {
            return Err(CoreError::InvalidInput);
        }

        let lock = self.write_lock(id);
        let _guard = lock.lock().expect("deck write lock poisoned");
        let mut record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        let selected_source_file = source_file_for_write(&record.path, &record.source_path)?;
        if selected_source_file != record.source_file {
            self.list_decks()?;
            let current = self.record(id)?;
            let current_bytes = read_regular_file(&current.source_path)?;
            return Err(conflict_error(
                sha256(&current_bytes),
                current_bytes,
                current.source_file,
            ));
        }
        let disk_bytes = read_regular_file(&record.source_path)?;
        let disk_hash = sha256(&disk_bytes);
        if disk_hash != base_hash {
            return Err(conflict_error(
                disk_hash,
                disk_bytes,
                record.source_file.clone(),
            ));
        }

        let mut temp = TempFileBuilder::new()
            .prefix(".elef-save-")
            .suffix(".tmp")
            .tempfile_in(&record.path)?;
        let original_permissions = fs::metadata(&record.source_path)?.permissions();
        temp.as_file().set_permissions(original_permissions)?;
        pause_for_save_fault("before_temp_write");
        if save_fault_enabled("mid_temp_write") {
            let bytes = source.as_bytes();
            let split = (bytes.len() / 2).max(1).min(bytes.len());
            temp.write_all(&bytes[..split])?;
            temp.as_file().sync_all()?;
            pause_for_save_fault("mid_temp_write");
        }
        temp.write_all(source.as_bytes())?;
        temp.as_file().sync_all()?;

        // Measure the full final validation-to-rename window. This cannot make
        // external writers atomic with our replacement, but keeps the accepted
        // race window bounded and observable in CI.
        let verified_at = Instant::now();
        let selected_source_file = source_file_for_write(&record.path, &record.source_path)?;
        if selected_source_file != record.source_file {
            self.list_decks()?;
            let current = self.record(id)?;
            let current_bytes = read_regular_file(&current.source_path)?;
            return Err(conflict_error(
                sha256(&current_bytes),
                current_bytes,
                current.source_file,
            ));
        }
        let current_bytes = read_regular_file(&record.source_path)?;
        let current_hash = sha256(&current_bytes);
        if current_hash != base_hash {
            return Err(conflict_error(
                current_hash,
                current_bytes,
                record.source_file.clone(),
            ));
        }

        pause_for_save_fault("after_flush_before_rename");
        temp.persist(&record.source_path)
            .map_err(|error| CoreError::Io(error.error))?;
        pause_for_save_fault("after_rename");
        let check_to_rename_us = verified_at.elapsed().as_micros();
        sync_directory(&record.path)?;

        let now = now_ms();
        let fingerprint = fingerprint_bytes(source.as_bytes(), &record.source_path)?;
        record.persisted_source = Some(source.to_owned());
        self.refresh_record(record);
        Ok(SaveResult {
            ok: true,
            saved_at_ms: now,
            content_hash: fingerprint.content_hash.clone(),
            fingerprint,
            check_to_rename_us,
        })
    }

    /// Computes a deterministic three-way merge of `local_source` against the
    /// current disk bytes, using the last persisted text known to this process
    /// as the ancestor. Never writes: the caller snapshots first, then saves
    /// `Merged` output through [`Library::save_source`]. A missing ancestor,
    /// non-UTF8 disk bytes, or an oversized rewrite all take the safe
    /// `Overlap` path instead of guessing.
    pub fn merge_external_change(
        &self,
        id: &str,
        local_source: &str,
    ) -> Result<MergeOutcome, CoreError> {
        let record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        let Some(ancestor) = record.persisted_source.as_deref() else {
            return Ok(MergeOutcome::Overlap);
        };
        let disk_bytes = read_regular_file(&record.source_path)?;
        let Ok(external) = String::from_utf8(disk_bytes) else {
            return Ok(MergeOutcome::Overlap);
        };
        Ok(merge_sources(ancestor, local_source, &external))
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use std::path::PathBuf;
    use std::process::Command;
    use std::process::Stdio;

    use tempfile::TempDir;

    use crate::discovery::path_id;
    use crate::io::sha256;
    use crate::library::Library;
    use crate::merge::{MergeOutcome, merge_sources};
    use crate::test_support::{
        MERGE_EXTERNAL, MERGE_LOCAL, MERGE_OLD, library, wait_for_pause_marker, write_deck,
    };
    use crate::types::CoreError;

    #[test]
    fn save_conflicts_if_external_files_change_the_selected_source_file() {
        let (temp, library) = library();
        let deck = write_deck(temp.path(), "Source Race", &[("talk.md", "old source")]);
        let id = path_id(&deck.canonicalize().unwrap());
        library.list_decks().unwrap();
        let opened = library.open_deck(&id).unwrap();
        fs::write(deck.join("presentation.md"), "new selected source").unwrap();

        let error = library
            .save_source(&opened.id, "my edit", &opened.content_hash)
            .unwrap_err();
        assert!(matches!(
            error,
            CoreError::Conflict {
                disk_source_file,
                disk_source,
                ..
            } if disk_source_file == "presentation.md" && disk_source == "new selected source"
        ));
        assert_eq!(
            fs::read_to_string(deck.join("talk.md")).unwrap(),
            "old source"
        );
        assert_eq!(
            fs::read_to_string(deck.join("presentation.md")).unwrap(),
            "new selected source"
        );
    }

    #[test]
    fn save_is_atomic_and_conflicts_keep_external_bytes() {
        let (temp, library) = library();
        let deck = write_deck(temp.path(), "Notes", &[("presentation.md", "old")]);
        let id = path_id(&deck.canonicalize().unwrap());
        library.list_decks().unwrap();
        let opened = library.open_deck(&id).unwrap();

        let saved = library
            .save_source(&opened.id, "new", &opened.content_hash)
            .unwrap();
        assert!(saved.ok);
        assert_eq!(
            fs::read_to_string(deck.join("presentation.md")).unwrap(),
            "new"
        );

        fs::write(deck.join("presentation.md"), "external").unwrap();
        let error = library
            .save_source(&opened.id, "local", &saved.content_hash)
            .unwrap_err();
        assert_eq!(error.code(), "conflict");
        assert!(
            matches!(error, CoreError::Conflict { disk_source, .. } if disk_source == "external")
        );
        assert_eq!(
            fs::read_to_string(deck.join("presentation.md")).unwrap(),
            "external"
        );
    }

    #[test]
    fn save_crash_worker() {
        let Ok(root) = std::env::var("ELEF_CORE_TEST_SAVE_ROOT") else {
            return;
        };
        let library = Library::open(root).unwrap();
        let deck = library.list_decks().unwrap().into_iter().next().unwrap();
        let opened = library.open_deck(&deck.id).unwrap();
        let new_source = "# New source\n".repeat(4096);
        library
            .save_source(&opened.id, &new_source, &opened.content_hash)
            .unwrap();
    }

    #[test]
    fn killing_a_process_at_each_save_point_preserves_complete_bytes_and_cleans_temp_files() {
        const POINTS: [&str; 4] = [
            "before_temp_write",
            "mid_temp_write",
            "after_flush_before_rename",
            "after_rename",
        ];
        const RUNS_PER_POINT: usize = 50;
        let executable = std::env::current_exe().unwrap();
        let new_source = "# New source\n".repeat(4096);

        for point in POINTS {
            for _ in 0..RUNS_PER_POINT {
                let temp = TempDir::new().unwrap();
                let deck_path = write_deck(
                    temp.path(),
                    "Crash fixture",
                    &[("presentation.md", "# Old source\n")],
                );
                let marker = temp.path().join("save-paused");
                let mut child = Command::new(&executable)
                    .args(["--exact", "writes::tests::save_crash_worker", "--nocapture"])
                    .env("ELEF_CORE_TEST_SAVE_ROOT", temp.path())
                    .env("ELEF_CORE_TEST_SAVE_PAUSE", point)
                    .env("ELEF_CORE_TEST_SAVE_MARKER", &marker)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .unwrap();

                let mut reached_save_point = false;
                for _ in 0..500 {
                    if marker.exists() {
                        reached_save_point = true;
                        break;
                    }
                    if let Some(status) = child.try_wait().unwrap() {
                        panic!("save worker exited before {point}: {status}");
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                assert!(reached_save_point, "save worker did not reach {point}");
                child.kill().unwrap();
                assert!(!child.wait().unwrap().success());

                let expected = if point == "after_rename" {
                    new_source.as_str()
                } else {
                    "# Old source\n"
                };
                assert_eq!(
                    fs::read_to_string(deck_path.join("presentation.md")).unwrap(),
                    expected
                );

                let library = Library::open(temp.path()).unwrap();
                let deck = library
                    .list_decks()
                    .unwrap()
                    .into_iter()
                    .find(|summary| summary.name == "Crash fixture")
                    .unwrap();
                library.open_deck(&deck.id).unwrap();
                assert!(fs::read_dir(&deck_path).unwrap().all(|entry| {
                    !entry
                        .unwrap()
                        .file_name()
                        .to_string_lossy()
                        .starts_with(".elef-save-")
                }));
            }
        }
    }

    #[test]
    fn merge_crash_worker() {
        let Ok(root) = std::env::var("ELEF_CORE_TEST_SAVE_ROOT") else {
            return;
        };
        if std::env::var("ELEF_CORE_TEST_MERGE_MODE").is_err() {
            return;
        }
        let library = Library::open(&root).unwrap();
        let deck = library.list_decks().unwrap().into_iter().next().unwrap();
        let opened = library.open_deck(&deck.id).unwrap();
        let source_path = PathBuf::from(&root)
            .join("Crash fixture")
            .join("presentation.md");
        fs::write(&source_path, MERGE_EXTERNAL).unwrap();
        let MergeOutcome::Merged(merged) = library
            .merge_external_change(&opened.id, MERGE_LOCAL)
            .unwrap()
        else {
            panic!("merge fixture must merge cleanly");
        };
        let fresh = library.open_deck(&opened.id).unwrap();
        library
            .save_source(&opened.id, &merged, &fresh.content_hash)
            .unwrap();
    }

    #[test]
    fn killing_a_process_at_each_merge_save_point_preserves_complete_bytes() {
        const POINTS: [&str; 4] = [
            "before_temp_write",
            "mid_temp_write",
            "after_flush_before_rename",
            "after_rename",
        ];
        const RUNS_PER_POINT: usize = 50;
        let MergeOutcome::Merged(expected_merged) =
            merge_sources(MERGE_OLD, MERGE_LOCAL, MERGE_EXTERNAL)
        else {
            panic!("merge fixture must merge cleanly");
        };
        let executable = std::env::current_exe().unwrap();

        for point in POINTS {
            for _ in 0..RUNS_PER_POINT {
                let temp = TempDir::new().unwrap();
                let deck_path = write_deck(
                    temp.path(),
                    "Crash fixture",
                    &[("presentation.md", MERGE_OLD)],
                );
                let marker = temp.path().join("merge-paused");
                let mut child = Command::new(&executable)
                    .args([
                        "--exact",
                        "writes::tests::merge_crash_worker",
                        "--nocapture",
                    ])
                    .env("ELEF_CORE_TEST_SAVE_ROOT", temp.path())
                    .env("ELEF_CORE_TEST_MERGE_MODE", "1")
                    .env("ELEF_CORE_TEST_SAVE_PAUSE", point)
                    .env("ELEF_CORE_TEST_SAVE_MARKER", &marker)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .unwrap();

                wait_for_pause_marker(&marker, &mut child, point);
                child.kill().unwrap();
                assert!(!child.wait().unwrap().success());

                let expected = if point == "after_rename" {
                    expected_merged.as_str()
                } else {
                    MERGE_EXTERNAL
                };
                assert_eq!(
                    fs::read_to_string(deck_path.join("presentation.md")).unwrap(),
                    expected
                );
                let library = Library::open(temp.path()).unwrap();
                let deck = library
                    .list_decks()
                    .unwrap()
                    .into_iter()
                    .find(|summary| summary.name == "Crash fixture")
                    .unwrap();
                library.open_deck(&deck.id).unwrap();
                assert!(fs::read_dir(&deck_path).unwrap().all(|entry| {
                    !entry
                        .unwrap()
                        .file_name()
                        .to_string_lossy()
                        .starts_with(".elef-save-")
                }));
            }
        }
    }

    #[test]
    fn final_fingerprint_check_to_rename_window_stays_below_250ms_p95() {
        let (temp, library) = library();
        let deck = write_deck(temp.path(), "Window", &[("presentation.md", "old")]);
        let id = path_id(&deck.canonicalize().unwrap());
        library.list_decks().unwrap();
        let opened = library.open_deck(&id).unwrap();
        let mut base_hash = opened.content_hash;
        let mut windows = Vec::with_capacity(50);

        for index in 0..50 {
            let saved = library
                .save_source(&opened.id, &format!("revision {index}"), &base_hash)
                .unwrap();
            base_hash = saved.content_hash;
            windows.push(saved.check_to_rename_us);
        }

        windows.sort_unstable();
        let p95 = windows[windows.len() * 95 / 100];
        assert!(
            p95 < 250_000,
            "final fingerprint-check-to-rename p95 was {p95} µs (budget 250000 µs)"
        );
    }

    #[cfg(unix)]
    #[test]
    fn save_rejects_a_symlink_source() {
        let (temp, library) = library();
        let deck = write_deck(temp.path(), "Notes", &[("presentation.md", "old")]);
        let id = path_id(&deck.canonicalize().unwrap());
        library.list_decks().unwrap();
        let external = temp.path().join("outside.md");
        fs::write(&external, "outside").unwrap();
        let source = deck.join("presentation.md");
        fs::remove_file(&source).unwrap();
        symlink(&external, &source).unwrap();

        let error = library
            .save_source(&id, "new", &sha256(b"outside"))
            .unwrap_err();
        assert_eq!(error.code(), "path_rejected");
        assert_eq!(fs::read_to_string(external).unwrap(), "outside");
    }

    #[test]
    fn merge_entry_tracks_open_save_and_missing_ancestor_lifecycle() {
        let (_temp, library) = library();
        let deck = library.create_deck("Merge Entry", "document").unwrap();
        let id = deck.id.clone();
        let ancestor_of = |library: &Library| {
            library
                .records
                .read()
                .expect("deck index lock poisoned")
                .get(&id)
                .expect("deck record")
                .persisted_source
                .clone()
        };
        // Open establishes the ancestor from disk.
        let opened = library.open_deck(&id).unwrap();
        assert_eq!(
            ancestor_of(&library).as_deref(),
            Some(opened.source.as_str())
        );
        // A matching save keeps local/external identical: clean merge.
        let saved = library
            .save_source(&id, "# Merge Entry\n\nbody\n", &opened.content_hash)
            .unwrap();
        assert_eq!(
            ancestor_of(&library).as_deref(),
            Some("# Merge Entry\n\nbody\n")
        );
        assert_eq!(
            library
                .merge_external_change(&id, "# Merge Entry\n\nbody\n")
                .unwrap(),
            MergeOutcome::Merged("# Merge Entry\n\nbody\n".into())
        );
        // External disk change behind a dirty local merges when disjoint.
        let record_path = library.root().join("Merge Entry").join("document.md");
        fs::write(&record_path, "# Merge Entry\n\nbody\nexternal tail\n").unwrap();
        assert_eq!(
            library
                .merge_external_change(&id, "# Merge Entry\n\nLOCAL\n")
                .unwrap(),
            MergeOutcome::Merged("# Merge Entry\n\nLOCAL\nexternal tail\n".into())
        );
        let _ = saved;
    }

    #[test]
    fn merge_entry_without_ancestor_takes_the_conflict_path() {
        let (_temp, library) = library();
        let deck = library.create_deck("No Ancestor", "document").unwrap();
        // Fresh discovery has no in-memory ancestor until the deck is opened.
        library.list_decks().unwrap();
        assert_eq!(
            library
                .merge_external_change(&deck.id, "local text\n")
                .unwrap(),
            MergeOutcome::Overlap
        );
    }

    #[test]
    fn merge_entry_refuses_non_utf8_disk_bytes() {
        let (_temp, library) = library();
        let deck = library.create_deck("Binary Disk", "document").unwrap();
        library.open_deck(&deck.id).unwrap();
        let record_path = library.root().join("Binary Disk").join("document.md");
        fs::write(&record_path, [0xff, 0xfe, 0x00]).unwrap();
        assert_eq!(
            library
                .merge_external_change(&deck.id, "local text\n")
                .unwrap(),
            MergeOutcome::Overlap
        );
    }
}
