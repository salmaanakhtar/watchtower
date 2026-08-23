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

The deployer recreates the container so the new env takes effect. Current keys: `DATABASE_URL`, `ADMIN_SECRET`, `AUTH_SECRET`, `AUTH_MAGIC_SECRET` (WT-5, set 2026-08-22; both random 48-char alphanumerics), `APP_ORIGIN`, `RESEND_API_KEY`, `EMAIL_FROM` (WT-6, set 2026-08-22; verified sending works).

WT-8 adds `FIELD_ENCRYPTION_KEY` (64 hex chars — required before deploying WT-8, since new writes are encrypted with it and legacy plaintext stays readable). Retention is opt-in via `RETENTION_ENABLED=1`; set before rolling out so the daily sweep deletes unconsented/stale rows.

### WT-11: inbound email (forwarding) — DNS + Resend + env

Forwarding subdomain: **`in.watchtower.salmaan.dev`** (name.com DNS, Tailnet DNS pattern).

**DNS records (name.com, under `salmaan.dev`):**
- `MX` — `in.watchtower.salmaan.dev` → Resend's inbound MX (copy the exact host/priority from the Resend Receiving → Domains page; it must be the lowest priority for the subdomain). Must be a **subdomain** so it never conflicts with the root's sending MX.
- `TXT` — `in.watchtower.salmaan.dev` → `"v=spf1 include:amazonses.com ~all"` (Resend's SPF for inbound; exact value from Resend's receiving setup).
- `TXT` — `in.watchtower.salmaan.dev` → DMARC policy `_dmarc.in.watchtower.salmaan.dev` → `"v=DMARC1; p=quarantine; rua=mailto:dmarc@salmaan.dev"` (quarantine, not reject, while user forwards are being learned — see OPEN_QUESTIONS).
- Resend may also publish a DKIM key for the receiving domain; add it if the dashboard asks.

**Resend setup:**
1. Verify `in.watchtower.salmaan.dev` as a domain (sending verification is NOT required to receive, but the domain must exist in the account).
2. Enable **Receiving** for the domain; copy the MX record into name.com.
3. Create a **Webhook** → endpoint `https://watchtower.salmaan.dev/api/inbound/webhook`, event `email.received` — save the **signing secret** (`whsec_…`).
4. Create a second Webhook → `https://watchtower.salmaan.dev/api/inbound/events`, events `email.bounced`, `email.complained` (optional: `email.delivered`, `email.failed`, `email.suppressed`).
5. Wait for Receiving to show "verified".

**Env (set via Hermes):** `RESEND_WEBHOOK_SECRET` (the two signing secrets from steps 3+4, comma-separated — Resend issues a distinct `whsec_…` per webhook), `REPUTATION_ALERT_EMAIL` (ops inbox for degradation alerts), optionally `REPUTATION_SWEEP_INTERVAL_MS`.

**No public mail before this is green:** Do not advertise/invite forwarding until the MX is verified, DMARC is `p=quarantine` or stronger, and the webhook endpoints answer 200 (test with a message to a test address).

**Anti-abuse defaults (WT-11):** 50 msgs/address/day cap; 10MB total content cap; unknown/disabled addresses quarantined (never bounced — bouncing feeds spam loops); unsubscribe subjects/bodies quarantined without ingesting; identical content deduped by hash; `unknown_address`/`rate_limited`/`no_content`/`unsubscribe` are the quarantine reasons recorded on `InboundMessage`.

**Reputation monitoring:** bounces/complaints from the `/api/inbound/events` webhook are stored in `ReputationEvent`; the in-process daily sweep alerts `REPUTATION_ALERT_EMAIL` when complaint rate > 2% or bounce rate > 5% over the trailing 7 days (min 10 received).

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
