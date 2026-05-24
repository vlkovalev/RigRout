# Product Requirements Document: Commercial Truckers AI Map

Working product name: **Overclear**

Platform: Android, iOS, Web/PWA

Date: 2026-05-09

## 1. Executive Summary

Overclear is a cross-platform navigation product for professional truck drivers and dispatchers. It provides Google Maps-level navigation basics plus commercial-vehicle-specific routing based on truck dimensions, weight, axle count, HazMat status, official road restrictions, bridge clearances, road bans, weather events, truck stops, cardlocks, rest areas, pullouts, weigh stations, and driver-reported parking conditions.

The core differentiator is **live clearance and stop intelligence**. Instead of simply giving directions, the app explains why a route is truck-safe, shows overhead and restriction risks, helps drivers find safe parking before they run out of time, and labels data by source confidence: official DOT/511, verified commercial source, moderated driver report, or unverified community report.

Tagline: **Know what's overhead. Know where to stop.**

Market gap:
No leading app cleanly combines live DOT scraping, vehicle dimension input, commercial card lock locating, and community parking data with a modern driver-first UI.

Market signals to preserve:
- Drivers love parking availability at difficult hours, accurate low-clearance avoidance, community amenity updates, weigh station status, and HazMat-aware routing.
- Drivers hate stale data, subscription fatigue, low-signal crashes, missing temporary road bans, and weak support for empty vs. loaded or multi-stop profile changes.

## 2. Target Users

Primary users:
- OTR truck drivers.
- Regional/local delivery drivers.
- Owner-operators.
- Heavy haul and oversize/overweight drivers.
- HazMat drivers.

Secondary users:
- Dispatchers.
- Fleet safety managers.
- Route planners.
- Small carriers.

## 3. Goals

- Reduce unsafe or illegal commercial vehicle routing.
- Help drivers avoid low/narrow bridges, restricted roads, non-truck roads, and seasonal bans.
- Improve trip planning around truck stops, cardlocks, rest areas, pullouts, weigh stations, and parking.
- Provide reliable offline navigation with downloaded restriction data.
- Give dispatchers a web planner that syncs routes to mobile.
- Build driver trust through transparent source attribution and freshness timestamps.
- Reduce stale-data failures by showing last-updated timestamps and source confidence on every critical restriction and POI.

## 4. Non-Goals

- The product does not issue oversize/overweight permits in MVP.
- The product does not guarantee legal compliance; drivers must obey posted signs and official permit routing.
- The product does not replace ELD/HOS systems in MVP.
- The product does not become a general consumer social map.

## 5. Core User Stories

### Navigation Basics

- As a truck driver, I want turn-by-turn voice navigation so that I can keep my eyes on the road.
- As a truck driver, I want live traffic conditions so that I can avoid congestion and delays.
- As a truck driver, I want accurate ETA calculations so that I can plan appointments, breaks, and fuel stops.
- As a truck driver, I want to search by address, business name, coordinates, or dropped pin so that I can route to shippers, receivers, yards, and remote sites.
- As a truck driver, I want offline map regions so that navigation continues when cellular service drops.
- As a truck driver, I want satellite, hybrid, and terrain views so that I can inspect facility entrances, road width, grades, and turn geometry.
- As a truck driver, I want rerouting to keep working in low signal so that the app does not fail when I need it most.

### Truck Profile and Routing

- As a truck driver, I want to enter vehicle height so that routing avoids low bridges.
- As a truck driver, I want to enter vehicle width so that routing avoids narrow roads and narrow bridges.
- As a truck driver, I want to enter vehicle length so that routing avoids tight turns and unsuitable roads.
- As a truck driver, I want to enter current weight and axle count so that routing avoids restricted bridges and weight-limited roads.
- As a HazMat driver, I want to select my HazMat class so that routing avoids prohibited tunnels, bridges, and roads.
- As an owner-operator, I want to save multiple truck/trailer profiles so that I can switch quickly between configurations.
- As a truck driver, I want an empty vs. loaded toggle so that route planning can account for height and handling changes between configurations.
- As a truck driver, I want multi-stop planning with per-stop profile changes so that the app can plan differently before and after pickup or delivery.
- As a heavy-haul driver, I want a route-risk report before departure so that I can verify problem segments before moving.

