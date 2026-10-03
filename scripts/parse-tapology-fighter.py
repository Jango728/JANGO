#!/usr/bin/env python3
"""Parse a Firecrawl scrape of a Tapology fighter page (JSON with `markdown` + `metadata`) into the research
shape used by the card-adding scripts (see data/research/oktagon94-part*.json).

  python3 scripts/parse-tapology-fighter.py <scrape.json> [...]        # prints a summary, writes <scrape>.parsed.json
  python3 scripts/parse-tapology-fighter.py --out DIR <scrape.json>... # writes DIR/<tapology-slug>.json

Scrape with formats ["markdown", "rawHtml"]: the raw HTML is what gets parsed (it carries pro/amateur and sport flags per bout);
markdown-only scrapes fall back to a weaker text parser. Every bout row on the page is kept (pro MMA, amateur, other rule sets, cancelled, upcoming) with a `kind`, and the
pro-MMA W-L-D count is checked against the page's stated "Pro MMA Record". `check.ok` false = look at the page by hand.
Standard library only.
"""
import json, re, sys, os
import html as htmlmod

MONTHS = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}
RES = {"W": "W", "L": "L", "D": "D", "NC": "NC", "N": "NC"}
FLAG = re.compile(r"assets/flags/([A-Z]{2})-")
LINK = re.compile(r"\[([^\]]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
COUNTRY = {"RU": "Russia", "BR": "Brazil", "BY": "Belarus", "GE": "Georgia", "US": "United States", "KZ": "Kazakhstan",
           "KG": "Kyrgyzstan", "TJ": "Tajikistan", "UZ": "Uzbekistan", "GB": "United Kingdom", "CL": "Chile", "UA": "Ukraine",
           "AM": "Armenia", "AZ": "Azerbaijan", "ZA": "South Africa", "AR": "Argentina", "MX": "Mexico", "PE": "Peru",
           "FR": "France", "DE": "Germany", "PL": "Poland", "TR": "Turkey", "IR": "Iran", "TM": "Turkmenistan", "MD": "Moldova"}


def clean(s):
    return re.sub(r"\s+", " ", s.replace("\\|", "|").replace("\\_", "_")).strip()


def parse_date(s):
    m = re.match(r"^(\d{4})\s*([A-Z][a-z]{2})\s+(\d{1,2})$", s.strip())
    if not m or m.group(2) not in MONTHS: return None
    return f"{m.group(1)}-{MONTHS[m.group(2)]:02d}-{int(m.group(3)):02d}"


def method_text(short, detail, result):
    short = (short or "").upper()
    detail = clean(re.sub(r"\s*·?\s*(\d{1,2}:\d\d\s*·\s*)?R\d\s*$", "", detail or ""))
    if detail in ("Win", "Loss", "Draw", "Result Unknown"): detail = ""
    d = re.sub(r"^(Decision|Submission|KO/TKO|TKO|KO)\s*·?\s*", "", detail).strip()
    if result == "NC": return f"No Contest ({detail})" if detail else "No Contest"
    if result == "D": return f"Draw ({d})" if d else "Draw"
    if short in ("TKO", "KO", "KO/TKO"): return f"KO/TKO ({d})" if d else "KO/TKO"
    if short == "SUB": return f"Submission ({d})" if d and d.lower() != "submission" else "Submission"
    if short == "DEC": return f"Decision ({d})" if d else "Decision"
    if short == "DQ": return f"DQ ({d})" if d else "DQ"
    return detail or short or "Method not listed"


def _textify(chunk):
    chunk = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", chunk, flags=re.S)
    chunk = re.sub(r'<a [^>]*href="([^"]*)"[^>]*>(.*?)</a>',
                   lambda m: "[[" + re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(2))).strip() + "|" + m.group(1) + "]]", chunk, flags=re.S)
    chunk = re.sub(r'<img [^>]*alt="([^"]*)"[^>]*>', r"\n{{\1}}\n", chunk)
    chunk = re.sub(r"<[^>]+>", "\n", chunk)
    return [htmlmod.unescape(l).strip() for l in chunk.split("\n") if l.strip()]


