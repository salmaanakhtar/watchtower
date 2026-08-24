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

**DNS records (name.com, under `salmaan.dev`)** — all set 2026-08-23:
- `MX` — `in.watchtower.salmaan.dev` → `inbound-smtp.eu-west-1.amazonaws.com` prio 10 (Resend's inbound MX for region eu-west-1; lowest priority on the subdomain only, never the root).
- `TXT` — `in.watchtower.salmaan.dev` → `"v=spf1 include:amazonses.com ~all"`.
- `TXT` — `_dmarc.in.watchtower.salmaan.dev` → `"v=DMARC1; p=quarantine; rua=mailto:dmarc@salmaan.dev"` (quarantine, not reject, while user forwards are being learned).
- `TXT` — `resend._domainkey.in.watchtower.salmaan.dev` → Resend's DKIM key (published when the domain was created; sending capability was re-enabled so the domain can reach `verified`).
- `MX` + `TXT` — `send.in.watchtower.salmaan.dev` → `feedback-smtp.eu-west-1.amazonses.com` prio 10 + `v=spf1 include:amazonses.com ~all` (Resend's sending-SPF records for the subdomain).
- Sending domain: `watchtower.salmaan.dev` is its own Resend domain (id `017bf1ab-…`, eu-west-1) — `resend._domainkey.watchtower` TXT + `send.watchtower` MX/TXT added so `EMAIL_FROM=hello@watchtower.salmaan.dev` sends. (WT-6 worked only if Resend still allowed the subdomain; current Resend requires the subdomain verified — 403 otherwise.)

**Resend setup:**
1. `in.watchtower.salmaan.dev` exists in the account (id `f97a3b3d-…`; recreated 2026-08-23 after the original stayed stuck `pending` — same DKIM key, so DNS was untouched), capabilities sending+receiving **enabled** (receiving is the point; sending enabled only so verification can complete).
2. **Receiving** enabled; Receiving record shows **verified** (mail is being accepted — check `/emails/receiving`).
3. **Webhook** — `https://in.watchtower.salmaan.dev/api/inbound/webhook`, event `email.received` (id `69b78ebe-…`).
4. **Webhook** — `https://in.watchtower.salmaan.dev/api/inbound/events`, events `email.bounced`, `email.complained`, `email.delivered`, `email.failed`, `email.suppressed` (id `f2c80fd7-…`).
5. Each webhook has its **own** Svix signing secret (`whsec_…`); RESEND_WEBHOOK_SECRET holds both, comma-separated (app supports this since `f914470`).
6. **Status 2026-08-23:** `watchtower.salmaan.dev` = verified (sending from `hello@watchtower.salmaan.dev` works). `in.watchtower…` DKIM/SPF records remain `pending` on Resend's side despite correct public DNS (even after domain recreation); Receiving is verified and emails arrive in Resend's receiving API, but **`email.received`/event webhook delivery had NOT fired as of 2026-08-23** — no svix attempts in the Traefik access log, app rows zero. If still silent: open the Resend dashboard → Webhooks → delivery attempts/errors (or support). The host watcher (`watchtower-inbound-watch.service/timer`) Discord-notifies when the domain flips verified, the first inbound message lands, or after 6h of no progress.

6b. **Verification 2026-08-25 (live, via tailnet `100.107.222.75`):** running `bash /usr/local/lib/hermes-deployer/e2e-inbound.sh` on the VPS → **all PASS** (`inbound+secret1` 200, `inbound+secret2` 200, `events+secret2` 200, `events+secret1` 200, `events+bad-secret` 400, `GET-not-allowed` 405). The webhook endpoints answer correctly over public ingress. Live messages land as `InboundMessage` rows: a signed test POST created `status=quarantined, quarantineReason=unknown_address` (correct — no user address exists until WT-12 provisions one). WT-12 (commit `6473984`) adds per-user addresses (`u-<token>@`), so a real forwarded bill now resolves to its owner and ingests.

> The webhooks point at `in.watchtower.salmaan.dev` — NOT `watchtower.salmaan.dev` (that host is Tailnet-private and resolves to 100.107.222.75; Resend needs a public endpoint). Public ingress = Traefik file router `watchtower-inbound-public` in `/opt/hermes/proxy/dynamic/watchtower-inbound.yaml` (Host `in.watchtower.salmaan.dev` && PathPrefix `/api/inbound`, priority 500, no tailscale middleware; wildcard `*.salmaan.dev` LE cert covers TLS). The service URL is the watchtower container's bridge IP, kept in sync by `hermes-watchtower-webhook-sync.{service,timer}` (script `/usr/local/lib/hermes-deployer/watchtower-webhook-sync.sh`). Every other path on the subdomain and everything on `watchtower.salmaan.dev` stays Tailnet-private.

**Env (set via Hermes):** `RESEND_WEBHOOK_SECRET` (both `whsec_…` from steps 3+4, comma-separated), `REPUTATION_ALERT_EMAIL=dmarc@salmaan.dev` (same ops mailbox as the DMARC rua), optionally `REPUTATION_SWEEP_INTERVAL_MS` (default 1d).

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
