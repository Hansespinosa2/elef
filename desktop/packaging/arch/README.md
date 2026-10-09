# Arch package contents

The supported Linux package is `elef-bin`, an x86-64 package built from a native Arch executable. Its source is the versioned `elef-${pkgver}-x86_64.tar.zst` GitHub Release asset, with a SHA-256 embedded in the generated AUR `PKGBUILD` and `.SRCINFO`.

The archive installs the application under `/usr/bin` and its desktop entry, icon, MIME registration, and license under `/usr/share`. It contains no updater or self-installer. Arch package management owns installation and upgrades.

`PKGBUILD.in` is a template. The release publisher fills in a version and checksum only after the immutable asset is visible and validated. CI renders a local-source copy and runs `makepkg` as an unprivileged user before installing, launching, upgrading, and removing the package in a disposable Arch container.

Runtime dependencies follow the [Tauri Arch/AUR guidance](https://v2.tauri.app/distribute/aur/) and current Arch package ownership for WebKitGTK 4.1 and libsoup 3. Build/test tool dependencies are installed only in the Arch build environment.
