# RigRout — Pre-Publishing Critical Review

**Scope reviewed:** `rigrout.html` (3,032 lines), `rigrout-server.js` (596 lines), `Commercial_Truckers_AI_Map_PRD.md`, `Commercial_Truckers_AI_Map_Project_Prompts.md`, git history/state, and a live boot test of the Node server in an isolated sandbox.

**What was actually tested vs. reviewed:**
- **Tested (ran the code):** Node server boot (`node rigrout-server.js`), `/api/status`, `/api/layers`, static file serving of `rigrout.html` — all confirmed working at the HTTP level.
- **Not tested:** The 24 external DOT/511 feeds, Overpass/Nominatim/OSRM calls, and full in-browser rendering — the sandbox has no outbound DNS/internet access (`getaddrinfo EAI_AGAIN`), so live feed behavior and visual rendering could not be exercised. Everything below on those points is a **code-level determination** (I read the exact fetch calls, URLs, and fallback branches), not a live click-through. If you want a true click-through test (console errors, visual layout, mobile viewport), I can do that via the Chrome extension if you open `http://localhost:3001/rigrout.html` with the server running — say the word and I'll drive it.

---

## 1. Executive Verdict

**Do not publish yet.**

**Overall score: 4/10** — as a personal/internal prototype this is a genuinely impressive single-evening build (24 government feeds wired up, a full truck-profile UI, live incident reporting, route sharing). As a public-facing product called "Commercial Route Intelligence," it currently over-promises relative to what the code does, and its flagship features silently stop working the moment it leaves your machine.

**Biggest reason for the verdict:** The single differentiator this product is named after — truck-safe routing and live restriction intelligence — doesn't exist yet in the shipped code. Routes are plain car directions from a public demo OSRM server (the app's own sidebar text admits "no truck constraints yet"), and the 24 live-feed road-ban system only works if a Node server is running *on the same machine as the browser*. Publish this as a link and most of what makes it "RigRout" instead of "a map" goes dark.

**Top 3 critical blockers:**
1. **No truck-aware routing exists.** `planRoute()` calls `router.project-osrm.org` (a public car-routing demo server) with zero vehicle-dimension constraints. The "Route Risk Audit" is an informational overlay computed *after* the route is drawn — it doesn't reject or reroute around low bridges, it just tells you about them afterward.
2. **The core live-data feature is single-machine-only.** `API_BASE = 'http://localhost:3001'` is hardcoded. Road bans, DMS signs, road conditions, and the server-side route audit all require a Node process running on the *visitor's own computer*. There's no fallback for bans/signs/conditions that will actually work in a browser due to CORS (most state 511 sites don't allow direct browser calls — that's the documented reason the proxy server exists).
3. **Two features actively lie to the user.** "Send Feedback" has a code comment reading `// No backend — just acknowledge` — it shows "Feedback received. Thank you!" and discards the message. "Report a Hazard" (`submitIncident()`) writes only to the reporting driver's own `localStorage` — the UI copy says "Help fellow drivers on this corridor," but no other driver will ever see it. This is the exact kind of shipped dishonesty that erodes trust fastest with the professional-driver audience this PRD is built around.

---

## 2. Critical Issues Table

