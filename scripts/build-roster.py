#!/usr/bin/env python3
"""Build the full UFC roster dataset for Jango Playz.

Scope: every fighter with at least one UFC bout on/after 2021-01-01, with their
full UFC history (any year), tale of the tape, career UFCStats-style aggregates
and per-fight stat lines.

Primary source: UFCStats CSVs mirrored at github.com/Greco1899/scrape_ufc_stats
(refreshed daily by that repo). Secondary source: this project's own verified
fighter profiles in lib/seed.json (country, pro record, missing tale-of-tape
fields), merged only when the name matches one roster fighter and at least one
UFC bout date agrees.

Usage:
    python3 scripts/build-roster.py            # download fresh CSVs, build
    python3 scripts/build-roster.py --offline  # reuse cached CSVs

Plain python3 (standard library only). Output is deterministic for the same input.
Writes:
    public/roster/roster.json (or roster-N.json + roster-index.json if > MAX_BYTES)
    public/roster/names.json
    public/roster/rounds.json  compact ROUND-BY-ROUND stat lines for every roster bout
                               (engine v1.3 round features; see docs/ROSTER.md)
"""
import csv
import difflib
import json
import os
import re
import sys
import unicodedata
import urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "roster")
SEED = os.path.join(ROOT, "lib", "seed.json")
CACHE = os.environ.get("ROSTER_CACHE", "/tmp/jango-roster-cache")
BASE = "https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/"
FILES = [
    "ufc_event_details.csv",
    "ufc_fight_results.csv",
    "ufc_fight_stats.csv",
    "ufc_fighter_details.csv",
    "ufc_fighter_tott.csv",
]
SCOPE_FROM = "2021-01-01"
# Per-round line layout in public/roster/rounds.json (one list per fighter per round).
ROUND_FIELDS = ["kd", "sigL", "sigA", "headL", "groundL", "totL", "tdL", "tdA", "subAtt", "rev", "ctrlSec"]
MAX_BYTES = 6_000_000
SOURCE = ("UFCStats via github.com/Greco1899/scrape_ufc_stats; country/pro record "
          "from Jango Playz verified profiles (lib/seed.json) where matched")

# Manual identity pins for bouts the automatic duplicate-name resolver cannot
# decide: {(event, bout, name_as_listed): ufcstats_id}. Empty unless needed.
PINS = {}

# Events present in fight results but missing from ufc_event_details.csv.
# "UFC - Road to UFC 4.6" = Road to UFC Season 4 semifinals, Shanghai (ufc.com results page).
EVENT_DATES = {
    "UFC - Road to UFC 4.6": ("2025-08-22", "Shanghai, China"),
}

# Bout-name spellings that differ from every fighter-page spelling.
ALIASES = {
    "rafael cerquiera": "rafael cerqueira",
}

WEIGHT_LIMITS = {
    "Strawweight": 115, "Flyweight": 125, "Bantamweight": 135, "Featherweight": 145,
    "Lightweight": 155, "Welterweight": 170, "Middleweight": 185,
    "Light Heavyweight": 205, "Heavyweight": 265, "Super Heavyweight": 300,
    "Women's Strawweight": 115, "Women's Flyweight": 125,
    "Women's Bantamweight": 135, "Women's Featherweight": 145,
}
CLASS_PATTERNS = [
    ("Women's Strawweight", "Women's Strawweight"), ("Women's Flyweight", "Women's Flyweight"),
    ("Women's Bantamweight", "Women's Bantamweight"), ("Women's Featherweight", "Women's Featherweight"),
    ("Light Heavyweight", "Light Heavyweight"), ("Super Heavyweight", "Super Heavyweight"),
    ("Heavyweight", "Heavyweight"), ("Middleweight", "Middleweight"), ("Welterweight", "Welterweight"),
    ("Lightweight", "Lightweight"), ("Featherweight", "Featherweight"), ("Bantamweight", "Bantamweight"),
    ("Flyweight", "Flyweight"), ("Strawweight", "Strawweight"),
    ("Catch Weight", "Catchweight"), ("Open Weight", "Openweight"),
]