### Truck Data Layers

- As a truck driver, I want to toggle truck stops on the map so that I can find fuel, food, showers, and overnight stops.
- As a truck driver, I want to filter truck stops by amenities so that I can find showers, laundry, restaurants, repair, tire service, scales, DEF, washouts, or secure parking.
- As a truck driver, I want to see pullouts and rest areas with safe parking estimates so that I can plan legal breaks.
- As a truck driver, I want to see commercial cardlock locations so that I can fuel using my accepted card network.
- As a truck driver, I want to see weigh stations with open/closed status so that I can prepare before reaching them.
- As a truck driver, I want low bridges highlighted with exact height clearance so that I can verify safety before routing.
- As a truck driver, I want narrow-road warnings so that I can avoid roads that are technically legal but impractical.

### Live Restrictions

- As a truck driver, I want live road ban updates so that I can avoid roads closed to my vehicle or load.
- As a truck driver, I want chain-law and winter restriction alerts so that I can prepare for mountain passes and seasonal enforcement.
- As a HazMat driver, I want current HazMat restrictions so that I can avoid prohibited corridors.
- As a city delivery driver, I want time-based local delivery restrictions so that I do not enter restricted zones during prohibited hours.
- As a dispatcher, I want route restrictions refreshed hourly so that planned routes reflect current road conditions.

### Crowd/Swarm Intelligence

- As a truck driver, I want to report parking availability so that other drivers know whether spots remain.
- As a truck driver, I want to see a confidence score for parking counts so that I know whether the estimate is fresh.
- As a truck driver, I want to ask "where can I park within two hours of my destination?" so that I can plan legal rest before arriving in a crowded area.
- As a truck driver, I want to report incorrect road or POI data with a photo so that the app improves over time.
- As a truck driver, I want to report hazards by voice so that I can mark a low branch, pothole, or unsafe turn without taking my hands off the wheel.
- As a safety manager, I want community reports moderated before changing routing rules so that unsafe false reports do not affect drivers.

### Web/PWA Planning

- As a dispatcher, I want to plan a route on desktop so that I can review restrictions and send it to a driver.
- As a driver, I want routes planned on web to sync to my phone so that I can start navigation in the cab.
- As a dispatcher, I want to compare route options by time, distance, tolls, risk, fuel stops, and restriction confidence so that I can choose the safest route.

## 6. Functional Requirements

### 6.1 Map and Navigation

Required:
- Turn-by-turn voice navigation.
- Realtime traffic overlay.
- ETA and arrival-time calculations.
- Rerouting around traffic, closures, and restrictions.
- Search by address, business, coordinates, truck stop, cardlock, rest area, weigh station.
- Offline downloadable regions.
- Satellite, hybrid, terrain, and standard map layers.
- Multi-stop routing.
- Route alternatives.
- Avoidances: tolls, ferries, unpaved roads, downtown areas, U-turns, specific roads.

### 6.2 Truck Profile

Required fields:
- Vehicle height.
- Vehicle width.
- Vehicle length.
- Tractor/trailer type.
- GVW/current weight.
- Axle count.
- HazMat class.
- Empty/loaded state.
- Preferred fuel type.
- Preferred fuel/card networks.
- Chain-equipped flag.

Phase 2:
- Multiple axle spacing profiles.
- Permit number and permit route attachment.
- Oversize/overweight route import.
- Reefer/electric plug needs.

### 6.3 Truck-Specific Routing

