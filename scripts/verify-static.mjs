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
  'workers/signaling/wrangler.jsonc',
  'workers/signaling/src/index.ts',
  'README.md'
];

for (const relative of required) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) throw new Error(`Missing required file: ${relative}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'apps/web/public/manifest.webmanifest'), 'utf8'));
if (!Array.isArray(manifest.icons) || manifest.icons.length < 2) throw new Error('PWA manifest icons are incomplete.');

const gagaPackage = JSON.parse(fs.readFileSync(path.join(root, 'packages/gaga-bridge/package.json'), 'utf8'));
const gagaDependency = gagaPackage.dependencies?.gaga ?? '';
if (gagaDependency !== 'file:../../vendor/gaga-0.1.6.tgz') throw new Error('GAGA Engine must remain pinned to the verified 0.1.6 vendor artifact.');

const bootstrap = fs.readFileSync(path.join(root, 'scripts/bootstrap-gaga.mjs'), 'utf8');
if (!bootstrap.includes('https://npm.cloudsmith.io/gaga/gaga/')) throw new Error('GAGA Cloudsmith registry endpoint is incorrect.');
if (!bootstrap.includes("const VERSION = '0.1.6'")) throw new Error('GAGA bootstrap must pin version 0.1.6.');
if (/npm\.cloudsmith\.io\/gaga\/r\//.test(bootstrap)) throw new Error('Legacy/incorrect Cloudsmith repository path found.');

for (const relative of ['apps/web/src/scripts/main.ts', 'workers/signaling/src/index.ts']) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  if (/\bTODO\b|placeholder implementation|echo WebSocket/i.test(source)) {
    throw new Error(`Unresolved implementation marker found in ${relative}`);
  }
}

console.log('Static repository verification passed.');
