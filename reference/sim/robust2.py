import itertools, os, sys
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
import variants as V
from robust import one
base = {"SHARP_AFTER_MS": 30, "LOST_AFTER_MS": 250}
tests = [
    ("300 RPM, slower settings (125/110/145/-125)", 0.75, dict(base, SPEED_STRAIGHT=125, SPEED_CROSSING=110, TURN_OUTER=145, TURN_INNER_SHARP=-125)),
    ("200 RPM, faster settings (180/150/200/-170)", 0.50, dict(base, SPEED_STRAIGHT=180, SPEED_CROSSING=150, TURN_OUTER=200, TURN_INNER_SHARP=-170)),
    ("200 RPM, much faster (210/170/230/-190)", 0.50, dict(base, SPEED_STRAIGHT=210, SPEED_CROSSING=170, TURN_OUTER=230, TURN_INNER_SHARP=-190)),
]
for i, (label, vmax, over) in enumerate(tests):
    exe = V.build(over, "s%d" % i)
    conds = list(itertools.product([0.020, 0.025, 0.030], [0.040], [vmax], [0.05, 0.07, 0.09], [0.05, 0.10], [40, 80], [0.12, 0.15]))
    with ThreadPoolExecutor(max_workers=2) as ex:
        res = list(ex.map(one, [(exe,) + c for c in conds]))
    ok = sum(r[0] for r in res)
    lapexe = exe
    import subprocess, re
    r = subprocess.run([exe, V.OUT + "/strokes.csv", V.OUT + "/centre.csv", "/dev/null", "0.025", "0.04", str(vmax), "q"], capture_output=True, text=True)
    lap = re.search(r"lap=([\d.]+)", r.stdout).group(1)
    print("%-46s pass %2d/%d   lap on the reference robot %s s" % (label, ok, len(res), lap))