TOK = re.compile(r"^\[\[(.*)\|([^|\]]+)\]\]$")
STATUS = {"win": "W", "loss": "L", "draw": "D", "no_contest": "NC", "nc": "NC", "no contest": "NC"}


def html_rows(raw):
    """One row per <div … data-bout-id …> in the fighter-record list of the raw HTML."""
    starts = [(m.start(), m.group(0)) for m in re.finditer(r"<div[^>]*data-bout-id=\"\d+\"[^>]*>", raw)]
    rows = []
    for i, (pos, tag) in enumerate(starts):
        chunk = raw[pos:starts[i + 1][0] if i + 1 < len(starts) else pos + 30000]
        cut = chunk.find("May contain errors and omissions")
        if cut > 0: chunk = chunk[:cut]
        ga = lambda k: (re.search(k + r'="([^"]*)"', tag) or [None, None])[1]
        at = {"id": ga("data-bout-id"), "division": ga("data-division"), "sport": ga("data-sport"), "status": ga("data-status")}
        L = _textify(chunk)
        links = [(m.group(1), m.group(2)) for l in L for m in [TOK.match(l)] if m]
        opp = next(((t, u) for t, u in links if "/fightcenter/fighters/" in u and t), (None, None))
        head = L[:8]
        body = [l for l in head[1:] if not re.match(r"^[A-Z/]{2,6}$", l)] if head and head[0] in ("W", "L", "D", "NC", "N", "C") else head
        if not opp[0] and body and not TOK.match(body[0]) and not re.match(r"^\d+-\d+", body[0]):
            opp = (body[0], None)  # opponent has no Tapology page: plain-text name
        special = next((l for l in L[:7] if re.search(r"Exhibition|Ineligible", l)), None)
        recs = [m.group(1) for l in L[:8] for m in [re.match(r"^(\d+-\d+(?:-\d+)?)(?:,?\s*\d+\s*NC)?$", l)] if m]
        na = [l for l in L[:8] if l == "N/A"]
        det = next((t for t, u in links if "/fightcenter/bouts/" in u), None)
        bout_url = next((u for t, u in links if "/fightcenter/bouts/" in u), None)
        date = next((parse_date(t) for t, u in links if "/fightcenter/events/" in u and parse_date(t)), None)
        if not date:
            for a_, b_ in zip(L, L[1:]):
                if re.match(r"^\d{4}$", a_) and parse_date(a_ + " " + b_): date = parse_date(a_ + " " + b_); break
        def after(label):
            for j, l in enumerate(L):
                if l == label and j + 1 < len(L):
                    m = TOK.match(L[j + 1]); return (m.group(1), m.group(2)) if m else (L[j + 1], None)
            return (None, None)
        ev, ev_url = after("Event:")
        if not ev: ev, ev_url = after("League:")
        if not ev: ev, ev_url = next(((t, u) for t, u in links if "/fightcenter/events/" in u and not parse_date(t)), (None, None))
        promo = next((m.group(1) for l in L for m in [re.match(r"^\{\{(.+)\}\}$", l)] if m), None)
        promo_slug = next((re.search(r"/promotions/\d+-([a-z0-9-]+)", u).group(1) for t, u in links if re.search(r"/promotions/\d+-([a-z0-9-]+)", u)), None)
        res = STATUS.get((at["status"] or "").lower())
        short = L[1] if len(L) > 1 and L[0] in ("W", "L", "D", "NC", "N") and re.match(r"^[A-Z/]{2,6}$", L[1]) else None
        if not det and res:  # old rows: plain text method ("Win", "Decision · Unanimous", "Armbar · 1:10 · R1")
            det = next((l for l in L[2:8] if not TOK.match(l) and not re.match(r"^\d+-\d+", l) and not l.startswith("{{") and l != opp[0]
                        and l not in ("N/A", "Win", "Loss", "Draw", "warning") and not re.search(r"Exhibition|Ineligible", l) and not re.match(r"^[A-Z/]{2,6}$", l) and not re.match(r"^\d{4}$", l)), None)
            if det and not re.search(r"·|Decision|Choke|Punch|Kick|Knee|Elbow|Armbar|Lock|Stoppage|Submission|KO|Triangle|Slam|Injury|Retire|Guillotine|Kimura|R\d", det): det = None
        rt = next((m for l in ([det or ""] + L[:12]) for m in [re.search(r"(\d{1,2}:\d\d)\s*·\s*R(\d)", l)] if m), None)
        ronly = next((int(m.group(1)) for l in ([det or ""] + L[:12]) for m in [re.search(r"(?:^|·\s*)R(\d)$", l)] if m), None)
        nrounds = next((int(m.group(1)) for l in L for m in [re.match(r"^(\d) Rounds?$", l)] if m), None)
        kind = "pro-mma"
        if at["status"] == "cancelled": kind = "cancelled"
        elif at["status"] == "upcoming": kind = "upcoming"
        elif at["sport"] and at["sport"] != "mma": kind = at["sport"]
        elif at["division"] and at["division"] != "pro": kind = at["division"]
        elif not res: kind = "status-" + str(at["status"])
        elif special: kind = "exhibition" if "Exhibition" in special else "ineligible"
        row = {"kind": kind, "opponent": opp[0], "opponentUrl": opp[1], "date": date, "result": res, "attrs": at,
               "methodShort": short, "detail": clean(det) if det else None, "method": method_text(short, det, res) if res else None,
               "event": clean(ev) if ev else None, "eventUrl": ev_url, "boutUrl": bout_url,
               "promotionAbbr": promo, "promotionSlug": promo_slug,
               "duration": after("Duration:")[0], "weight": after("Weight:")[0], "titleBout": after("Title Bout:")[0],
               "odds": (lambda o: int(re.match(r"^([+-]\d+)", o).group(1)) if o and re.match(r"^([+-]\d+)", o) else None)(after("Odds:")[0]),
               "fighterRecordBefore": recs[0] if recs else None, "opponentRecord": recs[1] if len(recs) > 1 else None}
        if rt: row["time"], row["round"] = rt.group(1), int(rt.group(2))
        elif ronly and short != "DEC": row["round"] = ronly
        elif nrounds and short == "DEC": row["round"], row["time"] = nrounds, "5:00"
        elif nrounds: row["round"] = nrounds
        rows.append(row)
    return rows


