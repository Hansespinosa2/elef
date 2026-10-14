use std::path::PathBuf;

use base64::Engine as _;
use local_store::{StoredAsset, UploadedAsset};
use tauri::http::{Request as ProtocolRequest, Response as ProtocolResponse, StatusCode, header};
use tauri::ipc::{InvokeBody, Request as IpcRequest};
use tauri::{AppHandle, Manager, State};

use crate::error::CommandError;
use crate::state::DesktopState;

pub(crate) fn asset_protocol_response(
    app: &AppHandle,
    request: &ProtocolRequest<Vec<u8>>,
) -> ProtocolResponse<Vec<u8>> {
    let not_found = || {
        ProtocolResponse::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .expect("static asset response is valid")
    };
    if request.method() != tauri::http::Method::GET {
        return ProtocolResponse::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .header(header::ALLOW, "GET")
            .body(Vec::new())
            .expect("static asset response is valid");
    }
    let Some(asset_path) = parse_asset_protocol_path(request.uri().path()) else {
        return not_found();
    };
    let state = app.state::<DesktopState>();
    let Ok(library) = state.current_library() else {
        return not_found();
    };
    let immutable = matches!(&asset_path.source, AssetProtocolSource::Digest(_));
    let asset_result = match asset_path.source {
        AssetProtocolSource::Digest(digest) => library.read_asset(&asset_path.id, &digest),
        AssetProtocolSource::RelativePath(path) => library.read_asset_path(&asset_path.id, &path),
    };
    let Ok((bytes, content_type)) = asset_result else {
        return not_found();
    };
    ProtocolResponse::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(
            header::CACHE_CONTROL,
            if immutable {
                "private, max-age=31536000, immutable"
            } else {
                "no-cache"
            },
        )
        .header("x-content-type-options", "nosniff")
        .body(bytes)
        .expect("static asset response is valid")
}

#[derive(Debug, PartialEq, Eq)]
struct AssetProtocolPath {
    id: String,
    source: AssetProtocolSource,
}

#[derive(Debug, PartialEq, Eq)]
enum AssetProtocolSource {
    Digest(String),
    RelativePath(PathBuf),
}

fn parse_asset_protocol_path(path: &str) -> Option<AssetProtocolPath> {
    let mut parts = path.strip_prefix('/')?.split('/');
    let id = decode_asset_path_component(parts.next()?)?;
    if id.is_empty() || matches!(id.as_str(), "." | "..") {
        return None;
    }
    let second = parts.next()?;
    if second == "path" {
        let mut relative_path = PathBuf::new();
        let mut count = 0usize;
        for raw_component in parts {
            let component = decode_asset_path_component(raw_component)?;
            if component.is_empty() || matches!(component.as_str(), "." | "..") {
                return None;
            }
            relative_path.push(component);
            count += 1;
        }
        return (count > 1 && relative_path.components().next()?.as_os_str() == "images")
            .then_some(AssetProtocolPath {
                id,
                source: AssetProtocolSource::RelativePath(relative_path),
            });
    }

    if parts.next().is_some()
        || second.len() != 64
        || !second.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    Some(AssetProtocolPath {
        id,
        source: AssetProtocolSource::Digest(second.to_ascii_lowercase()),
    })
}

fn decode_asset_path_component(component: &str) -> Option<String> {
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

#[tauri::command]
pub(crate) fn upload_asset(
    request: IpcRequest<'_>,
    state: State<'_, DesktopState>,
) -> Result<UploadedAsset, CommandError> {
    let header_value = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
    };
    let id = header_value("x-elef-work-id").ok_or_else(|| {
        CommandError::new("invalid_input", "Choose a Work before adding media.", false)
    })?;
    let filename = header_value("x-elef-filename").unwrap_or("image");
    let media_type = header_value("x-elef-declared-media-type").unwrap_or("");
    let fit = header_value("x-elef-fit").unwrap_or("contain");
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(CommandError::new(
            "invalid_input",
            "The media upload did not contain a binary file.",
            false,
        ));
    };
    Ok(state
        .current_library()?
        .upload_asset(id, filename, media_type, bytes, fit)?)
}