| Severity | Issue | Where it appears | Why it matters | Exact fix |
|---|---|---|---|---|
| Critical | No truck-constrained routing engine | `planRoute()`, line ~2121, hits `router.project-osrm.org/route/v1/driving/...` | This is the entire product thesis. Right now RigRout gives the same route Google Maps would, then bolts on warnings after the fact. A driver could plan a route, see no red flags in the sidebar copy, and still get routed under a bridge the height check never ran against. | Either (a) integrate a truck-profile-aware routing engine (Valhalla/OSRM custom truck profile/GraphHopper) per the PRD's own recommendation, or (b) if that's Phase 2, relabel the product honestly right now: "Route Preview (car-routing) + Truck Restriction Overlay" — don't call it "Commercial Route Intelligence" until routing itself respects the profile. |
| Critical | Flagship "24 live feeds" only work with a local server running | `API_BASE='http://localhost:3001'`, `fetchRoadBans()`, `handleSigns`, `handleConditions`, `handleRouteAudit` | State DOT/511 sites generally don't send CORS headers permitting browser JS from arbitrary origins — that's *why* the Node proxy exists (see `rigrout-server.js` comment: "no CORS issues"). If you publish this HTML anywhere (GitHub Pages, a real domain) without every visitor also running `node rigrout-server.js` locally, bans/signs/conditions/route-audit will silently fail for 100% of visitors except you. | Stand up the Node server on a real host (Render/Fly/a VPS) behind a real domain, point `API_BASE` at it, add auth/rate-limiting, and cache aggressively so you don't get the shared IP banned by Overpass/511 endpoints. This is a hosting/infrastructure decision that has to happen before "publish." |
| Critical | Marker-cluster assets are untracked in git | `git status`: `MarkerCluster.Default.css`, `MarkerCluster.css`, `leaflet.markercluster.js` are **untracked**; `rigrout.html`/`rigrout-server.js` show **modified, uncommitted** | Anyone who clones `github.com/heliu/rigrout` right now gets an app missing 3 files that `rigrout.html` `<link>`/`<script>`-tags require. That throws a hard JS error (`L.markerClusterGroup is not a function`) and breaks every POI layer (truck stops, rest areas, cardlocks, weigh stations, etc.) — the whole point of the map. | `git add -A && git commit -m "..." && git push` before telling anyone to look at the repo. Also commit the pending edits to `rigrout.html`/`rigrout-server.js` — the public repo is currently a stale/broken snapshot of an earlier state. |
| Critical | "Send Feedback" silently discards every message | `submitFeedback()`, code comment: `// No backend — just acknowledge` | The UI shows a green checkmark and "Feedback received. Thank you!" No message is ever transmitted anywhere. A driver who reports a safety-critical bug will believe you received it. You will never see it. This is the single fastest way to lose the trust this whole product is built on. | Either wire it to a real endpoint (email webhook, Google Form via `fetch`, a `/api/feedback` route with disk/DB logging) or remove the fake confirmation and be honest that it's not implemented yet. |
| Critical | Hazard/incident reports never leave the reporter's browser | `submitIncident()` → `localStorage.setItem('rigrout_incidents', ...)` only, no network call | PRD user story: *"As a truck driver, I want to report parking availability so that other drivers know whether spots remain."* Modal copy literally says "Help fellow drivers on this corridor." Neither is true — reports are private to one browser/device and vanish after 4 hours or a cache clear. This is a materially false claim in the shipped UI, not just a missing feature. | Either build the minimal community-reporting backend (even a simple shared JSON store behind the existing Node server would beat nothing) before launch, or change the copy to "Save a personal note for your own future trips" and drop "help fellow drivers" until it's actually shared. |
| High | Zero PWA support despite PRD requiring "Web/PWA" as an MVP platform | No `manifest.json`, no service worker, no offline caching anywhere in the repo | PRD section 7 (MVP) explicitly lists "Web/PWA trip planner" and "offline downloadable regions" as required. Right now this is a plain HTML page with no offline capability at all — it fails if the connection drops mid-session, which is the exact failure mode drivers complained about in your own market research ("crashes or poor recalculation in low-signal areas"). | Add a minimal `manifest.json` + service worker (even just app-shell caching of the HTML/CSS/JS/marker assets) so it's installable and doesn't go fully blank on a dropped connection. |
| High | Zero accessibility attributes | `grep` for `alt=`, `aria-` across the whole file: **0 matches each** | Screen-reader users get nothing; status is conveyed only by color (green/red dots for server status, ban severity, layer state) with no text equivalent. Also directly contradicts the PRD's own UX requirement for glanceable, high-contrast, non-color-only signaling. | Add `aria-label`s to icon-only buttons (📍, 🚨, ☰, etc.), `alt` text to the brand-logo `<img>` tags, and a non-color indicator (icon/text) next to every color-coded status dot. |
| High | UI text sizes contradict the product's own design brief | CSS throughout uses 8–13px fonts for buttons/badges/labels (`.badge{font-size:10px}`, `.risk-sec-title{font-size:10px}`, etc.) | The PRD/brief explicitly demand "Large touch targets for in-cab use," "large, glove-friendly touch targets," "minimal active-navigation text… high-contrast." An 8–10px badge is unreadable at arm's length in a moving cab and effectively untappable with a gloved finger. | Raise interactive-element minimum font size to 14–16px and minimum touch target to ~44px per Apple/Google HIG, at least for anything reachable during "active navigation" — sidebar chrome for a desk-bound dispatcher can stay small. |
| High | Public demo APIs used as production infrastructure | `router.project-osrm.org` (routing), `overpass-api.de` + 2 mirrors (POI/restrictions), `nominatim.openstreetmap.org` (geocoding) | All three are explicitly **demo/community services with usage policies that prohibit production traffic** and can rate-limit or IP-ban without notice. Nominatim's usage policy also requires a custom identifying `User-Agent`, which browser `fetch()` cannot set — the app is technically out of compliance with Nominatim's terms right now. | Before any real traffic: self-host Nominatim/Overpass or use a paid tier (Mapbox/Geoapify/LocationIQ), and swap OSRM for a self-hosted instance with a real truck profile per the PRD's own recommendation. |
| Medium | No `package.json` | Repo root | No documented dependencies, no `npm start`, no engine/version pin. Anyone else picking this up (or you, in six months) has to reverse-engineer that it's zero-dependency vanilla Node from reading the source. | Add a minimal `package.json` with `"scripts": {"start": "node rigrout-server.js"}`, `"engines"`, and a one-line description. Costs five minutes, fixes a real "looks unfinished" signal. |
| Medium | No `README.md`, no `LICENSE` | Repo root | A visitor to `github.com/heliu/rigrout` has zero onboarding: no explanation that a local server is required, no setup steps, no statement of rights. | Add a README with the "clone → `node rigrout-server.js` → open `localhost:3001/rigrout.html`" flow, plus a LICENSE (even "all rights reserved" is better than silence for a commercial product). |
| Medium | Server has zero authentication and wildcard CORS on state-changing endpoints | `respond()` sets `Access-Control-Allow-Origin: '*'` on every response; `/api/restart` and `/api/cache/clear` require no auth | Bound to `127.0.0.1` limits *remote* exposure, but any malicious website open in the same browser session on the same machine while the server is running can call `fetch('http://localhost:3001/api/restart')` from JS and interrupt your local server (classic "attack on localhost" pattern). Low real-world blast radius today, but sloppy to ship as a default posture. | Restrict CORS to your actual origin instead of `*`, and gate `/api/restart` and `/api/cache/clear` behind a simple shared-secret header before this ever runs on a real, always-on host. |
| Medium | Git commit message has an encoding bug | `git log`: `266006e RigRout v1.0 ΓÇö Commercial Route Intelligence` | The em-dash was mojibake'd (`ΓÇö` = a UTF-8 "—" misread as Windows-1252), which will render broken in most tools that read the git history (GitHub's commit list will show the same garbage). Minor, but visible to anyone browsing the repo. | Set `git config --global i18n.commitEncoding utf-8` and `chcp 65001` (or use a UTF-8-aware terminal/editor) before your next commit; consider `git commit --amend` on this one if it hasn't been widely shared. |
| Medium | Product name mismatch vs. PRD, no clearance check evidenced | PRD's "working product name" is **Overclear**; shipped product is **RigRout** (a variant of "RigRoute," listed only as an alt candidate) | Your own Project Prompts doc explicitly says: *"Before launch, run a full trademark/domain/App Store/Google Play clearance check"* — for whichever name you actually ship. No evidence this was done for "RigRout." | Run a basic USPTO/domain/app-store name search for "RigRout" before any public launch material goes out (a five-minute search now is much cheaper than a rebrand after users have the name). |
| Low | Favicon / social preview metadata missing | No `<meta name="description">`, no Open Graph/Twitter tags, no favicon `<link>`, no `manifest.json` icons | Browser tab shows the default blank icon; sharing the link in Slack/iMessage/Twitter shows no title/image card — looks unfinished the instant it's shared outside a direct link. | Add a meta description, an OG image/title, and a favicon (even a simple 32×32 pine-green "R" matches your existing color system). |
| Low | Only 2 `@media` breakpoints in the entire stylesheet | Lines ~301, ~327 | For a tool aimed partly at in-cab/mobile use, this is thin responsive coverage — sidebar is a fixed 288px column that likely just gets hidden rather than truly reflowed on small screens. | Add a proper mobile layout pass (bottom-sheet style panel instead of a fixed side column) before promoting this as usable on a phone. |

