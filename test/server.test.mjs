// Integration tests for rigrout-server.js — spins up the real server as a
// child process on a scratch port and hits its real HTTP endpoints. No mocks:
// this app's whole job is aggregating ~25 external DOT/511 feeds, so the
// regression risk that matters (silently-broken bbox filtering, a feed
// platform migration nobody noticed, a malformed request that 500s instead
// of 400s) only shows up when the real request/response path runs end to end.
//
// Some tests hit live third-party APIs (state DOT feeds, OSRM's public demo
// router) and can be slow or occasionally flaky if one of those is down —
// that's the nature of this app, not a bug in the test. Run with:
//   npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.RIGROUT_TEST_PORT || 3099;
const BASE = `http://127.0.0.1:${PORT}`;
let serverProcess;

test('all Idaho 511 resources use the server-side API key helper', () => {
  const source = readFileSync(path.join(__dirname, '..', 'rigrout-server.js'), 'utf8');
  const idahoResources = ['event', 'camera', 'sign', 'roadCondition'];
  for (const resource of idahoResources) {
    const feedPattern = new RegExp(
      `511\\.idaho\\.gov/api/v2/get/${resource}\\?format=json[^\\n]*keyEnv:'BAN_KEY_ID'`
    );
    assert.match(source, feedPattern, `Idaho ${resource} feed must declare BAN_KEY_ID`);
  }
  assert.match(source, /serverFetch\(withFeedApiKey\(feed, feed\.url\)/,
    'layer fetches must attach configured feed keys');
});

before(async () => {
  serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'rigrout-server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  serverProcess.stderr.on('data', (d) => { stderr += d; });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/status`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    if (serverProcess.exitCode !== null) {
      throw new Error('rigrout-server.js exited during startup:\n' + stderr);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('rigrout-server.js did not become ready within 15s');
});

after(() => {
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
});

// ── /api/status ──────────────────────────────────────────────────────────
test('GET /api/status reports healthy with feeds loaded', async () => {
  const r = await fetch(`${BASE}/api/status`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status, 'ok');
  assert.ok(body.feeds > 0, 'expected at least one ban feed configured');
});

test('GET /api/geocode validates rural-road search input', async () => {
  const short = await fetch(`${BASE}/api/geocode?q=RR`);
  assert.equal(short.status, 400);
  const badBias = await fetch(`${BASE}/api/geocode?q=Range%20Road%20254&lat=999&lon=-113`);
  assert.equal(badBias.status, 400);
});

test('rural-road abbreviations are expanded before provider search', () => {
  const source = readFileSync(path.join(__dirname, '..', 'rigrout-server.js'), 'utf8');
  assert.match(source, /'Range Road \$1'/);
  assert.match(source, /'Township Road \$1'/);
  assert.match(source, /'County Road \$1'/);
});

test('geocode suggestions are prioritized by distance from the supplied location', () => {
  const source = readFileSync(path.join(__dirname, '..', 'rigrout-server.js'), 'utf8');
  assert.match(source, /item\.distanceKm = distanceKm\(lat, lon, item\.lat, item\.lon\)/);
  assert.match(source, /items\.sort\(function\(a, b\) \{ return a\.distanceKm - b\.distanceKm; \}\)/);
});

test('Alberta legal-land search uses authoritative ATS polygons and validates ranges', () => {
  const source = readFileSync(path.join(__dirname, '..', 'rigrout-server.js'), 'utf8');
  assert.match(source, /function parseAlbertaLegalLand\(/);
  assert.match(source, /alberta_township_system\/MapServer\/20\/query/);
  assert.match(source, /Government of Alberta ATS V4\.1/);
});

test('rest layer merges both official Alberta 511 turnout inventories', () => {
  const source = readFileSync(path.join(__dirname, '..', 'rigrout-server.js'), 'utf8');
  assert.match(source, /api\/v2\/get\/restareaturnout\?format=json/);
  assert.match(source, /api\/v2\/get\/reststopsandturnouts\?format=json/);
  assert.match(source, /mergeNearbyRestAreas\(official, pts, 0\.06\)/);
});

test('rest layer keeps North America coverage and adds verified Ontario and New York feeds', () => {
  const source = readFileSync(path.join(__dirname, '..', 'rigrout-server.js'), 'utf8');
  assert.match(source, /511on\.ca\/api\/v2\/get\/allrestareas\?format=json/);
  assert.match(source, /data\.ny\.gov\/resource\/qebf-4fd8\.json/);
  assert.match(source, /Official Ontario 511/);
  assert.match(source, /Official NYSDOT/);
  assert.match(source, /fetchOfficialRestAreas\(bounds\)/);
  assert.match(source, /highway"="rest_area/,
    'OpenStreetMap must remain the continent-wide fallback');
});

test('GET /api/geocode rejects an invalid Alberta legal-land description', async () => {
  const r = await fetch(`${BASE}/api/geocode?q=LSD%2017-22-38-25-W4`);
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.match(body.error, /LSD 1/);
});

// ── /api/layers input validation ─────────────────────────────────────────
test('GET /api/layers rejects a malformed bbox', async () => {
  const r = await fetch(`${BASE}/api/layers?types=bans&bbox=999,999,999,999`);
  assert.equal(r.status, 400);
});

test('GET /api/layers rejects an unknown layer type', async () => {
  const r = await fetch(`${BASE}/api/layers?types=notarealtype&bbox=45,-100,46,-99`);
  assert.equal(r.status, 400);
});

test('GET /api/layers rejects more than 6 requested types', async () => {
  const r = await fetch(`${BASE}/api/layers?types=stops,cardlock,rest,weigh,repair,ev,border&bbox=45,-100,46,-99`);
  assert.equal(r.status, 400);
});

// ── /api/layers bans — the bbox-filtering regression this suite exists for ──
// Prepublishing audit found a small-area request returning ~900 nationwide
// records because fetchStateBanFeeds() fetches every state's feed (by
// necessity — most state platforms don't support server-side bbox queries)
// but fetchBansLayer() wasn't filtering that down to the caller's bounds
// before returning it. This is the direct regression test for that fix.
test('GET /api/layers?types=bans only returns bans inside the requested bbox', async (t) => {
  // Small area around Calgary, AB — should exclude e.g. Texas/NY/Alberta-wide bans.
  const bbox = '50.8,-114.3,51.3,-113.8';
  const [s, w, n, e] = bbox.split(',').map(Number);
  const r = await fetch(`${BASE}/api/layers?types=bans&bbox=${bbox}`, { signal: AbortSignal.timeout(60000) });
  assert.equal(r.status, 200);
  const body = await r.json();
  const bans = (body.layers && body.layers.bans) || [];
  for (const b of bans) {
    assert.ok(b.lat >= s && b.lat <= n, `ban "${b.title}" lat ${b.lat} outside requested bbox`);
    assert.ok(b.lon >= w && b.lon <= e, `ban "${b.title}" lon ${b.lon} outside requested bbox`);
  }
  t.diagnostic(`${bans.length} ban(s) returned for the Calgary bbox`);
});

test('GET /api/layers?types=bans with no bbox returns the full unfiltered set (route-audit caller relies on this)', async () => {
  // Cache from the previous test keeps this fast — fetchStateBanFeeds() caches
  // the full nationwide fetch for 5 minutes regardless of caller bbox.
  const r = await fetch(`${BASE}/api/layers?types=bans`, { signal: AbortSignal.timeout(60000) });
  assert.equal(r.status, 200);
  const body = await r.json();
  const bans = (body.layers && body.layers.bans) || [];
  assert.ok(Array.isArray(bans));
  assert.ok(body.layers._banFeedStatus, 'expected per-feed status to be reported');
});

// ── /api/route ────────────────────────────────────────────────────────────
test('POST /api/route rejects fewer than 2 waypoints', async () => {
  const r = await fetch(`${BASE}/api/route`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ waypoints: [[51.05, -114.07]], profile: validProfile() }),
  });
  assert.equal(r.status, 400);
});

