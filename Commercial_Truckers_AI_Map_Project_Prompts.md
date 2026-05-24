# Commercial Truckers AI Map - Project Brief + Prompts

Date: 2026-05-09

## Recommended Project Name

Primary name: **Overclear**

Reason: built from the driver's biggest safety concern: overhead clearance. The name is short, voice-friendly, and directly signals "know what is overhead before you commit to the road." Before launch, run a full trademark/domain/App Store/Google Play clearance check.

Other candidates:
- AxleIQ
- RigRoute
- ClearHaul
- CargoCompass
- FreightFlow

## Market Research Summary

Competitors reviewed:
- Trucker Path
- Hammer Truck GPS
- SmartTruckRoute
- Sygic Truck & RV
- CoPilot / Trimble
- Garmin dezl ecosystem
- RoadWarrior / Route4Me for route optimization context
- Low Clearance Map / HeadRoom for bridge-clearance focus

What users like most:
- Trucker Path: parking, truck stops, rest areas, fuel, weigh-station status, community reports.
- Hammer: lower-cost truck GPS, offline maps, gate/check-in pinning, practical routing.
- SmartTruckRoute: truck constraints, low-bridge avoidance, weather/wind/snow warnings, IFTA/state mileage.
- Sygic/CoPilot: offline maps and vehicle-specific routing.
- Garmin dezl: dedicated screen, truck warnings, load-to-dock guidance, satellite/arrival views.

Main complaints:
- Bad truck routing: narrow roads, impractical rural roads, unnecessary exits, poor rerouting, bad last-mile directions.
- Low-trust restriction data: users complain about missing frost laws, seasonal weight limits, bridge/height constraints, HazMat/tunnel restrictions.
- App reliability: crashes, freezing, GPS lag, background/navigation recovery problems.
- Poor stop/fuel data: stale truck stop info, incomplete parking/services, weak facility entrance details.
- Pricing frustration: users dislike expensive subscriptions when routing is not trusted.
- UX issues: small text, confusing layouts, weak CarPlay/Android Auto, poor waypoint distance display.

Opportunity:
Build a truck-first map that combines live DOT scraping, vehicle dimension input, card lock locating, and community parking data in a modern UI. The product should explain why a route is truck-safe, not just draw a blue line.

What drivers love most:
- Shows exactly where they can park at 3 AM.
- Avoids low clearances such as the 11'8" Durham bridge.
- Community truck stop intelligence such as shower wait times.
- Weigh station open/closed status.
- HazMat class input for routing.

What drivers hate most:
- Stale data, especially closed truck stops and outdated restrictions.
- Subscription costs stacked on top of phone bills.
- Crashes or poor recalculation in low-signal areas.
- Missing temporary road bans.
- No support for multiple stop or configuration planning when empty vs. loaded height changes.

## Product Concept

Overclear is a commercial vehicle navigation platform for Android, iOS, CarPlay, Android Auto, and web. It routes trucks based on vehicle dimensions, weight, axle count, trailer/load type, HazMat class, seasonal restrictions, official road bans, bridge clearances, road width constraints, and verified truck services along the route.

Core promise:
**Know what's overhead. Know where to stop.**

## MVP Features

Navigation basics:
- Turn-by-turn navigation.
- Live traffic and rerouting.
- Voice guidance.
- Offline map packs.
- Multi-stop trip planning.
- Save favorite yards, docks, cardlocks, truck stops.
- Route comparison: fastest, safest, fuel-efficient, fewer turns, avoids tolls.
- CarPlay and Android Auto.
- Web trip planner that syncs to mobile.
- Reverse parking search: find safe parking within a chosen drive-time window before or after the destination.

Truck profile:
- Height, width, length.
- Weight / GVW.
- Axle count.
- Trailer type.
- HazMat class.
- Empty vs. loaded toggle for height and handling changes.
- Oversize/overweight permit flag.
- Preferred fuel/card network.
- Chain/seasonal equipment status.

Truck routing:
- Avoid low bridges, narrow bridges, restricted roads, non-truck roads.
- Avoid weight-restricted bridges/roads.
- Road bans and seasonal/frost restrictions from official feeds.
- HazMat tunnel/route restrictions.
- Chain-law and winter alerts.
- Local truck route preference.
- Last-mile facility entrance routing.

Route intelligence:
- Truck stops along route.
- Pullouts and rest areas.
- Parking availability with confidence score.
- Cardlock/commercial fuel locations.
- Services available at each stop: diesel, DEF, showers, repair, tire, scales, food, laundry, overnight parking, electric reefer plugs, washout, security, permit office.
- Weigh stations and inspection stations.
- Runaway truck ramps.
- Border crossings.
- Weather, wind, grade, chain alerts.

