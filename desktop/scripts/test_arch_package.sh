#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run the Arch package gate inside its disposable Arch container as root." >&2
  exit 2
fi
if [[ "$#" -ne 5 ]]; then
  echo "Usage: test_arch_package.sh <n-1-version> <n-1-archive> <n-version> <n-archive> <package-name>" >&2
  exit 2
fi

previous_version="$1"
previous_archive="$(realpath "$2")"
version="$3"
archive="$(realpath "$4")"
package_name="$5"
if [[ ! "$package_name" =~ ^(elef-bin|elef-desktop-bin)$ ]]; then
  echo "Unsupported Elef AUR package name: ${package_name}." >&2
  exit 2
fi
previous_archive_name="elef-${previous_version}-x86_64.tar.zst"
archive_name="elef-${version}-x86_64.tar.zst"
if [[ "$(basename "$previous_archive")" != "$previous_archive_name" || "$(basename "$archive")" != "$archive_name" ]]; then
  echo "The N-1 and N archives must match their immutable versioned asset names." >&2
  exit 2
fi
for command in makepkg pacman vercmp readelf ldd bsdtar xdotool xvfb-run dbus-run-session openbox python3 runuser useradd; do
  command -v "$command" >/dev/null || { echo "Arch package gate needs ${command}." >&2; exit 2; }
done
if [[ "$(vercmp "$previous_version" "$version")" != "-1" ]]; then
  echo "The N-1 package version must be ordered before N by the Arch version comparator." >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pacman -Qq nodejs npm base-devel webkit2gtk-4.1 libsoup3 gtk3 cairo gdk-pixbuf2 glib2 pango desktop-file-utils shared-mime-info hicolor-icon-theme >/dev/null
if ! id builder >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash builder
fi

temporary_root="$(mktemp -d /tmp/elef-arch-package-gate.XXXXXX)"
chmod 755 "$temporary_root"
server_pid=""
cleanup() {
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; fi
  pacman -Rns --noconfirm "$package_name" >/dev/null 2>&1 || true
  rm -rf "$temporary_root"
}
trap cleanup EXIT

asset_root="${temporary_root}/assets"
mkdir -p "$asset_root"
cp "$previous_archive" "${asset_root}/${previous_archive_name}"
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

run_as_builder() {
  runuser -u builder -- bash -c 'cd "$1" && makepkg --printsrcinfo > .SRCINFO && makepkg --syncdeps --noconfirm' _ "$1"
}

built_package_file=""
build_arch_package() {
  local package_version="$1"
  local filename="$2"
  local package_root="$3"
  local checksum source_url srcinfo
  checksum="$(sha256sum "${asset_root}/${filename}" | cut -d ' ' -f 1)"
  source_url="http://127.0.0.1:${port}/${filename}"
  mkdir -p "$package_root"
  node "${repo_root}/desktop/scripts/render_arch_pkgbuild.mjs" \
    "$package_version" "$checksum" "${package_root}/PKGBUILD" "$source_url" "$package_name"
  cp "${repo_root}/desktop/packaging/arch/elef-bin.install" "${package_root}/${package_name}.install"
  chown -R builder:builder "$package_root"
  run_as_builder "$package_root"

  srcinfo="${package_root}/.SRCINFO"
  grep -F "pkgname = ${package_name}" "$srcinfo"
  grep -F "pkgver = ${package_version}" "$srcinfo"
  grep -F "source = ${filename}::${source_url}" "$srcinfo"
  grep -F "sha256sums = ${checksum}" "$srcinfo"
  for dependency in cairo desktop-file-utils gdk-pixbuf2 glib2 gtk3 hicolor-icon-theme libsoup3 pango shared-mime-info webkit2gtk-4.1; do
    grep -F "depends = ${dependency}" "$srcinfo"
    pacman -Qq "$dependency" >/dev/null
  done
  built_package_file="$(find "$package_root" -maxdepth 1 -type f -name "${package_name}-${package_version}-*.pkg.tar.zst" -print -quit)"
  [[ -n "$built_package_file" ]]
  if ! bsdtar -tf "$built_package_file" | grep -Fxq "usr/share/licenses/${package_name}/LICENSE"; then
    echo "${package_name} package does not own its correctly named license path." >&2
    exit 1
  fi
}