# ---------------------------------------------------------------- helpers
def log(*a):
    print(*a, file=sys.stderr)


def download(offline):
    os.makedirs(CACHE, exist_ok=True)
    for f in FILES:
        path = os.path.join(CACHE, f)
        if offline and os.path.exists(path):
            continue
        log(f"downloading {f}")
        req = urllib.request.Request(BASE + f, headers={"User-Agent": "jango-roster-build"})
        with urllib.request.urlopen(req, timeout=180) as r:
            data = r.read()
        tmp = path + ".part"
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)


def read_csv(name):
    with open(os.path.join(CACHE, name), newline="", encoding="utf-8") as fh:
        return [{k.strip(): (v.strip() if isinstance(v, str) else v) for k, v in row.items()}
                for row in csv.DictReader(fh)]


def ascii_fold(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")


def exact_key(name):
    return re.sub(r"\s+", " ", ascii_fold(name).lower()).strip()


def norm_key(name):
    s = ascii_fold(name).lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", s)
    return re.sub(r"[^a-z0-9]", "", s)


def sorted_key(name):
    s = ascii_fold(name).lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", s)
    return "".join(sorted(re.findall(r"[a-z0-9]+", s)))


def slugify(name):
    s = ascii_fold(name).lower()
    s = re.sub(r"['’`.]", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "fighter"


def names_similar(a, b):
    """Are two spellings plausibly the same person (used to trust tott rows)?"""
    if not a or not b:
        return False
    if norm_key(a) == norm_key(b) or sorted_key(a) == sorted_key(b):
        return True
    ta = set(re.findall(r"[a-z]+", ascii_fold(a).lower())) - {"jr", "sr", "ii", "iii", "da", "de", "dos"}
    tb = set(re.findall(r"[a-z]+", ascii_fold(b).lower())) - {"jr", "sr", "ii", "iii", "da", "de", "dos"}
    if ta & tb:
        return True
    return difflib.SequenceMatcher(None, norm_key(a), norm_key(b)).ratio() >= 0.7


def parse_date(s, fmts=("%B %d, %Y", "%b %d, %Y")):
    if not s or s == "--":
        return None
    for f in fmts:
        try:
            return datetime.strptime(s, f).date().isoformat()
        except ValueError:
            pass
    return None


def parse_height(s):
    m = re.match(r"(\d+)'\s*(\d+)", s or "")
    return int(m.group(1)) * 12 + int(m.group(2)) if m else None


def parse_inches(s):
    m = re.match(r"([\d.]+)", s or "")
    if not m:
        return None
    v = float(m.group(1))
    return int(v) if v == int(v) else v


def parse_lbs(s):
    m = re.match(r"(\d+)", s or "")
    return int(m.group(1)) if m else None


def x_of_y(s):
    m = re.match(r"(\d+)\s+of\s+(\d+)", s or "")
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def mmss(s):
    m = re.match(r"(\d+):(\d+)", s or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else 0


def to_int(s):
    try:
        return int(float(s))
    except (TypeError, ValueError):
        return 0


def weight_class(raw):
    for pat, label in CLASS_PATTERNS:
        if pat.lower() in raw.lower():
            return label
    return "Openweight"


def is_title(raw):
    r = raw.lower()
    return r.startswith("ufc ") and ("title bout" in r or "championship" in r)


def fight_seconds(fmt, rnd, t):
    lengths = [int(x) for x in re.findall(r"\d+", (re.search(r"\(([^)]*)\)", fmt or "") or [None, ""])[1])]
    if not lengths and fmt and "no time limit" not in fmt.lower():
        lengths = [5] * 5
    prior = sum(lengths[: max(rnd - 1, 0)]) * 60 if lengths else 0
    return prior + mmss(t)


POS_RE = re.compile(
    r"\s*\b(At Distance|In Clinch|On Ground|Standing|From .*|After Drop.*|Technical Submission.*)$", re.I)


def clean_technique(d):
    """Condense UFCStats method details: 'Punches to Head From Mount' -> 'Punches'."""
    d = (d or "").strip()
    if "injur" in d.lower():
        return "Injury"
    d = re.sub(r"^to(?=[A-Z]|\s|$)\s*(At Distance|On Ground|In Clinch)?", "", d).strip()  # 'toCorner Stoppage'
    d = re.split(r"(?<=[a-z]{2})(?=[A-Z][a-z])", d)[0]  # glued text: 'ChokeTechnical Submission'
    d = POS_RE.sub("", d).strip()
    d = re.sub(r"\s+(to\s+)?Head$", "", d)             # 'Punch to Head', 'Flying Knee Head'
    d = re.sub(r"(?<!to) Body$", " to Body", d)         # 'Spinning Back Kick Body'
    d = re.sub(r"\s+to$", "", d).strip()                # 'Slam to'
    low = d.lower()
    if "injur" in low:
        return "Injury"
    if low.startswith("corner"):
        return "Corner Stoppage"
    if low.startswith("referee"):
        return "Referee Stoppage"
    if low in ("other", "injury"):
        return "Injury" if low == "injury" else ""
    if low == "rear naked choke":
        return "Rear-Naked Choke"
    return d


def normalize_method(method, details):
    m = (method or "").strip()
    d = (details or "").strip()
    if m.startswith("Decision"):
        kind = m.split("-", 1)[1].strip() if "-" in m else ""
        return f"Decision ({kind})" if kind else "Decision"
    if m == "KO/TKO":
        t = clean_technique(d)
        return f"KO/TKO ({t})" if t else "KO/TKO"
    if m.startswith("TKO - Doctor"):
        return "KO/TKO (Doctor Stoppage)"
    if m == "Submission":
        t = clean_technique(d)
        return f"Submission ({t})" if t else "Submission"
    if m in ("DQ", "Overturned", "Could Not Continue"):
        return m
    return m or None


def rate(n, minutes, per=1.0):
    return round(n / minutes * per, 2) if minutes > 0 else None


def pct(n, d):
    return round(100 * n / d) if d > 0 else None


# ---------------------------------------------------------------- build
def main():
    offline = "--offline" in sys.argv
    download(offline)

    events = {r["EVENT"]: r for r in read_csv("ufc_event_details.csv")}
    results = read_csv("ufc_fight_results.csv")
    stats_rows = read_csv("ufc_fight_stats.csv")
    details = read_csv("ufc_fighter_details.csv")
    tott = read_csv("ufc_fighter_tott.csv")

    # ---- fighters by ufcstats id
    fid = lambda url: url.rstrip("/").rsplit("/", 1)[-1]
    people = {}
    for r in details:
        i = fid(r["URL"])
        people[i] = {"id": i, "fdName": " ".join(x for x in (r["FIRST"], r["LAST"]) if x).strip(),
                     "nickname": r["NICKNAME"] or None}
    tott_suspect = []
    for r in tott:
        i = fid(r["URL"])
        p = people.setdefault(i, {"id": i, "fdName": None, "nickname": None})
        p["ttName"] = r["FIGHTER"]
        trusted = p["fdName"] is None or names_similar(p["fdName"], r["FIGHTER"])
        if not trusted:
            tott_suspect.append((i, p["fdName"], r["FIGHTER"]))
            continue
        p.update({"heightIn": parse_height(r["HEIGHT"]), "reachIn": parse_inches(r["REACH"]),
                  "stance": r["STANCE"] or None, "dob": parse_date(r["DOB"], ("%b %d, %Y",)),
                  "lbs": parse_lbs(r["WEIGHT"])})

    # ---- name index (fighter-page names first, tale-of-tape names second)
    idx_exact, idx_norm, idx_sorted = defaultdict(set), defaultdict(set), defaultdict(set)
    suspect_ids = {s[0] for s in tott_suspect}
    for p in people.values():
        names_for = [p.get("fdName")] + ([] if p["id"] in suspect_ids else [p.get("ttName")])
        for n in names_for:
            if not n:
                continue
            idx_exact[exact_key(n)].add(p["id"])
            idx_norm[norm_key(n)].add(p["id"])
            idx_sorted[sorted_key(n)].add(p["id"])
    norm_keys = sorted(idx_norm)

    unresolved, fuzzy_used = Counter(), {}

    def candidates(name):
        k = ALIASES.get(exact_key(name), exact_key(name))
        for idx, key in ((idx_exact, k), (idx_norm, norm_key(k)), (idx_sorted, sorted_key(k))):
            if idx.get(key):
                return sorted(idx[key])
        close = difflib.get_close_matches(norm_key(k), norm_keys, n=2, cutoff=0.9)
        if len(close) == 1:
            fuzzy_used[name] = close[0]
            return sorted(idx_norm[close[0]])
        unresolved[name] += 1
        return []

    def pick(cands, wclass, fdate, key):
        if key in PINS:
            return PINS[key]
        if len(cands) == 1:
            return cands[0]
        limit = WEIGHT_LIMITS.get(wclass)
        best = None
        for c in cands:
            p = people[c]
            score = abs(p["lbs"] - limit) if (limit and p.get("lbs")) else 30
            if p.get("dob"):
                age = (date.fromisoformat(fdate) - date.fromisoformat(p["dob"])).days / 365.25
                if age < 18 or age > 50:
                    score += 1000
                score += 5 * max(0.0, age - 38) + 5 * max(0.0, 21 - age)
            if best is None or score < best[0]:
                best = (score, c)
        return best[1]

    # ---- per-fight stat totals keyed by event|bout -> listed fighter name
    fstats = defaultdict(lambda: defaultdict(lambda: Counter()))
    # per-round lines keyed by event|bout -> listed fighter name -> round number
    rstats = defaultdict(lambda: defaultdict(dict))
    for r in stats_rows:
        if not r.get("FIGHTER"):
            continue
        k = r["EVENT"] + "|" + r["BOUT"]
        c = fstats[k][r["FIGHTER"]]
        sl, sa = x_of_y(r["SIG.STR."])
        tl, ta = x_of_y(r["TD"])
        c["sl"] += sl; c["sa"] += sa; c["tdl"] += tl; c["tda"] += ta
        c["kd"] += to_int(r["KD"]); c["sub"] += to_int(r["SUB.ATT"]); c["ctrl"] += mmss(r["CTRL"])
        c["rounds"] += 1
        rn = re.match(r"Round (\d+)", r.get("ROUND") or "")
        if rn:
            head_l, _ = x_of_y(r["HEAD"])
            ground_l, _ = x_of_y(r["GROUND"])
            tot_l, _ = x_of_y(r["TOTAL STR."])
            rstats[k][r["FIGHTER"]][int(rn.group(1))] = [
                to_int(r["KD"]), sl, sa, head_l, ground_l, tot_l, tl, ta,
                to_int(r["SUB.ATT"]), to_int(r["REV."]), mmss(r["CTRL"])]

    # ---- fights
    seen_urls, fights, dup_log = set(), [], []
    for r in results:
        if r["URL"] in seen_urls:
            continue
        seen_urls.add(r["URL"])
        ev = events.get(r["EVENT"])
        if ev:
            fdate = parse_date(ev["DATE"])
        elif r["EVENT"] in EVENT_DATES:
            fdate = EVENT_DATES[r["EVENT"]][0]
        else:
            log("event missing (fight skipped):", r["EVENT"], r["BOUT"]); continue
        names = [x.strip() for x in r["BOUT"].split(" vs. ")]
        if len(names) != 2:
            log("bad bout:", r["BOUT"]); continue
        wraw = r["WEIGHTCLASS"]
        wc = weight_class(wraw)
        ids = []
        for n in names:
            cands = candidates(n)
            if not cands:
                ids.append(None); continue
            chosen = pick(cands, wc, fdate, (r["EVENT"], r["BOUT"], n))
            if len(cands) > 1:
                dup_log.append((fdate, r["EVENT"], n, wc, chosen, cands))
            ids.append(chosen)
        outcome = r["OUTCOME"].split("/")
        rnd = to_int(r["ROUND"])
        secs = fight_seconds(r["TIME FORMAT"], rnd, r["TIME"])
        st = fstats.get(r["EVENT"] + "|" + r["BOUT"])
        lines = [None, None]
        rlines = [None, None]
        rs = rstats.get(r["EVENT"] + "|" + r["BOUT"], {})
        if st:
            listed = list(st.keys())
            for side, n in enumerate(names):
                if n in st:
                    lines[side] = st[n]
                    rlines[side] = rs.get(n)
            if None in lines and len(listed) == 2:  # fall back to listing order
                lines = [st[listed[0]], st[listed[1]]]
                rlines = [rs.get(listed[0]), rs.get(listed[1])]
        fights.append({
            "fightId": fid(r["URL"]), "date": fdate, "event": r["EVENT"], "names": names, "ids": ids,
            "outcome": outcome, "method": normalize_method(r["METHOD"], r["DETAILS"]),
            "round": rnd, "time": r["TIME"], "sec": secs, "weightClass": wc, "title": is_title(wraw),
            "lines": lines, "rlines": rlines,
        })
    fights.sort(key=lambda f: (f["date"], f["fightId"]))
    as_of = max(f["date"] for f in fights)

    # ---- group fights by fighter
    by_fighter = defaultdict(list)
    for f in fights:
        for side in (0, 1):
            if f["ids"][side]:
                by_fighter[f["ids"][side]].append((f, side))

    roster_ids = sorted(i for i, fl in by_fighter.items() if any(f["date"] >= SCOPE_FROM for f, _ in fl))

    # ---- slugs (earliest UFC debut keeps the base slug; later namesakes get -2, -3 ...)
    def display_name(i):
        f, side = by_fighter[i][-1]
        return f["names"][side] or people[i].get("fdName")

    order = sorted(roster_ids, key=lambda i: (by_fighter[i][0][0]["date"], i))
    slug_of, used = {}, Counter()
    for i in order:
        base = slugify(display_name(i))
        used[base] += 1
        slug_of[i] = base if used[base] == 1 else f"{base}-{used[base]}"

    # ---- seed merge (country, pro record, missing tale-of-tape)
    seed_match = {}
    seed_fighters = {}
    if os.path.exists(SEED):
        with open(SEED, encoding="utf-8") as fh:
            seed_fighters = json.load(fh).get("fighters", {})
    roster_by_norm = defaultdict(list)
    for i in roster_ids:
        roster_by_norm[norm_key(display_name(i))].append(i)
        if people[i].get("fdName"):
            roster_by_norm[norm_key(people[i]["fdName"])].append(i)
    for sf in seed_fighters.values():
        c = sorted(set(roster_by_norm.get(norm_key(sf.get("name", "")), [])))
        if len(c) != 1:
            continue
        ufc_dates = {h.get("date") for h in sf.get("history", []) if h.get("promotion") == "UFC"}
        mine = {f["date"] for f, _ in by_fighter[c[0]]}
        if ufc_dates & mine:
            seed_match[c[0]] = sf

    def seed_record(i, sf):
        rec = sf.get("record")
        m = re.match(r"^(\d+)-(\d+)-(\d+)", rec or "")
        if not m:
            return None
        w, l, d = map(int, m.groups())
        known = [h.get("date") for h in sf.get("history", []) if h.get("date")]
        latest = max(known) if known else None
        if not latest:
            return None
        # add UFC results newer than anything the seed profile knows about
        for f, side in by_fighter[i]:
            if f["date"] > latest:
                res = f["outcome"][side]
                w += res == "W"; l += res == "L"; d += res == "D"
        return f"{w}-{l}-{d}"

    # ---- assemble fighters
    out = []
    dups_in_roster = []
    for i in sorted(roster_ids, key=lambda x: slug_of[x]):
        p = people.get(i, {"id": i})
        fl = by_fighter[i]
        hist, agg = [], Counter()
        wld = Counter()
        for f, side in reversed(fl):
            o = 1 - side
            res = f["outcome"][side]
            wld[res] += 1
            row = {
                "date": f["date"], "event": f["event"], "opponent": f["names"][o],
                "opponentSlug": slug_of.get(f["ids"][o]),
                "result": res, "method": f["method"], "round": f["round"], "time": f["time"],
                "weightClass": f["weightClass"], "title": f["title"], "fightId": f["fightId"],
            }
            me, op = f["lines"][side], f["lines"][o]
            if me is not None and op is not None:
                s = {"sl": me["sl"], "sa": me["sa"], "osl": op["sl"], "osa": op["sa"],
                     "tdl": me["tdl"], "tda": me["tda"], "otdl": op["tdl"], "otda": op["tda"],
                     "sub": me["sub"], "osub": op["sub"], "kd": me["kd"], "okd": op["kd"],
                     "ctrl": me["ctrl"], "octrl": op["ctrl"], "sec": f["sec"]}
                row["s"] = s
                for k, v in s.items():
                    agg[k] += v
                agg["n"] += 1
            hist.append(row)
        mins = agg["sec"] / 60
        stats = None
        if agg["n"]:
            stats = {
                "slpm": rate(agg["sl"], mins), "sapm": rate(agg["osl"], mins),
                "strAcc": pct(agg["sl"], agg["sa"]),
                "strDef": pct(agg["osa"] - agg["osl"], agg["osa"]),
                "tdPer15": rate(agg["tdl"], mins, 15), "tdAcc": pct(agg["tdl"], agg["tda"]),
                "tdDef": pct(agg["otda"] - agg["otdl"], agg["otda"]),
                "subPer15": rate(agg["sub"], mins, 15), "kdPer15": rate(agg["kd"], mins, 15),
                "ctrlPer15": round(agg["ctrl"] / mins * 15) if mins > 0 else None,
                "minutes": round(mins, 1), "fights": agg["n"],
            }
        # most recent bout at a real division (skip catch/open weight when possible)
        wclass = next((h["weightClass"] for h in hist if h["weightClass"] not in ("Catchweight", "Openweight")),
                      hist[0]["weightClass"])
        ufc_rec = f"{wld['W']}-{wld['L']}-{wld['D']}" + (f" ({wld['NC']} NC)" if wld["NC"] else "")
        sf = seed_match.get(i)
        height, reach, stance, dob = p.get("heightIn"), p.get("reachIn"), p.get("stance"), p.get("dob")
        country = pro = None
        if sf:
            country = sf.get("country") or None
            pro = seed_record(i, sf)
            if height is None and isinstance(sf.get("height"), (int, float)):
                height = round(sf["height"] / 2.54)
            if reach is None and isinstance(sf.get("reach"), (int, float)):
                reach = round(sf["reach"] / 2.54)
            if stance is None and sf.get("stance"):
                stance = sf["stance"]
            if dob is None and sf.get("birthDate"):
                dob = sf["birthDate"]
        name = display_name(i)
        if name != (p.get("fdName") or name) and norm_key(name) != norm_key(p.get("fdName") or ""):
            dups_in_roster.append((i, name, p.get("fdName")))
        out.append({
            "slug": slug_of[i], "name": name, "nickname": p.get("nickname"), "ufcstatsId": i,
            "dob": dob, "heightIn": height, "reachIn": reach, "stance": stance,
            "weightClass": wclass, "country": country, "proRecord": pro, "ufcRecord": ufc_rec,
            "lastFight": hist[0]["date"], "history": hist, "stats": stats,
        })

    # ---- write
    os.makedirs(OUT_DIR, exist_ok=True)
    payload = {"asOf": as_of, "source": SOURCE, "scopeFrom": SCOPE_FROM, "count": len(out), "fighters": out}
    blob = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    for fn in os.listdir(OUT_DIR):
        if re.match(r"roster(-\d+|-index)?\.json$", fn):
            os.remove(os.path.join(OUT_DIR, fn))
    if len(blob.encode()) <= MAX_BYTES:
        with open(os.path.join(OUT_DIR, "roster.json"), "w", encoding="utf-8") as fh:
            fh.write(blob)
    else:
        parts, cur, size = [], [], 0
        for f in out:
            b = len(json.dumps(f, ensure_ascii=False, separators=(",", ":")).encode())
            if cur and size + b > MAX_BYTES - 2000:
                parts.append(cur); cur, size = [], 0
            cur.append(f); size += b
        parts.append(cur)
        index = {"asOf": as_of, "source": SOURCE, "scopeFrom": SCOPE_FROM, "count": len(out), "parts": []}
        for n, part in enumerate(parts, 1):
            fn = f"roster-{n}.json"
            with open(os.path.join(OUT_DIR, fn), "w", encoding="utf-8") as fh:
                json.dump({"asOf": as_of, "source": SOURCE, "fighters": part}, fh,
                          ensure_ascii=False, separators=(",", ":"))
            index["parts"].append({"file": fn, "first": part[0]["slug"], "last": part[-1]["slug"], "count": len(part)})
        with open(os.path.join(OUT_DIR, "roster-index.json"), "w", encoding="utf-8") as fh:
            json.dump(index, fh, ensure_ascii=False, separators=(",", ":"))
    names = [[f["slug"], f["name"], f["nickname"], f["weightClass"], int(f["lastFight"][:4]), f["ufcRecord"]] for f in out]
    with open(os.path.join(OUT_DIR, "names.json"), "w", encoding="utf-8") as fh:
        json.dump(names, fh, ensure_ascii=False, separators=(",", ":"))

    # ---- per-round lines (engine v1.3 round features): one entry per roster bout,
    # {fightId: [slugOfSideA, roundsA, roundsB]}; each rounds list is ordered R1..Rn and
    # each line follows ROUND_FIELDS. Only bouts where both sides have every round.
    roster_set = set(roster_ids)
    rounds_out = {}
    for f in fights:
        if not any(i in roster_set for i in f["ids"] if i):
            continue
        ra, rb = f["rlines"]
        if not ra or not rb or not f["round"]:
            continue
        n = f["round"]
        if any(k not in ra or k not in rb for k in range(1, n + 1)):
            continue
        a_slug = slug_of.get(f["ids"][0]) or slug_of.get(f["ids"][1])
        a_first = slug_of.get(f["ids"][0]) is not None
        sa_, sb_ = ([ra[k] for k in range(1, n + 1)], [rb[k] for k in range(1, n + 1)])
        rounds_out[f["fightId"]] = [a_slug, sa_, sb_] if a_first else [a_slug, sb_, sa_]
    rounds_doc = {"asOf": as_of, "source": "UFCStats round-by-round via github.com/Greco1899/scrape_ufc_stats",
                  "fields": ROUND_FIELDS, "fights": rounds_out}
    with open(os.path.join(OUT_DIR, "rounds.json"), "w", encoding="utf-8") as fh:
        json.dump(rounds_doc, fh, ensure_ascii=False, separators=(",", ":"))

    # ---- report
    log(f"asOf {as_of}; fights {len(fights)}; roster {len(out)}; per-round bouts {len(rounds_out)}")
    log(f"unresolved bout names: {dict(unresolved)}")
    log(f"fuzzy name matches: {fuzzy_used}")
    log(f"tott rows ignored (name mismatch with fighter page): {tott_suspect}")
    log("duplicate-name resolutions (date, event, name, class, chosen, candidates):")
    for d in dup_log:
        log("   ", d)
    log(f"seed merges: {len(seed_match)}")
    fields = ["nickname", "dob", "heightIn", "reachIn", "stance", "country", "proRecord", "stats"]
    cov = {k: round(100 * sum(1 for f in out if f.get(k) is not None) / len(out), 1) for k in fields}
    log(f"coverage %: {cov}")
    slugs = [f["slug"] for f in out]
    assert len(slugs) == len(set(slugs)), "duplicate slugs"


if __name__ == "__main__":
    main()
