//! Shared helpers for unit tests.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::time::Instant;

use tempfile::TempDir;

use crate::library::Library;
use crate::types::{FileEvent, FileEventKind};

pub(crate) fn library() -> (TempDir, Library) {
    let temp = TempDir::new().unwrap();
    let library = Library::open(temp.path()).unwrap();
    (temp, library)
}

pub(crate) fn write_deck(root: &Path, name: &str, files: &[(&str, &str)]) -> PathBuf {
    let path = root.join(name);
    fs::create_dir(&path).unwrap();
    for (file, content) in files {
        fs::write(path.join(file), content).unwrap();
    }
    path
}

pub(crate) const MERGE_OLD: &str = "one\ntwo\n";

pub(crate) const MERGE_LOCAL: &str = "ONE\ntwo\n";

pub(crate) const MERGE_EXTERNAL: &str = "one\nTWO\n";

pub(crate) fn wait_for_pause_marker(marker: &Path, child: &mut std::process::Child, point: &str) {
    for _ in 0..500 {
        if marker.exists() {
            return;
        }
        if let Some(status) = child.try_wait().unwrap() {
            panic!("crash worker exited before {point}: {status}");
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    panic!("crash worker did not reach {point}");
}

pub(crate) fn tree_bytes(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn visit(root: &Path, current: &Path, files: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(current).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if entry.file_type().unwrap().is_dir() {
                visit(root, &path, files);
            } else {
                let name = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                files.insert(name, fs::read(path).unwrap());
            }
        }
    }
    let mut files = BTreeMap::new();
    visit(root, root, &mut files);
    files
}

pub(crate) fn mark_first_central_entry_as_symlink(bytes: &mut [u8]) {
    let signature = [0x50, 0x4b, 0x01, 0x02];
    let offset = bytes
        .windows(signature.len())
        .position(|window| window == signature)
        .expect("zip central directory entry");
    bytes[offset + 5] = 3;
    bytes[offset + 38..offset + 42].copy_from_slice(&(0o120777_u32 << 16).to_le_bytes());
}

pub(crate) fn poll_until(
    library: &Library,
    deck_id: &str,
    kind: FileEventKind,
    what: &str,
) -> Vec<FileEvent> {
    let deadline = Instant::now() + std::time::Duration::from_secs(20);
    loop {
        let events = library.poll_file_events();
        if events
            .iter()
            .any(|event| event.deck_id == deck_id && event.kind == kind)
        {
            return events;
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {what} after 20s"
        );
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}
