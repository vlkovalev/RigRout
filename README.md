# RigRout — Truck Route Planning &amp; Restriction Data

A truck-stop / restriction-aware map planner for commercial drivers and dispatchers. Leaflet front end (`rigrout.html`) plus a small Node.js proxy/data server (`rigrout-server.js`) that aggregates public DOT/511 road-ban feeds, OpenStreetMap POI data, and a basic route-risk audit.

> **Status: early preview.** Route calculation currently uses a public car-routing service (OSRM) with no truck-dimension constraints yet — see "Known limitations" below before relying on this for dispatch decisions.

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer. No external npm packages are required — the server only uses Node's built-in `http`/`https`/`fs`/`path`/`url` modules.

## Running locally

```bash
npm start
# or directly:
node rigrout-server.js
```

Then open **http://localhost:3001/rigrout.html** in a browser.

`rigrout.html` calls its API relative to whatever host it was loaded from (`location.origin`) — there's no separate frontend/backend URL to configure. That means the exact same file works unmodified whether it's opened at `localhost:3001` in local dev or served from a real deployed domain later (see **Deploying**, below); it does *not* mean the app works without a server somewhere. A server — this one, running *somewhere* reachable at that origin — must be up for the following features to work, since they proxy state DOT/511 feeds that don't allow direct browser requests (no CORS headers on those government endpoints):

- Live road ban feed panel (24 US/Canada regions)
- DMS message signs
- Road condition segments
- Server-side route-risk audit

Without a server reachable at that origin, the page still loads and basic truck-stop/rest-area/cardlock POI layers and truck-restriction markers work via direct client-side calls to the public Overpass API — but road bans, signs, conditions, and the route audit will not populate. The small dot next to the header indicates server status (green = connected).

## Deploying

This is prep work for hosting the server somewhere other than your own machine — it makes the code ready to deploy, it doesn't deploy it for you (that needs your own hosting account).

**Environment variables:**

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Port the server listens on. Most hosts (Render, Fly, etc.) set this for you automatically. |
| `HOST` | `127.0.0.1` | Bind address. **Must be set to `0.0.0.0` to accept connections from outside the machine** — the default is loopback-only (safe for local dev, unreachable from anywhere else, which is exactly why this app couldn't be deployed before). |
| `ADMIN_TOKEN` | unset | Required for production access to private/operator endpoints. Send it as `Authorization: Bearer <token>` with `POST` for restart/cache operations. |
| `ALLOWED_ORIGINS` | unset | Optional comma-separated allowlist for a separately hosted frontend. Same-origin deployments need no value. |
| `TOMTOM_API_KEY` | unset | Enables commercial truck routing and the TomTom supplemental incident feed. Without it, routes are explicitly labeled car-route previews. |
| `BAN_KEY_*` | unset | Optional per-state developer keys — see "Live road ban feeds" below. |

Copy `.env.example` to `.env` and fill in whichever keys you have (the server loads `.env` automatically if present — see top of `rigrout-server.js`).

**Generic steps (Render, Fly.io, a VPS, or any Node host):**

1. Push this repo to the host (git-based deploy on Render/Fly, or `git clone` on a VPS).
2. Set `HOST=0.0.0.0` in that environment's config (Render/Fly: their dashboard or `fly.toml`/`render.yaml`; a bare VPS: your systemd unit's `Environment=` line or a `.env` file).
3. Set `ADMIN_TOKEN` to a long random value in the host's secret manager.
4. Set `PORT` only if your host requires a specific value — most PaaS hosts inject this automatically and you can leave it unset.
5. Start command: `node rigrout-server.js` (or `npm start`).
6. Point a domain at it if you have one; otherwise use whatever URL the host assigns.
7. Open `https://<that-domain>/rigrout.html` — `API_BASE` will resolve to that same domain automatically, no further config needed.

A minimal `Dockerfile` is included for hosts that deploy from a container image rather than a git push.

**Two things that do *not* change when you deploy:**
- `/api/feedback` (GET), `/api/restart`, and `/api/cache/clear` require the `ADMIN_TOKEN` bearer token whenever the server is bound for production. With the safe loopback-only default, local operator access works without a token unless one is configured.
- None of this stands up a *truck-aware routing engine* — that's a separate, much larger project (see "What's implemented vs. not yet"). Deploying this server gets the live road-ban feeds, POI layers, and hazard/feedback reporting working for real visitors; it does not change what `planRoute()` does.

## What's implemented vs. not yet

