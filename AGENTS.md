# Repository Instructions

## Project

- Elef is a Rails monolith for creating and presenting Markdown slide decks.
- Keep raw Markdown as the canonical presentation source.

## Development

- Use Rails views with Hotwire/Stimulus by default.
- Keep presentation parsing and rendering behavior covered by unit tests.
- Use request tests for Rails boundaries and Selenium-backed Rails system tests
  for complete browser workflows.
- Run all repository browser automation headlessly; never launch a visible
  Chrome, Firefox, or other browser during tests or development checks.
- Run the smallest relevant test before broader validation.

## Development server

- Assume the development server is already running at
  `https://127.0.0.1:3000/`.
- Reuse that server and port; do not start a second server or silently choose a
  different port.
- Do not restart the server for ordinary Rails code, view, Stimulus, or
  `app/assets` stylesheet changes. Development reloading and the Tailwind
  watcher should handle those changes.
- Restart only when a change is loaded at boot and cannot be reloaded safely,
  such as `config/environments/*`, `config/application.rb`, initializers,
  dependency manifests, or asset-pipeline configuration.
- Before restarting, confirm that the existing server is healthy. After a
  required restart, verify that the same fixed endpoint responds before using
  browser automation.
- Keep all browser automation headless, including checks against the running
  development server.

## Commits

- Commit frequently at coherent checkpoints while working on a task.
- Use concise imperative commit subjects, preferably 50 characters or fewer.
- Do not add co-author trailers.
- Do not amend commits or rewrite history unless explicitly requested.
- Keep unrelated user changes intact.
