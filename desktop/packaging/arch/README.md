# Arch package contents

The supported Linux package is `elef-bin`, an x86-64 package built from a native Arch executable. Its source is the versioned `elef-${pkgver}-x86_64.tar.zst` GitHub Release asset, with a SHA-256 embedded in the generated AUR `PKGBUILD` and `.SRCINFO`.

The archive installs the application under `/usr/bin` and its desktop entry, icon, MIME registration, and license under `/usr/share`. It contains no updater or self-installer. Arch package management owns installation and upgrades.

`PKGBUILD.in` is a template. The release publisher fills in a version and checksum only after the immutable asset is visible and validated. CI renders a local-source copy and runs `makepkg` as an unprivileged user before installing, launching, upgrading, and removing the package in a disposable Arch container.

The Arch CI job pins the official multi-architecture `base-devel` image by digest and selects `linux/amd64`. It pins Rust 1.98.0, uses the Node.js 22 LTS line and locked npm dependency manifests, and uploads a package-version inventory with the build. Arch repository packages remain rolling inputs; the inventory records the exact versions used by each CI result.

Runtime dependencies follow the [Tauri Arch/AUR guidance](https://v2.tauri.app/distribute/aur/) and current Arch package ownership for WebKitGTK 4.1 and libsoup 3. Build/test tool dependencies are installed only in the Arch build environment.

## AUR publishing and recovery

The trusted release workflow is configured to publish PKGBUILD and .SRCINFO only after the versioned GitHub Release is public and the archive SHA-256 sidecar and source provenance have been rechecked. It regenerates .SRCINFO with makepkg in the pinned Arch environment, confirms the release remains the newest eligible AUR candidate immediately before pushing over SSH, and refuses to replace an existing version with different metadata or push an older version over a newer one. At first registration it checks AUR ownership; if elef-bin belongs to another maintainer, it selects elef-desktop-bin when that name is available and retains the selected name in the release ledger. The SSH private key belongs in the protected desktop-aur-publishing Actions environment; AUR host keys and account name are pinned in its protected variables. Pull-request workflows never receive those credentials.

A central Elef block stops future automated AUR promotion and removes a macOS update offer, but it cannot erase package metadata already fetched from AUR or reliably downgrade installed packages. Already published artifacts and AUR Git history are retained. Treat a blocked AUR version as unsafe, stop installing it, and use an owner-approved higher fixed Elef version for recovery. Check the GitHub Release and the AUR package page for the current warning and fixed version.

To manually return to an older AUR package revision, inspect package history, build the matching immutable source version, and install the resulting Arch package:

~~~sh
git clone https://aur.archlinux.org/elef-bin.git
cd elef-bin
git log --oneline -- PKGBUILD
git checkout <known-good-commit>
makepkg
sudo pacman -U ./elef-bin-<version>-<pkgrel>-x86_64.pkg.tar.zst
~~~

Do not let an older AUR revision replace a newer package automatically. Normal installs and updates remain the responsibility of Arch package management; no Omarchy-specific package hooks or desktop self-installer are included.
