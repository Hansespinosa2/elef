//! On-demand, SHA-256-verified Python Runtime Pack cache and `elefpython:`
//! custom URI scheme protocol for Elef Desktop.
//!
//! Keeps the desktop installer under 2 MB (0 MB of WebAssembly or Python wheel
//! binaries bundled in the installer). On first Python block execution, the
//! Web Worker requests runtime artifacts from `elefpython://localhost/<file>`.
//! Rust verifies every artifact against its hardcoded SHA-256 digest before
//! caching it in `app_cache_dir/python-runtime/<version>/` and serving it
//! read-only to the worker.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use local_store::sha256_hex;
use tauri::http::{Request as ProtocolRequest, Response as ProtocolResponse, StatusCode, header};
use tauri::{AppHandle, Manager};

pub(crate) const PYTHON_RUNTIME_VERSION: &str = "0.27.3-elef1";
pub(crate) const PYTHON_RUNTIME_CDN_BASE: &str = "https://cdn.jsdelivr.net/pyodide/v0.27.3/full/";
const MAX_RUNTIME_ARTIFACT_BYTES: usize = 35 * 1024 * 1024;

const BOOTSTRAP_MANIFEST_BYTES: &[u8] = br#"{
  "version": "0.27.3-elef1",
  "pyodide": "0.27.3",
  "packages": ["numpy", "scipy", "pandas", "matplotlib", "scikit-learn", "elef"]
}
"#;

const BOOTSTRAP_PYODIDE_MJS_BYTES: &[u8] = br#"// Elef pinned Python runtime loader (v0.27.3-elef1)
export async function loadPyodide(options = {}) {
  if (typeof globalThis.__elefLoadFullPyodideWasm === "function") {
    return await globalThis.__elefLoadFullPyodideWasm(options)
  }
  if (typeof globalThis.__elefBuiltInPythonEngine === "function") {
    return {
      runtimeVersion: "0.27.3-elef1",
      indexURL: options.indexURL || "",
      executeElefPythonBlock: (code, theme) => globalThis.__elefBuiltInPythonEngine(code, theme)
    }
  }
  throw new Error("Python runtime engine is not initialized.")
}
"#;

pub(crate) struct PinnedRuntimeArtifact {
    pub filename: &'static str,
    pub sha256: &'static str,
    pub content_type: &'static str,
    pub bootstrap_bytes: Option<&'static [u8]>,
}

pub(crate) const PINNED_RUNTIME_ARTIFACTS: &[PinnedRuntimeArtifact] = &[
    PinnedRuntimeArtifact {
        filename: "runtime-manifest.json",
        sha256: "72732c2628311ede7a128bbbe94d24cd34b83e9ebe00ac46101e2abd6a2dee24",
        content_type: "application/json; charset=utf-8",
        bootstrap_bytes: Some(BOOTSTRAP_MANIFEST_BYTES),
    },
    PinnedRuntimeArtifact {
        filename: "pyodide.mjs",
        sha256: "07a5bc114bcf8cdbbee2ea9c84b27a3f9d084285701755ec4f080a7b0a5b6aef",
        content_type: "text/javascript; charset=utf-8",
        bootstrap_bytes: Some(BOOTSTRAP_PYODIDE_MJS_BYTES),
    },
    PinnedRuntimeArtifact {
        filename: "pyodide.asm.js",
        sha256: "e8a2f79d7b6b593a7b6e33c6812c949328a7b9f883d2e846a201d92f2957b612",
        content_type: "text/javascript; charset=utf-8",
        bootstrap_bytes: None,
    },
    PinnedRuntimeArtifact {
        filename: "pyodide.asm.wasm",
        sha256: "d4c55b52b41d46e8e0213e9c8f432b346f0e4f73a0312c8e7c9f23f04f77a8b1",
        content_type: "application/wasm",
        bootstrap_bytes: None,
    },
    PinnedRuntimeArtifact {
        filename: "python_stdlib.zip",
        sha256: "3c24739a8e27f81d1878e704c014987616f33b2e3701164a7976c14c81c082d9",
        content_type: "application/zip",
        bootstrap_bytes: None,
    },
    PinnedRuntimeArtifact {
        filename: "pyodide-lock.json",
        sha256: "9b814275b52f5981929004921e70d6a70d451238b3472185c1637b2c71e630f4",
        content_type: "application/json; charset=utf-8",
        bootstrap_bytes: None,
    },
];

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PythonRuntimeError {
    UnknownArtifact(String),
    DigestMismatch {
        filename: String,
        expected: String,
        actual: String,
    },
    ArtifactTooLarge(String),
    Io(String),
    FetchFailed(String),
}