#[tauri::command]
pub(crate) fn list_media(
    state: State<'_, DesktopState>,
    id: String,
) -> Result<Vec<StoredAsset>, CommandError> {
    Ok(state.current_library()?.list_assets(&id)?)
}

#[tauri::command]
pub(crate) fn remove_media(
    state: State<'_, DesktopState>,
    id: String,
    digest: String,
) -> Result<bool, CommandError> {
    Ok(state.current_library()?.remove_asset(&id, &digest)?)
}

// Reads one content-addressed asset as a data URI for PPTX export. The
// shared engine embeds media at prepareMedia time, but the webview cannot
// fetch elefasset:// bytes itself: the desktop CSP restricts connect-src to
// IPC. The desktop prepareMedia seam resolves local media through this
// command instead of webview fetch, reusing the protocol's verified read
// path (digest-verified, symlink-rejecting). A missing asset reports the
// same message the server raises for an unresolvable Elef reference.
#[tauri::command]
pub(crate) fn read_pptx_asset(
    state: State<'_, DesktopState>,
    id: String,
    digest: String,
) -> Result<String, CommandError> {
    read_pptx_asset_inner(&state, &id, &digest)
}

fn read_pptx_asset_inner(
    state: &DesktopState,
    id: &str,
    digest: &str,
) -> Result<String, CommandError> {
    let (bytes, content_type) =
        state
            .current_library()?
            .read_asset(id, digest)
            .map_err(|error| match error {
                local_store::CoreError::NotFound => CommandError::new(
                    "invalid_input",
                    "A referenced Elef image or video is unavailable for PPTX export.",
                    false,
                ),
                other => CommandError::from(other),
            })?;
    Ok(format!(
        "data:{content_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pptx_asset_reads_return_verified_bytes_as_data_uris() {
        let temp = tempfile::TempDir::new().unwrap();
        let root = temp.path().join("library");
        std::fs::create_dir(&root).unwrap();
        let state = DesktopState::default();
        state.use_library(root).unwrap();
        let library = state.current_library().unwrap();
        let work = library
            .create_work_folder("Export", "presentation")
            .unwrap();
        let png = b"\x89PNG\r\n\x1a\npptx export bytes";
        let uploaded = library
            .upload_asset(&work.id, "photo.png", "image/png", png, "contain")
            .unwrap();

        let data_uri = read_pptx_asset_inner(&state, &work.id, &uploaded.digest).unwrap();
        let encoded = data_uri
            .strip_prefix("data:image/png;base64,")
            .expect("pptx asset reads return typed data URIs");
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .unwrap()
                .as_slice(),
            &png[..]
        );

        let missing = "b".repeat(64);
        let error = read_pptx_asset_inner(&state, &work.id, &missing).unwrap_err();
        assert_eq!(error.code, "invalid_input");
        let value = serde_json::to_value(error).unwrap();
        assert_eq!(
            value["message"],
            "A referenced Elef image or video is unavailable for PPTX export."
        );
    }

    #[test]
    fn asset_protocol_accepts_digest_and_scoped_relative_asset_paths() {
        let digest = "a".repeat(64);
        assert_eq!(
            parse_asset_protocol_path(&format!("/work-id/{digest}")),
            Some(AssetProtocolPath {
                id: "work-id".into(),
                source: AssetProtocolSource::Digest(digest.clone())
            })
        );
        assert_eq!(
            parse_asset_protocol_path(&format!("/work-id/{digest}/extra")),
            None
        );
        assert_eq!(parse_asset_protocol_path("/work-id/%2e%2e"), None);
        assert_eq!(parse_asset_protocol_path("//digest"), None);
        assert_eq!(
            parse_asset_protocol_path("/work-id/path/images/%2e%2e/file.png"),
            None
        );
        assert_eq!(
            parse_asset_protocol_path("/work-id/path/images/%2Fetc/passwd"),
            None
        );
        assert_eq!(
            parse_asset_protocol_path("/path%3Aabc/path/images/nested/diagram%20one.png"),
            Some(AssetProtocolPath {
                id: "path:abc".into(),
                source: AssetProtocolSource::RelativePath(PathBuf::from(
                    "images/nested/diagram one.png"
                ))
            })
        );
    }
}
