# Deployment — Watchtower

## Overview

Watchtower runs on a Hermes-managed VPS. The user owns deployment; agents monitor.

- **Production URL**: `https://watchtower.salmaan.dev` (Tailnet-private — not public internet)
- **Host**: VPS `root@169.58.162.229` (Contabo), Tailnet `100.107.222.75`, `Asia/Dubai` timezone
- **GitHub repo**: `salmaanakhtar/watchtower`, branch `main` (trunk)

## How deployment works (automated)

The **Hermes deployer** (`hermes-deployer.service`) on the VPS:

1. Polls GitHub `main` every ~5 minutes (`hermes-autoupdate.timer`) using root-authenticated GitHub config.
2. On a new commit: clones, detects the stack (Next.js/node), generates/uses the Dockerfile, builds image `hermes-app/watchtower:<sha>-<timestamp>`, writes `/opt/hermes/apps/watchtower/compose.yaml`, recreates the container.
3. Health-checks over HTTPS (HTTP 200). On failure: **rolls back** to the previous image and quarantines the broken commit (tried once, then newer commits take precedence).
4. Reports success/first-failure to Discord.
5. At container startup, Prisma auto-applies migrations; the SQLite DB lives on a persistent volume: `/opt/hermes/apps/watchtower/data/dev.db` (survives recreation).

Traefik fronting: TLS via `letsencrypt-dns` (name.com DNS challenge), middleware `tailscale-only` → private access. Resource limits: 512m mem, 1 CPU, no-new-privileges, cap-drop NET_RAW.

## Env / secrets

Env is managed through Hermes' own CLI (do NOT hand-edit `/opt/hermes/apps/watchtower/.secrets.env` — use the sanctioned commands):

```bash
# On the VPS as root:
python3 /opt/hermes/agent/data/skills/deployments/salmaan-deploy/scripts/hermes-deploy.py \
  secret set --subdomain watchtower --key ADMIN_SECRET <<< "value"

# or batch:
... secret set-batch --subdomain watchtower <<< '{"KEY":"value"}'
... secret list --subdomain watchtower
... secret unset --subdomain watchtower --key KEY --confirm yes
```

The deployer recreates the container so the new env takes effect. Current keys: `DATABASE_URL`, `ADMIN_SECRET`.

### Deployment observations (2026-08-22, WT-2)

- Full deploy (new commit → build → swap → healthcheck) took **~17 min** wall time. The `hermes-deployer.service` restarted once mid-deploy (clean stop/start, `NRestarts=0`); the retry reused the BuildKit cache and finished. If a deploy seems stuck: check `systemctl status hermes-deployer.service` for a running `docker build` child — a fresh `cache.db` mtime in `/var/lib/docker/buildkit/` means the build is progressing, not hung.
- The deployer is a single-threaded Unix-socket server: concurrent deploy requests queue. `hermes-autoupdate.service` waits on the socket (can look "stuck" while a build runs — check the deployer's child processes before assuming failure).
- Prisma migrations auto-apply at container start; logs will show "N migration(s) ... applied" then `next start`.

## Monitoring after every push to main

**Required protocol — after each push, wait a few minutes (5-min poll + build), then verify:**

1. `hermes-deploy.py status --subdomain watchtower` → expect `health_status: 200` and `commit` = the new SHA.
2. Container image tag matches the new SHA (`docker inspect hermes-app-watchtower --format '{{.Image}}'`).
3. If unhealthy or stale:
   - `hermes-deploy.py diagnose --subdomain watchtower`
   - `docker logs --tail 100 hermes-app-watchtower`
   - Check `deployed_at` in status — if old, the build may have failed (check Discord/quarantine).

## Agent scope (what I am allowed to do on the VPS)

- **Monitoring**: status, logs, health checks, diagnosis.
- **Env population**: only via `hermes-deploy.py secret ...`.
- **NOT allowed**: hand-rolled deployments, direct compose edits, manual `docker run/compose up`, image pushes, or any modification of the deploy pipeline. The user deploys.

## Admin access

- Admin UI: `https://watchtower.salmaan.dev/admin` (tailnet only).
- Admin API: `GET /api/admin`, `PATCH /api/admin/[id]` — bearer token = `ADMIN_SECRET` (set via Hermes).
