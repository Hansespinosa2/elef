use std::fs::{self, File};
use std::path::{Path, PathBuf};

use local_store::CoreError;
use local_store::diagnostics::EventCode;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::diagnostics::record_bool_command_result;
use crate::error::CommandError;

// Saves engine-produced presentation bytes through the native save dialog.
// The shared client engine builds the PPTX in the webview; this command only
// delivers bytes to a user-chosen path, mirroring the archive export flow
// (native dialog, .pptx extension gate, atomic temp write). Byte production
// stays in shared code: no Work interpretation happens here.
async fn save_pptx_bytes_impl(
    app: AppHandle,
    filename: String,
    bytes: Vec<u8>,
    use_native_dialog: bool,
) -> Result<bool, CommandError> {
    let result = save_pptx_bytes_inner(&app, filename, &bytes, use_native_dialog).await;
    record_bool_command_result(&app, EventCode::Export, &result);
    result
}

async fn save_pptx_bytes_inner(
    app: &AppHandle,
    filename: String,
    bytes: &[u8],
    use_native_dialog: bool,
) -> Result<bool, CommandError> {
    if bytes.is_empty() {
        return Err(CommandError::new(
            "invalid_input",
            "The presentation produced no PowerPoint bytes.",
            false,
        ));
    }
    let suggested = suggested_pptx_filename(&filename);
    #[cfg(feature = "webdriver")]
    if !use_native_dialog && let Some(destination) = std::env::var_os("ELEF_E2E_PPTX_EXPORT_PATH") {
        save_pptx_bytes_to_path(bytes, PathBuf::from(destination))?;
        return Ok(true);
    }
    #[cfg(not(feature = "webdriver"))]
    let _ = use_native_dialog;
    let Some(selection) = app
        .dialog()
        .file()
        .set_title("Export PowerPoint")
        .set_file_name(suggested)
        .add_filter("PowerPoint", &["pptx"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let destination = selection
        .into_path()
        .map_err(|_| CommandError::new("invalid_input", "Choose a local file.", false))?;
    save_pptx_bytes_to_path(bytes, destination)?;
    Ok(true)
}

#[cfg(feature = "webdriver")]
#[tauri::command]
pub(crate) async fn save_pptx_bytes(
    app: AppHandle,
    filename: String,
    bytes: Vec<u8>,
    use_native_dialog: Option<bool>,
) -> Result<bool, CommandError> {
    save_pptx_bytes_impl(app, filename, bytes, use_native_dialog.unwrap_or(false)).await
}

#[cfg(not(feature = "webdriver"))]
#[tauri::command]
pub(crate) async fn save_pptx_bytes(
    app: AppHandle,
    filename: String,
    bytes: Vec<u8>,
) -> Result<bool, CommandError> {
    save_pptx_bytes_impl(app, filename, bytes, false).await
}

// The suggested dialog name is a bare file name: strip any directories the
// caller sent and keep the transfer extension.
fn suggested_pptx_filename(filename: &str) -> String {
    let base = Path::new(filename)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("presentation.pptx");
    if base.to_lowercase().ends_with(".pptx") {
        base.to_owned()
    } else {
        format!("{base}.pptx")
    }
}

fn save_pptx_bytes_to_path(bytes: &[u8], mut destination: PathBuf) -> Result<(), CommandError> {
    match destination.extension().and_then(|value| value.to_str()) {
        None => {
            destination.set_extension("pptx");
        }
        Some(extension) if extension.eq_ignore_ascii_case("pptx") => {}
        Some(_) => {
            return Err(CommandError::new(
                "invalid_input",
                "The exported presentation must use the .pptx extension.",
                false,
            ));
        }
    }
    let parent = destination.parent().ok_or_else(|| {
        CommandError::new("path_rejected", "Choose a valid export folder.", false)
    })?;
    let parent = fs::canonicalize(parent)
        .map_err(|_| CommandError::new("path_rejected", "Choose a valid export folder.", false))?;
    let file_name = destination.file_name().ok_or_else(|| {
        CommandError::new("path_rejected", "Choose a valid export file name.", false)
    })?;
    let destination = parent.join(file_name);
    if let Ok(metadata) = fs::symlink_metadata(&destination)
        && (metadata.file_type().is_symlink() || !metadata.is_file())
    {
        return Err(CommandError::new(
            "path_rejected",
            "The selected export destination is not a regular file.",
            false,
        ));
    }
    let mut temporary = tempfile::Builder::new()
        .prefix(".elef-pptx-export-")
        .suffix(".tmp")
        .tempfile_in(&parent)
        .map_err(CoreError::Io)?;
    std::io::Write::write_all(&mut temporary, bytes).map_err(CoreError::Io)?;
    temporary.as_file().sync_all().map_err(CoreError::Io)?;
    temporary
        .persist(&destination)
        .map_err(|error| CoreError::Io(error.error))?;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(CoreError::Io)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggested_names_stay_bare_pptx_files() {
        assert_eq!(suggested_pptx_filename("Talk.pptx"), "Talk.pptx");
        assert_eq!(suggested_pptx_filename("Talk"), "Talk.pptx");
        assert_eq!(suggested_pptx_filename("../shared/Talk.PPTX"), "Talk.PPTX");
        assert_eq!(suggested_pptx_filename(""), "presentation.pptx");
        assert_eq!(suggested_pptx_filename("  "), "presentation.pptx");
    }

    #[test]
    fn pptx_bytes_write_atomically_and_reject_foreign_extensions() {
        let temp = tempfile::TempDir::new().unwrap();
        let destination = temp.path().join("Talk.pptx");
        save_pptx_bytes_to_path(b"pptx-bytes", destination.clone()).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"pptx-bytes");

        let extensionless = temp.path().join("Deck");
        save_pptx_bytes_to_path(b"pptx-bytes", extensionless).unwrap();
        assert_eq!(
            fs::read(temp.path().join("Deck.pptx")).unwrap(),
            b"pptx-bytes"
        );

        let error =
            save_pptx_bytes_to_path(b"pptx-bytes", temp.path().join("Talk.zip")).unwrap_err();
        assert_eq!(error.code, "invalid_input");
    }
}