AI layer:
- "Why this route?" explanation.
- "Show me the risk points" route audit.
- AI copilot that warns: low clearance ahead, restriction changed, parking likely full, fuel stop mismatches card network.
- Voice input for reports, such as: "Hey Overclear, mark low tree branch at this location."
- Driver-submitted correction triage with source confidence.
- Route pre-check report before dispatch.
- Permanent hazard memory for recurring driver-confirmed risks such as potholes, low branches, tight turns, unsafe shoulders, or lane hazards.

MVP implementation checklist:
- Vehicle profile: height, width, length, weight, axle count, HazMat.
- Route planner rejects low/narrow bridges based on the active vehicle profile.
- Truck stops with amenity icons.
- Pullouts and rest areas.
- Card lock locations: TA, Petro, Love's, Pilot, Flying J, and independents.
- DOT scraper pilot: CA, TX, FL, NY, and IL.
- FMCSA HazMat and restriction ingestion.
- Along-route truck stop search with crowd-sourced parking spots left.
- Offline state packages with restriction data.

Phase 2 checklist:
- Live weigh station status from state 511 systems.
- Swarm "bridge reported too low" layer.
- ELD/logbook integration.
- Fleet dispatch dashboard for web.

## Strong Recommendations

1. Do not position as "Google Maps for trucks." Position as "verified commercial-route intelligence."
2. Make route confidence visible: Official, Verified Driver Report, Community Report, Unverified.
3. Build a data-confidence engine from day one.
4. Treat official feeds as authoritative but not perfect; include timestamps, source links, and disclaimers.
5. Make last-mile dock/gate data a flagship feature.
6. Build driver reporting with photo/sign evidence, but moderate before affecting routing.
7. Add route-shaping tools: avoid this road, force via, prefer interstate, avoid downtown, avoid left turns when useful.
8. Offer a realistic subscription: free POI layer, paid navigation, fleet/team tier.
9. Build web first for dispatchers, mobile first for drivers.
10. Include safety disclaimers: drivers remain responsible for verifying road signs, permits, and legal compliance.
11. Add optional ELD/logbook integration so remaining drive time can filter parking, rest areas, and truck stops.
12. Keep active-navigation text minimal and rely on large icons, audio alerts, and high-contrast states.

## Design Direction

Colors:
- Dark pine: `#1A3C34` for reliability and commercial identity.
- Warning amber: `#F5A623` for bridge, restriction, and hazard alerts.
- Horizon blue: `#2C7DA0` for routes, active navigation, and calm system feedback.

Interface principles:
- High contrast night mode.
- Minimal active-navigation text.
- Amenity icons instead of long labels where the meaning is familiar.
- Large, glove-friendly touch targets.
- Voice-first warnings for safety-critical conditions.

## Data Source Strategy

Recommended source stack:
- Basemap/rendering: Mapbox GL JS for web and Mapbox Navigation SDK on mobile if licensing fits, with proprietary truck restriction overlays.
- Routing graph: OpenStreetMap seed plus Valhalla or heavily customized OSRM truck profiles.
- Do not rely on Google Maps API as the core truck-routing engine; use it only for selective geocoding or validation fallback if needed.
- Static national data: FHWA National Bridge Inventory, BTS/NTAD National Network, FMCSA HazMat Route Registry, NTAD truck parking.
- Jurisdictional overrides: state/province DOT, 511 APIs, WZDx feeds, ArcGIS REST services.
- Canadian priority: Alberta 511/road bans, Ontario 511 API, DriveBC/Open511 where available, provincial rest-area and seasonal-load feeds.
- POI enrichment: truck stop chains, cardlock networks, fleet-card providers, NREL alternative fuel API, OpenStreetMap as a QA/helper source.
- Community layer: driver reports, photos, parking updates, dock entrance notes, road sign confirmations.

Normalize all restrictions into:
`restriction_type`, `vehicle_applicability`, `max_height`, `max_weight`, `max_width`, `hazmat_class`, `seasonal_window`, `effective_start`, `effective_end`, `geometry`, `source_url`, `last_seen`, `confidence`, `jurisdiction`.

## Build Prompts

## Agent Team Architecture

Use this agent layout for the project:

```text
Orchestrator Agent - Project Lead
Synthesizes outputs, keeps product direction coherent, resolves conflicts.

MarketIntel Subagent
Skills: web research, competitor scan, review mining, sentiment analysis, source citation, market report generation.

ProductSpec Subagent
Skills: feature mapping, truck-routing requirements, technical architecture, data-source planning, constraint validation, risk analysis.

Naming & UX Subagent
Skills: brand ideation, competitor naming audit, domain/trademark pre-check prompts, UX pattern library, driver-first interface design.
```