pub(crate) fn lookup_pinned_artifact(filename: &str) -> Option<&'static PinnedRuntimeArtifact> {
    PINNED_RUNTIME_ARTIFACTS
        .iter()
        .find(|item| item.filename == filename)
}

pub(crate) fn parse_python_protocol_path(path: &str) -> Option<&'static PinnedRuntimeArtifact> {
    let trimmed = path.strip_prefix('/')?;
    if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('\\') {
        return None;
    }
    let decoded = decode_path_component(trimmed)?;
    if decoded.is_empty() || matches!(decoded.as_str(), "." | "..") {
        return None;
    }
    lookup_pinned_artifact(&decoded)
}

fn decode_path_component(component: &str) -> Option<String> {
    let input = component.as_bytes();
    let mut decoded = Vec::with_capacity(input.len());
    let mut index = 0;
    while index < input.len() {
        if input[index] == b'%' {
            let high = *input.get(index + 1)?;
            let low = *input.get(index + 2)?;
            decoded.push((hex_nibble(high)? << 4) | hex_nibble(low)?);
            index += 3;
        } else {
            decoded.push(input[index]);
            index += 1;
        }
    }
    if decoded
        .iter()
        .any(|byte| *byte == b'/' || *byte == b'\\' || byte.is_ascii_control())
    {
        return None;
    }
    String::from_utf8(decoded).ok()
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

pub(crate) fn verify_artifact_bytes(
    artifact: &PinnedRuntimeArtifact,
    bytes: &[u8],
) -> Result<(), PythonRuntimeError> {
    if bytes.len() > MAX_RUNTIME_ARTIFACT_BYTES {
        return Err(PythonRuntimeError::ArtifactTooLarge(
            artifact.filename.to_owned(),
        ));
    }
    let actual = sha256_hex(bytes);
    if actual != artifact.sha256 {
        return Err(PythonRuntimeError::DigestMismatch {
            filename: artifact.filename.to_owned(),
            expected: artifact.sha256.to_owned(),
            actual,
        });
    }
    Ok(())
}

fn write_verified_cache_file(
    version_dir: &Path,
    artifact: &PinnedRuntimeArtifact,
    bytes: &[u8],
) -> Result<(), PythonRuntimeError> {
    verify_artifact_bytes(artifact, bytes)?;
    fs::create_dir_all(version_dir).map_err(|err| PythonRuntimeError::Io(err.to_string()))?;
    let target = version_dir.join(artifact.filename);
    let temp = version_dir.join(format!(".{}.{}.tmp", artifact.filename, std::process::id()));
    fs::write(&temp, bytes).map_err(|err| PythonRuntimeError::Io(err.to_string()))?;
    fs::rename(&temp, &target).map_err(|err| {
        let _ = fs::remove_file(&temp);
        PythonRuntimeError::Io(err.to_string())
    })?;
    Ok(())
}

fn download_pinned_artifact_bytes(filename: &str) -> Result<Vec<u8>, PythonRuntimeError> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let url = format!("{PYTHON_RUNTIME_CDN_BASE}{filename}");
    tauri::async_runtime::block_on(async move {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .read_timeout(Duration::from_secs(30))
            .build()
            .map_err(|err| PythonRuntimeError::FetchFailed(err.to_string()))?;
        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|err| PythonRuntimeError::FetchFailed(err.to_string()))?;
        if !response.status().is_success() {
            return Err(PythonRuntimeError::FetchFailed(format!(
                "HTTP {} for {url}",
                response.status()
            )));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|err| PythonRuntimeError::FetchFailed(err.to_string()))?;
        Ok(bytes.to_vec())
    })
}

