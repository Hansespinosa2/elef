//! Filesystem watching and coalesced file events.

use std::collections::HashMap;
use std::fs;
use std::path::Component;
use std::path::Path;
use std::path::PathBuf;

use notify::RecursiveMode;
use notify::Watcher as NotifyWatcher;

use crate::consts::WATCH_DEBOUNCE_MS;
use crate::io::{file_name, now_ms};
use crate::library::Library;
use crate::types::{CoreError, FileEvent, FileEventKind};

pub(crate) struct WatchHit {
    pub(crate) removed: bool,
    pub(crate) last_ms: u128,
}

pub(crate) struct WatchState {
    pub(crate) _watcher: notify::RecommendedWatcher,
    pub(crate) events: std::sync::mpsc::Receiver<Result<notify::Event, notify::Error>>,
    pub(crate) pending: HashMap<PathBuf, WatchHit>,
}

pub(crate) fn event_kind_rank(kind: &FileEventKind) -> u8 {
    match kind {
        FileEventKind::SourceRemoved => 0,
        FileEventKind::SourceChanged => 1,
    }
}

pub(crate) fn canonical_event_path(path: &Path) -> Option<PathBuf> {
    if let Ok(canonical) = fs::canonicalize(path) {
        return Some(canonical);
    }
    let parent = path.parent()?;
    let canonical_parent = fs::canonicalize(parent).ok()?;
    Some(canonical_parent.join(file_name(path)))
}

pub(crate) fn is_ignored_watch_path(root: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return true;
    };
    relative.components().any(
        |part| matches!(part, Component::Normal(name) if name.to_string_lossy().starts_with('.')),
    )
}

impl Library {
    /// Starts recursive filesystem watching of the library root. Idempotent.
    /// Events are coalesced per path and drained with
    /// [`Library::poll_file_events`]; nothing is delivered before then.
    pub fn enable_watching(&self) -> Result<(), CoreError> {
        let mut slot = self.file_watcher.lock().expect("watcher lock poisoned");
        if slot.is_some() {
            return Ok(());
        }
        let (sender, events) = std::sync::mpsc::channel();
        let mut watcher = notify::RecommendedWatcher::new(
            move |event| {
                let _ = sender.send(event);
            },
            notify::Config::default(),
        )
        .map_err(|error| CoreError::Io(std::io::Error::other(error.to_string())))?;
        watcher
            .watch(&self.root, RecursiveMode::Recursive)
            .map_err(|error| CoreError::Io(std::io::Error::other(error.to_string())))?;
        *slot = Some(WatchState {
            _watcher: watcher,
            events,
            pending: HashMap::new(),
        });
        Ok(())
    }

