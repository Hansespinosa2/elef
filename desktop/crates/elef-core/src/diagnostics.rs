//! Local, allowlisted desktop diagnostics.
//!
//! Event records intentionally contain no user supplied strings. Callers pass
//! only a finite event code, result, and an existing command error code, which
//! is reduced to a finite error category before it reaches disk.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Cursor, Read, Write};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tempfile::Builder as TempFileBuilder;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

const ACTIVE_LOG: &str = "events.jsonl";
const MAX_LOG_BYTES: u64 = 512 * 1024;
const MAX_LOG_FILES: usize = 3;
const MAX_EXPORT_LOG_BYTES: u64 = MAX_LOG_BYTES * MAX_LOG_FILES as u64;
const EXPORT_README: &str = "Elef Desktop local diagnostics\n\nThis archive contains allowlisted event codes and sanitized error categories. It does not contain deck text, titles, filenames, library paths, tokens, secrets, raw IPC values, or arbitrary exception messages.\n\nOn disk, logs are stored in the Elef application data directory under logs/.\n";

static WRITER_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventCode {
    Startup,
    Open,
    Save,
    Render,
    Export,
    Import,
    UpdateCheck,
    UpdateStage,
    UpdateActivation,
    DiagnosticsExport,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventResult {
    Success,
    Failure,
    Deferred,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCategory {
    Conflict,
    Integrity,
    Io,
    Internal,
    Unavailable,
    Validation,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventProfile {
    Stable,
    Dev,
}

/// The complete event schema. Unknown JSON keys are rejected during export so
/// hand-edited, corrupted, or pre-redaction records cannot leak free text.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DiagnosticEvent {
    pub timestamp_unix_ms: u128,
    pub version: String,
    pub build_sha: String,
    pub profile: EventProfile,
    pub platform: String,
    pub architecture: String,
    pub event_code: EventCode,
    pub result: EventResult,
    pub error_category: Option<ErrorCategory>,
}

impl DiagnosticEvent {
    /// Build an event from allowlisted values. `error_code` may be an arbitrary
    /// exception or command code; its contents are never copied to the event.
    pub fn new(
        event_code: EventCode,
        result: EventResult,
        error_code: Option<&str>,
        profile: EventProfile,
    ) -> Self {
        let timestamp_unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let build_sha = option_env!("ELEF_BUILD_SHA").unwrap_or("unknown");
        let build_sha = if is_hex_string(build_sha, 40) {
            build_sha.to_ascii_lowercase()
        } else {
            "unknown".to_owned()
        };
        Self {
            timestamp_unix_ms,
            version: env!("CARGO_PKG_VERSION").to_owned(),
            build_sha,
            profile,
            platform: std::env::consts::OS.to_owned(),
            architecture: std::env::consts::ARCH.to_owned(),
            event_code,
            result,
            error_category: error_code.map(sanitize_error_category),
        }
    }

    fn is_valid(&self) -> bool {
        self.timestamp_unix_ms > 0
            && is_semver(&self.version)
            && (self.build_sha == "unknown" || is_hex_string(&self.build_sha, 40))
            && matches!(self.platform.as_str(), "macos" | "linux" | "windows")
            && matches!(
                self.architecture.as_str(),
                "aarch64" | "x86_64" | "x86" | "arm" | "arm64"
            )
            && match self.result {
                EventResult::Success => self.error_category.is_none(),
                EventResult::Failure => self.error_category.is_some(),
                EventResult::Deferred => true,
            }
    }
}

/// Reduce a free-form failure code to a fixed category. The input itself is
/// deliberately not retained, including for the `Unknown` category.
pub fn sanitize_error_category(error_code: &str) -> ErrorCategory {
    match error_code {
        "conflict" | "import_conflict" => ErrorCategory::Conflict,
        "integrity" | "signature_invalid" | "checksum_invalid" => ErrorCategory::Integrity,
        "io_error" => ErrorCategory::Io,
        "internal" => ErrorCategory::Internal,
        "not_found" | "unsupported" => ErrorCategory::Unavailable,
        "invalid_input" | "path_rejected" => ErrorCategory::Validation,
        _ => ErrorCategory::Unknown,
    }
}

/// Append one bounded JSONL event. The caller supplies the private app-data
/// `logs` directory; source and library paths are never derived from a deck.
pub fn append_event(log_dir: &Path, event: &DiagnosticEvent) -> io::Result<()> {
    if !event.is_valid() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "diagnostic event does not match the allowlisted schema",
        ));
    }
    let lock = WRITER_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| io::Error::other("diagnostic writer lock is unavailable"))?;

    fs::create_dir_all(log_dir)?;
    set_private_directory_permissions(log_dir)?;
    let active_path = log_dir.join(ACTIVE_LOG);
    let mut line = serde_json::to_vec(event)
        .map_err(|_| io::Error::other("diagnostic event could not be serialized"))?;
    line.push(b'\n');
    if fs::metadata(&active_path)
        .map(|metadata| metadata.len().saturating_add(line.len() as u64) > MAX_LOG_BYTES)
        .unwrap_or(false)
    {
        rotate_logs(log_dir)?;
    }

    let mut options = OpenOptions::new();
    options.create(true).append(true);
    set_private_file_mode(&mut options);
    let mut file = options.open(active_path)?;
    file.write_all(&line)?;
    file.sync_data()
}

