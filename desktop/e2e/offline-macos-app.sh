#!/bin/sh
set -eu
# exec preserves the application PID for the WebDriver service's cleanup.
exec /usr/bin/sandbox-exec -f "$ELEF_E2E_OFFLINE_PROFILE" "$ELEF_E2E_REAL_APP_BINARY" "$@"
