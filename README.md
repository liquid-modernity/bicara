# Live Voice v0.0.4

Guest-first browser-native realtime voice rooms built from the supplied Live Voice PRD, TAD, UX, API, repository, and milestone materials.

## Stack

- Astro 7.3.8 static frontend
- TypeScript strict mode and SCSS
- GAGA Engine 0.1.6 resolved from the Cloudsmith `gaga/gaga` npm registry
- WebRTC mesh audio for small rooms
- Cloudflare Worker and Durable Object WebSocket signaling
- Cloudflare STUN by default, optional Cloudflare Realtime TURN credentials
- PWA shell, `id-ID` and `en-US`, responsive and keyboard-accessible UI

## Architecture

Audio never passes through the signaling Worker. The Worker coordinates room presence and targeted WebRTC offer, answer, and ICE messages. Every room maps to one Durable Object, using the WebSocket Hibernation API so signaling state can remain coordinated without pinning a Worker instance in memory.

Live Voice retains ownership of the voice domain, WebRTC policy, room behavior, UI, workflow, and deployment. GAGA Engine is isolated behind `packages/gaga-bridge`, matching the boundary in the supplied requirements. Because the supplied archive does not define GAGA 0.1.6's callable API surface, the application deliberately does not invent undocumented GAGA methods. The bridge loads the exact engine artifact and centralizes GAGA-compatible lifecycle events.

## GAGA bootstrap

Before workspace installation, run:

```bash
node scripts/bootstrap-gaga.mjs
```

The bootstrap queries `https://npm.cloudsmith.io/gaga/gaga/`, selects package `@gaga/engine` version `0.1.6`, downloads the registry-provided `dist.tarball`, and verifies npm integrity metadata when available. The fetched artifact is stored as `vendor/gaga-0.1.6.tgz` and is intentionally ignored by Git.

If the repository is private, expose `CLOUDSMITH_TOKEN` only as a local, GitHub, or Cloudflare build secret. Do not commit it. `GAGA_PACKAGE_NAME` remains available as an explicit bootstrap override. `GAGA_NPM_REGISTRY` can override the registry endpoint if required.

## Local run

Requirements: Node.js 22.19.0+ and Corepack.

```bash
./run_local.command
```

The command resolves GAGA 0.1.6, installs the workspace, starts the signaling Worker on `http://127.0.0.1:8787`, then starts Astro. `localhost` is a secure browser context for microphone testing.

## Quality commands

```bash
corepack enable
node scripts/bootstrap-gaga.mjs
pnpm install --no-frozen-lockfile
pnpm typecheck
pnpm build
pnpm verify:static
```

This source release intentionally starts without a fabricated lockfile. CI disables dependency caching until a real `pnpm-lock.yaml` exists, installs with `--no-frozen-lockfile`, and then executes the full quality gate. After the first successful networked install, commit the generated lockfile to make transitive dependency resolution reproducible and dependency caching can be enabled.

## Manual GitHub upload

Upload the whole repository and push to `main`. `.github/workflows/ci.yml` performs GAGA resolution, dependency installation, TypeScript checks, Astro build, Worker dry-run bundling, and static repository verification. Deployment is intentionally not automated because GitHub and Cloudflare will be connected manually.

If Cloudsmith is private, create a GitHub Actions secret named `CLOUDSMITH_TOKEN`.

## Cloudflare deployment

Deploy two Cloudflare projects from the same repository. Detailed steps are in `docs/DEPLOYMENT.md`.

### Signaling Worker

Use the repository root for the build context.

- Build command: `corepack enable && node scripts/bootstrap-gaga.mjs && pnpm install --no-frozen-lockfile`
- Deploy command: `pnpm --filter @live-voice/signaling-worker deploy`
- Configuration: `workers/signaling/wrangler.jsonc`

After deployment, verify `https://<worker-domain>/health`. Then set Worker variable `ALLOWED_ORIGINS` to the final frontend origin, for example `https://voice.example.com`.

### Astro frontend on Cloudflare Pages

- Root directory: repository root
- Build command: `corepack enable && node scripts/bootstrap-gaga.mjs && pnpm install --no-frozen-lockfile && pnpm build:web`
- Build output: `apps/web/dist`
- Node.js: 22.23.3 recommended

Build variables:

```text
PUBLIC_SIGNALING_URL=https://<worker-domain>
PUBLIC_DEFAULT_ROOM=general
PUBLIC_MAX_PARTICIPANTS=10
```

If Cloudsmith is private, add `CLOUDSMITH_TOKEN` as a protected Cloudflare build secret.

## Optional TURN

STUN is configured by default. For restrictive NAT or firewall environments, add Cloudflare Realtime TURN. Store these only as Worker secrets:

```text
TURN_KEY_ID=<key id>
TURN_KEY_API_TOKEN=<secret token>
```

The `/turn` endpoint exchanges the long-lived secret for short-lived ICE credentials. If TURN is not configured or its credential API is unavailable, clients fall back to Cloudflare STUN.

## Implemented runtime behavior

- guest display name and room links, no account required
- open microphone and push-to-talk modes
- mute and unmute
- participant presence and speaking state
- WebSocket signaling reconnect with exponential backoff
- deterministic WebRTC ICE restart after failed peer connectivity
- ICE candidate queueing before remote descriptions
- selectable audio output where `setSinkId()` is supported
- remote audio autoplay recovery button
- aggregate RTT and packet-loss quality indicator
- server-side room capacity enforcement, default 10
- persistent local language, mode, name, and audio-output preferences
- installable PWA shell with network-aware offline state
- Indonesian and English interface

## Security baseline

- explicit microphone permission, no recording
- no long-lived TURN or Cloudsmith secrets in browser code
- Worker Origin allowlist
- normalized room, participant, and display-name inputs
- 96 KiB signaling message limit
- targeted SDP and ICE routing instead of room-wide relay
- short-lived TURN credentials generated server-side
- Astro-generated Content Security Policy plus security and microphone policy response headers on the static frontend
- HTTPS and WSS expected in production

## Scale boundary

The supplied target is up to 10 participants using WebRTC mesh. A full 10-person mesh can create up to 45 peer connections in the room, so CPU and uplink pressure can be material on older or mobile devices. For larger rooms or materially stricter reliability objectives, migrate media transport to an SFU while retaining the existing product and room-domain boundary.