/// Export only valid, schema-conforming records into a ZIP. Invalid or
/// tampered lines are discarded instead of being copied into the archive.
pub fn export_diagnostics(log_dir: &Path, destination: &Path) -> io::Result<()> {
    let sanitized = read_sanitized_logs(log_dir)?;
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut archive = ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .last_modified_time(DateTime::default());
        archive
            .start_file("README.txt", options)
            .map_err(map_zip_error)?;
        archive.write_all(EXPORT_README.as_bytes())?;
        for (filename, bytes) in sanitized {
            archive
                .start_file(format!("logs/{filename}"), options)
                .map_err(map_zip_error)?;
            archive.write_all(&bytes)?;
        }
        archive.finish().map_err(map_zip_error)?;
    }

    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut temporary = TempFileBuilder::new()
        .prefix(".elef-diagnostics-")
        .tempfile_in(parent)?;
    temporary.write_all(cursor.get_ref())?;
    temporary.as_file().sync_all()?;
    temporary
        .persist(destination)
        .map_err(|error| error.error)?;
    File::open(parent)?.sync_all()?;
    Ok(())
}

fn read_sanitized_logs(log_dir: &Path) -> io::Result<Vec<(String, Vec<u8>)>> {
    let mut logs = Vec::new();
    let mut total_bytes = 0_u64;
    for index in (0..MAX_LOG_FILES).rev() {
        let filename = log_filename(index);
        let path = log_dir.join(&filename);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_file() => metadata,
            Ok(_) => continue,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        if metadata.len() > MAX_LOG_BYTES {
            continue;
        }
        total_bytes = total_bytes.saturating_add(metadata.len());
        if total_bytes > MAX_EXPORT_LOG_BYTES {
            continue;
        }

        let mut input = String::new();
        File::open(&path)?.read_to_string(&mut input)?;
        let mut output = Vec::new();
        for line in input.lines() {
            let Ok(event) = serde_json::from_str::<DiagnosticEvent>(line) else {
                continue;
            };
            if !event.is_valid() {
                continue;
            }
            serde_json::to_writer(&mut output, &event)
                .map_err(|_| io::Error::other("diagnostic event could not be sanitized"))?;
            output.push(b'\n');
        }
        logs.push((filename, output));
    }
    Ok(logs)
}

fn rotate_logs(log_dir: &Path) -> io::Result<()> {
    let oldest = log_dir.join(log_filename(MAX_LOG_FILES - 1));
    remove_if_exists(&oldest)?;
    for index in (1..MAX_LOG_FILES - 1).rev() {
        let from = log_dir.join(log_filename(index));
        if from.exists() {
            fs::rename(from, log_dir.join(log_filename(index + 1)))?;
        }
    }
    let active = log_dir.join(ACTIVE_LOG);
    if active.exists() {
        fs::rename(active, log_dir.join(log_filename(1)))?;
    }
    Ok(())
}

fn remove_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn log_filename(index: usize) -> String {
    if index == 0 {
        ACTIVE_LOG.to_owned()
    } else {
        format!("events.{index}.jsonl")
    }
}

fn map_zip_error(error: zip::result::ZipError) -> io::Error {
    match error {
        zip::result::ZipError::Io(error) => error,
        _ => io::Error::other("diagnostics archive could not be created"),
    }
}

fn is_semver(value: &str) -> bool {
    let mut parts = value.split('.');
    let Some(major) = parts.next() else {
        return false;
    };
    let Some(minor) = parts.next() else {
        return false;
    };
    let Some(patch) = parts.next() else {
        return false;
    };
    parts.next().is_none()
        && [major, minor, patch].iter().all(|part| {
            !part.is_empty()
                && part.bytes().all(|byte| byte.is_ascii_digit())
                && (part == &"0" || !part.starts_with('0'))
        })
}