| Feature | Status |
|---|---|
| Address/POI/local-road/legal-land search, multi-stop planning, save/share routes | Implemented server-side through TomTom when configured, with a Nominatim fallback. Rural abbreviations such as `RR`, `RGE RD`, `TWP RD`, and `CR` are expanded automatically. Alberta legal land descriptions such as `LSD 4-22-38-25-W4`, `NE-22-38-25-W4`, and section-only `22-38-25-W4` resolve through the Government of Alberta ATS V4.1 polygon service to the parcel centre. Results are biased toward GPS/map position and ordered nearest-first. |
| Truck stop / rest area / cardlock / weigh station / EV / border POI layers | Implemented across North America via OpenStreetMap/Overpass. The rest/pull-off layer additionally merges verified government inventories from Alberta 511, Ontario 511, and NYSDOT, including truck-parking availability, facilities, closures/status, and jurisdiction-specific details. Other provinces, states, and Mexico retain the continent-wide OpenStreetMap baseline until a reliable public government feed is integrated. |
| Live road ban / DMS sign / road condition feeds (24 regions) | Implemented, **requires local server running** |
| Route calculation with truck constraints | Implemented through the server-side TomTom Routing API when `TOMTOM_API_KEY` is configured. Height, width, length, weight, axle count, commercial status, toll preference, and US HazMat class are passed to truck mode. Without a key, the server returns an explicitly labeled OSRM car-route preview. |
| Community hazard reports shared between drivers | Implemented, **requires local server running** to be visible to other drivers. Reports POST to `/api/incidents` and are pulled by every client hitting that server; if the server is unreachable, the report is saved to that browser's local storage only, and the UI says so. |
| Feedback submission | Implemented. POSTs to `/api/feedback` on the local server (stored in `data/feedback.json`, gitignored). If the server is unreachable, feedback is queued in local storage and sent automatically once the server is detected. |
| Offline / PWA support | Partial. The app shell (`rigrout.html`, CSS, marker-cluster JS) is cached by a service worker and installable to a home screen/desktop via `manifest.json`. Live data — road bans, DMS signs, conditions, feedback, hazard reports, map tiles, and routing — still requires a connection; none of that is cached, deliberately, so you never see stale restriction data believing it's current. |

## Live road ban feeds — status, API keys, and alternatives

The 24 feeds in `BAN_FEEDS` (`rigrout-server.js` and the client-side fallback in `rigrout.html`) pull from each state/province's own DOT or 511 system. Most U.S. states run a shared white-label platform ("511/IBI Group"); several of those require a **free registered developer key**, rate-limited to a small number of calls per minute. As of this writing:

**Working with no key required:**
- BC DriveBC, Alberta 511, Ontario 511 (Canada)
- NY DOT CommVehicle (ArcGIS feed)
- Michigan (scraped — see "Michigan" below)

**Confirmed to require a free developer key** — register, then set the matching environment variable before starting the server (e.g. `set BAN_KEY_ID=yourkey` on Windows, `export BAN_KEY_ID=yourkey` on macOS/Linux) and the server will append it automatically:

| State | Env var | Register at |
|---|---|---|
| Idaho | `BAN_KEY_ID` | https://511.idaho.gov/developers/doc |
| Wisconsin | `BAN_KEY_WI` | https://511wi.gov/developers/help |
| New York (if adding the IBI feed) | `BAN_KEY_NY` | https://511ny.org/developers/help |
| Utah | `BAN_KEY_UT` | https://prod-ut.ibi511.com/developers/doc |
| Ohio | `BAN_KEY_OH` | https://publicapi.ohgo.com/register — Ohio does not run IBI511; ODOT's OHGO Public API is a separate, well-documented REST API (confirmed via its own Swagger schema at `publicapi.ohgo.com/docs/v1/swagger.json`), now wired up via the `ohgo` parser hitting `/api/v1/construction`. **Note:** its key param is `api-key`, not `key` — `rigrout-server.js`'s `withFeedApiKey()` helper has a per-feed `keyParam` override for this. Construction is a general active-work feed, not restrictions-only, so it goes through the normal `BAN_KW` keyword filter like the IBI511 feeds do. |

The Idaho key is used server-side for restrictions, cameras, message signs, and road conditions. These responses are cached for 5–10 minutes so normal use remains comfortably within Idaho 511's published request limit.

The remaining feed (`BAN_KEY_ND`) likely needs the same free registration, but **the registration page URL pattern is not consistent across states** — Idaho/Utah/Wisconsin/NY use `/developers/doc` or `/developers/help` — so rather than guess a link that's probably wrong, check that state's own 511 homepage footer/help menu for "Developers" or "API" and register there. Set the corresponding env var once you've registered and confirmed a key is needed; feeds work unauthenticated if no key turns out to be required.

