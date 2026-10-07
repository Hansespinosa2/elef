# Install and use Elef Desktop

Elef Desktop runs locally on macOS and Linux. Decks remain ordinary folders on disk; the desktop app does not need a server or a database. Use the instructions for the matching release asset on the [GitHub Releases page](https://github.com/Hansespinosa2/elef/releases).

## Install on macOS (Apple silicon)

1. Download the macOS .dmg from an Elef GitHub Release and open it.
2. Drag Elef.app to Applications.
3. Open Elef from Applications.

The v1 app is not signed with an Apple Developer ID or notarized, so macOS may block the first launch. Only continue if you downloaded the app from the Elef GitHub Releases page and trust that copy. After trying to open it, go to **System Settings → Privacy & Security**, scroll to Security, choose **Open Anyway** for Elef, and confirm the next prompt. This adds an exception for Elef; it does not turn off Gatekeeper. If macOS says the app contains malware or is damaged, stop and download it again or report the release issue. [Apple's instructions for opening apps safely](https://support.apple.com/en-sg/102445) describe this per-app exception.

## Install on Linux (Omarchy / Arch)

1. Download the Linux .AppImage from an Elef GitHub Release.
2. In a terminal, make it executable and launch it (replace the path with the downloaded filename):

   ~~~sh
   chmod +x ./Elef.AppImage
   ./Elef.AppImage
   ~~~

Keep the AppImage in the location from which you want to launch it. If it reports that FUSE is unavailable, install the distribution's FUSE 2 compatibility package; on Arch this is fuse2. AppImage's [FUSE troubleshooting guide](https://docs.appimage.org/user-guide/troubleshooting/fuse.html) also documents --appimage-extract-and-run as a fallback when FUSE cannot be used:

~~~sh
./Elef.AppImage --appimage-extract-and-run
~~~

## Choose a library and edit

On first launch, choose a library folder or create one, for example ~/Elef. Each deck is a folder inside that library with a Markdown source file and any local assets. You can keep using folders that already contain Elef decks.

Open a deck from the library. The source editor and visual editor share the web app's authoring controllers. Changes save automatically; **File → Save** requests an immediate save. Inserted media is stored with the deck. **View → Document Graph** shows links among documents in the library.

If another editor or sync tool changes the open source file, Elef checks for that change before saving. Use the conflict dialog to keep your edits, load the disk version, or merge. A conflict or failed save keeps the window open until the source is safe. Undo and redo are available for the current editing session; v1 does not keep a revision history after closing.

## Move a deck between devices

Choose **File → Export Deck…** and save the .elef archive. Move that file by USB, AirDrop, or a file-sync tool, then choose **File → Import .elef…** on the other device. The archive contains the deck files and images. If an imported deck has the same identity as one already in the library, choose **Replace**, **Keep both**, or **Cancel**; Replace moves the existing deck to the system Trash.

## Updates and offline use

Elef checks for updates when it starts. To check at another time, choose **Help → Check for Updates**. When a signed update is available, review the version and choose Install; Elef saves or asks you to resolve any open edits before restarting.

Deck editing, rendering, local media, library search, and the document graph work offline. Update checks need a network connection and fail without blocking the app. v1 does not synchronize libraries between devices; move a deck folder or .elef archive yourself.

## If something goes wrong

- **The AppImage will not launch:** check that it is executable and that FUSE is available. The extract-and-run command above is a fallback.
- **macOS blocks the first launch:** use the per-app Open Anyway steps above only for the copy you obtained from the official Elef release.
- **A library or deck is read-only:** Elef can open it, but saves and settings changes need write access. Choose a writable library location.
- **A conflict appears:** the file changed outside Elef. Resolve it in the app before closing; neither version is silently discarded.
