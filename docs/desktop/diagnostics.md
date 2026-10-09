# Desktop diagnostics

Elef Desktop keeps diagnostics on the computer. It does not send telemetry.

Choose **Help → Export Diagnostics…** to create a ZIP for troubleshooting. The export contains the app version, build SHA when provided by the build, Stable or Dev profile, platform and architecture, event codes, results, and sanitized error categories. It excludes deck source, titles, filenames, library paths, tokens, secrets, raw IPC values, and arbitrary exception text. Malformed or edited log records are omitted from the ZIP.

The local JSONL log is `logs/events.jsonl` in the app data directory. Elef rotates it at 512 KiB and keeps at most three files (`events.jsonl`, `events.1.jsonl`, and `events.2.jsonl`). On Unix, the log directory is mode `0700` and log files are mode `0600`.

Typical Stable locations:

- macOS: `~/Library/Application Support/com.elef.desktop/logs/`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/com.elef.desktop/logs/`

Repository Dev uses its separate app data identifier and writes to the matching `com.elef.desktop.dev/logs/` location.
