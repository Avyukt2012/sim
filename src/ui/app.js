/*
 * app.js - the page: controls, playback, drawing, readouts, history, race, 72-combination test, code view.
 * All simulation is done by the core files (LFWorld.simulate etc.); this file only shows the recordings.
 */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const LM = window.LFMath, PR = window.LFParams, W = window.LFWorld, T = window.LFTrack;
  const DATA = window.LF_DATA || {};
  const PH = W.PHASES;
  const track = T.writeTrack();
  const TOTAL = track.total;

  // ------------------------------------------------------------------ small helpers
  const fmt = (v, d) => LM.cfmt(v, d);
  const texts = new WeakMap();
  function setText(el, s) { if (texts.get(el) !== s) { texts.set(el, s); el.textContent = s; } }
  function setHTML(el, s) { if (texts.get(el) !== s) { texts.set(el, s); el.innerHTML = s; } }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return null; }
  const RUN_COLORS = ['#e4572e', '#1f9e89', '#7a3fd0', '#d99a00', '#2f6fde', '#c2307f', '#5c8a1e', '#8d5a3b'];
  const CAT_VARS = ['--tr-idle', '--tr-straight', '--tr-gentle', '--tr-sharp', '--tr-cross', '--tr-search', '--tr-idle'];
  let CAT_COL = [];
  let SURROUND = '#c9d1d9';
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    CAT_COL = CAT_VARS.map((v) => cs.getPropertyValue(v).trim() || '#888');
    SURROUND = cs.getPropertyValue('--surround').trim() || '#c9d1d9';
  }

  // ------------------------------------------------------------------ theme
  function applyTheme(mode) {
    if (mode === 'light' || mode === 'dark') document.documentElement.setAttribute('data-theme', mode);
    else document.documentElement.removeAttribute('data-theme');
    $$('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === mode)));
    store('lf-theme', mode);
    readColors(); dirty = true;
  }
  $$('[data-theme-set]').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.themeSet)));
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); dirty = true; }); } catch (e) { /* old Safari */ }

  // ------------------------------------------------------------------ controls <-> config
  const SK = PR.SETTING_KEYS;
  const rpmEl = $('#rpm');
  const BUILD = [
    { id: 'spacing', key: 'spacingCm', dec: 1, unit: 'cm' },
    { id: 'ahead', key: 'aheadCm', dec: 1, unit: 'cm' },
    { id: 'track', key: 'trackCm', dec: 1, unit: 'cm' },
    { id: 'wheel', key: 'wheelMm', dec: 0, unit: 'mm' },
    { id: 'tau', key: 'tau', dec: 2, unit: 's' },
    { id: 'dead', key: 'dead', dec: 0, unit: 'PWM' },
  ];
  let lineWcm = '2.5';

  function presetMatch(settings) {
    for (const name of Object.keys(PR.PRESETS)) {
      const p = PR.presetSettings(name);
      let same = true;
      for (const k of SK) {
        if (k === 'LOST_AFTER_MS') { if (settings[k] !== p[k] && settings[k] !== PR.MEMORY_OFF_LOST_MS) same = false; }
        else if (settings[k] !== p[k]) same = false;
      }
      if (same) return name;
    }
    return 'custom';
  }
  function getCfg() {
    const rpm = +rpmEl.value;
    const build = {};
    BUILD.forEach((b) => { build[b.key] = Number($('#b-' + b.id).value).toFixed(b.dec); });
    const settings = {};
    SK.forEach((k) => { settings[k] = Math.trunc(Number($('#s-' + k).value) || 0); });
    const memory = $('#memory').checked;
    if (!memory) settings.LOST_AFTER_MS = PR.MEMORY_OFF_LOST_MS;
    const vmax = PR.rpmToVmax(rpm, +build.wheelMm);
    return { rpm, vmax, build, settings, memory, lineWcm, preset: presetMatch(settings) };
  }
  function toParams(cfg) {
    return {
      lineW: PR.cm(cfg.lineWcm), spacing: PR.cm(cfg.build.spacingCm), ahead: PR.cm(cfg.build.aheadCm),
      wheelTrack: PR.cm(cfg.build.trackCm), vmax: cfg.vmax, dead: +cfg.build.dead, tau: parseFloat(cfg.build.tau),
      settings: Object.assign({}, cfg.settings),
    };
  }
  function cfgKey(cfg) { return JSON.stringify([cfg.rpm, cfg.build, cfg.settings, cfg.lineWcm]); }
  let lastLostMs = 250;
  function setControls(cfg) {
    rpmEl.value = cfg.rpm;
    BUILD.forEach((b) => { $('#b-' + b.id).value = cfg.build[b.key]; });
    SK.forEach((k) => { $('#s-' + k).value = cfg.settings[k]; });
    $('#memory').checked = cfg.settings.LOST_AFTER_MS !== PR.MEMORY_OFF_LOST_MS;
    if (!$('#memory').checked) { $('#s-LOST_AFTER_MS').value = lastLostMs; }
    lineWcm = cfg.lineWcm;
    syncControls();
  }
  function applyPreset(name) {
    const p = PR.presetSettings(name);
    SK.forEach((k) => { if (k !== 'LOST_AFTER_MS' || $('#memory').checked) $('#s-' + k).value = p[k]; });
    if (!$('#memory').checked) lastLostMs = p.LOST_AFTER_MS;
    syncControls();
  }
  function syncControls() {
    const cfg = getCfg();
    setText($('#rpmVal'), String(cfg.rpm));
    setText($('#vmaxVal'), fmt(cfg.vmax, 3).replace(/0$/, '') + ' m/s');
    $$('#rpmChips .chip').forEach((c) => c.setAttribute('aria-pressed', String(+c.dataset.rpm === cfg.rpm)));
    BUILD.forEach((b) => setText($('#o-' + b.id), cfg.build[b.key] + ' ' + b.unit));
    $('#preset').value = cfg.preset;
    const mem = $('#memory').checked;
    $('#s-LOST_AFTER_MS').disabled = !mem;
    $$('#lineW button').forEach((bt) => bt.setAttribute('aria-pressed', String(bt.dataset.w === lineWcm)));
    update72Desc();
    if (!player.entries.length) dirty = true;
  }
  rpmEl.addEventListener('input', syncControls);
  $$('#rpmChips .chip').forEach((c) => c.addEventListener('click', () => { rpmEl.value = c.dataset.rpm; syncControls(); }));
  $('#preset').addEventListener('change', (e) => { if (e.target.value !== 'custom') applyPreset(e.target.value); else syncControls(); });
  SK.forEach((k) => $('#s-' + k).addEventListener('input', syncControls));
  $('#memory').addEventListener('change', () => {
    const el = $('#s-LOST_AFTER_MS');
    if (!$('#memory').checked) { lastLostMs = +el.value || 250; el.value = PR.MEMORY_OFF_LOST_MS; }
    else { el.value = lastLostMs; }
    syncControls();
  });
  BUILD.forEach((b) => $('#b-' + b.id).addEventListener('input', syncControls));
  $('#resetBuild').addEventListener('click', () => {
    const d = PR.DEFAULT_BUILD;
    $('#b-spacing').value = d.spacingCm; $('#b-ahead').value = d.aheadCm; $('#b-track').value = d.wheelTrackCm;
    $('#b-wheel').value = d.wheelMm; $('#b-tau').value = d.tau; $('#b-dead').value = d.dead;
    syncControls();
  });
  $$('#lineW button').forEach((bt) => bt.addEventListener('click', () => { lineWcm = bt.dataset.w; syncControls(); }));

  // ------------------------------------------------------------------ labels
  function programLabel(cfg) {
    const s = cfg.settings;
    let base = cfg.preset !== 'custom' ? PR.PRESETS[cfg.preset].label.replace(' (for 300 RPM motors)', '')
      : 'Custom ' + [s.SPEED_STRAIGHT, s.SPEED_CROSSING, s.TURN_OUTER, s.TURN_INNER_SOFT, s.TURN_INNER_SHARP].join('/');
    const extra = [];
    if (s.SHARP_AFTER_MS !== 30) extra.push('SHARP ' + s.SHARP_AFTER_MS);
    if (s.LOST_AFTER_MS === PR.MEMORY_OFF_LOST_MS) extra.push('memory off');
    else if (s.LOST_AFTER_MS !== 250) extra.push('LOST ' + s.LOST_AFTER_MS);
    if (s.SEARCH_GIVE_UP_MS !== 2000) extra.push('GIVE_UP ' + s.SEARCH_GIVE_UP_MS);
    return base + (extra.length ? ', ' + extra.join(', ') : '');
  }
  function buildLabel(cfg) {
    const b = cfg.build;
    return `${b.spacingCm}/${b.aheadCm}/${b.trackCm} cm, ${b.wheelMm} mm, τ ${b.tau}, dead ${b.dead}`;
  }
  const BUILD_HELP = 'sensor spacing / sensors ahead / wheel spacing, wheel diameter, motor response time, dead zone';

  // ------------------------------------------------------------------ runs and history
  const history = [];
  let nextId = 1;
  function simulateEntry(cfg, opts) {
    const params = toParams(cfg);
    const run = W.simulate(track, params, { record: true });
    const e = { id: nextId++, cfg, params, run, ticked: false, color: null, from: (opts && opts.from) || '' };
    e.color = RUN_COLORS[(e.id - 1) % RUN_COLORS.length];
    prepare(e);
    return e;
  }
  function ensureFrames(e) {
    if (!e.run || !e.run.frames) { e.run = W.simulate(track, e.params, { record: true }); prepare(e); }
    return e;
  }
  function trimMemory() {   // keep recordings of at most 24 runs; others are recomputed (deterministic) when needed
    const withFrames = history.filter((e) => e.run && e.run.frames);
    if (withFrames.length <= 24) return;
    const inUse = new Set(player.entries.concat(history.filter((h) => h.ticked)));
    for (const e of withFrames) {
      if (withFrames.length <= 24) break;
      if (inUse.has(e)) continue;
      e.run = Object.assign({}, e.run, { frames: null }); e.mx = e.my = e.cat = null;
      withFrames.splice(withFrames.indexOf(e), 1);
    }
  }
  function prepare(e) {
    const F = e.run.frames, n = F.x.length, a = e.params.ahead, sharpMs = e.run.constants.SHARP_AFTER_MS;
    e.mx = new Float32Array(n); e.my = new Float32Array(n); e.cat = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      e.mx[i] = F.x[i] + a * Math.cos(F.th[i]); e.my[i] = F.y[i] + a * Math.sin(F.th[i]);
      e.cat[i] = category(F, i, sharpMs);
    }
    // serial monitor lines with time stamps
    const lines = []; let cur = '', t0 = null;
    e.run.serialParts.forEach((p, k) => {
      let rest = p;
      for (;;) {
        if (t0 === null) t0 = e.run.serialTimes[k];
        const nl = rest.indexOf('\n');
        if (nl < 0) { cur += rest; break; }
        cur += rest.slice(0, nl); lines.push({ t: t0, s: cur }); cur = ''; t0 = null;
        rest = rest.slice(nl + 1);
        if (!rest) break;
      }
    });
    if (cur) lines.push({ t: t0 || 0, s: cur });
    e.serialLines = lines;
  }
  function category(F, i, sharpMs) {
    const ph = PH[F.phase[i]];
    if (!(F.flags[i] & 16)) return (ph === 'STOPPING' || ph === 'STOPPED') ? 6 : 0;
    if (ph === 'STOPPING') return 6;
    const a = F.action[i];
    if (a === 0) return 1;
    if (a === 1 || a === 2) return F.tia[i] >= sharpMs ? 3 : 2;
    if (a === 3) return 4;
    return 5;
  }
  function resultShort(e) {
    const r = e.run;
    if (r.ok) return 'FINISHED';
    return 'FAILED: ' + failText(r);
  }
  function failText(r) {
    if (r.failWhy === 'program stopped') {
      if (/line lost/.test(r.stopReason)) return 'program stopped: line lost';
      if (/lifted/.test(r.stopReason)) return 'program stopped: both sensors black for 1 s';
      return 'program stopped' + (r.stopReason ? ': ' + r.stopReason : '');
    }
    return r.failWhy;
  }
  function addToHistory(e) { history.push(e); trimMemory(); renderHistory(); }

  // ------------------------------------------------------------------ player
  const player = { entries: [], t: 0, playing: false, speed: 1, race: false, last: 0 };
  let dirty = true;
  function duration() { return player.entries.reduce((m, e) => Math.max(m, e.run.nFrames - 1), 0); }
  function load(entries, race) {
    entries.forEach(ensureFrames);
    player.entries = entries; player.race = !!race; player.t = 0; player.playing = false;
    const d = duration();
    const sc = $('#scrub'); sc.max = d; sc.value = 0;
    renderTicks(); renderHistory(); renderNowShowing(); renderSerial(true);
    lastResultShown = null;
    $('#raceBox').hidden = !race;
    dirty = true;
  }
  function play() {
    if (!player.entries.length) return;
    if (player.t >= duration()) player.t = 0;
    player.playing = true; player.last = performance.now(); renderPauseBtn();
  }
  function pause() { player.playing = false; renderPauseBtn(); }
  function renderPauseBtn() { $('#btnPause').textContent = player.playing ? 'Pause' : (player.t > 0 && player.t < duration() ? 'Resume' : 'Play'); }
  function renderNowShowing() {
    const el = $('#nowShowing');
    if (!player.entries.length) { el.innerHTML = 'No run loaded'; return; }
    if (player.race) {
      el.innerHTML = '<b>Race:</b> ' + player.entries.map((e) => `<span style="color:${e.color}">&#9632;</span> #${e.id} ${e.cfg.rpm} RPM ${esc(programLabel(e.cfg))}`).join(' &nbsp;vs&nbsp; ');
    } else {
      const e = player.entries[0];
      el.title = el.textContent;
      el.innerHTML = `<b>Run #${e.id}</b> &middot; ${e.cfg.rpm} RPM (${fmt(e.cfg.vmax, 3).replace(/0$/, '')} m/s) &middot; ${esc(programLabel(e.cfg))} &middot; ${esc(buildLabel(e.cfg))} &middot; ${e.cfg.lineWcm} cm line` + (e.from ? ' &middot; ' + esc(e.from) : '');
    }
  }
  function renderTicks() {
    const box = $('#ticks'); box.innerHTML = '';
    if (!player.entries.length) return;
    const e = player.entries[0], d = Math.max(1, duration());
    const col = { crossing: 'var(--tr-cross)', search: 'var(--tr-search)', stop: 'var(--bad)' };
    for (const ev of e.run.events) {
      if (!col[ev.type]) continue;
      const s = document.createElement('span'); s.style.left = (100 * ev.i / d) + '%'; s.style.background = col[ev.type];
      s.title = ev.type; box.appendChild(s);
    }
    const s = document.createElement('span'); s.style.left = (100 * (e.run.nFrames - 1) / d) + '%';
    s.style.background = e.run.ok ? 'var(--ok)' : 'var(--bad)'; box.appendChild(s);
  }

  $('#btnStart').addEventListener('click', startRun);
  $('#btnPause').addEventListener('click', () => { if (player.playing) pause(); else play(); });
  $('#btnRestart').addEventListener('click', () => { player.t = 0; renderSerial(true); lastResultShown = null; play(); dirty = true; });
  $$('#speeds button').forEach((b) => b.addEventListener('click', () => {
    player.speed = +b.dataset.speed; $$('#speeds button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    player.last = performance.now();
  }));
  $('#scrub').addEventListener('input', (ev) => { pause(); player.t = +ev.target.value; renderSerial(true); dirty = true; });
  document.addEventListener('keydown', (ev) => {
    const tag = (ev.target && ev.target.tagName) || '';
    if (tag === 'INPUT' && ev.target.type !== 'range' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (ev.code === 'Space') { ev.preventDefault(); if (player.playing) pause(); else play(); }
    else if (ev.code === 'ArrowRight' || ev.code === 'ArrowLeft') {
      if (tag === 'INPUT') return;
      ev.preventDefault(); pause();
      player.t = Math.max(0, Math.min(duration(), Math.floor(player.t) + (ev.code === 'ArrowRight' ? 1 : -1) * (ev.shiftKey ? 100 : 5)));
      renderSerial(true); dirty = true;
    }
  });

  function startRun() {
    const cfg = getCfg();
    const key = cfgKey(cfg);
    const same = history.find((h) => cfgKey(h.cfg) === key);
    if (same) {
      toast(`Same settings as run #${same.id}: the simulation is exact, so it gives the same run. Replaying it.`);
      load([same]); play(); return;
    }
    $('#busy').hidden = false;
    $('#btnStart').disabled = true;
    setTimeout(() => {
      try {
        const e = simulateEntry(cfg);
        addToHistory(e); load([e]); play();
      } catch (err) { toast('Could not run: ' + err.message); console.error(err); }
      $('#busy').hidden = true; $('#btnStart').disabled = false;
    }, 30);
  }

  // ------------------------------------------------------------------ camera
  const cv = $('#cv'), board = $('#board');
  const ctx = cv.getContext('2d');
  let CW = 0, CH = 0, DPR = 1;
  const cam = { mode: 'whole', cx: 0, cy: 0, scale: 100, win: 0.40 };
  let bbox = null;
  (function () {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of track.strokes) for (let i = 0; i < s.n; i++) { x0 = Math.min(x0, s.x[i]); x1 = Math.max(x1, s.x[i]); y0 = Math.min(y0, s.y[i]); y1 = Math.max(y1, s.y[i]); }
    bbox = { x0: x0 - 0.16, y0: y0 - 0.14, x1: x1 + 0.12, y1: y1 + 0.12 };
  })();
  function fitWhole() {
    const pad = 16;
    // leave the legend's strip free when the board is wide enough
    const lg = $('#legend'); let lw = 0;
    if (lg && lg.open) { lw = lg.getBoundingClientRect().width + 12; if (CW - lw < CH * 0.9) lw = 0; }
    const aw = CW - lw;
    const s = Math.min((aw - 2 * pad) / (bbox.x1 - bbox.x0), (CH - 2 * pad) / (bbox.y1 - bbox.y0));
    cam.scale = Math.max(10, s);
    cam.cx = (bbox.x0 + bbox.x1) / 2 + (lw / 2) / cam.scale; cam.cy = (bbox.y0 + bbox.y1) / 2;
  }
  function setCamMode(m) {
    cam.mode = m;
    $('#camWhole').setAttribute('aria-pressed', String(m === 'whole'));
    $('#camFollow').setAttribute('aria-pressed', String(m === 'follow'));
    dirty = true;
  }
  $('#camWhole').addEventListener('click', () => setCamMode('whole'));
  $('#camFollow').addEventListener('click', () => { cam.win = 0.40; setCamMode('follow'); });
  function zoomAt(f, sx, sy) {
    if (cam.mode === 'follow') { cam.win = Math.max(0.08, Math.min(3, cam.win / f)); dirty = true; return; }
    const wx = cam.cx + (sx - CW / 2) / cam.scale, wy = cam.cy - (sy - CH / 2) / cam.scale;
    cam.scale = Math.max(20, Math.min(20000, cam.scale * f));
    cam.cx = wx - (sx - CW / 2) / cam.scale; cam.cy = wy + (sy - CH / 2) / cam.scale;
    setCamMode('free');
  }
  $('#zoomIn').addEventListener('click', () => zoomAt(1.4, CW / 2, CH / 2));
  $('#zoomOut').addEventListener('click', () => zoomAt(1 / 1.4, CW / 2, CH / 2));
  cv.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = cv.getBoundingClientRect();
    zoomAt(Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0018)), ev.clientX - r.left, ev.clientY - r.top);
  }, { passive: false });
  let drag = null;
  cv.addEventListener('pointerdown', (ev) => {
    drag = { x: ev.clientX, y: ev.clientY, cx: cam.cx, cy: cam.cy, moved: false };
    cv.setPointerCapture(ev.pointerId); cv.classList.add('dragging');
  });
  cv.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    if (!drag.moved) { drag.moved = true; if (cam.mode !== 'free') { drag.cx = cam.cx; drag.cy = cam.cy; setCamMode('free'); } }
    cam.cx = drag.cx - dx / cam.scale; cam.cy = drag.cy + dy / cam.scale; dirty = true;
  });
  const endDrag = () => { drag = null; cv.classList.remove('dragging'); };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('dblclick', () => setCamMode('whole'));
  function resize() {
    const r = board.getBoundingClientRect();
    DPR = window.devicePixelRatio || 1;
    CW = Math.max(50, r.width); CH = Math.max(50, r.height);
    cv.width = Math.round(CW * DPR); cv.height = Math.round(CH * DPR);
    dirty = true;
  }
  try { new ResizeObserver(resize).observe(board); } catch (e) { window.addEventListener('resize', resize); }

  // ------------------------------------------------------------------ drawing
  const finishPose = (function () {
    const CS = track.centre.s; let k = 0;
    while (k < CS.length - 1 && CS[k] < TOTAL - 0.01) k++;
    const x = track.centre.x, y = track.centre.y;
    return { x: x[k], y: y[k], h: Math.atan2(y[k] - y[k - 1], x[k] - x[k - 1]) };
  })();
  const labels = (function () {
    const f = track.features;
    const ch = f.crossingHeading;
    return [
      { t: 'START', x: f.start[0] - 0.02, y: f.start[1] - 0.075 },
      { t: 'CROSSING', x: f.crossing[0] + Math.cos(ch + Math.PI / 2) * 0.24, y: f.crossing[1] + Math.sin(ch + Math.PI / 2) * 0.24 },
      { t: 'GAP 5 cm', x: (f.gap[0] + f.gapEnd[0]) / 2, y: (f.gap[1] + f.gapEnd[1]) / 2 + 0.055 },
      { t: '90° CORNER', x: f.corner[0] + 0.105, y: f.corner[1] - 0.035 },
      { t: 'FINISH', x: f.end[0] + 0.07, y: f.end[1] - 0.05 },
    ];
  })();

  function S(x, y) { return [(x - cam.cx) * cam.scale + CW / 2, CH / 2 - (y - cam.cy) * cam.scale]; }
  function worldTransform() {
    const s = cam.scale * DPR;
    ctx.setTransform(s, 0, 0, -s, DPR * (CW / 2 - cam.cx * cam.scale), DPR * (CH / 2 + cam.cy * cam.scale));
  }
  function screenTransform() { ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }
  const px = (n) => n / cam.scale;   // n screen pixels in metres

  function draw() {
    if (!CW) return;
    const entries = player.entries, prim = entries[0];
    if (cam.mode === 'whole') fitWhole();
    else if (cam.mode === 'follow' && prim) {
      const i = frameIndex(prim), F = prim.run.frames, a = prim.params.ahead / 2;
      cam.cx = F.x[i] + a * Math.cos(F.th[i]); cam.cy = F.y[i] + a * Math.sin(F.th[i]);
      cam.scale = Math.min(CW, CH) / cam.win;
    }
    screenTransform();
    ctx.fillStyle = SURROUND; ctx.fillRect(0, 0, CW, CH);
    worldTransform();
    // floor
    ctx.fillStyle = '#ffffff'; ctx.fillRect(bbox.x0, bbox.y0, bbox.x1 - bbox.x0, bbox.y1 - bbox.y0);
    // 10 cm grid
    ctx.strokeStyle = '#edf0f3'; ctx.lineWidth = px(1);
    ctx.beginPath();
    for (let x = Math.ceil(bbox.x0 * 10) / 10; x <= bbox.x1; x += 0.1) { ctx.moveTo(x, bbox.y0); ctx.lineTo(x, bbox.y1); }
    for (let y = Math.ceil(bbox.y0 * 10) / 10; y <= bbox.y1; y += 0.1) { ctx.moveTo(bbox.x0, y); ctx.lineTo(bbox.x1, y); }
    ctx.stroke();
    // tape: butt ends + round joins = exactly the onLine() geometry
    const lw = prim ? prim.params.lineW : PR.cm(lineWcm);
    ctx.strokeStyle = '#141414'; ctx.lineWidth = lw; ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    for (const s of track.strokes) {
      ctx.beginPath(); ctx.moveTo(s.x[0], s.y[0]);
      for (let i = 1; i < s.n; i++) ctx.lineTo(s.x[i], s.y[i]);
      ctx.stroke();
    }
    drawFinish(lw);
    // overlay trails of ticked runs
    if (!player.race) {
      for (const h of history) {
        if (!h.ticked || h === prim) continue;
        ensureFrames(h);
        drawTrailMono(h, h.run.nFrames - 1, h.color, 0.85, 2);
      }
    }
    // trails being played
    if (player.race) entries.forEach((e) => drawTrailMono(e, frameIndex(e), e.color, 1, 2.5));
    else if (prim) drawTrailCat(prim, frameIndex(prim));
    // event markers
    if (prim) drawEvents(prim, frameIndex(prim));
    // robots
    if (player.race) for (let k = entries.length - 1; k >= 0; k--) drawRobot(entries[k], frameIndex(entries[k]), entries[k].color, k === 0);
    else if (prim) drawRobot(prim, frameIndex(prim), null, true);
    else drawGhostRobot();
    // labels + scale bar (screen space)
    screenTransform();
    drawLabels();
    drawScaleBar();
    if (prim) drawEndMarker(prim);
  }
  function frameIndex(e) { return Math.max(0, Math.min(e.run.nFrames - 1, Math.floor(player.t))); }
  function drawFinish(lw) {
    const { x, y, h } = finishPose;
    ctx.save(); ctx.translate(x, y); ctx.rotate(h);
    const half = 0.035, sq = 0.005;
    for (let k = 0; k < 14; k++) for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (k + j) % 2 ? '#141414' : '#ffffff';
      ctx.fillRect(j * sq - sq, -half + k * sq, sq, sq);
    }
    ctx.strokeStyle = '#141414'; ctx.lineWidth = px(1); ctx.strokeRect(-sq, -half, 2 * sq, 14 * sq);
    ctx.restore();
  }
  function drawTrailCat(e, upto) {
    const step = cam.scale > 1500 ? 1 : 2;
    ctx.lineWidth = px(2.6); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    let i = 0;
    while (i < upto) {
      const c = e.cat[i];
      let j = i;
      while (j < upto && e.cat[j] === c) j += 1;
      ctx.strokeStyle = CAT_COL[c]; ctx.beginPath(); ctx.moveTo(e.mx[i], e.my[i]);
      for (let k = i + step; k < j; k += step) ctx.lineTo(e.mx[k], e.my[k]);
      ctx.lineTo(e.mx[j], e.my[j]);
      ctx.stroke();
      i = j;
    }
  }
  function drawTrailMono(e, upto, col, alpha, w) {
    ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = px(w); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(e.mx[0], e.my[0]);
    const step = cam.scale > 1500 ? 1 : 3;
    for (let k = step; k < upto; k += step) ctx.lineTo(e.mx[k], e.my[k]);
    ctx.lineTo(e.mx[upto], e.my[upto]);
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  function drawEvents(e, upto) {
    screenTransform();
    const big = cam.scale > 900;
    let lastTag = null;   // label only sharp turns that are at least 12 cm apart
    ctx.font = '600 10.5px ' + getComputedStyle(document.body).fontFamily;
    for (const ev of e.run.events) {
      if (ev.i > upto) break;
      const [sx, sy] = S(ev.x, ev.y);
      if (sx < -40 || sy < -40 || sx > CW + 40 || sy > CH + 40) continue;
      if (ev.type === 'sharp') {
        ctx.fillStyle = CAT_COL[3]; ctx.beginPath(); ctx.moveTo(sx, sy - 5); ctx.lineTo(sx + 4.5, sy + 3.5); ctx.lineTo(sx - 4.5, sy + 3.5); ctx.closePath(); ctx.fill();
        if (big && (!lastTag || Math.hypot(ev.x - lastTag.x, ev.y - lastTag.y) > 0.12)) { tag(sx + 8, sy - 10, 'sharp turn ' + ev.dir, CAT_COL[3]); lastTag = ev; }
      } else if (ev.type === 'search') {
        disc(sx, sy, 8, CAT_COL[5], '?');
        tag(sx + 11, sy - 11, 'line lost → searching ' + ev.dir, CAT_COL[5]);
      } else if (ev.type === 'crossing') {
        disc(sx, sy, 8, CAT_COL[4], '#');
        tag(sx + 11, sy + 12, 'crossing ' + ev.n + ' counted', CAT_COL[4]);
      } else if (ev.type === 'stop') {
        disc(sx, sy, 8, '#c33129', '■');
        tag(sx + 11, sy - 11, 'program stops: ' + ev.reason, '#c33129');
      }
    }
    worldTransform();
  }
  function disc(x, y, r, col, ch) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, x, y + 0.5);
  }
  function tag(x, y, text, col) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.strokeStyle = col; ctx.lineWidth = 1;
    roundRect(x, y - 8, w, 16, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1b232c'; ctx.fillText(text, x + 5, y + 0.5);
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function drawLabels() {
    ctx.font = '700 10.5px ' + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const l of labels) {
      const [x, y] = S(l.x, l.y);
      const w = ctx.measureText(l.t).width + 12;
      ctx.fillStyle = '#1b232c'; roundRect(x - w / 2, y - 9, w, 18, 4); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.fillText(l.t, x, y + 0.5);
    }
  }
  function drawScaleBar() {
    const len = 0.10 * cam.scale;
    let L = 0.10, lab = '10 cm';
    if (len > CW * 0.4) { L = 0.01; lab = '1 cm'; }
    const w = L * cam.scale, x = 14, y = CH - 18;
    ctx.font = '600 10.5px ' + getComputedStyle(document.body).fontFamily;
    const bw = Math.max(w + 12, ctx.measureText(lab).width + 12);
    ctx.fillStyle = 'rgba(255,255,255,.9)'; roundRect(x - 6, y - 18, bw, 26, 4); ctx.fill();
    ctx.strokeStyle = '#1b232c'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y - 4); ctx.stroke();
    ctx.fillStyle = '#1b232c'; ctx.font = '600 10.5px ' + getComputedStyle(document.body).fontFamily; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(lab, x + w / 2, y - 6);
  }
  function drawEndMarker(e) {
    if (frameIndex(e) < e.run.nFrames - 1) return;
    const n = e.run.nFrames - 1;
    const [x, y] = S(e.mx[n], e.my[n]);
    ctx.font = '700 11px ' + getComputedStyle(document.body).fontFamily;
    if (e.run.ok) { disc(x, y, 10, '#17824a', '✓'); tag(x + 14, y + 14, 'FINISHED ' + fmt(e.run.lap, 2) + ' s', '#17824a'); }
    else { disc(x, y, 10, '#c33129', '✕'); tag(x + 14, y + 14, 'FAILED: ' + failText(e.run), '#c33129'); }
  }

  function drawRobot(e, i, tint, primary) {
    const F = e.run.frames, P = e.params;
    const x = F.x[i], y = F.y[i], th = F.th[i];
    const A = P.ahead, Wt = P.wheelTrack, Sp = P.spacing, D = PR.mm(e.cfg.build.wheelMm);
    const wheelW = 0.026;
    ctx.save(); ctx.translate(x, y); ctx.rotate(th);
    // chassis plate (translucent so the tape under the robot stays visible)
    const half = Wt / 2 - wheelW / 2 - 0.004;
    ctx.fillStyle = tint ? hexA(tint, 0.38) : 'rgba(64, 86, 112, 0.30)';
    ctx.strokeStyle = tint || '#34495e'; ctx.lineWidth = px(1.4);
    ctx.beginPath(); ctx.moveTo(-0.05, -half); ctx.lineTo(A - 0.018, -half); ctx.lineTo(A - 0.004, -Math.max(Sp / 2 + 0.012, 0.03));
    ctx.lineTo(A + 0.008, -Math.max(Sp / 2 + 0.012, 0.03)); ctx.lineTo(A + 0.008, Math.max(Sp / 2 + 0.012, 0.03));
    ctx.lineTo(A - 0.004, Math.max(Sp / 2 + 0.012, 0.03)); ctx.lineTo(A - 0.018, half); ctx.lineTo(-0.05, half); ctx.closePath();
    ctx.fill(); ctx.stroke();
    if (primary) {
      // Arduino UNO (68.6 x 53.4 mm) on the plate
      ctx.fillStyle = 'rgba(0, 151, 157, 0.30)'; ctx.strokeStyle = 'rgba(0, 120, 125, 0.7)'; ctx.lineWidth = px(1);
      ctx.fillRect(-0.04, -0.0343, 0.0534, 0.0686); ctx.strokeRect(-0.04, -0.0343, 0.0534, 0.0686);
    }
    // castor
    ctx.fillStyle = '#7d8792'; ctx.beginPath(); ctx.arc(-0.038, 0, 0.008, 0, 2 * Math.PI); ctx.fill();
    // wheels
    ctx.fillStyle = '#23272b';
    for (const side of [1, -1]) ctx.fillRect(-D / 2, side * Wt / 2 - wheelW / 2, D, wheelW);
    ctx.fillStyle = '#5a6168';
    for (const side of [1, -1]) ctx.fillRect(-0.004, side * Wt / 2 - wheelW / 2, 0.008, wheelW);
    // sensor bar
    ctx.fillStyle = 'rgba(20, 52, 110, 0.85)';
    ctx.fillRect(A - 0.005, -Sp / 2 - 0.009, 0.010, Sp + 0.018);
    // wheel speed arrows (green forward, red backward)
    if (primary) {
      const off = Wt / 2 + wheelW / 2 + Math.max(0.006, px(6));
      arrow(0, off, F.vl[i]); arrow(0, -off, F.vr[i]);
    }
    // IR sensors: red while over black
    const fl = F.flags[i];
    for (const [side, bit] of [[1, 1], [-1, 2]]) {
      const on = fl & bit;
      ctx.beginPath(); ctx.arc(A, side * Sp / 2, Math.max(0.0032, px(3.2)), 0, 2 * Math.PI);
      ctx.fillStyle = on ? '#ff2a17' : '#ffffff'; ctx.fill();
      ctx.strokeStyle = on ? '#8f1308' : '#2c3e50'; ctx.lineWidth = px(1.3); ctx.stroke();
    }
    // sensor midpoint (the trail point)
    ctx.strokeStyle = tint || '#1b232c'; ctx.lineWidth = px(1.2);
    ctx.beginPath(); ctx.moveTo(A - 0.004, 0); ctx.lineTo(A + 0.004, 0); ctx.moveTo(A, -0.004); ctx.lineTo(A, 0.004); ctx.stroke();
    ctx.restore();
  }
  function arrow(x0, y0, v) {
    if (Math.abs(v) < 0.004) return;
    const L = v * 0.11, col = v > 0 ? '#1f9d47' : '#d9302a';
    const hl = Math.min(Math.abs(L) * 0.45, px(9)) * Math.sign(L);
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = px(3); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + L - hl * 0.6, y0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0 + L, y0); ctx.lineTo(x0 + L - hl, y0 + Math.abs(hl) * 0.6); ctx.lineTo(x0 + L - hl, y0 - Math.abs(hl) * 0.6); ctx.closePath(); ctx.fill();
  }
  function drawGhostRobot() { /* no run loaded: nothing to draw */ }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  // ------------------------------------------------------------------ readouts
  const STATE_NAMES = { 0: 'STRAIGHT', 3: 'CROSSING', 4: 'SEARCH LEFT', 5: 'SEARCH RIGHT' };
  function stateOf(e, i) {
    const F = e.run.frames, ph = PH[F.phase[i]], running = F.flags[i] & 16;
    if (ph === 'WAITING') return { name: 'WAITING FOR START', cat: 0 };
    if (ph === 'START_DELAY') return { name: 'START DELAY', cat: 0 };
    if (ph === 'KICK') return { name: 'KICK', cat: 0 };
    if (ph === 'STOPPING' || ph === 'STOPPED' || !running) return { name: 'STOPPED', cat: 6 };
    const a = F.action[i], sharp = F.tia[i] >= e.run.constants.SHARP_AFTER_MS;
    if (a === 1) return { name: sharp ? 'SHARP LEFT' : 'TURN LEFT', cat: sharp ? 3 : 2 };
    if (a === 2) return { name: sharp ? 'SHARP RIGHT' : 'TURN RIGHT', cat: sharp ? 3 : 2 };
    return { name: STATE_NAMES[a], cat: e.cat[i] };
  }
  const B = (b) => b ? '<span class="kB black">BLACK</span>' : '<span class="kB white">white</span>';
  const memName = (m) => (m === 1 ? 'LEFT' : m === 2 ? 'RIGHT' : '');
  function ruleOf(e, i) {
    const F = e.run.frames, C = e.run.constants, ph = PH[F.phase[i]];
    const t = i / 1000;
    if (ph === 'WAITING') return t < 0.30 ? 'Waiting for the START button. The simulator presses START at 0.30 s and holds it for 0.15 s.' : 'START is being pressed (the program reacts to the moment it goes down).';
    if (ph === 'START_DELAY') return `START pressed: <span class="code">delay(START_DELAY_MS)</span> waits ${C.START_DELAY_MS} ms so you can take your hand away.`;
    if (ph === 'KICK') return `Kick: <span class="code">drive(255, 255)</span> for KICK_MS = ${C.KICK_MS} ms so both wheels start together.`;
    if (ph === 'STOPPING') return `<span class="code">stopRun("${esc(e.run.stopReason)}")</span>: brake for 200 ms (L298N inputs LOW, enable 255).`;
    if (ph === 'STOPPED') return `Stopped: ${esc(e.run.stopReason)}. Motors off, the program waits for START.`;
    const L = !!(F.flags[i] & 4), R = !!(F.flags[i] & 8), br = F.branch[i];
    const a = F.action[i], mem = memName(F.mem[i]);
    const LR = B(L) + ' | ' + B(R) + ' &rarr; ';
    switch (br) {
      case 1: return LR + 'drifted right &rarr; <b>turn left</b>, inner wheel stopped (TURN_INNER_SOFT ' + C.TURN_INNER_SOFT + ').';
      case 2: return LR + `still black after ${C.SHARP_AFTER_MS} ms &rarr; sharp bend &rarr; <b>spin left</b>, inner wheel backwards (${C.TURN_INNER_SHARP}).`;
      case 3: return LR + 'drifted left &rarr; <b>turn right</b>, inner wheel stopped (TURN_INNER_SOFT ' + C.TURN_INNER_SOFT + ').';
      case 4: return LR + `still black after ${C.SHARP_AFTER_MS} ms &rarr; sharp bend &rarr; <b>spin right</b>, inner wheel backwards (${C.TURN_INNER_SHARP}).`;
      case 5:
        if (a === 4 || a === 5) return LR + `no single sensor on the line yet &rarr; <b>keep searching ${a === 4 ? 'left' : 'right'}</b> (gives up after ${C.SEARCH_GIVE_UP_MS} ms).`;
        return LR + `both black during a sharp turn &rarr; on top of a corner &rarr; <b>keep spinning ${a === 1 ? 'left' : 'right'}</b>.`;
      case 6: return LR + `searched for ${C.SEARCH_GIVE_UP_MS} ms without finding the line &rarr; <b>give up and stop</b>.`;
      case 7: return LR + 'line between the sensors &rarr; <b>straight on</b>' + (mem ? ` (remembering ${mem}: searches if no line for ${C.LOST_AFTER_MS} ms)` : '') + '.';
      case 8: return LR + `no line for ${C.LOST_AFTER_MS} ms after a sharp turn &rarr; line lost &rarr; <b>spin back ${a === 4 ? 'left' : 'right'}</b> (line memory).`;
      case 9: return LR + 'crossing line &rarr; <b>keep going straight</b> at SPEED_CROSSING.';
      case 10: return LR + 'both black for 1 s &rarr; robot lifted? &rarr; <b>stop</b>.';
      default: return 'Run started: the first sensor reading comes next.';
    }
  }
  function pwmBar(fillEl, valEl, v, brake) {
    const w = Math.abs(v) / 255 * 50;
    fillEl.style.left = (v >= 0 ? 50 : 50 - w) + '%'; fillEl.style.width = w + '%';
    fillEl.style.background = brake ? 'var(--ink-3)' : v >= 0 ? '#1f9d47' : '#d9302a';
    setText(valEl, brake ? 'BRAKE' : String(v));
  }
  let lastResultShown = null;
  function updateReadouts() {
    const e = player.entries[0];
    if (!e) return;
    const i = frameIndex(e), F = e.run.frames;
    const t = i / 1000;
    setText($('#rClock'), fmt(t, 3));
    const st = e.run.runStartedAtMs;
    const lap = (F.flags[i] & 16) || i >= e.run.nFrames - 1 ? (i >= e.run.nFrames - 1 && e.run.ok ? e.run.lap : Math.max(0, t - st / 1000)) : null;
    setText($('#rLap'), lap === null || i * 1 < st ? '–' : fmt(lap, 3));
    const s = stateOf(e, i);
    const pill = $('#rState'); setText(pill, s.name); pill.style.background = CAT_COL[s.cat];
    const gl = !!(F.flags[i] & 1), gr = !!(F.flags[i] & 2);
    $('#sL').classList.toggle('black', gl); setText($('#sL b'), gl ? 'BLACK' : 'white');
    $('#sR').classList.toggle('black', gr); setText($('#sR b'), gr ? 'BLACK' : 'white');
    const rule = ruleOf(e, i);
    setHTML($('#rRule'), rule); setHTML($('#codeRule'), rule);
    pwmBar($('#pwmLf'), $('#pwmL'), F.pwmL[i], !!(F.flags[i] & 32));
    pwmBar($('#pwmRf'), $('#pwmR'), F.pwmR[i], !!(F.flags[i] & 64));
    setText($('#rWheels'), fmt(F.vl[i], 2) + ' / ' + fmt(F.vr[i], 2) + ' m/s');
    const dv = F.dev[i] * 1000;
    setText($('#rDev'), fmt(Math.abs(dv), 1) + ' mm ' + (Math.abs(dv) < 0.05 ? '' : dv > 0 ? 'left' : 'right'));
    $('#devMark').style.left = (50 + Math.max(-50, Math.min(50, dv / 20 * 50))) + '%';
    const pct = 100 * F.prog[i] / TOTAL;
    setText($('#rProg'), fmt(pct, 1) + ' %  (' + fmt(F.prog[i], 2) + ' / ' + fmt(TOTAL, 2) + ' m)');
    $('#progBar').style.width = Math.min(100, pct) + '%';
    setText($('#rJunc'), String(F.junc[i]));
    const mem = memName(F.mem[i]);
    setText($('#rMem'), mem ? 'remembering: ' + mem : '–');
    setText($('#tClock'), fmt(t, 3) + ' / ' + fmt((e.run.nFrames - 1) / 1000, 3) + ' s');
    if (!player.playing || Math.round(player.t) % 7 === 0) $('#scrub').value = Math.floor(player.t);
    renderPauseBtn();
    // result card
    const done = player.t >= duration() - 0.5;
    const key = done ? player.entries.map((x) => x.id).join(',') : 'pending';
    if (key !== lastResultShown) { lastResultShown = key; renderResult(done); }
    renderSerial(false);
    if (player.race) renderRace();
    updateCode(e, i);
  }
  function renderResult(done) {
    const box = $('#resultCard'), e = player.entries[0];
    if (!done) { box.className = 'result pending'; box.innerHTML = 'The result appears when the playback reaches the end of the run.'; return; }
    const r = e.run;
    if (r.ok) {
      box.className = 'result ok';
      box.innerHTML = `<div class="head">FINISHED</div><div><span class="big">${fmt(r.lap, 2)}</span> s lap time</div>
        <dl class="kv"><dt>Average off the line</dt><dd>${fmt(r.meanDev, 1)} mm</dd><dt>Maximum off the line</dt><dd>${fmt(r.maxDev, 1)} mm</dd><dt>Crossings counted</dt><dd>${r.junctions}</dd></dl>`;
    } else {
      box.className = 'result bad';
      box.innerHTML = `<div class="head">FAILED</div><div class="why">${esc(failText(r))}</div>
        <dl class="kv"><dt>At</dt><dd>${fmt(r.endT, 2)} s</dd><dt>Got to</dt><dd>${fmt(r.progress, 2)} of ${fmt(TOTAL, 2)} m</dd><dt>Maximum off the line</dt><dd>${fmt(r.maxDev, 1)} mm</dd></dl>`;
    }
  }
  let serialShownCount = -1;
  function renderSerial(force) {
    const e = player.entries[0], box = $('#serial');
    if (!e) { box.textContent = ''; return; }
    const t = Math.floor(player.t) / 1000;
    const lines = e.serialLines.filter((l) => l.t <= t + 1e-9);
    if (!force && lines.length === serialShownCount) return;
    serialShownCount = lines.length;
    box.innerHTML = lines.map((l) => `<span class="t">${fmt(l.t, 3)} &gt; </span>${esc(l.s)}`).join('\n');
    box.scrollTop = box.scrollHeight;
  }
  function renderRace() {
    const html = player.entries.map((e) => {
      const i = frameIndex(e), done = i >= e.run.nFrames - 1;
      const st = done ? (e.run.ok ? `FINISHED ${fmt(e.run.lap, 2)} s` : 'FAILED') : fmt(100 * e.run.frames.prog[i] / TOTAL, 0) + ' %';
      return `<div class="race-row"><span class="sw" style="background:${e.color}"></span><span class="nm">#${e.id} ${e.cfg.rpm} RPM &middot; ${esc(programLabel(e.cfg))}</span><span class="st" style="color:${done ? (e.run.ok ? 'var(--ok)' : 'var(--bad)') : 'inherit'}">${st}</span></div>`;
    }).join('');
    setHTML($('#raceBoard'), html);
  }

  // ------------------------------------------------------------------ code view
  const codeLines = (DATA.followLine || '').split('\n');
  const codeMap = (function () {
    const idx = (s, from) => { for (let k = from || 0; k < codeLines.length; k++) if (codeLines[k].includes(s)) return k; return -1; };
    const iL = idx('if (left && !right)'), iR = idx('else if (!left && right)'), iS = idx('else if (searching ||'), iW = idx('else if (!left && !right)');
    const iX = idx('  else {', iW + 1), iD = idx('if (DEBUG');
    const iGive = idx('if (timeInAction() >= SEARCH_GIVE_UP_MS)', iS), iSpin = idx('spin(action == ACT_LEFT', iS);
    const iMem = idx('if (lineMemory != ACT_STRAIGHT', iW), iElse = idx('} else {', iMem), iStr = idx('drive(SPEED_STRAIGHT', iW);
    const iLift = idx('if (timeInAction() >= LIFTED_STOP_MS)', iX), iCrossDrive = idx('drive(SPEED_CROSSING', iX);
    const iRead = idx('bool left'), iSharpDef = idx('bool sharpTurn');
    const r = (a, b) => { const o = []; for (let k = a; k <= b; k++) o.push(k); return o; };
    const head = r(iRead, iSharpDef);
    return {
      head,
      1: { blk: r(iL, iR - 1), hot: r(iL, iR - 2) }, 2: { blk: r(iL, iR - 1), hot: r(iL, iR - 2) },
      3: { blk: r(iR, iS - 1), hot: r(iR, iS - 2) }, 4: { blk: r(iR, iS - 1), hot: r(iR, iS - 2) },
      5: { blk: r(iS, iW - 1), hot: [iS, iSpin] }, 6: { blk: r(iS, iW - 1), hot: r(iGive, iGive + 3) },
      7: { blk: r(iW, iX - 1), hot: [iW, idx('if (sharpTurn)', iW), idx('setAction(ACT_STRAIGHT)', iW), iMem, iElse, iStr] },
      8: { blk: r(iW, iX - 1), hot: r(iMem, iElse - 1) },
      9: { blk: r(iX, iD - 2), hot: [iX, idx('lineMemory = ACT_STRAIGHT', iX), idx('if (setAction(ACT_CROSSING))', iX), iCrossDrive] },
      10: { blk: r(iX, iD - 2), hot: r(iLift, iLift + 3) },
    };
  })();
  (function renderCode() {
    const pre = $('#codePre');
    pre.innerHTML = codeLines.map((l, k) => `<span class="ln" data-k="${k}"><span class="no">${k + 1}</span>${hl(l)}</span>`).join('');
  })();
  function hl(line) {
    let code = line, cm = '';
    const ci = line.indexOf('//');
    if (ci >= 0) { code = line.slice(0, ci); cm = line.slice(ci); }
    let h = esc(code).replace(/\b(if|else|return|bool|void|const|byte|int|unsigned|long)\b/g, '<span class="k">$1</span>')
      .replace(/\b(-?\d+)\b/g, '<span class="d">$1</span>');
    return h + (cm ? '<span class="c">' + esc(cm) + '</span>' : '');
  }
  let lastCodeKey = '';
  function updateCode(e, i) {
    if ($('#p-code').hidden) return;
    const F = e.run.frames, running = F.flags[i] & 16, br = running && PH[F.phase[i]] === 'RUNNING' ? F.branch[i] : 0;
    const key = br + ':' + e.id;
    const vars = `<dt>action</dt><dd>${['ACT_STRAIGHT', 'ACT_LEFT', 'ACT_RIGHT', 'ACT_CROSSING', 'ACT_SEARCH_LEFT', 'ACT_SEARCH_RIGHT'][F.action[i]]}</dd>
      <dt>timeInAction()</dt><dd>${running ? F.tia[i] + ' ms' : '–'}</dd><dt>lineMemory</dt><dd>${['ACT_STRAIGHT', 'ACT_LEFT', 'ACT_RIGHT'][F.mem[i]] || F.mem[i]}</dd>
      <dt>junctionCount</dt><dd>${F.junc[i]}</dd><dt>running</dt><dd>${running ? 'true' : 'false'}</dd>`;
    setHTML($('#codeVars'), vars);
    if (key === lastCodeKey) return;
    lastCodeKey = key;
    const m = codeMap[br];
    const blk = new Set(m ? m.blk.concat(codeMap.head) : []), hot = new Set(m ? m.hot : []);
    let first = null;
    $$('#codePre .ln').forEach((el) => {
      const k = +el.dataset.k;
      el.classList.toggle('blk', blk.has(k)); el.classList.toggle('hot', hot.has(k));
      if (hot.has(k) && first === null) first = el;
    });
    if (first) {
      const body = $('.bench-body');
      const fr = first.getBoundingClientRect(), br = body.getBoundingClientRect();
      if (fr.top < br.top + 10 || fr.bottom > br.bottom - 10) body.scrollTop += fr.top - br.top - 60;
    }
  }

  // ------------------------------------------------------------------ history table
  function renderHistory() {
    const tb = $('#histBody');
    const shown = new Set(player.entries.map((e) => e.id));
    tb.innerHTML = history.slice().reverse().map((e) => {
      const r = e.run;
      return `<tr data-id="${e.id}" class="${shown.has(e.id) ? 'current' : ''}">
        <td><input type="checkbox" aria-label="Tick run ${e.id}" ${e.ticked ? 'checked' : ''}><span class="sw" style="background:${e.ticked ? e.color : 'transparent'}"></span></td>
        <td class="n">${e.id}</td>
        <td class="n">${e.cfg.rpm} <span class="small">${fmt(e.cfg.vmax, 3).replace(/0$/, '')} m/s</span></td>
        <td>${esc(programLabel(e.cfg))}</td>
        <td class="small" title="${BUILD_HELP}">${esc(buildLabel(e.cfg))}</td>
        <td class="n">${e.cfg.lineWcm} cm</td>
        <td class="${r.ok ? 'tagok' : 'tagbad'}">${esc(resultShort(e))}</td>
        <td class="n">${r.ok ? fmt(r.lap, 2) + ' s' : '–'}</td>
        <td class="n">${fmt(r.maxDev, 1)} mm</td>
        <td class="n">${fmt(r.meanDev, 1)} mm</td></tr>`;
    }).join('') || '<tr><td colspan="10" class="small">No runs yet. Press Start run.</td></tr>';
    const nt = history.filter((h) => h.ticked).length;
    $('#btnRace').disabled = nt < 2;
    $('#btnRace').textContent = nt >= 2 ? `Race ticked runs (${Math.min(nt, 4)})` : 'Race ticked runs';
  }
  $('#histBody').addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr[data-id]'); if (!tr) return;
    const e = history.find((h) => h.id === +tr.dataset.id); if (!e) return;
    if (ev.target.matches('input[type=checkbox]')) {
      e.ticked = ev.target.checked;
      if (e.ticked) ensureFrames(e);
      renderHistory(); dirty = true; return;
    }
    setControls(e.cfg);
    load([e]); play();
  });
  $('#btnRace').addEventListener('click', () => {
    const ticked = history.filter((h) => h.ticked);
    if (ticked.length < 2) return;
    if (ticked.length > 4) toast('Racing the first 4 ticked runs.');
    load(ticked.slice(0, 4), true); play();
  });
  $('#btnUntick').addEventListener('click', () => { history.forEach((h) => { h.ticked = false; }); renderHistory(); dirty = true; });
  $('#btnClear').addEventListener('click', () => {
    const keep = player.entries.slice();
    history.length = 0; keep.forEach((e) => { e.ticked = false; history.push(e); });
    renderHistory(); toast('History cleared (the run on screen is kept).');
  });

  // ------------------------------------------------------------------ tabs
  $$('[role=tab]').forEach((tab) => tab.addEventListener('click', () => {
    $$('[role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    $$('[role=tabpanel]').forEach((p) => { p.hidden = p.id !== tab.getAttribute('aria-controls'); });
    if ($('#app').classList.contains('bench-collapsed')) toggleBench();
    lastCodeKey = ''; dirty = true;
    store('lf-tab', tab.id);
  }));
  function toggleBench() {
    const app = $('#app'); const c = app.classList.toggle('bench-collapsed');
    $('#benchToggle').innerHTML = c ? '&#9652; show' : '&#9662; hide';
    $('#benchToggle').setAttribute('aria-expanded', String(!c));
    resize();
  }
  $('#benchToggle').addEventListener('click', toggleBench);
  (function splitter() {
    const sp = $('#splitter'), app = $('#app');
    const saved = parseFloat(store('lf-bench-h'));
    if (saved > 0) app.style.setProperty('--bench-h', saved + 'px');
    let d = null;
    sp.addEventListener('pointerdown', (ev) => { d = { y: ev.clientY, h: $('.bench-body').getBoundingClientRect().height }; sp.setPointerCapture(ev.pointerId); });
    sp.addEventListener('pointermove', (ev) => {
      if (!d) return;
      const h = Math.max(110, Math.min(window.innerHeight - 330, d.h - (ev.clientY - d.y)));
      app.style.setProperty('--bench-h', h + 'px'); resize();
    });
    const end = () => { if (d) store('lf-bench-h', String($('.bench-body').getBoundingClientRect().height)); d = null; };
    sp.addEventListener('pointerup', end); sp.addEventListener('pointercancel', end);
  })();
  if (window.innerWidth < 700) $('#legend').open = false;
  $('#legend').addEventListener('toggle', () => { dirty = true; });

  // ------------------------------------------------------------------ 72 combinations
  const WORKER_GLUE = `
    var __track = LFTrack.writeTrack();
    self.onmessage = function (e) {
      var j = e.data;
      if (j.ping) { self.postMessage({ pong: true }); return; }
      var r = LFWorld.simulate(__track, j.params, { record: false });
      self.postMessage({ id: j.id, ok: r.ok, lap: r.lap, failWhy: r.failWhy, stopReason: r.stopReason, maxDev: r.maxDev,
        meanDev: r.meanDev, junctions: r.junctions, progress: r.progress, endT: r.endT });
    };`;
  let pool = null;
  function makePool() {
    return new Promise((resolve) => {
      if (pool !== null) return resolve(pool);
      let url, ws = [];
      try {
        const src = $('#lf-core').textContent + '\n' + WORKER_GLUE;
        url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const n = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
        for (let k = 0; k < n; k++) ws.push(new Worker(url));
      } catch (err) { pool = false; return resolve(false); }
      let answered = 0, settled = false;
      const fail = () => { if (settled) return; settled = true; ws.forEach((w) => w.terminate()); pool = false; resolve(false); };
      const timer = setTimeout(fail, 4000);
      ws.forEach((w) => {
        w.onerror = fail;
        w.onmessage = (m) => { if (m.data && m.data.pong && ++answered === ws.length && !settled) { settled = true; clearTimeout(timer); pool = ws; resolve(ws); } };
        w.postMessage({ ping: true });
      });
    });
  }
  function runOnWorkers(ws, jobs, onOne) {
    return new Promise((resolve, reject) => {
      const res = new Array(jobs.length); let next = 0, done = 0;
      const feed = (w) => { if (next < jobs.length) { const k = next++; w.postMessage({ id: k, params: jobs[k] }); } };
      ws.forEach((w) => {
        w.onerror = (err) => reject(err);
        w.onmessage = (m) => { const r = m.data; res[r.id] = r; done++; onOne(r.id, r, done); if (done === jobs.length) resolve(res); else feed(w); };
      });
      ws.forEach(feed);
    });
  }
  function runChunked(jobs, onOne) {
    return new Promise((resolve) => {
      const res = new Array(jobs.length); let k = 0;
      const step = () => {
        const t0 = performance.now();
        while (k < jobs.length && performance.now() - t0 < 40) {
          const r = W.simulate(track, jobs[k], { record: false });
          res[k] = { ok: r.ok, lap: r.lap, failWhy: r.failWhy, stopReason: r.stopReason, maxDev: r.maxDev, meanDev: r.meanDev, junctions: r.junctions, progress: r.progress, endT: r.endT };
          onOne(k, res[k], k + 1); k++;
        }
        if (k < jobs.length) setTimeout(step, 0); else resolve(res);
      };
      setTimeout(step, 0);
    });
  }
  function fullSettings(over) {
    const d = { SPEED_STRAIGHT: 150, SPEED_CROSSING: 130, TURN_OUTER: 170, TURN_INNER_SOFT: 0, TURN_INNER_SHARP: -150, SHARP_AFTER_MS: 30, LOST_AFTER_MS: 250, SEARCH_GIVE_UP_MS: 2000 };
    return Object.assign(d, over || {});
  }
  function refFor(cfg) {
    const mine = fullSettings(cfg.settings);
    return (DATA.robust || []).find((r) => r.vmax === cfg.vmax && SK.every((k) => fullSettings(r.settings)[k] === mine[k])) || null;
  }
  function update72Desc() {
    const el = $('#desc72'); if (!el) return;
    const cfg = getCfg();
    const ref = refFor(cfg);
    el.innerHTML = `Uses ${cfg.rpm} RPM (${fmt(cfg.vmax, 3).replace(/0$/, '')} m/s) and <b>${esc(programLabel(cfg))}</b>, with 4.0 cm sensor spacing and every combination of line width 2.0/2.5/3.0 cm &times; sensors ahead 5/7/9 cm &times; TAU 0.05/0.10 s &times; DEAD 40/80 &times; wheel spacing 12/15 cm.` +
      (ref ? ` The C++ reference result for these settings is known (${ref.cppPass}/72).` : '');
  }
  let last72 = null;
  async function test72() {
    const cfg = getCfg();
    const conds = PR.robustConditions();
    const jobs = conds.map((c) => ({ lineW: c.lineW, spacing: c.spacing, ahead: c.ahead, tau: c.tau, dead: c.dead, wheelTrack: c.wheelTrack, vmax: cfg.vmax, settings: Object.assign({}, cfg.settings) }));
    const btn = $('#btn72'); btn.disabled = true;
    const wrap = $('#prog72wrap'), bar = $('#prog72'); wrap.hidden = false; bar.style.width = '0';
    const t0 = performance.now();
    render72(cfg, conds, jobs, new Array(72), false);
    const onOne = (k, r, done) => { bar.style.width = (100 * done / jobs.length) + '%'; partial[k] = r; if (done % 4 === 0 || done === jobs.length) render72(cfg, conds, jobs, partial, false); };
    const partial = new Array(72);
    let res = null;
    const ws = await makePool();
    if (ws) { try { res = await runOnWorkers(ws, jobs, onOne); } catch (err) { pool = false; res = null; } }
    if (!res) res = await runChunked(jobs, onOne);
    const secs = (performance.now() - t0) / 1000;
    last72 = { cfg, conds, jobs, res };
    render72(cfg, conds, jobs, res, true, secs, !!ws);
    wrap.hidden = true; btn.disabled = false;
  }
  $('#btn72').addEventListener('click', test72);
  function shortFail(r) {
    if (r.failWhy === 'left the track') return 'off';
    if (r.failWhy === 'timeout') return 'time';
    if (/line lost/.test(r.stopReason)) return 'lost';
    return 'stop';
  }
  function render72(cfg, conds, jobs, res, final, secs, usedWorkers) {
    const box = $('#res72');
    const ref = final ? refFor(cfg) : null;
    const nOk = res.filter((r) => r && r.ok).length, nDone = res.filter(Boolean).length;
    const laps = res.filter((r) => r && r.ok).map((r) => r.lap);
    let mism = 0;
    if (ref) res.forEach((r, k) => { if (r && r.ok !== ref.perCondition[k].ok) mism++; });
    let html = `<div class="summary72"><span><span class="big">${nOk} / 72</span> finished</span>`;
    if (final && laps.length) html += `<span class="small">laps ${fmt(Math.min(...laps), 2)}&ndash;${fmt(Math.max(...laps), 2)} s</span>`;
    if (!final) html += `<span class="small">${nDone} of 72 done&hellip;</span>`;
    if (final) html += `<span class="small">${fmt(secs, 1)} s, ${usedWorkers ? 'background workers' : 'on the page'}</span>`;
    if (ref) html += `<span class="refnote ${mism === 0 && ref.cppPass === nOk ? 'match' : ''}">C++ reference simulator: ${ref.cppPass}/72 ${mism === 0 ? '&middot; every cell agrees' : '&middot; ' + mism + ' cells differ'}</span>`;
    html += '</div><div class="grid72-wrap"><table class="grid72"><thead><tr><th></th>';
    for (const tau of PR.ROBUST.tau) for (const dead of PR.ROBUST.dead) for (const wt of PR.ROBUST.wheelTrack)
      html += `<th class="colh">τ ${fmt(tau, 2)}<br>DEAD ${dead}<br>${fmt(wt * 100, 0)} cm</th>`;
    html += '</tr></thead><tbody>';
    let k = 0;
    for (const lw of PR.ROBUST.lineW) for (const ah of PR.ROBUST.ahead) {
      html += `<tr><th class="rowh">${fmt(lw * 100, 1)} cm line &middot; ${fmt(ah * 100, 0)} cm ahead</th>`;
      for (let c = 0; c < 8; c++, k++) {
        const r = res[k];
        const cls = r ? (r.ok ? 'ok' : 'bad') : '';
        const mm = ref && r && r.ok !== ref.perCondition[k].ok ? ' mismatch' : '';
        html += `<td class="${cls}${mm}" data-k="${k}">${r ? (r.ok ? fmt(r.lap, 1) : shortFail(r)) : ''}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table></div><div class="small" style="margin-top:6px">Green: finished (lap time in s). Red: failed &ndash; off = left the track, lost = line lost and the program stopped, time = timeout. Hover a cell for details, click it to watch that run.</div>';
    box.innerHTML = html;
    box._data = { cfg, conds, jobs, res };
  }
  const tip = $('#tip');
  $('#res72').addEventListener('mousemove', (ev) => {
    const td = ev.target.closest('td[data-k]'); const d = $('#res72')._data;
    if (!td || !d) { tip.hidden = true; return; }
    const k = +td.dataset.k, c = d.conds[k], r = d.res[k];
    tip.innerHTML = `<b>Condition ${k + 1} of 72</b><br>line ${fmt(c.lineW * 100, 1)} cm, sensor spacing 4.0 cm<br>sensors ${fmt(c.ahead * 100, 0)} cm ahead, wheels ${fmt(c.wheelTrack * 100, 0)} cm apart<br>TAU ${c.tau} s, DEAD ${c.dead}<br>` +
      (r ? (r.ok ? `<b>FINISHED</b> lap ${fmt(r.lap, 2)} s, max ${fmt(r.maxDev, 1)} mm off` : `<b>FAILED</b>: ${esc(failText(r))} at ${fmt(r.endT, 2)} s`) : 'running&hellip;');
    tip.hidden = false;
    const x = Math.min(window.innerWidth - 290, ev.clientX + 14), y = Math.min(window.innerHeight - 130, ev.clientY + 14);
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  });
  $('#res72').addEventListener('mouseleave', () => { tip.hidden = true; });
  $('#res72').addEventListener('click', (ev) => {
    const td = ev.target.closest('td[data-k]'); const d = $('#res72')._data;
    if (!td || !d || !d.res[+td.dataset.k]) return;
    const k = +td.dataset.k, c = d.conds[k];
    const cfg = JSON.parse(JSON.stringify(d.cfg));
    cfg.lineWcm = fmt(c.lineW * 100, 1);
    cfg.build.spacingCm = '4.0'; cfg.build.aheadCm = fmt(c.ahead * 100, 1); cfg.build.trackCm = fmt(c.wheelTrack * 100, 1);
    cfg.build.tau = fmt(c.tau, 2); cfg.build.dead = String(c.dead);
    tip.hidden = true;
    setControls(cfg);
    const key = cfgKey(cfg);
    let e = history.find((h) => cfgKey(h.cfg) === key);
    if (!e) { e = simulateEntry(cfg, { from: 'combination ' + (k + 1) + ' of 72' }); addToHistory(e); }
    load([e]); play();
    toast(`Loaded combination ${k + 1} of 72. The settings on the left now match it.`);
  });

  // ------------------------------------------------------------------ main loop
  function frame(now) {
    if (player.playing) {
      const dt = Math.min(100, now - player.last); player.last = now;
      player.t += dt * player.speed;
      const d = duration();
      if (player.t >= d) { player.t = d; player.playing = false; }
      dirty = true;
    }
    if (dirty) { dirty = false; draw(); updateReadouts(); }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ start-up
  (function init() {
    const th = store('lf-theme');
    applyTheme(th === 'light' || th === 'dark' ? th : 'auto');
    applyPreset('default');
    resize();
    const first = simulateEntry(getCfg(), { from: 'the reference run, ready to play' });
    addToHistory(first);
    load([first]);
    renderPauseBtn();
    const tabId = store('lf-tab');
    if (tabId && $('#' + tabId)) $('#' + tabId).click();
    requestAnimationFrame((t) => { player.last = t; frame(t); });
    window.LFApp = { player, history, getCfg, setControls, test72, startRun, load, duration,
      seek(t) { pause(); player.t = Math.max(0, Math.min(duration(), t)); renderSerial(true); dirty = true; }, get last72() { return last72; } };
  })();
})();
