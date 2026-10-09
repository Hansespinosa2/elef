#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"
if [[ "$(uname -m)" != "x86_64" ]]; then
  echo "The Arch release package gate requires x86-64." >&2
  exit 2
fi
if [[ ! "${ELEF_BUILD_SHA:-}" =~ ^[[:xdigit:]]{40,64}$ ]]; then
  echo "ELEF_BUILD_SHA must identify the exact tested source commit." >&2
  exit 2
fi

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
  nodejs \
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

rustup default stable
npm ci --prefix desktop/frontend
npm run build --prefix desktop/frontend
ELEF_BUILD_SHA="$ELEF_BUILD_SHA" cargo build --manifest-path desktop/Cargo.toml --package elef-desktop --release --locked
version="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync("desktop/src-tauri/tauri.conf.json", "utf8")).version)')"
output_directory="${repo_root}/desktop/target/arch-release"
ELEF_BUILD_SHA="$ELEF_BUILD_SHA" node desktop/scripts/package_arch_archive.mjs "$version" desktop/target/release/elef-desktop "$output_directory"
bash desktop/scripts/test_arch_package.sh "$version" "${output_directory}/elef-${version}-x86_64.tar.zst"
echo "Arch package gate passed for ${version} at source ${ELEF_BUILD_SHA}."
