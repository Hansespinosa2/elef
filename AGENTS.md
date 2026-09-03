# Repository Instructions

## Project

- Elef is a Rails monolith for creating and presenting Markdown slide decks.
- Keep raw Markdown as the canonical presentation source.

## Development

- Use Rails views with Hotwire/Stimulus by default.
- Keep presentation parsing and rendering behavior covered by unit tests.
- Use request tests for Rails boundaries and Selenium-backed Rails system tests
  for complete browser workflows.
- Run the smallest relevant test before broader validation.

## Commits

- Commit frequently at coherent checkpoints while working on a task.
- Use concise imperative commit subjects, preferably 50 characters or fewer.
- Do not add co-author trailers.
- Do not amend commits or rewrite history unless explicitly requested.
- Keep unrelated user changes intact.
