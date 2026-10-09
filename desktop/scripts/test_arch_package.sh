#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run the Arch package gate inside its disposable Arch container as root." >&2
  exit 2
fi
if [[ "$#" -ne 2 ]]; then
  echo "Usage: test_arch_package.sh <version> <archive>" >&2
  exit 2
fi

version="$1"
archive="$(realpath "$2")"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
archive_name="elef-${version}-x86_64.tar.zst"
if [[ "$(basename "$archive")" != "$archive_name" ]]; then
  echo "Expected ${archive_name}, got $(basename "$archive")." >&2
  exit 2
fi
for command in makepkg pacman readelf ldd xdotool xvfb-run dbus-run-session openbox python3 runuser useradd; do
  command -v "$command" >/dev/null || { echo "Arch package gate needs ${command}." >&2; exit 2; }
done

pacman -Qq nodejs npm base-devel webkit2gtk-4.1 libsoup3 gtk3 cairo gdk-pixbuf2 glib2 pango desktop-file-utils shared-mime-info hicolor-icon-theme >/dev/null
if ! id builder >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash builder
fi

temporary_root="$(mktemp -d /tmp/elef-arch-package-gate.XXXXXX)"
chmod 755 "$temporary_root"
server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; fi
  pacman -Rns --noconfirm elef-bin >/dev/null 2>&1 || true
  rm -rf "$temporary_root"
}
trap cleanup EXIT

asset_root="${temporary_root}/assets"
mkdir -p "$asset_root"
cp "$archive" "${asset_root}/${archive_name}"
python3 "${repo_root}/desktop/scripts/arch_asset_server.py" "$asset_root" "${temporary_root}/port" &
server_pid=$!
for attempt in $(seq 1 100); do
  [[ -s "${temporary_root}/port" ]] && break
  sleep 0.05
done
if [[ ! -s "${temporary_root}/port" ]]; then
  echo "The loopback asset server did not start." >&2
  exit 1
fi
port="$(cat "${temporary_root}/port")"
source_url="http://127.0.0.1:${port}/${archive_name}"
checksum="$(sha256sum "$archive" | cut -d ' ' -f 1)"
package_root="${temporary_root}/package-v1"
mkdir -p "$package_root"
node "${repo_root}/desktop/scripts/render_arch_pkgbuild.mjs" "$version" "$checksum" "${package_root}/PKGBUILD" "$source_url"
cp "${repo_root}/desktop/packaging/arch/elef-bin.install" "$package_root/elef-bin.install"
chown -R builder:builder "$package_root"

run_as_builder() {
  runuser -u builder -- bash -c 'cd "$1" && makepkg --printsrcinfo > .SRCINFO && makepkg --syncdeps --noconfirm' _ "$1"
}
run_as_builder "$package_root"
srcinfo="${package_root}/.SRCINFO"
grep -F "pkgname = elef-bin" "$srcinfo"
grep -F "pkgver = ${version}" "$srcinfo"
grep -F "sha256sums = ${checksum}" "$srcinfo"
for dependency in cairo desktop-file-utils gdk-pixbuf2 glib2 gtk3 hicolor-icon-theme libsoup3 pango shared-mime-info webkit2gtk-4.1; do
  grep -F "depends = ${dependency}" "$srcinfo"
  pacman -Qq "$dependency" >/dev/null
done
package_v1="$(find "$package_root" -maxdepth 1 -type f -name 'elef-bin-*.pkg.tar.zst' -print -quit)"
[[ -n "$package_v1" ]]

binary_in_package="${temporary_root}/elef"
bsdtar -xOf "$package_v1" usr/bin/elef > "$binary_in_package"
readelf -d "$binary_in_package" > "${temporary_root}/readelf.txt"
ldd "$binary_in_package" | tee "${temporary_root}/ldd.txt"
if grep -q 'not found' "${temporary_root}/ldd.txt"; then
  echo "The Arch executable has an unresolved dynamic library." >&2
  exit 1
fi
mapfile -t linked_libraries < <(awk '$2 == "=>" && $3 ~ /^\// { print $3 } $1 ~ /^\// { print $1 }' "${temporary_root}/ldd.txt")
for library in "${linked_libraries[@]}"; do
  resolved_library="$(realpath "$library")"
  pacman -Qo "$resolved_library"
done

