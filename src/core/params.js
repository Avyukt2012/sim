/*
 * params.js - the numbers the page and the tests share: motor RPM -> top speed, the setting presets,
 * and the 72-condition robustness set of robust.py / robust2.py.
 */
(function (root) {
  'use strict';

  // v_max (m/s) = (RPM / 400) * (wheel diameter / 65 mm), computed in exactly this order,
  // so 200 RPM -> 0.5 and 300 RPM -> 0.75 exactly with 65 mm wheels.
  function rpmToVmax(rpm, wheelMm) {
    return (rpm / 400) * (wheelMm / 65);
  }

  // centimetres / millimetres -> metres through text, so 3.8 cm becomes exactly the double 0.038
  // (3.8 / 100 would give 0.037999999999999999 in floating point).
  function cm(v) { return parseFloat(String(v) + 'e-2'); }
  function mm(v) { return parseFloat(String(v) + 'e-3'); }

  const PRESETS = {
    default:     { label: 'Default',                    SPEED_STRAIGHT: 150, SPEED_CROSSING: 130, TURN_OUTER: 170, TURN_INNER_SOFT: 0, TURN_INNER_SHARP: -150 },
    slower:      { label: 'Slower (for 300 RPM motors)', SPEED_STRAIGHT: 125, SPEED_CROSSING: 110, TURN_OUTER: 145, TURN_INNER_SOFT: 0, TURN_INNER_SHARP: -125 },
    faster:      { label: 'Faster',                     SPEED_STRAIGHT: 180, SPEED_CROSSING: 150, TURN_OUTER: 200, TURN_INNER_SOFT: 0, TURN_INNER_SHARP: -170 },
    muchFaster:  { label: 'Much faster',                SPEED_STRAIGHT: 210, SPEED_CROSSING: 170, TURN_OUTER: 230, TURN_INNER_SOFT: 0, TURN_INNER_SHARP: -190 },
  };
  const PRESET_TIMING = { SHARP_AFTER_MS: 30, LOST_AFTER_MS: 250, SEARCH_GIVE_UP_MS: 2000 };
  const SETTING_KEYS = ['SPEED_STRAIGHT', 'SPEED_CROSSING', 'TURN_OUTER', 'TURN_INNER_SOFT', 'TURN_INNER_SHARP',
    'SHARP_AFTER_MS', 'LOST_AFTER_MS', 'SEARCH_GIVE_UP_MS'];
  const MEMORY_OFF_LOST_MS = 99999;   // "line memory off", exactly as robust.py candidate F does it

  function presetSettings(name) {
    const p = PRESETS[name];
    const s = {};
    for (const k of SETTING_KEYS) s[k] = (k in p) ? p[k] : PRESET_TIMING[k];
    return s;
  }

  // The robustness set: line width {2.0, 2.5, 3.0 cm} x sensors ahead {5, 7, 9 cm} x TAU {0.05, 0.10 s}
  // x DEAD {40, 80} x wheel spacing {12, 15 cm}; sensor spacing 4.0 cm.  Same order as itertools.product
  // in robust.py (line width, spacing, vmax, ahead, tau, dead, wheel spacing).
  const ROBUST = { lineW: [0.020, 0.025, 0.030], spacing: 0.040, ahead: [0.05, 0.07, 0.09], tau: [0.05, 0.10], dead: [40, 80], wheelTrack: [0.12, 0.15] };
  function robustConditions() {
    const out = [];
    for (const lineW of ROBUST.lineW) for (const ahead of ROBUST.ahead) for (const tau of ROBUST.tau)
      for (const dead of ROBUST.dead) for (const wheelTrack of ROBUST.wheelTrack)
        out.push({ lineW, spacing: ROBUST.spacing, ahead, tau, dead, wheelTrack });
    return out;
  }

  const DEFAULT_BUILD = { spacingCm: 3.8, aheadCm: 7, wheelTrackCm: 13, wheelMm: 65, tau: 0.08, dead: 60 };

  const api = { rpmToVmax, cm, mm, PRESETS, PRESET_TIMING, SETTING_KEYS, MEMORY_OFF_LOST_MS, presetSettings, ROBUST, robustConditions, DEFAULT_BUILD };
  root.LFParams = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
