use tauri::Manager;

use crate::diagnostics::record_bool_command_result;
use crate::error::CommandError;
use local_store::diagnostics::EventCode;

// Opens the platform print dialog for the main webview contents, which is
// the desktop PDF path: the dialog's PDF destination (Save as PDF on macOS,
// Print to File on Linux, Microsoft Print to PDF on Windows) produces the
// bytes. JavaScript window.print() never reaches this pipeline from the
// Tauri shell (WKWebView and WebKitGTK expose no script-initiated print
// bridge; only WebView2 honors it), so desktop Print / Save PDF routes
// through this command instead. The shared print DOM and print CSS stay the
// payload: both work kinds print the preview already marked up for
// printing-work, exactly as the web print views do.
#[tauri::command]
pub(crate) async fn print_work(window: tauri::WebviewWindow) -> Result<bool, CommandError> {
    let result = print_work_inner(&window);
    record_bool_command_result(window.app_handle(), EventCode::Export, &result);
    result
}

fn print_work_inner(window: &tauri::WebviewWindow) -> Result<bool, CommandError> {
    if window.label() != "main" {
        return Err(CommandError::new(
            "unsupported",
            "Printing is available from the main window.",
            false,
        ));
    }
    open_platform_print_dialog(window)
}

#[cfg(feature = "webdriver")]
fn open_platform_print_dialog(_window: &tauri::WebviewWindow) -> Result<bool, CommandError> {
    // The WebDriver harness cannot dismiss the platform print dialog, so the
    // command resolves without opening one (mirroring the PPTX harness path,
    // which redirects bytes instead of opening the save dialog). Production
    // builds always open the dialog below.
    Ok(true)
}

#[cfg(not(feature = "webdriver"))]
fn open_platform_print_dialog(window: &tauri::WebviewWindow) -> Result<bool, CommandError> {
    window.print().map_err(|_| {
        CommandError::new(
            "print_failed",
            "The print dialog could not be opened.",
            true,
        )
    })?;
    Ok(true)
}
