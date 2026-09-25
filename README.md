# Elef

Elef is now a conventional Rails monolith for creating and presenting single-user Markdown slide decks.

## Runtime choices

- **Rails/Ruby:** Rails 8.1.3 on Ruby 3.4.3, selected because both are installed in this environment and Rails 8 keeps Hotwire, importmap, SQLite, and system tests conventional without adding a Node/React runtime.
- **Database:** SQLite via Active Record. The first product is single-user and database-backed, so SQLite keeps the app portable and simple.
- **Views/interactions:** Rails ERB views with Turbo and Stimulus through importmap. Stimulus handles dirty-state navigation protection and browser presentation keyboard controls.
- **Browser automation:** Rails system tests use Selenium with Chrome in explicit headless mode; repository checks must not open a visible browser.
- **Styling:** Tailwind CSS through `tailwindcss-rails` styles Elef-owned application UI. Presentation output remains isolated under `.presentation-surface` with dedicated Markdown, Rouge, KaTeX, slide geometry, presentation-mode, and deck-theme CSS.
- **Markdown rendering:** Redcarpet renders GFM-style Markdown, Rouge highlights fenced code, and the Katex gem renders inline/display TeX. Raw Markdown remains the canonical source; rendered slides are derived.

## Features

- Presentation library with create, list, edit, saved preview, and browser presentation mode.
- Source-first Markdown editor with hybrid autosave, explicit **Save presentation**, and retryable save status.
- Dirty-state warning before unsaved source is lost.
- Presentation management with rename, delete, continuation/inspiration forks, and a library lineage graph.
- Strict slide parsing around standalone `---`, initial front matter, fenced code blocks, layout metadata, theme metadata, and empty slides.

## Development

```bash
bundle install
bin/rails db:prepare
bin/dev
```

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

## Automatic deployment

After CI succeeds, GitHub Actions publishes the approved commit to the
`elef-deploy-main` ref. This only publishes a Git ref; it does not upload the
app or choose a deployment machine. A machine deploys only when its local
watcher is installed and running. The documented setup runs that watcher on
the Mac mini, but it does not enforce a hardware identity.
