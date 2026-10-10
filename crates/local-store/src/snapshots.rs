//! Snapshot history take/list/restore/prune.

use std::fs;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;

use tempfile::Builder as TempFileBuilder;

use crate::consts::{MAX_SOURCE_BYTES, SNAPSHOT_DIR, SNAPSHOT_RETENTION_MS};
use crate::io::{
    file_name, fingerprint_bytes, now_ms, pause_for_store_fault, read_regular_file, sha256,
    sync_directory,
};
use crate::library::Library;
use crate::types::{CoreError, RestoreOutcome, SnapshotInfo};

pub(crate) fn validate_snapshot_reason(reason: &str) -> Result<(), CoreError> {
    if reason.is_empty()
        || reason.len() > 32
        || !reason
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(CoreError::InvalidInput);
    }
    Ok(())
}

pub(crate) fn unique_snapshot_name(dir: &Path, reason: &str) -> (u128, String) {
    let mut stamp = now_ms();
    loop {
        let file_name = format!("{stamp}-{reason}.snap");
        if !dir.join(&file_name).exists() {
            return (stamp, file_name);
        }
        stamp += 1;
    }
}

pub(crate) fn validate_snapshot_id(id: &str) -> Result<(), CoreError> {
    let Some((stamp, reason)) = id.split_once('-') else {
        return Err(CoreError::InvalidInput);
    };
    if stamp.is_empty()
        || stamp.len() > 20
        || !stamp.chars().all(|c| c.is_ascii_digit())
        || stamp.parse::<u128>().is_err()
    {
        return Err(CoreError::InvalidInput);
    }
    validate_snapshot_reason(reason)
}

impl Library {
    /// Snapshots deck source bytes for crash/conflict recovery. `source`
    /// snapshots caller-provided text (unsaved local edits); `None` snapshots
    /// the current disk bytes under the deck write lock. Prunes snapshots
    /// older than the retention window on every take.
    pub fn take_snapshot(
        &self,
        id: &str,
        reason: &str,
        source: Option<&str>,
    ) -> Result<SnapshotInfo, CoreError> {
        validate_snapshot_reason(reason)?;
        let record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        let lock = self.write_lock(id);
        let _guard = lock.lock().expect("deck write lock poisoned");
        let bytes: Vec<u8> = match source {
            Some(text) => {
                if text.len() > MAX_SOURCE_BYTES {
                    return Err(CoreError::TooLarge);
                }
                text.as_bytes().to_vec()
            }
            None => read_regular_file(&record.source_path)?,
        };
        if bytes.len() > MAX_SOURCE_BYTES {
            return Err(CoreError::TooLarge);
        }
        let dir = self.snapshot_dir(&record.id);
        fs::create_dir_all(&dir)?;
        let (taken_at_ms, file_name) = unique_snapshot_name(&dir, reason);
        let mut staged = TempFileBuilder::new()
            .prefix(".elef-snapshot-")
            .suffix(".tmp")
            .tempfile_in(&dir)?;
        staged.write_all(&bytes)?;
        staged.as_file().sync_all()?;
        pause_for_store_fault("before_snapshot_persist");
        staged.persist(dir.join(&file_name)).map_err(|error| {
            CoreError::Io(std::io::Error::other(format!(
                "snapshot persist failed: {}",
                error.error
            )))
        })?;
        sync_directory(&dir)?;
        self.prune_snapshots(&record.id)?;
        let id = file_name
            .strip_suffix(".snap")
            .expect("snapshot file name")
            .to_owned();
        Ok(SnapshotInfo {
            id,
            taken_at_ms,
            reason: reason.to_owned(),
            byte_len: bytes.len(),
            content_hash: sha256(&bytes),
        })
    }

