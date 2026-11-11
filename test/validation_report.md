# Validation report: JavaScript simulation vs C++ reference

Generated 2026-11-11T21:02:45.949Z by `node test/validate.js` (g++: g++ (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, node v22.23.4).

## Summary

- ✅ Track: JS centre.csv and strokes.csv are byte-identical to run_sim.py output — length 3.53 m, 1764 centre points, tape pieces 914/826/151
- ✅ Track length prints as 3.53 m
- ✅ rpmToVmax(200 RPM, 65 mm) === 0.5 and rpmToVmax(300, 65) === 0.75
- ✅ 13 run_sim.py cases: JS RESULT line identical to C++ (lap, mean/max dev, junctions, progress) — 13/13
- ✅ 13 run_sim.py cases: JS trace (every 5 ms, x/y/heading/sensors/action/wheel speeds) identical text to C++ trace — 13/13
- ✅ Reference run trace identical to reference/sim/out/trace.csv written by run_sim.py — 3618 lines
- ✅ Reference run, full double precision every 5 ms (correctly rounded sin/cos): max position difference < 1 micrometre — 3617/3617 samples bit-identical, max |dpos| = 0.00e+0 m, max |dheading| = 0.00e+0 rad
- ✅ Robustness: Default, line memory on @ 200 RPM - JS pass count equals C++ and every RESULT line is identical — C++ 72/72, JS 72/72, identical lines 72/72
- ✅ Robustness: Default, line memory on @ 300 RPM - JS pass count equals C++ and every RESULT line is identical — C++ 56/72, JS 56/72, identical lines 72/72
- ✅ Robustness: Default, line memory off @ 200 RPM - JS pass count equals C++ and every RESULT line is identical — C++ 64/72, JS 64/72, identical lines 72/72
- ✅ Robustness: Default, line memory off @ 300 RPM - JS pass count equals C++ and every RESULT line is identical — C++ 49/72, JS 49/72, identical lines 72/72
- ✅ Robustness: Slower (125/110/145/-125) @ 300 RPM - JS pass count equals C++ and every RESULT line is identical — C++ 67/72, JS 67/72, identical lines 72/72
- ✅ Robustness: Faster (180/150/200/-170) @ 200 RPM - JS pass count equals C++ and every RESULT line is identical — C++ 64/72, JS 64/72, identical lines 72/72
- ✅ Robustness: Much faster (210/170/230/-190) @ 200 RPM - JS pass count equals C++ and every RESULT line is identical — C++ 50/72, JS 50/72, identical lines 72/72
- ✅ lf_simulator.html contains the exact src/core files that were tested — mathlib.js, track.js, lf3_sketch.js, world.js, params.js

## The 13 run_sim.py cases

| Case | C++ (sim.cpp) | JavaScript | Same | Trace same |
|---|---|---|---|---|
| line 2.0 cm, sensors 3.5 cm, 0.50 m/s | FINISHED lap=16.67s mean_dev=5.4mm max_dev=8.0mm junctions_counted=1 progress=3.52/3.53m | FINISHED lap=16.67s mean_dev=5.4mm max_dev=8.0mm junctions_counted=1 progress=3.52/3.53m | yes | yes (3603 lines) |
| line 2.0 cm, sensors 3.5 cm, 0.75 m/s | FINISHED lap=11.42s mean_dev=5.1mm max_dev=14.9mm junctions_counted=1 progress=3.52/3.53m | FINISHED lap=11.42s mean_dev=5.1mm max_dev=14.9mm junctions_counted=1 progress=3.52/3.53m | yes | yes (2552 lines) |
| line 2.0 cm, sensors 4.0 cm, 0.50 m/s | FINISHED lap=16.63s mean_dev=7.3mm max_dev=10.4mm junctions_counted=1 progress=3.52/3.53m | FINISHED lap=16.63s mean_dev=7.3mm max_dev=10.4mm junctions_counted=1 progress=3.52/3.53m | yes | yes (3594 lines) |
| line 2.0 cm, sensors 4.0 cm, 0.75 m/s | FINISHED lap=11.30s mean_dev=7.0mm max_dev=18.4mm junctions_counted=1 progress=3.52/3.53m | FINISHED lap=11.30s mean_dev=7.0mm max_dev=18.4mm junctions_counted=1 progress=3.52/3.53m | yes | yes (2529 lines) |
| line 2.5 cm, sensors 3.5 cm, 0.50 m/s | FINISHED lap=16.85s mean_dev=3.5mm max_dev=6.8mm junctions_counted=1 progress=3.52/3.53m | FINISHED lap=16.85s mean_dev=3.5mm max_dev=6.8mm junctions_counted=1 progress=3.52/3.53m | yes | yes (3638 lines) |
| line 2.5 cm, sensors 3.5 cm, 0.75 m/s | FINISHED lap=11.19s mean_dev=3.5mm max_dev=10.7mm junctions_counted=1 progress=3.52/3.53m | FINISHED lap=11.19s mean_dev=3.5mm max_dev=10.7mm junctions_counted=1 progress=3.52/3.53m | yes | yes (2507 lines) |
| line 2.5 cm, sensors 4.0 cm, 0.50 m/s | FINISHED lap=16.74s mean_dev=5.3mm max_dev=7.8mm junctions_counted=1 progress=3.52/3.53m | FINISHED lap=16.74s mean_dev=5.3mm max_dev=7.8mm junctions_counted=1 progress=3.52/3.53m | yes | yes (3617 lines) |
| line 2.5 cm, sensors 4.0 cm, 0.75 m/s | FINISHED lap=11.15s mean_dev=5.2mm max_dev=11.2mm junctions_counted=1 progress=3.52/3.53m | FINISHED lap=11.15s mean_dev=5.2mm max_dev=11.2mm junctions_counted=1 progress=3.52/3.53m | yes | yes (2498 lines) |
| line 3.0 cm, sensors 3.5 cm, 0.50 m/s | FINISHED lap=17.46s mean_dev=1.9mm max_dev=12.4mm junctions_counted=23 progress=3.52/3.53m | FINISHED lap=17.46s mean_dev=1.9mm max_dev=12.4mm junctions_counted=23 progress=3.52/3.53m | yes | yes (3760 lines) |
| line 3.0 cm, sensors 3.5 cm, 0.75 m/s | FINISHED lap=11.58s mean_dev=1.8mm max_dev=9.1mm junctions_counted=16 progress=3.52/3.53m | FINISHED lap=11.58s mean_dev=1.8mm max_dev=9.1mm junctions_counted=16 progress=3.52/3.53m | yes | yes (2585 lines) |
| line 3.0 cm, sensors 4.0 cm, 0.50 m/s | FINISHED lap=16.97s mean_dev=3.5mm max_dev=10.8mm junctions_counted=1 progress=3.52/3.53m | FINISHED lap=16.97s mean_dev=3.5mm max_dev=10.8mm junctions_counted=1 progress=3.52/3.53m | yes | yes (3662 lines) |
| line 3.0 cm, sensors 4.0 cm, 0.75 m/s | FINISHED lap=11.22s mean_dev=3.3mm max_dev=8.6mm junctions_counted=1 progress=3.52/3.53m | FINISHED lap=11.22s mean_dev=3.3mm max_dev=8.6mm junctions_counted=1 progress=3.52/3.53m | yes | yes (2513 lines) |
| REFERENCE line 2.5 cm, sensors 3.8 cm, 0.50 m/s | FINISHED lap=16.75s mean_dev=4.6mm max_dev=7.0mm junctions_counted=1 progress=3.52/3.53m | FINISHED lap=16.75s mean_dev=4.6mm max_dev=7.0mm junctions_counted=1 progress=3.52/3.53m | yes | yes (3618 lines) |

## Robustness sets (72 conditions each)

| Settings | RPM | Your results (g++ 13) | C++ here | JavaScript | Identical RESULT lines | Lap on reference robot C++ / JS |
|---|---|---|---|---|---|---|
| Default, line memory on | 200 (0.50 m/s) | 72/72 | 72/72 | 72/72 | 72/72 | 16.74 s / 16.74 s |
| Default, line memory on | 300 (0.75 m/s) | 56/72 | 56/72 | 56/72 | 72/72 | 11.15 s / 11.15 s |
| Default, line memory off | 200 (0.50 m/s) | 64/72 | 64/72 | 64/72 | 72/72 | 16.74 s / 16.74 s |
| Default, line memory off | 300 (0.75 m/s) | 49/72 | 49/72 | 49/72 | 72/72 | 11.15 s / 11.15 s |
| Slower (125/110/145/-125) | 300 (0.75 m/s) | 67/72 | 67/72 | 67/72 | 72/72 | 15.20 s / 15.20 s |
| Faster (180/150/200/-170) | 200 (0.50 m/s) | 64/72, lap 12.64 s | 64/72 | 64/72 | 72/72 | 12.64 s / 12.64 s |
| Much faster (210/170/230/-190) | 200 (0.50 m/s) | 50/72, lap 10.48 s | 50/72 | 50/72 | 72/72 | 10.48 s / 10.48 s |

## Full double precision (reference run, x / y / heading every 5 ms)

| sin/cos used by the JS | samples | bit-identical to C++ | max position difference | max heading difference |
|---|---|---|---|---|
| correctly rounded (used by the page) | 3617 | 3617 | 0.00e+0 m | 0.00e+0 rad |
| Math.sin / Math.cos (V8) | 3617 | 3617 | 0.00e+0 m | 0.00e+0 rad |

Every sample is bit-for-bit identical: the JavaScript port computes exactly the same doubles as the C++ program. glibc sin()/cos() and V8 Math.sin()/Math.cos() can differ in the last bit, but here those differences are multiplied by v*dt (about 0.00025 m) and vanish below the rounding step of x and y. The page uses correctly rounded sin/cos (src/core/mathlib.js), which agree with glibc for over 99.9 % of inputs, as an extra safety margin.

Total time 37 s.
