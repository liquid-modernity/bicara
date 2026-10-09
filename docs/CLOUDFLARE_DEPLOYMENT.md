# Cloudflare Production Deployment

## Worker root
workers/signaling

## Build
pnpm install --frozen-lockfile
pnpm build

## Deploy
cd workers/signaling
pnpm exec wrangler deploy

GAGA Engine is consumed from Cloudsmith registry:
@gaga:registry=https://npm.cloudsmith.io/gaga/gaga/