Recommended workflow:
1. Orchestrator creates the research brief and assigns scoped tasks.
2. MarketIntel researches competitors, pricing, reviews, user complaints, and feature gaps.
3. ProductSpec converts market findings into MVP/v2/v3 features, technical constraints, and data architecture.
4. Naming & UX creates brand names, positioning, user journeys, wireframe prompts, and visual direction.
5. Orchestrator merges all outputs into one PRD, one investor/product summary, and one build prompt pack.

### Orchestrator Agent Prompt

You are the Orchestrator Agent and project lead for Overclear, a commercial truckers AI map for Android, iOS, CarPlay, Android Auto, and web. Your job is to coordinate MarketIntel, ProductSpec, and Naming & UX subagents. Maintain coherence across research, product requirements, technical architecture, UX, brand, and build prompts. Resolve contradictions, remove duplicate ideas, prioritize safety-critical trucking features, and produce final artifacts that a founder, designer, engineer, or AI coding agent can use.

Inputs:
- MarketIntel competitor and review report.
- ProductSpec feature and technical architecture report.
- Naming & UX brand and interface report.

Outputs:
- Executive summary.
- Market opportunity report.
- MVP/v2/v3 roadmap.
- Product requirements document.
- Technical architecture brief.
- Data-source strategy.
- UX/design brief.
- Naming shortlist and recommended name.
- Copy-ready build prompts.

Rules:
- Prioritize official DOT/511/government data for legal restrictions.
- Treat crowd reports as helpful but lower confidence than official sources.
- Never claim legal certainty for route compliance.
- Always include source links for market and data claims.
- Keep driver safety, readability, and trust above flashy features.

### MarketIntel Subagent Prompt

You are MarketIntel, a market research subagent for Overclear. Research commercial truck navigation and map products in North America. Analyze Trucker Path, Hammer, SmartTruckRoute, Sygic Truck & RV, CoPilot/Trimble, Garmin dezl, Low Clearance Map/HeadRoom, and route-optimization tools like RoadWarrior or Route4Me when relevant.

Find:
- Product positioning.
- Pricing.
- App ratings and review counts.
- What drivers like most.
- What drivers complain about.
- Feature gaps.
- Recent user-review examples from app stores, Reddit/forums, and review sites.
- Sources with links and dates when available.

Output:
- Competitor comparison table.
- Sentiment summary.
- Top 10 user-loved features.
- Top 10 complaints.
- Feature gaps and opportunity thesis for Overclear.
- Source list.

### ProductSpec Subagent Prompt

You are ProductSpec, a product and technical specification subagent for Overclear. Convert market findings into a complete product plan for a commercial truck navigation platform.

Cover:
- MVP features.
- v2/v3 features.
- Android, iOS, CarPlay, Android Auto, and web requirements.
- Truck profile fields: height, width, length, weight, axle count, trailer type, HazMat class, fuel/card network.
- Routing constraints: low bridges, narrow bridges, bridge/road weight limits, road bans, seasonal/frost restrictions, truck routes, HazMat restrictions, chain laws, construction closures.
- POIs: truck stops, pullouts, rest areas, commercial cardlocks, weigh stations, inspection stations, repair, tire, washout, DEF, showers, food, secure parking.
- Data architecture and source confidence model.
- API/backend architecture.
- Offline strategy.
- Safety and legal disclaimers.

Output:
- PRD.
- Feature matrix.
- Data schema recommendations.
- Technical stack recommendation.
- Routing engine recommendation.
- Risks and mitigations.

### Naming & UX Subagent Prompt

You are Naming & UX, a brand and interface subagent for Overclear. Create a trustworthy name, positioning, and UX direction for a commercial truck navigation product.

Find:
- 20 name candidates.
- Quick competitor-name audit.
- Recommended name with rationale.
- Tagline options.
- Brand tone.
- Visual direction.
- Driver-first UX principles.
- Key screens and flows.
- CarPlay/Android Auto interaction rules.
- Web dispatcher workflow.

Rules:
- Avoid names already strongly associated with trucking/navigation products.
- Avoid playful names that reduce safety trust.
- Prefer short, memorable, professional names.
- UI must be high contrast, readable, glove-friendly, and quick to understand at a glance.

Output:
- Naming shortlist.
- Recommended name.
- Taglines.
- UX principles.
- Screen list.
- Wireframe prompts.
- Design-system prompt.

### 1. Product Strategy Prompt

