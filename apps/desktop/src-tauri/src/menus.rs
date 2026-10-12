use tauri::AppHandle;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

pub(crate) fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = MenuItem::with_id(app, "about", "About Elef", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
    let application_menu_separator = PredefinedMenuItem::separator(app)?;
    let application_menu_quit_separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Elef", true, Some("CmdOrCtrl+Q"))?;
    let application_menu = Submenu::with_items(
        app,
        "Elef",
        true,
        &[
            &about,
            &application_menu_separator,
            &settings,
            &application_menu_quit_separator,
            &quit,
        ],
    )?;

    let open_work = MenuItem::with_id(app, "open-work", "Open Work…", true, Some("CmdOrCtrl+O"))?;
    let open_library =
        MenuItem::with_id(app, "choose-library", "Choose Library…", true, None::<&str>)?;
    let new_presentation = MenuItem::with_id(
        app,
        "new-presentation",
        "New Presentation",
        true,
        Some("CmdOrCtrl+N"),
    )?;
    let new_document = MenuItem::with_id(app, "new-document", "New Document", true, None::<&str>)?;
    let save = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
    let export = MenuItem::with_id(app, "export-elef", "Export Work…", true, None::<&str>)?;
    let import = MenuItem::with_id(app, "import-elef", "Import .elef…", true, None::<&str>)?;
    let print = MenuItem::with_id(app, "print", "Print…", true, Some("CmdOrCtrl+P"))?;
    let file_separator = PredefinedMenuItem::separator(app)?;
    let file = if cfg!(target_os = "macos") {
        Submenu::with_items(
            app,
            "File",
            true,
            &[
                &open_work,
                &open_library,
                &new_presentation,
                &new_document,
                &save,
                &export,
                &import,
                &print,
            ],
        )?
    } else {
        Submenu::with_items(
            app,
            "File",
            true,
            &[
                &open_work,
                &open_library,
                &new_presentation,
                &new_document,
                &save,
                &export,
                &import,
                &print,
                &file_separator,
                &quit,
            ],
        )?
    };

    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let edit_separator = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &undo,
            &redo,
            &edit_separator,
            &cut,
            &copy,
            &paste,
            &select_all,
        ],
    )?;

    let fullscreen = PredefinedMenuItem::fullscreen(app, None)?;
    let show_library = MenuItem::with_id(app, "open-work", "Show Library", true, None::<&str>)?;
    let refresh_library = MenuItem::with_id(
        app,
        "refresh-library",
        "Refresh Library",
        true,
        None::<&str>,
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[&fullscreen, &show_library, &refresh_library],
    )?;
    let present = MenuItem::with_id(
        app,
        "start-presentation",
        "Start Presentation",
        true,
        None::<&str>,
    )?;
    let presentation = Submenu::with_items(app, "Presentation", true, &[&present])?;
    let minimize = PredefinedMenuItem::minimize(app, None)?;
    let close = PredefinedMenuItem::close_window(app, None)?;
    let window = Submenu::with_items(app, "Window", true, &[&minimize, &close])?;
    // The update check lives only on Stable macOS: repository Dev and Linux
    // builds have no updater affordance (Linux upgrades through its package
    // manager), so a visible menu entry there would be a dead control.
    #[cfg(all(target_os = "macos", not(feature = "desktop-dev")))]
    let check_updates = MenuItem::with_id(
        app,
        "check-for-updates",
        "Check for Updates…",
        true,
        None::<&str>,
    )?;
    let export_diagnostics = MenuItem::with_id(
        app,
        "export-diagnostics",
        "Export Diagnostics…",
        true,
        None::<&str>,
    )?;
    let help_separator = PredefinedMenuItem::separator(app)?;
    #[cfg(all(target_os = "macos", not(feature = "desktop-dev")))]
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[&check_updates, &help_separator, &export_diagnostics],
    )?;
    #[cfg(not(all(target_os = "macos", not(feature = "desktop-dev"))))]
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[&about, &settings, &help_separator, &export_diagnostics],
    )?;

    let menu = if cfg!(target_os = "macos") {
        Menu::with_items(
            app,
            &[
                &application_menu,
                &file,
                &edit,
                &view,
                &presentation,
                &window,
                &help,
            ],
        )?
    } else {
        Menu::with_items(app, &[&file, &edit, &view, &presentation, &window, &help])?
    };
    Ok(menu)
}
