"""Robustness check: candidate settings x robot builds x track conditions (runs in parallel)."""
import itertools, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
import variants as V, run_sim as R

def one(args):
    exe, w, sp, vmax, ahead, tau, dead, trackw = args
    env = dict(os.environ, AHEAD=str(ahead), TAU=str(tau), DEAD=str(dead), TRACKW=str(trackw))
    r = subprocess.run([exe, os.path.join(R.OUT, "strokes.csv"), os.path.join(R.OUT, "centre.csv"), "/dev/null",
                        str(w), str(sp), str(vmax), "q"], capture_output=True, text=True, env=env)
    return r.returncode == 0, args[1:]

cands = {
    "A  SHARP=60 LOST=150": {"SHARP_AFTER_MS": 60, "LOST_AFTER_MS": 150},
    "B  SHARP=30 LOST=250": {"SHARP_AFTER_MS": 30, "LOST_AFTER_MS": 250},
    "C  SHARP=30 LOST=200": {"SHARP_AFTER_MS": 30, "LOST_AFTER_MS": 200},
    "D  SHARP=30 LOST=300": {"SHARP_AFTER_MS": 30, "LOST_AFTER_MS": 300},
    "E  SHARP=50 LOST=250": {"SHARP_AFTER_MS": 50, "LOST_AFTER_MS": 250},
    "F  memory off SHARP=30": {"SHARP_AFTER_MS": 30, "LOST_AFTER_MS": 99999},
}
conds = list(itertools.product([0.020, 0.025, 0.030], [0.040], [0.50, 0.75], [0.05, 0.07, 0.09], [0.05, 0.10], [40, 80], [0.12, 0.15]))
if __name__ == "__main__":   # added guard: the sweep only runs when robust.py is run directly (robust2.py imports one())
    print(len(conds), "conditions per candidate")
    for i, (label, over) in enumerate(cands.items()):
        exe = V.build(over, "r%d" % i)
        with ThreadPoolExecutor(max_workers=os.cpu_count()) as ex:
            res = list(ex.map(one, [(exe,) + c for c in conds]))
        ok = sum(r[0] for r in res)
        fails = [r[1] for r in res if not r[0]]
        by_speed = {v: sum(1 for r in res if r[0] and r[1][2] == v) for v in (0.5, 0.75)}
        by_ahead = {a: sum(1 for r in res if r[0] and r[1][3] == a) for a in (0.05, 0.07, 0.09)}
        print("%-26s pass %3d/%d (%.0f%%)  by top speed %s  by sensor distance %s" % (label, ok, len(res), 100 * ok / len(res), by_speed, by_ahead))