**Confirmed working with no key, but not on the IBI511 platform** — these run their own systems (found via live browser network inspection, not guessed):
- **Montana** and **South Dakota** both run Iteris's ATIS product instead of IBI511. Each state's map page exposes a public, unauthenticated CDN-hosted GeoJSON endpoint already scoped to restrictions specifically — Montana: `mt.cdn.iteris-atis.com/geojson/icons/metadata/icons.restrictions.geojson`; South Dakota: `sd.cdn.iteris-atis.com/geojson/icons/metadata/icons.restriction.geojson` (note: singular "restriction", not "restrictions" — the two states use slightly different filenames on the same platform). Both wired up via the `iteris` parser in `rigrout-server.js`.
- **Oregon** — `tripcheck.com` is ODOT's own custom Dojo/Esri "OdotTad.Mapping" app, not IBI511 (the old guessed `/api/v2/get/event` URL was a generic IIS 404 page, not a real endpoint). Confirmed live via network inspection: the map's actual data comes from a set of public, unauthenticated, pre-built Esri FeatureSet JSON files under `tripcheck.com/Scripts/map/data/` — `RWTrucking.js` is the one ODOT scopes specifically to commercial-vehicle restrictions (schema has `commercialRestrictionCode`/`commercialRestrictionDesc` fields), so that's the one wired up (`or_trucking` parser). Its geometry is Web Mercator (wkid 3857) points, converted to lon/lat in the parser. It returns 0 features when nothing is currently posted rather than erroring — same as a quiet Montana/SD feed on a day with no active restrictions.
- **Iowa** — `511ia.org` runs the "CARS" 511 platform, not IBI511. Confirmed via Iowa DOT's own official 511 Data Feeds page (`iowadot.gov/travel-tools/iowa-511/511-data-feeds`), which documents a public "ESRI GIS Feature Services... do not require credentials" section; the live feed URL itself was confirmed via network inspection of the linked ArcGIS Hub dataset page. It's a general events/closures feed (service `CARS511_Iowa_View`), not restrictions-only, but carries a dedicated `Restrict_` field alongside headline/phrase/cause text, so it goes through the normal keyword filter via the new `cars511` parser. Several neighboring Midwest/Plains states' 511 sites may run the same CARS platform — worth checking first before assuming IBI511 for those.
- **Missouri** — `traveler.modot.org` is MoDOT's own custom "TIM" system, not IBI511. Confirmed live via network inspection: the map pulls public, unauthenticated JSON files under `/timconfig/feed/desktop/`; `message.v2.json` is the real general-events feed (~1200 features, Work Zone/Incident/Flooding/Closure types), with coordinates already plain WGS84 in `GEOM.x/y`. There's no dedicated restriction layer (checked the app's own JS — the promisingly-named `BPRV1.json` turned out to mean "Bypass Route", not restrictions), so weight/width/height limit text is picked out of the general message HTML via the normal `BAN_KW` keyword pass, same as Ohio/ND.
- **Pennsylvania** — `511pa.com` is PennDOT's own custom .NET app, not IBI511 (confirmed live: `bundles/`, `Scripts/`, `cms/getfile` paths, nothing matching IBI511's shape). It has an unusually detailed commercial-vehicle-restriction system (Tiers 1-4 by vehicle/trailer type, "Chains Required", "Speed Restrictions" — see the site's own "Vehicle Restrictions" nav menu). The map's own restriction layers (`/map/mapIcons/TruckRestrictions` etc.) turned out to be a dead end — they only return bare `{itemId, location}` points with no description text, no lat/lon-carrying detail. But the site's "Vehicle Restrictions List" page uses a much more useful plain **GET** endpoint, `/List/GetData/AllRestrictionEventsList?query=<url-encoded JSON>`, a standard DataTables call with named columns (`restrictionTier`, `restrictionDescription`, `roadwayName`, `startDate`, `turnpikeOnly`) — no key, no POST, confirmed live via network inspection of that list page and wired up via the new `pa_restrictionlist` parser. Unlike every GraphQL-vendor state above, this one **works from `rigrout-server.js`** — verified live via `/api/status` showing `status:"ok"`. It was a quiet day with 0 active rows when tested, so the populated-row shape is inferred from the DataTables column names rather than seen directly, and there's no lat/lon in this feed (it's roadway-name text, not geometry) — a representative statewide point near Bellefonte is used, the same approach as Michigan's scraped bulletin below.
- **Illinois** — `gettingaroundillinois.com` is IDOT's own portal, not IBI511. It links a dedicated "Obstructions and Restrictions" commercial-vehicle map, confirmed via network inspection to be backed by IDOT's own hosted ArcGIS Server (`gis1.dot.illinois.gov/.../GAI/ObstructionsRestrictions/MapServer/0`, "Closures and Oversize Restrictions"). Its schema has real height-clearance fields (`FT_Height`/`TF_Height`, in inches, verified against the human-readable description text) alongside weight/width/length fields — but those other numeric fields use non-obvious, undocumented sentinel values for "no limit" (both `1` and `10000000` appear depending on the record), so rather than risk misreading a sentinel as a real restriction, only the unambiguous low-clearance records (a real height under 14ft) are wired up via the new `il_clearance` parser. Weight/width restriction codes for this state are a known gap for a future pass with access to IDOT's actual field documentation.

**Known gaps, not fixable by a key:**
- **Washington DOT** — does not run the IBI511 platform at all. WSDOT has its own separate "Traveler Information API" (`wsdot.wa.gov/traffic/api/`) with its own Access Code auth and different endpoint shapes. This feed is left in as a placeholder but will keep erroring until someone builds a dedicated WSDOT integration.
- **Wyoming** — also does not run IBI511 (confirmed live: `wyoroad.info` redirects to `map.wyoroad.info/511-map/`, a custom WYDOT SvelteKit + Esri ArcGIS app). Real weight-restriction data does exist there (e.g. "WY22: Weight limit of 60,000 GVW... Teton Pass"), but unlike Montana/South Dakota's clean public Iteris CDN files, the ArcGIS layers the app exposes (`WTIMAP/Operational_v3`) are geometry-only helpers with no incident content — the restriction text itself is resolved through the app's bundled JS, not a public REST/GeoJSON endpoint findable via network inspection. Needs a dedicated integration (or asking WYDOT directly for their feed), not a URL tweak or a key.
- **Texas** — `drivetexas.org` is a custom TxDOT app on Google Maps JS, not IBI511 (confirmed: the old guessed URL isn't real). Unlike the other states fixed in this pass, its actual data backend isn't a plain public REST/GeoJSON endpoint — it's MapLarge, a commercial GIS visualization vendor, hit via signed/token endpoints (`/Api/VerifyRequest`, `/Api/ProcessRequest`, `/Remote/GetActiveTableID` on `*.maplarge.com`) confirmed via live network inspection. That's a locked-down proprietary query protocol, not something guessable or reusable with a free key, so — like Wyoming/WSDOT — it's left as a known gap rather than guessed at.
- **Minnesota** — also not IBI511; `511mn.org` runs its own GraphQL API (`POST /api/graphql`, no key). The exact real query was found and confirmed (toggling the site's "Trucker Reports" layer and capturing the request live returns 36 real weight/width restriction events) — but replaying that *exact same* query+variables from `rigrout-server.js` gets HTTP 400 `{"errors":[{"message":"Server error."}]}` every time, with or without various headers added. The error is byte-identical no matter what's changed, which points to a transport-level block (TLS/bot-detection fingerprinting a real browser can pass but Node's http client can't) rather than a payload problem. Wired up and documented in `rigrout-server.js` in case a future proxy layer (e.g. a headless browser) can get through, but currently shows as an honest ERROR rather than silently guessing wrong.
- **Nebraska** — same situation as Minnesota, and likely the same underlying vendor family: `511.nebraska.gov` is built by Castle Rock Associates ("CARS511", confirmed via its Google Play package `crc.carsapp.ne`) and also runs a `POST /api/graphql` API with no key. Its "Dashboard" query was captured live via a real browser (returns 202 real events with a `quantities` field carrying entries like `{label:"Width Restriction", value:"12 ft 0 in"}` — 106 of the 202 had one) — but replaying the exact same query+variables from `rigrout-server.js` gets the identical `HTTP 400 {"errors":[{"message":"Server error."}]}` as Minnesota, confirming this is a platform-level block, not a one-off. Wired up the same way: correct and documented, shows as an honest ERROR rather than a silent wrong guess.
- **Kansas** — a third state on this same GraphQL vendor family: `kandrive.org` redirects to `www.kandrive.gov`, which also runs `POST /api/graphql` with no key, but with a different query shape than Minnesota/Nebraska's combined "Dashboard" query — Kansas uses a single-layer "MapFeatures" query. Toggling the site's "Commercial Vehicles" layer (which adds a dedicated `oversizeLoads` layer) and capturing the request live confirmed real data: the one active event returned had `title:"US 50: Oversize Load"` and `tooltip:"Oversize Load | Width: 13' 6\", Length: 240' 0\", Height: 14' 6\""` — restriction dimensions spelled out directly in plain text, no keyword guessing needed. That same captured query replayed successfully from the browser same-origin with no special headers. But replaying it from `rigrout-server.js` doesn't get the JSON error Minnesota/Nebraska get — it gets an HTML page back (`Non-JSON` in `/api/status`), suggesting a CDN/WAF-level challenge page intercepting non-browser requests before they even reach the GraphQL backend. Different symptom, same outcome: wired up and documented (`ks_mapfeatures` parser) in case a future proxy/headless-browser layer can get through, currently shows as an honest ERROR.
- **Colorado** — a fourth state on this same GraphQL vendor family, and the previous assumption in this file/code was simply wrong: `cotrip.org` does **not** run IBI511 and does **not** need `BAN_KEY_CO` — it runs the identical `POST /api/graphql` "MapFeatures" platform as Kansas. Confirmed live by toggling the site's "Trucker Mode" layer, which reveals a layer literally named `restrictions` (CDOT dedicates an entire layer to this, unlike most other states) — the captured query replayed same-origin returned **59 real active statewide restriction events**, e.g. `title:"US 385 in both directions: Width limit in effect."` with `tooltip` HTML containing `<b class="trucker-restriction">Width limit 12'0".</b>`. This is the richest, most direct restriction feed found in this entire project — but like Minnesota/Nebraska, replaying the same query from `rigrout-server.js` gets the identical `HTTP 400 {"errors":[{"message":"Server error."}]}` block. Wired up and documented (`co_mapfeatures` parser) the same way: correct, confirmed, currently blocked server-side, honest ERROR rather than a silent wrong guess — and worth revisiting first if a proxy/headless-browser workaround is ever built, given how much real data is sitting right behind it.
- **Michigan** — `michigan511.org` (the dev API) no longer resolves (DNS failure), so there's no key-based fix. Instead, `rigrout-server.js` scrapes MDOT's public Spring Weight Restriction Bulletin page (`mdotjboss.state.mi.us/APSWB/SWBHome.htm?bulletin=weight`) directly — no key needed, since it's the same page the public reads, not a gated developer API. This is more fragile than the JSON feeds (it depends on MDOT's page markup not changing) and only surfaces the single current statewide bulletin as one marker with the full bulletin text, not point-level events, since the bulletins describe route boundaries ("north of the US-2 and M-134 line") rather than lat/lon points. See `scrapeMichiganWeightBulletin()` in `rigrout-server.js`.

**TomTom as a supplement:** if `TOMTOM_API_KEY` is set, `rigrout-server.js` also fetches TomTom's live traffic incident feed and merges it in alongside the state feeds (it no longer replaces them). TomTom covers accidents/roadwork/closures across all of North America with one key, but its incident categories don't include seasonal weight-restriction/frost-law postings, so it's a useful addition, not a substitute for the state feeds above.

If a feed shows `Non-JSON` or `HTTP 404` in `/api/status` and isn't listed above, that state likely changed its API path or moved to a different platform since these URLs were written — worth re-checking that state's own `/developers` page before assuming it's a key issue.

## Endpoints (rigrout-server.js)

```
GET  /api/layers?types=stops,rest,bans,cameras,restrict&bbox=s,w,n,e
POST /api/route-audit   body: {bbox, profile:{heightFt,widthFt,weightLbs,axles,hazmat,trailer}}
GET  /api/signs
GET  /api/conditions
GET  /api/status
GET  /api/cache/clear   — local requests only (127.0.0.1/::1)
GET  /api/restart       — local requests only (127.0.0.1/::1)
POST /api/feedback      body: {category, message, email}   — stored in data/feedback.json
GET  /api/feedback      — list stored feedback (local review only)
POST /api/incidents     body: {type, note, lat, lon}       — shared hazard report, stored in data/incidents.json
GET  /api/incidents     — active (non-expired) hazard reports, visible to every client hitting this server
```

## Project docs

- `Commercial_Truckers_AI_Map_PRD.md` — full product requirements document.
- `Commercial_Truckers_AI_Map_Project_Prompts.md` — market research, naming, and build-prompt reference.

## License

All rights reserved (private project — no license granted for reuse).
