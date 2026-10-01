use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::Builder as TempFileBuilder;
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

pub const MANIFEST_FILE: &str = "elef.json";
pub const MANIFEST_SCHEMA_VERSION: u32 = 1;
pub const MAX_SOURCE_BYTES: usize = 50 * 1024 * 1024;
const STALE_TEMP_AGE_SECONDS: u64 = 24 * 60 * 60;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeckManifest {
    pub id: Uuid,
    pub schema_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Fingerprint {
    pub modified_ms: u128,
    pub size: u64,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeckSummary {
    pub id: String,
    pub name: String,
    pub path: String,
    pub modified_ms: u128,
    pub source_file: String,
    pub kind: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OpenDeck {
    pub id: String,
    pub name: String,
    pub source: String,
    pub source_file: String,
    pub content_hash: String,
    pub fingerprint: Fingerprint,
    pub manifest: Option<DeckManifest>,
    pub notices: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SaveResult {
    pub ok: bool,
    pub saved_at_ms: u128,
    pub content_hash: String,
    pub fingerprint: Fingerprint,
}

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("The library root is unavailable.")]
    InvalidLibrary,
    #[error("The deck could not be found.")]
    NotFound,
    #[error("The requested name or source is invalid.")]
    InvalidInput,
    #[error("The requested path is outside the library or is a symbolic link.")]
    PathRejected,
    #[error("The source is too large.")]
    TooLarge,
    #[error("The file changed outside Elef. Reload it or resolve the conflict before saving.")]
    Conflict {
        disk_hash: String,
        disk_source: String,
    },
    #[error("The file operation failed.")]
    Io(#[source] std::io::Error),
}

impl CoreError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidLibrary => "invalid_input",
            Self::NotFound => "not_found",
            Self::InvalidInput => "invalid_input",
            Self::PathRejected => "path_rejected",
            Self::TooLarge => "too_large",
            Self::Conflict { .. } => "conflict",
            Self::Io(_) => "io_error",
        }
    }
}

impl From<std::io::Error> for CoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

#[derive(Debug, Clone)]
struct DeckRecord {
    id: String,
    path: PathBuf,
    source_path: PathBuf,
    source_file: String,
    manifest: Option<DeckManifest>,
    notices: Vec<String>,
}

