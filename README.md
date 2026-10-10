# Live Voice v1.3.0

Guest-first browser-native realtime voice rooms built from the supplied Live Voice PRD, TAD, UX, API, repository, and milestone materials.

## Stack

- Astro 7.3.8 static frontend
- TypeScript strict mode and SCSS
- GAGA Engine 0.1.6 shared kernel and GAGA Engine Web 0.1.6 browser runtime from the Cloudsmith `gaga/gaga` npm registry
- WebRTC mesh audio for small rooms
- Cloudflare Worker and Durable Object WebSocket signaling
- Cloudflare STUN by default, optional Cloudflare Realtime TURN credentials
- PWA shell, `id-ID` and `en-US`, responsive and keyboard-accessible UI

## Architecture

```text
Browser
  |
  v
GAGA Runtime Layer
  |
  v
Live Voice Application
  |
  +--> WebRTC Transport
  |
  +--> Cloudflare Signaling
```

Audio never passes through the signaling Worker. The Worker coordinates room presence and targeted WebRTC offer, answer, and ICE messages. Every room maps to one Durable Object, using the WebSocket Hibernation API so signaling state can remain coordinated without pinning a Worker instance in memory.

GAGA exists as the reusable runtime layer for capability discovery, diagnostics, shared contracts, and cleanup lifecycle. Live Voice owns room identity, participant model, visual design, routes, UX, voice policy, and deployment. WebRTC owns media transport, SDP, ICE, and peer connection state. The Cloudflare Worker owns signaling authority only; it never carries audio.

## GAGA bootstrap

Before workspace installation, run:

```bash
node scripts/bootstrap-gaga.mjs
```

The bootstrap queries `https://npm.cloudsmith.io/gaga/gaga/`, selects package `@gaga/engine` version `0.1.6`, downloads the registry-provided `dist.tarball`, and verifies npm integrity metadata when available. The fetched artifact is stored as `vendor/gaga-0.1.6.tgz` and is intentionally ignored by Git. The application dependency graph consumes exact registry packages: `@gaga/engine@0.1.6` and `@gaga/engine-web@0.1.6`.

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
- Deploy command: `pnpm --filter @live-voice/signaling-worker run deploy`
- Configuration: `workers/signaling/wrangler.jsonc`

After deployment, verify `https://<worker-domain>/health`. Same-origin Worker deployments work without a production hostname in config. Set Worker variable `ALLOWED_ORIGINS` only when the frontend is served from a separate origin, for example `https://voice.example.com`.

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
- participant presence, speaking state, and lightweight session roles
- human participant states for joining, present, speaking, listening, quiet, unstable, reconnecting, returning, and left
- lightweight room identity with human room name, purpose, mode, and creation time
- Room Pulse social state for quiet rooms, active conversation, active speakers, everyone listening, and people returning
- communal room activity states for preparing, gathering, active conversation, quiet rooms, closing, and ended sessions
- host facilitation controls for starting sessions, opening discussion, quieting the room, and ending sessions locally
- subtle social room events when people join, return, conversations start, or the room becomes quiet
- expanded room mode semantics for open rooms, workshops, learning sessions, and gaming voice rooms
- WebSocket signaling reconnect with exponential backoff
- deterministic WebRTC ICE restart after disconnected or failed peer connectivity
- ICE candidate queueing before remote descriptions
- browser-native adaptive audio bitrate policy with cooldown and gradual restoration
- human audio recovery language: optimizing voice and voice restored
- reconnecting and returning messages that preserve participant identity during recovery
- selectable audio output where `setSinkId()` is supported
- remote audio autoplay recovery button
- normalized 0-100 connection quality score using RTT, packet loss, jitter, bitrate, and ICE state
- server-side room capacity enforcement, default 10
- runtime-neutral signaling protocol shared between browser and Worker
- GAGA capability inspection for the Live Voice browser-room capability
- GAGA diagnostics for lifecycle, capability, participant, quality, recovery, and adaptive-audio events
- GAGA browser lifecycle cleanup for long-lived frontend subscriptions
- bounded server-side validation for SDP and ICE signaling payloads
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