Routing engine must consider:
- Low bridge clearance.
- Bridge/road weight limits.
- Narrow bridge/road constraints.
- Truck-restricted roads.
- National/state/provincial truck networks.
- HazMat restrictions.
- Seasonal/frost/road bans.
- Chain-law zones.
- Construction and closures.
- Local delivery time windows.
- Restricted urban corridors.

Route output must include:
- Total distance.
- ETA.
- Truck-risk score.
- Restriction warnings.
- Alternative routes.
- Explanation of key route decisions.
- Source/freshness for critical restrictions.
- Reverse parking results within a driver-selected time or distance window.

### 6.4 Data Layers

Togglable layers:
- Truck stops.
- Rest areas.
- Pullouts.
- Commercial cardlocks.
- Weigh stations.
- Inspection stations.
- Low bridges.
- Narrow roads.
- Weight-restricted roads/bridges.
- HazMat restrictions.
- Road bans.
- Construction/closures.
- Chain-law/winter restrictions.
- Weather/wind alerts.
- Truck parking confidence.

### 6.5 Truck Stop and POI Details

Each truck stop/cardlock/rest area should support:
- Name.
- Brand/network.
- Address.
- Coordinates.
- Phone.
- Hours.
- Fuel types.
- Accepted card networks.
- Diesel/DEF availability.
- Showers.
- Laundry.
- Restaurant/food.
- Repair shop.
- Tire service.
- CAT/public scale.
- Truck wash/washout.
- Overnight parking.
- Reserved parking.
- Security/lighting.
- Reefer/electric plug.
- User photos.
- Driver reviews.
- Parking estimate: plenty/limited/full plus numeric count where available.
- Last updated timestamp.

### 6.6 Community Reporting

Drivers can report:
- Parking spots left.
- Weigh station open/closed.
- Incorrect bridge/road data.
- New road restriction signs.
- Road closure/construction.
- Truck stop amenity changes.
- Shower wait times.
- Temporary hazards such as potholes, low branches, unsafe shoulders, or blocked lanes.
- Unsafe turn/entrance.
- Better truck entrance/dock routing.

Moderation:
- Low-risk reports can update POI display quickly.
- Safety-critical reports require confidence scoring and moderation before affecting routing.
- Reports with photos/geolocation receive higher confidence.
- Repeated trusted-driver reports increase confidence.

## 7. MVP Feature List

MVP must include:
- Android and iOS app.
- Web/PWA trip planner.
- Mapbox GL JS on web and Mapbox Navigation SDK on mobile, with proprietary truck data overlay.
- Search by address/business/coordinates.
- Standard turn-by-turn navigation.
- Truck profile input: height, width, length, weight, axle count, HazMat.
- Empty vs. loaded toggle.
- Basic truck route calculation.
- Low bridge and restricted-road warnings.
- Truck stop/rest area/cardlock POIs.
- Amenities filters.
- Weigh stations.
- Parking status: plenty/limited/full via driver reports.
- Along-route truck stop search with parking spots left where crowd data is available.
- Offline maps for selected regions.
- Offline state restriction packages.
- Route-risk report.
- Hourly ingestion framework for official feeds, starting with CA, TX, FL, NY, and IL.
- Source confidence labels.

## 8. Phase 2 Features

Phase 2:
- CarPlay and Android Auto.
- Advanced route shaping: avoid road, force via, prefer highway, avoid urban core.
- Last-mile dock/gate routing with satellite preview.
- HazMat-specific route registry ingestion.
- Chain-law and high-wind corridor alerts.
- Frost law/seasonal road bans.
- Smart fuel planning by card network and price.
- Predictive parking availability.
- Live weigh station status from state 511 systems where available.
- Swarm "bridge reported too low" layer.
- ELD/logbook integration to filter stops by remaining drive time.
- Driver trust score for reports.
- Fleet/dispatcher accounts.
- Route sharing from dispatch to driver.
- IFTA mileage export.
- Border crossing details.
- Permit route attachment and warning.

