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
    let export_pptx =
        MenuItem::with_id(app, "export-pptx", "Export PowerPoint…", true, None::<&str>)?;
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
                &export_pptx,
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
                &export_pptx,
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
    let show_library = MenuItem::with_id(app, "show-library", "Show Library", true, None::<&str>)?;
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

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    // Regression test for the Show-Library duplicate menu id: "Show Library"
    // reused "open-work", so the View-menu entry fired the Open Work handler.
    // The test reads this file's own `with_id` call sites, so it cannot drift
    // from the menu under test the way a hand-kept id list would.
    fn menu_ids() -> Vec<String> {
        let mut ids = Vec::new();
        let mut rest = include_str!("menus.rs");
        while let Some(start) = rest.find("with_id(app, \"") {
            rest = &rest[start + "with_id(app, \"".len()..];
            if let Some(end) = rest.find('"') {
                ids.push(rest[..end].to_string());
                rest = &rest[end + 1..];
            } else {
                break;
            }
        }
        ids
    }

    #[test]
    fn menu_item_ids_are_unique() {
        let ids = menu_ids();
        assert!(!ids.is_empty(), "expected menu item ids in menus.rs");
        let mut counts: HashMap<&str, usize> = HashMap::new();
        for id in &ids {
            *counts.entry(id.as_str()).or_default() += 1;
        }
        let duplicates: Vec<(&str, usize)> = counts
            .iter()
            .filter(|(_, count)| **count > 1)
            .map(|(id, count)| (*id, *count))
            .collect();
        assert!(
            duplicates.is_empty(),
            "duplicate menu item ids: {duplicates:?}"
        );
        let unique: HashSet<&str> = ids.iter().map(String::as_str).collect();
        assert_eq!(unique.len(), ids.len(), "menu item ids must be unique");
    }

    #[test]
    fn show_library_has_its_own_id() {
        let ids = menu_ids();
        assert!(
            ids.iter().any(|id| id == "show-library"),
            "Show Library needs its own menu id, not the open-work id"
        );
        assert_eq!(
            ids.iter().filter(|id| *id == "open-work").count(),
            1,
            "open-work must identify exactly one menu item"
        );
    }
}
