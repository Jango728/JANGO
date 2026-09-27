#!/usr/bin/env python3
"""Merge live fight-night results into data/ledger/<event>.json.

Usage:
  python3 scripts/live-update.py <event-id> <results.json> [--final]
results.json = [{"a": "...", "b": "...", "winner": "Name"|null, "method": "KO/TKO"|"Submission"|"Decision"|"Draw"|"No contest",
                 "detail": "e.g. Unanimous decision (29-28 x3)", "round": 3, "time": "5:00", "source": "https://..."}]
Names must match the seed fighter names on that card (the script checks). Only completed bouts go in.
Existing results are kept; a bout already logged is updated in place. The frozen forecast is never touched.
--final marks the card complete (live=false); the nightly run then writes the review.
"""
import json, sys, re, unicodedata, datetime
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
eid, src = sys.argv[1], sys.argv[2]
final = "--final" in sys.argv
seed = json.load(open(ROOT / "lib/seed.json"))
ev = next(e for e in seed["events"] if e["id"] == eid)
F = seed["fighters"]
def norm(s): return re.sub(r"[^a-z]", "", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower())
card = []
for f in ev["fights"]:
    card.append((F[f["a"]]["name"], F[f["b"]]["name"], f))
def find(a, b):
    for x, y, f in card:
        if {norm(a), norm(b)} == {norm(x), norm(y)}: return x, y, f
    raise SystemExit(f"bout not on card: {a} vs {b}")
path = ROOT / f"data/ledger/{eid}.json"
led = json.load(open(path))
res = led.get("results") or {"checkedAt": "", "sources": [], "bouts": []}
now = datetime.datetime.now(datetime.timezone.utc)
for r in json.load(open(src)):
    a, b, f = find(r["a"], r["b"])
    method = r["method"]
    assert method in ("KO/TKO", "Submission", "Decision", "Draw", "No contest", "DQ"), method
    winner = r.get("winner")
    if method in ("Draw", "No contest"): winner = None
    else:
        assert winner and norm(winner) in (norm(a), norm(b)), winner
        winner = a if norm(winner) == norm(a) else b
    loser = None if winner is None else (b if winner == a else a)
    rnd = int(r["round"]); m, s = map(int, r["time"].split(":"))
    line = 2.5 if f["rounds"] == 5 else 1.5
    elapsed = (rnd - 1) * 5 + m + s / 60
    ou = "Over" if elapsed > line * 5 else "Under"
    bout = {"a": a, "b": b, "winner": winner, "loser": loser, "method": method, "detail": r.get("detail") or method,
            "round": rnd, "time": r["time"], "scheduledRounds": f["rounds"], "line": line, "ou": ou,
            "notes": [], "section": f["section"]}
    old = next((x for x in res["bouts"] if {norm(x["a"]), norm(x["b"])} == {norm(a), norm(b)}), None)
    if old:
        keep = {k: old[k] for k in ("notes", "context", "contract") if k in old}
        old.clear(); old.update(bout); old.update(keep)
    else:
        res["bouts"].append(bout)
    if r.get("source") and all(x["url"] != r["source"] for x in res["sources"]):
        res["sources"].append({"label": "Live result source", "url": r["source"]})
# keep card order
order = {(norm(x), norm(y)): i for i, (x, y, _) in enumerate(card)}
res["bouts"].sort(key=lambda x: order.get((norm(x["a"]), norm(x["b"])), order.get((norm(x["b"]), norm(x["a"])), 99)))
res["checkedAt"] = now.date().isoformat()
res["updatedAt"] = now.isoformat(timespec="seconds")
res["live"] = not final
led["results"] = res
path.write_text(json.dumps(led, indent=1, ensure_ascii=False) + "\n")
print(f"{eid}: {len(res['bouts'])}/{len(card)} results · live={res['live']}")
