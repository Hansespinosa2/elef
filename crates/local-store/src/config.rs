//! Library config and authoring registries.

use std::collections::BTreeMap;
use std::fs;

use serde::Deserialize;
use serde::Serialize;

use crate::assets::is_sha256;
use crate::consts::{
    AUTHORING_REGISTRY_MAX_BYTES, AUTHORING_REGISTRY_MAX_ENTRIES,
    AUTHORING_REGISTRY_SCHEMA_VERSION, LIBRARY_CONFIG_DIR, LIBRARY_CONFIG_FILE,
    LIBRARY_CONFIG_SCHEMA_VERSION,
};
use crate::io::{
    read_regular_file_limited, sha256, write_file_atomic, write_file_atomic_if_unchanged,
};
use crate::library::Library;
use crate::types::{AuthoringRegistries, AuthoringRegistryHashes, CoreError, LibraryConfig};

impl Default for AuthoringRegistries {
    fn default() -> Self {
        Self {
            snippets: Vec::new(),
            math_shortcuts: Vec::new(),
            hashes: AuthoringRegistryHashes {
                snippets: sha256(&[]),
                math_shortcuts: sha256(&[]),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct AuthoringRegistryFile {
    pub(crate) schema_version: u32,
    #[serde(default)]
    pub(crate) entries: Vec<serde_json::Value>,
}

impl Default for LibraryConfig {
    fn default() -> Self {
        Self {
            schema_version: LIBRARY_CONFIG_SCHEMA_VERSION,
            theme: "dark".into(),
            hotkeys: BTreeMap::new(),
        }
    }
}

pub(crate) fn validate_library_config(config: &LibraryConfig) -> Result<(), CoreError> {
    if config.schema_version == 0
        || !matches!(config.theme.as_str(), "system" | "light" | "dark")
        || config.hotkeys.len() > 100
        || config.hotkeys.iter().any(|(action, binding)| {
            action.is_empty()
                || action.len() > 80
                || binding.len() > 80
                || action.chars().any(char::is_control)
                || binding.chars().any(char::is_control)
        })
    {
        return Err(CoreError::InvalidInput);
    }
    Ok(())
}

pub(crate) fn validate_authoring_entries(
    entries: &[serde_json::Value],
    is_math: bool,
) -> Result<(), CoreError> {
    if entries.len() > AUTHORING_REGISTRY_MAX_ENTRIES {
        return Err(CoreError::TooLarge);
    }
    let serialized = serde_json::to_vec(entries).map_err(|_| CoreError::InvalidInput)?;
    if serialized.len() as u64 > AUTHORING_REGISTRY_MAX_BYTES {
        return Err(CoreError::TooLarge);
    }
    for entry in entries {
        let Some(object) = entry.as_object() else {
            return Err(CoreError::InvalidInput);
        };
        let identifier = object.get("id").ok_or(CoreError::InvalidInput)?;
        let valid_id = identifier.as_str().is_some_and(|value| {
            !value.is_empty() && value.len() <= 200 && !value.chars().any(char::is_control)
        }) || identifier.as_u64().is_some();
        if !valid_id || object.get("built_in").and_then(|value| value.as_bool()) == Some(true) {
            return Err(CoreError::InvalidInput);
        }
        validate_authoring_text(object.get("name"), 500)?;
        validate_authoring_optional_text(object.get("description"), 500)?;
        if is_math {
            validate_authoring_text(object.get("prefix"), 8)?;
            validate_authoring_text(object.get("expansion"), 20_000)?;
            validate_authoring_string_array(object.get("aliases"), 100, 120)?;
        } else {
            validate_authoring_text(object.get("trigger"), 120)?;
            validate_authoring_text(object.get("category"), 80)?;
            validate_authoring_text(object.get("body"), 20_000)?;
        }
        if object
            .get("behavior")
            .is_some_and(|value| !value.is_object())
            || object
                .get("contexts")
                .is_some_and(|value| validate_authoring_string_array(Some(value), 20, 80).is_err())
            || object.get("search_terms").is_some_and(|value| {
                validate_authoring_string_array(Some(value), 100, 500).is_err()
            })
        {
            return Err(CoreError::InvalidInput);
        }
    }
    Ok(())
}

pub(crate) fn validate_authoring_text(
    value: Option<&serde_json::Value>,
    max_bytes: usize,
) -> Result<(), CoreError> {
    let Some(text) = value.and_then(|value| value.as_str()) else {
        return Err(CoreError::InvalidInput);
    };
    if text.is_empty() || text.len() > max_bytes || text.chars().any(char::is_control) {
        return Err(CoreError::InvalidInput);
    }
    Ok(())
}

pub(crate) fn validate_authoring_optional_text(
    value: Option<&serde_json::Value>,
    max_bytes: usize,
) -> Result<(), CoreError> {
    let Some(text) = value.and_then(|value| value.as_str()) else {
        return Err(CoreError::InvalidInput);
    };
    if text.len() > max_bytes || text.chars().any(char::is_control) {
        return Err(CoreError::InvalidInput);
    }
    Ok(())
}

pub(crate) fn validate_authoring_string_array(
    value: Option<&serde_json::Value>,
    max_items: usize,
    max_bytes: usize,
) -> Result<(), CoreError> {
    let Some(items) = value.and_then(|value| value.as_array()) else {
        return Err(CoreError::InvalidInput);
    };
    if items.len() > max_items
        || items.iter().any(|item| {
            item.as_str()
                .is_none_or(|text| text.len() > max_bytes || text.chars().any(char::is_control))
        })
    {
        return Err(CoreError::InvalidInput);
    }
    Ok(())
}

impl Library {
    pub fn read_config(&self) -> Result<LibraryConfig, CoreError> {
        let directory = self.root.join(LIBRARY_CONFIG_DIR);
        let metadata = match fs::symlink_metadata(&directory) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(LibraryConfig::default());
            }
            Err(error) => return Err(CoreError::Io(error)),
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(CoreError::PathRejected);
        }
        let canonical_directory = fs::canonicalize(&directory)?;
        if canonical_directory.parent() != Some(self.root.as_path()) {
            return Err(CoreError::PathRejected);
        }
        let path = canonical_directory.join(LIBRARY_CONFIG_FILE);
        match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(LibraryConfig::default());
            }
            Err(error) => return Err(CoreError::Io(error)),
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(CoreError::PathRejected);
            }
            Ok(_) => {}
        }
        let bytes = read_regular_file_limited(&path, 1024 * 1024)?;
        let config: LibraryConfig =
            serde_json::from_slice(&bytes).map_err(|_| CoreError::InvalidInput)?;
        validate_library_config(&config)?;
        Ok(config)
    }

    pub fn write_config(&self, config: &LibraryConfig) -> Result<(), CoreError> {
        validate_library_config(config)?;
        let directory = self.root.join(LIBRARY_CONFIG_DIR);
        match fs::symlink_metadata(&directory) {
            Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
                return Err(CoreError::PathRejected);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&directory)?;
            }
            Err(error) => return Err(CoreError::Io(error)),
        }
        let canonical_directory = fs::canonicalize(&directory)?;
        if canonical_directory.parent() != Some(self.root.as_path()) {
            return Err(CoreError::PathRejected);
        }
        let path = canonical_directory.join(LIBRARY_CONFIG_FILE);
        write_file_atomic(
            &path,
            &serde_json::to_vec_pretty(config).map_err(|_| CoreError::InvalidInput)?,
        )
    }

    pub fn read_authoring_registries(&self) -> Result<AuthoringRegistries, CoreError> {
        let (snippets, snippets_hash) = self.read_authoring_entries("snippets.json", false)?;
        let (math_shortcuts, math_shortcuts_hash) =
            self.read_authoring_entries("math-shortcuts.json", true)?;
        Ok(AuthoringRegistries {
            snippets,
            math_shortcuts,
            hashes: AuthoringRegistryHashes {
                snippets: snippets_hash,
                math_shortcuts: math_shortcuts_hash,
            },
        })
    }

    pub fn write_authoring_registry(
        &self,
        registry: &str,
        entries: &[serde_json::Value],
        base_hash: &str,
    ) -> Result<String, CoreError> {
        let (file_name, is_math) = match registry {
            "snippets" => ("snippets.json", false),
            "math_shortcuts" => ("math-shortcuts.json", true),
            _ => return Err(CoreError::InvalidInput),
        };
        if !is_sha256(base_hash) {
            return Err(CoreError::InvalidInput);
        }
        validate_authoring_entries(entries, is_math)?;

        // Keep concurrent in-app edits to one registry from both passing the
        // same hash check. External writers do not honor this lock, so the
        // on-disk hash check remains necessary as well.
        let lock = self.write_lock(&format!("authoring:{registry}"));
        let _guard = lock.lock().expect("authoring registry write lock poisoned");

        let directory = self.root.join(LIBRARY_CONFIG_DIR);
        match fs::symlink_metadata(&directory) {
            Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
                return Err(CoreError::PathRejected);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&directory)?;
            }
            Err(error) => return Err(CoreError::Io(error)),
        }
        let canonical_directory = fs::canonicalize(&directory)?;
        if canonical_directory.parent() != Some(self.root.as_path()) {
            return Err(CoreError::PathRejected);
        }
        let path = canonical_directory.join(file_name);
        let document = AuthoringRegistryFile {
            schema_version: AUTHORING_REGISTRY_SCHEMA_VERSION,
            entries: entries.to_vec(),
        };
        let bytes = serde_json::to_vec_pretty(&document).map_err(|_| CoreError::InvalidInput)?;
        // Recheck immediately before the atomic replacement so an edit made
        // while the settings UI is open is surfaced instead of discarded.
        self.read_authoring_entries(file_name, is_math)?;
        write_file_atomic_if_unchanged(&path, &bytes, base_hash)?;
        Ok(sha256(&bytes))
    }

    pub(crate) fn read_authoring_entries(
        &self,
        file_name: &str,
        is_math: bool,
    ) -> Result<(Vec<serde_json::Value>, String), CoreError> {
        let directory = self.root.join(LIBRARY_CONFIG_DIR);
        let metadata = match fs::symlink_metadata(&directory) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok((Vec::new(), sha256(&[])));
            }
            Err(error) => return Err(CoreError::Io(error)),
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(CoreError::PathRejected);
        }
        let canonical_directory = fs::canonicalize(&directory)?;
        if canonical_directory.parent() != Some(self.root.as_path()) {
            return Err(CoreError::PathRejected);
        }
        let path = canonical_directory.join(file_name);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok((Vec::new(), sha256(&[])));
            }
            Err(error) => return Err(CoreError::Io(error)),
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(CoreError::PathRejected);
        }
        let bytes = read_regular_file_limited(&path, AUTHORING_REGISTRY_MAX_BYTES)?;
        let file: AuthoringRegistryFile =
            serde_json::from_slice(&bytes).map_err(|_| CoreError::InvalidInput)?;
        if file.schema_version == 0 {
            return Err(CoreError::InvalidInput);
        }
        validate_authoring_entries(&file.entries, is_math)?;
        Ok((file.entries, sha256(&bytes)))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use std::sync::Arc;

    use crate::consts::{LIBRARY_CONFIG_DIR, LIBRARY_CONFIG_FILE};
    use crate::io::sha256;
    use crate::test_support::library;
    use crate::types::{AuthoringRegistries, CoreError, LibraryConfig};

    #[test]
    fn library_config_is_portable_and_validated() {
        let (temp, library) = library();
        assert_eq!(library.read_config().unwrap(), LibraryConfig::default());
        assert_eq!(LibraryConfig::default().theme, "dark");
        let config = LibraryConfig {
            schema_version: 1,
            theme: "dark".into(),
            hotkeys: BTreeMap::from([("open".into(), "CmdOrCtrl+O".into())]),
        };
        library.write_config(&config).unwrap();
        assert_eq!(library.read_config().unwrap(), config);
        assert!(temp.path().join(".elef/config.json").is_file());
        assert!(matches!(
            library.write_config(&LibraryConfig {
                theme: "javascript:alert(1)".into(),
                ..LibraryConfig::default()
            }),
            Err(CoreError::InvalidInput)
        ));
    }

    #[test]
    fn authoring_registries_are_portable_versioned_and_validated() {
        let (temp, library) = library();
        let initial = library.read_authoring_registries().unwrap();
        assert_eq!(initial, AuthoringRegistries::default());
        let snippets = vec![serde_json::json!({
            "id": "personal-bold",
            "name": "Bold note",
            "description": "",
            "trigger": "bold-note",
            "category": "Markdown",
            "body": "**${1:text}**",
            "built_in": false
        })];
        let math_shortcuts = vec![serde_json::json!({
            "id": 42,
            "name": "Alpha",
            "description": "",
            "prefix": "@",
            "aliases": ["alpha"],
            "expansion": "\\alpha"
        })];
        let snippets_hash = library
            .write_authoring_registry("snippets", &snippets, &initial.hashes.snippets)
            .unwrap();
        let after_snippets = library.read_authoring_registries().unwrap();
        let math_hash = library
            .write_authoring_registry(
                "math_shortcuts",
                &math_shortcuts,
                &after_snippets.hashes.math_shortcuts,
            )
            .unwrap();
        let persisted = library.read_authoring_registries().unwrap();
        assert_eq!(persisted.snippets, snippets);
        assert_eq!(persisted.math_shortcuts, math_shortcuts);
        assert_eq!(persisted.hashes.snippets, snippets_hash);
        assert_eq!(persisted.hashes.math_shortcuts, math_hash);
        assert!(temp.path().join(".elef/snippets.json").is_file());
        assert!(temp.path().join(".elef/math-shortcuts.json").is_file());
        assert!(matches!(
            library.write_authoring_registry("unknown", &[], &sha256(&[])),
            Err(CoreError::InvalidInput)
        ));
        assert!(matches!(
            library.write_authoring_registry(
                "snippets",
                &[serde_json::json!({
                    "id": "fake-default",
                    "name": "Fake default",
                    "description": "Cannot shadow built-ins",
                    "trigger": "x",
                    "category": "Markdown",
                    "body": "x",
                    "built_in": true
                })],
                &persisted.hashes.snippets
            ),
            Err(CoreError::InvalidInput)
        ));
    }

    #[test]
    fn authoring_registry_write_does_not_overwrite_external_changes() {
        let (temp, library) = library();
        let initial = library.read_authoring_registries().unwrap();
        let edited = vec![serde_json::json!({
            "id": "personal-note",
            "name": "Personal note",
            "description": "Local edit",
            "trigger": "note",
            "category": "Markdown",
            "body": "# ${1:Note}",
            "built_in": false
        })];
        let settings_path = temp.path().join(".elef/snippets.json");
        fs::create_dir(temp.path().join(LIBRARY_CONFIG_DIR)).unwrap();
        fs::write(&settings_path, br#"{"schema_version":1,"entries":[]}"#).unwrap();

        assert!(matches!(
            library.write_authoring_registry("snippets", &edited, &initial.hashes.snippets),
            Err(CoreError::AuthoringConflict)
        ));
        assert_eq!(
            fs::read(&settings_path).unwrap(),
            br#"{"schema_version":1,"entries":[]}"#
        );
    }

    #[test]
    fn concurrent_authoring_registry_writes_serialize_and_reject_the_stale_one() {
        let (temp, library) = library();
        let library = Arc::new(library);
        let initial = library.read_authoring_registries().unwrap();
        let start = Arc::new(std::sync::Barrier::new(3));
        let entries = [
            vec![serde_json::json!({
                "id": "personal-first",
                "name": "First",
                "description": "First concurrent edit",
                "trigger": "first",
                "category": "Markdown",
                "body": "First"
            })],
            vec![serde_json::json!({
                "id": "personal-second",
                "name": "Second",
                "description": "Second concurrent edit",
                "trigger": "second",
                "category": "Markdown",
                "body": "Second"
            })],
        ];

        let writers = entries
            .into_iter()
            .map(|entry| {
                let library = Arc::clone(&library);
                let start = Arc::clone(&start);
                let base_hash = initial.hashes.snippets.clone();
                std::thread::spawn(move || {
                    start.wait();
                    library.write_authoring_registry("snippets", &entry, &base_hash)
                })
            })
            .collect::<Vec<_>>();
        start.wait();
        let results = writers
            .into_iter()
            .map(|writer| writer.join().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(CoreError::AuthoringConflict)))
                .count(),
            1
        );
        let persisted = library.read_authoring_registries().unwrap();
        assert_eq!(persisted.snippets.len(), 1);
        assert!(temp.path().join(".elef/snippets.json").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn authoring_registries_reject_symlinked_files() {
        let (temp, library) = library();
        let outside = temp.path().join("outside.json");
        fs::write(&outside, r#"{"schema_version":1,"entries":[]}"#).unwrap();
        fs::create_dir(temp.path().join(LIBRARY_CONFIG_DIR)).unwrap();
        symlink(
            &outside,
            temp.path().join(LIBRARY_CONFIG_DIR).join("snippets.json"),
        )
        .unwrap();
        assert!(matches!(
            library.read_authoring_registries(),
            Err(CoreError::PathRejected)
        ));
        assert!(matches!(
            library.write_authoring_registry("snippets", &[], &sha256(&[])),
            Err(CoreError::PathRejected)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn library_config_rejects_symlinked_config_paths() {
        let (temp, library) = library();
        let outside = temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join(LIBRARY_CONFIG_FILE), b"{}\n").unwrap();
        symlink(&outside, temp.path().join(LIBRARY_CONFIG_DIR)).unwrap();
        assert!(matches!(
            library.read_config(),
            Err(CoreError::PathRejected)
        ));
        assert!(matches!(
            library.write_config(&LibraryConfig::default()),
            Err(CoreError::PathRejected)
        ));

        fs::remove_file(temp.path().join(LIBRARY_CONFIG_DIR)).unwrap();
        let directory = temp.path().join(LIBRARY_CONFIG_DIR);
        fs::create_dir(&directory).unwrap();
        fs::remove_file(outside.join(LIBRARY_CONFIG_FILE)).unwrap();
        symlink(
            outside.join("missing.json"),
            directory.join(LIBRARY_CONFIG_FILE),
        )
        .unwrap();
        assert!(matches!(
            library.read_config(),
            Err(CoreError::PathRejected)
        ));
    }
}
