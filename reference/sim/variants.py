"""Try setting variants of the sketch in the simulator (patched copies; the real file is not changed)."""
import re, subprocess, itertools, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import run_sim as R
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "code", "LF3_Line_Follower", "LF3_Line_Follower.ino")
OUT = R.OUT
R.write_track()

def build(over, tag):
    s = open(SRC).read()
    for k, v in over.items():
        s, n = re.subn(r"(const\s+[\w ]+\s+%s\s*=\s*)[^;]+;" % k, r"\g<1>%s;" % v, s)
        assert n == 1, k
    p = os.path.join(OUT, "sk_%s.ino" % tag)
    open(p, "w").write(s)
    exe = os.path.join(OUT, "sim_%s" % tag)
    subprocess.run(["g++", "-O2", "-std=c++17", "-w", '-DSKETCH="%s"' % p, "-o", exe, os.path.join(R.HERE, "sim.cpp")], check=True)
    return exe

def sweep(exe, label):
    res = []
    for w, sp, vmax in itertools.product([0.020, 0.025, 0.030], [0.035, 0.040], [0.50, 0.75]):
        if sp < w + 0.005: continue
        ok, line = R.run(exe, w, sp, vmax, trace="t_%s.csv" % label)
        lap = re.search(r"lap=([\d.]+)", line).group(1); dev = re.search(r"mean_dev=([\d.]+)", line).group(1)
        res.append((ok, w, sp, vmax, float(lap), float(dev), line.split()[-1] if not ok else ""))
    n = sum(r[0] for r in res)
    laps = [r[4] for r in res if r[0]]
    print("%-58s pass %2d/%d  laps %s  mean dev %.1f mm  fails: %s" % (label, n, len(res),
          ("%.1f-%.1f s" % (min(laps), max(laps))) if laps else "-", sum(r[5] for r in res)/len(res),
          [(r[1]*100, r[2]*100, r[3]) for r in res if not r[0]]))
    return n == len(res)

if __name__ == "__main__":
    variants = {
        "memory off (LOST=99999)": {"LOST_AFTER_MS": 99999},
        "LOST=100 SHARP=60": {"LOST_AFTER_MS": 100},
        "LOST=150 SHARP=60 (current)": {},
        "LOST=250 SHARP=60": {"LOST_AFTER_MS": 250},
        "LOST=150 SHARP=40": {"SHARP_AFTER_MS": 40},
        "LOST=150 SHARP=30": {"SHARP_AFTER_MS": 30},
        "LOST=250 SHARP=30": {"SHARP_AFTER_MS": 30, "LOST_AFTER_MS": 250},
    }
    for i, (label, over) in enumerate(variants.items()):
        sweep(build(over, "v%d" % i), label)
