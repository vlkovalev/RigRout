/**
 * RigRout API Server — v2.0 (Phase 3)
 * Run: node rigrout-server.js
 * Then open: http://localhost:3001/rigrout.html
 *
 * Env vars:
 *   PORT — defaults to 3001
 *   HOST — defaults to 127.0.0.1 (loopback-only, local dev). Set HOST=0.0.0.0
 *          to accept connections from outside the machine when actually
 *          deploying (Render/Fly/a VPS) — see README "Deploying" section.
 *
 * Endpoints:
 *   GET  /api/layers?types=stops,rest,bans,cameras,restrict&bbox=s,w,n,e
 *   POST /api/route-audit  body:{bbox,profile:{heightFt,widthFt,weightLbs,axles,hazmat,trailer}}
 *   POST /api/route        body:{waypoints:[[lat,lon]],profile:{...},avoidTolls}
 *   GET  /api/signs        DMS/message signs
 *   GET  /api/conditions   road conditions (colored segments)
 *   GET  /api/status
 *   POST /api/cache/clear   — local dev or ADMIN_TOKEN bearer auth
 *   POST /api/restart       — local dev or ADMIN_TOKEN bearer auth
 *   POST /api/feedback     body:{category,message,email}   — persisted to data/feedback.json
 *   GET  /api/feedback     — list stored feedback (local review only)
 *   POST /api/incidents    body:{type,note,lat,lon}         — shared hazard report, persisted to data/incidents.json
 *   GET  /api/incidents    — active (non-expired) hazard reports, visible to every client hitting this server
 */
const http  = require('http');
const https = require('https');
const url   = require('url');
const path  = require('path');
const fs    = require('fs');
// Binds to loopback-only by default — safe for local dev, but this is also
// why the app couldn't be deployed anywhere real: a process bound to
// 127.0.0.1 only accepts connections from the same machine, so it's
// unreachable from outside a VM/container even once "hosted." Deploying
// somewhere real (Render/Fly/a VPS) requires explicitly setting HOST=0.0.0.0
// in that environment's config — left opt-in rather than the default so
// nothing changes for anyone just running this locally.

// Load environment variables from .env if present (zero-dependency)
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach(function(line) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        process.env[k] = v;
      }
    });
    console.log('  Loaded environment from .env');
  }
} catch (e) {
  console.warn('  Failed to load .env file:', e.message);
}

// Read configuration only after the optional .env file has been loaded.
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ALLOWED_ORIGINS = new Set([
  'capacitor://localhost',
  'https://localhost',
  'http://localhost'
].concat((process.env.ALLOWED_ORIGINS || '')
  .split(',').map(function(origin) { return origin.trim().replace(/\/$/, ''); }).filter(Boolean)));

// TTL Cache
const _cache = new Map();
function cacheGet(k) { const v = _cache.get(k); return v && v.exp > Date.now() ? v.data : null; }
function cacheSet(k, d, ttlMs) { _cache.set(k, { data: d, exp: Date.now() + ttlMs }); }

// ── Simple file-backed storage (feedback + shared incident reports) ──────────
// Not a database — fine for single-instance/personal-scale use. If this server
// is ever run multi-instance behind a load balancer, move this to a real store.
const DATA_DIR = path.join(__dirname, 'data');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); }
  catch (e) { return fallback; }
}
function writeJSON(file, data) {
  try { fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2)); }
  catch (e) { console.warn('  Write failed:', file, e.message); }
}