You are a senior product strategist for a North American commercial truck navigation startup named Overclear. Create a product requirements document for Android, iOS, CarPlay, Android Auto, and web. The app must include standard map/navigation features plus truck-specific routing based on height, width, length, weight, axle count, HazMat class, road bans, seasonal restrictions, bridge clearances, truck stops, pullouts, commercial cardlocks, and services along the route. Prioritize trust, official data sources, driver confidence, and safety. Include MVP scope, v2 scope, user personas, core workflows, monetization, risks, and success metrics.

### 2. UX/UI Design Prompt

Design Overclear, a professional truck navigation app for commercial drivers and dispatchers. Avoid a consumer tourist-map feel. The UI must be readable in-cab, high contrast, large touch targets, landscape-friendly, and CarPlay/Android Auto ready. Include screens for route planning, active navigation, truck profile, route risk audit, stop search, truck stop details, parking status, cardlock/fuel filters, road restriction alerts, saved facilities, and web dispatcher planning. Emphasize route confidence, official-source timestamps, and quick driver decisions.

### 3. Engineering Architecture Prompt

Act as a principal engineer. Design the technical architecture for Overclear. Include mobile apps, web app, routing engine, map tile strategy, truck constraint graph, official feed ingestion pipeline, POI database, community report moderation, AI route explanation service, offline maps, sync, push notifications, telemetry, and observability. Propose a stack using Mapbox GL JS on web, Mapbox Navigation SDK on mobile, Python/FastAPI scrapers, PostgreSQL/PostGIS, and a truck-aware routing engine such as Valhalla or customized OSRM. Include data schemas for restrictions, POIs, truck profiles, route audits, and user reports.

### 4. Data Ingestion Prompt

You are a geospatial data engineer. Build a data ingestion plan for commercial truck restrictions across the US and Canada. Prioritize official government/DOT/511/open-data sources. Normalize bridge height, bridge weight, narrow bridge, HazMat, chain law, seasonal road ban, frost law, construction, closure, truck route, rest area, truck parking, inspection station, and weigh station data. Create a jurisdiction registry, schema, refresh schedule, validation rules, confidence scoring model, and exception handling for stale or conflicting data.

### 5. AI Route Audit Prompt

You are the AI route safety auditor inside Overclear. Given a planned truck route and vehicle profile, produce a concise route-risk report. Identify low clearance risks, narrow/weight-restricted bridges, HazMat restrictions, seasonal road bans, construction closures, chain-law areas, missing data zones, questionable last-mile turns, truck stop options, and parking/fuel recommendations. Explain every warning with a confidence level and source timestamp. Never claim legal certainty; instruct the driver to obey posted signs and permit requirements.

### 6. Mobile MVP Build Prompt

Build the MVP of Overclear as a truck route planning app. Include truck profile input, map search, route planning, route alternatives, truck-stop/pullout/cardlock POIs, stop filters, risk badges, and a route audit panel. Use mocked restriction data first, but design the APIs and database so official feeds can be attached later. The app should feel like a serious operations tool for drivers, not a marketing landing page.

## Source Links Used

- Trucker Path App Store: https://apps.apple.com/us/app/trucker-path-truck-gps-fuel/id782746890
- Hammer App Store: https://apps.apple.com/us/app/hammer-truck-gps-maps/id1478863996
- Hammer Google Play: https://play.google.com/store/apps/details?id=com.truckersreport.hammer
- SmartTruckRoute App Store: https://apps.apple.com/us/app/smarttruckroute-truck-gps/id580967260
- FHWA National Bridge Inventory: https://www.fhwa.dot.gov/bridge/nbi.cfm
- FHWA NBI downloads: https://www.fhwa.dot.gov/bridge/nbi/ascii.cfm
- FMCSA HazMat Route Registry: https://www.fmcsa.dot.gov/regulations/hazardous-materials/national-hazardous-materials-route-registry
- Alberta road restrictions and bans: https://www.alberta.ca/road-restrictions-and-bans-overview
- Alberta road bans: https://www.alberta.ca/road-bans
- Ontario 511 API docs: https://511on.ca/developers/doc
- Idaho 511 API docs: https://511.idaho.gov/developers/doc
- WSDOT commercial vehicle restrictions: https://wsdot.wa.gov/travel/commercial-vehicles/route-commercial-vehicle-restrictions
- 511 SF Bay open data: https://511.org/open-data
- USDOT WZDx: https://www.transportation.gov/av/data/wzdx
- NREL Alternative Fuel Stations API: https://developer.nrel.gov/docs/transportation/alt-fuel-stations-v1/
- Low Clearance Map / HeadRoom: https://lowclearancemap.com/