---

## 3. First Impression Review

**5-second clarity test:** Pass, mostly. The header ("RigRout — Commercial Route Intelligence"), the dark pine/amber/blue palette from the PRD's own design brief, and a visible truck-profile sidebar communicate "professional trucking tool" quickly — this part is well executed.

**Trust level:** Undermined by two things a first-time user *will* hit within a minute: (1) the always-visible sidebar note "MVP Preview — Routing via OSRM (no truck constraints yet). Stop data is simulated." sits directly under a "Plan Route" button, which is honest but also tells a skeptical driver "this isn't actually the thing yet"; (2) the disclaimer modal on entry is a solid, well-written liability/limitation-of-use disclosure — genuinely good practice and matches PRD section 14 requirements.

**Professionalism level:** High visual polish for a solo/small build — consistent color system, clean typography scale, real iconography, branded truck-stop logos via favicon service. This is well above "prototype" visually.

**Main confusion points:** A new user has no idea, from the UI alone, that most live-data features require them to have Node installed and a server running locally — the little colored dot (`#server-dot`) is the *only* signal, and its meaning ("no local server — using direct APIs") isn't explained anywhere visible.

**Score: 6/10.** Visual polish is real; the honesty banner is commendable but also actively works against the "ready to publish" impression, because it's telling the truth about what's missing.

