import csv
import re
import sys
from collections import defaultdict

rows = list(csv.DictReader(open(sys.argv[1])))
bad = [r for r in rows if r["status"] not in ("200", "201") and r["name"] != "team.join"]
print("non-2xx (excluding expected team-full 400s):")
for r in bad:
    if r["status"] != "502":
        print("  ", r)
fails = [float(r["t"]) for r in rows if r["status"] in ("502", "0", "503")]
if fails:
    print(f"502/conn window: first={min(fails):.1f}s last={max(fails):.1f}s span={max(fails) - min(fails):.1f}s count={len(fails)}")
steady = [r for r in rows if r["phase"] in ("c_steady", "d_spike", "e_restart")]
t0 = min(float(r["t"]) for r in steady)
buckets = defaultdict(list)
for r in steady:
    buckets[int((float(r["t"]) - t0) // 30)].append(float(r["ms"]))
print("per-30s window: reqs, rps, p95 ms, max ms")
for k in sorted(buckets):
    v = sorted(buckets[k])
    print(f"  {k * 30:4d}s n={len(v):5d} rps={len(v) / 30:5.1f} p95={v[int(.95 * (len(v) - 1))]:5.1f} max={v[-1]:6.1f}")
slow = sorted((float(r["ms"]), r["t"], r["name"], r["status"]) for r in steady)[-12:]
print("slowest steady requests:", slow)
mon = open(sys.argv[2]).read().splitlines()
peak = defaultdict(lambda: (0.0, 0.0))
mems = defaultdict(list)
for line in mon:
    m = re.match(r"(\S+) (hmt-\S+) cpu=([\d.]+)% mem=([\d.]+)(MiB|GiB)", line)
    if m:
        cpu, mem = float(m.group(3)), float(m.group(4)) * (1024 if m.group(5) == "GiB" else 1)
        name = m.group(2)
        peak[name] = (max(peak[name][0], cpu), max(peak[name][1], mem))
        mems[name].append((m.group(1), mem))
for name, (cpu, mem) in peak.items():
    series = mems[name]
    print(f"{name}: peak cpu={cpu:.0f}% peak mem={mem:.0f}MiB first={series[0]} last={series[-1]}")
conns = [int(m.group(1)) for line in mon for m in [re.search(r"pg_conns=(\d+)", line)] if m]
loads = [float(m.group(1)) for line in mon for m in [re.search(r"load=([\d.]+)", line)] if m]
print(f"pg_conns max={max(conns)} loadavg1 max={max(loads)}")
print("hmt_state samples:", [l.split("hmt_state=")[1].split(" ")[0] for l in mon if "hmt_state=" in l][::20])
