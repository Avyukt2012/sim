#!/usr/bin/env node
/*
 * validate.js - proves the JavaScript simulation (src/core, the code inside lf_simulator.html) computes the
 * same runs as the C++ reference simulator (reference/sim/sim.cpp compiled with the real LF3 sketch).
 *
 *   node test/validate.js            full check (about 1-2 minutes)
 *   node test/validate.js --quick    skip the 7 x 72 robustness sets
 *
 * Needs: python3, g++ (C++17), node >= 16.  Writes test/validation_report.md and test/validation_results.json.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const ROOT = path.resolve(__dirname, '..');
const CORE = path.join(ROOT, 'src', 'core');
const REF = path.join(ROOT, 'reference', 'sim');
const OUT = path.join(REF, 'out');
const TOUT = path.join(__dirname, 'out');

// ------------------------------------------------------------------ worker: run JS simulations
if (!isMainThread) {
  const T = require(path.join(CORE, 'track.js'));
  const W = require(path.join(CORE, 'world.js'));
  const track = T.writeTrack();
  parentPort.on('message', (job) => {
    const r = W.simulate(track, job.params, { record: false, trig: job.trig });
    parentPort.postMessage({ id: job.id, line: r.resultLine, ok: r.ok, lap: r.lap });
  });
  return;
}

const QUICK = process.argv.includes('--quick');
const T = require(path.join(CORE, 'track.js'));
const W = require(path.join(CORE, 'world.js'));
const PR = require(path.join(CORE, 'params.js'));
const LM = require(path.join(CORE, 'mathlib.js'));
fs.mkdirSync(TOUT, { recursive: true });

const report = [];
const results = { generated: new Date().toISOString(), checks: [] };
let allOk = true;
function check(name, ok, detail) {
  results.checks.push({ name, ok, detail });
  if (!ok) allOk = false;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  -  ' + detail : ''));
}
function sh(cmd, args, opts) {
  const r = cp.spawnSync(cmd, args, Object.assign({ encoding: 'utf8', maxBuffer: 1 << 28 }, opts));
  if (r.error) throw r.error;
  return r;
}
// run many commands in parallel
function pool(jobs, n, fn) {
  return new Promise((resolve) => {
    const res = new Array(jobs.length); let next = 0, done = 0;
    if (!jobs.length) return resolve(res);
    const start = () => {
      if (next >= jobs.length) return;
      const i = next++;
      fn(jobs[i]).then((v) => { res[i] = v; done++; if (done === jobs.length) resolve(res); else start(); });
    };
    for (let k = 0; k < Math.min(n, jobs.length); k++) start();
  });
}
function runCpp(exe, w, sp, vmax, env, tracePath) {
  return new Promise((resolve) => {
    cp.execFile(exe, [path.join(OUT, 'strokes.csv'), path.join(OUT, 'centre.csv'), tracePath || '/dev/null', String(w), String(sp), String(vmax), 'q'],
      { env: Object.assign({}, process.env, env || {}) }, (err, stdout) => {
        const line = stdout.split('\n').find((l) => l.startsWith('RESULT')) || stdout;
        resolve({ ok: !err, line: line.replace(/\s+$/, ''), lap: parseFloat((line.match(/lap=([\d.]+)/) || [])[1]) });
      });
  });
}
// JS worker pool
function makeJsPool(n) {
  const workers = []; const pending = new Map(); let id = 0; let rr = 0;
  for (let i = 0; i < n; i++) {
    const w = new Worker(__filename);
    w.on('message', (m) => { pending.get(m.id)(m); pending.delete(m.id); });
    workers.push(w);
  }
  return {
    run(params, trig) { return new Promise((res) => { const j = { id: id++, params, trig }; pending.set(j.id, res); workers[rr++ % n].postMessage(j); }); },
    close() { workers.forEach((w) => w.terminate()); },
  };
}
function buildVariant(over, tag) {
  // use the reference's own variants.build() (patched copy of the sketch, compiled with g++)
  const code = 'import sys, json; sys.path.insert(0, %s); import variants as V; print(V.build(json.loads(%s), %s))';
  const r = sh('python3', ['-c', code.replace('%s', JSON.stringify(REF)).replace('%s', JSON.stringify(JSON.stringify(over))).replace('%s', JSON.stringify(tag))], { cwd: REF });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim().split('\n').pop();
}
const trimLine = (l) => l.replace(/\s+$/, '');

(async function main() {
  const t0 = Date.now();
  const ncpu = Math.max(2, os.cpus().length);

  // ---------------------------------------------------------------- 1. reference run_sim.py
  console.log('Running reference/sim/run_sim.py ...');
  const rs = sh('python3', ['run_sim.py'], { cwd: REF });
  if (rs.status !== 0 && !/SOME FAILED/.test(rs.stdout)) throw new Error('run_sim.py failed: ' + rs.stderr);
  fs.writeFileSync(path.join(TOUT, 'run_sim_output.txt'), rs.stdout);
  const cppRef = fs.readFileSync(path.join(OUT, 'trace.csv'), 'utf8');
  const exe = path.join(OUT, 'sim');

  // ---------------------------------------------------------------- 2. track
  const track = T.writeTrack();
  const trackSame = fs.readFileSync(path.join(OUT, 'centre.csv'), 'utf8') === track.csv.centre &&
                    fs.readFileSync(path.join(OUT, 'strokes.csv'), 'utf8') === track.csv.strokes;
  check('Track: JS centre.csv and strokes.csv are byte-identical to run_sim.py output', trackSame,
    'length ' + LM.cfmt(track.length, 2) + ' m, ' + track.centre.x.length + ' centre points, tape pieces ' + track.strokes.map((s) => s.n).join('/'));
  check('Track length prints as 3.53 m', LM.cfmt(track.length, 2) === '3.53');

  // ---------------------------------------------------------------- 3. RPM formula
  check('rpmToVmax(200 RPM, 65 mm) === 0.5 and rpmToVmax(300, 65) === 0.75', PR.rpmToVmax(200, 65) === 0.5 && PR.rpmToVmax(300, 65) === 0.75);

  // ---------------------------------------------------------------- 4. the 13 run_sim.py cases
  const cases = [];
  for (const w of [0.020, 0.025, 0.030]) for (const sp of [0.035, 0.040]) for (const vmax of [0.50, 0.75]) {
    if (sp < w + 0.005) continue;
    cases.push({ w, sp, vmax });
  }
  cases.push({ w: 0.025, sp: 0.038, vmax: 0.50, ref: true });
  const rows13 = [];
  let same13 = 0, traceSame13 = 0;
  for (const c of cases) {
    const tp = path.join(TOUT, 'cpp_trace_tmp.csv');
    const cpp = await runCpp(exe, c.w, c.sp, c.vmax, {}, tp);
    const cppTrace = fs.readFileSync(tp, 'utf8');
    const js = W.simulate(track, { lineW: c.w, spacing: c.sp, vmax: c.vmax }, { record: false, trace: true });
    const same = trimLine(js.resultLine) === trimLine(cpp.line);
    const tsame = js.trace === cppTrace;
    same13 += same; traceSame13 += tsame;
    rows13.push({ case: (c.ref ? 'REFERENCE ' : '') + 'line ' + (c.w * 100).toFixed(1) + ' cm, sensors ' + (c.sp * 100).toFixed(1) + ' cm, ' + c.vmax.toFixed(2) + ' m/s',
      cpp: trimLine(cpp.line).replace('RESULT ', ''), js: trimLine(js.resultLine).replace('RESULT ', ''), same, traceSame: tsame,
      traceLines: cppTrace.split('\n').length - 2 });
  }
  check('13 run_sim.py cases: JS RESULT line identical to C++ (lap, mean/max dev, junctions, progress)', same13 === cases.length, same13 + '/' + cases.length);
  check('13 run_sim.py cases: JS trace (every 5 ms, x/y/heading/sensors/action/wheel speeds) identical text to C++ trace', traceSame13 === cases.length, traceSame13 + '/' + cases.length);
  const refJs = W.simulate(track, { lineW: 0.025, spacing: 0.038, vmax: 0.5 }, { record: false, trace: true });
  check('Reference run trace identical to reference/sim/out/trace.csv written by run_sim.py', refJs.trace === cppRef, (cppRef.split('\n').length - 2) + ' lines');

  // ---------------------------------------------------------------- 5. full-precision state comparison (reference run)
  // A copy of sim.cpp whose trace prints exact hex floats (%a) instead of %.5f - the model code is untouched.
  const src = fs.readFileSync(path.join(REF, 'sim.cpp'), 'utf8');
  const fmtOld = '"%.4f,%.5f,%.5f,%.5f,%d,%d,%d,%.3f,%.3f,%d\\n"';
  if (!src.includes(fmtOld)) throw new Error('trace format not found in sim.cpp');
  const hexSrc = src.replace(fmtOld, '"%.4f,%a,%a,%a,%d,%d,%d,%a,%a,%d\\n"').replace('#define SKETCH "../code/', '#define SKETCH "' + path.join(ROOT, 'reference', 'code') + '/');
  fs.writeFileSync(path.join(TOUT, 'sim_hex.cpp'), hexSrc);
  const hexExe = path.join(TOUT, 'sim_hex');
  const cc = sh('g++', ['-O2', '-std=c++17', '-w', '-I', REF, '-o', hexExe, path.join(TOUT, 'sim_hex.cpp')]);
  if (cc.status !== 0) throw new Error(cc.stderr);
  function parseHex(h) {
    const m = h.match(/^(-?)0x([01])(?:\.([0-9a-f]+))?p([+-]\d+)$/);
    if (!m) return parseFloat(h);
    const frac = (m[3] || '').padEnd(13, '0');
    const mant = Number(BigInt('0x' + m[2] + frac));  // exact (<= 2^53)
    const v = mant * Math.pow(2, parseInt(m[4], 10) - 52);
    return m[1] ? -v : v;
  }
  async function fullPrecision(trig) {
    const hp = path.join(TOUT, 'trace_hex.csv');
    await runCpp(hexExe, 0.025, 0.038, 0.5, {}, hp);
    const C = fs.readFileSync(hp, 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
    // JS: same sampling (T_US >= nextTrace), full doubles
    const js = W.simulate(track, { lineW: 0.025, spacing: 0.038, vmax: 0.5 }, { record: true, trig });
    const F = js.frames;
    let bitSame = 0, maxPos = 0, maxTh = 0, n = 0, firstDiff = null;
    for (const row of C) {
      const t = parseFloat(row[0]);
      const ms = Math.round(t * 1000);
      if (Math.abs(ms - t * 1000) > 0.01) continue;   // only whole-ms samples (all of them except t=0.0005)
      if (ms >= F.x.length) continue;
      const cx = parseHex(row[1]), cy = parseHex(row[2]), cth = parseHex(row[3]);
      const dx = Math.abs(cx - F.x[ms]), dy = Math.abs(cy - F.y[ms]), dth = Math.abs(cth - F.th[ms]);
      n++;
      if (dx === 0 && dy === 0 && dth === 0) bitSame++; else if (!firstDiff) firstDiff = { t, dx, dy, dth };
      maxPos = Math.max(maxPos, Math.hypot(dx, dy)); maxTh = Math.max(maxTh, dth);
    }
    return { n, bitSame, maxPos, maxTh, firstDiff };
  }
  const fpCR = await fullPrecision('cr');
  const fpNat = await fullPrecision('native');
  check('Reference run, full double precision every 5 ms (correctly rounded sin/cos): max position difference < 1 micrometre',
    fpCR.maxPos < 1e-6, `${fpCR.bitSame}/${fpCR.n} samples bit-identical, max |dpos| = ${fpCR.maxPos.toExponential(2)} m, max |dheading| = ${fpCR.maxTh.toExponential(2)} rad` +
    (fpCR.firstDiff ? `, first last-bit difference at t = ${fpCR.firstDiff.t} s` : ''));
  results.fullPrecision = { correctlyRounded: fpCR, nativeMathSinCos: fpNat };

  // ---------------------------------------------------------------- 6. the 7 robustness sets (72 conditions each)
  const conds = PR.robustConditions();
  const sets = [
    { key: 'default_on_200', label: 'Default, line memory on', rpm: 200, vmax: 0.50, over: { SHARP_AFTER_MS: 30, LOST_AFTER_MS: 250 }, user: '72/72' },
    { key: 'default_on_300', label: 'Default, line memory on', rpm: 300, vmax: 0.75, over: { SHARP_AFTER_MS: 30, LOST_AFTER_MS: 250 }, user: '56/72' },
    { key: 'default_off_200', label: 'Default, line memory off', rpm: 200, vmax: 0.50, over: { SHARP_AFTER_MS: 30, LOST_AFTER_MS: 99999 }, user: '64/72' },
    { key: 'default_off_300', label: 'Default, line memory off', rpm: 300, vmax: 0.75, over: { SHARP_AFTER_MS: 30, LOST_AFTER_MS: 99999 }, user: '49/72' },
    { key: 'slower_300', label: 'Slower (125/110/145/-125)', rpm: 300, vmax: 0.75, over: { SHARP_AFTER_MS: 30, LOST_AFTER_MS: 250, SPEED_STRAIGHT: 125, SPEED_CROSSING: 110, TURN_OUTER: 145, TURN_INNER_SHARP: -125 }, user: '67/72' },
    { key: 'faster_200', label: 'Faster (180/150/200/-170)', rpm: 200, vmax: 0.50, over: { SHARP_AFTER_MS: 30, LOST_AFTER_MS: 250, SPEED_STRAIGHT: 180, SPEED_CROSSING: 150, TURN_OUTER: 200, TURN_INNER_SHARP: -170 }, user: '64/72, lap 12.64 s' },
    { key: 'muchfaster_200', label: 'Much faster (210/170/230/-190)', rpm: 200, vmax: 0.50, over: { SHARP_AFTER_MS: 30, LOST_AFTER_MS: 250, SPEED_STRAIGHT: 210, SPEED_CROSSING: 170, TURN_OUTER: 230, TURN_INNER_SHARP: -190 }, user: '50/72, lap 10.48 s' },
  ];
  const setRows = [];
  if (!QUICK) {
    const jsPool = makeJsPool(ncpu);
    for (const [si, S] of sets.entries()) {
      process.stdout.write(`Robustness set ${si + 1}/7: ${S.label} @ ${S.rpm} RPM ... `);
      const cexe = buildVariant(S.over, 'val' + si);
      const cpp = await pool(conds, ncpu, (c) => runCpp(cexe, c.lineW, c.spacing, S.vmax,
        { AHEAD: String(c.ahead), TAU: String(c.tau), DEAD: String(c.dead), TRACKW: String(c.wheelTrack) }));
      const settings = Object.assign({}, S.over);
      const js = await Promise.all(conds.map((c) => jsPool.run({ lineW: c.lineW, spacing: c.spacing, vmax: S.vmax, ahead: c.ahead, tau: c.tau, dead: c.dead, wheelTrack: c.wheelTrack, settings }, 'cr')));
      // lap on the reference robot (default build, 2.5 cm line, 4.0 cm spacing) as robust2.py prints it
      const cppLap = await runCpp(cexe, 0.025, 0.04, S.vmax, {});
      const jsLap = W.simulate(track, { lineW: 0.025, spacing: 0.04, vmax: S.vmax, settings }, { record: false });
      const cppPass = cpp.filter((r) => r.ok).length, jsPass = js.filter((r) => r.ok).length;
      let lineSame = 0; const diffs = [];
      conds.forEach((c, i) => {
        if (trimLine(cpp[i].line) === trimLine(js[i].line)) lineSame++;
        else diffs.push({ cond: c, cpp: cpp[i].line, js: js[i].line });
      });
      const row = { key: S.key, label: S.label, rpm: S.rpm, vmax: S.vmax, settings: S.over, user: S.user, cppPass, jsPass, lineSame, n: conds.length,
        cppLap: trimLine(cppLap.line).match(/lap=([\d.]+)/)[1], jsLap: LM.cfmt(jsLap.lap, 2), diffs,
        perCondition: conds.map((c, i) => ({ ok: cpp[i].ok, lap: cpp[i].ok ? cpp[i].lap : null })) };
      setRows.push(row);
      console.log(`C++ ${cppPass}/72  JS ${jsPass}/72  identical result lines ${lineSame}/72`);
      check(`Robustness: ${S.label} @ ${S.rpm} RPM - JS pass count equals C++ and every RESULT line is identical`,
        cppPass === jsPass && lineSame === conds.length, `C++ ${cppPass}/72, JS ${jsPass}/72, identical lines ${lineSame}/72`);
    }
    jsPool.close();
  }
  results.robustness = setRows;
  results.run13 = rows13;

  // ---------------------------------------------------------------- 7. one source of truth
  const html = path.join(ROOT, 'lf_simulator.html');
  if (fs.existsSync(html)) {
    const page = fs.readFileSync(html, 'utf8');
    const files = ['mathlib.js', 'track.js', 'lf3_sketch.js', 'world.js', 'params.js'];
    const missing = files.filter((f) => !page.includes(fs.readFileSync(path.join(CORE, f), 'utf8')));
    check('lf_simulator.html contains the exact src/core files that were tested', missing.length === 0, missing.length ? 'stale: ' + missing.join(', ') + ' (run node build.js)' : files.join(', '));
  } else {
    check('lf_simulator.html exists (run node build.js)', false);
  }

  // ---------------------------------------------------------------- report
  const L = [];
  L.push('# Validation report: JavaScript simulation vs C++ reference', '');
  L.push(`Generated ${results.generated} by \`node test/validate.js\` (g++: ${sh('g++', ['--version']).stdout.split('\n')[0]}, node ${process.version}).`, '');
  L.push('## Summary', '');
  for (const c of results.checks) L.push(`- ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
  L.push('', '## The 13 run_sim.py cases', '', '| Case | C++ (sim.cpp) | JavaScript | Same | Trace same |', '|---|---|---|---|---|');
  for (const r of rows13) L.push(`| ${r.case} | ${r.cpp} | ${r.js} | ${r.same ? 'yes' : '**NO**'} | ${r.traceSame ? 'yes (' + r.traceLines + ' lines)' : '**NO**'} |`);
  if (setRows.length) {
    L.push('', '## Robustness sets (72 conditions each)', '', '| Settings | RPM | Your results (g++ 13) | C++ here | JavaScript | Identical RESULT lines | Lap on reference robot C++ / JS |', '|---|---|---|---|---|---|---|');
    for (const r of setRows) L.push(`| ${r.label} | ${r.rpm} (${r.vmax.toFixed(2)} m/s) | ${r.user} | ${r.cppPass}/72 | ${r.jsPass}/72 | ${r.lineSame}/72 | ${r.cppLap} s / ${r.jsLap} s |`);
  }
  L.push('', '## Full double precision (reference run, x / y / heading every 5 ms)', '');
  L.push('| sin/cos used by the JS | samples | bit-identical to C++ | max position difference | max heading difference |', '|---|---|---|---|---|');
  L.push(`| correctly rounded (used by the page) | ${fpCR.n} | ${fpCR.bitSame} | ${fpCR.maxPos.toExponential(2)} m | ${fpCR.maxTh.toExponential(2)} rad |`);
  L.push(`| Math.sin / Math.cos (V8) | ${fpNat.n} | ${fpNat.bitSame} | ${fpNat.maxPos.toExponential(2)} m | ${fpNat.maxTh.toExponential(2)} rad |`);
  L.push('', (fpCR.bitSame === fpCR.n && fpNat.bitSame === fpNat.n)
    ? 'Every sample is bit-for-bit identical: the JavaScript port computes exactly the same doubles as the C++ program. ' +
      'glibc sin()/cos() and V8 Math.sin()/Math.cos() can differ in the last bit, but here those differences are multiplied by ' +
      'v*dt (about 0.00025 m) and vanish below the rounding step of x and y. The page uses correctly rounded sin/cos ' +
      '(src/core/mathlib.js), which agree with glibc for over 99.9 % of inputs, as an extra safety margin.'
    : 'Differences come only from the last bit of sin()/cos() (glibc vs JavaScript); see the maximum differences above.', '');
  L.push(`Total time ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
  const dest = QUICK ? TOUT : __dirname;   // --quick never overwrites the full report the page is built from
  fs.writeFileSync(path.join(dest, 'validation_report.md'), L.join('\n') + '\n');
  fs.writeFileSync(path.join(dest, 'validation_results.json'), JSON.stringify(results, null, 1));
  console.log('\n' + (allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED') + `  (${((Date.now() - t0) / 1000).toFixed(0)} s)  -> ${path.relative(ROOT, dest)}/validation_report.md`);
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