---

## 4. Clarity and Positioning Review

**What is clear:** Target audience (commercial truck drivers/dispatchers), the core promise ("Know what's overhead. Know where to stop."), and the palette/tone all communicate a serious operational tool, not a consumer map.

**What is unclear / overclaiming:** The product name "Commercial Route Intelligence" and marketing language ("live clearance and stop intelligence," differentiator claims) describe a mature, truck-aware routing system. The shipped code is: a car-routing demo API + an informational restriction overlay + community features that aren't actually shared between users. That gap between the pitch and the artifact is the single biggest positioning risk if this goes in front of drivers, investors, or press right now.

**Stronger positioning recommendation:** Until truck-aware routing ships, position this build honestly as an **early preview / restriction-awareness layer**, not a routing replacement: "See what's ahead before you commit — live bridge, weight, and road-ban data over your route" (true today) rather than implying the route itself is truck-safe (not true today).

**Rewritten tagline for the current build state:** *"RigRout — see the restrictions before you hit them."* (Keep "Know what's overhead. Know where to stop." reserved for the release where routing itself is truck-constrained — it's a great line, don't spend it on a build that can't back it up yet.)

---

## 5. User Journey Review

1. **Land on page →** disclaimer modal (good, clear, matches legal requirements).
2. **Enter origin/destination →** Nominatim autocomplete (works, but no rate-limit-compliant User-Agent — risk of the app getting blocked under load).
3. **Click "Plan Route" →** OSRM draws a plain car route; sidebar shows distance/ETA and a "Route Risk Audit" panel that runs **after** the route already exists.
4. **Toggle POI layers →** if zoomed out (whole-continent view), nothing loads by design (Overpass would time out) — reasonable choice, but there's no visible messaging the first time explaining *why* nothing appeared until you zoom in (a brief hint exists via a tooltip on `ftag-stops`, easy to miss).
5. **Report a hazard / send feedback →** both show success confirmation; **neither actually goes anywhere**. This is the worst point in the journey — a confident dead end.
6. **Friction points:** (a) no indication anywhere in the primary UI that a local server materially changes what the app can do; (b) route audit results can visibly change/upgrade a few seconds *after* the route already rendered (client-side quick-check → then server audit patches it in), which could read as the app "changing its mind," undermining confidence if a driver already started reading the initial risk list.
7. **Missing next actions:** After "Feedback received," there's no path back to correcting a mistake or checking status — appropriate once it's a real backend, moot while it's fake.

---

## 6. Content and Copy Review

**Weak/misleading copy (highest priority to fix):**
- "Help fellow drivers on this corridor" (incident modal subtitle) — false, as covered above.
- "Feedback received. Thank you!" — false, feedback is discarded.
- "Commercial Route Intelligence" (header subtitle/brand line) — overstates current routing capability.

**Good copy worth keeping:** The disclaimer modal's four sections (Informational Use Only / No Guarantee of Accuracy / Driver & Operator Responsibility / Limitation of Liability) are clear, appropriately conservative, and match the PRD's own compliance requirements (section 14) almost verbatim — this is a genuine strength, don't touch it.

**Repetition:** The "MVP Preview" disclosure and the modal disclaimer say overlapping things (routing accuracy caveats) in two different places with slightly different wording — consolidate into one canonical source of truth for what's disclosed, referenced from both places, so a future edit to one doesn't leave the other stale.

---

## 7. Design / UX Review

**Visual hierarchy:** Strong — consistent use of the pine/amber/blue system, clear section headers in the sidebar, sensible primary/ghost button distinction.

**Navigation:** Single-page tool, no real navigation needed; layer toggles and the route-audit panel are reasonably discoverable.

**Mobile experience:** Weak, as noted above — 2 media queries, a fixed-width sidebar, a "☰ Menu" mobile toggle exists but the underlying layout wasn't built mobile-first. Given the target user is a driver, this needs real device testing before publish, not just a narrow-viewport CSS patch.

**Accessibility:** Weak — zero `alt`/`aria-*` attributes anywhere in a 3,000-line file is a hard gap, not a nitpick.

**Empty/error/loading states:** Genuinely well done in places — per-feed loading/error/live badges in the road-ban source panel, a status bar that narrates what's happening ("Fetching stops…", "No message signs available"), graceful `try/catch` around essentially every network call in the client. This is above-average defensive front-end engineering.

**Comparison to Airbnb/Stripe/Linear-level polish:** The color system and component consistency are closer to that bar than most solo-built tools. What's missing to close the gap: accessibility, responsive design, and — most importantly — **the product doing what its own copy says it does**. Polish without truthful function is a worse first impression than less-polished honesty.

---

## 8. Technical / Functional Review

**Tested (ran the actual code in a sandbox):**
- `node rigrout-server.js` boots cleanly, no crash.
- `GET /api/status` → `200 {"status":"ok","version":"2.0","feeds":24,...}` ✅
- `GET /rigrout.html` → `200`, correct byte size, static file serving works, including the path-traversal guard (`filePath.startsWith(base)`) ✅
- `GET /api/layers?types=stops&bbox=...` → returns `200 {"layers":{"stops":[]}}` gracefully when the sandbox's DNS resolution fails (`EAI_AGAIN`) rather than crashing the process — the per-feed `try/catch`/`Promise.allSettled` pattern in `rigrout-server.js` does its job. This is solid defensive coding.

**Reviewed but not executed (no outbound internet in the test sandbox):**
- Whether the 24 individual 511/DOT feed URLs are still valid today (several code comments say "corrected May 2026," implying prior breakage/churn — these are third-party government endpoints outside your control and *will* break again without warning).
- Real-browser console errors, actual map rendering, actual mobile viewport behavior, and whether the Overpass client-side fallback genuinely renders POIs when the server is off (the code path exists and looks correct, but I have not watched it happen in a browser).

**Fixes needed before publishing:**
- Commit the untracked marker-cluster assets and pending HTML/server changes (Critical, above).
- Add a `package.json` and basic `npm start`.
- Add a global safety net (`process.on('uncaughtException', ...)`, `process.on('unhandledRejection', ...)`) in `rigrout-server.js` — every current route is individually wrapped in `.catch`, which is good, but a single missed edge case anywhere still takes the whole process down with no auto-restart other than the manual `/api/restart` endpoint.
- Decide on real hosting for the API server before calling this "published," since `localhost:3001` cannot work for anyone but you.

---

## 9. SEO / Discoverability Review

Low priority relative to the issues above (this reads as an internal/dispatcher tool, not a content-marketing surface), but cheap to fix:
- No `<meta name="description">`.
- No Open Graph/Twitter card tags — sharing the link anywhere shows no title/image.
- No favicon.
- Title tag itself (`RigRout — Commercial Route Intelligence`) is fine and reasonably descriptive.

**Recommended minimum:** one meta description, one OG title/description/image, one favicon. ~15 minutes of work, meaningfully improves how the link looks the first time anyone shares it.

---

## 10. YouTube / Video Review

Not applicable — no video asset was provided or referenced in this project.

---

## 11. Trust, Risk, and Compliance Review

**Trust gaps:** The two fake-confirmation flows (feedback, hazard reporting) are the largest trust risk in the entire product — larger than any visual or SEO issue. Fix these before anything else if this is going in front of real drivers.

**Legal/platform risk:** The liability disclaimer is well-written and appropriately conservative (matches PRD §14). No evidence of scraping ToS violations for the *server-side* feeds (they're public government APIs, fetched server-side with a standard browser UA, which is normal practice for 511/DOT open data). The client-side Nominatim calls, however, do not identify the application via a custom `User-Agent` (browsers block setting that header from JS) — Nominatim's usage policy requires this; worth at minimum monitoring for blocks, or moving all Nominatim traffic through the existing Node proxy where a compliant header *can* be set.

**Privacy/security concerns:** No PII is collected beyond an optional feedback email (which currently goes nowhere). `localStorage` is used for incidents/custom stops/profile — fine for a client-only prototype, not fine as "community reporting."

**Disclosures needed:** None missing from a legal-copy standpoint — the existing disclaimer modal is thorough. The gap is between what the disclaimer promises ("informational tool") and what the marketing copy elsewhere implies ("Commercial Route Intelligence," "help fellow drivers") — align the marketing language downward to match the legal language's honesty, not the reverse.

**Required safeguards before wider distribution:** Real backend for feedback/incidents, real hosting for the API server, CORS/auth hardening on state-changing endpoints, and either a working truck-routing engine or explicit renaming of the "Route Risk Audit" to something that doesn't imply the route itself was already constrained.

---

## 12. Competitive Quality Gap

Versus Trucker Path / SmartTruckRoute / Sygic (the competitors your own PRD names): those products' baseline weakness — per your own market research — is **stale data and unreliable truck-specific routing**. RigRout's current build has the *same* weakness today (no truck-constrained routing, dependent on third-party feed uptime) plus an *additional* one they don't have: **it doesn't work at all once you stop running it from your own laptop.** The visual/UX layer is competitive or better; the underlying functional moat described in the PRD (verified restriction intelligence, source-confidence scoring, community swarm data) does not yet exist in the code. Closing that gap — not more visual polish — is what would make this look and feel premium versus the named competitors.

---

## 13. Failure Modes and Prevention

| Failure mode | Prevention |
|---|---|
| Users assume routes are truck-safe and aren't | Relabel until real truck routing ships; keep the risk-audit disclaimer prominent *before* route calculation, not just after |
| Users submit safety feedback/hazard reports that vanish | Wire up real backends before any public rollout, or remove the false confirmations |
| Public feeds go down/rate-limit the app | Add server-side caching/backoff (partially done via TTL cache) and status monitoring; expect and plan for individual state feeds breaking regularly |
| Visitors to the GitHub repo get a broken clone | Commit all required assets now |
| App is shared publicly but only works for the developer | Host the Node server centrally before calling this "launched" |
| A malicious page abuses the unauthenticated local API while it's running | Lock down CORS/add a shared-secret header on state-changing routes |
| Drivers on real phones find the UI unusable in-cab | Do a real mobile/glove/sunlight usability pass before any driver-facing distribution |

---

## 14. Pre-Publishing Checklist

**Must fix before publishing:**
- [ ] Commit `MarkerCluster.css`, `MarkerCluster.Default.css`, `leaflet.markercluster.js`, and all pending `rigrout.html`/`rigrout-server.js` changes to git.
- [ ] Decide and disclose honestly: is routing truck-aware yet? If not, change "Commercial Route Intelligence" positioning and the "Route Risk Audit" framing to match reality.
- [ ] Fix or clearly relabel "Send Feedback" (currently discards messages while claiming success).
- [ ] Fix or clearly relabel "Report a Hazard" (currently private-only while claiming to help other drivers).
- [ ] Host the Node API server somewhere real if any live-feed feature is expected to work for anyone but you; otherwise clearly state "run locally" as a requirement, not an implementation detail hidden behind a status dot.
- [ ] Add `package.json`, `README.md`.

**Should fix soon:**
- [ ] Restrict CORS from `*` and add minimal auth to `/api/restart` and `/api/cache/clear`.
- [ ] Add `alt`/`aria-label` attributes; raise minimum interactive font size/touch target for anything used during active navigation.
- [ ] Add a PWA manifest + basic offline app-shell caching (PRD-mandated MVP requirement, currently absent).
- [ ] Real mobile-device pass on the responsive layout.
- [ ] Move Nominatim traffic through the server proxy so a compliant custom User-Agent can be sent.

**Nice to improve later:**
- [ ] Favicon, meta description, Open Graph tags.
- [ ] Fix git commit-message encoding going forward.
- [ ] Run a trademark/domain search on "RigRout" per your own Project Prompts recommendation.
- [ ] Expand responsive breakpoints beyond the current two.

---

## Final Decision

**Publish decision:** Not yet. This is a strong internal prototype/demo, not a public-ready product under its current name and marketing claims.

**Minimum fixes required before any public link is shared:** (1) commit the missing repo files so a fresh clone actually works, (2) stop the two fake-success confirmations (feedback, hazard reports) or wire them to something real, (3) either host the API server somewhere real or be explicit in the UI/README that this requires running a local Node server — don't let people discover that silently via a colored dot.

**Biggest remaining risk:** Reputational — publishing "Commercial Route Intelligence" to real commercial drivers when the routing engine itself has no truck constraints is the scenario your own PRD's "Highest-Risk Area" section warns about almost word for word: *"Trust collapse from one catastrophic bad route."* The gap between the pitch and the code is exactly where that risk lives right now.

**Next 3 actions:**
1. Commit everything currently sitting uncommitted/untracked in git — five minutes, fixes a hard blocker.
2. Rewrite the three pieces of dishonest/overstated copy identified above (feedback confirmation, hazard-report subtitle, "Commercial Route Intelligence" framing) so the UI never claims something the code doesn't do.
3. Decide your hosting story for the Node server before telling anyone outside your own machine to try this — that single decision determines whether the product's core feature set exists for anyone but you.
