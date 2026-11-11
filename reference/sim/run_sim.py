"""
Build a test track, compile the simulator with the real sketch, run a sweep of conditions, plot one run.

Track (metres): start straight, wide left curve, straight with a CROSSING line, tight right curve,
straight with a 5 cm GAP, a SHARP 90-degree LEFT CORNER, R = 12 cm left curve, an S-bend of
R = 10 cm curves, final straight.
"""
import math, os, subprocess, sys, json, itertools
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)
STEP = 0.002


def build_path():
    x, y, h = 0.0, 0.0, 0.0
    pts, feats = [(x, y)], {}

    def straight(L):
        nonlocal x, y
        n = max(1, int(round(L / STEP)))
        for i in range(n):
            x += math.cos(h) * L / n
            y += math.sin(h) * L / n
            pts.append((x, y))

    def arc(R, deg):              # deg > 0 = left
        nonlocal x, y, h
        ang = math.radians(deg)
        n = max(2, int(abs(R * ang) / STEP))
        cx, cy = x - math.sin(h) * R * (1 if deg > 0 else -1), y + math.cos(h) * R * (1 if deg > 0 else -1)
        for i in range(n):
            h += ang / n
            sgn = 1 if deg > 0 else -1
            x = cx + math.sin(h) * R * sgn
            y = cy - math.cos(h) * R * sgn
            pts.append((x, y))

    def corner(deg):
        nonlocal h
        h += math.radians(deg)

    straight(0.50)
    arc(0.25, 90)
    straight(0.20); feats["crossing"] = (x, y, h); straight(0.25)
    arc(0.15, -90)
    straight(0.25); feats["gap_start"] = len(pts) - 1; straight(0.05); feats["gap_end"] = len(pts) - 1; straight(0.20)
    feats["corner"] = (x, y); corner(90)
    straight(0.35)
    arc(0.12, 90)
    straight(0.20)
    arc(0.10, 90)
    arc(0.10, -90)
    straight(0.40)
    return pts, feats


def write_track():
    pts, feats = build_path()
    s = [0.0]
    for a, b in zip(pts, pts[1:]):
        s.append(s[-1] + math.dist(a, b))
    with open(os.path.join(OUT, "centre.csv"), "w") as f:
        for (x, y), si in zip(pts, s):
            f.write("%.5f,%.5f,%.5f\n" % (x, y, si))
    g0, g1 = feats["gap_start"], feats["gap_end"]
    cx, cy, ch = feats["crossing"]
    nx, ny = -math.sin(ch), math.cos(ch)
    cross = [(cx - nx * 0.15 + nx * 0.3 * k / 150, cy - ny * 0.15 + ny * 0.3 * k / 150) for k in range(151)]
    strokes = [pts[:g0 + 1], pts[g1:], cross]
    with open(os.path.join(OUT, "strokes.csv"), "w") as f:
        for i, st in enumerate(strokes):
            for x, y in st:
                f.write("%d,%.5f,%.5f\n" % (i, x, y))
    json.dump({"crossing": feats["crossing"][:2], "corner": feats["corner"], "gap": pts[g0], "end": pts[-1],
               "length": s[-1]}, open(os.path.join(OUT, "features.json"), "w"))
    return strokes, s[-1]


def compile_sim():
    exe = os.path.join(OUT, "sim")
    subprocess.run(["g++", "-O2", "-std=c++17", "-Wall", "-Wno-unused-variable", "-o", exe,
                    os.path.join(HERE, "sim.cpp")], check=True)
    return exe


def run(exe, w, sp, vmax, trace="trace.csv", quiet=True):
    args = [exe, os.path.join(OUT, "strokes.csv"), os.path.join(OUT, "centre.csv"), os.path.join(OUT, trace),
            str(w), str(sp), str(vmax)] + (["q"] if quiet else [])
    r = subprocess.run(args, capture_output=True, text=True)
    line = [l for l in r.stdout.splitlines() if l.startswith("RESULT")]
    return r.returncode == 0, (line[0] if line else r.stdout[-300:] + r.stderr[-300:])


if __name__ == "__main__":
    strokes, L = write_track()
    exe = compile_sim()
    print("track length %.2f m" % L)
    ok_all = True
    for w, sp, vmax in itertools.product([0.020, 0.025, 0.030], [0.035, 0.040], [0.50, 0.75]):
        if sp < w + 0.005:
            continue
        ok, res = run(exe, w, sp, vmax, trace="trace_sweep.csv")
        ok_all &= ok
        print("line %.1f cm  sensors %.1f cm apart  top speed %.2f m/s -> %s" % (w * 100, sp * 100, vmax, res[7:]))
    ok, res = run(exe, 0.025, 0.038, 0.50, trace="trace.csv", quiet=False)
    print("REFERENCE RUN (2.5 cm line, 3.8 cm spacing, 200 RPM motors):", res)
    print("ALL PASS" if ok_all and ok else "SOME FAILED")
