# Native single-instance adapter

Adapted from the published `tauri-plugin-single-instance` 2.3.4 source,
Tauri plugins-workspace commit `51b430be986ed98635c02ba504f6f30a35771c01`,
directory `plugins/single-instance`. Upstream licenses are included here.

The Linux implementation uses zbus 6, replacing the former plugin's zbus 5
dependency and its unmaintained standalone wire/name crates. Bus names,
object paths, interface name, callback method and argv/cwd payload remain
compatible with existing Elef processes. macOS and Windows keep the upstream
socket/window protocols; unused optional upstream semver integration is omitted.

This module belongs to the desktop host because instance coordination is an
operating-system capability. Return to the upstream plugin when its dependency
chain migrates to zbus 6; verify mixed-version instance forwarding before
removing this adapter.
