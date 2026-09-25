# Mac mini single-user deployment

Elef runs as two independent Compose instances on the Mac mini. Tailscale is
the only network boundary. This is a private, single-user deployment.

## Directory and branch layout

```text
~/Development/apps/elef/
├── dev/    # Git checkout of dev; development app and PostgreSQL
├── prod/   # Git checkout of main; production app source
└── ops/    # Mac mini production Compose config, secrets, backups, and releases
```

The `ops/` directory belongs to this Mac mini workspace; it is not part of the
`dev` or `main` checkout. Production uses PostgreSQL and uploaded files in
separate persistent volumes. Development has its own PostgreSQL database and
storage volumes, isolated from production.

Keep the branch contract simple:

- `dev` is the integration line and serves the development instance.
- `main` is the production line.
- Feature branches start from `dev`, pass review and CI, and merge into `dev`.
- Promote tested code to `main` when it is ready for production.

## Automatic deployment

Pull requests run the seven required CI checks. After merge, a lightweight
workflow verifies that those checks succeeded in the PR's test run and that
the merged source tree is exactly the tree tested by CI. It then advances one
of these refs to the approved commit without rerunning the suite:

- `elef-deploy-dev` for `dev`
- `elef-deploy-main` for `main`

GitHub Actions only publishes these refs after CI succeeds; it does not deploy
the app or select a machine. Deployment happens on a computer only while its
machine-local watcher is installed and running. This runbook installs that
watcher on the Mac mini. The setup does not enforce a hardware identity, so a
watcher installed and running on another computer would deploy there too.

The Mac mini's per-user launchd job checks those refs once a minute. It fetches
the approved commit, builds from an immutable source snapshot under
`ops/releases/`, starts the matching Compose instance, and checks the health
endpoint. It does not change the `dev/` or `prod/` working trees, so local edits
there are preserved. Production saves a timestamped copy of its full storage
volume under `ops/backups/production/` before each deployment.

Enable the watcher after the CI workflow changes are present on both origin
branches:

```sh
ops/install-deployment-watcher install
ops/install-deployment-watcher status
```

The watcher runs as the logged-in Mac user and fetches through the checkout's
existing Git authentication. For a GitHub CLI login, configure Git and verify
read access before installing:

```sh
gh auth status --hostname github.com
gh auth setup-git
git -C dev ls-remote --heads origin refs/heads/dev
```

If the saved GitHub login is invalid, reauthenticate with
`gh auth login -h github.com` and repeat those commands. An existing SSH-based
origin and SSH identity also work. The watcher needs read access to the private
repository; it does not need a new deploy key, inbound network access, a GitHub
secret, or a self-hosted GitHub Actions runner.

The final GitHub Actions job uses scoped `contents: write`, `actions: read`,
and `pull-requests: read` permissions to verify the successful PR run and
advance the deploy refs. This changes only GitHub Actions; no Mac mini-side
configuration change is needed while the watcher continues to follow
`elef-deploy-dev` and `elef-deploy-main`. If an approved deploy ref does not
exist yet, the watcher waits until a successful CI run creates it.

Check deploy state and logs with:

```sh
ops/deploy-origin-branches status
tail -f ops/logs/deploy-origin-branches.log
tail -f ops/logs/deploy-origin-branches-error.log
```

Retry a failed deployment after fixing its cause with:

```sh
ops/deploy-origin-branches retry dev
ops/deploy-origin-branches retry main
```

Deployments replace one web container, so a brief interruption is expected.
Rails runs `db:prepare` when the new container starts; that task applies
pending migrations. Keep schema changes compatible with the previous app
version when possible. The production backup is on the Mac mini, so copy
timestamped backups to another device regularly.

## One-time setup

Create the production secret and development environment file:

```sh
ops/setup-production-env
cp dev/.env.development.example dev/.env.development
```

Add the Mac mini's Tailscale MagicDNS hostname to `dev/.env.development` so
Rails accepts requests forwarded by Tailscale Serve:

```dotenv
ELEF_ALLOWED_HOSTS=mac-mini.<your-tailnet>.ts.net
```

Production secrets live in the private `ops/production.env` file. Do not put
that file in either Git checkout.

## Start and verify

```sh
ops/elef-production up
ops/elef-production check

dev/scripts/development-instance up
dev/scripts/development-instance check
ops/check-all
```

Production listens on `127.0.0.1:3000`; development listens on
`127.0.0.1:3001`. Both Compose services restart when Colima's Docker VM starts.
Use `ops/elef-production down` or `dev/scripts/development-instance down` to
stop a service without deleting its data volumes.

## Tailscale boundary

Publish the loopback ports through Tailscale Serve or the shared tailnet route
setup. Keep both app ports bound to `127.0.0.1`; do not bind them to
`0.0.0.0` or use Tailscale Funnel. The preferred paths are:

- `https://mac-mini.tail889398.ts.net/apps/elef/prod`
- `https://mac-mini.tail889398.ts.net/apps/elef/dev`

Use the current MagicDNS hostname if the tailnet name changes. The `/up`
health endpoints are checked locally by Compose and by the deployment watcher.

## Backups and recovery

Each automatic production deployment stores a checksummed archive of the
production database and storage in `ops/backups/production/<timestamp>/`. The
archive contains a PostgreSQL dump and Active Storage files. Create a manual
snapshot at any time with:

```sh
ops/elef-production backup
```

Keep copies off the Mac mini and periodically verify that a backup can be
restored. Never use `docker compose down -v` for routine shutdown; it deletes
the database and storage volumes.
