# Development and testing

Use the smallest check that covers a change, then run the shared web/desktop flow when product behavior is shared. Keep test data disposable.

## Environment

The repository uses Ruby 3.4 (.ruby-version), Rails 8.1, Node 22 in CI, and stable Rust for Tauri. config/database.yml defaults Rails to PostgreSQL. CI also runs SQLite compatibility and desktop E2E database jobs with ELEF_USE_SQLITE=1; SQLite is never the desktop store.

In Andres's Omarchy checkout, https://127.0.0.1:3000/ is the owner's interactive preview. Automated tests and browser harnesses use isolated test environments and disposable data; never target this server. Do not start a second Rails server, restart the owner's server or change its port. If the endpoint is down, diagnose the existing proxy, Rails, and database setup read-only. See [AGENTS.md](../AGENTS.md) for the agent-specific environment rules.

To test a merged change on the Mac mini, follow the [Mac mini deployment runbook](mac-mini-deployment.md#automatic-deployment) and use its development URL. The watcher deploys only a commit approved by PR CI; an open feature branch does not change the dev instance.

For a separate local Rails environment, install dependencies and prepare the configured database:

~~~sh
bundle install
npm ci
bin/rails db:prepare
bin/rails tailwindcss:build
~~~

bin/dev starts Rails plus the Tailwind watcher and defaults to port 3000. Use it only in an isolated environment where that port is free; it does not provide the Omarchy checkout's configured HTTPS endpoint. Development database variables are PGDATABASE, PGUSER, PGPASSWORD, PGHOST, and PGPORT. Test uses PGTESTDATABASE; never point tests at personal or production data.

The desktop app loads a built static frontend and does not need the Rails server. Install its packages and launch it with:

~~~sh
npm ci --prefix desktop/frontend
npm run tauri:dev --prefix desktop/frontend
~~~

The Tauri configuration runs the Rails-owned frontend build before dev and production launches. After changing shared frontend sources, the running desktop app must be relaunched to load the rebuilt bundle.

## Fast checks

| Change | First check |
|---|---|
| Rails-owned JavaScript (host adapters, web-only behavior) | npm run test:javascript |
| Host-neutral client UI or behavior | npm test --prefix packages/client |
| Pure Work semantics or transforms | npm test --prefix packages/work-model |
| Desktop transport/native frontend adapter | npm test --prefix desktop/frontend |
| E2E harness helpers | npm run test:unit --prefix desktop/e2e |
| Rust deck storage or archive behavior | cargo test --manifest-path Cargo.toml -p local-store --locked |
| Rails model, service, controller, or request behavior | bin/rails test path/to/focused_test.rb |
| Renderer implementation | npm run renderer:build, then npm run test:javascript |

Before handing off shared or native changes, also run the relevant build and boundary checks:

~~~sh
npm run build --prefix desktop/frontend
python3 script/check_frontend_ownership.py
python3 desktop/scripts/check_architecture.py
cargo fmt --manifest-path Cargo.toml --all -- --check
cargo clippy --manifest-path Cargo.toml --workspace --all-targets -- -D warnings
~~~

## Web and desktop parity

The user-flow definitions live once in `test/e2e/scenarios/` with the Rails test suite. Playwright and WebdriverIO adapters under `desktop/e2e/` run those flows against Rails and the real Tauri binary. The runners differ because the Tauri driver uses WebDriver, but the scenarios and expected behavior are shared.

The full CI parity harness is npm test --prefix desktop/e2e. It seeds disposable Rails test records and a temporary desktop library, then runs web and native desktop scenarios, including offline and update paths. Its Rails test server uses port 3000; do not run this harness while the user's development server occupies that port. CI runs the native matrix on Linux and macOS. A unit test, frontend bundle, or browser-only run does not establish native WebKit behavior.

For Rails browser workflows, run a focused system test first, then the suite as needed:

~~~sh
bin/rails test test/system/path_to_test.rb
bin/rails test test/system
~~~

Rails system tests use Selenium in headless mode. Keep browser automation headless. Distinguish DOM assertions from reproducing the user's exact state and from visual verification based on an inspected screenshot.

## Generated assets and review

When changing the renderer or styles, rebuild the relevant artifact and inspect its diff:

~~~sh
npm run renderer:build
bin/rails tailwindcss:build
git diff -- app/assets/builds/tailwind.css vendor/javascript/elef-renderer.bundle.js
~~~

CI checks that these generated files match their sources, checks the one-way frontend ownership and Tauri capability/CSP contracts, runs Rails tests with PostgreSQL and SQLite, runs Rails system tests, and builds/tests desktop on Linux and macOS. Re-run the smallest relevant check after the final edit; report the exact tier and platform actually exercised.
