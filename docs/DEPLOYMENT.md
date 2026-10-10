# Deployment runbook

## 1. Upload to GitHub

Upload this repository unchanged. Do not upload `.env`, `.dev.vars`, Cloudsmith tokens, TURN API tokens, or generated `vendor/*.tgz` artifacts.

If the GAGA Cloudsmith repository is private, add GitHub Actions secret `CLOUDSMITH_TOKEN`. The included CI reads that secret only during `scripts/bootstrap-gaga.mjs`.

## 2. Create the signaling Worker

Connect the GitHub repository to Cloudflare Workers. Keep the build context at repository root so the workspace and GAGA bootstrap remain available.

```text
Build command:
corepack enable && node scripts/bootstrap-gaga.mjs && pnpm install --no-frozen-lockfile

Deploy command:
pnpm --filter @live-voice/signaling-worker run deploy
```

The deploy command reads `workers/signaling/wrangler.jsonc`. The first deploy creates the `ROOMS` Durable Object migration.

Verify:

```text
GET https://<worker-domain>/health
```

Expected shape:

```json
{ "ok": true, "service": "live-voice-signaling", "version": "1.4.0" }
```

Same-origin Worker deployments are allowed automatically. Set Worker variable `ALLOWED_ORIGINS` only when the frontend is served from a different HTTPS origin. Multiple origins may be comma-separated. The checked-in default permits localhost development only.

Optional Worker secrets for Cloudflare Realtime TURN:

```text
TURN_KEY_ID
TURN_KEY_API_TOKEN
```

Optional variables already have safe defaults:

```text
MAX_PARTICIPANTS=10
TURN_TTL_SECONDS=43200
```

## 3. Create the Astro frontend on Cloudflare Pages

Connect the same GitHub repository to Cloudflare Pages.

```text
Root directory: repository root
Build command: corepack enable && node scripts/bootstrap-gaga.mjs && pnpm install --no-frozen-lockfile && pnpm build:web
Build output directory: apps/web/dist
Node.js: 22
```

Build variables:

```text
PUBLIC_SIGNALING_URL=https://<worker-domain>
PUBLIC_DEFAULT_ROOM=general
PUBLIC_MAX_PARTICIPANTS=10
```

If Cloudsmith is private, set `CLOUDSMITH_TOKEN` as a protected build secret. It is used at build time only and never enters the Astro client bundle.

After the Pages domain is final, update Worker `ALLOWED_ORIGINS` to exactly that origin and redeploy the Worker. This is not needed when static assets and signaling share the same Worker origin.

## 4. Acceptance checks

Run the matrix in `docs/VALIDATION.md` on the deployed HTTPS URLs. At minimum, validate bidirectional audio from two different networks and a restrictive-network test with TURN enabled before treating the release as public production.

## Production topology

```text
Cloudflare Pages (Astro static UI)
        |
        | HTTPS / WSS
        v
Cloudflare Worker
        |
        v
Durable Object per room

Browser A <==== WebRTC audio ====> Browser B
```

The signaling path carries presence, SDP, and ICE only. Audio remains WebRTC media traffic.