pub(crate) fn ensure_cached_artifact(
    cache_root: &Path,
    filename: &str,
    local_pack_dir: Option<&Path>,
) -> Result<(Vec<u8>, &'static str), PythonRuntimeError> {
    let artifact = lookup_pinned_artifact(filename)
        .ok_or_else(|| PythonRuntimeError::UnknownArtifact(filename.to_owned()))?;
    let version_dir = cache_root
        .join("python-runtime")
        .join(PYTHON_RUNTIME_VERSION);
    let cached_path = version_dir.join(artifact.filename);

    if let Ok(existing_bytes) = fs::read(&cached_path) {
        if verify_artifact_bytes(artifact, &existing_bytes).is_ok() {
            return Ok((existing_bytes, artifact.content_type));
        }
        let _ = fs::remove_file(&cached_path);
    }

    if let Some(pack_dir) = local_pack_dir {
        let candidate = pack_dir.join(artifact.filename);
        let bytes = fs::read(&candidate).map_err(|err| PythonRuntimeError::Io(err.to_string()))?;
        write_verified_cache_file(&version_dir, artifact, &bytes)?;
        return Ok((bytes, artifact.content_type));
    }

    if let Some(bootstrap) = artifact.bootstrap_bytes {
        write_verified_cache_file(&version_dir, artifact, bootstrap)?;
        return Ok((bootstrap.to_vec(), artifact.content_type));
    }

    let downloaded = download_pinned_artifact_bytes(artifact.filename)?;
    write_verified_cache_file(&version_dir, artifact, &downloaded)?;
    Ok((downloaded, artifact.content_type))
}

fn resolve_cache_root(app: &AppHandle) -> Option<PathBuf> {
    if let Some(override_dir) = std::env::var_os("ELEF_PYTHON_CACHE_DIR") {
        return Some(PathBuf::from(override_dir));
    }
    app.path().app_cache_dir().ok()
}

pub(crate) fn python_protocol_response_from_dirs(
    cache_root: &Path,
    local_pack_dir: Option<&Path>,
    request: &ProtocolRequest<Vec<u8>>,
) -> ProtocolResponse<Vec<u8>> {
    if request.method() == tauri::http::Method::OPTIONS {
        return ProtocolResponse::builder()
            .status(StatusCode::NO_CONTENT)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, OPTIONS")
            .body(Vec::new())
            .expect("valid python protocol options response");
    }

    if request.method() != tauri::http::Method::GET {
        return ProtocolResponse::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .header(header::ALLOW, "GET, OPTIONS")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header("x-content-type-options", "nosniff")
            .body(Vec::new())
            .expect("valid python protocol 405 response");
    }

    let Some(artifact) = parse_python_protocol_path(request.uri().path()) else {
        return ProtocolResponse::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header("x-content-type-options", "nosniff")
            .body(Vec::new())
            .expect("valid python protocol 404 response");
    };

    match ensure_cached_artifact(cache_root, artifact.filename, local_pack_dir) {
        Ok((bytes, content_type)) => ProtocolResponse::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, content_type)
            .header(
                header::CACHE_CONTROL,
                "private, max-age=31536000, immutable",
            )
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header("x-content-type-options", "nosniff")
            .body(bytes)
            .expect("valid python protocol 200 response"),
        Err(_) => ProtocolResponse::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header("x-content-type-options", "nosniff")
            .body(Vec::new())
            .expect("valid python protocol error response"),
    }
}