Phase 3:
- Full oversize/overweight planning assistant.
- AI dispatch route audit.
- Voice assistant: "Find safe parking within 45 minutes."
- Integration with ELD/HOS providers.
- Fleet analytics dashboard.
- Commercial POI licensing partnerships.
- Insurance/safety reporting.

## 9. Technical Architecture Recommendations

### Client Apps

Mobile:
- React Native for shared Android/iOS code, or native Swift/Kotlin if maximum navigation performance is required.
- Native navigation module for background GPS, voice prompts, offline maps, and CarPlay/Android Auto.
- Local SQLite/MBTiles storage for offline maps and restrictions.

Web:
- Progressive Web App.
- Desktop route planner.
- Map interaction optimized for dispatcher workflows.
- Sync routes to mobile account.

### Map Engine

Recommended base:
- Mapbox GL JS for web rendering.
- Mapbox Navigation SDK for mobile navigation if licensing and offline requirements fit.
- OpenStreetMap as the canonical road graph seed for truck constraint processing.
- Vector tiles generated from OSM and custom truck layers.

Routing options:
- Valhalla for multimodal/custom-cost routing and truck constraints.
- OSRM only if custom truck constraints are heavily extended internally.
- OpenRouteService as a useful open-source truck-profile reference or validation path.
- GraphHopper as alternative for commercial routing APIs and truck profile support.
- Do not rely on Google Maps API as the core truck-routing engine; its commercial routing should be treated as a fallback or comparison layer, not the source of truth.

### Backend

Core services:
- User/auth service.
- Truck profile service.
- Route planning service.
- Restriction data service.
- POI service.
- Community reports service.
- Notification service.
- Offline package service.
- Data ingestion/ETL service.
- AI route audit service.

Suggested stack:
- API: Python/FastAPI for scraper and geospatial iteration, with Node.js/NestJS or Go as alternatives if the team prefers.
- Geospatial database: PostgreSQL + PostGIS.
- Search: OpenSearch/Elasticsearch plus geocoder.
- Queues: Kafka, RabbitMQ, or SQS.
- Cache: Redis.
- Object storage: S3-compatible storage for map packages, photos, and offline bundles.
- Tile server: TileServer GL or custom vector tile service.
- Scraping: BeautifulSoup for static DOT/511 pages and Selenium/Playwright only for JS-heavy state sites.
- Hosting: AWS Lambda for hourly scraper jobs; EC2/ECS for routing services that need persistent compute.

### Data Refresh

Refresh cadence:
- DOT/511 events: every 5-15 minutes where API permits.
- Road restrictions/road bans: hourly.
- Bridge/static restrictions: daily/weekly unless source updates faster.
- POIs: daily plus driver reports.
- Parking status: real-time/community-driven.
- Offline packages: update deltas daily or on app launch.

Initial DOT/511 scraping priority:
- California.
- Texas.
- Florida.
- New York.
- Illinois.

## 10. API and Data Source Recommendations

### U.S. Official/Public Sources

- FHWA National Bridge Inventory: bridge inventory baseline.
- BTS/NTAD National Network: federal truck network baseline.
- FMCSA National Hazardous Materials Route Registry: HazMat routing constraints.
- State DOT and 511 APIs: events, closures, restrictions, road conditions.
- WZDx feeds: work zones and construction closures.
- State ArcGIS REST services: truck routes, bridge restrictions, clearances.
- 511NY, Idaho 511, 511 SF Bay, Caltrans, WSDOT examples for state data.
- NREL Alternative Fuel Stations API: alternative fuels and some commercial fueling context.
- FHWA/BTS truck parking datasets where available.

### Canada Official/Public Sources

- Alberta 511 and Alberta road bans/restrictions.
- Ontario 511 API: events, road conditions, truck rest areas, inspection stations, seasonal loads.
- DriveBC/Open511 where available.
- Provincial rest-area and commercial vehicle restriction pages.
- Provincial oversize/overweight permit portals.

### Commercial/Private Sources

