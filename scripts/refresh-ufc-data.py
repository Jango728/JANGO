#!/usr/bin/env python3
"""Refresh the active UFC cards and ESPN-backed fighter profiles.

The script intentionally excludes odds and editorial predictions. It keeps
completed UFC/DWCS cards for the audit view, removes promotions outside the
current product scope, and rebuilds upcoming cards from ESPN's event feed.
"""
from __future__ import annotations

import concurrent.futures
import datetime as dt
import json
import re
import time
import unicodedata
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "lib" / "seed.json"
PORTRAITS = ROOT / "public" / "fighters"
CHECKED = "2026-09-23"
ACTIVE_EVENT_IDS = ("600061266", "600061182", "600061267", "600060739", "600060740", "600060741")
REMOVED_PROMOTIONS = {"RIZIN", "K-1", "OKTAGON", "ONE"}
SHERDOG_FALLBACKS = {
    "ilimbek-akylbek-uulu": "https://www.sherdog.com/fighter/Ilimbek-Akylbek-Uulu-388255",
    "lucas-armand": "https://www.sherdog.com/fighter/Lucas-Armand-420549",
    "mehemmedeli-osmanli": "https://www.sherdog.com/fighter/Mehemmedali-Osmanli-390629",
    "melissa-amaya": "https://www.sherdog.com/fighter/Melissa-Amaya-393892",
    "roberto-soldic": "https://www.sherdog.com/fighter/Roberto-Soldic-180781",
}
SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard"
PROFILE = "https://site.web.api.espn.com/apis/common/v3/sports/mma/ufc/athletes/{}"


def get_json(url: str, attempts: int = 2) -> dict:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "JangoPlayz/1.0"})
            with urllib.request.urlopen(req, timeout=15) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if 400 <= exc.code < 500:
                raise
            last = exc
        except Exception as exc:
            last = exc
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"Unable to read {url}: {last}")


