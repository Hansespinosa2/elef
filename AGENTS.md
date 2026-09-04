# Repository Instructions

- Elef is a Rails monolith for authoring and presenting Markdown slide decks;
  raw Markdown is canonical.
- Prefer Rails views with Hotwire/Stimulus. Cover parsing/rendering with unit
  tests, Rails boundaries with request tests, and complete workflows with
  headless Selenium system tests. Run the smallest relevant test first.
- Assume the existing development server is
  `https://127.0.0.1:3000/`. Reuse it; never start a second server or change
  ports. Restart only for boot-time changes that cannot reload safely
  (environment/application config, initializers, dependencies, or asset
  configuration). Verify the endpoint before and after a required restart.
- For isolated agent browser checks, run `scripts/elef-agent setup` once and
  use the task URL printed by `scripts/elef-agent start TASK`,
  `https://TASK.localhost`. These URLs are routed to the matching container;
  do not point browser checks at the main checkout's server.
- All browser automation must remain headless; never open a visible browser.
- Commit coherent changes frequently with concise imperative subjects (ideally
  under 50 characters). Do not add co-author trailers, amend, rewrite history,
  or revert unrelated user changes.
