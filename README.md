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