pacman -U --noconfirm "$package_v1"
pacman -Qkk elef-bin
for required_file in /usr/bin/elef /usr/share/applications/elef.desktop /usr/share/icons/hicolor/512x512/apps/elef.png /usr/share/mime/packages/elef.xml /usr/share/licenses/elef-bin/LICENSE; do
  test -f "$required_file"
done
hash_package_owned_files() {
  local output_file="$1"
  pacman -Qlq elef-bin | while IFS= read -r package_file; do
    if [[ -f "$package_file" ]]; then sha256sum "$package_file"; fi
  done > "$output_file"
}
hash_package_owned_files "${temporary_root}/package-files-before-launch.sha256"

run_native_smoke() {
  local label="$1"
  local home="${temporary_root}/home-${label}"
  mkdir -p "$home"
  HOME="$home" XDG_CONFIG_HOME="${home}/config" XDG_DATA_HOME="${home}/data" XDG_CACHE_HOME="${home}/cache" \
    dbus-run-session -- xvfb-run --auto-servernum --server-args="-screen 0 1280x900x24" bash -c '
      set -euo pipefail
      openbox --sm-disable >"$HOME/openbox.log" 2>&1 &
      wm_pid=$!
      app_pid=""
      cleanup_window() {
        if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2>/dev/null; then kill -TERM "$app_pid" 2>/dev/null || true; fi
        kill "$wm_pid" 2>/dev/null || true
      }
      trap cleanup_window EXIT
      /usr/bin/elef >"$HOME/elef.log" 2>&1 &
      app_pid=$!
      window_id=""
      for attempt in $(seq 1 100); do
        if ! kill -0 "$app_pid" 2>/dev/null; then cat "$HOME/elef.log"; exit 1; fi
        window_id="$(xdotool search --onlyvisible --pid "$app_pid" 2>/dev/null | head -n 1 || true)"
        if [[ -n "$window_id" ]]; then break; fi
        sleep 0.2
      done
      if [[ -z "$window_id" ]]; then cat "$HOME/elef.log"; echo "Elef did not create a visible window." >&2; exit 1; fi
      xdotool windowactivate --sync "$window_id"
      # The WebView can become visible before its menu listeners are attached.
      # Let the frontend finish bootstrapping before sending the native Quit.
      sleep 5
      xdotool key --clearmodifiers ctrl+q
      for attempt in $(seq 1 100); do
        if ! kill -0 "$app_pid" 2>/dev/null; then wait "$app_pid"; app_pid=""; exit 0; fi
        sleep 0.1
      done
      cat "$HOME/elef.log"
      echo "Elef did not exit after Quit." >&2
      exit 1
    '
  echo "Arch package launch/quit smoke passed (${label})."
}

run_native_smoke install
hash_package_owned_files "${temporary_root}/package-files-after-launch.sha256"
diff -u "${temporary_root}/package-files-before-launch.sha256" "${temporary_root}/package-files-after-launch.sha256"

# Exercise an Arch package-manager upgrade without changing the tested binary.
# A real upstream release increments pkgver and points at its own immutable
# archive; pkgrel=2 proves the same install/replace path and file ownership.
upgrade_root="${temporary_root}/package-v2"
mkdir -p "$upgrade_root"
sed 's/^pkgrel=1$/pkgrel=2/' "${package_root}/PKGBUILD" > "${upgrade_root}/PKGBUILD"
cp "${repo_root}/desktop/packaging/arch/elef-bin.install" "$upgrade_root/elef-bin.install"
chown -R builder:builder "$upgrade_root"
run_as_builder "$upgrade_root"
package_v2="$(find "$upgrade_root" -maxdepth 1 -type f -name 'elef-bin-*.pkg.tar.zst' -print -quit)"
[[ -n "$package_v2" ]]
pacman -U --noconfirm "$package_v2"
test "$(pacman -Q elef-bin | awk '{print $2}')" = "${version}-2"
pacman -Qkk elef-bin
run_native_smoke upgrade
pacman -Qkk elef-bin
hash_package_owned_files "${temporary_root}/package-files-after-upgrade-launch.sha256"
diff -u "${temporary_root}/package-files-before-launch.sha256" "${temporary_root}/package-files-after-upgrade-launch.sha256"

pacman -Rns --noconfirm elef-bin
test ! -e /usr/bin/elef
if pacman -Qq elef-bin >/dev/null 2>&1; then
  echo "elef-bin remained registered after uninstall." >&2
  exit 1
fi
echo "Arch package install, launch, pkgrel upgrade, and uninstall passed in a clean Arch container."