def parse(path):
    d = json.load(open(path)); md = d["markdown"]; meta = d.get("metadata", {})
    url = meta.get("sourceURL") or (meta.get("og:url") or [""])[0]
    title = clean(meta.get("title", "")).split(" | ")[0]
    name = re.sub(r"\s*\(\".*?\"\)\s*$", "", title).strip()
    out = {"name": name, "source": url, "tapologySlug": url.rstrip("/").split("/")[-1]}
    g = lambda pat, flags=0: (re.search(pat, md, flags) or [None, None])[1]
    nick = g(r"\*\*Nickname:\*\*\s*([^\n]+)")
    out["nickname"] = None if not nick or nick.strip() in ("N/A", "") else clean(nick)
    rec = re.search(r"\*\*Pro MMA Record:\*\*\s*(\d+)-(\d+)-(\d+)(?:,?\s*(\d+)\s*NC)?", md)
    out["record"] = f"{rec.group(1)}-{rec.group(2)}-{rec.group(3)}" if rec else None
    out["statedNC"] = int(rec.group(4)) if rec and rec.group(4) else 0
    dob = re.search(r"Date of Birth:\*\*\s*(\d{4})\s+([A-Z][a-z]{2})\s+(\d{1,2})", md)
    out["birthDate"] = f"{dob.group(1)}-{MONTHS[dob.group(2)]:02d}-{int(dob.group(3)):02d}" if dob else None
    h = re.search(r"\*\*Height:\*\*\s*(\d)'(\d{1,2})\"\s*\((\d+)cm\)", md)
    out["height_cm"] = int(h.group(3)) if h else None
    out["height_in"] = int(h.group(1)) * 12 + int(h.group(2)) if h else None
    r = re.search(r"Reach:\*\*\s*\n*\s*([\d.]+)\"\s*\((\d+)cm\)", md)
    out["reach_in"] = float(r.group(1)) if r else None
    out["reach_cm"] = int(r.group(2)) if r else None
    out["weightClass"] = clean(g(r"\*\*Weight Class:\*\*\s*([^*\n]+)") or "") or None
    out["lastWeighIn"] = clean(g(r"Last Weigh-In:\*\*\s*\n*\s*([^\n]+)") or "") or None
    out["affiliation"] = clean(re.sub(LINK, r"\1", g(r"\*\*Affiliation:\*\*\s*\n*\s*([^\n]+)") or "")) or None
    if out["affiliation"] == "N/A": out["affiliation"] = None
    out["born"] = clean(g(r"\*\*Born:\*\*\s*\n*\s*([^\n]+)") or "") or None
    out["fightingOutOf"] = clean(g(r"\*\*Fighting out of:\*\*\s*\n*\s*([^\n]+)") or "") or None
    flag = FLAG.search(md[: md.find("Fighter Details")] if "Fighter Details" in md else md[:6000])
    out["flag"] = flag.group(1) if flag else None
    out["country"] = COUNTRY.get(out["flag"]) or (out["born"].split(",")[-1].strip() if out["born"] and out["born"] != "N/A" else None)
    sh = re.search(r"\((https://www\.sherdog\.com/fighter/[^)\s]+)\)", md)
    out["sherdog"] = sh.group(1) if sh else None
    out["image"] = meta.get("og:image")
    out["streak"] = clean(g(r"\*\*Current MMA Streak:\*\*\s*([^\n]+)") or "") or None

    # ---- fight record -------------------------------------------------------------------------------------------
    attrs, attr_list = {}, []
    for m in re.finditer(r"<div[^>]*fighter-record-bout[^>]*>", d.get("rawHtml") or d.get("html") or ""):
        t = m.group(0)
        ga = lambda k: (re.search(k + r'=\"([^\"]*)\"', t) or [None, None])[1]
        a_ = {"id": ga("data-bout-id"), "division": ga("data-division"), "sport": ga("data-sport"), "status": ga("data-status")}
        attr_list.append(a_)
        if a_["id"]: attrs[a_["id"]] = a_
    out["htmlAttrs"] = bool(attr_list)
    a = md.find("MMA Fight Record"); b = md.find("May contain errors and omissions", a)
    sec = md[a:b if b > 0 else None]
    v = sec.find("Cancelled\n"); sec = sec[v + 10:] if v >= 0 else sec
    lines = [l.strip() for l in sec.split("\n") if l.strip()]
    starts = []
    for i, l in enumerate(lines):
        if l in ("W", "L", "D", "NC", "N", "C") and any("/fightcenter/fighters/" in x for x in lines[i + 1:i + 4]):
            starts.append(i)
    blocks = []
    first = starts[0] if starts else len(lines)
    if any("Upcoming Bout" in x for x in lines[:first]): blocks.append(("U", lines[:first]))
    for j, i in enumerate(starts):
        blocks.append((lines[i], lines[i + 1:(starts[j + 1] if j + 1 < len(starts) else len(lines))]))

    # rows in the HTML and blocks in the markdown come in the same order: pair them by position when the counts agree
    positional = len(attr_list) == len(blocks)
    out["rowsHtml"], out["rowsMarkdown"] = len(attr_list), len(blocks)
    hist, other = [], []
    raw_html = d.get("rawHtml") or ""
    if raw_html:
        for row in html_rows(raw_html): (hist if row["kind"] == "pro-mma" else other).append(row)
        blocks = []
    out["parsedFrom"] = "rawHtml" if raw_html else "markdown"
    for bi, (res, bl) in enumerate(blocks):
        txt = "\n".join(bl)
        opp = next(((m.group(1), m.group(2)) for m in LINK.finditer(txt) if "/fightcenter/fighters/" in m.group(2) and m.group(1) and not m.group(1).startswith("!")), (None, None))
        recs = [m.group(1) for l in bl for m in [re.match(r"^(\d+-\d+(?:-\d+)?)(?:,?\s*\d+\s*NC)?(?:\s+\[#.*)?$", l)] if m]
        det = next((m.group(1) for m in LINK.finditer(txt) if "/fightcenter/bouts/" in m.group(2)), "")
        bout_url = next((m.group(2) for m in LINK.finditer(txt) if "/fightcenter/bouts/" in m.group(2)), None)
        ev = re.search(r"Event:\s*\[([^\]]+)\]\(([^)\s]+)", txt)
        date = next((parse_date(m.group(1)) for m in LINK.finditer(txt) if "/fightcenter/events/" in m.group(2) and parse_date(m.group(1))), None)
        if not date:
            date = next((parse_date(l) for l in bl if parse_date(l)), None)
        promo_alt = re.search(r"!\[([^\]]+)\]\(https://images\.tapology\.com/logo_squares/", txt)
        promo_slug = re.search(r"/fightcenter/promotions/\d+-([a-z0-9-]+)", txt)
        dur = re.search(r"Duration:\s*([^\n]+)", txt)
        wt = re.search(r"Weight:\s*([^\n]+)", txt)
        title_bout = re.search(r"Title Bout:\s*([^\n]+)", txt)
        odds = re.search(r"Odds:\s*([+-]\d+)", txt)
        rt = re.search(r"(\d{1,2}:\d\d)\s*·\s*R(\d)", det) or re.search(r"(\d{1,2}:\d\d)\s*·\s*R(\d)", txt)
        nrounds = next((int(m.group(1)) for l in bl for m in [re.match(r"^(\d) Rounds?$", l)] if m), None)
        short = bl[0] if bl and re.match(r"^[A-Z/]{2,6}$", bl[0]) else None
        flags = " ".join(bl)
        kind = "pro-mma"
        if res == "C": kind = "cancelled"
        elif res == "U": kind = "upcoming"
        bid = re.search(r"/bouts/(\d+)-", bout_url or "")
        at = attrs.get(bid.group(1)) if bid else None
        if not at and positional: at = attr_list[bi]
        if at and kind == "pro-mma":
            if at["sport"] and at["sport"] != "mma": kind = at["sport"]
            elif at["division"] and at["division"] != "pro": kind = at["division"]
        elif attrs and not at and kind == "pro-mma": kind = "unmatched"
        if not attr_list and any(re.match(r"^(Grappling|Boxing|Kickboxing|Muay Thai|Amateur|Exhibition|Custom|Sambo|Pankration|Lethwei|Bare Knuckle)", l) for l in bl[:4]) and kind == "pro-mma":
            kind = re.match(r"^[A-Za-z ]+?(?=[A-Z]|$)", next(l for l in bl[:4] if re.match(r"^(Grappling|Boxing|Kickboxing|Muay Thai|Amateur|Exhibition|Custom|Sambo|Pankration|Lethwei|Bare Knuckle)", l))).group(0).strip().lower() or "other"
        if re.search(r"\bAmateur\b", flags): kind = "amateur" if kind == "pro-mma" else kind
        for kw, k in (("Exhibition", "exhibition"), ("Boxing", "boxing"), ("Kickboxing", "kickboxing"), ("Grappling", "grappling"),
                      ("Muay Thai", "muay-thai"), ("Custom Rules", "custom"), ("Combat Sambo", "sambo"), ("Pankration", "pankration"),
                      ("Bare Knuckle", "bare-knuckle"), ("Combat Jiu-Jitsu", "grappling"), ("Lethwei", "lethwei")):
            if not attr_list and kind == "pro-mma" and re.search(r"(?<![A-Za-z])" + kw + r"(?![A-Za-z])", re.sub(LINK, "", txt)):
                kind = k
        if at and at.get("status") in ("win", "loss", "draw") and RES.get(res) != {"win": "W", "loss": "L", "draw": "D"}[at["status"]]: kind = "status-mismatch"
        row = {"kind": kind, "opponent": opp[0], "opponentUrl": opp[1], "date": date,
               "result": RES.get(res), "attrs": at, "methodShort": short, "detail": clean(det) if det else None,
               "method": method_text(short, det, RES.get(res)) if res in RES else None,
               "event": clean(ev.group(1)) if ev else None, "eventUrl": ev.group(2) if ev else None, "boutUrl": bout_url,
               "promotionAbbr": promo_alt.group(1) if promo_alt else None, "promotionSlug": promo_slug.group(1) if promo_slug else None,
               "duration": clean(dur.group(1)) if dur else None, "weight": clean(wt.group(1)) if wt else None,
               "titleBout": clean(title_bout.group(1)) if title_bout else None, "odds": int(odds.group(1)) if odds else None,
               "fighterRecordBefore": recs[0] if len(recs) > 0 else None, "opponentRecord": recs[1] if len(recs) > 1 else None}
        if rt: row["time"], row["round"] = rt.group(1), int(rt.group(2))
        elif nrounds and short == "DEC": row["round"], row["time"] = nrounds, "5:00"
        elif nrounds: row["round"] = nrounds
        (hist if kind == "pro-mma" else other).append(row)

    hist.sort(key=lambda x: x["date"] or "", reverse=True)
    out["history"] = hist; out["otherBouts"] = other
    w = sum(1 for x in hist if x["result"] == "W"); l = sum(1 for x in hist if x["result"] == "L")
    dr = sum(1 for x in hist if x["result"] == "D"); nc = sum(1 for x in hist if x["result"] == "NC")
    counted = f"{w}-{l}-{dr}"
    problems = []
    if counted != out["record"]: problems.append(f"counted pro record {counted} != stated {out['record']}")
    for x in hist:
        if not x["date"]: problems.append(f"no date: vs {x['opponent']}")
        if not x["opponent"]: problems.append(f"no opponent on {x['date']}")
        if not x["opponentRecord"]: problems.append(f"no opponent record: vs {x['opponent']} {x['date']}")
        if x["result"] in ("W", "L") and not x["methodShort"]: problems.append(f"no method: vs {x['opponent']} {x['date']}")
    out["check"] = {"ok": not problems, "counted": counted, "nc": nc, "rows": len(hist), "other": len(other), "problems": problems}
    return out


if __name__ == "__main__":
    args = sys.argv[1:]; outdir = None
    if args and args[0] == "--out": outdir = args[1]; args = args[2:]
    for p in args:
        try: o = parse(p)
        except Exception as e:
            print(f"FAIL {p}: {e!r}"); continue
        dest = os.path.join(outdir, o["tapologySlug"] + ".json") if outdir else p + ".parsed.json"
        if outdir: os.makedirs(outdir, exist_ok=True)
        json.dump(o, open(dest, "w"), ensure_ascii=False, indent=1)
        c = o["check"]
        print(f"{'OK  ' if c['ok'] else 'CHECK'} {o['name']:28} rec {o['record']} counted {c['counted']} nc {c['nc']} rows {c['rows']} other {c['other']} "
              f"dob {o['birthDate']} ht {o['height_cm']} rch {o['reach_cm']} {o['country']} -> {dest}")
        for pr in c["problems"][:8]: print("      -", pr)
