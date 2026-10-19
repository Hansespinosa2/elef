# Elef dialog dependency patch

This directory contains the published `tauri-plugin-dialog` 2.4.0 source
from Tauri plugins-workspace commit
`51b430be986ed98635c02ba504f6f30a35771c01`, directory `plugins/dialog`.
The upstream Apache-2.0 and MIT licenses are included alongside the source.
Development tooling, registry metadata and the upstream lockfile are omitted.

Elef keeps the upstream plugin implementation, command names, permissions,
and GTK/native dialog backends. The dependency patch is in `Cargo.toml`:
use `rfd = "=0.17.2"` and remove its discontinued `tokio` feature. Rfd 0.17
removes the ashpd/zbus 5 dependency chain, including its inactive portal
dependencies. That chain otherwise leaves unmaintained `zvariant`,
`zvariant_derive` and `zbus_names` in Cargo.lock (RUSTSEC-2026-0370–0372).
The existing GTK backend stays enabled; no audit policy or capability is relaxed.
`MessageDialogKind` derives its existing `Default::Info` implementation to
pass current clippy without a lint suppression; its value is unchanged.
The two `Dialog::message` doc examples convert their custom button labels
with `.to_string()`: upstream passes `&str` literals to the
`OkCancelCustom(String, String)` variant, which never compiles, and Elef
runs doctests. Docs only; no runtime behavior changes.

This is a patched third-party dependency of the desktop host. It participates
in the existing workspace formatting, lint and compilation checks; formatting
therefore follows the current Rust toolchain. It introduces no new application
package or shared product behavior.

Return to the registry dependency once an upstream dialog release uses
rfd 0.17 or later. Validate replacements with workspace compilation,
clippy, tests, strict Cargo audit and native open/save dialog scenarios.
