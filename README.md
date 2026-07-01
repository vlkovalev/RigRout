# RigRout — Commercial Route Intelligence

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
| Community hazard reports shared between drivers | **Not yet implemented.** Hazard reports are currently stored only in the reporting browser's local storage. |
| Feedback submission | **Not yet implemented** — the feedback form does not currently send data anywhere. |
| Offline / PWA support | Not yet implemented |

## Endpoints (rigrout-server.js)

```
GET  /api/layers?types=stops,rest,bans,cameras,restrict&bbox=s,w,n,e
POST /api/route-audit   body: {bbox, profile:{heightFt,widthFt,weightLbs,axles,hazmat,trailer}}
GET  /api/signs
GET  /api/conditions
GET  /api/status
GET  /api/cache/clear
```

## Project docs

- `Commercial_Truckers_AI_Map_PRD.md` — full product requirements document.
- `Commercial_Truckers_AI_Map_Project_Prompts.md` — market research, naming, and build-prompt reference.

## License

All rights reserved (private project — no license granted for reuse).
