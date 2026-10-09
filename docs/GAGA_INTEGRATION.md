# GAGA Engine 0.1.6 integration boundary

Cloudsmith repository: workspace `gaga`, repository `gaga`. Native npm registry endpoint: `https://npm.cloudsmith.io/gaga/gaga/`.

The repository uses `scripts/bootstrap-gaga.mjs` instead of hard-coding a guessed package tarball URL. The script requests npm metadata for `@gaga/engine@0.1.6`, follows the registry-provided `dist.tarball`, validates `dist.integrity` or the legacy `dist.shasum` when present, and writes the verified package to `vendor/gaga-0.1.6.tgz`. `@live-voice/gaga-bridge` consumes that exact local artifact.

For a private Cloudsmith repository, supply `CLOUDSMITH_TOKEN` as a build secret. The token is never exposed to browser code.

The supplied Live Voice requirements establish Live Voice as an independent product consumer. GAGA may provide applicable reusable mechanics, while Live Voice retains ownership of product identity, voice-domain logic, WebRTC behavior, room behavior, visual expression, workflow, and deployment.

The supplied archive does not define GAGA Engine 0.1.6's callable API contract. To avoid fabricating unsupported methods, `@live-voice/gaga-bridge` intentionally performs a narrow integration:

1. load the verified GAGA Engine 0.1.6 artifact;
2. expose its module namespace through one boundary package;
3. emit `gaga:engine-ready` with the resolved export names;
4. centralize all product `gaga:*` lifecycle events;
5. prevent engine-specific APIs from leaking into WebRTC and room-domain packages.

When an authoritative GAGA 0.1.6 API contract is available, capability adapters can be implemented inside `packages/gaga-bridge` without changing the product-domain interfaces.


## Release artifact pin

The verified `@gaga/engine@0.1.6` artifact is additionally pinned to SHA-256:

```text
5146d7755ce0812f3559f3908d36c4365eb655ac10900d64c40d18aa61731ae2
```

The bootstrap rejects both downloaded and cached artifacts that do not match this hash, in addition to validating registry-provided npm integrity metadata.
