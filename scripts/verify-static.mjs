import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const required = [
  'package.json',
  'pnpm-workspace.yaml',
  'apps/web/package.json',
  'apps/web/src/pages/index.astro',
  'apps/web/src/scripts/main.ts',
  'apps/web/public/manifest.webmanifest',
  'apps/web/public/sw.js',
  'packages/gaga-bridge/package.json',
  'scripts/bootstrap-gaga.mjs',
  'scripts/check-node.mjs',
  'workers/signaling/wrangler.jsonc',
  'workers/signaling/src/index.ts',
  'README.md'
];

for (const relative of required) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) throw new Error(`Missing required file: ${relative}`);
}


const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (rootPackage.version !== '1.1.0') throw new Error('Release version must be 1.1.0.');
if (rootPackage.packageManager !== 'pnpm@12.11.0') throw new Error('pnpm version drift detected.');
if (rootPackage.engines?.node !== '>=22.19.0') throw new Error('Node engine floor must satisfy GAGA Engine 0.1.6.');

const sharedTypes = fs.readFileSync(path.join(root, 'packages/shared-types/src/index.ts'), 'utf8');
for (const forbidden of ['RTCSessionDescriptionInit', 'RTCIceCandidateInit', 'RTCIceServer']) {
  if (sharedTypes.includes(forbidden)) throw new Error(`Shared wire protocol must remain runtime-neutral; found browser DOM type: ${forbidden}`);
}
const workerSource = fs.readFileSync(path.join(root, 'workers/signaling/src/index.ts'), 'utf8');
if (!workerSource.includes("from '@live-voice/shared-types'")) throw new Error('Worker must consume the shared runtime-neutral signaling protocol.');
if (!workerSource.includes('origin === requestOrigin')) throw new Error('Worker must allow same-origin production signaling.');
for (const forbidden of ['RTCSessionDescriptionInit', 'RTCIceCandidateInit', 'RTCIceServer']) {
  if (workerSource.includes(forbidden)) throw new Error(`Worker source must not depend on browser DOM WebRTC types: ${forbidden}`);
}

const workerConfig = fs.readFileSync(path.join(root, 'workers/signaling/wrangler.jsonc'), 'utf8');
if (!workerConfig.includes('http://localhost:4321') || !workerConfig.includes('http://127.0.0.1:4321')) {
  throw new Error('Worker config must preserve localhost signaling origins for development.');
}
if (/https:\/\/[a-z0-9.-]+\.workers\.dev/i.test(workerConfig)) throw new Error('Worker config must not hardcode a production workers.dev origin.');

const webRuntime = fs.readFileSync(path.join(root, 'apps/web/src/scripts/main.ts'), 'utf8');
if (!webRuntime.includes('window.location.origin')) {
  throw new Error('Frontend must default to same-origin signaling outside localhost.');
}
if (!webRuntime.includes('gaga:peer-recovery-scheduled')) throw new Error('WebRTC recovery diagnostics must be emitted through GAGA.');

const serviceWorker = fs.readFileSync(path.join(root, 'apps/web/public/sw.js'), 'utf8');
if (!serviceWorker.includes("live-voice-v1.1.0")) throw new Error('Service worker cache version must match release 1.1.0.');

const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
if (/cache:\s*pnpm/.test(workflow)) throw new Error('CI must not enable pnpm cache before a real lockfile is committed.');
if (!workflow.includes('package-manager-cache: false')) throw new Error('CI must explicitly disable setup-node package-manager caching without a committed lockfile.');

const rootRunner = fs.readFileSync(path.join(root, 'run_local.command'), 'utf8');
if (rootRunner.includes('dirname "$0")/..')) throw new Error('Root run_local.command must resolve the repository root, not its parent directory.');
if (!workflow.includes('actions/checkout@v7') || !workflow.includes('actions/setup-node@v7') || !workflow.includes('pnpm/action-setup@v6.1.0') || !workflow.includes('runs-on: ubuntu-24.04')) {
  throw new Error('CI runner/action versions drifted from the validated release line.');
}

const workspacePolicy = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
for (const expected of ['allowBuilds:', '"@parcel/watcher": true', 'esbuild: true', 'workerd: true', 'minimumReleaseAge: 1440', 'minimumReleaseAgeStrict: true']) {
  if (!workspacePolicy.includes(expected)) throw new Error(`Missing pnpm supply-chain policy: ${expected}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public/manifest.webmanifest'), 'utf8'));
if (!Array.isArray(manifest.icons) || manifest.icons.length < 2) throw new Error('PWA manifest icons are incomplete.');

const gagaPackage = JSON.parse(fs.readFileSync(path.join(root, 'packages/gaga-bridge/package.json'), 'utf8'));
const gagaDependency = gagaPackage.dependencies?.['@gaga/engine'] ?? '';
if (gagaDependency !== '0.1.6') throw new Error('GAGA Engine must be consumed as an exact @gaga/engine@0.1.6 shared-kernel dependency.');
if (gagaPackage.dependencies?.['@gaga/engine-web'] !== '0.1.6') throw new Error('GAGA browser runtime must be consumed as exact @gaga/engine-web@0.1.6.');

const gagaBridge = fs.readFileSync(path.join(root, 'packages/gaga-bridge/src/index.ts'), 'utf8');
if (gagaBridge.includes("from '@gaga/engine'")) throw new Error('GAGA bridge must not import the internal @gaga/engine package root.');
for (const expected of ["from '@gaga/engine/capabilities'", "from '@gaga/engine/diagnostics'", "from '@gaga/engine-web/runtime/lifecycle'"]) {
  if (!gagaBridge.includes(expected)) throw new Error(`GAGA bridge must use public GAGA contract subpath: ${expected}`);
}

const bootstrap = fs.readFileSync(path.join(root, 'scripts/bootstrap-gaga.mjs'), 'utf8');
if (!bootstrap.includes('https://npm.cloudsmith.io/gaga/gaga/')) throw new Error('GAGA Cloudsmith registry endpoint is incorrect.');
if (!bootstrap.includes("const VERSION = '0.1.6'")) throw new Error('GAGA bootstrap must pin version 0.1.6.');
if (!bootstrap.includes('5146d7755ce0812f3559f3908d36c4365eb655ac10900d64c40d18aa61731ae2')) throw new Error('GAGA release SHA-256 pin is missing.');
if (/npm\.cloudsmith\.io\/gaga\/r\//.test(bootstrap)) throw new Error('Legacy/incorrect Cloudsmith repository path found.');

for (const relative of ['apps/web/src/scripts/main.ts', 'workers/signaling/src/index.ts']) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  if (/\bTODO\b|placeholder implementation|echo WebSocket/i.test(source)) {
    throw new Error(`Unresolved implementation marker found in ${relative}`);
  }
}

for (const relative of ['README.md', 'docs/DEPLOYMENT.md', 'docs/RELEASE_VERIFICATION.md', 'apps/web/public/sw.js']) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  if (source.includes('0.0.5')) throw new Error(`Stale 0.0.5 release reference found in ${relative}`);
}

console.log('Static repository verification passed.');
