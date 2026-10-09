# Validation matrix

## Source and build gates

Run:

```bash
node scripts/bootstrap-gaga.mjs
pnpm install --no-frozen-lockfile
pnpm typecheck
pnpm build
pnpm verify:static
```

CI executes the same gates on `main` and pull requests. On the first networked installation, commit the generated `pnpm-lock.yaml` and rerun CI before the production deployment. The release archive intentionally does not contain an unverified or hand-authored lockfile.

## Deployed acceptance tests

1. Join one room from two browsers and confirm bidirectional audio.
2. Verify offer, answer, ICE, participant presence, leave, and rejoin.
3. Verify open-mic mute/unmute.
4. Verify push-to-talk using pointer and held Space key, including while the PTT button itself has keyboard focus.
5. Interrupt the network and verify signaling reconnect plus peer ICE recovery.
6. Verify room capacity rejects participant 11 with a readable room-full error when the limit is 10.
7. Validate Chrome, Edge, Firefox, and Safari on supported desktop versions.
8. Validate Android Chrome and iPhone/iPad Safari.
9. Stage load tests with 2, 5, then 10 participants. Record CPU, memory, uplink, RTT, packet loss, audio dropouts, and reconnect outcomes.
10. Test at least one restrictive NAT/firewall network with Cloudflare TURN enabled.
11. Verify keyboard-only navigation, visible focus, skip link, non-color-only state, and screen-reader labels.
12. If supported by the browser, switch audio output devices and verify existing and newly attached remote audio use the selected sink.
13. Verify PWA installation and offline shell behavior. Voice must remain explicitly unavailable while offline.
14. Configure `ALLOWED_ORIGINS`, then verify the signaling Worker rejects an unapproved Origin.
15. Inspect the browser bundle and network traffic to confirm no Cloudsmith token or TURN API token is exposed.

## Release decision

Static source checks cannot prove real NAT traversal, browser media policy, mobile background behavior, or the 10-participant performance target. A public HTTPS deployment and staged field test remain mandatory before declaring operational production readiness.