previous_checksum="$(sha256sum "$previous_archive" | cut -d ' ' -f 1)"
checksum="$(sha256sum "$archive" | cut -d ' ' -f 1)"
if [[ "$previous_checksum" == "$checksum" ]]; then
  echo "The N-1 and N versioned archives must have distinct bytes and checksums." >&2
  exit 1
fi
previous_build_info="$(bsdtar -xOf "$previous_archive" usr/share/elef/version.json)"
current_build_info="$(bsdtar -xOf "$archive" usr/share/elef/version.json)"
node -e 'const [oldInfo, newInfo] = process.argv.slice(1).map(JSON.parse); if (oldInfo.version === newInfo.version || oldInfo.build_sha !== newInfo.build_sha || oldInfo.platform !== "linux" || newInfo.platform !== "linux") process.exit(1)' "$previous_build_info" "$current_build_info"

build_arch_package "$previous_version" "$previous_archive_name" "${temporary_root}/package-n-1"
package_v1="$built_package_file"
build_arch_package "$version" "$archive_name" "${temporary_root}/package-n"
package_v2="$built_package_file"

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

verify_installed_package() {
  local expected_version="$1"
  local installed_version
  installed_version="$(pacman -Q "$package_name" | awk '{print $2}')"
  if [[ "$installed_version" != "${expected_version}-1" ]]; then
    echo "Expected ${package_name} ${expected_version}-1, found ${installed_version}." >&2
    exit 1
  fi
  pacman -Qkk "$package_name"
  test -f /usr/bin/elef
  test -f /usr/share/applications/elef.desktop
  test -f /usr/share/icons/hicolor/512x512/apps/elef.png
  test -f /usr/share/mime/packages/elef.xml
  test -f "/usr/share/licenses/${package_name}/LICENSE"
  test ! -e /usr/share/licenses/elef/LICENSE
  for other_package in elef-bin elef-desktop-bin; do
    if [[ "$other_package" != "$package_name" ]]; then
      test ! -e "/usr/share/licenses/${other_package}/LICENSE"
    fi
  done
}

hash_package_owned_files() {
  local output_file="$1"
  pacman -Qlq "$package_name" | while IFS= read -r package_file; do
    if [[ -f "$package_file" ]]; then sha256sum "$package_file"; fi
  done > "$output_file"
}

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

pacman -U --noconfirm "$package_v1"
verify_installed_package "$previous_version"
hash_package_owned_files "${temporary_root}/package-files-before-n-1-launch.sha256"
run_native_smoke n-1-install
hash_package_owned_files "${temporary_root}/package-files-after-n-1-launch.sha256"
diff -u "${temporary_root}/package-files-before-n-1-launch.sha256" "${temporary_root}/package-files-after-n-1-launch.sha256"

pacman -U --noconfirm "$package_v2"
verify_installed_package "$version"
hash_package_owned_files "${temporary_root}/package-files-before-n-launch.sha256"
run_native_smoke n-upgrade
hash_package_owned_files "${temporary_root}/package-files-after-n-launch.sha256"
diff -u "${temporary_root}/package-files-before-n-launch.sha256" "${temporary_root}/package-files-after-n-launch.sha256"

pacman -Rns --noconfirm "$package_name"
test ! -e /usr/bin/elef
test ! -e "/usr/share/licenses/${package_name}/LICENSE"
if pacman -Qq "$package_name" >/dev/null 2>&1; then
  echo "${package_name} remained registered after uninstall." >&2
  exit 1
fi
echo "Arch ${package_name} N-1/N package install, launch, upgrade, and uninstall passed in a clean container."
