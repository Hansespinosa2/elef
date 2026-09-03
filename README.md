# Elef

Elef is now a conventional Rails monolith for creating and presenting single-user Markdown slide decks.

## Runtime choices

- **Rails/Ruby:** Rails 8.1.3 on Ruby 3.4.3, selected because both are installed in this environment and Rails 8 keeps Hotwire, importmap, SQLite, and system tests conventional without adding a Node/React runtime.
- **Database:** SQLite via Active Record. The first product is single-user and database-backed, so SQLite keeps the app portable and simple.
- **Views/interactions:** Rails ERB views with Turbo and Stimulus through importmap. Stimulus handles dirty-state navigation protection and browser presentation keyboard controls.
- **Styling:** Tailwind CSS through `tailwindcss-rails` styles Elef-owned application UI. Presentation output remains isolated under `.presentation-surface` with dedicated Markdown, Rouge, KaTeX, slide geometry, presentation-mode, and deck-theme CSS.
- **Markdown rendering:** Redcarpet renders GFM-style Markdown, Rouge highlights fenced code, and the Katex gem renders inline/display TeX. Raw Markdown remains the canonical source; rendered slides are derived.

## Features

- Presentation library with create, list, edit, saved preview, and browser presentation mode.
- Source-first Markdown editor with explicit **Save presentation**; no autosave.
- Dirty-state warning before unsaved source is lost.
- Strict slide parsing around standalone `---`, initial front matter, fenced code blocks, layout metadata, theme metadata, and empty slides.

## Development

```bash
bundle install
bin/rails db:prepare
bin/dev
```

For a server-only session, build Tailwind first with
`bin/rails tailwindcss:build`, then run `bin/rails server`.

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