Recommended partnerships:
- Love's.
- Pilot/Flying J.
- TA/Petro.
- One9.
- CFN.
- Petro-Pass.
- Comdata/EFS/fleet card networks.
- CAT Scale.
- Truck stop data aggregators.
- Low-clearance specialty datasets if licensing is available.

## 11. Data Model Recommendations

### Restriction

Fields:
- id
- restriction_type
- geometry
- road_name
- jurisdiction
- vehicle_applicability
- max_height
- max_width
- max_length
- max_weight
- axle_count_limit
- hazmat_class
- effective_start
- effective_end
- seasonal_window
- source_name
- source_url
- last_seen
- confidence
- affects_routing

### Truck POI

Fields:
- id
- type
- brand
- name
- location
- address
- phone
- hours
- amenities
- fuel_types
- accepted_cards
- parking_total
- parking_available_estimate
- parking_confidence
- last_driver_report_at
- source
- source_confidence

### Truck Profile

Fields:
- id
- user_id
- name
- height
- width
- length
- weight
- axle_count
- trailer_type
- hazmat_class
- empty_loaded_state
- fuel_type
- preferred_card_networks
- chain_equipped

### Route Audit

Fields:
- route_id
- truck_profile_id
- risk_score
- warnings
- restricted_segments
- low_clearance_segments
- weight_restricted_segments
- hazmat_conflicts
- stale_data_zones
- recommended_stops
- source_summary

## 12. UX and Design Requirements

- Large touch targets for in-cab use.
- High-contrast day/night modes, including a dashboard-friendly night mode.
- Minimal active-navigation text; use icons for amenities, warnings, and stop attributes.
- Important warnings must be voice-first and glanceable.
- Lock screen and CarPlay/Android Auto glance: distance to next safe parking and confidence of availability.
- Hands-free audio alerts for upcoming low clearance, road bans, HazMat restrictions, and chain-law changes.
- Reverse route planning: "Find parking within 2 hours of destination" with legal drive-time filters when ELD is connected.

Recommended visual direction:
- Dark pine: `#1A3C34` for reliability and commercial identity.
- Warning amber: `#F5A623` for bridge/restriction alerts.
- Horizon blue: `#2C7DA0` for navigation, routes, and calm system feedback.

## 13. Success Metrics

MVP:
- Route planning success rate.
- Navigation completion rate.
- Crash-free sessions.
- Offline package download/use rate.
- Driver reports per 1,000 miles.
- POI correction acceptance rate.
- Percent of routes with restriction audit generated.

Safety/trust:
- Number of avoided low-clearance conflicts.
- User-rated route trust score.
- Reduction in "bad route" reports per 1,000 routes.
- Median freshness of official restriction data.
- Percentage of safety-critical warnings with official source attribution.

Business:
- Free-to-paid conversion.
- Monthly active drivers.
- Retention after 30/90 days.
- Cost per route calculation.
- Fleet account adoption.

## 14. Safety and Compliance Requirements

- Display disclaimer: routing is advisory; obey posted signs and official permits.
- Safety-critical warnings must show source and timestamp.
- Do not update route-blocking restrictions from a single unverified driver report.
- Provide "report wrong restriction" and "report unsafe route" actions.
- Avoid distracting prompts during active navigation.
- Voice warnings must be concise and early enough for commercial stopping distance.

## 15. Risks and Mitigations

Risk: Official data is fragmented and inconsistent.
Mitigation: Build jurisdiction registry, confidence model, source freshness, and overrides.

Risk: Community reports can be wrong or malicious.
Mitigation: Moderate safety-critical reports and weight trusted drivers higher.

Risk: Truck routing liability.
Mitigation: Disclaimers, source labels, audit trails, conservative routing, and driver verification UX.

Risk: Offline data becomes stale.
Mitigation: Show offline package age and require periodic refresh for restriction-heavy regions.

