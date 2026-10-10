# Install and use Elef Desktop

Elef Desktop v0.x is labeled **Personal testing** and is intended for personal evaluation on Apple Silicon macOS and Arch-compatible x86-64 Linux. Decks remain ordinary folders on disk; the desktop app does not need a server or a database. Use only the supported assets listed on the [GitHub Releases page](https://github.com/Hansespinosa2/elef/releases).

A repository build or configured workflow is not a published release. Proceed only when the GitHub Release is public, its platform is marked validated, and it is not marked **BLOCKED**.

## Install on macOS (Apple silicon)

1. Download the Apple Silicon .dmg from an Elef GitHub Release and open it.
2. Drag Elef.app to Applications.
3. Open Elef from Applications.

The v0.x app uses ad-hoc signing and is not signed with an Apple Developer ID or notarized. Gatekeeper may block the first launch. Only continue if the DMG came from the Elef GitHub Release and its release status is not marked **BLOCKED**. After trying to open it, go to **System Settings → Privacy & Security**, scroll to Security, choose **Open Anyway** for Elef, and confirm the next prompt. This adds an exception for Elef; it does not turn off Gatekeeper. Repeat the approval if macOS requests it after an upgrade. If macOS reports malware or a damaged app, stop and report the release issue. [Apple's instructions for opening apps safely](https://support.apple.com/en-sg/102445) describe this per-app exception.

## Install on Linux (Omarchy / Arch)

When a release lists Linux as validated and the AUR package page contains the matching version, install the native package named in the release notes (normally **elef-bin**; it may be **elef-desktop-bin** if the first name is owned by another maintainer). Do not install an AppImage; it is not a supported v0.x artifact.

To build and install the current AUR recipe manually, set `AUR_PACKAGE` to the name in the release notes:

~~~sh
AUR_PACKAGE=elef-bin # use elef-desktop-bin if that is the name in release notes
git clone "https://aur.archlinux.org/${AUR_PACKAGE}.git"
cd "$AUR_PACKAGE"
makepkg -si
~~~

On Omarchy, package installation and upgrades belong to the system package manager; use omarchy update for routine system updates. Elef has no Linux in-app installer or self-updater. Keep the release's native archive and checksum with your package evidence.

## Choose a library and edit

On first launch, choose a library folder or create one, for example ~/Elef. Stable preserves the existing com.elef.desktop app identity and selected library. Repository Dev uses separate app state and does not ship as an installer. Each deck is a folder inside the library with a Markdown source file and any local assets; Stable and Dev can exchange complete work folders by copying them.

Open a deck from the library and edit its Markdown source. Stable includes the source editor, live preview, presentation mode, themes and typography, Mermaid and SmartArt, snippets, local media, print/PDF, and .elef import/export. The visual editor, document graph, revisions/lineage, and [[...]] linking are desktop Stable exclusions; they remain available in Rails web and repository Dev. Unsupported literal source is preserved on compatible save/export.

If another editor or sync tool changes the open source file, Elef checks for that change before saving. Use the conflict dialog to keep your edits, load the disk version, or merge. A conflict or failed save keeps the window open until the source is safe. Close prompts and update activation defer when edits cannot be safely saved.

## Move a deck between devices

Choose **File → Export Deck…** and save the .elef archive. Move that file by USB, AirDrop, or a file-sync tool, then choose **File → Import .elef…** on the other device. The archive contains the deck files and images. If an imported deck has the same identity as one already in the library, choose **Replace**, **Keep both**, or **Cancel**; Replace moves the existing deck to the system Trash.

## Updates and offline use

macOS Stable checks the controlled safe-version feed and stages a verified eligible update in the background. It applies the update only after a normal quit when saving succeeds, then relaunches. If eligibility cannot be checked, the staged update is deferred and editing remains available. A blocked release is not offered by the feed. Linux updates are handled by the package manager.

Deck editing, rendering, local media, library search, presentation, and export work offline without Rails or a database. Update checks need a network connection and fail without blocking the app. Elef does not synchronize libraries between devices; move a complete deck folder or .elef archive yourself.

## Roll back a release

Keep older versioned DMGs and Arch package history. On macOS, replace Elef.app with the app from the older DMG using Finder; a blocked version remains excluded from automatic updates. Once AUR history is available, use it to rebuild the exact older package metadata and install that package with pacman:

~~~sh
AUR_PACKAGE=elef-bin # use the package name shown in the release notes
git clone "https://aur.archlinux.org/${AUR_PACKAGE}.git"
cd "$AUR_PACKAGE"
git log --oneline -- PKGBUILD
git checkout <known-good-commit>
makepkg
sudo pacman -U ./${AUR_PACKAGE}-<version>-<pkgrel>-x86_64.pkg.tar.zst
~~~

Package history and downloaded archives cannot be remotely recalled. If an AUR release is unsafe, stop promotion and use an owner-approved higher fixed version. A central block removes the macOS update offer but cannot reliably downgrade AUR clients that already fetched or installed the package.

## If something goes wrong

- **The Arch package will not launch:** inspect the package's declared dependencies and the release evidence; report the version and sanitized diagnostics.
- **macOS blocks the first launch:** use the per-app Open Anyway steps above only for the copy you obtained from the official Elef release.
- **A library or deck is read-only:** Elef can open it, but saves and settings changes need write access. Choose a writable library location.
- **A conflict appears:** the file changed outside Elef. Resolve it in the app before closing; neither version is silently discarded.
