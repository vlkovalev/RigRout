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

The server must be running for the following features to work — they proxy state DOT/511 feeds that don't allow direct browser requests (no CORS headers on those government endpoints):

- Live road ban feed panel (24 US/Canada regions)
- DMS message signs
- Road condition segments
- Server-side route-risk audit

Without the server running, the page still loads and basic truck-stop/rest-area/cardlock POI layers and truck-restriction markers work via direct client-side calls to the public Overpass API — but road bans, signs, conditions, and the route audit will not populate. The small dot next to the header indicates server status (green = connected).

## What's implemented vs. not yet

| Feature | Status |
|---|---|
| Address/POI search, multi-stop planning, save/share routes | Implemented |
| Truck stop / rest area / cardlock / weigh station / EV / border POI layers | Implemented (via OpenStreetMap/Overpass) |
| Live road ban / DMS sign / road condition feeds (24 regions) | Implemented, **requires local server running** |
| Route calculation with actual truck-dimension constraints (height/weight/width routing) | **Not yet implemented.** Routing currently uses OSRM's public car-routing demo endpoint. The "Route Risk Audit" panel checks the drawn route against restriction data *after the fact* — it does not yet reroute around conflicts. |
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
| Colorado | `BAN_KEY_CO` | https://www.cotrip.org/help/section/for-developers.html |
| Ohio | `BAN_KEY_OH` | https://publicapi.ohgo.com/ — **note:** Ohio does not run the IBI511 platform at all; OHGO is a separate public API with its own request/response shape. The current `oh` BAN_FEEDS URL is the generic IBI511-style guess and will need its own parser branch (like NY's `arcgis` one) once someone wires this up properly, not just a key. |

The remaining feeds (`BAN_KEY_OR`, `BAN_KEY_MT`, `BAN_KEY_ND`, `BAN_KEY_SD`, `BAN_KEY_WY`, `BAN_KEY_MN`, `BAN_KEY_IA`, `BAN_KEY_NE`, `BAN_KEY_MO`, `BAN_KEY_IL`, `BAN_KEY_TX`, `BAN_KEY_KS`, `BAN_KEY_PA`) likely need the same free registration, but **the registration page URL pattern is not consistent across states** — Idaho/Utah/Wisconsin/NY use `/developers/doc` or `/developers/help`, Colorado uses `/help/section/for-developers.html` instead — so rather than guess a link that's probably wrong for some of these, check that state's own 511 homepage footer/help menu for "Developers" or "API" and register there. Set the corresponding env var once you've registered and confirmed a key is needed; feeds work unauthenticated if no key turns out to be required.

**Known gaps, not fixable by a key:**
- **Washington DOT** — does not run the IBI511 platform at all. WSDOT has its own separate "Traveler Information API" (`wsdot.wa.gov/traffic/api/`) with its own Access Code auth and different endpoint shapes. This feed is left in as a placeholder but will keep erroring until someone builds a dedicated WSDOT integration.
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