    /// Drains coalesced external filesystem events for deck source files.
    /// A path is reported once it has been quiet for the debounce window, so
    /// rapid successive writes surface as a single event. Dot-files, history,
    /// temp files, and non-source deck files never produce events. Returns an
    /// empty list while watching is disabled. Sorted by deck id.
    pub fn poll_file_events(&self) -> Vec<FileEvent> {
        let mut slot = self.file_watcher.lock().expect("watcher lock poisoned");
        let Some(state) = slot.as_mut() else {
            return Vec::new();
        };
        while let Ok(result) = state.events.try_recv() {
            let Ok(event) = result else { continue };
            let removed = event.kind.is_remove();
            for path in event.paths {
                match canonical_event_path(&path) {
                    Some(canonical) => {
                        state.pending.insert(
                            canonical,
                            WatchHit {
                                removed,
                                last_ms: now_ms(),
                            },
                        );
                    }
                    None => continue,
                }
            }
        }
        let now = now_ms();
        let mut quiet = Vec::new();
        state.pending.retain(|path, hit| {
            if now.saturating_sub(hit.last_ms) >= WATCH_DEBOUNCE_MS {
                quiet.push((path.clone(), hit.removed));
                false
            } else {
                true
            }
        });
        drop(slot);
        let records = self.records.read().expect("deck index lock poisoned");
        let mut events = Vec::new();
        for (path, removed) in quiet {
            let Some(record) = records
                .values()
                .find(|record| path.starts_with(&record.path))
            else {
                continue;
            };
            if is_ignored_watch_path(&self.root, &path) {
                continue;
            }
            let kind = if path == record.source_path {
                if record.source_path.exists() {
                    FileEventKind::SourceChanged
                } else {
                    FileEventKind::SourceRemoved
                }
            } else if removed && path == record.path {
                FileEventKind::SourceRemoved
            } else {
                continue;
            };
            events.push(FileEvent {
                deck_id: record.id.clone(),
                kind,
            });
        }
        // Removal is terminal: it wins when one drain holds both kinds.
        events.sort_by(|a, b| {
            a.deck_id
                .cmp(&b.deck_id)
                .then_with(|| event_kind_rank(&a.kind).cmp(&event_kind_rank(&b.kind)))
        });
        events.dedup_by(|a, b| a.deck_id == b.deck_id);
        events
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use crate::test_support::{library, poll_until};
    use crate::types::FileEventKind;

    #[test]
    fn watcher_drains_empty_while_disabled_and_enables_idempotently() {
        let (_temp, library) = library();
        let deck = library.create_deck("Watch Disabled", "document").unwrap();
        assert!(library.poll_file_events().is_empty());
        library.enable_watching().unwrap();
        library.enable_watching().unwrap();
        let path = library.root().join("Watch Disabled").join("document.md");
        fs::write(&path, "changed\n").unwrap();
        let events = poll_until(
            &library,
            &deck.id,
            FileEventKind::SourceChanged,
            "direct write",
        );
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn watcher_reports_git_style_rename_over_temp() {
        let (_temp, library) = library();
        let deck = library.create_deck("Watch Rename", "document").unwrap();
        library.enable_watching().unwrap();
        let dir = library.root().join("Watch Rename");
        let temp = dir.join(".git-tmp-write");
        fs::write(&temp, "renamed over\n").unwrap();
        fs::rename(&temp, dir.join("document.md")).unwrap();
        poll_until(
            &library,
            &deck.id,
            FileEventKind::SourceChanged,
            "rename-over-temp",
        );
    }

    #[test]
    fn watcher_reports_atomic_replace_and_delete_recreate() {
        let (_temp, library) = library();
        let deck = library.create_deck("Watch Atomic", "document").unwrap();
        library.enable_watching().unwrap();
        // Sync-tool style: delete then recreate with new bytes.
        let path = library.root().join("Watch Atomic").join("document.md");
        fs::remove_file(&path).unwrap();
        poll_until(
            &library,
            &deck.id,
            FileEventKind::SourceRemoved,
            "source removal",
        );
        fs::write(&path, "recreated\n").unwrap();
        poll_until(
            &library,
            &deck.id,
            FileEventKind::SourceChanged,
            "recreate after removal",
        );
    }

    #[test]
    fn watcher_coalesces_rapid_successive_writes() {
        let (_temp, library) = library();
        let deck = library.create_deck("Watch Coalesce", "document").unwrap();
        library.enable_watching().unwrap();
        let path = library.root().join("Watch Coalesce").join("document.md");
        for i in 0..5 {
            fs::write(&path, format!("revision {i}\n")).unwrap();
        }
        let events = poll_until(
            &library,
            &deck.id,
            FileEventKind::SourceChanged,
            "coalesced writes",
        );
        assert_eq!(events.len(), 1);
        // Nothing further arrives after the quiet drain.
        std::thread::sleep(std::time::Duration::from_millis(700));
        assert!(library.poll_file_events().is_empty());
    }

    #[test]
    fn watcher_ignores_history_temp_and_dot_files() {
        let (_temp, library) = library();
        let deck = library.create_deck("Watch Ignored", "document").unwrap();
        library.enable_watching().unwrap();
        library.take_snapshot(&deck.id, "interval", None).unwrap();
        let dir = library.root().join("Watch Ignored");
        fs::write(dir.join(".elef-save-1.tmp"), b"temp").unwrap();
        fs::write(dir.join(".DS_Store"), b"junk").unwrap();
        // Snapshot and temp activity must stay silent past the debounce window.
        std::thread::sleep(std::time::Duration::from_millis(900));
        assert!(library.poll_file_events().is_empty());
    }

    #[test]
    fn watcher_reports_deck_directory_removal() {
        let (_temp, library) = library();
        let deck = library.create_deck("Watch Rmdir", "document").unwrap();
        library.enable_watching().unwrap();
        fs::remove_dir_all(library.root().join("Watch Rmdir")).unwrap();
        poll_until(
            &library,
            &deck.id,
            FileEventKind::SourceRemoved,
            "deck directory removal",
        );
    }
}
