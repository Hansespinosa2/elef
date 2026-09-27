# Elef

Elef is now a conventional Rails monolith for creating and presenting single-user Markdown slide decks.

## Runtime choices

- **Rails/Ruby:** Rails 8.1.3 on Ruby 3.4, using Hotwire, importmap, and system tests without adding a Node/React runtime.
- **Database:** PostgreSQL is canonical for hosted development, production, and CI. SQLite remains available for explicit local checks.
- **Views/interactions:** Rails ERB views with Turbo and Stimulus through importmap. Stimulus handles dirty-state navigation protection and browser presentation keyboard controls.
- **Browser automation:** Rails system tests use Selenium with Chrome in explicit headless mode; repository checks must not open a visible browser.
- **Styling:** Tailwind CSS through `tailwindcss-rails` styles Elef-owned application UI. Presentation output remains isolated under `.presentation-surface` with dedicated Markdown, Rouge, KaTeX, slide geometry, presentation-mode, and deck-theme CSS.
- **Markdown rendering:** Redcarpet renders GFM-style Markdown, Rouge highlights fenced code, and the Katex gem renders inline/display TeX. Raw Markdown remains the canonical source; rendered slides are derived.

## Features

- Presentation library with create, list, edit, saved preview, and browser presentation mode.
- Source-first Markdown editor with hybrid autosave, explicit **Save presentation**, and retryable save status.
- Slide overview with source-backed add, duplicate, delete, and reorder controls; image/MP4 insertion; overflow warnings; and browser print-to-PDF.
- Dirty-state warning before unsaved source is lost.
- Presentation management with rename, delete, continuation/inspiration forks, and a library lineage graph.
- Relational workspaces, immutable Markdown revisions, recovery drafts, pinned presentation releases, Active Storage assets, and self-contained work packages.
- Strict slide parsing around standalone `---`, initial front matter, fenced code blocks, layout metadata, theme metadata, and empty slides.

Presentation media syntax and print instructions are in [the authoring guide](docs/presentation-media-and-printing.md). The selected Hype features and upstream research are recorded in [the Hype review](docs/hype-research.md).

## Development

```bash
bundle install
bin/rails db:prepare
bin/dev
```

Host-local development and test expect PostgreSQL at `127.0.0.1` with the `postgres` user.
Set `PGDATABASE`, `PGTESTDATABASE`, `PGUSER`, `PGPASSWORD`, `PGHOST`, and
`PGPORT` when your local setup differs. For a host-local SQLite migration check,
use `ELEF_USE_SQLITE=1 bin/rails db:prepare`.

For a server-only session, build Tailwind first with
`bin/rails tailwindcss:build`, then run `bin/rails server`. Development uses
Propshaft's dynamic asset resolver and ignores production-style manifests in
`public/assets`, so stylesheet changes are picked up after refresh.

To enable in-app bug reports, provide `GITHUB_TOKEN` and `GITHUB_REPOSITORY`
(`owner/repository`) to the Rails server process. The token needs permission to
create issues in that repository. The personal and development Compose stacks
forward these server environment variables. Provide the token through your
process or deployment secret manager; do not put it in source control. Set
`ELEF_BUILD_ID` when a deployment has a build identifier to include it in issue
environment details.

## Personal PostgreSQL instance

The repository includes a production-like, single-user Docker Compose stack.
It uses the same `RAILS_ENV=production` configuration intended for a small
personal server, PostgreSQL 17 for relational data, and durable volumes for
PostgreSQL plus local Active Storage files.

```bash
cp .env.personal.example .env.personal
bin/rails secret                         # put this in SECRET_KEY_BASE
# replace the PostgreSQL password in .env.personal with a long random value
scripts/personal-instance config
scripts/personal-instance up
```

The app is private on `127.0.0.1:3000` by default, so a reverse proxy can be
placed in front of it without exposing PostgreSQL. Set `APP_BIND_ADDRESS` and
`APP_PORT` in `.env.personal` only when the host topology requires it. The
first boot runs migrations only; sample data is optional:

Elef does not currently provide built-in user authentication. Keep this
single-user instance on a private network or put it behind a reverse proxy,
VPN, or other access-control layer before exposing it beyond the host.

```bash
scripts/personal-instance seed
```

Use the built-in deployment smoke check after starting or restoring the stack:

```bash
scripts/personal-instance check
```

Back up both sides of the data model with one command. The bundle contains a
compressed PostgreSQL custom-format dump and the Active Storage directory:

```bash
scripts/personal-instance backup
```

Copy the resulting timestamped directory to storage separate from the server.
Restoring is deliberately destructive and requires an explicit confirmation:

```bash
scripts/personal-instance restore backups/20260922T120000Z --confirm
```

`down` preserves both named volumes; it does not delete personal data. Keep
`.env.personal`, `backups/`, and the Docker volumes out of source control.

For the recommended long-running Mac mini setup, keep a `main` checkout in a
`prod` directory and a `dev` checkout in a separate `dev` directory. The
development checkout has its own PostgreSQL, storage, and port through
`compose.development.yml`; see [the Mac mini deployment runbook](docs/mac-mini-deployment.md).

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

Pull requests run the seven required CI checks once. After a PR is merged,
GitHub Actions verifies those checks against the exact tested source tree
before publishing the approved commit to `elef-deploy-dev` or
`elef-deploy-main`. The post-merge workflow does not rerun the test suite. It
only publishes a Git ref; it does not upload the app or choose a deployment
machine. A machine deploys only when its local watcher is installed and
running. The documented setup runs that watcher on the Mac mini, but it does
not enforce a hardware identity.
