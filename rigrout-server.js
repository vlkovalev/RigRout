/**
 * RigRout API Server — v2.0 (Phase 3)
 * Run: node rigrout-server.js
 * Then open: http://localhost:3001/rigrout.html
 *
 * Endpoints:
 *   GET  /api/layers?types=stops,rest,bans,cameras,restrict&bbox=s,w,n,e
 *   POST /api/route-audit  body:{bbox,profile:{heightFt,widthFt,weightLbs,axles,hazmat,trailer}}
 *   GET  /api/signs        DMS/message signs
 *   GET  /api/conditions   road conditions (colored segments)
 *   GET  /api/status
 *   GET  /api/cache/clear
 */
const http  = require('http');
const https = require('https');
const url   = require('url');
const path  = require('path');
const fs    = require('fs');
const PORT  = 3001;

// TTL Cache
const _cache = new Map();
function cacheGet(k) { const v = _cache.get(k); return v && v.exp > Date.now() ? v.data : null; }
function cacheSet(k, d, ttlMs) { _cache.set(k, { data: d, exp: Date.now() + ttlMs }); }

// Server-side fetch (no CORS issues) — follows redirects, uses browser UA
function serverFetch(urlStr, opts, _redirects) {
  opts = opts || {};
  _redirects = _redirects || 0;
  return new Promise(function(resolve, reject) {
    const parsed  = new URL(urlStr);
    const lib     = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   opts.method || 'GET',
      headers:  Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
      }, opts.headers || {}),
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
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
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
const BAN_FEEDS = [
  // ── Canada ────────────────────────────────────────────────────────────────────
  { key:'bc', name:'BC DriveBC',       url:'https://api.open511.gov.bc.ca/events?format=json', parser:'open511' }, // ✓ Open511
  { key:'ab', name:'Alberta 511',      url:'https://511.alberta.ca/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ✓
  { key:'on', name:'Ontario 511',      url:'https://511on.ca/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ✓
  // sk/mb: no public JSON API — removed
  // ── US Northwest ──────────────────────────────────────────────────────────────
  { key:'wa', name:'Washington DOT',   url:'https://wsdot.wa.gov/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ corrected domain
  { key:'or', name:'Oregon TripCheck', url:'https://www.tripcheck.com/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ added www
  { key:'id', name:'Idaho 511',        url:'https://511.idaho.gov/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ added lang=en
  { key:'mt', name:'Montana DOT',      url:'https://511mt.net/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ corrected domain
  // ── US Northern Plains ────────────────────────────────────────────────────────
  { key:'nd', name:'North Dakota 511', url:'https://511.nd.gov/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ removed www
  { key:'sd', name:'South Dakota 511', url:'https://sd511.org/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ corrected domain
  { key:'wy', name:'Wyoming DOT',      url:'https://wyoroad.info/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ added lang=en
  { key:'mn', name:'Minnesota 511',    url:'https://511mn.org/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ added lang=en
  { key:'wi', name:'Wisconsin 511',    url:'https://511wi.gov/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ added lang=en
  // ── US Midwest ────────────────────────────────────────────────────────────────
  { key:'mi', name:'Michigan 511',     url:'https://michigan511.org/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ corrected domain
  { key:'oh', name:'Ohio OHGO',        url:'https://www.ohgo.com/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ OhGo is OH's current system
  { key:'ia', name:'Iowa 511',         url:'https://511ia.org/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ added lang=en
  { key:'ne', name:'Nebraska 511',     url:'https://511.nebraska.gov/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ added lang=en
  { key:'mo', name:'Missouri 511',     url:'https://traveler.modot.org/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ added lang=en
  { key:'il', name:'Illinois 511',     url:'https://www.gettingaroundillinois.com/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ added lang=en
  // ── US South / Great Plains ───────────────────────────────────────────────────
  { key:'tx', name:'Texas DriveTexas', url:'https://www.drivetexas.org/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ added lang=en
  { key:'ks', name:'Kansas 511',       url:'https://www.kandrive.org/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ added lang=en
  { key:'co', name:'Colorado COTRIP',  url:'https://cotrip.org/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ added lang=en
  { key:'ut', name:'Utah UDOT',        url:'https://udottraffic.utah.gov/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ added lang=en
  // ── US East ───────────────────────────────────────────────────────────────────
  { key:'pa', name:'Pennsylvania 511', url:'https://www.511pa.com/api/v2/get/event?format=json&lang=en', parser:'ibi511' }, // ~ added lang=en
  { key:'ny', name:'NY DOT CommVehicle', url:'https://gis.dot.ny.gov/hostingny/rest/services/CommVehicleDataFeed/MapServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=500', parser:'arcgis' }, // ✓ ArcGIS
];
const BAN_KW = ['weight restriction','load restriction','spring ban','frost law','seasonal',
  'overweight','weight limit','road ban','axle weight','weight reduced','load limit',
  'spring thaw','spring weight','posting','lhv','long combination'];

async function fetchBansLayer() {
  const ck = 'bans_all';
  const cached = cacheGet(ck);
  if (cached) return cached;
  const feedResults = {};
  await Promise.allSettled(BAN_FEEDS.map(async function(feed) {
    try {
      const text = await serverFetch(feed.url, { timeout:12000 });
      if (!text.trim() || text.trim()[0]==='<') throw new Error('Non-JSON');
      const data = JSON.parse(text);
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
        : (data.Events||data.events||data||[]).map(function(e) { return {
            headline:e.EventType||e.Headline||e.headline||'',
            desc:e.Description||e.description||'', type:e.EventType||e.event_type||'',
            road:e.RoadwayName||e.road||'', area:e.County||e.City||e.area||'',
            lat:e.Latitude!=null?e.Latitude:(e.lat||null), lon:e.Longitude!=null?e.Longitude:(e.lon||null) }; });
      const bans = evts.filter(function(e) {
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
  const types   = (query.types||'').split(',').filter(Boolean);
  const bboxStr = query.bbox||'';
  let bounds = null;
  if (bboxStr) {
    const p = bboxStr.split(',').map(Number);
    if (!isNaN(p[0])) bounds = { s:p[0], w:p[1], n:p[2], e:p[3] };
  }
  const layers = {};
  await Promise.allSettled(types.map(async function(type) {
    if (type==='bans') {
      const r = await fetchBansLayer();
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
      cacheSet(ck, items, 30*60*1000);
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
    cacheSet(ck, pts, 30*60*1000);
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
  if (parts.some(isNaN)) return respond(res, 400, { error: 'Invalid bbox' });
  const s=parts[0], w=parts[1], n=parts[2], e=parts[3];

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

// HTTP helper
function respond(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type':'application/json',
    'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'*', 'Cache-Control':'no-cache' });
  res.end(body);
}

// HTTP Server
const server = http.createServer(function(req, res) {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (req.method==='OPTIONS') {
    res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST'});
    return res.end();
  }

  if (pathname==='/api/layers')     return handleLayers(req,res,parsed.query).catch(function(e){respond(res,500,{error:e.message});});
  if (pathname==='/api/signs')      return handleSigns(req,res).catch(function(e){respond(res,500,{error:e.message});});
  if (pathname==='/api/conditions') return handleConditions(req,res).catch(function(e){respond(res,500,{error:e.message});});
  if (pathname==='/api/cameras')    return handleLayers(req,res,Object.assign(parsed.query,{types:'cameras'})).catch(function(e){respond(res,500,{error:e.message});});
  if (pathname==='/api/cache/clear') { _cache.clear(); return respond(res,200,{cleared:true}); }
  if (pathname==='/api/restart') {
    respond(res,200,{restarting:true});
    setTimeout(function(){
      var cp=require('child_process');
      cp.spawn(process.execPath,[__filename],{detached:true,stdio:'ignore',cwd:__dirname}).unref();
      process.exit(0);
    },200);
    return;
  }

  if (pathname==='/api/status')     return respond(res,200,{status:'ok',version:'2.0',feeds:BAN_FEEDS.length,cacheEntries:_cache.size,uptime:process.uptime()|0});

  if (pathname==='/api/route-audit') {
    if (req.method!=='POST') return respond(res,405,{error:'POST required'});
    let body='';
    req.on('data',function(d){body+=d;});
    req.on('end',function(){
      try {
        handleRouteAudit(req,res,JSON.parse(body||'{}')).catch(function(e){respond(res,500,{error:e.message});});
      } catch(e){ respond(res,400,{error:'Bad JSON'}); }
    });
    return;
  }

  // Static files
  const base = path.join(__dirname);
  let filePath = path.join(base, pathname==='/'?'rigrout.html':pathname);
  if (!filePath.startsWith(base)) return respond(res,403,{error:'Forbidden'});
  if (!fs.existsSync(filePath))   return respond(res,404,{error:'Not found'});
  const ext  = path.extname(filePath).toLowerCase();
  const mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css',
    '.json':'application/json','.png':'image/png','.ico':'image/x-icon'}[ext]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':mime,'Access-Control-Allow-Origin':'*'});
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '127.0.0.1', function() {
  console.log('\n  RigRout API server v2.0 ready!');
  console.log('   Open  http://localhost:'+PORT+'/rigrout.html');
  console.log('');
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