Risk: Map/routing cost.
Mitigation: Start OSM/Valhalla/custom OSRM with Mapbox rendering, and use commercial APIs only for geocoding, rendering, or validation where needed.

## 16. Launch Recommendation

Start with a corridor-focused pilot instead of all North America. Recommended first regions:
- Official scraping pilot: CA, TX, FL, NY, and IL, because these states cover high commercial-traffic complexity and match the MVP ingestion requirement.
- Alberta/British Columbia/Ontario for Canadian commercial restrictions.
- Washington/Idaho/Montana/North Dakota/Minnesota for cross-border western freight.

Build trust by launching with fewer regions but better official restriction coverage.
2. Add “Why this route?” UI

This could become a signature feature.

Example:

Route avoids:

12’9” bridge on County Rd 14
seasonal 8-ton restriction
HazMat tunnel restriction

Drivers will trust transparent systems more.

3. Add “Practical Risk” layer

Important distinction:

legally allowed
practically dangerous

Examples:

tight turns
impossible fuel station exits
narrow shoulder
steep approach
low tree canopy

This becomes a huge differentiator.

4. Add “verified truck path”

Extremely valuable.

A route segment gains confidence when:

many trucks successfully traverse it
verified fleets use it
no hazard reports exist

This becomes real-world freight intelligence.

Revenue Model Recommendation
Best approach
This is a strong PRD. It already reads closer to a Series A–ready operational specification than a typical startup concept document.

The biggest strength is that **Overclear is solving operational trust**, not just navigation. That matters because professional drivers already have navigation apps. What they *don’t* have is high-confidence commercial routing with live restriction intelligence and parking certainty.

# What You Got Right

## 1. The differentiation is real

“Truck GPS” alone is crowded.

But this combination is much stronger:

* Official DOT + 511 ingestion
* Commercial constraints
* Parking intelligence
* Source confidence scoring
* Reverse parking search
* HazMat + seasonal bans
* Empty vs loaded routing logic

That moves Overclear toward:

* operational safety platform
* freight movement intelligence
* compliance-aware routing

instead of “another GPS.”

---

# Most Valuable Features (Strategically)

These are likely your highest-retention features:

| Feature                     | Why It Matters                |
| --------------------------- | ----------------------------- |
| Low-clearance avoidance     | Immediate trust               |
| Parking availability        | Massive pain point            |
| Route-risk audit            | Fleet/safety value            |
| Source freshness            | Solves stale-data frustration |
| Reverse parking planning    | Extremely driver-centric      |
| Empty vs loaded             | Advanced operational realism  |
| Community + official hybrid | Hard to replicate quickly     |

---

# Biggest Competitive Advantage

Your real moat is probably NOT maps.

It’s:

## Restriction intelligence graph

Over time you can build:

* verified truck-safe roads
* restriction confidence scoring
* driver-trusted POIs
* real-world truck geometry intelligence
* stop reliability scoring

That becomes proprietary.

---

# What Existing Players Still Miss

You correctly identified gaps.

Most competitors fail at one or more:

* stale restrictions
* poor parking visibility
* weak Canadian support
* low confidence transparency
* oversize/weight nuance
* temporary bans
* practical routing vs “legal but impossible”

Professional drivers care about:

> “Can I ACTUALLY get through there?”

not:

> “Does the algorithm technically allow it?”

That distinction is critical.

---

# Architecture Review

Your architecture choices are solid.

## Strong choices

* PostgreSQL + PostGIS
* Valhalla
* Mapbox rendering
* OSM base graph
* Offline-first
* Vector tiles
* ETL ingestion layer

These are all enterprise-grade decisions.

---

# Biggest Technical Challenges

## 1. Data normalization

This is the hardest problem.

Every state/province formats:

* clearances
* bans
* restrictions
* ArcGIS feeds
* events

differently.

You’ll need:

* canonical restriction schema
* ingestion adapters
* conflict resolution
* confidence engine

This is a major engineering effort.

---

## 2. Routing correctness

