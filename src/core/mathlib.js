/*
 * mathlib.js - maths helpers that make the JavaScript simulation match the C++ / Python reference.
 *
 *  - sin / cos : correctly rounded (double-double evaluation).  glibc's sin/cos (used by sim.cpp and
 *                run_sim.py) are correctly rounded for >99.8 % of inputs; V8's Math.sin/Math.cos (fdlibm)
 *                differ from glibc in the last bit for about 3 % of inputs.  Using a correctly rounded
 *                version keeps the JS world model as close as possible to the C++ one.
 *  - hypot     : line-by-line port of glibc 2.35+ e_hypot.c (non-FMA kernel) - bit-identical to glibc.
 *  - pyDist    : port of CPython 3.13 math.dist() / vector_norm() for 2-D points (used by write_track()).
 *  - cfmt      : printf("%.*f") formatting (round-half-even on exact ties, "-0.000" for negative zero).
 *
 * Plain script: works in a browser (defines globalThis.LFMath), in a Worker, and in Node (module.exports).
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- double-double primitives
  const SPLIT = 134217729; // 2^27 + 1 (Veltkamp split)

  function twoSum(a, b) { // exact: a + b = s + e
    const s = a + b;
    const bb = s - a;
    const e = (a - (s - bb)) + (b - bb);
    return [s, e];
  }
  function twoProd(a, b) { // exact: a * b = p + e   (Dekker)
    const p = a * b;
    let t = SPLIT * a;
    const ah = t - (t - a), al = a - ah;
    t = SPLIT * b;
    const bh = t - (t - b), bl = b - bh;
    const e = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
    return [p, e];
  }
  // dd + dd
  function ddAdd(ah, al, bh, bl) {
    let [s, e] = twoSum(ah, bh);
    let [t, f] = twoSum(al, bl);
    e += t;
    let s2 = s + e; e = e - (s2 - s); s = s2;
    e += f;
    s2 = s + e; e = e - (s2 - s);
    return [s2, e];
  }
  // dd * dd
  function ddMul(ah, al, bh, bl) {
    let [p, e] = twoProd(ah, bh);
    e += ah * bl + al * bh;
    const s = p + e;
    return [s, e - (s - p)];
  }
  // dd / double
  function ddDivD(ah, al, b) {
    const q1 = ah / b;
    let [p, e] = twoProd(q1, b);
    let [s, f] = twoSum(ah, -p);
    f -= e; f += al;
    const q2 = (s + f) / b;
    const r = q1 + q2;
    return [r, q2 - (r - q1)];
  }

  // ---------------------------------------------------------------- pi/2 in four 33-bit pieces (fdlibm)
  const F64 = new Float64Array(1), U32 = new Uint32Array(F64.buffer);
  const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  function fromBits(hi, lo) {
    if (LITTLE) { U32[1] = hi; U32[0] = lo; } else { U32[0] = hi; U32[1] = lo; }
    return F64[0];
  }
  const PIO2_1 = fromBits(0x3FF921FB, 0x54400000);   // first 33 bits of pi/2
  const PIO2_2 = fromBits(0x3DD0B461, 0x1A600000);   // next 33 bits
  const PIO2_3 = fromBits(0x3BA3198A, 0x2E000000);   // next 33 bits
  const PIO2_3T = fromBits(0x397B839A, 0x252049C1);  // pi/2 - (PIO2_1 + PIO2_2 + PIO2_3)
  const INV_PIO2 = 6.36619772367581382433e-01;

  // Taylor coefficients (-1)^k / (2k+1)!  and  (-1)^k / (2k)!  as double-doubles
  const SIN_C = [], COS_C = [];
  (function () {
    let fh = 1, fl = 0; // 1/n!
    for (let n = 1; n <= 31; n++) {
      [fh, fl] = ddDivD(fh, fl, n);
      const k = n >> 1, sg = (k % 2 === 0) ? 1 : -1;
      if (n % 2 === 1) SIN_C.push([sg * fh, sg * fl]); // n = 2k+1
      else COS_C.push([sg * fh, sg * fl]);             // n = 2k
    }
  })();
  // SIN_C[k] = (-1)^k/(2k+1)!, k = 0..15 ; COS_C[k-1] = (-1)^k/(2k)!, k = 1..15

  // Flatten the coefficients for the fast scalar evaluation below.
  const SCH = new Float64Array(16), SCL = new Float64Array(16), CCH = new Float64Array(15), CCL = new Float64Array(15);
  for (let k = 0; k < 16; k++) { SCH[k] = SIN_C[k][0]; SCL[k] = SIN_C[k][1]; }
  for (let k = 0; k < 15; k++) { CCH[k] = COS_C[k][0]; CCL[k] = COS_C[k][1]; }

  // sincos of a double: results in OUT_S / OUT_C. Everything is scalar double-double arithmetic
  // (no allocations), relative error ~1e-30 before the final rounding, so the results are the
  // correctly rounded values except in astronomically rare cases.
  let OUT_S = 0, OUT_C = 1;
  function sincos(x) {
    if (!isFinite(x) || Math.abs(x) > 524288) { OUT_S = Math.sin(x); OUT_C = Math.cos(x); return; }
    if (Math.abs(x) < 1e-8) { OUT_S = Math.sin(x); OUT_C = Math.cos(x); return; }   // sin = x, cos = 1 (both libs)
    // --- reduction  x = k*pi/2 + (rh + rl)
    const k = Math.round(x * INV_PIO2);
    let rh = x, rl = 0;
    if (k !== 0) {
      rh = x - k * PIO2_1;
      let s, bb, e, t;
      // rh += -k*PIO2_2 (exact product)
      t = -k * PIO2_2; s = rh + t; bb = s - rh; e = (rh - (s - bb)) + (t - bb); rh = s; rl = e;
      t = -k * PIO2_3; s = rh + t; bb = s - rh; e = (rh - (s - bb)) + (t - bb) + rl; rh = s + e; rl = e - (rh - s);
      // - k*PIO2_3T (two-product)
      const p = k * PIO2_3T;
      let u = SPLIT * k; const kh = u - (u - k), kl = k - kh;
      u = SPLIT * PIO2_3T; const ph = u - (u - PIO2_3T), pl = PIO2_3T - ph;
      const pe = ((kh * ph - p) + kh * pl + kl * ph) + kl * pl;
      s = rh - p; bb = s - rh; e = (rh - (s - bb)) + (-p - bb); e += rl - pe; rh = s + e; rl = e - (rh - s);
    }
    // --- z = r^2 (dd)
    let u = SPLIT * rh; const rH = u - (u - rh), rL = rh - rH;
    let zh = rh * rh;
    let ze = ((rH * rH - zh) + 2 * rH * rL) + rL * rL;
    ze += 2 * rh * rl;
    let tz = zh + ze; ze = ze - (tz - zh); zh = tz;
    u = SPLIT * zh; const zH = u - (u - zh), zL = zh - zH;
    // --- sin polynomial  P = sum SIN_C[k] z^k  (Horner, dd)
    let ah = SCH[15], al = SCL[15];
    for (let i = 14; i >= 0; i--) {
      // (ah,al) *= (zh,ze)
      u = SPLIT * ah; const aH = u - (u - ah), aL = ah - aH;
      let p = ah * zh;
      let e = ((aH * zH - p) + aH * zL + aL * zH) + aL * zL;
      e += ah * ze + al * zh;
      let s = p + e; e = e - (s - p);
      // += (SCH[i], SCL[i])
      const bh = SCH[i], bl = SCL[i];
      let s2 = s + bh, bb = s2 - s, e2 = (s - (s2 - bb)) + (bh - bb);
      e2 += e + bl;
      ah = s2 + e2; al = e2 - (ah - s2);
    }
    // sin(r) = P * r
    u = SPLIT * ah; let aH = u - (u - ah), aL = ah - aH;
    let p = ah * rh;
    let e = ((aH * rH - p) + aH * rL + aL * rH) + aL * rL;
    e += ah * rl + al * rh;
    const sinR = p + e;
    // --- cos polynomial  Q = sum COS_C[k] z^k, cos(r) = 1 + Q*z
    ah = CCH[14]; al = CCL[14];
    for (let i = 13; i >= 0; i--) {
      u = SPLIT * ah; const aH2 = u - (u - ah), aL2 = ah - aH2;
      let p2 = ah * zh;
      let e3 = ((aH2 * zH - p2) + aH2 * zL + aL2 * zH) + aL2 * zL;
      e3 += ah * ze + al * zh;
      let s = p2 + e3; e3 = e3 - (s - p2);
      const bh = CCH[i], bl = CCL[i];
      let s2 = s + bh, bb = s2 - s, e2 = (s - (s2 - bb)) + (bh - bb);
      e2 += e3 + bl;
      ah = s2 + e2; al = e2 - (ah - s2);
    }
    u = SPLIT * ah; aH = u - (u - ah); aL = ah - aH;
    p = ah * zh;
    e = ((aH * zH - p) + aH * zL + aL * zH) + aL * zL;
    e += ah * ze + al * zh;
    let qh = p + e, ql = e - (qh - p);
    // 1 + q
    let s1 = 1 + qh, b1 = s1 - 1, e1 = (1 - (s1 - b1)) + (qh - b1);
    e1 += ql;
    const cosR = s1 + e1;
    const q = ((k % 4) + 4) % 4;
    if (q === 0) { OUT_S = sinR; OUT_C = cosR; }
    else if (q === 1) { OUT_S = cosR; OUT_C = -sinR; }
    else if (q === 2) { OUT_S = -sinR; OUT_C = -cosR; }
    else { OUT_S = -cosR; OUT_C = sinR; }
  }
  function crSin(x) { if (x === 0) return x; sincos(x); return OUT_S; }
  function crCos(x) { sincos(x); return OUT_C; }
  // both at once, written into out[0] (sin) and out[1] (cos)
  function crSinCos(x, out) { if (x === 0) { out[0] = x; out[1] = 1; return; } sincos(x); out[0] = OUT_S; out[1] = OUT_C; }

  // ---------------------------------------------------------------- glibc hypot (sysdeps/ieee754/dbl-64/e_hypot.c)
  const EPS = Math.pow(2, -54);
  function hypot(x, y) {
    if (!isFinite(x) || !isFinite(y)) return Math.hypot(x, y);
    x = Math.abs(x); y = Math.abs(y);
    const ax = x < y ? y : x, ay = x < y ? x : y;
    // (the LARGE_VAL / TINY_VAL rescaling branches never trigger for distances in this simulation)
    if (ay <= ax * EPS) return ax + ay;
    let h = Math.sqrt(ax * ax + ay * ay), t1, t2;
    if (h <= 2.0 * ay) {
      const delta = h - ay;
      t1 = ax * (2.0 * delta - ax);
      t2 = (delta - 2.0 * (ax - ay)) * delta;
    } else {
      const delta = h - ax;
      t1 = 2.0 * delta * (ax - 2.0 * ay);
      t2 = (4.0 * delta - ay) * ay + delta * delta;
    }
    h -= (t1 + t2) / (2.0 * h);
    return h;
  }

  // ---------------------------------------------------------------- CPython 3.13 math.dist for 2-D points
  function frexpExp(v) { // exponent e with v = m * 2^e, 0.5 <= m < 1 (v > 0, normal)
    let e = Math.floor(Math.log2(v)) + 1;
    let m = v / Math.pow(2, e);
    while (m >= 1) { e++; m = v / Math.pow(2, e); }
    while (m < 0.5) { e--; m = v / Math.pow(2, e); }
    return e;
  }
  function pyDist(ax, ay, bx, by) {
    const v0 = Math.abs(ax - bx), v1 = Math.abs(ay - by);
    const max = v0 > v1 ? v0 : v1;
    if (max === 0) return 0;
    const scale = Math.pow(2, -frexpExp(max));
    let csum = 1.0, frac1 = 0.0, frac2 = 0.0;
    for (const v of [v0, v1]) {
      const x = v * scale;
      const [ph, pl] = twoProd(x, x);
      const sh = csum + ph; const sl = ph - (sh - csum); // dl_fast_sum
      csum = sh; frac1 += pl; frac2 += sl;
    }
    let h = Math.sqrt(csum - 1.0 + (frac1 + frac2));
    {
      const [ph, pl] = twoProd(-h, h);
      const sh = csum + ph; const sl = ph - (sh - csum);
      csum = sh; frac1 += pl; frac2 += sl;
    }
    const x = csum - 1.0 + (frac1 + frac2);
    h += x / (2.0 * h);
    return h / scale;
  }

  // ---------------------------------------------------------------- printf("%.Nf")
  function cfmt(x, d) {
    const neg = x < 0 || Object.is(x, -0);
    const a = Math.abs(x);
    let s = a.toFixed(d);
    // toFixed rounds exact ties upwards; C rounds exact ties to even. Ties are rare (exact binary values).
    const full = a.toFixed(Math.min(100, d + 60));
    const tail = full.slice(full.length - 60);
    if (tail[0] === '5' && /^50*$/.test(tail)) {
      const trunc = full.slice(0, full.length - 60);
      const lastDigit = +(trunc[trunc.length - 1] === '.' ? trunc[trunc.length - 2] : trunc[trunc.length - 1]);
      if (lastDigit % 2 === 0) s = trunc.endsWith('.') ? trunc.slice(0, -1) : trunc; // round down to even
    }
    return (neg ? '-' : '') + s;
  }

  const api = { sin: crSin, cos: crCos, sincos: crSinCos, hypot, pyDist, cfmt, twoProd, twoSum, nativeSin: Math.sin, nativeCos: Math.cos };
  root.LFMath = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
