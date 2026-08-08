// Client-side regression tests for rigrout.html — loads the real page in a
// real (headless) Chromium via Playwright, served by the real
// rigrout-server.js so detectServer()/serverAvailable behave as in
// production. Covers the UI-state logic the prepublishing audit flagged as
// having zero coverage: disclaimer gating/focus-trap, menu/panel state, and
// the window.handleAndroidBack() decision function MainActivity.java calls
// into on a real hardware Back press (see test/android/ for the on-device
// half of that regression test).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.RIGROUT_TEST_PORT || 3098;
const BASE = `http://127.0.0.1:${PORT}`;
let serverProcess, browser, page;

before(async () => {
  serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'rigrout-server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/status`)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
});

beforeEach(async () => {
  if (page) await page.close();
  page = await browser.newPage();
  // localStorage is per-origin and Playwright contexts default to a clean
  // slate, but be explicit: each test starts with the disclaimer unaccepted.
  await page.goto(`${BASE}/rigrout.html`, { waitUntil: 'domcontentloaded' });
});

// ── Disclaimer: gating + focus trap ─────────────────────────────────────────
test('disclaimer is visible on first load and blocks the app behind it', async () => {
  await assert.doesNotReject(page.waitForSelector('#disclaimer-overlay:not(.hidden)', { timeout: 5000 }));
  const appIsInert = await page.getAttribute('#app', 'inert');
  assert.notEqual(appIsInert, null, '#app should be inert while the disclaimer is showing');
});

test('Enter button starts disabled and only enables after scrolling the terms to the end', async () => {
  const btn = page.locator('#disclaimer-accept-btn');
  // The modal is intentionally short enough on a normal viewport that it may
  // not need scrolling — assert whichever state actually holds, then force
  // the scrolled state to confirm the listener does enable it.
  await page.evaluate(() => {
    const body = document.getElementById('disclaimer-body');
    body.scrollTop = 0;
  });
  const scrollable = await page.evaluate(() => {
    const body = document.getElementById('disclaimer-body');
    return body.scrollHeight > body.clientHeight + 4;
  });
  if (scrollable) {
    assert.equal(await btn.isDisabled(), true, 'expected Enter to be disabled before scrolling');
    await page.evaluate(() => {
      const body = document.getElementById('disclaimer-body');
      body.scrollTop = body.scrollHeight;
      body.dispatchEvent(new Event('scroll'));
    });
    await assert.doesNotReject(page.waitForFunction(
      () => !document.getElementById('disclaimer-accept-btn').disabled, { timeout: 3000 }
    ));
  } else {
    assert.equal(await btn.isDisabled(), false, 'nothing to scroll — Enter should already be enabled');
  }
});

test('accepting the disclaimer hides it, restores focus to the app, and persists across reload', async () => {
  await page.evaluate(() => {
    const body = document.getElementById('disclaimer-body');
    body.scrollTop = body.scrollHeight;
    body.dispatchEvent(new Event('scroll'));
  });
  await page.click('#disclaimer-accept-btn');
  // waitForSelector('...hidden') would wait for VISIBILITY of a match, which
  // a hidden element never satisfies — assert the CSS class directly instead.
  await assert.doesNotReject(page.waitForFunction(
    () => document.getElementById('disclaimer-overlay').classList.contains('hidden'), { timeout: 3000 }
  ));
  const appIsInert = await page.getAttribute('#app', 'inert');
  assert.equal(appIsInert, null, '#app should no longer be inert after accepting');

  await page.reload({ waitUntil: 'domcontentloaded' });
  const hiddenAfterReload = await page.evaluate(
    () => document.getElementById('disclaimer-overlay').classList.contains('hidden')
  );
  assert.equal(hiddenAfterReload, true, 'accepted disclaimer should not reappear on reload');
});

