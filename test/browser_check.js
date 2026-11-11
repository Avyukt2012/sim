#!/usr/bin/env node
/*
 * browser_check.js - opens lf_simulator.html from file:// in headless Chromium and exercises it.
 *   node test/browser_check.js [--shots <dir>]
 * Checks: no console errors, Start run animates and readouts change, the 72-combination test finishes with
 * the same count as the Node simulation, Blob worker works from file://, layout has no horizontal overflow.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'lf_simulator.html');
const si = process.argv.indexOf('--shots');
const SHOTS = si > 0 ? process.argv[si + 1] : path.join(__dirname, 'out', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function check(name, ok, detail) { if (!ok) failures++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  -  ' + detail : '')); }

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function open(width, height, opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width, height }, deviceScaleFactor: 1 }, opts || {}));
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(URL);
    await page.waitForFunction(() => window.LFApp && window.LFApp.history.length === 1);
    return { ctx, page };
  }

  // ------------------------------------------------ desktop, MacBook Air 1470 x 956 screen (browser viewport ~1470 x 830)
  const { ctx, page } = await open(1470, 830);
  await page.screenshot({ path: path.join(SHOTS, '01_desktop_start.png') });
  const before = await page.textContent('#rClock');
  await page.click('#btnStart');
  await page.waitForTimeout(2600);
  const mid = await page.evaluate(() => ({ clock: document.querySelector('#rClock').textContent, state: document.querySelector('#rState').textContent,
    pwm: document.querySelector('#pwmL').textContent, prog: document.querySelector('#rProg').textContent, playing: window.LFApp.player.playing }));
  check('Start run animates (clock advances, playing)', mid.playing && parseFloat(mid.clock) > parseFloat(before) + 1, JSON.stringify(mid));
  await page.click('[data-speed="4"]');
  await page.waitForTimeout(1500);
  const mid2 = await page.evaluate(() => ({ state: document.querySelector('#rState').textContent, prog: document.querySelector('#rProg').textContent, pwm: document.querySelector('#pwmL').textContent }));
  check('Readouts change during the run', mid2.prog !== mid.prog && /\d/.test(mid2.pwm), JSON.stringify(mid2));
  await page.screenshot({ path: path.join(SHOTS, '02_desktop_running.png') });
  // jump to the end
  await page.evaluate(() => { const A = window.LFApp; A.seek(A.duration()); });
  await page.waitForTimeout(300);
  const card = await page.textContent('#resultCard');
  check('Result card shows FINISHED 16.75 s for the reference run', /FINISHED/.test(card) && /16\.75/.test(card), card.replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: path.join(SHOTS, '03_desktop_finished.png') });

  // follow camera, mid-run at the 90 degree corner
  await page.click('#camFollow');
  await page.evaluate(() => window.LFApp.seek(9300));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, '04_follow_camera.png') });
  await page.click('#camWhole');

  // a 300 RPM run, then race
  await page.click('[data-rpm="300"]');
  await page.click('#btnStart');
  await page.waitForFunction(() => window.LFApp.history.length === 2);
  for (let k = 0; k < 2; k++) await page.locator('#histBody input[type=checkbox]').nth(k).check();
  await page.click('#btnRace');
  await page.evaluate(() => window.LFApp.seek(7000));
  await page.waitForTimeout(300);
  const race = await page.textContent('#raceBoard');
  check('Race shows two robots', (race.match(/RPM/g) || []).length === 2, race.replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: path.join(SHOTS, '05_race.png') });

  // code view
  await page.click('#tab-code');
  await page.evaluate(() => { const A = window.LFApp; A.load([A.history[0]]); A.seek(5200); });
  await page.waitForTimeout(300);
  const hot = await page.$$eval('#codePre .ln.hot', (els) => els.length);
  check('Show code highlights the running branch', hot > 0, hot + ' hot lines');
  await page.screenshot({ path: path.join(SHOTS, '06_code.png') });

  // 72 combinations at 300 RPM default (C++ reference: 56/72)
  await page.click('#tab-72');
  const t0 = Date.now();
  await page.click('#btn72');
  await page.waitForFunction(() => window.LFApp.last72 && document.querySelector('#btn72').disabled === false, null, { timeout: 120000 });
  const r72 = await page.evaluate(() => ({ text: document.querySelector('.summary72').textContent, n: window.LFApp.last72.res.filter((r) => r.ok).length,
    workers: /background workers/.test(document.querySelector('.summary72').textContent) }));
  check('Test all 72 combinations (300 RPM, default) finishes with 56/72 like the C++ reference', r72.n === 56 && /every cell agrees/.test(r72.text),
    r72.text.replace(/\s+/g, ' ').trim() + ` (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  check('72-test ran in Blob-URL Web Workers from file://', r72.workers);
  await page.hover('table.grid72 td[data-k="5"]');
  await page.screenshot({ path: path.join(SHOTS, '07_test72.png') });
  await page.click('table.grid72 td.bad');
  await page.waitForTimeout(500);
  await page.evaluate(() => { const A = window.LFApp; A.seek(A.duration()); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, '08_failed_run.png') });
  const card2 = await page.textContent('#resultCard');
  check('Clicking a red cell loads a failed run with its reason', /FAILED/.test(card2), card2.replace(/\s+/g, ' ').trim());

  const ovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('Desktop: no horizontal page overflow', ovf <= 0, ovf + ' px');
  await page.click('#tab-learn');
  await page.screenshot({ path: path.join(SHOTS, '09_learn.png') });
  await ctx.close();

  // ------------------------------------------------ dark theme
  {
    const { ctx: c2, page: p2 } = await open(1470, 830, { colorScheme: 'dark' });
    await p2.evaluate(() => window.LFApp.seek(12000));
    await p2.waitForTimeout(300);
    await p2.screenshot({ path: path.join(SHOTS, '10_dark.png') });
    await c2.close();
  }
  // ------------------------------------------------ narrow window
  for (const w of [820, 400]) {
    const { ctx: c3, page: p3 } = await open(w, 900);
    await p3.evaluate(() => window.LFApp.seek(6000));
    await p3.waitForTimeout(300);
    await p3.screenshot({ path: path.join(SHOTS, `11_narrow_${w}.png`), fullPage: true });
    const o = await p3.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`Narrow ${w} px: no horizontal page overflow`, o <= 0, o + ' px');
    await c3.close();
  }
  // ------------------------------------------------ worker fallback (Worker blocked)
  {
    const c4 = await browser.newContext({ viewport: { width: 1470, height: 830 } });
    await c4.addInitScript(() => { window.Worker = function () { throw new Error('blocked'); }; });
    const p4 = await c4.newPage();
    p4.on('pageerror', (e) => errors.push(String(e)));
    await p4.goto(URL);
    await p4.waitForFunction(() => window.LFApp && window.LFApp.history.length === 1);
    await p4.click('#tab-72');
    await p4.click('#btn72');
    await p4.waitForFunction(() => window.LFApp.last72, null, { timeout: 180000 });
    const n = await p4.evaluate(() => window.LFApp.last72.res.filter((r) => r.ok).length);
    check('72-test without Workers (chunked fallback) gives 72/72 at 200 RPM default', n === 72, n);
    await c4.close();
  }

  check('No console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL BROWSER CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
