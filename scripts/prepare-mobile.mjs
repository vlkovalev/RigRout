import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'www');
const apiBase = String(process.env.MOBILE_API_BASE || 'https://rigrout.com').trim().replace(/\/$/, '');

if (apiBase) {
  const parsed = new URL(apiBase);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('MOBILE_API_BASE must use HTTPS outside local development');
  }
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const assets = [
  'MarkerCluster.css',
  'MarkerCluster.Default.css',
  'leaflet.markercluster.js',
  'manifest.json',
  'privacy.html',
  'icon.svg',
  'sw.js'
];
await Promise.all(assets.map((file) => cp(path.join(root, file), path.join(output, file))));

let html = await readFile(path.join(root, 'rigrout.html'), 'utf8');
if (apiBase) {
  const apiOrigin = new URL(apiBase).origin;
  html = html.replace("connect-src 'self'", `connect-src 'self' ${apiOrigin}`);
}
await writeFile(path.join(output, 'index.html'), html);
await writeFile(path.join(output, 'rigrout.html'), html);
await writeFile(
  path.join(output, 'mobile-config.js'),
  `window.RIGROUT_API_BASE = ${JSON.stringify(apiBase)};\n`
);

console.log(`Prepared native web assets in ${output}`);
console.log(apiBase ? `API: ${apiBase}` : 'API: unset (map shell works; server features require MOBILE_API_BASE)');