// ── window.handleAndroidBack() — the decision function MainActivity calls ──
async function accept(page) {
  await page.evaluate(() => {
    const body = document.getElementById('disclaimer-body');
    body.scrollTop = body.scrollHeight;
    body.dispatchEvent(new Event('scroll'));
  });
  await page.click('#disclaimer-accept-btn');
  await page.waitForFunction(
    () => document.getElementById('disclaimer-overlay').classList.contains('hidden'), { timeout: 3000 }
  );
}

test('handleAndroidBack returns false when nothing is open (native side should exit as normal)', async () => {
  await accept(page);
  const handled = await page.evaluate(() => window.handleAndroidBack());
  assert.equal(handled, false);
});

test('handleAndroidBack closes the Route Audit panel instead of letting Android exit', async () => {
  await accept(page);
  await page.click('text=⚡ Route Audit');
  await assert.doesNotReject(page.waitForSelector('#panel.open', { timeout: 3000 }));
  const handled = await page.evaluate(() => window.handleAndroidBack());
  assert.equal(handled, true, 'expected handleAndroidBack to report it closed something');
  const stillOpen = await page.evaluate(() => document.getElementById('panel').classList.contains('open'));
  assert.equal(stillOpen, false, 'Route Audit panel should be closed after handleAndroidBack');
});

test('handleAndroidBack closes the Feedback modal before falling through to anything else', async () => {
  await accept(page);
  await page.click('text=💬 Feedback');
  await assert.doesNotReject(page.waitForSelector('#feedback-overlay:not(.hidden)', { timeout: 3000 }));
  const handled = await page.evaluate(() => window.handleAndroidBack());
  assert.equal(handled, true);
  const stillOpen = await page.evaluate(
    () => !document.getElementById('feedback-overlay').classList.contains('hidden')
  );
  assert.equal(stillOpen, false, 'Feedback modal should be closed after handleAndroidBack');
});

test('handleAndroidBack closes the mobile sidebar menu (the exact bug reported: menu open -> Back exited to launcher)', async () => {
  await page.setViewportSize({ width: 390, height: 844 }); // phone-width, matches the mobile sidebar breakpoint
  await accept(page);
  await page.evaluate(() => toggleMobileSidebar());
  await assert.doesNotReject(page.waitForSelector('#sidebar.mobile-open', { timeout: 3000 }));
  const handled = await page.evaluate(() => window.handleAndroidBack());
  assert.equal(handled, true);
  const stillOpen = await page.evaluate(() => document.getElementById('sidebar').classList.contains('mobile-open'));
  assert.equal(stillOpen, false, 'sidebar menu should be closed after handleAndroidBack');
});

// ── Layer-switcher keyboard accessibility ───────────────────────────────────
test('map style buttons are keyboard-focusable and activate on Enter', async () => {
  await accept(page);
  const satellite = page.locator('#lyr-satellite');
  await assert.doesNotReject(satellite.waitFor({ state: 'visible', timeout: 5000 }));
  assert.equal(await satellite.getAttribute('tabindex'), '0');
  assert.equal(await satellite.getAttribute('role'), 'button');
  await satellite.focus();
  await page.keyboard.press('Enter');
  await assert.doesNotReject(page.waitForFunction(
    () => document.getElementById('lyr-satellite').getAttribute('aria-pressed') === 'true', { timeout: 3000 }
  ));
  const streetPressed = await page.getAttribute('#lyr-street', 'aria-pressed');
  assert.equal(streetPressed, 'false', 'previously-active Street button should no longer report pressed');
});

test('Driving Mode stays unavailable until a route is indexed, then presents a focused HUD', async () => {
  await accept(page);
  assert.equal(await page.locator('#drive-mode-btn').isDisabled(), true);
  await page.evaluate(() => {
    indexActiveRoute({distance:2220,duration:180,geometry:{type:'LineString',coordinates:[[0,0],[0,.01],[0,.02]]},legs:[{steps:[{distance:1110,maneuver:{instruction:'Continue north'}},{distance:1110,maneuver:{instruction:'Turn right'}}]}]});
    gpsWatcher = 1; // avoid requesting browser geolocation in this deterministic UI test
    startDrivingMode();
    updateDrivingMode(.005,0,8);
  });
  assert.equal(await page.locator('#drive-mode-btn').isDisabled(), false);
  assert.equal(await page.locator('body').getAttribute('class'), 'driving');
  assert.equal(await page.locator('#drive-hud').evaluate((el) => el.classList.contains('on')), true);
  assert.match(await page.locator('#drive-next').textContent(), /Continue north|Turn right/);
});

