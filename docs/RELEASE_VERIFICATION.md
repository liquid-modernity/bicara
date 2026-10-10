# Release Verification: Live Voice v1.3.0

## Local release gates completed

- Signaling wire contracts are runtime-neutral JSON types; Cloudflare Worker code no longer depends on browser-only WebRTC DOM declarations.
- Signaling payload validation covers target identifiers, SDP type/size, ICE candidate shape/size, participant updates, and ping timestamps.
- JSON parsing for repository JSON files.
- YAML parsing for `pnpm-workspace.yaml` and GitHub Actions workflow.
- TypeScript strict validation for browser/client code and all internal workspace packages.
- Cloudflare Worker TypeScript syntax/type validation against a local compatibility shim.
- GAGA Engine artifact identity confirmed as `@gaga/engine@0.1.6`.
- GAGA bootstrap cached-artifact validation and pinned SHA-256 validation (`5146d7755ce0812f3559f3908d36c4365eb655ac10900d64c40d18aa61731ae2`).
- Static repository policy validation.
- Shell syntax validation for both local runner scripts.
- Executable-bit validation for both local runner scripts.
- Source archive hygiene: no `.git`, `node_modules`, macOS metadata, build output, secrets, or downloaded GAGA tarball is shipped.

## Networked CI gate

GitHub Actions is the authoritative networked release gate because dependency installation requires npm/Cloudsmith access. The workflow performs, in order:

1. repository checkout;
2. pnpm 12.11.0 setup from `package.json`;
3. Node.js 22.23.3 setup without dependency cache before a real lockfile exists;
4. verified GAGA 0.1.6 bootstrap from Cloudsmith;
5. pnpm install with explicit build-script and supply-chain policies;
6. dependency graph and workspace-mutation validation;
7. TypeScript checks;
8. Astro production build and Worker dry-run build;
9. static release verification.

A green GitHub Actions run is required before production deployment.

## Reproducibility

The repository deliberately does not fabricate `pnpm-lock.yaml`. The first successful networked `pnpm install` generates the actual lockfile. Commit that generated lockfile before freezing a long-lived production release. Until then the CI workflow intentionally disables pnpm caching and uses `--no-frozen-lockfile`.
