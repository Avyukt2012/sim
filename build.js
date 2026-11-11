#!/usr/bin/env node
/*
 * build.js - generates lf_simulator.html (one self-contained file) from:
 *   src/core/*.js   the simulation (the SAME files test/validate.js checks against the C++ reference)
 *   src/ui/*        page template, style and app code
 *   reference/code/LF3_Line_Follower/LF3_Line_Follower.ino   (followLine() source for the "Show code" view)
 *   test/validation_results.json   (C++ reference results, shown next to "Test all 72 combinations")
 *
 *   node build.js                         -> lf_simulator.html
 *   node build.js --artifact <file>       -> also a copy without <html>/<head>/<body> wrappers for hosting
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');

const CORE_FILES = ['mathlib.js', 'params.js', 'track.js', 'lf3_sketch.js', 'world.js'];
const core = CORE_FILES.map((f) => R('src', 'core', f)).join('\n');
const app = R('src', 'ui', 'app.js');
const style = R('src', 'ui', 'style.css');
let tpl = R('src', 'ui', 'template.html');

// followLine() exactly as it is in the sketch
const ino = R('reference', 'code', 'LF3_Line_Follower', 'LF3_Line_Follower.ino');
const start = ino.indexOf('// The heart of the program');
const end = ino.indexOf('// ---------------------------------------------------------------------\n// 7. SETUP AND LOOP');
if (start < 0 || end < 0) throw new Error('followLine() not found in the sketch');
const followLine = ino.slice(start, end).replace(/\s+$/, '');

const data = { followLine, robust: [] };
const vr = path.join(__dirname, 'test', 'validation_results.json');
if (fs.existsSync(vr)) {
  const v = JSON.parse(fs.readFileSync(vr, 'utf8'));
  data.robust = (v.robustness || []).map((r) => ({ key: r.key, label: r.label, rpm: r.rpm, vmax: r.vmax, settings: r.settings,
    cppPass: r.cppPass, jsPass: r.jsPass, cppLap: r.cppLap, perCondition: r.perCondition.map((c) => ({ ok: c.ok })) }));
  data.validatedAt = v.generated;
}
for (const [name, txt] of [['core', core], ['app', app]]) if (/<\/script/i.test(txt)) throw new Error(name + ' contains </script');
const json = JSON.stringify(data).replace(/</g, '\\u003c');

// split() / join() instead of replace() so "$" in the code is never treated as a pattern
const put = (s, mark, val) => { const parts = s.split(mark); if (parts.length !== 2) throw new Error('marker ' + mark); return parts.join(val); };
tpl = put(tpl, '/*STYLE*/', style);
tpl = put(tpl, '/*DATA*/', json);
tpl = put(tpl, '/*CORE*/', core);
tpl = put(tpl, '/*APP*/', app);

const headStart = tpl.indexOf('<!--HEAD-->'), headEnd = tpl.indexOf('<!--/HEAD-->');
const head = tpl.slice(headStart + 11, headEnd).trim();
const body = tpl.slice(headEnd + 12).trim();

const full = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' + head + '\n</head>\n<body>\n' + body + '\n</body>\n</html>\n';
fs.writeFileSync(path.join(__dirname, 'lf_simulator.html'), full);
console.log('wrote lf_simulator.html (' + (full.length / 1024).toFixed(0) + ' KB)');

const ai = process.argv.indexOf('--artifact');
if (ai > 0) {
  const out = process.argv[ai + 1];
  fs.writeFileSync(out, head + '\n' + body + '\n');
  console.log('wrote ' + out);
}
