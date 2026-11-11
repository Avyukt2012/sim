/*
 * track.js - port of build_path() and write_track() from reference/sim/run_sim.py.
 *
 * The C++ simulator does not use the Python numbers directly: it reads them back from CSV files that were
 * written with "%.5f".  So this module builds the path exactly like Python and then rounds every number
 * through the same "%.5f" text, which gives the C++ simulator's input bit for bit (checked by the tests
 * against the CSV files written by run_sim.py).
 */
(function (root) {
  'use strict';
  const LM = root.LFMath || (typeof require !== 'undefined' ? require('./mathlib.js') : null);
  const STEP = 0.002;

  function pyRound(v) { // Python 3 round(): ties to even
    const f = Math.floor(v), d = v - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return (f % 2 === 0) ? f : f + 1;
  }
  const radians = (deg) => deg * (Math.PI / 180.0);

  function buildPath() {
    let x = 0.0, y = 0.0, h = 0.0;
    const pts = [[x, y]], feats = {};
    const sin = LM.sin, cos = LM.cos;

    function straight(L) {
      const n = Math.max(1, Math.trunc(pyRound(L / STEP)));
      for (let i = 0; i < n; i++) {
        x += cos(h) * L / n;
        y += sin(h) * L / n;
        pts.push([x, y]);
      }
    }
    function arc(R, deg) { // deg > 0 = left
      const ang = radians(deg);
      const n = Math.max(2, Math.trunc(Math.abs(R * ang) / STEP));
      const cx = x - sin(h) * R * (deg > 0 ? 1 : -1), cy = y + cos(h) * R * (deg > 0 ? 1 : -1);
      for (let i = 0; i < n; i++) {
        h += ang / n;
        const sgn = deg > 0 ? 1 : -1;
        x = cx + sin(h) * R * sgn;
        y = cy - cos(h) * R * sgn;
        pts.push([x, y]);
      }
    }
    function corner(deg) { h += radians(deg); }

    straight(0.50);
    arc(0.25, 90);
    straight(0.20); feats.crossing = [x, y, h]; straight(0.25);
    arc(0.15, -90);
    straight(0.25); feats.gap_start = pts.length - 1; straight(0.05); feats.gap_end = pts.length - 1; straight(0.20);
    feats.corner = [x, y]; corner(90);
    straight(0.35);
    arc(0.12, 90);
    straight(0.20);
    arc(0.10, 90);
    arc(0.10, -90);
    straight(0.40);
    return { pts, feats };
  }

  // Returns the same data the C++ simulator loads: strokes (tape pieces) and centre line with distance s.
  function writeTrack() {
    const { pts, feats } = buildPath();
    const s = [0.0];
    for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + LM.pyDist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));

    const f5 = (v) => LM.cfmt(v, 5);
    const centreLines = [];
    const centre = { x: new Float64Array(pts.length), y: new Float64Array(pts.length), s: new Float64Array(pts.length) };
    for (let i = 0; i < pts.length; i++) {
      const a = f5(pts[i][0]), b = f5(pts[i][1]), c = f5(s[i]);
      centreLines.push(a + ',' + b + ',' + c);
      centre.x[i] = parseFloat(a); centre.y[i] = parseFloat(b); centre.s[i] = parseFloat(c); // == sscanf("%lf")
    }
    const g0 = feats.gap_start, g1 = feats.gap_end;
    const [cx, cy, ch] = feats.crossing;
    const nx = -LM.sin(ch), ny = LM.cos(ch);
    const cross = [];
    for (let k = 0; k < 151; k++) cross.push([cx - nx * 0.15 + nx * 0.3 * k / 150, cy - ny * 0.15 + ny * 0.3 * k / 150]);
    const strokesRaw = [pts.slice(0, g0 + 1), pts.slice(g1), cross];
    const strokeLines = [];
    const strokes = strokesRaw.map((st, i) => {
      const xs = new Float64Array(st.length), ys = new Float64Array(st.length);
      st.forEach(([px, py], j) => {
        const a = f5(px), b = f5(py);
        strokeLines.push(i + ',' + a + ',' + b);
        xs[j] = parseFloat(a); ys[j] = parseFloat(b);
      });
      return { x: xs, y: ys, n: st.length };
    });
    const length = s[s.length - 1];
    return {
      strokes, centre, length,
      total: centre.s[centre.s.length - 1],          // centreS.back() as the C++ sees it
      features: { crossing: [cx, cy], crossingHeading: ch, corner: feats.corner, gap: pts[g0], gapEnd: pts[g1], end: pts[pts.length - 1], start: pts[0],
                  gapIndex: [g0, g1] },
      csv: { centre: centreLines.join('\n') + '\n', strokes: strokeLines.join('\n') + '\n' },
    };
  }

  const api = { buildPath, writeTrack, STEP };
  root.LFTrack = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