    /// Lists this deck's snapshots newest first. Read-only: never prunes.
    pub fn list_snapshots(&self, id: &str) -> Result<Vec<SnapshotInfo>, CoreError> {
        let record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        let dir = self.snapshot_dir(&record.id);
        let mut snapshots = Vec::new();
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(snapshots),
            Err(error) => return Err(CoreError::Io(error)),
        };
        for entry in entries {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let name = file_name(&entry.path());
            let Some(stem) = name.strip_suffix(".snap") else {
                continue;
            };
            let Some((stamp, reason)) = stem.split_once('-') else {
                continue;
            };
            let Ok(taken_at_ms) = stamp.parse::<u128>() else {
                continue;
            };
            if validate_snapshot_reason(reason).is_err() {
                continue;
            }
            let bytes = fs::read(entry.path())?;
            snapshots.push(SnapshotInfo {
                id: stem.to_owned(),
                taken_at_ms,
                reason: reason.to_owned(),
                byte_len: bytes.len(),
                content_hash: sha256(&bytes),
            });
        }
        snapshots.sort_by(|a, b| {
            b.taken_at_ms
                .cmp(&a.taken_at_ms)
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(snapshots)
    }

    /// Restores deck bytes from a snapshot, snapshotting the current disk
    /// bytes first so the overwrite is itself recoverable. Returns the
    /// restored content hash.
    pub fn restore_snapshot(
        &self,
        id: &str,
        snapshot_id: &str,
    ) -> Result<RestoreOutcome, CoreError> {
        validate_snapshot_id(snapshot_id)?;
        let mut record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        let lock = self.write_lock(id);
        let _guard = lock.lock().expect("deck write lock poisoned");
        let dir = self.snapshot_dir(&record.id);
        let bytes = fs::read(dir.join(format!("{snapshot_id}.snap"))).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                CoreError::NotFound
            } else {
                CoreError::Io(error)
            }
        })?;
        if bytes.len() > MAX_SOURCE_BYTES {
            return Err(CoreError::TooLarge);
        }
        // Snapshot the about-to-be-replaced disk bytes before overwriting.
        let current = read_regular_file(&record.source_path)?;
        let (_, pre_name) = unique_snapshot_name(&dir, "pre-restore");
        let mut staged_pre = TempFileBuilder::new()
            .prefix(".elef-snapshot-")
            .suffix(".tmp")
            .tempfile_in(&dir)?;
        staged_pre.write_all(&current)?;
        staged_pre.as_file().sync_all()?;
        staged_pre.persist(dir.join(&pre_name)).map_err(|error| {
            CoreError::Io(std::io::Error::other(format!(
                "snapshot persist failed: {}",
                error.error
            )))
        })?;
        let mut staged = TempFileBuilder::new()
            .prefix(".elef-restore-")
            .suffix(".tmp")
            .tempfile_in(&record.path)?;
        staged.write_all(&bytes)?;
        staged.as_file().sync_all()?;
        pause_for_store_fault("before_snapshot_restore");
        staged
            .persist(&record.source_path)
            .map_err(|error| CoreError::Io(error.error))?;
        sync_directory(&record.path)?;
        let fingerprint = fingerprint_bytes(&bytes, &record.source_path)?;
        record.persisted_source = String::from_utf8(bytes).ok();
        self.refresh_record(record);
        self.prune_snapshots(id)?;
        Ok(RestoreOutcome {
            content_hash: fingerprint.content_hash,
        })
    }

    pub(crate) fn snapshot_dir(&self, id: &str) -> PathBuf {
        self.root.join(SNAPSHOT_DIR).join(id)
    }

    pub(crate) fn prune_snapshots(&self, id: &str) -> Result<(), CoreError> {
        let dir = self.snapshot_dir(id);
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(CoreError::Io(error)),
        };
        let cutoff = now_ms().saturating_sub(SNAPSHOT_RETENTION_MS);
        for entry in entries {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if !file_type.is_file() {
                continue;
            }
            let name = file_name(&entry.path());
            if name.starts_with(".elef-snapshot-") && name.ends_with(".tmp") {
                if !file_type.is_symlink() {
                    let _ = fs::remove_file(entry.path());
                }
                continue;
            }
            let keep = name
                .strip_suffix(".snap")
                .and_then(|stem| stem.split_once('-'))
                .and_then(|(stamp, _)| stamp.parse::<u128>().ok())
                .is_some_and(|taken| taken >= cutoff);
            if !keep {
                pause_for_store_fault("before_snapshot_prune");
                fs::remove_file(entry.path())?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::process::Command;
    use std::process::Stdio;

    use tempfile::TempDir;

    use crate::consts::{MAX_SOURCE_BYTES, SNAPSHOT_DIR};
    use crate::library::Library;
    use crate::merge::MergeOutcome;
    use crate::test_support::{library, wait_for_pause_marker, write_deck};
    use crate::types::CoreError;

    #[test]
    fn snapshot_crash_worker() {
        let Ok(root) = std::env::var("ELEF_CORE_TEST_STORE_ROOT") else {
            return;
        };
        let mode = std::env::var("ELEF_CORE_TEST_STORE_MODE").unwrap();
        let library = Library::open(root).unwrap();
        let deck = library.list_decks().unwrap().into_iter().next().unwrap();
        let opened = library.open_deck(&deck.id).unwrap();
        match mode.as_str() {
            "take" => {
                library
                    .take_snapshot(
                        &opened.id,
                        "killprobe",
                        Some(&"# Snapshot source\n".repeat(4096)),
                    )
                    .unwrap();
            }
            "restore" => {
                library
                    .take_snapshot(
                        &opened.id,
                        "killprobe",
                        Some(&"# Snapshot source\n".repeat(4096)),
                    )
                    .unwrap();
                let snapshots = library.list_snapshots(&opened.id).unwrap();
                library
                    .restore_snapshot(&opened.id, &snapshots[0].id)
                    .unwrap();
            }
            _ => panic!("unknown store crash mode: {mode}"),
        }
    }

    #[test]
    fn killing_a_process_at_snapshot_points_preserves_deck_and_history() {
        const CASES: [(&str, &str); 2] = [
            ("take", "before_snapshot_persist"),
            ("restore", "before_snapshot_restore"),
        ];
        const RUNS_PER_POINT: usize = 50;
        const OLD: &str = "# Old source\n";
        let executable = std::env::current_exe().unwrap();

        for (mode, point) in CASES {
            for _ in 0..RUNS_PER_POINT {
                let temp = TempDir::new().unwrap();
                let deck_path =
                    write_deck(temp.path(), "Crash fixture", &[("presentation.md", OLD)]);
                let marker = temp.path().join("store-paused");
                let mut child = Command::new(&executable)
                    .args([
                        "--exact",
                        "snapshots::tests::snapshot_crash_worker",
                        "--nocapture",
                    ])
                    .env("ELEF_CORE_TEST_STORE_ROOT", temp.path())
                    .env("ELEF_CORE_TEST_STORE_MODE", mode)
                    .env("ELEF_CORE_TEST_STORE_PAUSE", point)
                    .env("ELEF_CORE_TEST_STORE_MARKER", &marker)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .unwrap();

                wait_for_pause_marker(&marker, &mut child, point);
                child.kill().unwrap();
                assert!(!child.wait().unwrap().success());

                assert_eq!(
                    fs::read_to_string(deck_path.join("presentation.md")).unwrap(),
                    OLD
                );
                let library = Library::open(temp.path()).unwrap();
                let deck = library
                    .list_decks()
                    .unwrap()
                    .into_iter()
                    .find(|summary| summary.name == "Crash fixture")
                    .unwrap();
                library.open_deck(&deck.id).unwrap();

                let history = temp.path().join(SNAPSHOT_DIR).join(&deck.id);
                if mode == "take" {
                    assert!(library.list_snapshots(&deck.id).unwrap().is_empty());
                    let taken = library
                        .take_snapshot(&deck.id, "afterkill", Some("recovered"))
                        .unwrap();
                    assert_eq!(taken.byte_len, "recovered".len());
                    assert!(fs::read_dir(&history).unwrap().all(|entry| {
                        !entry
                            .unwrap()
                            .file_name()
                            .to_string_lossy()
                            .starts_with(".elef-snapshot-")
                    }));
                } else {
                    let pre = fs::read_dir(&history)
                        .unwrap()
                        .filter_map(|entry| entry.ok())
                        .map(|entry| entry.path())
                        .find(|path| {
                            path.file_name().is_some_and(|name| {
                                name.to_string_lossy().ends_with("-pre-restore.snap")
                            })
                        })
                        .expect("pre-restore snapshot must survive the kill");
                    assert_eq!(fs::read_to_string(pre).unwrap(), OLD);
                    assert!(fs::read_dir(&deck_path).unwrap().all(|entry| {
                        !entry
                            .unwrap()
                            .file_name()
                            .to_string_lossy()
                            .starts_with(".elef-restore-")
                    }));
                }
            }
        }
    }

    #[test]
    fn snapshots_round_trip_disk_and_provided_text_newest_first() {
        let (_temp, library) = library();
        let deck = library.create_deck("Snapshots", "document").unwrap();
        let disk = library.take_snapshot(&deck.id, "interval", None).unwrap();
        assert_eq!(disk.reason, "interval");
        assert!(!disk.content_hash.is_empty());
        let local = library
            .take_snapshot(&deck.id, "pre-merge", Some("unsaved local\n"))
            .unwrap();
        let listed = library.list_snapshots(&deck.id).unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed[0].taken_at_ms >= listed[1].taken_at_ms);
        let by_id = |id: &str| listed.iter().find(|snapshot| snapshot.id == id);
        assert_eq!(by_id(&local.id).unwrap().byte_len, "unsaved local\n".len());
        assert_eq!(by_id(&disk.id).unwrap().reason, "interval");
    }

    #[test]
    fn snapshot_reason_and_id_validation_rejects_path_escapes() {
        let (_temp, library) = library();
        let deck = library.create_deck("Snapshot Names", "document").unwrap();
        for bad in ["", "../x", "a/b", "a.b", "a b", "x".repeat(33).as_str()] {
            assert!(
                library.take_snapshot(&deck.id, bad, None).is_err(),
                "reason {bad:?} must be rejected"
            );
        }
        for bad in [
            "",
            "1",
            "abc-x",
            "1-x/y",
            "../1-x",
            "1-..",
            "9".repeat(21).as_str(),
        ] {
            assert!(
                library.restore_snapshot(&deck.id, bad).is_err(),
                "snapshot id {bad:?} must be rejected"
            );
        }
        assert!(library.take_snapshot(&deck.id, "a-1_b", None).is_ok());
    }

    #[test]
    fn snapshot_restore_snapshots_current_disk_first_and_updates_ancestor() {
        let (_temp, library) = library();
        let deck = library.create_deck("Restore", "document").unwrap();
        let opened = library.open_deck(&deck.id).unwrap();
        let first = library.take_snapshot(&deck.id, "interval", None).unwrap();
        let updated = "# Restore\n\nversion two\n";
        library
            .save_source(&deck.id, updated, &opened.content_hash)
            .unwrap();
        let outcome = library.restore_snapshot(&deck.id, &first.id).unwrap();
        assert_eq!(outcome.content_hash, first.content_hash);
        let reread = library.open_deck(&deck.id).unwrap();
        assert_eq!(reread.source, opened.source);
        // The overwritten bytes survive as a pre-restore snapshot.
        let listed = library.list_snapshots(&deck.id).unwrap();
        let pre = listed
            .iter()
            .find(|snapshot| snapshot.reason == "pre-restore")
            .expect("pre-restore snapshot");
        assert_eq!(pre.byte_len, updated.len());
        // Ancestor follows the restore, so merging the restored text is clean.
        assert_eq!(
            library
                .merge_external_change(&deck.id, &opened.source)
                .unwrap(),
            MergeOutcome::Merged(opened.source.clone())
        );
    }

    #[test]
    fn snapshot_restore_missing_is_not_found() {
        let (_temp, library) = library();
        let deck = library.create_deck("Restore Missing", "document").unwrap();
        let error = library
            .restore_snapshot(&deck.id, "1-interval")
            .unwrap_err();
        assert!(matches!(error, CoreError::NotFound));
    }

    #[test]
    fn snapshots_prune_by_filename_stamp_and_ignore_junk() {
        let (_temp, library) = library();
        let deck = library.create_deck("Prune", "document").unwrap();
        let dir = library.root().join(".elef-history").join(&deck.id);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("1-interval.snap"), b"ancient").unwrap();
        fs::write(dir.join("junk.txt"), b"junk").unwrap();
        fs::write(dir.join("no-stamp.snap"), b"junk").unwrap();
        fs::create_dir(dir.join("subdir.snap")).unwrap();
        let fresh = library.take_snapshot(&deck.id, "interval", None).unwrap();
        assert!(!dir.join("1-interval.snap").exists());
        let listed = library.list_snapshots(&deck.id).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, fresh.id);
        // History storage never disturbs deck discovery.
        let decks = library.list_decks().unwrap();
        assert!(decks.iter().any(|deck| deck.name == "Prune"));
    }

    #[test]
    fn snapshots_preserve_non_utf8_disk_bytes() {
        let (_temp, library) = library();
        let deck = library.create_deck("Binary Snapshots", "document").unwrap();
        let record_path = library.root().join("Binary Snapshots").join("document.md");
        fs::write(&record_path, [0xff, 0xfe, 0x00, b'\n']).unwrap();
        let taken = library.take_snapshot(&deck.id, "interval", None).unwrap();
        assert_eq!(taken.byte_len, 4);
        fs::write(&record_path, b"replaced\n").unwrap();
        library.restore_snapshot(&deck.id, &taken.id).unwrap();
        assert_eq!(fs::read(&record_path).unwrap(), [0xff, 0xfe, 0x00, b'\n']);
    }

    #[test]
    fn snapshot_rejects_oversized_text() {
        let (_temp, library) = library();
        let deck = library.create_deck("Huge Snapshot", "document").unwrap();
        let huge = "x".repeat(MAX_SOURCE_BYTES + 1);
        let error = library
            .take_snapshot(&deck.id, "interval", Some(&huge))
            .unwrap_err();
        assert!(matches!(error, CoreError::TooLarge));
    }
}
