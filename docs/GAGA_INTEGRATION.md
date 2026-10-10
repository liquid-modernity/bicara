# GAGA Engine 0.1.6 integration boundary

Cloudsmith repository: workspace `gaga`, repository `gaga`. Native npm registry endpoint: `https://npm.cloudsmith.io/gaga/gaga/`.

The repository uses `scripts/bootstrap-gaga.mjs` to verify the canonical `@gaga/engine@0.1.6` artifact. The script requests npm metadata, follows the registry-provided `dist.tarball`, validates `dist.integrity` or the legacy `dist.shasum` when present, and writes the verified package to `vendor/gaga-0.1.6.tgz` as release evidence.

Application code consumes exact registry dependencies:

```text
@gaga/engine@0.1.6
@gaga/engine-web@0.1.6
```

For a private Cloudsmith repository, supply `CLOUDSMITH_TOKEN` as a build secret. The token is never exposed to browser code.

The Live Voice product is an independent GAGA consumer. GAGA provides reusable contracts and browser primitives; Live Voice owns product identity, voice-domain policy, WebRTC behavior, room behavior, visual expression, workflow, and deployment.

`@live-voice/gaga-bridge` is the only package that imports GAGA. It uses public, explicit GAGA subpaths:

1. `@gaga/engine/capabilities` defines and inspects the Live Voice browser-room capability;
2. `@gaga/engine/diagnostics` emits sanitized lifecycle diagnostics;
3. `@gaga/engine-web/runtime/lifecycle` owns cleanup registration for long-lived frontend subscriptions.

The bridge deliberately avoids the internal `@gaga/engine` and `@gaga/engine-web` package roots. WebRTC, Durable Object signaling, room roster policy, labels, routes, and UI state remain Live Voice responsibilities.

For Live Voice 1.3, GAGA also acts as the intelligence boundary for browser capability detection, lifecycle cleanup, diagnostics, and normalized voice lifecycle events:

- `gaga:voice.participant.joining`
- `gaga:voice.participant.connected`
- `gaga:voice.participant.reconnecting`
- `gaga:voice.quality.changed`
- `gaga:voice.audio.optimized`
- `gaga:voice.recovered`
- `gaga:room.activity.changed`
- `gaga:room.facilitation.started`
- `gaga:room.facilitation.ended`
- `gaga:participant.role.changed`

The voice-domain package owns reusable participant presence, room mode, conversation pulse, quality-score, session role, activity state, facilitation, and social event semantics. The WebRTC package only transports media and applies browser sender parameters.


## Release artifact pin

The verified `@gaga/engine@0.1.6` artifact is additionally pinned to SHA-256:

```text
5146d7755ce0812f3559f3908d36c4365eb655ac10900d64c40d18aa61731ae2
```

The bootstrap rejects both downloaded and cached artifacts that do not match this hash, in addition to validating registry-provided npm integrity metadata.