pub struct Library {
    root: PathBuf,
    records: RwLock<HashMap<String, DeckRecord>>,
    write_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl Library {
    pub fn open(root: impl AsRef<Path>) -> Result<Self, CoreError> {
        let root = fs::canonicalize(root).map_err(|_| CoreError::InvalidLibrary)?;
        if !root.is_dir() {
            return Err(CoreError::InvalidLibrary);
        }

        Ok(Self {
            root,
            records: RwLock::new(HashMap::new()),
            write_locks: Mutex::new(HashMap::new()),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

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

    pub fn open_deck(&self, id: &str) -> Result<OpenDeck, CoreError> {
        let mut record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        remove_stale_temps(&record.path)?;

        if record.manifest.is_none() && !record.path.join(MANIFEST_FILE).exists() {
            let manifest = DeckManifest {
                id: Uuid::new_v4(),
                schema_version: MANIFEST_SCHEMA_VERSION,
            };
            match write_manifest_atomic(&record.path, &manifest) {
                Ok(()) => {
                    record.id = manifest.id.to_string();
                    record.manifest = Some(manifest);
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
        };
        let summary = self.summary(&renamed);
        self.refresh_record(renamed);
        Ok(summary)
    }

    pub fn delete_deck(&self, id: &str) -> Result<(), CoreError> {
        let record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        trash::delete(&record.path)
            .map_err(|_| CoreError::Io(std::io::Error::other("trash failed")))?;
        self.records
            .write()
            .expect("deck index lock poisoned")
            .remove(id);
        Ok(())
    }

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
        let record = self.record(id)?;
        self.validate_deck_path(&record.path)?;
        let disk_bytes = read_regular_file(&record.source_path)?;
        let disk_hash = sha256(&disk_bytes);
        if disk_hash != base_hash {
            return Err(conflict_error(disk_hash, disk_bytes));
        }

        let mut temp = TempFileBuilder::new()
            .prefix(".elef-save-")
            .suffix(".tmp")
            .tempfile_in(&record.path)?;
        let original_permissions = fs::metadata(&record.source_path)?.permissions();
        temp.as_file().set_permissions(original_permissions)?;
        temp.write_all(source.as_bytes())?;
        temp.as_file().sync_all()?;

        // Narrow the check/rename race immediately before replacing the target.
        let current_bytes = read_regular_file(&record.source_path)?;
        let current_hash = sha256(&current_bytes);
        if current_hash != base_hash {
            return Err(conflict_error(current_hash, current_bytes));
        }

        temp.persist(&record.source_path)
            .map_err(|error| CoreError::Io(error.error))?;
        sync_directory(&record.path)?;

        let now = now_ms();
        let fingerprint = fingerprint_bytes(source.as_bytes(), &record.source_path)?;
        Ok(SaveResult {
            ok: true,
            saved_at_ms: now,
            content_hash: fingerprint.content_hash.clone(),
            fingerprint,
        })
    }

    fn discover_decks(&self) -> Result<HashMap<String, DeckRecord>, CoreError> {
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
                    let manifest = DeckManifest {
                        id: Uuid::new_v4(),
                        schema_version: MANIFEST_SCHEMA_VERSION,
                    };
                    if write_manifest_atomic(&record.path, &manifest).is_ok() {
                        record.id = manifest.id.to_string();
                        record.manifest = Some(manifest);
                    } else {
                        record.id = path_id(&record.path);
                        record.notices.push(
                            "A duplicate deck identity could not be repaired because the folder is read-only.".into(),
                        );
                    }
                } else if duplicated && index > 0 {
                    record.id = path_id(&record.path);
                }
                result.insert(record.id.clone(), record);
            }
        }
        Ok(result)
    }

    fn record(&self, id: &str) -> Result<DeckRecord, CoreError> {
        self.records
            .read()
            .expect("deck index lock poisoned")
            .get(id)
            .cloned()
            .ok_or(CoreError::NotFound)
    }

    fn refresh_record(&self, record: DeckRecord) {
        let mut records = self.records.write().expect("deck index lock poisoned");
        records.retain(|_, existing| existing.path != record.path);
        records.insert(record.id.clone(), record);
    }

    fn summary(&self, record: &DeckRecord) -> DeckSummary {
        let metadata = fs::metadata(&record.path).ok();
        let modified_ms = metadata
            .and_then(|metadata| metadata.modified().ok())
            .and_then(system_time_ms)
            .unwrap_or_default();
        let mut warnings = name_warnings(&file_name(&record.path));
        warnings.extend(record.notices.clone());
        DeckSummary {
            id: record.id.clone(),
            name: file_name(&record.path),
            path: record.path.to_string_lossy().into_owned(),
            modified_ms,
            source_file: record.source_file.clone(),
            kind: if record.source_file == "document.md" {
                "document"
            } else {
                "presentation"
            }
            .into(),
            warnings,
        }
    }

    fn validate_deck_path(&self, path: &Path) -> Result<(), CoreError> {
        let metadata = fs::symlink_metadata(path).map_err(|_| CoreError::NotFound)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(CoreError::PathRejected);
        }
        let canonical = fs::canonicalize(path).map_err(|_| CoreError::PathRejected)?;
        if canonical.parent() != Some(self.root.as_path()) {
            return Err(CoreError::PathRejected);
        }
        Ok(())
    }

    fn name_collision_exists(&self, name: &str) -> Result<bool, CoreError> {
        let normalized = normalized_name(name);
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_dir()
                && !file_type.is_symlink()
                && normalized_name(&file_name(&entry.path())) == normalized
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn write_lock(&self, id: &str) -> Arc<Mutex<()>> {
        let mut locks = self.write_locks.lock().expect("write lock table poisoned");
        locks
            .entry(id.to_owned())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

fn choose_source_file(deck_path: &Path) -> Result<Option<String>, CoreError> {
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

fn source_file_key(name: &str) -> (u8, usize, String, String) {
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

fn read_manifest(deck_path: &Path) -> Result<Option<DeckManifest>, ()> {
    let path = deck_path.join(MANIFEST_FILE);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(());
    }
    let bytes = fs::read(path).map_err(|_| ())?;
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
    Ok(Some(DeckManifest { id, schema_version }))
}

fn manifest_notices(manifest: &DeckManifest) -> Vec<String> {
    if manifest.schema_version > MANIFEST_SCHEMA_VERSION {
        vec!["This deck uses a newer Elef folder format; known fields were read.".into()]
    } else {
        Vec::new()
    }
}

fn write_manifest_atomic(deck_path: &Path, manifest: &DeckManifest) -> Result<(), CoreError> {
    let bytes = serde_json::to_vec_pretty(manifest).map_err(|_| CoreError::InvalidInput)?;
    let mut temp = TempFileBuilder::new()
        .prefix(".elef-manifest-")
        .suffix(".tmp")
        .tempfile_in(deck_path)?;
    temp.write_all(&bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(deck_path.join(MANIFEST_FILE))
        .map_err(|error| CoreError::Io(error.error))?;
    sync_directory(deck_path)
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), CoreError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW);
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    if let Some(parent) = path.parent() {
        sync_directory(parent)?;
    }
    Ok(())
}

fn read_regular_file(path: &Path) -> Result<Vec<u8>, CoreError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            CoreError::NotFound
        } else {
            CoreError::Io(error)
        }
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(CoreError::PathRejected);
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW);
    let mut file = options.open(path)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn fingerprint_bytes(bytes: &[u8], path: &Path) -> Result<Fingerprint, CoreError> {
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

fn conflict_error(disk_hash: String, disk_bytes: Vec<u8>) -> CoreError {
    CoreError::Conflict {
        disk_hash,
        disk_source: String::from_utf8_lossy(&disk_bytes).into_owned(),
    }
}

fn remove_stale_temps(deck_path: &Path) -> Result<(), CoreError> {
    let now = SystemTime::now();
    for entry in fs::read_dir(deck_path)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with(".elef-save-") || !name.ends_with(".tmp") {
            continue;
        }
        let metadata = entry.file_type()?;
        if !metadata.is_file() || metadata.is_symlink() {
            continue;
        }
        let old_enough = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .map(|age| age.as_secs() >= STALE_TEMP_AGE_SECONDS)
            .unwrap_or(false);
        if old_enough {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

fn sync_directory(path: &Path) -> Result<(), CoreError> {
    File::open(path)?.sync_all()?;
    Ok(())
}

fn path_id(path: &Path) -> String {
    format!("path:{}", sha256(path.to_string_lossy().as_bytes()))
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn system_time_ms(time: SystemTime) -> Option<u128> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis())
}

fn validate_deck_name(name: &str) -> Result<(), CoreError> {
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

fn normalized_name(name: &str) -> String {
    name.nfc().collect::<String>().to_lowercase()
}

fn name_warnings(name: &str) -> Vec<String> {
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

fn is_reserved_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or_default().to_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem
                .chars()
                .last()
                .is_some_and(|number| ('1'..='9').contains(&number)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use tempfile::TempDir;

    fn library() -> (TempDir, Library) {
        let temp = TempDir::new().unwrap();
        let library = Library::open(temp.path()).unwrap();
        (temp, library)
    }

    fn write_deck(root: &Path, name: &str, files: &[(&str, &str)]) -> PathBuf {
        let path = root.join(name);
        fs::create_dir(&path).unwrap();
        for (file, content) in files {
            fs::write(path.join(file), content).unwrap();
        }
        path
    }

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
        assert_ne!(
            read_manifest(&first).unwrap().unwrap().id,
            read_manifest(&second).unwrap().unwrap().id
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
    fn deck_names_are_single_safe_path_components_and_collisions_are_normalized() {
        assert!(validate_deck_name("Notes").is_ok());
        assert!(validate_deck_name("../outside").is_err());
        assert!(validate_deck_name("with/slash").is_err());
        assert_eq!(normalized_name("Cafe\u{301}"), normalized_name("Café"));
        assert_eq!(normalized_name("My Deck"), normalized_name("my deck"));
    }

    #[test]
    fn newer_manifest_versions_are_read_with_a_notice() {
        let manifest = DeckManifest {
            id: Uuid::new_v4(),
            schema_version: MANIFEST_SCHEMA_VERSION + 2,
        };
        assert_eq!(manifest_notices(&manifest).len(), 1);
    }

    #[test]
    fn unsafe_cross_platform_names_are_warned_about() {
        assert_eq!(name_warnings("My:Deck").len(), 1);
        assert_eq!(name_warnings("CON").len(), 1);
        assert!(name_warnings("My Deck").is_empty());
    }
}