test('POST /api/route rejects an out-of-range truck profile', async () => {
  const r = await fetch(`${BASE}/api/route`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      waypoints: [[51.05, -114.07], [53.55, -113.49]],
      profile: { ...validProfile(), heightFt: 999 },
    }),
  });
  assert.equal(r.status, 400);
});

test('POST /api/route returns a real route for a valid Calgary→Edmonton request', async () => {
  const r = await fetch(`${BASE}/api/route`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      waypoints: [[51.0447, -114.0719], [53.5461, -113.4938]],
      profile: validProfile(),
    }),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(['tomtom', 'osrm-preview'].includes(body.provider), `unexpected provider: ${body.provider}`);
  assert.ok(Number.isFinite(body.route.distance) && body.route.distance > 0);
  assert.ok(Number.isFinite(body.route.duration) && body.route.duration > 0);
  assert.ok(body.route.geometry && body.route.geometry.coordinates.length > 1);
});

// ── /api/route-audit ──────────────────────────────────────────────────────
test('POST /api/route-audit requires a bbox', async () => {
  const r = await fetch(`${BASE}/api/route-audit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: validProfile() }),
  });
  assert.equal(r.status, 400);
});

test('POST /api/route-audit flags an overweight/overheight profile', async () => {
  // The weight/height threshold checks below are pure profile-vs-fixed-limit
  // logic and don't depend on network — but handleRouteAudit unconditionally
  // runs an Overpass height/weight scan before responding, trying up to 3
  // endpoints at 25s each on failure. Give it room for that worst case rather
  // than racing the server's own retry budget.
  const r = await fetch(`${BASE}/api/route-audit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bbox: '50.8,-114.3,51.3,-113.8',
      profile: { ...validProfile(), weightLbs: 90000, heightFt: 14 },
    }),
    signal: AbortSignal.timeout(90000),
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.risks));
  assert.ok(body.risks.some((x) => /80,000/.test(x.msg)), 'expected an overweight warning');
  assert.ok(body.risks.some((x) => /13\.5ft/.test(x.msg)), 'expected an overheight warning');
});

function validProfile() {
  return { heightFt: 13.5, widthFt: 8.5, lengthFt: 53, weightLbs: 80000, axles: 5, hazmat: 'none' };
}
