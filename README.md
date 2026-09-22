# Elef

Elef is now a conventional Rails monolith for creating and presenting single-user Markdown slide decks.

## Runtime choices

- **Rails/Ruby:** Rails 8.1.3 on Ruby 3.4, using Hotwire, importmap, and system tests without adding a Node/React runtime.
- **Database:** PostgreSQL via Active Record. SQLite remains available only when `ELEF_USE_SQLITE=1` is explicitly set for local migration checks.
- **Views/interactions:** Rails ERB views with Turbo and Stimulus through importmap. Stimulus handles dirty-state navigation protection and browser presentation keyboard controls.
- **Browser automation:** Rails system tests use Selenium with Chrome in explicit headless mode; repository checks must not open a visible browser.
- **Styling:** Tailwind CSS through `tailwindcss-rails` styles Elef-owned application UI. Presentation output remains isolated under `.presentation-surface` with dedicated Markdown, Rouge, KaTeX, slide geometry, presentation-mode, and deck-theme CSS.
- **Markdown rendering:** Redcarpet renders GFM-style Markdown, Rouge highlights fenced code, and the Katex gem renders inline/display TeX. Raw Markdown remains the canonical source; rendered slides are derived.

## Features

- Presentation library with create, list, edit, saved preview, and browser presentation mode.
- Source-first Markdown editor with hybrid autosave, explicit **Save presentation**, and retryable save status.
- Dirty-state warning before unsaved source is lost.
- Presentation management with rename, delete, continuation/inspiration forks, and a library lineage graph.
- Relational workspaces, immutable Markdown revisions, recovery drafts, pinned presentation releases, Active Storage assets, and self-contained work packages.
- Strict slide parsing around standalone `---`, initial front matter, fenced code blocks, layout metadata, theme metadata, and empty slides.

## Development

```bash
bundle install
bin/rails db:prepare
bin/dev
```

Development and test expect PostgreSQL at `127.0.0.1` with the `postgres` user.
Set `PGDATABASE`, `PGTESTDATABASE`, `PGUSER`, `PGPASSWORD`, `PGHOST`, and
`PGPORT` when your local setup differs. For an isolated SQLite migration check,
use `ELEF_USE_SQLITE=1 bin/rails db:prepare`.

The disposable development container starts a private PostgreSQL cluster under
`storage/postgres` automatically; set `PGHOST` to use an external server.

For a server-only session, build Tailwind first with
`bin/rails tailwindcss:build`, then run `bin/rails server`. Development uses
Propshaft's dynamic asset resolver and ignores production-style manifests in
`public/assets`, so stylesheet changes are picked up after refresh.

## Isolated agent browser URLs

The disposable agent workflow gives each task a stable browser identity. On a
Mac, run the one-time guided setup:

```bash
scripts/elef-agent setup
```

After setup, `scripts/elef-agent start editor-fix` creates the isolated
worktree and container, prepares the database, starts Rails, and launches Codex
automatically.
It exposes the app at `https://editor-fix.localhost`. The hostname identifies
the worktree while the local Caddy router forwards it to that task's isolated
container. Each agent gets a separate backend port internally; those ports are
loopback-only and do not appear in the browser URL.

Use `scripts/elef-agent stop editor-fix` to stop the task while preserving its
worktree, then `scripts/elef-agent up editor-fix` to recreate its disposable
container and start Rails again. Use `scripts/elef-agent status` to see
container and HTTP readiness states. Stop or remove the task to unregister its
route.

## Validation

```bash
bin/rails test test/models test/controllers
bin/rails test:system
bin/rails test
bin/rails tailwindcss:build
bin/rails zeitwerk:check
git diff --check
```

Run the development server and Tailwind watcher together with:

```bash
bin/dev
```