function handleFeedbackPost(req, res, body) {
  const msg = String(body.message || '').trim();
  if (!msg) return respond(res, 400, { error: 'message required' });
  const categories = new Set(['bug','feature','data','ban','safety','general']);
  const category = categories.has(body.category) ? body.category : 'general';
  const email = String(body.email || '').trim().slice(0, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return respond(res, 400, { error: 'invalid email' });
  const list = readJSON('feedback.json', []);
  const entry = {
    id: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    ts: Date.now(),
    category: category,
    message: msg.slice(0, 4000),
    email: email,
  };
  list.unshift(entry);
  if (list.length > 1000) list.length = 1000;
  writeJSON('feedback.json', list);
  console.log('  Feedback received [' + entry.category + ']');
  respond(res, 200, { ok: true, id: entry.id });
}
function handleFeedbackGet(req, res) {
  respond(res, 200, { feedback: readJSON('feedback.json', []) });
}

const INCIDENT_TTL_MS = 4 * 3600 * 1000;
function activeIncidents() {
  const list = readJSON('incidents.json', []);
  const fresh = list.filter(function (i) { return Date.now() - i.ts < INCIDENT_TTL_MS; });
  if (fresh.length !== list.length) writeJSON('incidents.json', fresh);
  return fresh;
}
function handleIncidentPost(req, res, body) {
  const type = String(body.type || '').trim();
  const allowedTypes = new Set(['crash','debris','construction','weather','parking','bridge','weigh','police','other']);
  if (!allowedTypes.has(type)) return respond(res, 400, { error: 'invalid incident type' });
  const lat = body.lat == null ? null : Number(body.lat);
  const lon = body.lon == null ? null : Number(body.lon);
  if ((lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) ||
      (lon !== null && (!Number.isFinite(lon) || lon < -180 || lon > 180)))
    return respond(res, 400, { error: 'invalid coordinates' });
  const list = readJSON('incidents.json', []);
  const entry = {
    id: Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    ts: Date.now(),
    type: type,
    note: String(body.note || '').trim().slice(0, 500),
    lat: lat,
    lon: lon,
    status: 'active',
  };
  list.unshift(entry);
  writeJSON('incidents.json', list.slice(0, 500));
  console.log('  Hazard reported [' + type + ']');
  respond(res, 200, { ok: true, id: entry.id });
}
function handleIncidentGet(req, res) {
  respond(res, 200, { incidents: activeIncidents() });
}

// Server-side fetch (no CORS issues) — follows redirects, uses browser UA
function serverFetch(urlStr, opts, _redirects) {
  opts = opts || {};
  _redirects = _redirects || 0;
  return new Promise(function(resolve, reject) {
    const parsed  = new URL(urlStr);
    const lib     = parsed.protocol === 'https:' ? https : http;
    const headers = Object.assign({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    }, opts.headers || {});
    if (opts.body) {
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(opts.body);
    }
    const reqOpts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   opts.method || 'GET',
      headers:  headers,
    };
    const timer = setTimeout(function() { req.destroy(); reject(new Error('Timeout')); }, opts.timeout || 15000);
    const req = lib.request(reqOpts, function(res) {
      // Follow redirects (301, 302, 307, 308)
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location && _redirects < 5) {
        clearTimeout(timer);
        const nextUrl = res.headers.location.startsWith('http') ? res.headers.location : parsed.origin + res.headers.location;
        return resolve(serverFetch(nextUrl, opts, _redirects + 1));
      }
      let body = '';
      res.on('data', function(d) { body += d; });
      res.on('end', function() {
        clearTimeout(timer);
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode + (body ? ': ' + body.slice(0,300) : '')));
        resolve(body);
      });
    });
    req.on('error', function(e) { clearTimeout(timer); reject(e); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// Overpass with 3-endpoint fallback
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
async function overpassFetch(query) {
  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
    const ep = OVERPASS_ENDPOINTS[i];
    try {
      const body = await serverFetch(ep, { method:'POST', body:'data='+encodeURIComponent(query), timeout:25000 });
      return JSON.parse(body);
    } catch(e) { console.warn('  Overpass', ep.split('/')[2], '-', e.message); }
  }
  return { elements: [] };
}

// POI metadata
const POI_META = {
  stops:   { icon:'fuel',    color:'#E8920A', label:'Truck Stop'      },
  cardlock:{ icon:'card',    color:'#2C7DA0', label:'Cardlock'        },
  rest:    { icon:'rest',    color:'#3DB87A', label:'Rest Area'       },
  weigh:   { icon:'weigh',   color:'#9B59B6', label:'Weigh Station'   },
  repair:  { icon:'repair',  color:'#E05252', label:'Truck Repair'    },
  ev:      { icon:'ev',      color:'#00BCD4', label:'EV Charging'     },
  border:  { icon:'border',  color:'#C0392B', label:'Border Crossing' },
};
const OVERPASS_QUERIES = {
  stops:   '(node["amenity"="fuel"]["hgv"~"yes|designated|only"](BBOX);node["amenity"="fuel"]["name"~"Pilot|Flying J|Love|Petro|TA Travel|Sapp|Kwik Trip|Kwik Star|Casey|Ambest|Travel Center",i](BBOX);node["amenity"="truck_stop"](BBOX);node["highway"="services"](BBOX);way["highway"="services"](BBOX););',
  cardlock:'(node["amenity"="fuel"]["name"~"Cardlock|Petro-Pass|Pacific Pride|CFN|Esso Cardlock|Husky Cardlock",i](BBOX);node["amenity"="fuel"]["cardlock"="yes"](BBOX););',
  rest:    '(node["highway"="rest_area"](BBOX);way["highway"="rest_area"](BBOX);node["amenity"="rest_area"](BBOX);node["highway"="layby"](BBOX);node["amenity"="parking"]["truck"~"yes|designated"](BBOX);node["name"~"Rest Area|Welcome Center|Pull.?off|Picnic Area",i](BBOX););',
  weigh:   '(node["amenity"="weighbridge"](BBOX);node["highway"="weigh_station"](BBOX);node["name"~"Weigh Station|Scale|Port of Entry|POE",i](BBOX););',
  repair:  '(node["shop"="truck_repair"](BBOX);node["shop"="truck"](BBOX);node["name"~"Kenworth|Peterbilt|Freightliner|Rush Truck|Speedco",i](BBOX););',
  ev:      '(node["amenity"="charging_station"]["hgv"~"yes|designated"](BBOX);node["amenity"="charging_station"]["truck"~"yes|designated"](BBOX););',
  restrict:'(way["maxheight"](BBOX);way["maxweight"](BBOX);way["hgv"="no"](BBOX););',
  cameras: null,
  border:  '(node["barrier"="border_control"](BBOX);node["amenity"="border_control"](BBOX);node["name"~"Border|Customs|Port of Entry|POE|CBSA|CBP",i](BBOX);node["office"="customs"](BBOX););',
};

function normalizePOI(el, type) {
  const lat = el.lat || (el.center && el.center.lat);
  const lon = el.lon || (el.center && el.center.lon);
  if (!lat || !lon) return null;
  const tags = el.tags || {};
  const meta = POI_META[type];
  const am = [];
  if (tags['fuel:diesel']==='yes') am.push('Diesel');
  if (tags['fuel:adblue']==='yes'||tags['fuel:def']==='yes') am.push('DEF/AdBlue');
  if (tags.shower==='yes') am.push('Showers');
  if (tags.toilets==='yes') am.push('Washrooms');
  if (tags.restaurant==='yes') am.push('Restaurant');
  if (tags.wifi==='yes'||tags.internet_access==='wlan') am.push('Wi-Fi');
  if (tags.scales==='yes') am.push('Scale');
  // Unnamed cardlock/fuel points are often genuinely private fleet-fuel sites
  // (Pacific Pride, CFN, Fuelman, etc.) that OSM contributors never gave a
  // customer-facing name — that's real data, not missing data. Surface why
  // instead of leaving the client to show a blank line under the generic
  // type-label title.
  if (!am.length && tags.access === 'private') am.push('🔒 Private access — fuel card required');
  return {
    id: type+'_'+el.id, type, lat, lon,
    title: tags.name||tags.operator||tags.brand||meta.label,
    icon: meta.icon, color: meta.color,
    source:'OpenStreetMap', updatedAt: new Date().toISOString(),
    props:{ amenities: am.join(' - '), opening_hours: tags.opening_hours||'' }
  };
}

// Road Bans — confirmed-working or corrected URLs (audited May 2026)
// ✓ = confirmed working  ✗ = removed (bad domain/blocked)  ~ = URL corrected
// A number of these feeds sit on the "511/IBI Group" white-label platform and
// gate their /get/event endpoint behind a free developer key (confirmed via
// each state's own /developers/doc page for Idaho, Wisconsin, New York, Utah).
// Some deployments (Alberta, Ontario) leave it open with no key. Where a feed
// needs one, set the matching env var below — the code appends it to the
// request automatically, no further changes needed. See README for signup
// links. Feeds left without a keyEnv are believed open, per BC/AB/ON/NY
// actually returning data unauthenticated as of this writing.
const BAN_FEEDS = [
  // ── Canada ────────────────────────────────────────────────────────────────────
  { key:'bc', name:'BC DriveBC',       url:'https://api.open511.gov.bc.ca/events?format=json', parser:'open511' }, // ✓ verified working, no key
  { key:'ab', name:'Alberta 511',      url:'https://511.alberta.ca/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ✓ verified working, no key
  { key:'on', name:'Ontario 511',      url:'https://511on.ca/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ✓ verified working, no key
  // sk/mb: no public JSON API — removed
  // ── US Northwest ──────────────────────────────────────────────────────────────
  // WA does NOT run the IBI511 platform — it's WSDOT's own separate Traveler
  // Information API (wsdot.wa.gov/traffic/api/), different URL structure and
  // its own "Access Code" auth, not the 'key' param below. Needs a dedicated
  // integration, not a URL tweak — left in as a known gap rather than guessed at.
  { key:'wa', name:'Washington DOT',   url:'https://wsdot.wa.gov/api/v2/get/event?format=json&lang=en', parser:'ibi511' },
  // Oregon does NOT run IBI511 — tripcheck.com is ODOT's own custom Dojo/Esri
  // "OdotTad.Mapping" app. Confirmed live via network inspection: the map
  // loads its layer data from a set of public, unauthenticated, pre-built
  // Esri FeatureSet JSON files under /Scripts/map/data/ (e.g. EVENT.js,
  // RWTrucking.js) rather than a REST query. RWTrucking.js is the one ODOT
  // itself scopes to commercial-vehicle restrictions specifically — its
  // schema has commercialRestrictionCode/commercialRestrictionDesc fields
  // (matches the app's "Restrictions" layer group). It returns 0 features
  // when nothing is currently posted (e.g. no active chain/traction/closure
  // restriction that day) rather than erroring, same as other quiet feeds.
  { key:'or', name:'Oregon TripCheck (Commercial Restrictions)', url:'https://www.tripcheck.com/Scripts/map/data/RWTrucking.js', parser:'or_trucking' }, // ✓ verified working, no key
  { key:'id', name:'Idaho 511',        url:'https://511.idaho.gov/api/v2/get/event?format=json&lang=en', parser:'ibi511', keyEnv:'BAN_KEY_ID' }, // confirmed: requires key, register at 511.idaho.gov/developers/doc
  // Montana does NOT run the IBI511 platform — 511mt.net is built on Iteris's
  // ATIS product. Confirmed live via browser network/console inspection of
  // 511mt.net: its eventServices.js calls a CDN-hosted GeoJSON endpoint
  // (base_cdn_url = https://mt.cdn.iteris-atis.com/) that is public, needs no
  // key, and is already scoped to weight/load restrictions specifically
  // (icons.restrictions.geojson, as opposed to construction/other events).
  { key:'mt', name:'Montana 511 (Iteris ATIS)', url:'https://mt.cdn.iteris-atis.com/geojson/icons/metadata/icons.restrictions.geojson', parser:'iteris' }, // ✓ verified working, no key
  // ── US Northern Plains ────────────────────────────────────────────────────────
  // 511.nd.gov redirects to a plain Drupal info page, not an app — the actual
  // map (travel.dot.nd.gov) is a custom React/ArcGIS app, not IBI511. Current
  // load restrictions live in gis.dot.nd.gov's rcrs_dynamic MapServer as line
  // geometry, split across a NE layer (23) and a SW layer (24) — both queried
  // and merged, server-side filtered to InEffect='Y' only.
  { key:'nd', name:'North Dakota DOT (ArcGIS)', url:[
      'https://gis.dot.nd.gov/arcgis/rest/services/external/rcrs_dynamic/MapServer/23/query?where=InEffect%3D%27Y%27&outFields=*&outSR=4326&f=json',
      'https://gis.dot.nd.gov/arcgis/rest/services/external/rcrs_dynamic/MapServer/24/query?where=InEffect%3D%27Y%27&outFields=*&outSR=4326&f=json'
    ], parser:'nd_arcgis' }, // ✓ verified working, no key
  // South Dakota also does not run IBI511 — sd511.org is Iteris ATIS too.
  // Confirmed via the page's own inline config (cdn_url = https://sd.cdn.iteris-atis.com/),
  // same platform as Montana but a different filename: SD's restrictions layer is
  // "icons.restriction.geojson" (singular), not "icons.restrictions.geojson".
  { key:'sd', name:'South Dakota 511 (Iteris ATIS)', url:'https://sd.cdn.iteris-atis.com/geojson/icons/metadata/icons.restriction.geojson', parser:'iteris' }, // ✓ verified working, no key
  // Wyoming does NOT run the IBI511 platform (confirmed live: wyoroad.info's
  // "here" link redirects to map.wyoroad.info/511-map/, a custom WYDOT
  // SvelteKit + Esri ArcGIS app — "Powered by Esri" in the footer). Real
  // weight-restriction data does exist and is confirmed live (e.g. "WY22:
  // Weight limit of 60,000 GVW... Teton Pass"), but unlike Montana/South
  // Dakota's clean public Iteris CDN files, the only ArcGIS layers exposed
  // (WTIMAP/Operational_v3 "Point Polygons"/"Districts") are geometry-only
  // helpers with no incident content — the actual restriction text is
  // resolved through the app's bundled SvelteKit JS, not a clean public
  // REST/GeoJSON endpoint found via live network inspection. Needs a
  // dedicated integration (or a request to WYDOT for their real feed), not
  // a URL tweak or a key — left in as a known gap rather than guessed at.
  { key:'wy', name:'Wyoming DOT',      url:'https://wyoroad.info/api/v2/get/event?format=json&lang=en', parser:'ibi511', keyEnv:'BAN_KEY_WY' }, // ✗ confirmed wrong platform — not IBI511, see comment above
  // Minnesota does NOT run IBI511 either — 511mn.org is a custom MnDOT-built
  // site backed by its own GraphQL API (POST 511mn.org/api/graphql, no key).
  // Its map issues a "MapFeatures" query with a layerSlugs param —
  // "truckersReports" is the layer MnDOT itself labels with weight/width/
  // height/axle restriction keywords (confirmed by toggling the real
  // "Trucker Reports" layer checkbox and capturing the resulting request via
  // a patched window.fetch). Replaying that EXACT captured query+variables
  // from real browser JS returns 200 with 36 real restriction features.
  // ⚠ BUT: the identical payload sent from this Node server (via serverFetch)
  // gets HTTP 400 {"errors":[{"message":"Server error."}]} every time, with
  // or without Origin/Referer/Sec-Fetch-* headers added — the error is
  // byte-identical regardless of what's changed, which points to a
  // transport-layer block (TLS/JA3 fingerprinting or similar bot protection)
  // rather than a payload problem, since real browsers aren't blocked and
  // Node's http/https client can't replicate a genuine browser TLS handshake.
  // Left wired up and documented as-is (query/parser are correct) in case a
  // future proxy layer (headless browser, different HTTP client) can get
  // through — but as of this writing it will show as an ERROR, not silently
  // guessed-wrong like the old IBI511 URL was.
  { key:'mn', name:'Minnesota 511 (GraphQL)', url:'https://511mn.org/api/graphql', parser:'mn_graphql',
    method:'POST', headers:{'Content-Type':'application/json', 'Accept':'application/json', 'Origin':'https://511mn.org', 'Referer':'https://511mn.org/', 'Sec-Fetch-Site':'same-origin', 'Sec-Fetch-Mode':'cors', 'Sec-Fetch-Dest':'empty'},
    body: JSON.stringify({
      query: 'query MapFeatures($input: MapFeaturesArgs!, $plowType: String) { mapFeaturesQuery(input: $input) { mapFeatures { bbox title tooltip uri features { id geometry properties type } __typename } error { message type } } }',
      variables: { input: { north:52.53321, south:39.04088, east:-74.87133, west:-107.91821, zoom:6, layerSlugs:['truckersReports'], nonClusterableUris:['dashboard'] }, plowType:'plowCameras' }
    })
  }, // ✗ confirmed real endpoint+query (works from a real browser), but blocked server-side — see comment above
  { key:'wi', name:'Wisconsin 511',    url:'https://511wi.gov/api/v2/get/event?format=json&lang=en', parser:'ibi511', keyEnv:'BAN_KEY_WI' }, // confirmed: requires key, register at 511wi.gov/developers/help
  // ── US Midwest ────────────────────────────────────────────────────────────────
  // Michigan: michigan511.org no longer resolves (DNS failure) — MDOT appears
  // to have retired that domain. Their current open-data presence is GIS-based
  // (gis-mdot.opendata.arcgis.com / michigan.data.socrata.com), not a matching
  // events feed we've confirmed, so this is disabled rather than pointed at an
  // unverified replacement. Needs real research, not a guess.
  // { key:'mi', name:'Michigan 511', url:'https://michigan511.org/api/v2/get/event?format=json&lang=en', parser:'ibi511' },
  // Ohio does NOT run IBI511 — ODOT's real system is the OHGO Public API
  // (publicapi.ohgo.com), a well-documented, separate REST API (confirmed via
  // its own Swagger docs at publicapi.ohgo.com/docs/v1/swagger.json). It needs
  // a free registered key like several IBI511 feeds do, but the auth param is
  // `api-key`, not `key` (see keyParam below), and unauthenticated requests
  // get a clear, well-formed 401 ({"errorDescription":"API key required."}),
  // confirming this is the right endpoint and not a guess. OHGO has no
  // dedicated "restrictions" resource — Construction is the closest fit
  // (covers ODOT-monitored active work with a free-text description/status),
  // so unlike Montana/SD/ND this goes through the normal BAN_KW keyword
  // filter rather than being treated as pre-scoped to restrictions.
  { key:'oh', name:'Ohio OHGO',        url:'https://publicapi.ohgo.com/api/v1/construction', parser:'ohgo', keyEnv:'BAN_KEY_OH', keyParam:'api-key' },
  // Iowa does NOT run IBI511 — 511ia.org is built on the "CARS" 511 platform
  // (confirmed via Iowa DOT's own official 511 Data Feeds page,
  // iowadot.gov/travel-tools/iowa-511/511-data-feeds, which points to an
  // "ESRI GIS Feature Services... do not require credentials" section; the
  // live feed URL was confirmed via network inspection of data.iowadot.gov's
  // ArcGIS Hub page). General events/closures feed (service name
  // CARS511_Iowa_View), not restrictions-only, but does carry a dedicated
  // Restrict_ field alongside headline/phrase/cause/msg0 text — goes through
  // the normal BAN_KW keyword pass via the new `cars511` parser.
  { key:'ia', name:'Iowa 511 (CARS ArcGIS)', url:'https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/CARS511_Iowa_View/FeatureServer/0/query?f=json&outFields=*&outSR=4326&where=1%3D1', parser:'cars511' }, // ✓ verified working, no key
  // Nebraska does NOT run IBI511 either — 511.nebraska.gov is built by Castle
  // Rock Associates ("CARS511"), confirmed via its Google Play package name
  // (crc.carsapp.ne) and its GraphQL API shape matching Minnesota's platform
  // family (POST /api/graphql, no key). Its main "Dashboard" query returns
  // ALL layers' events at once (statewide, no bbox param) with a `quantities`
  // array per event carrying entries like {label:"Width Restriction",
  // value:"12 ft 0 in"} — confirmed live via a captured real browser request
  // (202 events, 106 with quantities, e.g. "US 30... Bridge construction" /
  // Width Restriction 12 ft 0 in). Only `bbox` is given per event (no point
  // geometry), so lat/lon here is the bbox center. Like Minnesota, whether
  // the exact same request works when POSTed from this Node server (vs. a
  // real browser) is unproven — see README for the result once tested live.
  { key:'ne', name:'Nebraska 511 (GraphQL)', url:'https://511.nebraska.gov/api/graphql', parser:'ne_graphql',
    method:'POST', headers:{'Content-Type':'application/json', 'Accept':'application/json', 'Origin':'https://511.nebraska.gov', 'Referer':'https://511.nebraska.gov/'},
    body: JSON.stringify({
      query: 'query Dashboard( $layerSlugs: [String!]! $nearbyViewLimit: Int! $isCamerasEnabled: Boolean! $showCameraCarousel: Boolean! $isLoggedIn: Boolean! $maxPriority: Int $showCommercialQuantities: Boolean! ) { dashboardQuery { collections(layerSlugs: $layerSlugs, maxPriority: $maxPriority) { uri title bbox color ... on Event { quantities @include(if: $showCommercialQuantities) { label value icon } description } } } }',
      variables: { layerSlugs:['weatherWarningsAreaEvents','winterDriving','roadReports','roadClosures','truckersReports','wazeReports','ROAD_CONDITIONS','constructionReports','floodReports'], maxPriority:5, nearbyViewLimit:1, isCamerasEnabled:false, showCameraCarousel:false, isLoggedIn:false, showCommercialQuantities:true }
    })
  }, // ✗ real endpoint+query confirmed, server-side result unconfirmed — see README
  // Missouri does NOT run IBI511 — traveler.modot.org is MoDOT's own custom
  // "TIM" (Traveler Information Map) system. Confirmed live via network
  // inspection: the map pulls a set of public, unauthenticated, pre-built
  // JSON files under /timconfig/feed/desktop/ — message.v2.json is the real
  // general events feed (Work Zones/Incidents/Flooding/Closures, ~1200
  // features), already plain WGS84 lon/lat in GEOM.x/y (no projection
  // needed). There's no dedicated weight-restriction layer/message-type code
  // (checked the site's own JS for a "restrict" reference — none found;
  // "BPRV1.json" turned out to mean Bypass Route, not restrictions), so
  // weight/width/height limits show up as free text inside WZ/CL message
  // HTML — goes through the normal BAN_KW keyword pass like Ohio/ND.
  { key:'mo', name:'Missouri MoDOT (TIM)', url:'https://traveler.modot.org/timconfig/feed/desktop/message.v2.json', parser:'modot' }, // ✓ verified working, no key
  // Illinois does NOT run IBI511 — gettingaroundillinois.com is IDOT's own
  // portal, and it links a dedicated "Obstructions and Restrictions" map
  // (under Commercial Maps) confirmed live via network inspection to be
  // backed by IDOT's own hosted ArcGIS Server: gis1.dot.illinois.gov/.../
  // GAI/ObstructionsRestrictions/MapServer/0 ("Closures and Oversize
  // Restrictions"). Its schema has real height-clearance fields (FT_Height/
  // TF_Height, in inches — confirmed against the human-readable Description,
  // e.g. FT_Height=169in matches "NB: 14-01" in the text) alongside WEIGHT/
  // WIDTH_INCHES/LENGTH_FEET fields, but those other numeric fields turned
  // out to use non-obvious sentinel values (1 and 10000000 both appear to
  // mean "no limit" depending on record) with no public documentation of the
  // convention, so rather than guess wrong, only the unambiguous overhead
  // clearance records (TYPE='O', a real height in inches) are surfaced here,
  // filtered to clearances under 14ft — the threshold that actually matters
  // for truck routing. WEIGHT/WIDTH restriction codes are left out rather
  // than risk misreading a sentinel as a real limit.
  { key:'il', name:'Illinois IDOT (Obstructions/Clearances)', url:"https://gis1.dot.illinois.gov/arcgis/rest/services/GAI/ObstructionsRestrictions/MapServer/0/query?f=json&outFields=TYPE,City,Route,Description,FT_Height,TF_Height,District&outSR=4326&where=TYPE%3D%27O%27+AND+(FT_Height+%3C+168+OR+TF_Height+%3C+168)", parser:'il_clearance' }, // ✓ verified working, no key
  // ── US South / Great Plains ───────────────────────────────────────────────────
  // Texas does NOT run IBI511 — drivetexas.org is a custom TxDOT app built on
  // Google Maps JS, confirmed live via network/JS-bundle inspection. Its
  // condition pins are NOT served from a plain public REST/GeoJSON endpoint
  // like most other states fixed in this file — the actual data backend is
  // MapLarge (a commercial GIS visualization vendor), hit via signed/token
  // endpoints (/Api/VerifyRequest, /Api/ProcessRequest, /Remote/
  // GetActiveTableID on *.maplarge.com). That's a locked-down proprietary
  // query protocol, not a URL that can be replayed with a tweak or a free
  // key, so — same as Wyoming/WSDOT — this is left as a known gap rather
  // than guessed at. See README.
  { key:'tx', name:'Texas DriveTexas', url:'https://www.drivetexas.org/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ✗ confirmed wrong platform — see comment above
  // Kansas does NOT run IBI511 — kandrive.org redirects to www.kandrive.gov,
  // a custom KDOT app on the same GraphQL vendor platform family as
  // Minnesota/Nebraska (POST /api/graphql, no key), but with a DIFFERENT
  // query shape than either of those: a "MapFeatures" query scoped to one
  // layerSlug at a time (not a combined "Dashboard" query). Confirmed live
  // via captured real browser request after enabling the "Commercial
  // Vehicles" layer toggle, which adds a dedicated oversizeLoads layer —
  // its features carry a `tooltip` string with the restriction spelled out
  // directly, e.g. "Oversize Load | Width: 13' 6", Length: 240' 0", Height:
  // 14' 6"", plus a `title` (road name) and a `bbox`/Point geometry for
  // location — no keyword guessing needed since the tooltip already states
  // the restriction explicitly. Unlike Minnesota/Nebraska's identical
  // "Dashboard" query getting blocked server-side, this replay succeeded
  // from the browser same-origin with only Content-Type/Accept headers (no
  // extra Origin/Referer needed) — worth testing whether that holds from
  // this Node server too; see README for the confirmed result.
  { key:'ks', name:'Kansas 511 (GraphQL)', url:'https://www.kandrive.gov/api/graphql', parser:'ks_mapfeatures',
    method:'POST', headers:{'Content-Type':'application/json', 'Accept':'application/json', 'Origin':'https://www.kandrive.gov', 'Referer':'https://www.kandrive.gov/'},
    body: JSON.stringify({
      query: 'query MapFeatures($input: MapFeaturesArgs!, $plowType: String) { mapFeaturesQuery(input: $input) { mapFeatures { bbox title tooltip uri features { id geometry properties type } } error { message type } } }',
      variables: { input: { north:40.10, south:36.10, east:-94.30, west:-102.20, zoom:7, layerSlugs:['oversizeLoads'], nonClusterableUris:['dashboard'] }, plowType:'plowCameras' }
    })
  }, // ✗ real endpoint+query confirmed, server-side result unconfirmed — see README
  // Colorado does NOT run IBI511 either, despite the old assumed URL/key —
  // cotrip.org is on the SAME GraphQL "MapFeatures" vendor platform as
  // Kansas (POST /api/graphql, no key). Confirmed live via network
  // inspection + toggling the site's "Trucker Mode" layer, which reveals a
  // layer literally named `restrictions` (not bundled into a general
  // events feed like most other states — CDOT scopes this one specifically
  // to truck restrictions). Captured request replayed same-origin returned
  // 59 real active restriction events statewide, e.g. title "US 385 in
  // both directions: Width limit in effect." with tooltip HTML containing
  // `<b class="trucker-restriction">Width limit 12'0".</b>` — explicit
  // dimension text, no keyword guessing needed. This is the richest/most
  // direct restriction feed found in this whole project. Location uses the
  // first Point-type feature's coordinates (falls back to bbox center).
  { key:'co', name:'Colorado COTRIP (GraphQL)', url:'https://www.cotrip.org/api/graphql', parser:'co_mapfeatures',
    method:'POST', headers:{'Content-Type':'application/json', 'Accept':'application/json', 'Origin':'https://www.cotrip.org', 'Referer':'https://www.cotrip.org/'},
    body: JSON.stringify({
      query: 'query MapFeatures($input: MapFeaturesArgs!, $plowType: String) { mapFeaturesQuery(input: $input) { mapFeatures { bbox title tooltip uri features { id geometry properties type } } error { message type } } }',
      variables: { input: { north:41.10, south:36.90, east:-101.90, west:-109.10, zoom:7, layerSlugs:['restrictions'], nonClusterableUris:['404'] }, plowType:'plowCameras' }
    })
  }, // ✗ real endpoint+query confirmed, server-side result unconfirmed — see README
  { key:'ut', name:'Utah UDOT',        url:'https://prod-ut.ibi511.com/api/v2/get/event?format=json&lang=en', parser:'ibi511', keyEnv:'BAN_KEY_UT' }, // domain corrected: udottraffic.utah.gov -> prod-ut.ibi511.com; confirmed: requires key
  // ── US East ───────────────────────────────────────────────────────────────────
  // Pennsylvania does NOT run IBI511 either, despite the old assumed URL/key
  // — 511pa.com is PennDOT's own custom .NET app (confirmed live: bundles/,
  // Scripts/, cms/getfile paths, not IBI511's shape). It has an unusually
  // rich, dedicated commercial-vehicle-restriction system (Tiers 1-4 by
  // vehicle/trailer type, "Chains Required", "Speed Restrictions" — see the
  // site's own "Vehicle Restrictions" nav menu). The map layer itself
  // (/map/mapIcons/TruckRestrictions etc.) only returns bare {itemId,
  // location} points with no description — but the "Vehicle Restrictions
  // List" page uses a plain GET DataTables endpoint,
  // /List/GetData/AllRestrictionEventsList, with a JSON `query` string
  // param specifying named columns (restrictionTier, restrictionDescription,
  // roadwayName, startDate, turnpikeOnly) — no key, no POST, just a GET with
  // a URL-encoded query object. Confirmed live via network inspection of
  // that list page; response envelope is DataTables-standard
  // {draw,recordsTotal,recordsFiltered,data:[]} — currently empty (a quiet
  // day, no active weather-triggered restrictions), so the exact populated
  // row shape is inferred from the column names rather than seen directly.
  // No lat/lon in this feed (it's roadway-name text, not geometry), so like
  // Michigan's scraped bulletin, a representative statewide point is used.
  { key:'pa', name:'Pennsylvania 511 (Restrictions List)', url:'https://www.511pa.com/List/GetData/AllRestrictionEventsList?query=' + encodeURIComponent(JSON.stringify({columns:[{data:null,name:''},{name:'restrictionTier'},{name:'restrictionDescription'},{name:'roadwayName'},{name:'startDate'},{data:5,name:''},{name:'turnpikeOnly'}],order:[{column:4,dir:'asc'},{column:3,dir:'asc'}],start:0,length:100,search:{value:''}})) + '&lang=en', parser:'pa_restrictionlist' }, // ✓ endpoint confirmed live (currently 0 active rows) — see README
  { key:'ny', name:'NY DOT CommVehicle', url:'https://gis.dot.ny.gov/hostingny/rest/services/CommVehicleDataFeed/MapServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=500', parser:'arcgis' }, // ✓ verified working, ArcGIS, no key
];
const BAN_KW = ['weight restriction','load restriction','spring ban','frost law','seasonal',
  'overweight','weight limit','road ban','axle weight','weight reduced','load limit',
  'spring thaw','spring weight','posting','lhv','long combination'];

// Michigan's dev-API domain (michigan511.org) is dead and no ibi511-style
// replacement was found (see the commented-out 'mi' BAN_FEEDS entry above).
// MDOT does publish its Spring Weight Restriction Bulletins on a plain public
// HTML page that needs no key, so this scrapes that page directly as a
// stand-in. It's more fragile than the JSON feeds above — it depends on
// MDOT's page markup not changing — and it only covers the single current
// statewide bulletin, not point-level events: the bulletins describe
// route-based boundaries ("north of the US-2 and M-134 line"), not lat/lon
// points, so it's surfaced as one marker at a representative Michigan
// location with the full bulletin text in the description rather than
// pretending to know exactly which segment is restricted.
async function scrapeMichiganWeightBulletin() {
  const url = 'https://mdotjboss.state.mi.us/APSWB/SWBHome.htm?bulletin=weight';
  const html = await serverFetch(url, { timeout: 12000 });
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();

  // Each bulletin renders as: "Title: Spring Weight Restriction Bulletin #N
  // Date: MM/DD/YYYY <body text...> Return to Top" — extract every block,
  // then keep only the highest-numbered one (the current standing order;
  // older bulletins in the page are superseded history).
  const re = /Title:\s*Spring Weight Restriction Bulletin\s*#\s*(\d+)\s*Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*([\s\S]*?)(?=Title:\s*Spring Weight Restriction Bulletin|Return to Top)/gi;
  const bulletins = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    bulletins.push({ num: parseInt(m[1], 10), date: m[2], body: m[3].trim() });
  }
  if (!bulletins.length) throw new Error('No bulletins found — page structure may have changed');
  const latest = bulletins.reduce(function(a, b) { return b.num > a.num ? b : a; });
  return {
    headline: 'Michigan Spring Weight Restriction Bulletin #' + latest.num + ' (' + latest.date + ')',
    desc: latest.body
  };
}

// TomTom gives live traffic incidents/roadwork/closures for all of North
// America with a single API key — useful, but its categories don't include
// the seasonal weight-restriction/frost-law postings that are the actual
// reason the state DOT feeds below exist for a trucking app (confirmed via
// TomTom's own incident-category docs: Accident/RoadWorks/JamLane/Closure —
// no weight-posting category). So this is fetched as a SUPPLEMENT merged
// alongside the state feeds in fetchBansLayer(), not a replacement for them.
async function fetchTomTomBans(bounds) {
  if (!process.env.TOMTOM_API_KEY) return { items: [], feedStatus: {} };

  const qBounds = bounds || { s: 24.0, w: -125.0, n: 49.0, e: -66.0 };
  const ck = 'bans_tomtom_v5_' + qBounds.s.toFixed(2) + '_' + qBounds.w.toFixed(2) + '_' + qBounds.n.toFixed(2) + '_' + qBounds.e.toFixed(2);
  const cached = cacheGet(ck);
  if (cached) return cached;

  const minLon = qBounds.w;
  const minLat = qBounds.s;
  const maxLon = qBounds.e;
  const maxLat = qBounds.n;
  // Traffic API v5 rejects bounding boxes larger than 10,000 km2. Wide map
  // views still receive the state/province feeds; TomTom activates as the
  // driver zooms into a local area where its incident detail is useful.
  const midLatRadians = ((minLat + maxLat) / 2) * Math.PI / 180;
  const widthKm = Math.abs(maxLon - minLon) * 111.32 * Math.cos(midLatRadians);
  const heightKm = Math.abs(maxLat - minLat) * 110.574;
  if (widthKm * heightKm > 9500) {
    return {
      items: [],
      feedStatus: {
        tomtom: { name: 'TomTom Live Traffic', bans: [], status: 'ok',
          note: 'Zoom in to load local TomTom incidents' }
      }
    };
  }
  const params = new URLSearchParams({
    key: process.env.TOMTOM_API_KEY,
    bbox: [minLon, minLat, maxLon, maxLat].join(','),
    fields: '{incidents{type,geometry{type,coordinates},properties{iconCategory,events{description},from,to,roadNumbers}}}',
    language: 'en-US',
    timeValidityFilter: 'present'
  });
  const url = 'https://api.tomtom.com/traffic/services/5/incidentDetails?' + params.toString();

  try {
    console.log('  Fetching supplemental bans from TomTom Traffic API v5...');
    const text = await serverFetch(url, { timeout: 15000 });
    const data = JSON.parse(text);
    const incidents = Array.isArray(data.incidents) ? data.incidents : [];

    const items = incidents.map(function(incident, idx) {
      const props = incident.properties || {};
      const geometry = incident.geometry || {};
      const coordinates = geometry.type === 'Point'
        ? geometry.coordinates
        : (Array.isArray(geometry.coordinates) ? geometry.coordinates[0] : null);
      if (!Array.isArray(coordinates) || !Number.isFinite(Number(coordinates[0])) ||
          !Number.isFinite(Number(coordinates[1]))) return null;
      const descriptions = (props.events || []).map(function(event) {
        return event && event.description;
      }).filter(Boolean);
      const iconCategory = Number(props.iconCategory);
      const title = iconCategory === 8 ? 'Road Closed' :
        (iconCategory === 9 ? 'Roadwork' : (descriptions[0] || 'Traffic Event'));
      return {
        id: 'bans_tomtom_' + (props.id || idx),
        type: 'bans',
        lat: Number(coordinates[1]),
        lon: Number(coordinates[0]),
        title: title,
        icon: 'ban',
        color: '#E05252',
        source: 'TomTom Live Traffic',
        updatedAt: new Date().toISOString(),
        props: {
          description: descriptions.join('; ') || title,
          road: (props.roadNumbers || []).join(', ') || props.from || props.to || 'Roadway',
          area: 'TomTom',
          feedKey: 'tomtom',
          feedName: 'TomTom Live Traffic'
        }
      };
    }).filter(Boolean);

    const res = {
      items: items,
      feedStatus: {
        tomtom: { name: 'TomTom Live Traffic', bans: items, status: 'ok' }
      }
    };
    cacheSet(ck, res, 5 * 60 * 1000); // cache TomTom for 5m
    return res;
  } catch (e) {
    console.warn('  ERR TomTom Traffic Incidents API:', e.message);
    return {
      items: [],
      feedStatus: {
        tomtom: { name: 'TomTom Live Traffic', bans: [], status: 'error', err: e.message }
      }
    };
  }
}

async function fetchStateBanFeeds() {
  const ck = 'bans_all';
  const cached = cacheGet(ck);
  if (cached) return cached;
  const feedResults = {};
  await Promise.allSettled(BAN_FEEDS.map(async function(feed) {
    try {
      // Some IBI511-platform feeds require a free registered developer key
      // (confirmed for at least ID/WI/NY/UT — see README). If the matching
      // env var is set, append it; feeds with no keyEnv or an unset var are
      // requested exactly as before. Most of these platforms use `key` as the
      // param name, but not all (OHGO uses `api-key`) — feed.keyParam lets a
      // feed override that. Also handles the URL not already having a `?`
      // (OHGO's base construction URL has no query string at all, so a hardcoded
      // `&key=` would have produced an invalid `...construction&key=...` URL).
      const withKey = function(u) {
        if (!feed.keyEnv || !process.env[feed.keyEnv]) return u;
        const param = feed.keyParam || 'key';
        const sep = u.indexOf('?') === -1 ? '?' : '&';
        return u + sep + param + '=' + encodeURIComponent(process.env[feed.keyEnv]);
      };
      // A feed's url can be an array (e.g. North Dakota's load restrictions are
      // split across separate NE/SW ArcGIS layers with no single combined
      // endpoint) — fetch each and merge their `.features` before parsing.
      let data;
      if (Array.isArray(feed.url)) {
        const bodies = await Promise.all(feed.url.map(function(u) { return serverFetch(withKey(u), { timeout:12000 }); }));
        data = { features: [] };
        bodies.forEach(function(text) {
          if (!text.trim() || text.trim()[0]==='<') return;
          const d = JSON.parse(text);
          data.features.push.apply(data.features, d.features||[]);
        });
      } else {
        // A handful of state platforms (Minnesota's GraphQL API) need a POST
        // with a JSON body rather than a plain GET — feed.method/body/headers
        // pass straight through to serverFetch, which already supports both.
        const text = await serverFetch(withKey(feed.url), { timeout:12000, method:feed.method, body:feed.body, headers:feed.headers });
        if (!text.trim() || text.trim()[0]==='<') throw new Error('Non-JSON');
        data = JSON.parse(text);
      }
      const evts = feed.parser==='open511'
        ? (data.events||[]).map(function(e) { return {
            headline:e.headline||'', desc:e.description||'', type:e.event_type||'',
            road:(e.roads&&e.roads[0]&&e.roads[0].name)||'', area:(e.areas&&e.areas[0]&&e.areas[0].name)||'',
            lat:e.geography&&e.geography.coordinates&&e.geography.coordinates[1]||null,
            lon:e.geography&&e.geography.coordinates&&e.geography.coordinates[0]||null }; })
        : feed.parser==='arcgis'
        // NY DOT ArcGIS CommVehicleDataFeed — returns {features:[{attributes:{},geometry:{x,y}}]}
        ? (data.features||[]).map(function(f) { const a=f.attributes||{},g=f.geometry||{}; return {
            headline:a.RESTRICTION_TYPE||a.EVENT_TYPE||a.TYPE||'',
            desc:a.DESCRIPTION||a.RESTRICTION_DESC||a.COMMENT||'',
            type:a.RESTRICTION_TYPE||a.EVENT_TYPE||'restriction',
            road:a.ROUTE||a.ROAD_NAME||a.LOCATION||'', area:a.COUNTY||a.REGION||'NY',
            lat:g.y||a.LATITUDE||null, lon:g.x||a.LONGITUDE||null }; })
        : feed.parser==='iteris'
        // Iteris ATIS platform (Montana, South Dakota confirmed) — plain GeoJSON
        // FeatureCollection, coordinates come back as strings so they need parseFloat.
        // This URL is already the restrictions-only endpoint (not a general event
        // feed), so every feature here is a ban already — no BAN_KW filtering needed.
        ? (data.features||[]).map(function(f) { const p=f.properties||{},g=f.geometry||{},c=g.coordinates||[]; return {
            headline:p.headline||p.label||'Restriction', desc:p.report||p.enhanced_report||'',
            type:'weight restriction', road:p.route||p.location_description||'', area:feed.key.toUpperCase(),
            lat:c[1]!=null?parseFloat(c[1]):null, lon:c[0]!=null?parseFloat(c[0]):null,
            _skipKwFilter:true }; })
        : feed.parser==='mn_graphql'
        // Minnesota's custom GraphQL API (confirmed live, no key). Response is
        // the standard GraphQL envelope {data:{mapFeaturesQuery:{mapFeatures}}}.
        // Each mapFeature is one restriction event with a title/tooltip and a
        // features[] array mixing a Point (the marker) with a LineString (the
        // affected road segment) — we want the Point for lat/lon, falling back
        // to the bbox center if a feature set has no Point for some reason.
        // The layerSlugs:['truckersReports'] filter in the request already
        // scopes this to weight/width/height/axle restrictions, so (like
        // Montana/SD/ND) no BAN_KW filtering is needed here.
        ? (function() {
            if (data.errors) throw new Error('GraphQL: ' + (data.errors[0] && data.errors[0].message || 'error'));
            const mf = (data.data && data.data.mapFeaturesQuery && data.data.mapFeaturesQuery.mapFeatures) || [];
            return mf.map(function(m) {
              const pointFeat = (m.features||[]).find(function(f) { return f.geometry && f.geometry.type === 'Point'; });
              const bbox = m.bbox || [];
              const lon = pointFeat ? pointFeat.geometry.coordinates[0] : (bbox[0]!=null && bbox[2]!=null ? (bbox[0]+bbox[2])/2 : null);
              const lat = pointFeat ? pointFeat.geometry.coordinates[1] : (bbox[1]!=null && bbox[3]!=null ? (bbox[1]+bbox[3])/2 : null);
              return {
                headline: m.title || 'Restriction',
                desc: (m.tooltip || '').replace(/<[^>]+>/g, ''),
                type: 'weight restriction', road: m.title || '', area: 'MN',
                lat: lat, lon: lon, _skipKwFilter: true
              };
            });
          })()
        : feed.parser==='ne_graphql'
        // Nebraska's Castle Rock GraphQL API — statewide "Dashboard" query,
        // envelope {data:{dashboardQuery:{collections}}}. Only events that
        // carry a `quantities` entry (Width/Weight/Height Restriction) are
        // kept — that's what makes this restriction-specific instead of the
        // full 200+ item general event list, so no BAN_KW filtering needed
        // on top. No point geometry is returned, only a bbox, so lat/lon is
        // the bbox center.
        ? (function() {
            if (data.errors) throw new Error('GraphQL: ' + (data.errors[0] && data.errors[0].message || 'error'));
            const cols = (data.data && data.data.dashboardQuery && data.data.dashboardQuery.collections) || [];
            return cols.filter(function(c) { return c.quantities && c.quantities.length; }).map(function(c) {
              const bbox = c.bbox || [];
              const lon = bbox[0]!=null && bbox[2]!=null ? (bbox[0]+bbox[2])/2 : null;
              const lat = bbox[1]!=null && bbox[3]!=null ? (bbox[1]+bbox[3])/2 : null;
              const qtext = c.quantities.map(function(q) { return q.label+': '+q.value; }).join(', ');
              return {
                headline: c.title || 'Restriction',
                desc: qtext + (c.description ? ' — '+c.description : ''),
                type: 'weight restriction', road: c.title || '', area: 'NE',
                lat: lat, lon: lon, _skipKwFilter: true
              };
            });
          })()
        : feed.parser==='ks_mapfeatures'
        // Kansas's KanDrive GraphQL API — single-layer "MapFeatures" query
        // scoped to oversizeLoads, envelope {data:{mapFeaturesQuery:{mapFeatures}}}.
        // Every entry here IS an oversize-load restriction by construction
        // (that's the only layerSlug requested), and the `tooltip` already
        // spells out Width/Length/Height in plain text — no BAN_KW filtering
        // needed. Location comes from bbox[0]/bbox[1] (a point when the
        // feature is a single location, which oversize-load pins always are).
        ? (function() {
            if (data.errors) throw new Error('GraphQL: ' + (data.errors[0] && data.errors[0].message || 'error'));
            const mf = (data.data && data.data.mapFeaturesQuery && data.data.mapFeaturesQuery.mapFeatures) || [];
            return mf.map(function(m) {
              const bbox = m.bbox || [];
              return {
                headline: m.title || 'Oversize Load',
                desc: (m.tooltip || '').replace(/<[^>]+>/g, ''),
                type: 'weight restriction', road: m.title || '', area: 'KS',
                lat: bbox[1]!=null ? bbox[1] : null, lon: bbox[0]!=null ? bbox[0] : null,
                _skipKwFilter: true
              };
            });
          })()
        : feed.parser==='co_mapfeatures'
        // Colorado's COtrip GraphQL API — single-layer "MapFeatures" query
        // scoped to `restrictions` (CDOT's own dedicated truck-restriction
        // layer, not a general event feed), envelope
        // {data:{mapFeaturesQuery:{mapFeatures}}}. Every entry is a
        // restriction by construction; `tooltip` is HTML with the limit
        // spelled out in a `trucker-restriction`-classed tag, so this is
        // kept as raw-ish text (tags stripped) rather than re-parsed.
        // Location: first Point-type feature's coordinates, falling back
        // to the bbox center for line/area-only events.
        ? (function() {
            if (data.errors) throw new Error('GraphQL: ' + (data.errors[0] && data.errors[0].message || 'error'));
            const mf = (data.data && data.data.mapFeaturesQuery && data.data.mapFeaturesQuery.mapFeatures) || [];
            return mf.map(function(m) {
              const bbox = m.bbox || [];
              const pt = (m.features||[]).find(function(f) { return f.geometry && f.geometry.type==='Point' && Array.isArray(f.geometry.coordinates); });
              const lon = pt ? pt.geometry.coordinates[0] : (bbox[0]!=null && bbox[2]!=null ? (bbox[0]+bbox[2])/2 : null);
              const lat = pt ? pt.geometry.coordinates[1] : (bbox[1]!=null && bbox[3]!=null ? (bbox[1]+bbox[3])/2 : null);
              return {
                headline: m.title || 'Restriction',
                desc: (m.tooltip || '').replace(/<[^>]+>/g, ''),
                type: 'weight restriction', road: m.title || '', area: 'CO',
                lat: lat, lon: lon, _skipKwFilter: true
              };
            });
          })()
        : feed.parser==='pa_restrictionlist'
        // Pennsylvania's 511PA "Vehicle Restrictions List" — plain GET
        // DataTables JSON, envelope {draw,recordsTotal,recordsFiltered,data:[]}.
        // Every row here IS a restriction by construction (that's the whole
        // point of this list), so no BAN_KW filtering needed. No geometry is
        // provided — this is a text/roadway-name feed, not point data — so a
        // representative statewide point (near Bellefonte, PA's geographic
        // center) is used, matching the same approach as Michigan's scraped
        // bulletin, which also lacks point-level geometry.
        ? (data.data||[]).map(function(r) {
            const tier = r.restrictionTier ? ('Tier '+r.restrictionTier+': ') : '';
            return {
              headline: tier + (r.restrictionDescription || 'Vehicle Restriction') + (r.roadwayName ? (' — '+r.roadwayName) : ''),
              desc: (r.restrictionDescription || '') + (r.startDate ? (' (since '+r.startDate+')') : ''),
              type: 'weight restriction', road: r.roadwayName || '', area: 'PA',
              lat: 40.9699, lon: -77.7278, _skipKwFilter: true
            };
          })
        : feed.parser==='ohgo'
        // OHGO Public API (Ohio) — {results:[{id,latitude,longitude,location,
        // description,category,routeName,status,...}]}, confirmed via its own
        // Swagger schema. Construction is a general "active work" feed (not
        // restrictions-only), so this does NOT set _skipKwFilter — the normal
        // BAN_KW pass below is what picks out actual weight-restriction entries.
        ? (data.results||[]).map(function(r) { return {
            headline:(r.status||'')+ (r.category?(' - '+r.category):''), desc:r.description||'',
            type:r.category||'construction', road:r.routeName||r.location||'', area:'OH',
            lat:r.latitude!=null?r.latitude:null, lon:r.longitude!=null?r.longitude:null }; })
        : feed.parser==='cars511'
        // "CARS" 511 platform (confirmed for Iowa; several neighboring
        // Midwest/Plains states' 511 sites are built by the same vendor and
        // may share this schema — worth trying first if one of those turns
        // out not to be IBI511 either). Hosted ArcGIS Online FeatureServer,
        // f=json&outSR=4326 returns plain WGS84 lon/lat in geometry.x/y
        // directly, no Web Mercator conversion needed.
        ? (data.features||[]).map(function(f) { const a=f.attributes||{}, g=f.geometry||{}; return {
            headline:a.headline||a.phrase||'', desc:(a.msg0||'')+' '+(a.cause||'')+' '+(a.Restrict_||''),
            type:a.STYLE||'event', road:a.Route||a.AltRoute||'', area:feed.key.toUpperCase(),
            lat:g.y!=null?g.y:null, lon:g.x!=null?g.x:null }; })
        : feed.parser==='il_clearance'
        // IDOT's ObstructionsRestrictions/MapServer/0 — the where clause
        // already filters to overhead obstructions under 14ft, so every
        // feature here is a real low-clearance restriction; no BAN_KW
        // filtering needed. Heights are in inches; converted to ft'in for
        // the headline.
        ? (data.features||[]).map(function(f) { const a=f.attributes||{}, g=f.geometry||{};
            const h = Math.min(a.FT_Height||9999, a.TF_Height||9999);
            const ftin = h<9999 ? Math.floor(h/12)+"'"+(h%12)+'"' : '';
            return {
            headline:'Low Clearance'+(ftin?': '+ftin:'')+(a.Route?' ('+a.Route+')':''),
            desc:a.Description||'', type:'height restriction',
            road:a.Route||a.City||'', area:'IL',
            lat:g.y!=null?g.y:null, lon:g.x!=null?g.x:null,
            _skipKwFilter:true }; })
        : feed.parser==='modot'
        // MoDOT's TIM feed — plain array of {MT,MST,LOI,GEOM:{x,y},MSG,MSGS},
        // GEOM already WGS84 (no conversion needed). General events feed
        // (work zones/incidents/flooding/closures), not restrictions-only,
        // so this goes through the normal BAN_KW pass — weight/width/height
        // limit text lives inside the MSG HTML on relevant closures.
        ? (Array.isArray(data)?data:[]).map(function(m) { const g=m.GEOM||{};
            const msgText=(m.MSG||m.MSGS||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); return {
            headline:(m.MST||m.MT||'Event')+': '+msgText.slice(0,80),
            desc:msgText, type:m.MT||'event', road:'', area:'MO',
            lat:g.y!=null?g.y:null, lon:g.x!=null?g.x:null }; })
        : feed.parser==='or_trucking'
        // Oregon TripCheck's RWTrucking.js — a static-looking but live Esri
        // FeatureSet JSON, geometryType esriGeometryPoint, spatialReference
        // wkid 3857 (Web Mercator), so x/y need converting to lon/lat
        // (unlike ND's ArcGIS query above, this file has no outSR param to
        // ask for — it's a pre-exported file, not a live query string).
        // commercialRestrictionDesc/furtherText are ODOT's own restriction
        // text, already scoped to commercial-vehicle postings specifically,
        // so no BAN_KW filtering is needed here either.
        ? (data.features||[]).map(function(f) { const a=f.attributes||{}, g=f.geometry||{};
            const lon = g.x!=null ? g.x*180/20037508.34 : null;
            const lat = g.y!=null ? (Math.atan(Math.exp(g.y*Math.PI/20037508.34))*360/Math.PI-90) : null;
            return {
            headline:a.commercialRestrictionDesc||'Commercial Vehicle Restriction',
            desc:a.furtherText||'', type:'weight restriction',
            road:a.linkName||a.linkId||'', area:'OR',
            lat:lat, lon:lon, _skipKwFilter:true }; })
        : feed.parser==='nd_arcgis'
        // North Dakota does not run IBI511 or Iteris ATIS — the real map app
        // (travel.dot.nd.gov) is a custom React app backed by ArcGIS MapServer
        // layers. Load restrictions are line geometry (paths), not points, split
        // across separate NE/SW layer IDs (23/24) with an InEffect Y/N flag —
        // the query URLs already filter to InEffect='Y' server-side, so every
        // feature here is a currently-active ban. outSR=4326 makes ArcGIS return
        // WGS84 lon/lat directly instead of the service's native Web Mercator.
        ? (data.features||[]).map(function(f) { const a=f.attributes||{}, paths=(f.geometry&&f.geometry.paths)||[[]];
            const pt = paths[0][Math.floor(paths[0].length/2)] || paths[0][0] || []; return {
            headline:'Load Restriction: '+(a.Restriction_Code_Desc||'Restricted'),
            desc:(a.PublicFrom&&a.PublicTo?a.PublicFrom+' to '+a.PublicTo+'. ':'')+(a.LR_Order_Message||''),
            type:'weight restriction', road:a.HwyDesc||'', area:feed.key.toUpperCase(),
            lat:pt[1]!=null?pt[1]:null, lon:pt[0]!=null?pt[0]:null,
            _skipKwFilter:true }; })
        : (data.Events||data.events||data||[]).map(function(e) { return {
            headline:e.EventType||e.Headline||e.headline||'',
            desc:e.Description||e.description||'', type:e.EventType||e.event_type||'',
            road:e.RoadwayName||e.road||'', area:e.County||e.City||e.area||'',
            lat:e.Latitude!=null?e.Latitude:(e.lat||null), lon:e.Longitude!=null?e.Longitude:(e.lon||null) }; });
      const bans = evts.filter(function(e) {
        if (e._skipKwFilter) return true;
        const t = ((e.headline||'')+' '+(e.desc||'')+' '+(e.type||'')).toLowerCase();
        return BAN_KW.some(function(k){ return t.includes(k); });
      });
      feedResults[feed.key] = { name:feed.name, bans:bans, status:'ok' };
      console.log('  OK ' + feed.name + ': ' + bans.length + ' bans');
    } catch(e) {
      feedResults[feed.key] = { name:feed.name, bans:[], status:'error', err:e.message };
      console.warn('  ERR ' + feed.name + ': ' + e.message);
    }
  }));

  // Michigan has no working dev-API feed (see comments above), so fall back to
  // scraping MDOT's public bulletin page directly. Wrapped the same way as
  // every other feed above: a failure here just shows as one more ERROR row,
  // it doesn't break the rest of the ban layer.
  try {
    const mi = await scrapeMichiganWeightBulletin();
    feedResults['mi'] = {
      name: 'Michigan MDOT (scraped bulletin)',
      status: 'ok',
      bans: [{
        headline: mi.headline, desc: mi.desc, type: 'weight restriction',
        road: 'Statewide - see description for affected routes', area: 'MI',
        lat: 44.3148, lon: -85.6024 // representative statewide point; bulletins describe route boundaries, not a single spot
      }]
    };
    console.log('  OK Michigan MDOT (scraped): ' + mi.headline);
  } catch (e) {
    feedResults['mi'] = { name: 'Michigan MDOT (scraped bulletin)', bans: [], status: 'error', err: e.message };
    console.warn('  ERR Michigan MDOT (scraped): ' + e.message);
  }

  const items = [];
  Object.keys(feedResults).forEach(function(key) {
    const r = feedResults[key];
    r.bans.forEach(function(b, i) {
      items.push({ id:'bans_'+key+'_'+i, type:'bans', lat:b.lat, lon:b.lon,
        title:b.headline||b.type||'Restriction', icon:'ban', color:'#E05252',
        source:r.name, updatedAt:new Date().toISOString(),
        props:{ description:b.desc, road:b.road, area:b.area, feedKey:key, feedName:r.name }});
    });
  });
  const result = { items:items, feedStatus:feedResults };
  cacheSet(ck, result, 5*60*1000);
  return result;
}

async function fetchBansLayer(bounds) {
  // Run the state DOT/511 feeds and the optional TomTom supplement in
  // parallel, then merge — TomTom no longer replaces the state feeds (see
  // fetchTomTomBans comment for why: it covers different data).
  const results = await Promise.all([
    fetchStateBanFeeds(),
    fetchTomTomBans(bounds)
  ]);
  const stateResult = results[0];
  const tomtomResult = results[1];
  // fetchStateBanFeeds() fetches and caches every state/province feed
  // nationwide (it has no concept of the caller's viewport) — filter down to
  // the requested bounds here, same as fetchCamerasLayer does, so a small-area
  // request doesn't ship hundreds of out-of-region bans to the client. When
  // bounds is omitted (e.g. the route-audit caller, which does its own
  // corridor-specific filtering) the full nationwide set still passes through.
  const stateItems = bounds
    ? stateResult.items.filter(function(b){ return b.lat!=null && b.lon!=null && b.lat>=bounds.s && b.lat<=bounds.n && b.lon>=bounds.w && b.lon<=bounds.e; })
    : stateResult.items;
  return {
    items: stateItems.concat(tomtomResult.items),
    feedStatus: Object.assign({}, stateResult.feedStatus, tomtomResult.feedStatus)
  };
}

// DOT Cameras
const DOT_CAMERA_FEEDS = [
  { key:'bc', name:'BC DriveBC',     url:'https://api.open511.gov.bc.ca/cameras?format=json&limit=500', parser:'open511cam' },
  { key:'ab', name:'Alberta 511',    url:'https://511.alberta.ca/api/v2/get/camera?format=json', parser:'ibi511cam' },
  { key:'id', name:'Idaho 511',      url:'https://511.idaho.gov/api/v2/get/camera?format=json', parser:'ibi511cam' },
  { key:'mt', name:'Montana DOT',    url:'https://511.mt.gov/api/v2/get/camera?format=json', parser:'ibi511cam' },
  { key:'wa', name:'Washington DOT', url:'https://511wa.gov/api/v2/get/camera?format=json', parser:'ibi511cam' },
];

async function fetchCamerasLayer(bounds) {
  const ck = 'cameras_'+(bounds?bounds.s.toFixed(1)+'_'+bounds.n.toFixed(1):'all');
  const cached = cacheGet(ck);
  if (cached) return cached;
  const items = [];
  await Promise.allSettled(DOT_CAMERA_FEEDS.map(async function(feed) {
    try {
      const text = await serverFetch(feed.url, { timeout:10000 });
      if (!text.trim() || text.trim()[0]==='<') return;
      const data = JSON.parse(text);
      let cams = [];
      if (feed.parser === 'open511cam') {
        cams = (data.cameras||[]).map(function(c) {
          const coords = c.geography && c.geography.coordinates;
          return { lat:coords&&coords[1], lon:coords&&coords[0], title:c.name||'Camera',
            imageUrl:(c.links&&c.links.find(function(l){return l.rel==='related';})&&c.links.find(function(l){return l.rel==='related';}).href)||'' };
        });
      } else {
        cams = (data.Cameras||data.cameras||data||[]).map(function(c) { return {
          lat:c.Latitude!=null?c.Latitude:(c.lat||null), lon:c.Longitude!=null?c.Longitude:(c.lon||null),
          title:c.RoadwayName||c.Title||c.name||'Camera',
          imageUrl:(c.Views&&c.Views[0]&&c.Views[0].Url)||c.imageUrl||'' }; });
      }
      cams.filter(function(c){return c.lat&&c.lon;}).forEach(function(c,i) {
        if (bounds && (c.lat<bounds.s||c.lat>bounds.n||c.lon<bounds.w||c.lon>bounds.e)) return;
        items.push({ id:'cam_'+feed.key+'_'+i, type:'cameras', lat:c.lat, lon:c.lon,
          title:c.title, icon:'camera', color:'#607D8B', source:feed.name,
          updatedAt:new Date().toISOString(), props:{ imageUrl:c.imageUrl }});
      });
      console.log('  OK ' + feed.name + ' cameras: ' + cams.length);
    } catch(e) { console.warn('  ERR ' + feed.name + ' cameras: ' + e.message); }
  }));
  cacheSet(ck, items, 10*60*1000);
  return items;
}

// Normalize restriction way
function normalizeRestriction(el) {
  const lat = el.lat||(el.center&&el.center.lat);
  const lon = el.lon||(el.center&&el.center.lon);
  if (!lat||!lon) return null;
  const tags = el.tags||{};
  const lines = [];
  if (tags.maxheight) lines.push('Max height: '+tags.maxheight+'m');
  if (tags.maxweight) lines.push('Max weight: '+tags.maxweight+'t');
  if (tags.maxwidth)  lines.push('Max width: '+tags.maxwidth+'m');
  if (tags.hgv==='no') lines.push('No HGV / trucks');
  if (!lines.length) return null;
  return { id:'restrict_'+el.id, type:'restrict', lat:lat, lon:lon,
    title:lines[0], icon:'restrict', color:'#C0392B', source:'OpenStreetMap',
    updatedAt:new Date().toISOString(), props:{ lines:lines }};
}

// /api/layers
async function handleLayers(req, res, query) {
  const allowedTypes = new Set(['stops','cardlock','rest','weigh','repair','bans','ev','border','cameras','restrict']);
  const types = (query.types||'').split(',').filter(Boolean);
  if (!types.length || types.length > 6 || types.some(function(type){ return !allowedTypes.has(type); }))
    return respond(res, 400, { error: 'Invalid layer types' });
  const bboxStr = query.bbox||'';
  let bounds = null;
  if (bboxStr) {
    const p = bboxStr.split(',').map(Number);
    if (p.length !== 4 || p.some(function(v){ return !Number.isFinite(v); }) ||
        p[0] < -90 || p[2] > 90 || p[1] < -180 || p[3] > 180 ||
        p[0] >= p[2] || p[1] >= p[3] || p[2]-p[0] > 12 || p[3]-p[1] > 20)
      return respond(res, 400, { error: 'Invalid or oversized bbox' });
    bounds = { s:p[0], w:p[1], n:p[2], e:p[3] };
  }
  const layers = {};
  await Promise.allSettled(types.map(async function(type) {
    if (type==='bans') {
      const r = await fetchBansLayer(bounds);
      layers.bans = r.items;
      layers._banFeedStatus = r.feedStatus;
      return;
    }
    if (type==='cameras') { layers.cameras = await fetchCamerasLayer(bounds); return; }
    if (!OVERPASS_QUERIES[type]||!bounds) { layers[type]=[]; return; }
    if (type==='restrict') {
      const ck = 'restrict_'+bboxStr;
      const cached = cacheGet(ck);
      if (cached) { layers.restrict=cached; return; }
      const bbox = bounds.s+','+bounds.w+','+bounds.n+','+bounds.e;
      const q = '[out:json][timeout:20];(way["maxheight"]('+bbox+');way["maxweight"]('+bbox+');way["hgv"="no"]('+bbox+'););out center tags;';
      const data = await overpassFetch(q);
      const items = (data.elements||[]).map(normalizeRestriction).filter(Boolean);
      // Don't cache an empty result for the full 30m — Overpass's public
      // mirrors fail/timeout often enough that an empty result is much more
      // likely to mean "Overpass was down" than "genuinely nothing here",
      // and a 30m stale-empty cache would keep hiding real data long after
      // Overpass recovers. Short TTL on empty so a retry soon after actually
      // re-checks instead of replaying the outage.
      cacheSet(ck, items, items.length ? 30*60*1000 : 60*1000);
      layers.restrict = items;
      return;
    }
    const ck = type+'_'+bboxStr;
    const cached = cacheGet(ck);
    if (cached) { layers[type]=cached; return; }
    console.log('  Fetching ' + type + ' ...');
    const bbox = bounds.s+','+bounds.w+','+bounds.n+','+bounds.e;
    const q = '[out:json][timeout:25];'+OVERPASS_QUERIES[type].replace(/BBOX/g,bbox)+'out center;';
    const data = await overpassFetch(q);
    const pts = (data.elements||[]).map(function(el){ return normalizePOI(el,type); }).filter(Boolean);
    console.log('  OK ' + type + ': ' + pts.length + ' points');
    // Same reasoning as the restrict cache above — don't let a transient
    // Overpass outage's empty result masquerade as "no stops/rest areas
    // exist here" for a full 30 minutes.
    cacheSet(ck, pts, pts.length ? 30*60*1000 : 60*1000);
    layers[type] = pts;
  }));
  respond(res, 200, { layers:layers, timestamp:new Date().toISOString() });
}

// DMS / Message Signs
const DMS_FEEDS = [
  { key:'bc', name:'BC DriveBC',     url:'https://api.open511.gov.bc.ca/events?format=json&event_type=CONSTRUCTION&limit=200', parser:'open511sign' },
  { key:'ab', name:'Alberta 511',    url:'https://511.alberta.ca/api/v2/get/sign?format=json', parser:'ibi511sign' },
  { key:'id', name:'Idaho 511',      url:'https://511.idaho.gov/api/v2/get/sign?format=json', parser:'ibi511sign' },
  { key:'mt', name:'Montana DOT',    url:'https://511.mt.gov/api/v2/get/sign?format=json', parser:'ibi511sign' },
  { key:'wa', name:'Washington DOT', url:'https://511wa.gov/api/v2/get/sign?format=json', parser:'ibi511sign' },
];

async function handleSigns(req, res) {
  const ck = 'signs_all';
  const cached = cacheGet(ck);
  if (cached) return respond(res, 200, cached);
  const items = [];
  await Promise.allSettled(DMS_FEEDS.map(async function(feed) {
    try {
      const text = await serverFetch(feed.url, { timeout:10000 });
      if (!text.trim() || text.trim()[0]==='<') return;
      const data = JSON.parse(text);
      let signs = [];
      if (feed.parser === 'open511sign') {
        signs = (data.events||[]).map(function(e) {
          const coords = e.geography && e.geography.coordinates;
          return { lat:coords&&coords[1], lon:coords&&coords[0],
            message:e.headline||e.description||'', status:'ACTIVE',
            road:(e.roads&&e.roads[0]&&e.roads[0].name)||'' };
        });
      } else {
        signs = (data.Signs||data.signs||data||[]).map(function(s) { return {
          lat:s.Latitude!=null?s.Latitude:(s.lat||null), lon:s.Longitude!=null?s.Longitude:(s.lon||null),
          message:s.Message||s.message||s.CurrentMessage||'',
          status:s.Status||s.status||'Active', road:s.RoadwayName||s.road||'' }; });
      }
      signs.filter(function(s){return s.lat&&s.lon&&s.message;}).forEach(function(s){ items.push(s); });
      console.log('  OK ' + feed.name + ' signs: ' + signs.length);
    } catch(e) { console.warn('  ERR ' + feed.name + ' signs: ' + e.message); }
  }));
  cacheSet(ck, items, 5*60*1000);
  respond(res, 200, items);
}

// Road Conditions
const COND_FEEDS = [
  { key:'bc', name:'BC DriveBC',     url:'https://api.open511.gov.bc.ca/events?format=json&event_type=ROAD_CONDITION&limit=300', parser:'open511cond' },
  { key:'ab', name:'Alberta 511',    url:'https://511.alberta.ca/api/v2/get/roadCondition?format=json', parser:'ibi511cond' },
  { key:'id', name:'Idaho 511',      url:'https://511.idaho.gov/api/v2/get/roadCondition?format=json', parser:'ibi511cond' },
  { key:'mt', name:'Montana DOT',    url:'https://511.mt.gov/api/v2/get/roadCondition?format=json', parser:'ibi511cond' },
  { key:'wa', name:'Washington DOT', url:'https://511wa.gov/api/v2/get/roadCondition?format=json', parser:'ibi511cond' },
  { key:'nd', name:'North Dakota',   url:'https://www.511nd.gov/api/v2/get/roadCondition?format=json', parser:'ibi511cond' },
  { key:'mn', name:'Minnesota 511',  url:'https://511mn.org/api/v2/get/roadCondition?format=json', parser:'ibi511cond' },
];
const COND_MAP = {
  'normal':'Good','good':'Good','clear':'Good','dry':'Good',
  'fair':'Fair','moderate':'Fair','wet':'Fair',
  'difficult':'Difficult','poor':'Difficult','ice':'Difficult','snow':'Difficult',
  'slippery':'Difficult','icy':'Difficult',
  'closed':'Closed','no access':'Closed'
};

async function handleConditions(req, res) {
  const ck = 'conditions_all';
  const cached = cacheGet(ck);
  if (cached) return respond(res, 200, cached);
  const items = [];
  await Promise.allSettled(COND_FEEDS.map(async function(feed) {
    try {
      const text = await serverFetch(feed.url, { timeout:10000 });
      if (!text.trim() || text.trim()[0]==='<') return;
      const data = JSON.parse(text);
      let conds = [];
      if (feed.parser === 'open511cond') {
        conds = (data.events||[]).map(function(e) {
          const coords = e.geography && e.geography.coordinates;
          return { lat:coords&&coords[1], lon:coords&&coords[0],
            condition:e.event_type||'Unknown', road:(e.roads&&e.roads[0]&&e.roads[0].name)||'' };
        });
      } else {
        conds = (data.RoadConditions||data.roadConditions||data||[]).map(function(c) { return {
          lat:c.Latitude!=null?c.Latitude:(c.lat||null), lon:c.Longitude!=null?c.Longitude:(c.lon||null),
          condition: COND_MAP[(c.Condition||c.condition||'normal').toLowerCase()] || 'Unknown',
          road:c.RoadwayName||c.road||'' }; });
      }
      conds.filter(function(c){return c.lat&&c.lon;}).forEach(function(c){ items.push(c); });
      console.log('  OK ' + feed.name + ' conditions: ' + conds.length);
    } catch(e) { console.warn('  ERR ' + feed.name + ' conditions: ' + e.message); }
  }));
  cacheSet(ck, items, 10*60*1000);
  respond(res, 200, items);
}

// Route Audit
async function handleRouteAudit(req, res, body) {
  const profile = body.profile || {};
  const bbox    = body.bbox    || '';
  const risks   = [];

  if (!bbox) return respond(res, 400, { error: 'bbox required' });
  const parts = String(bbox).split(',').map(Number);
  if (parts.length !== 4 || parts.some(function(v){ return !Number.isFinite(v); }))
    return respond(res, 400, { error: 'Invalid bbox' });
  const s=parts[0], w=parts[1], n=parts[2], e=parts[3];
  if (s < -90 || n > 90 || w < -180 || e > 180 || s >= n || w >= e || n-s > 50 || e-w > 100)
    return respond(res, 400, { error: 'Invalid or oversized bbox' });

  const heightM = (profile.heightFt  || 0) * 0.3048;
  const weightT = (profile.weightLbs || 0) / 2204.62;
  const hazmat  = profile.hazmat || 'none';

  if (profile.weightLbs > 80000)
    risks.push({ cls:'warn', msg:'GVW '+(profile.weightLbs/1000).toFixed(0)+'k lbs exceeds 80,000 lb federal limit. Overweight permit likely required.' });
  if (profile.heightFt > 13.5)
    risks.push({ cls:'warn', msg:'Height '+profile.heightFt+'ft exceeds standard 13.5ft clearance. Verify all overpasses along route.' });
  if (profile.widthFt > 8.5)
    risks.push({ cls:'warn', msg:'Width '+profile.widthFt+'ft exceeds 8.5ft standard. Oversize permit required.' });
  if (profile.trailer === 'lowboy' || profile.trailer === 'oversized')
    risks.push({ cls:'warn', msg:'Oversized/lowboy load — verify bridge ratings and permit escort requirements.' });
  if (hazmat !== 'none') {
    risks.push({ cls:'warn', msg:'HazMat Class '+hazmat+' active. Check FMCSA HazMat Route Registry for restrictions. Keep placards visible.' });

    // ── NY / NYC HazMat rules (source: NYS DOT, May 2025) ──────────────────
    // Bounding box for New York State: roughly 40.5N–45.0N, 72.0W–79.8W
    const inNY = (s < 45.0 && n > 40.5 && w > -80.0 && e < -71.5);
    // NYC bounding box: 40.47–40.92N, 73.70–74.27W
    const inNYC = (s < 40.92 && n > 40.47 && w > -74.27 && e < -73.70);

    if (inNY) {
      risks.push({ cls:'danger', msg:'NY STATE: HazMat prohibited on ALL parkways (car-only roads). Use truck-designated routes only.', src:'NYS DOT' });
      risks.push({ cls:'warn',   msg:'NY Thruway: certain HazMat segments require advance authorization from NYS Thruway Authority.', src:'NYS DOT' });
      risks.push({ cls:'warn',   msg:'NY bridges and tunnels: HazMat class restrictions vary by structure. Confirm before approach.', src:'NYS DOT' });
    }
    if (inNYC) {
      risks.push({ cls:'danger', msg:'NYC: HazMat trucks PROHIBITED in Lincoln Tunnel, Holland Tunnel, Queens-Midtown Tunnel, and Brooklyn-Battery Tunnel. Use surface street alternates.', src:'NYS DOT / NYC' });
      if (['1','1A','1B','1C','1D','1E','1F'].some(function(c){ return hazmat.startsWith(c); }))
        risks.push({ cls:'danger', msg:'NYC Class 1 Explosives: must follow FDNY-designated routes ONLY. Contact FDNY Bureau of Fire Prevention before transit.', src:'FDNY' });
    }
  }

  try {
    const q = '[out:json][timeout:20];(way["maxheight"]('+s+','+w+','+n+','+e+');way["maxweight"]('+s+','+w+','+n+','+e+');way["hgv"="no"]('+s+','+w+','+n+','+e+'););out center tags;';
    const data = await overpassFetch(q);
    let hConf=0, wConf=0, hgvBlocks=0;
    (data.elements||[]).forEach(function(el) {
      const tags = el.tags||{};
      const lat  = el.lat||(el.center&&el.center.lat);
      const lon  = el.lon||(el.center&&el.center.lon);
      if (tags.maxheight && heightM > 0) {
        const clearM = parseFloat(tags.maxheight);
        if (!isNaN(clearM) && heightM > clearM*0.97) {
          hConf++;
          if (hConf<=3) risks.push({ cls:'danger', lat:lat, lon:lon,
            msg:'Low clearance: '+clearM+'m ('+(clearM/0.3048).toFixed(1)+'ft). Truck '+profile.heightFt+'ft. HEIGHT CONFLICT.' });
        }
      }
      if (tags.maxweight && weightT > 0) {
        const limT = parseFloat(tags.maxweight);
        if (!isNaN(limT) && weightT > limT) {
          wConf++;
          if (wConf<=3) risks.push({ cls:'danger', lat:lat, lon:lon,
            msg:'Weight limit: '+limT+'t on segment. Truck GVW '+weightT.toFixed(1)+'t. WEIGHT CONFLICT.' });
        }
      }
      if (tags.hgv==='no') {
        hgvBlocks++;
        if (hgvBlocks<=2) risks.push({ cls:'danger', lat:lat, lon:lon, msg:'No trucks restriction on segment near route.' });
      }
    });
    if (hConf>3) risks.push({ cls:'danger', msg:hConf+' total clearance conflicts in route corridor.' });
    if (wConf>3) risks.push({ cls:'danger', msg:wConf+' total weight-restricted segments in corridor.' });
  } catch(e) {
    risks.push({ cls:'info', msg:'Restriction scan incomplete: '+e.message });
  }

  if (hazmat !== 'none') {
    try {
      const tq = '[out:json][timeout:12];(way["tunnel"="yes"]('+s+','+w+','+n+','+e+');way["hazmat"="no"]('+s+','+w+','+n+','+e+'););out center tags;';
      const td = await overpassFetch(tq);
      const tunnels = (td.elements||[]).filter(function(el){ return (el.tags||{}).tunnel==='yes'; });
      if (tunnels.length > 0)
        risks.push({ cls:'warn', msg:tunnels.length+' tunnel(s) on route. Verify HazMat Class '+hazmat+' is permitted.' });
    } catch(e) {}
  }

  try {
    const br = await fetchBansLayer();
    const nb = br.items.filter(function(b){ return b.lat&&b.lon&&b.lat>=s&&b.lat<=n&&b.lon>=w&&b.lon<=e; });
    if (nb.length > 0)
      risks.push({ cls:'warn', msg:nb.length+' active road ban(s) in route corridor.' });
  } catch(e) {}

  if (!risks.length)
    risks.push({ cls:'ok', msg:'No restriction conflicts detected for this truck profile. Verify posted signs.' });
  risks.push({ cls:'info', msg:'Informational only. Driver responsible for all compliance.', src:'RigRout Route Audit v3' });

  respond(res, 200, { risks:risks, timestamp:new Date().toISOString() });
}

// Commercial route calculation. TomTom's truck mode considers the supplied
// height, width, length, weight, axle count, commercial status, and HazMat
// class. When no key is configured, return an explicitly marked OSRM preview
// so the UI never misrepresents a car route as truck-constrained.
async function handleRoute(req, res, body) {
  const waypoints = Array.isArray(body.waypoints) ? body.waypoints : [];
  if (waypoints.length < 2 || waypoints.length > 8)
    return respond(res, 400, { error:'2 to 8 waypoints required' });
  const points = waypoints.map(function(point) {
    return Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [NaN, NaN];
  });
  if (points.some(function(point) {
    return !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
      point[0] < -90 || point[0] > 90 || point[1] < -180 || point[1] > 180;
  })) return respond(res, 400, { error:'Invalid waypoints' });

  const profile = body.profile || {};
  const heightFt = Number(profile.heightFt);
  const widthFt = Number(profile.widthFt);
  const lengthFt = Number(profile.lengthFt);
  const weightLbs = Number(profile.weightLbs);
  const axles = Number(profile.axles);
  if (![heightFt,widthFt,lengthFt,weightLbs,axles].every(Number.isFinite) ||
      heightFt < 4 || heightFt > 20 || widthFt < 4 || widthFt > 16 ||
      lengthFt < 8 || lengthFt > 150 || weightLbs < 1000 || weightLbs > 500000 ||
      axles < 2 || axles > 20)
    return respond(res, 400, { error:'Invalid truck profile' });

  if (process.env.TOMTOM_API_KEY) {
    const locations = points.map(function(point){ return point[0]+','+point[1]; }).join(':');
    const params = new URLSearchParams({
      key: process.env.TOMTOM_API_KEY,
      travelMode: 'truck',
      vehicleCommercial: 'true',
      vehicleHeight: (heightFt * 0.3048).toFixed(2),
      vehicleWidth: (widthFt * 0.3048).toFixed(2),
      vehicleLength: (lengthFt * 0.3048).toFixed(2),
      vehicleWeight: String(Math.round(weightLbs * 0.453592)),
      vehicleNumberOfAxles: String(Math.round(axles)),
      routeType: 'fastest',
      traffic: 'true',
      instructionsType: 'text',
      language: 'en-US',
      routeRepresentation: 'polyline',
      computeTravelTimeFor: 'all'
    });
    if (body.avoidTolls) params.append('avoid', 'tollRoads');
    const hazmat = String(profile.hazmat || 'none');
    if (/^[1-9]$/.test(hazmat)) params.append('vehicleLoadType', 'USHazmatClass' + hazmat);
    const endpoint = 'https://api.tomtom.com/routing/1/calculateRoute/' + locations + '/json?' + params.toString();
    const data = JSON.parse(await serverFetch(endpoint, { timeout:25000 }));
    const source = data.routes && data.routes[0];
    if (!source) return respond(res, 502, { error:'Truck routing provider returned no route' });
    const coordinates = [];
    (source.legs || []).forEach(function(leg) {
      (leg.points || []).forEach(function(point, index) {
        if (coordinates.length && index === 0) return;
        coordinates.push([point.longitude, point.latitude]);
      });
    });
    const instructions = (source.guidance && source.guidance.instructions) || [];
    let previousOffset = 0;
    const steps = instructions.map(function(instruction) {
      const offset = Number(instruction.routeOffsetInMeters) || previousOffset;
      const distance = Math.max(0, offset - previousOffset);
      previousOffset = offset;
      return { distance:distance, name:instruction.message || instruction.street || 'Continue',
        maneuver:{ instruction:instruction.message || instruction.street || 'Continue' } };
    });
    return respond(res, 200, { provider:'tomtom', truckConstrained:true,
      route:{ distance:source.summary.lengthInMeters, duration:source.summary.travelTimeInSeconds,
        geometry:{type:'LineString',coordinates:coordinates}, legs:[{steps:steps}] } });
  }

  const osrmPoints = points.map(function(point){ return point[1]+','+point[0]; }).join(';');
  const endpoint = 'https://router.project-osrm.org/route/v1/driving/' + osrmPoints +
    '?overview=full&geometries=geojson&steps=true';
  const data = JSON.parse(await serverFetch(endpoint, { timeout:20000 }));
  if (!data.routes || !data.routes[0]) return respond(res, 502, { error:'Preview routing provider returned no route' });
  respond(res, 200, { provider:'osrm-preview', truckConstrained:false, route:data.routes[0],
    warning:'Preview only: this route does not apply commercial vehicle constraints.' });
}

// HTTP helper
const MAX_JSON_BODY_BYTES = 32 * 1024;
const RATE_BUCKETS = new Map();
const PUBLIC_FILES = new Map([
  ['/', 'rigrout.html'],
  ['/rigrout.html', 'rigrout.html'],
  ['/privacy', 'privacy.html'],
  ['/privacy.html', 'privacy.html'],
  ['/manifest.json', 'manifest.json'],
  ['/sw.js', 'sw.js'],
  ['/icon.svg', 'icon.svg'],
  ['/MarkerCluster.css', 'MarkerCluster.css'],
  ['/MarkerCluster.Default.css', 'MarkerCluster.Default.css'],
  ['/leaflet.markercluster.js', 'leaflet.markercluster.js'],
  ['/mobile-config.js', 'mobile-config.js']
]);

function clientAddress(req) {
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function sameOrigin(req, origin) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === req.headers.host || ALLOWED_ORIGINS.has(origin.replace(/\/$/, ''));
  } catch (e) { return false; }
}

function rateLimit(req, res, scope, max, windowMs) {
  const now = Date.now();
  const key = scope + ':' + clientAddress(req);
  let bucket = RATE_BUCKETS.get(key);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  RATE_BUCKETS.set(key, bucket);
  res.setHeader('RateLimit-Limit', String(max));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
  res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count <= max) return true;
  res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
  respond(res, 429, { error: 'Too many requests' });
  return false;
}

setInterval(function() {
  const now = Date.now();
  RATE_BUCKETS.forEach(function(bucket, key) {
    if (bucket.resetAt <= now) RATE_BUCKETS.delete(key);
  });
}, 5 * 60 * 1000).unref();

function readJsonBody(req, res, handler) {
  let body = '';
  let rejected = false;
  req.on('data', function(chunk) {
    if (rejected) return;
    body += chunk;
    if (Buffer.byteLength(body) > MAX_JSON_BODY_BYTES) {
      rejected = true;
      respond(res, 413, { error: 'Request body too large' });
    }
  });
  req.on('end', function() {
    if (rejected) return;
    try { handler(JSON.parse(body || '{}')); }
    catch (e) { respond(res, 400, { error: 'Bad JSON' }); }
  });
  req.on('error', function() {
    if (!res.headersSent) respond(res, 400, { error: 'Request body error' });
  });
}

function isAdminRequest(req) {
  if (HOST !== '0.0.0.0' && isLocalRequest(req) && !ADMIN_TOKEN) return true;
  const auth = String(req.headers.authorization || '');
  if (!ADMIN_TOKEN || !auth.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(auth.slice(7));
  const expected = Buffer.from(ADMIN_TOKEN);
  return supplied.length === expected.length && require('crypto').timingSafeEqual(supplied, expected);
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
    'Cross-Origin-Resource-Policy': 'same-origin'
  };
}

function respond(res, code, obj) {
  const body = JSON.stringify(obj);
  const headers = Object.assign({ 'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store' }, securityHeaders());
  if (res._corsOrigin) headers['Access-Control-Allow-Origin'] = res._corsOrigin;
  res.writeHead(code, headers);
  res.end(body);
}

// ── Local-only guard ──────────────────────────────────────────────────────────
// /api/restart and /api/cache/clear are operator tools, not app features — the
// page itself never calls them. Because CORS is wide open above (needed for the
// data endpoints), without this check any website could POST/GET these from a
// visitor's browser and restart or blank the cache on someone's machine. This
// checks the actual TCP peer address, which the CORS header can't spoof: a
// request only looks like it came from 127.0.0.1 if it truly opened a socket
// to that address, which a remote origin cannot do.
function isLocalRequest(req) {
  const addr = req.socket && req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

// HTTP Server
const server = http.createServer(function(req, res) {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const origin = String(req.headers.origin || '');

  if (!sameOrigin(req, origin)) return respond(res, 403, { error: 'Origin not allowed' });
  if (origin) res._corsOrigin = origin;

  if (req.method==='OPTIONS') {
    const headers = Object.assign({
      'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type, Authorization',
      'Access-Control-Max-Age':'600'
    }, securityHeaders());
    if (res._corsOrigin) headers['Access-Control-Allow-Origin'] = res._corsOrigin;
    res.writeHead(204, headers);
    return res.end();
  }

  if (pathname.startsWith('/api/') && !rateLimit(req,res,'api',120,60*1000)) return;

  if (pathname==='/api/layers') {
    if (req.method!=='GET') return respond(res,405,{error:'GET required'});
    return handleLayers(req,res,parsed.query).catch(function(e){respond(res,500,{error:'Layer request failed'}); console.warn(e.message);});
  }
  if (pathname==='/api/signs') {
    if (req.method!=='GET') return respond(res,405,{error:'GET required'});
    return handleSigns(req,res).catch(function(e){respond(res,500,{error:'Sign request failed'}); console.warn(e.message);});
  }
  if (pathname==='/api/conditions') {
    if (req.method!=='GET') return respond(res,405,{error:'GET required'});
    return handleConditions(req,res).catch(function(e){respond(res,500,{error:'Condition request failed'}); console.warn(e.message);});
  }
  if (pathname==='/api/cameras') {
    if (req.method!=='GET') return respond(res,405,{error:'GET required'});
    return handleLayers(req,res,Object.assign(parsed.query,{types:'cameras'})).catch(function(e){respond(res,500,{error:'Camera request failed'}); console.warn(e.message);});
  }
  if (pathname==='/api/cache/clear') {
    if (req.method!=='POST') return respond(res,405,{error:'POST required'});
    if (!isAdminRequest(req)) return respond(res,403,{error:'forbidden'});
    _cache.clear(); return respond(res,200,{cleared:true});
  }
  if (pathname==='/api/restart') {
    if (req.method!=='POST') return respond(res,405,{error:'POST required'});
    if (!isAdminRequest(req)) return respond(res,403,{error:'forbidden'});
    respond(res,200,{restarting:true});
    setTimeout(function(){
      var cp=require('child_process');
      cp.spawn(process.execPath,[__filename],{detached:true,stdio:'ignore',cwd:__dirname}).unref();
      process.exit(0);
    },200);
    return;
  }

  if (pathname==='/api/status') {
    if (req.method!=='GET') return respond(res,405,{error:'GET required'});
    return respond(res,200,{status:'ok',version:'2.0',feeds:BAN_FEEDS.length,
      routingMode:process.env.TOMTOM_API_KEY?'truck':'preview',cacheEntries:_cache.size,uptime:process.uptime()|0});
  }

  if (pathname==='/api/route') {
    if (req.method!=='POST') return respond(res,405,{error:'POST required'});
    if (!rateLimit(req,res,'route',30,60*1000)) return;
    return readJsonBody(req,res,function(body){
      handleRoute(req,res,body).catch(function(e){respond(res,502,{error:'Route calculation failed'}); console.warn(e.message);});
    });
  }

  if (pathname==='/api/route-audit') {
    if (req.method!=='POST') return respond(res,405,{error:'POST required'});
    if (!rateLimit(req,res,'route-audit',30,60*1000)) return;
    return readJsonBody(req,res,function(body){
      handleRouteAudit(req,res,body).catch(function(e){respond(res,500,{error:'Route audit failed'}); console.warn(e.message);});
    });
  }

  if (pathname==='/api/feedback') {
    if (req.method==='GET') {
      if (!isAdminRequest(req)) return respond(res,403,{error:'Forbidden'});
      return handleFeedbackGet(req,res);
    }
    if (req.method!=='POST') return respond(res,405,{error:'POST required'});
    if (!rateLimit(req,res,'feedback-write',10,15*60*1000)) return;
    return readJsonBody(req,res,function(body){ handleFeedbackPost(req,res,body); });
  }

  if (pathname==='/api/incidents') {
    if (req.method==='GET') return handleIncidentGet(req,res);
    if (req.method!=='POST') return respond(res,405,{error:'POST required'});
    if (!rateLimit(req,res,'incident-write',20,15*60*1000)) return;
    return readJsonBody(req,res,function(body){ handleIncidentPost(req,res,body); });
  }

  // Never serve the raw data directory as static files — it holds feedback
  // (may include an email) and hazard reports. Only the /api endpoints above
  // may read/write it.
  const publicName = PUBLIC_FILES.get(pathname);
  if (!publicName) return respond(res,404,{error:'Not found'});
  const filePath = path.join(__dirname, publicName);
  if (!fs.existsSync(filePath)) return respond(res,404,{error:'Not found'});
  const ext  = path.extname(filePath).toLowerCase();
  const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css',
    '.json':'application/json','.png':'image/png','.ico':'image/x-icon',
    '.svg':'image/svg+xml','.webmanifest':'application/manifest+json'}[ext]||'application/octet-stream';
  const headers = Object.assign({'Content-Type':mime}, securityHeaders());
  if (ext === '.html') {
    headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https:; connect-src 'self' https://*.openstreetmap.org https://*.openstreetmap.fr https://overpass.kumi.systems https://overpass-api.de https://nominatim.openstreetmap.org https://router.project-osrm.org https://api.open-meteo.com; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; worker-src 'self'";
  }
  if (res._corsOrigin) headers['Access-Control-Allow-Origin'] = res._corsOrigin;
  res.writeHead(200,headers);
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, HOST, function() {
  console.log('\n  RigRout API server v2.0 ready!');
  console.log('   Open  http://'+(HOST==='0.0.0.0'?'localhost':HOST)+':'+PORT+'/rigrout.html');
  console.log('');
  if (HOST === '0.0.0.0') {
    console.log('   ⚠ Bound to 0.0.0.0 — reachable from outside this machine.');
    console.log('     Private operator endpoints require ADMIN_TOKEN.');
    if (!ADMIN_TOKEN) console.log('     ADMIN_TOKEN is unset, so those endpoints are disabled.');
    console.log('');
  }
  console.log('   Endpoints:');
  console.log('   GET  /api/layers?types=stops,rest,bans,cameras&bbox=s,w,n,e');
  console.log('   POST /api/route-audit  {bbox, profile:{heightFt,widthFt,weightLbs,hazmat}}');
  console.log('   GET  /api/signs        DMS message signs');
  console.log('   GET  /api/conditions   road condition segments');
  console.log('   GET  /api/status');
  console.log('   GET  /api/cache/clear');
  console.log('');
  console.log('   Ban feeds: '+BAN_FEEDS.length+' regions loaded');
  console.log('');
});
