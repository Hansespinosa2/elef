# Mac mini single-user deployment

This is the intended operating model for a permanent personal Elef instance.
It keeps production and development independent while using Tailscale as the
only network boundary. It is not a public or multi-user deployment model.

## Directory and branch layout

Use two checkouts with two databases and two storage volumes:

```text
~/development/elef/
├── prod/    # tracks main; production Compose stack; port 3000
└── dev/     # tracks dev; development Compose stack; port 3001
```

The branch contract is deliberately small:

- `main` is the deployable production line.
- `dev` is the integration line and the source of the development instance.
- `feat/<short-name>` branches start from `dev`, stay short-lived, and merge
  back into `dev` through review and CI.
- Promote `dev` to `main` only when the development instance is stable and a
  production backup has been completed.

Do not run production from the `dev` checkout or development from the `prod`
checkout. The separate directories make that mistake visible.

## One-time setup

On the Mac mini, install Git, Docker with Compose, and Tailscale. Then create
the two checkouts and put each on its intended branch:

```bash
mkdir -p ~/development/elef
cd ~/development/elef
git clone <repository-url> prod
git clone <repository-url> dev
cd prod && git switch main
cd ../dev && git switch dev
```

Configure production:

```bash
cd ~/development/elef/prod
cp .env.personal.example .env.personal
# Put a long random value in POSTGRES_PASSWORD.
# Put `bin/rails secret` output in SECRET_KEY_BASE.
scripts/personal-instance config
```

Configure development:

```bash
cd ~/development/elef/dev
cp .env.development.example .env.development
scripts/development-instance config
```

The development stack is source-mounted, so edits in the `dev` checkout are
picked up by Rails and Tailwind. Its PostgreSQL database and storage are not
shared with production.

## Start and verify

```bash
cd ~/development/elef/prod
scripts/personal-instance up
scripts/personal-instance check

cd ~/development/elef/dev
scripts/development-instance up
scripts/development-instance check
```

Production listens on `127.0.0.1:3000`; development listens on
`127.0.0.1:3001`. Both containers restart unless stopped, and `down` preserves
their data volumes.

## Tailscale boundary

Use Tailscale Serve, or an equivalent tailnet-only proxy, to publish the two
loopback ports to your own tailnet devices. Keep the application ports bound
to `127.0.0.1`; do not bind them to `0.0.0.0`, and do not use Tailscale Funnel.
Configure separate tailnet endpoints for production (`127.0.0.1:3000`) and
development (`127.0.0.1:3001`) using the syntax supported by the installed
Tailscale version.

For production, set these values in `.env.personal` before exposing it through
the tailnet proxy:

```dotenv
ELEF_ASSUME_SSL=true
ELEF_FORCE_SSL=true
ELEF_ALLOWED_HOSTS=mac-mini.<your-tailnet>.ts.net
```

Use the exact hostname that the proxy sends in the `Host` header. If more than
one private hostname is needed, separate them with commas. The `/up` health
endpoint remains reachable by the local container health check.

## Normal operating procedures

Update development first:

```bash
cd ~/development/elef/dev
git fetch origin
git switch dev
git pull --ff-only
scripts/development-instance up
scripts/development-instance check
```

Promote a tested development line to production only after taking a backup:

```bash
cd ~/development/elef/prod
scripts/personal-instance backup
git fetch origin
git switch main
git pull --ff-only
scripts/personal-instance up
scripts/personal-instance check
```

Keep timestamped backup directories off the Mac mini as well as on it. Test a
restore into a disposable instance before relying on a backup as a recovery
plan. Never use `docker compose down -v` for routine shutdown; it deletes the
database and storage volumes.

## Future multi-user work

This layout is intentionally compatible with a later hosted architecture, but
it does not provide authentication or authorization today. Before sharing the
instance, add user/workspace identity, authorization, request limits, and a
proper public edge. The single-user Tailscale boundary is the current security
boundary.
