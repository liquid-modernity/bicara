import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const VERSION = '0.1.6';
const PACKAGE_NAME = process.env.GAGA_PACKAGE_NAME?.trim() || 'gaga';
const REGISTRY = ensureTrailingSlash(process.env.GAGA_NPM_REGISTRY?.trim() || 'https://npm.cloudsmith.io/gaga/gaga/');
const TOKEN = process.env.CLOUDSMITH_TOKEN?.trim();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(root, 'vendor');
const output = path.join(vendorDir, `gaga-${VERSION}.tgz`);

await mkdir(vendorDir, { recursive: true });
if (await isUsableTarball(output)) {
  console.log(`GAGA Engine ${VERSION}: using cached vendor artifact.`);
  process.exit(0);
}

const metadataUrl = new URL(encodeURIComponent(PACKAGE_NAME), REGISTRY);
const metadata = await fetchJson(metadataUrl);
const release = metadata?.versions?.[VERSION];
if (!release?.dist?.tarball) {
  throw new Error(`GAGA Engine ${PACKAGE_NAME}@${VERSION} was not found in ${REGISTRY}`);
}

const tarballUrl = new URL(release.dist.tarball, REGISTRY);
const response = await fetch(tarballUrl, { headers: authHeaders(tarballUrl) });
if (!response.ok) {
  throw new Error(`Unable to download GAGA Engine ${VERSION}: HTTP ${response.status}`);
}

const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length < 64 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
  throw new Error('GAGA Engine download was not a valid gzip tarball.');
}

if (release.dist.integrity && !verifyIntegrity(bytes, release.dist.integrity)) {
  throw new Error('GAGA Engine tarball integrity check failed.');
}
if (!release.dist.integrity && release.dist.shasum) {
  const actualShasum = createHash('sha1').update(bytes).digest('hex');
  if (!timingSafeStringEqual(actualShasum, String(release.dist.shasum))) {
    throw new Error('GAGA Engine tarball shasum check failed.');
  }
}

const temp = `${output}.tmp`;
await writeFile(temp, bytes, { mode: 0o600 });
await rename(temp, output);
console.log(`GAGA Engine ${VERSION}: downloaded and integrity-checked from Cloudsmith.`);

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.npm.install-v1+json, application/json',
      ...authHeaders(url)
    }
  });
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403
      ? ' Set CLOUDSMITH_TOKEN if this repository is private.'
      : '';
    throw new Error(`Unable to query GAGA registry: HTTP ${response.status}.${hint}`);
  }
  return response.json();
}

function authHeaders(url) {
  if (!TOKEN) return {};
  const registryHost = new URL(REGISTRY).host;
  const allowedHosts = new Set([registryHost, 'dl.cloudsmith.io', 'npm.cloudsmith.io']);
  return allowedHosts.has(url.host) ? { authorization: `Bearer ${TOKEN}` } : {};
}

function verifyIntegrity(bytes, integrity) {
  const candidates = integrity.trim().split(/\s+/);
  for (const candidate of candidates) {
    const [algorithm, expected] = candidate.split('-', 2);
    if (!algorithm || !expected || !['sha512', 'sha384', 'sha256'].includes(algorithm)) continue;
    const actual = createHash(algorithm).update(bytes).digest('base64');
    if (timingSafeStringEqual(actual, expected)) return true;
  }
  return false;
}

function timingSafeStringEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

async function isUsableTarball(file) {
  try {
    const bytes = await readFile(file);
    return bytes.length >= 64 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  } catch {
    await rm(file, { force: true });
    return false;
  }
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}