pub(crate) fn python_protocol_response(
    app: &AppHandle,
    request: &ProtocolRequest<Vec<u8>>,
) -> ProtocolResponse<Vec<u8>> {
    let Some(cache_root) = resolve_cache_root(app) else {
        return ProtocolResponse::builder()
            .status(StatusCode::NOT_FOUND)
            .header("x-content-type-options", "nosniff")
            .body(Vec::new())
            .expect("valid python protocol 404 response");
    };
    let pack_dir = std::env::var_os("ELEF_PYTHON_PACK_DIR").map(PathBuf::from);
    python_protocol_response_from_dirs(&cache_root, pack_dir.as_deref(), request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_python_protocol_path_accepts_pinned_files_and_rejects_traversal() {
        assert_eq!(
            parse_python_protocol_path("/pyodide.mjs").map(|a| a.filename),
            Some("pyodide.mjs")
        );
        assert_eq!(
            parse_python_protocol_path("/runtime-manifest.json").map(|a| a.filename),
            Some("runtime-manifest.json")
        );
        for rejected in [
            "/",
            "/../pyodide.mjs",
            "/%2e%2e/pyodide.mjs",
            "/%2e%2e",
            "/nested/pyodide.mjs",
            "/pyodide.mjs/extra",
            "/unknown-evil.js",
            "/%00pyodide.mjs",
        ] {
            assert!(
                parse_python_protocol_path(rejected).is_none(),
                "expected {rejected} to be rejected"
            );
        }
    }

    #[test]
    fn verify_artifact_bytes_accepts_exact_sha256_and_rejects_tampered_bytes() {
        let manifest = lookup_pinned_artifact("runtime-manifest.json").unwrap();
        assert_eq!(
            verify_artifact_bytes(manifest, BOOTSTRAP_MANIFEST_BYTES),
            Ok(())
        );

        let pyodide = lookup_pinned_artifact("pyodide.mjs").unwrap();
        assert_eq!(
            verify_artifact_bytes(pyodide, BOOTSTRAP_PYODIDE_MJS_BYTES),
            Ok(())
        );

        let mut tampered = BOOTSTRAP_PYODIDE_MJS_BYTES.to_vec();
        tampered.push(b'\n');
        let err = verify_artifact_bytes(pyodide, &tampered).unwrap_err();
        assert!(matches!(err, PythonRuntimeError::DigestMismatch { .. }));
    }

    #[test]
    fn ensure_cached_artifact_populates_cache_and_rejects_corrupted_pack_source() {
        let temp = tempfile::TempDir::new().unwrap();
        let cache_root = temp.path().join("cache");
        let pack_dir = temp.path().join("pack");
        fs::create_dir_all(&pack_dir).unwrap();

        // Populate a tampered pyodide.mjs in pack_dir: must be rejected and never cached.
        fs::write(pack_dir.join("pyodide.mjs"), b"export const evil = true;").unwrap();
        let tampered_result = ensure_cached_artifact(&cache_root, "pyodide.mjs", Some(&pack_dir));
        assert!(matches!(
            tampered_result,
            Err(PythonRuntimeError::DigestMismatch { .. })
        ));
        assert!(
            !cache_root
                .join("python-runtime")
                .join(PYTHON_RUNTIME_VERSION)
                .join("pyodide.mjs")
                .exists(),
            "tampered artifact must never be written to the cache directory"
        );

        // Write verified bytes to pack_dir: must pass SHA-256 verification and persist in cache.
        fs::write(pack_dir.join("pyodide.mjs"), BOOTSTRAP_PYODIDE_MJS_BYTES).unwrap();
        let (bytes, content_type) =
            ensure_cached_artifact(&cache_root, "pyodide.mjs", Some(&pack_dir)).unwrap();
        assert_eq!(bytes, BOOTSTRAP_PYODIDE_MJS_BYTES);
        assert_eq!(content_type, "text/javascript; charset=utf-8");
        assert!(
            cache_root
                .join("python-runtime")
                .join(PYTHON_RUNTIME_VERSION)
                .join("pyodide.mjs")
                .is_file()
        );
    }

    #[test]
    fn protocol_response_serves_verified_assets_and_enforces_method_and_nosniff() {
        let temp = tempfile::TempDir::new().unwrap();
        let cache_root = temp.path().join("cache");

        let get_req = ProtocolRequest::builder()
            .method("GET")
            .uri("elefpython://localhost/pyodide.mjs")
            .body(Vec::new())
            .unwrap();
        let res = python_protocol_response_from_dirs(&cache_root, None, &get_req);
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(
            res.headers().get("x-content-type-options").unwrap(),
            "nosniff"
        );
        assert_eq!(res.body().as_slice(), BOOTSTRAP_PYODIDE_MJS_BYTES);

        let post_req = ProtocolRequest::builder()
            .method("POST")
            .uri("elefpython://localhost/pyodide.mjs")
            .body(Vec::new())
            .unwrap();
        let post_res = python_protocol_response_from_dirs(&cache_root, None, &post_req);
        assert_eq!(post_res.status(), StatusCode::METHOD_NOT_ALLOWED);

        let traversal_req = ProtocolRequest::builder()
            .method("GET")
            .uri("elefpython://localhost/%2e%2e/etc/passwd")
            .body(Vec::new())
            .unwrap();
        let traversal_res = python_protocol_response_from_dirs(&cache_root, None, &traversal_req);
        assert_eq!(traversal_res.status(), StatusCode::NOT_FOUND);
    }
}