Truck routing is MUCH harder than consumer routing.

You must combine:

* legal constraints
* practical geometry
* temporary events
* HazMat
* axle logic
* seasonal logic
* local delivery exceptions

Bad truck routes destroy trust immediately.

---

## 3. Parking prediction

This is a difficult ML + crowdsourcing problem.

You’ll eventually need:

* historical occupancy patterns
* arrival probability modeling
* day-of-week weighting
* holiday weighting
* weather correlation
* event correlation

But MVP crowd estimates are enough initially.

---

# What I Would Change

## 1. Narrow MVP further

Current MVP is still very ambitious.

I’d focus on:

### Core MVP

* truck routing
* low clearances
* restrictions
* truck stops
* parking reports
* route audit
* offline

Skip initially:

* advanced HazMat logic
* predictive parking
* AI audit
* complex fleet tooling
* chain-law automation

---

# 2. Add “Why this route?” UI

This could become a signature feature.

Example:

> Route avoids:
>
> * 12’9” bridge on County Rd 14
> * seasonal 8-ton restriction
> * HazMat tunnel restriction

Drivers will trust transparent systems more.

---

# 3. Add “Practical Risk” layer

Important distinction:

* legally allowed
* practically dangerous

Examples:

* tight turns
* impossible fuel station exits
* narrow shoulder
* steep approach
* low tree canopy

This becomes a huge differentiator.

---

# 4. Add “verified truck path”

Extremely valuable.

A route segment gains confidence when:

* many trucks successfully traverse it
* verified fleets use it
* no hazard reports exist

This becomes real-world freight intelligence.

---

# Revenue Model Recommendation

## Best approach

### Freemium

Free:

* basic truck routing
* limited offline
* basic POIs

Pro Driver ($15–25/month):

* advanced restrictions
* parking intelligence
* route audit
* offline bundles
* weather/chain alerts

Fleet:

* dispatcher portal
* compliance
* route syncing
* analytics

---

# Go-To-Market

## Best initial strategy

Do NOT launch nationwide immediately.

You already identified this correctly.

Start with:

* Alberta/BC freight corridors
* I-5
* I-90
* Western Canada cross-border

Reasons:

* concentrated freight
* mountain/weather complexity
* parking pain
* fewer jurisdictions initially

---

# Smart Strategic Opportunity

## Insurance + safety scoring

Eventually:

* safer routes
* lower incident probability
* bridge-strike reduction
* compliance scoring

could interest:

* insurers
* fleets
* brokers

This is potentially a large enterprise revenue stream.

---

# Long-Term Vision

Overclear could evolve into:

## “Operational intelligence layer for commercial road freight”

Not just:

* navigation

But:

* safety
* compliance
* routing
* parking
* restriction intelligence
* dispatch planning
* risk auditing

That’s a much bigger category.

---

# What Investors Would Likely Ask

Prepare answers for:

* How do you verify restriction accuracy?
* What happens when official data conflicts?
* How do you handle liability?
* Why won’t incumbents copy this?
* How expensive is routing compute?
* How do you acquire drivers?
* What is your cold-start parking strategy?

---

# Highest-Risk Area

The biggest existential risk is:

## Trust collapse from one catastrophic bad route

A single viral:

* bridge strike
* trapped truck
* illegal HazMat route

can heavily damage reputation early.

So:

* conservative routing
* explainability
* freshness indicators
* human review
* fallback warnings

are absolutely essential.

---

# Overall Assessment

This is substantially above average for an early-stage product definition.

The PRD shows:

* operational domain understanding
* real trucking pain points
* infrastructure thinking
* scalable architecture awareness
* data trust awareness

Most importantly:
you are building around **commercial-driver trust**, which is the right foundation for this category.

The strongest phrase in the whole document is probably:

> “Know what's overhead. Know where to stop.”

That communicates:

* safety
* clarity
* operational usefulness
* trucking specificity

very effectively.