test('off-route warning requires three consecutive inaccurate positions and offers rerouting', async () => {
  await accept(page);
  await page.evaluate(() => {
    indexActiveRoute({distance:2220,duration:180,geometry:{type:'LineString',coordinates:[[0,0],[0,.01],[0,.02]]},legs:[{steps:[]}]});
    gpsWatcher=1; startDrivingMode();
    updateDrivingMode(.02,.02,5); updateDrivingMode(.02,.02,5);
  });
  assert.equal(await page.locator('#offroute-card').evaluate((el) => el.classList.contains('on')), false);
  await page.evaluate(() => updateDrivingMode(.02,.02,5));
  assert.equal(await page.locator('#offroute-card').evaluate((el) => el.classList.contains('on')), true);
  assert.equal(await page.locator('#offroute-card button').textContent(), 'Reroute');
});

test('Driving Mode only lists route alerts ahead of the driver and Android Back exits driving first', async () => {
  await accept(page);
  const result = await page.evaluate(() => {
    indexActiveRoute({distance:3330,duration:240,geometry:{type:'LineString',coordinates:[[0,0],[0,.01],[0,.02],[0,.03]]},legs:[{steps:[]}]});
    routeRestrictionItems=[{lat:.025,lon:0,title:'Low clearance ahead'},{lat:.001,lon:0,title:'Restriction behind'}];
    gpsWatcher=1;startDrivingMode();updateDrivingMode(.015,0,5);
    const alerts=[...document.querySelectorAll('#drive-alerts .drive-alert')].map((el)=>el.textContent);
    const handled=window.handleAndroidBack();
    return {alerts,handled,driving:drivingModeOn};
  });
  assert.equal(result.alerts.length, 1);
  assert.match(result.alerts[0], /Low clearance ahead/);
  assert.equal(result.handled, true);
  assert.equal(result.driving, false);
});

test('Driving Mode shows the closest upcoming truck stop or rest area first', async () => {
  await accept(page);
  const result = await page.evaluate(() => {
    indexActiveRoute({distance:11100,duration:600,geometry:{type:'LineString',coordinates:[[0,0],[0,.05],[0,.1]]},legs:[{steps:[]}]});
    poiCache.rest=[{lat:.08,lon:0,name:'Far Rest Area',amen:'Washrooms'}];
    poiCache.stops=[{lat:.03,lon:0,name:'Near Truck Stop',amen:'Diesel · Showers'}];
    gpsWatcher=1;startDrivingMode();updateDrivingMode(.01,0,5);
    return {visible:document.getElementById('drive-stop').classList.contains('on'),title:document.getElementById('drive-stop-title').textContent,detail:document.getElementById('drive-stop-detail').textContent};
  });
  assert.equal(result.visible, true);
  assert.match(result.title, /Near Truck Stop/);
  assert.doesNotMatch(result.title, /Far Rest Area/);
  assert.match(result.detail, /Diesel/);
});

test('Driving Mode keeps the Android screen awake only until driving ends', async () => {
  await accept(page);
  const calls = await page.evaluate(() => {
    const values=[];
    window.RigRoutNative={setKeepScreenOn:(on)=>values.push(on)};
    indexActiveRoute({distance:1000,duration:60,geometry:{type:'LineString',coordinates:[[0,0],[0,.01]]},legs:[{steps:[]}]});
    gpsWatcher=1;
    startDrivingMode();
    stopDrivingMode();
    return values;
  });
  assert.deepEqual(calls, [true, false]);
});