fn is_hex_string(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(unix)]
fn set_private_directory_permissions(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn set_private_directory_permissions(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file_mode(options: &mut OpenOptions) {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
}

#[cfg(not(unix))]
fn set_private_file_mode(_options: &mut OpenOptions) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use tempfile::tempdir;
    use zip::ZipArchive;

    const PRIVACY_SENTINELS: &str =
        include_str!("../../../../test/fixtures/desktop/release/redaction-sentinels.json");

    fn sentinel_values() -> Vec<String> {
        serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(PRIVACY_SENTINELS)
            .unwrap()
            .into_values()
            .map(|value| value.as_str().unwrap().to_owned())
            .collect()
    }

    #[test]
    fn event_writer_redacts_untrusted_error_text_and_export_contains_actionable_fields() {
        let directory = tempdir().unwrap();
        let log_dir = directory.path().join("logs");
        let destination = directory.path().join("diagnostics.zip");
        for sentinel in sentinel_values() {
            let event = DiagnosticEvent::new(
                EventCode::Save,
                EventResult::Failure,
                Some(&sentinel),
                EventProfile::Stable,
            );
            append_event(&log_dir, &event).unwrap();
        }
        export_diagnostics(&log_dir, &destination).unwrap();

        let mut zip = ZipArchive::new(File::open(destination).unwrap()).unwrap();
        let mut event_bytes = String::new();
        zip.by_name("logs/events.jsonl")
            .unwrap()
            .read_to_string(&mut event_bytes)
            .unwrap();
        let records = event_bytes.lines().collect::<Vec<_>>();
        assert_eq!(records.len(), 8);
        for sentinel in sentinel_values() {
            assert!(!event_bytes.contains(&sentinel));
        }
        for record in records {
            let serialized: DiagnosticEvent = serde_json::from_str(record).unwrap();
            assert_eq!(serialized.event_code, EventCode::Save);
            assert_eq!(serialized.result, EventResult::Failure);
            assert_eq!(serialized.error_category, Some(ErrorCategory::Unknown));
            assert!(serialized.timestamp_unix_ms > 0);
            assert_eq!(serialized.version, env!("CARGO_PKG_VERSION"));
        }
        assert!(zip.by_name("README.txt").is_ok());
    }

    #[test]
    fn exporter_discards_tampered_fields_and_hostile_failure_payloads() {
        let directory = tempdir().unwrap();
        let log_dir = directory.path().join("logs");
        fs::create_dir_all(&log_dir).unwrap();
        let valid = DiagnosticEvent::new(
            EventCode::Open,
            EventResult::Success,
            None,
            EventProfile::Stable,
        );
        let valid_line = serde_json::to_string(&valid).unwrap();
        let sentinels: serde_json::Value = serde_json::from_str(PRIVACY_SENTINELS).unwrap();
        let hostile_extra = serde_json::json!({
            "timestamp_unix_ms": 1,
            "version": "0.1.0",
            "build_sha": "unknown",
            "profile": "stable",
            "platform": "linux",
            "architecture": "x86_64",
            "event_code": "save",
            "result": "failure",
            "error_category": "unknown",
            "source": sentinels["source"],
            "title": sentinels["title"],
            "filename": sentinels["filename"],
            "path": sentinels["path"],
            "token": sentinels["token"],
            "secret": sentinels["secret"],
            "exception": sentinels["exception"],
            "ipc_payload": sentinels["ipc_payload"]
        })
        .to_string();
        let hostile_field = serde_json::json!({
            "timestamp_unix_ms": 1,
            "version": sentinels["title"],
            "build_sha": "unknown",
            "profile": "stable",
            "platform": "linux",
            "architecture": "x86_64",
            "event_code": "save",
            "result": "failure",
            "error_category": "unknown"
        })
        .to_string();
        fs::write(
            log_dir.join(ACTIVE_LOG),
            format!("{valid_line}\n{hostile_extra}\n{hostile_field}\n"),
        )
        .unwrap();
        let destination = directory.path().join("diagnostics.zip");

        export_diagnostics(&log_dir, &destination).unwrap();

        let mut zip = ZipArchive::new(File::open(destination).unwrap()).unwrap();
        let mut event_bytes = String::new();
        zip.by_name("logs/events.jsonl")
            .unwrap()
            .read_to_string(&mut event_bytes)
            .unwrap();
        assert_eq!(event_bytes.lines().count(), 1);
        for sentinel in sentinel_values() {
            assert!(!event_bytes.contains(&sentinel));
        }
    }

    #[test]
    fn rotation_keeps_only_three_bounded_files() {
        let directory = tempdir().unwrap();
        let log_dir = directory.path().join("logs");
        fs::create_dir_all(&log_dir).unwrap();
        let event = DiagnosticEvent::new(
            EventCode::Startup,
            EventResult::Success,
            None,
            EventProfile::Stable,
        );

        for _ in 0..5 {
            fs::write(
                log_dir.join(ACTIVE_LOG),
                vec![b' '; MAX_LOG_BYTES as usize - 1],
            )
            .unwrap();
            append_event(&log_dir, &event).unwrap();
        }

        for index in 0..MAX_LOG_FILES {
            let path = log_dir.join(log_filename(index));
            if path.exists() {
                assert!(fs::metadata(path).unwrap().len() <= MAX_LOG_BYTES);
            }
        }
        assert!(!log_dir.join(log_filename(MAX_LOG_FILES)).exists());
    }

    #[test]
    fn error_category_is_finite_even_for_hostile_values() {
        assert_eq!(sanitize_error_category("io_error"), ErrorCategory::Io);
        for sentinel in sentinel_values() {
            assert_eq!(sanitize_error_category(&sentinel), ErrorCategory::Unknown);
        }
    }
}
