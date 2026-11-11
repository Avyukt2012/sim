/*
 * world.js - port of reference/sim/sim.cpp: the 2-D robot model that runs the LF3 sketch.
 *
 *   LFWorld.simulate(track, params, options) -> run
 *
 * params  : { lineW, spacing, ahead, wheelTrack, vmax, dead, tau, settings }   (metres, m/s, PWM, seconds)
 * options : { record: true  -> keep the state every 1 ms for playback (default true)
 *             trace:  true  -> also produce the C++ trace.csv text (every 5 ms, same format)
 *             trig:  'cr' (default, correctly rounded sin/cos) | 'native' (Math.sin/Math.cos) }
 *
 * Same order of operations as sim.cpp: 500 us world steps, main loop = loop() then advance(500 us),
 * delay(ms) advances the world while the sketch waits, first-order wheel lag (TAU / TAU_BRAKE / TAU_COAST),
 * PWM dead zone, heading updated first then x and y, progress/deviation check every whole millisecond.
 * onLine() uses a spatial grid, but evaluates exactly the same segments with exactly the same arithmetic
 * as the C++ loop (the grid only skips segments that the C++ "fabs(..) > 0.03" test would skip anyway).
 */
(function (root) {
  'use strict';
  const req = (typeof require !== 'undefined') ? require : null;
  const LM = root.LFMath || req('./mathlib.js');
  const LF3 = root.LF3Sketch || req('./lf3_sketch.js');

  // ---- grid of tape segments (built once per track and line width)
  // The C++ onLine() tests every segment whose first point a lies within a 3 cm box of the sensor and
  // returns true if ANY test succeeds.  A test can only succeed if the sensor is within half a line width
  // of the segment, so each grid cell only lists the segments whose bounding box comes within
  // (half line width + 1 mm) of the cell.  The skipped segments would all have returned false, and the
  // order of the tests cannot matter for an "any" result, so onLine() returns exactly the C++ answer.
  const G = 0.005;
  function buildGrid(track, lineW) {
    track._grids = track._grids || {};
    if (track._grids[lineW]) return track._grids[lineW];
    const M = lineW / 2 + 0.001;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of track.strokes) for (let i = 0; i < s.n; i++) {
      minX = Math.min(minX, s.x[i]); maxX = Math.max(maxX, s.x[i]);
      minY = Math.min(minY, s.y[i]); maxY = Math.max(maxY, s.y[i]);
    }
    const ox = Math.floor((minX - M) / G) - 1, oy = Math.floor((minY - M) / G) - 1;
    const nx = Math.floor((maxX + M) / G) - ox + 2, ny = Math.floor((maxY + M) / G) - oy + 2;
    const segs = [];
    track.strokes.forEach((s) => {
      for (let i = 0; i + 1 < s.n; i++) segs.push([s.x[i], s.y[i], s.x[i + 1], s.y[i + 1], i > 0 ? 1 : 0]);
    });
    const SA = new Float64Array(segs.length * 4), SI = new Uint8Array(segs.length);
    const lists = new Array(nx * ny);
    segs.forEach((g, k) => {
      SA[4 * k] = g[0]; SA[4 * k + 1] = g[1]; SA[4 * k + 2] = g[2]; SA[4 * k + 3] = g[3]; SI[k] = g[4];
      const x0 = Math.floor((Math.min(g[0], g[2]) - M) / G) - ox - 1, x1 = Math.floor((Math.max(g[0], g[2]) + M) / G) - ox + 1;
      const y0 = Math.floor((Math.min(g[1], g[3]) - M) / G) - oy - 1, y1 = Math.floor((Math.max(g[1], g[3]) + M) / G) - oy + 1;
      for (let cy = Math.max(0, y0); cy <= Math.min(ny - 1, y1); cy++)
        for (let cx = Math.max(0, x0); cx <= Math.min(nx - 1, x1); cx++) {
          const key = cy * nx + cx;
          (lists[key] || (lists[key] = [])).push(k);
        }
    });
    const near = lists.map((l) => (l ? Int32Array.from(l) : null));
    track._grids[lineW] = { ox, oy, nx, ny, near, SA, SI };
    return track._grids[lineW];
  }

  function simulate(track, P, opts) {
    opts = opts || {};
    const record = opts.record !== false;
    const wantTrace = !!opts.trace;
    const sin = opts.trig === 'native' ? Math.sin : LM.sin;
    const cos = opts.trig === 'native' ? Math.cos : LM.cos;
    const hypot = LM.hypot;
    const grid = buildGrid(track, P.lineW);
    const CX = track.centre.x, CY = track.centre.y, CS = track.centre.s, NC = CX.length;

    // ---- parameters
    const LINE_W = P.lineW, SPACING = P.spacing;
    const AHEAD = P.ahead !== undefined ? P.ahead : 0.07;
    const WHEEL_TRACK = P.wheelTrack !== undefined ? P.wheelTrack : 0.13;
    const VMAX = P.vmax !== undefined ? P.vmax : 0.50;
    const DEAD = P.dead !== undefined ? P.dead : 60;
    const TAU = P.tau !== undefined ? P.tau : 0.08;
    const TAU_BRAKE = 0.02, TAU_COAST = 0.06;
    const STEP_US = 500;
    const PRESS_AT = 0.30, PRESS_LEN = 0.15;
    const VBAT = 7.6;
    const HIGH = 1, LOW = 0, A1 = 15, A3 = 17, A5 = 19;

    // ---- state
    let T_US = 0;
    const pinState = new Int32Array(20), pwmDuty = new Int32Array(20);
    let rx = 0, ry = 0, th = 0, vl = 0, vr = 0;
    let nextTrace = 0;
    let progress = 0, maxDev = 0, devSum = 0, devN = 0;
    let finished = 0;
    let failWhy = '';
    let finishTime = 0;
    const traceLines = wantTrace ? ['t,x,y,th,L,R,action,vl,vr,running'] : null;

    // cos(th) / sin(th) cache: same value for the same th, so this cannot change any result
    let cTh = NaN, cC = 1, cS = 0;
    function trig() {
      if (th !== cTh || (th === 0 && 1 / th !== 1 / cTh)) { cTh = th; cC = cos(th); cS = sin(th); }
    }

    function onLine(px, py) {
      const hw = LINE_W / 2, hw2 = hw * hw;
      const gx = Math.floor(px / G) - grid.ox, gy = Math.floor(py / G) - grid.oy;
      if (gx < 0 || gy < 0 || gx >= grid.nx || gy >= grid.ny) return false;   // far from every tape segment
      const list = grid.near[gy * grid.nx + gx];
      if (!list) return false;
      const SA = grid.SA, SI = grid.SI;
      for (let j = 0; j < list.length; j++) {
        const k = list[j] * 4;
        const ax = SA[k], ay = SA[k + 1], bx = SA[k + 2], by = SA[k + 3];
        if (Math.abs(px - ax) > 0.03 || Math.abs(py - ay) > 0.03) continue;
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        const t = ((px - ax) * dx + (py - ay) * dy) / L2;
        if (t >= 0 && t <= 1) {
          const cx = ax + t * dx - px, cy = ay + t * dy - py;
          if (cx * cx + cy * cy <= hw2) return true;
        }
        if (SI[list[j]]) {   // round join at interior points (butt ends at the ends of each piece)
          const ex = ax - px, ey = ay - py;
          if (ex * ex + ey * ey <= hw2) return true;
        }
      }
      return false;
    }

    let spx = 0, spy = 0;
    function sensorPos(side) {   // side +1 = left, -1 = right
      trig();
      const c = cC, s = cS;
      spx = rx + AHEAD * c - side * (SPACING / 2) * s;
      spy = ry + AHEAD * s + side * (SPACING / 2) * c;
    }

    // ---- Arduino API
    const serialOut = [], serialT = [];
    function sOut(str) { if (serialOut.length < 2000) { serialOut.push(str); serialT.push(T_US / 1e6); } }
    const Serial = {
      begin() {},
      print(v, digits) {
        if (typeof v === 'number' && digits !== undefined) sOut(LM.cfmt(v, digits));
        else if (typeof v === 'number' && !Number.isInteger(v)) sOut(LM.cfmt(v, 2));
        else sOut(String(v));
      },
      println(v, digits) { if (v !== undefined) this.print(v, digits); sOut('\n'); },
    };
    function pinMode() {}
    function digitalWrite(p, v) { pinState[p] = v; if (p === 3 || p === 11) pwmDuty[p] = v ? 255 : 0; }
    function analogWrite(p, v) { pwmDuty[p] = v; }
    function millis() { return Math.floor(T_US / 1000.0); }
    function analogRead(p) { return p === A5 ? Math.trunc(VBAT / 3.2 * 1023.0 / 5.0) : 0; }
    function digitalRead(p) {
      if (p === A1) { sensorPos(+1); return onLine(spx, spy) ? HIGH : LOW; }
      if (p === A3) { sensorPos(-1); return onLine(spx, spy) ? HIGH : LOW; }
      if (p === 12) { const t = T_US / 1e6; return (t >= PRESS_AT && t < PRESS_AT + PRESS_LEN) ? LOW : HIGH; }
      return LOW;
    }

    let tauOut = 0;
    function wheelTarget(en, a, b) {
      const duty = pwmDuty[en];
      if (pinState[a] !== pinState[b]) {
        const eff = duty <= DEAD ? 0 : (duty - DEAD) / (255 - DEAD);
        tauOut = TAU;
        return (pinState[a] ? 1 : -1) * VMAX * eff;
      }
      tauOut = duty > 0 ? TAU_BRAKE : TAU_COAST;
      return 0;
    }

    // ---- recording (1 ms frames) - not part of the model
    let cap = record ? 20000 : 0, nF = 0;
    let R_ = null;
    function alloc(n) {
      const o = {
        x: new Float64Array(n), y: new Float64Array(n), th: new Float64Array(n),
        vl: new Float32Array(n), vr: new Float32Array(n), prog: new Float32Array(n), dev: new Float32Array(n),
        pwmL: new Int16Array(n), pwmR: new Int16Array(n), flags: new Uint8Array(n),
        action: new Uint8Array(n), mem: new Uint8Array(n), branch: new Uint8Array(n), phase: new Uint8Array(n),
        junc: new Uint16Array(n), tia: new Uint32Array(n),
      };
      if (R_) for (const k in o) o[k].set(R_[k].subarray(0, nF));
      R_ = o; cap = n;
    }
    if (record) alloc(cap);
    const PHASES = ['WAITING', 'START_DELAY', 'KICK', 'RUNNING', 'STOPPING', 'STOPPED', 'JUNCTION_WAIT'];
    const probe = { phase: 'WAITING', branch: 0, left: false, right: false, stopReason: '' };
    const events = [];
    let lastDev = 0, lastBestI = 0, prevSharp = false, prevAction = -1, prevJunc = 0, prevPhase = '';

    function pwmSigned(en, a, b) {
      if (pinState[a] !== pinState[b]) return pinState[a] ? pwmDuty[en] : -pwmDuty[en];
      return 0;
    }

    function recordFrame() {
      if (nF >= cap) alloc(cap * 2);
      const i = nF++;
      trig();
      R_.x[i] = rx; R_.y[i] = ry; R_.th[i] = th; R_.vl[i] = vl; R_.vr[i] = vr;
      R_.prog[i] = progress;
      // signed deviation (+ = sensor midpoint left of the line), display only
      const bi = lastBestI, bj = bi + 1 < NC ? bi + 1 : bi, bk = bi + 1 < NC ? bi : bi - 1;
      const tx = CX[bj] - CX[bk], ty = CY[bj] - CY[bk];
      const mx = rx + AHEAD * cC, my = ry + AHEAD * cS;
      const cr = tx * (my - CY[bi]) - ty * (mx - CX[bi]);
      R_.dev[i] = cr >= 0 ? lastDev : -lastDev;
      R_.pwmL[i] = pwmSigned(3, 4, 5); R_.pwmR[i] = pwmSigned(11, 6, 7);
      sensorPos(+1); const gl = onLine(spx, spy);
      sensorPos(-1); const gr = onLine(spx, spy);
      const brakeL = pinState[4] === pinState[5] && pwmDuty[3] > 0, brakeR = pinState[6] === pinState[7] && pwmDuty[11] > 0;
      R_.flags[i] = (gl ? 1 : 0) | (gr ? 2 : 0) | (probe.left ? 4 : 0) | (probe.right ? 8 : 0) |
        (sk.vars.running ? 16 : 0) | (brakeL ? 32 : 0) | (brakeR ? 64 : 0);
      const act = sk.vars.action;
      R_.action[i] = act; R_.mem[i] = sk.vars.lineMemory; R_.branch[i] = sk.vars.running ? probe.branch : 0;
      R_.phase[i] = PHASES.indexOf(probe.phase);
      R_.junc[i] = sk.vars.junctionCount;
      const tia = LF3.usub(millis(), sk.vars.actionSince);
      R_.tia[i] = Math.min(tia, 4294967295);
      // events (for the markers on the track)
      if (sk.vars.running) {
        const sharp = (act === 1 || act === 2) && tia >= sk.constants.SHARP_AFTER_MS;
        if (sharp && !(prevSharp && act === prevAction)) events.push({ i, type: 'sharp', x: mx, y: my, dir: act === 1 ? 'left' : 'right' });
        if ((act === 4 || act === 5) && act !== prevAction) events.push({ i, type: 'search', x: mx, y: my, dir: act === 4 ? 'left' : 'right' });
        if (sk.vars.junctionCount > prevJunc) events.push({ i, type: 'crossing', x: mx, y: my, n: sk.vars.junctionCount });
        prevSharp = sharp; prevAction = act; prevJunc = sk.vars.junctionCount;
      }
      if (probe.phase === 'STOPPING' && prevPhase !== 'STOPPING') events.push({ i, type: 'stop', x: mx, y: my, reason: probe.stopReason });
      prevPhase = probe.phase;
    }

    function checkProgress() {
      // nearest centre-line point to the sensor midpoint, searched near the current progress
      trig();
      const mx = rx + AHEAD * cC, my = ry + AHEAD * cS;
      let best = 1e9, bestS = progress, bestI = lastBestI;
      const lo = progress - 0.25, hi = progress + 0.25;
      // centreS is sorted, so "skip if s < lo || s > hi" keeps one contiguous block: find its start
      let a = 0, b = NC;
      while (a < b) { const m = (a + b) >> 1; if (CS[m] < lo) a = m + 1; else b = m; }
      let e = a;
      while (e < NC && !(CS[e] > hi)) e++;
      // Speed-up that cannot change the answer: U = distance to one point of the block is an upper bound
      // of the minimum.  hypot(dx, dy) >= max(|dx|, |dy|), so a point with max(|dx|,|dy|) > U*(1+1e-9) is
      // farther than U and can never be the first nearest point; all other points are tested in the same
      // order with the same strict "<" as the C++ loop, so best / bestS are exactly the C++ values.
      if (e > a) {
        const g = (lastBestI >= a && lastBestI < e) ? lastBestI : ((a + e) >> 1);
        const U = hypot(CX[g] - mx, CY[g] - my) * (1 + 1e-9);
        for (let i = a; i < e; i++) {
          const dx = CX[i] - mx, dy = CY[i] - my;
          if (dx > U || dx < -U || dy > U || dy < -U) continue;
          const d = hypot(dx, dy);
          if (d < best) { best = d; bestS = CS[i]; bestI = i; }
        }
      }
      if (bestS > progress) progress = bestS;
      if (sk.vars.running) {
        if (best > maxDev) maxDev = best;
        devSum += best; devN++;
      }
      lastDev = best; lastBestI = bestI;
      const total = CS[NC - 1];
      if (progress >= total - 0.01) { finished = 1; finishTime = (T_US / 1e6) - sk.vars.runStartedAt / 1000.0; }
      else if (best > 0.10) { finished = -1; failWhy = 'left the track'; }
      else if (T_US > 60e6) { finished = -1; failWhy = 'timeout'; }
      else if (T_US > 2e6 && !sk.vars.running) { finished = -1; failWhy = 'program stopped'; }
    }

    function advance(us) {
      for (let done = 0; done < us && !finished; done += STEP_US) {
        const dt = STEP_US / 1e6;
        const gl = wheelTarget(3, 4, 5), tl = tauOut;
        const gr = wheelTarget(11, 6, 7), tr = tauOut;
        vl += (gl - vl) * dt / tl;
        vr += (gr - vr) * dt / tr;
        const v = (vl + vr) / 2, w = (vr - vl) / WHEEL_TRACK;
        th += w * dt;
        trig();
        rx += v * cC * dt;
        ry += v * cS * dt;
        T_US += STEP_US;
        if (T_US >= nextTrace) {
          nextTrace += 5000;
          if (wantTrace) {
            sensorPos(+1); const L = onLine(spx, spy) ? 1 : 0;
            sensorPos(-1); const Rr = onLine(spx, spy) ? 1 : 0;
            const f = LM.cfmt;
            traceLines.push(f(T_US / 1e6, 4) + ',' + f(rx, 5) + ',' + f(ry, 5) + ',' + f(th, 5) + ',' + L + ',' + Rr + ',' +
              sk.vars.action + ',' + f(vl, 3) + ',' + f(vr, 3) + ',' + (sk.vars.running ? 1 : 0));
          }
        }
        if (T_US % 1000.0 < STEP_US / 2) {
          checkProgress();
          if (record) recordFrame();
        }
      }
    }
    function delay(ms) { advance(ms * 1000.0); }

    const sk = LF3.createLF3({ pinMode, digitalWrite, digitalRead, analogRead, analogWrite, millis, delay, Serial }, P.settings || {}, probe);

    // ---- main()
    // start pose: sensors straddling the line, at the start of the track
    th = Math.atan2(CY[1] - CY[0], CX[1] - CX[0]);
    trig();
    rx = CX[0] - AHEAD * cC; ry = CY[0] - AHEAD * cS;
    if (record) { checkProgressDisplayOnly(); recordFrame(); }
    sk.setup();
    while (!finished) { sk.loop(); advance(STEP_US); }

    function checkProgressDisplayOnly() { // frame 0: deviation for display, without touching the model state
      const mx = rx + AHEAD * cC, my = ry + AHEAD * cS; let best = 1e9;
      for (let i = 0; i < Math.min(NC, 200); i++) { const d = hypot(CX[i] - mx, CY[i] - my); if (d < best) { best = d; lastBestI = i; } }
      lastDev = best;
    }

    const total = CS[NC - 1];
    const meanDev = devN ? 1000 * devSum / devN : 0.0;
    const f = LM.cfmt;
    const resultLine = 'RESULT ' + (finished > 0 ? 'FINISHED' : 'FAILED') + ' lap=' + f(finished > 0 ? finishTime : 0.0, 2) + 's mean_dev=' +
      f(meanDev, 1) + 'mm max_dev=' + f(1000 * maxDev, 1) + 'mm junctions_counted=' + sk.vars.junctionCount + ' progress=' +
      f(progress, 2) + '/' + f(total, 2) + 'm ' + (finished > 0 ? '' : failWhy);

    const run = {
      ok: finished > 0, finished, failWhy, stopReason: probe.stopReason || '',
      lap: finished > 0 ? finishTime : 0, meanDev, maxDev: 1000 * maxDev, junctions: sk.vars.junctionCount,
      progress, total, resultLine, endT: T_US / 1e6, runStartedAtMs: sk.vars.runStartedAt,
      serial: serialOut.join(''), serialParts: serialOut, serialTimes: serialT, events, nFrames: nF, constants: sk.constants,
    };
    if (record) { for (const k in R_) R_[k] = R_[k].subarray(0, nF); run.frames = R_; }
    if (wantTrace) run.trace = traceLines.join('\n') + '\n';
    return run;
  }

  const api = { simulate, buildGrid, PHASES: ['WAITING', 'START_DELAY', 'KICK', 'RUNNING', 'STOPPING', 'STOPPED', 'JUNCTION_WAIT'] };
  root.LFWorld = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
