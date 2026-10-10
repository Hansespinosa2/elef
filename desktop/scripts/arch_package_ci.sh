#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
rust_toolchain_version="1.98.0"
cd "$repo_root"
if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "The Arch release package gate requires x86-64." >&2
  exit 2
fi
if [[ ! "${ELEF_BUILD_SHA:-}" =~ ^[[:xdigit:]]{40,64}$ ]]; then
  echo "ELEF_BUILD_SHA must identify the exact tested source commit." >&2
  exit 2
fi

pacman-key --init
pacman -Sy --noconfirm archlinux-keyring
pacman -Syu --noconfirm --needed \
  appmenu-gtk-module \
  base-devel \
  cairo \
  clang \
  cmake \
  curl \
  dbus \
  desktop-file-utils \
  file \
  gdk-pixbuf2 \
  glib2 \
  gtk3 \
  hicolor-icon-theme \
  libayatana-appindicator \
  librsvg \
  libsoup3 \
  nodejs-lts-jod \
  npm \
  openbox \
  openssl \
  pango \
  pkgconf \
  python \
  rustup \
  shadow \
  shared-mime-info \
  ttf-dejavu \
  webkit2gtk-4.1 \
  wget \
  xdotool \
  xorg-server-xvfb \
  xorg-xauth \
  zstd

rustup toolchain install "$rust_toolchain_version" --profile minimal
rustup default "$rust_toolchain_version"
node_version="$(node --version)"
if [[ "$node_version" != v22.* ]]; then
  echo "Arch release packaging requires the Node.js 22 LTS line." >&2
  exit 2
fi
mkdir -p desktop/target/arch-release
{
  printf 'rust_toolchain=%s\n' "$rust_toolchain_version"
  rustc --version --verbose
  cargo --version
  node --version
  npm --version
  printf '\narch_package_versions:\n'
  pacman -Q | sort
} > desktop/target/arch-release/build-inputs.txt
npm ci --prefix desktop/frontend
npm run build --prefix desktop/frontend
version="${DESKTOP_RELEASE_VERSION:-$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync("desktop/src-tauri/tauri.conf.json", "utf8")).version)')}"
output_directory="${repo_root}/desktop/target/arch-release"
previous_version="$(node -e '
const [major, minor, patch] = process.argv[1].split(".").map(Number)
if (patch > 0) process.stdout.write(`${major}.${minor}.${patch - 1}`)
else if (minor > 0) process.stdout.write(`${major}.${minor - 1}.999`)
else if (major > 0) process.stdout.write(`${major - 1}.999.999`)
else process.exit(1)
' "$version")"
for package_version in "$previous_version" "$version"; do
  DESKTOP_RELEASE_VERSION="$package_version" node desktop/scripts/prepare-linux-release-config.mjs
  ELEF_BUILD_SHA="$ELEF_BUILD_SHA" npm run tauri:build --prefix desktop/frontend -- --no-bundle --config src-tauri/tauri.linux-release.generated.conf.json
  ELEF_BUILD_SHA="$ELEF_BUILD_SHA" node desktop/scripts/package_arch_archive.mjs "$package_version" desktop/target/release/elef-desktop "$output_directory"
done

for package_name in elef-bin elef-desktop-bin; do
  bash desktop/scripts/test_arch_package.sh \
    "$previous_version" "${output_directory}/elef-${previous_version}-x86_64.tar.zst" \
    "$version" "${output_directory}/elef-${version}-x86_64.tar.zst" "$package_name"
done
echo "Arch package gate passed for ${version} at source ${ELEF_BUILD_SHA}."