def slug(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def cm(value: str | None) -> float | None:
    if not value:
        return None
    feet = re.search(r"(\d+)'\s*(\d+)", value)
    if feet:
        return round((int(feet.group(1)) * 12 + int(feet.group(2))) * 2.54, 2)
    inches = re.search(r"([\d.]+)\s*\"", value)
    return round(float(inches.group(1)) * 2.54, 2) if inches else None


def current_record(comp: dict) -> str | None:
    for row in comp.get("records", []):
        if row.get("type") == "total":
            return row.get("summary")
    return None


def before_record(post: str | None, fighter_result: str) -> str | None:
    if not post or not re.fullmatch(r"\d+-\d+(?:-\d+)?", post):
        return None
    bits = [int(x) for x in post.split("-")]
    while len(bits) < 3:
        bits.append(0)
    # The opponent's post-fight record gained the inverse of this result.
    index = {"W": 1, "L": 0, "D": 2}.get(fighter_result)
    if index is not None and bits[index] > 0:
        bits[index] -= 1
    return "-".join(str(x) for x in bits)


annual = get_json(f"{SCOREBOARD}?dates=2026&limit=100")
annual_events = {e["id"]: e for e in annual.get("events", [])}
events = [annual_events[event_id] for event_id in ACTIVE_EVENT_IDS]
profile_ids = {
    c["id"]
    for event in events
    for bout in event.get("competitions", [])
    for c in bout.get("competitors", [])
    if c.get("athlete", {}).get("displayName") not in {"TBA", "Opponent TBA"}
}


print(f"Loading {len(profile_ids)} fighter profiles...", flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    futures = {pool.submit(get_json, PROFILE.format(pid)): pid for pid in profile_ids}
    profiles = {futures[f]: f.result() for f in concurrent.futures.as_completed(futures)}


scoreboards: dict[str, dict] = {}
# Annual boards are far faster and more stable than one request per fight date.
# They also let us count an opponent's prior UFC appearances without reading
# that opponent's current profile.
history_years = {
    data["eventsMap"][key]["gameDate"][:4]
    for data in profiles.values()
    for key in data.get("events", [])[:12]
    if key in data.get("eventsMap", {}) and data["eventsMap"][key].get("gameDate", "")[:10] < CHECKED
}
print(f"Loading {len(history_years)} annual history boards...", flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    futures = {pool.submit(get_json, f"{SCOREBOARD}?dates={year}&limit=200"): year for year in history_years}
    scoreboards = {futures[f]: f.result() for f in concurrent.futures.as_completed(futures)}


def event_competition(event_id: str, athlete_id: str) -> dict | None:
    for board in scoreboards.values():
        for event in board.get("events", []):
            if event.get("id") != event_id:
                continue
            for bout in event.get("competitions", []):
                if any(c.get("id") == athlete_id for c in bout.get("competitors", [])):
                    return bout
    return None


def prior_ufc_bouts(athlete_id: str, date: str) -> int:
    return sum(
        1
        for board in scoreboards.values()
        for event in board.get("events", [])
        if event.get("name", "").startswith("UFC ") or "Contender Series" in event.get("name", "")
        if event.get("date", "")[:10] < date
        for bout in event.get("competitions", [])
        if any(c.get("id") == athlete_id for c in bout.get("competitors", []))
    )


def promotion(name: str) -> str:
    if "Contender Series" in name:
        return "DWCS"
    if name.startswith("UFC "):
        return "UFC"
    for label in ("PFL", "Bellator", "Eagle FC", "Road to UFC", "LFA", "ACA"):
        if label.lower() in name.lower():
            return label
    return "Regional"


def make_fighter(pid: str, record: str | None) -> dict:
    data = profiles[pid]
    athlete = data["athlete"]
    rows = []
    for key in data.get("events", []):
        item = data.get("eventsMap", {}).get(key)
        if not item or item.get("gameDate", "")[:10] >= CHECKED or not item.get("opponent"):
            continue
        result = item.get("gameResult")
        method = item.get("status", {}).get("result", {}).get("displayName", "Method not listed")
        if "no contest" in method.lower():
            result = "NC"
        if result not in {"W", "L", "D", "NC"}:
            continue
        event_id = item["id"]
        bout = event_competition(event_id, pid)
        opponent_id = str(item["opponent"].get("id", ""))
        opponent_comp = next((c for c in (bout or {}).get("competitors", []) if c.get("id") == opponent_id), {})
        status = item.get("status", {})
        clock = status.get("displayClock")
        round_no = status.get("period")
        minutes = None
        if round_no and clock and re.fullmatch(r"\d+:\d{2}", clock):
            minute, second = map(int, clock.split(":"))
            minutes = round((round_no - 1) * 5 + minute + second / 60, 3)
        opponent_prior = prior_ufc_bouts(opponent_id, item["gameDate"][:10])
        rows.append({
            "opponent": item["opponent"]["displayName"],
            "date": item["gameDate"][:10],
            "result": result,
            "promotion": promotion(item["name"]),
            "eventName": item["name"],
            "method": method,
            "round": round_no,
            "time": clock,
            "minutes": minutes,
            "rules": "MMA",
            "division": (bout or {}).get("type", {}).get("abbreviation"),
            "opponentRecord": before_record(current_record(opponent_comp), result),
            "opponentRecordBasis": "reconstructed",
            "opponentPromotionBouts": opponent_prior,
            "source": f"https://www.espn.com/mma/fightcenter/_/id/{event_id}/league/ufc",
            "opponentSource": next((x.get("href") for x in item["opponent"].get("links", []) if "playercard" in x.get("rel", [])), None),
        })
    rows.sort(key=lambda row: row["date"], reverse=True)
    profile_url = next((x.get("href") for x in athlete.get("links", []) if "playercard" in x.get("rel", [])), PROFILE.format(pid))
    country = athlete.get("flag", {}).get("alt") or athlete.get("citizenship")
    image = None
    headshot = athlete.get("headshot", {}).get("href")
    if headshot:
        target = PORTRAITS / f"espn-{pid}.png"
        if not target.exists():
            try:
                req = urllib.request.Request(headshot, headers={"User-Agent": "JangoPlayz/1.0"})
                target.write_bytes(urllib.request.urlopen(req, timeout=30).read())
            except Exception:
                pass
        if target.exists():
            image = f"/fighters/{target.name}"
    fighter_slug = slug(athlete["displayName"])
    if not image and fighter_slug in SHERDOG_FALLBACKS:
        fallback = PORTRAITS / f"sherdog-{fighter_slug}.jpg"
        if fallback.exists():
            image = f"/fighters/{fallback.name}"
            headshot = SHERDOG_FALLBACKS[fighter_slug]
    return {
        "id": fighter_slug,
        "name": athlete["displayName"],
        "nickname": athlete.get("nickname"),
        "record": record or next((x.get("displayValue") for x in athlete.get("statsSummary", {}).get("statistics", []) if x.get("type") == "wins-losses-draws"), None),
        "recordScope": "Overall record from ESPN; loaded history includes ESPN-listed MMA bouts with the organization identified from the event name.",
        "height": cm(athlete.get("displayHeight")),
        "reach": cm(athlete.get("displayReach")),
        "age": athlete.get("age"),
        "stance": athlete.get("stance", {}).get("text"),
        "style": athlete.get("displayFightingStyle"),
        "country": country,
        "image": image,
        "imageDate": CHECKED,
        "imageSource": headshot,
        "profile": profile_url,
        "history": rows,
        "historyComplete": False,
        "ufcHistoryComplete": True,
        "historySource": profile_url,
        "historyChecked": CHECKED,
        "sources": [{"label": "ESPN athlete profile and UFC fight history", "url": profile_url, "checked": CHECKED}],
        "recordNote": "Profile facts and ESPN-listed MMA history refreshed on September 23, 2026. Regional history may be incomplete.",
    }


records = {}
for event in events:
    for bout in event.get("competitions", []):
        for comp in bout.get("competitors", []):
            records[comp["id"]] = current_record(comp)

new_fighters = {}
for pid in sorted(profile_ids):
    fighter = make_fighter(pid, records.get(pid))
    new_fighters[fighter["id"]] = fighter


def make_event(event: dict) -> dict:
    event_id = event["id"]
    venue = event.get("competitions", [{}])[0].get("venue", {})
    address = venue.get("address", {})
    fights = []
    bouts = list(reversed(event.get("competitions", [])))
    starts = sorted({bout.get("date") for bout in bouts if bout.get("date")})
    def card_section(bout: dict) -> str:
        start = bout.get("date")
        if not start or len(starts) <= 1:
            return "Main Card"
        distance_from_main = len(starts) - 1 - starts.index(start)
        return "Main Card" if distance_from_main == 0 else "Prelims" if distance_from_main == 1 else "Early Prelims"
    for bout in bouts:
        comps = sorted(bout.get("competitors", []), key=lambda x: x.get("order", 99))
        if len(comps) != 2:
            continue
        a, b = (slug(c["athlete"]["displayName"]) for c in comps)
        if any(name in {"tba", "opponent-tba"} for name in (a, b)):
            continue
        rounds = bout.get("format", {}).get("regulation", {}).get("periods", 3)
        division = bout.get("type", {}).get("abbreviation", "Division pending").replace("W ", "Women's ")
        fights.append({
            "id": f"espn-{bout['id']}-{a}-{b}", "a": a, "b": b,
            "division": division, "rules": "MMA", "rounds": rounds,
            "section": card_section(bout), "assessments": {},
            "notes": ["Bout order, division and scheduled rounds refreshed from ESPN on September 23, 2026."],
            "unknowns": ["Current camp condition and short-notice status require separate dated evidence."],
        })
    city = ", ".join(x for x in [address.get("city"), address.get("state") or address.get("country")] if x)
    card_url = next((x.get("href") for x in event.get("links", []) if "summary" in x.get("rel", [])), "https://www.espn.com/mma/schedule/_/league/ufc")
    event_key = {"600061266": "ufc-fn-289", "600061182": "ufc332", "600061267": "ufc333", "600060739": "dwcs-2026-week8", "600060740": "dwcs-2026-week9", "600060741": "dwcs-2026-week10"}[event_id]
    promotion = "DWCS" if event_id.startswith("6000607") else "UFC"
    return {
        "id": event_key,
        "title": event["name"], "promotion": promotion, "date": event["date"][:10],
        "time": "Main card 8pm ET" if promotion == "DWCS" or event_id == "600061182" else "Main card 8pm ET · prelims 5pm ET",
        "location": ", ".join(x for x in [venue.get("fullName"), city] if x),
        "coverage": f"Full announced card · {len(fights)} bouts · refreshed Sep 23",
        "source": {"label": "ESPN live card", "url": card_url, "checked": CHECKED},
        "fights": fights,
    }


seed = json.loads(SEED.read_text())
refreshed_ids = {"ufc-fn-289", "ufc332", "ufc333", "dwcs-2026-week8", "dwcs-2026-week9", "dwcs-2026-week10"}
kept_events = [e for e in seed["events"] if e.get("promotion") not in REMOVED_PROMOTIONS and e.get("id") not in refreshed_ids and e.get("fights")]
seed["events"] = [make_event(event) for event in events] + kept_events
seed["fighters"].update(new_fighters)
referenced = {fighter for event in seed["events"] for fight in event.get("fights", []) for fighter in (fight["a"], fight["b"])}
seed["fighters"] = {key: value for key, value in seed["fighters"].items() if key in referenced}
def omit_none(value):
    if isinstance(value, dict):
        return {key: omit_none(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [omit_none(item) for item in value]
    return value

seed = omit_none(seed)
SEED.write_text(json.dumps(seed, indent=2, ensure_ascii=False) + "\n")
print(f"Refreshed {len(events)} cards, {len(new_fighters)} fighters; retained {len(seed['events'])} cards and {len(seed['fighters'])} fighters.")
