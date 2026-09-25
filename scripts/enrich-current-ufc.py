"""Enrich the two current UFC cards with complete Sherdog pro histories.

This supplements the ESPN card/profile refresh. It never reads odds, rankings, or
editorial picks. Existing measurements, portraits, UFC stats and UFC-only history
flags are preserved.
"""
from __future__ import annotations

import concurrent.futures as cf
import html
import importlib.util
import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parent.parent
CHECKED = "2026-09-23"
EVENT_FILES = {
    "ufc-fn-289": Path("/tmp/UFC-Fight-Night-289-Rosas-Jr-vs-Barcelos-113789.html"),
    "ufc332": Path("/tmp/UFC-332-Silva-vs-Wang-114123.html"),
}
ALIASES = {
    "mehemmedeli-osmanli": "Mehemmedali Osmanli",
    "tina-black": "Valesca Machado",
    "alatengheili": "Heili Alateng",
    "wang-cong": "Cong Wang",
    "khaos-williams": "Kalinn Williams",
    "ateba-gautier": "Ateba Abega Gautier",
    "bernardo-sopaj": "Bernardo Sopai",
}


def load_collector():
    path = ROOT / "scripts" / "collect-history.py"
    spec = importlib.util.spec_from_file_location("history_collector", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    module.CHECKED = CHECKED
    return module


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value))).strip()


def record(rows: list[dict]) -> str:
    return "-".join(str(sum(row.get("result") == result for row in rows)) for result in ("W", "L", "D"))


def event_profiles(collector) -> dict[str, str]:
    profiles: dict[str, str] = {}
    for event_path in EVENT_FILES.values():
        if not event_path.exists():
            raise FileNotFoundError(f"Missing saved Sherdog event page: {event_path}")
        page = event_path.read_text()
        for relative, label in re.findall(r'<a[^>]*href="(/fighter/[^\"]+)"[^>]*>(.*?)</a>', page, re.S):
            name = clean(label)
            if name:
                profiles[collector.norm(name)] = collector.BASE + relative
    return profiles


def main() -> None:
    collector = load_collector()
    seed_path = ROOT / "lib" / "seed.json"
    seed = json.loads(seed_path.read_text())
    urls = event_profiles(collector)
    fighter_ids = sorted(
        {
            fight[side]
            for event in seed["events"]
            if event["id"] in EVENT_FILES
            for fight in event["fights"]
            for side in ("a", "b")
        }
    )

    resolved: dict[str, str] = {}
    missing: list[str] = []
    for fighter_id in fighter_ids:
        fighter = seed["fighters"][fighter_id]
        target = ALIASES.get(fighter_id, fighter["name"])
        url = urls.get(collector.norm(target))
        if url:
            resolved[fighter_id] = url
        else:
            missing.append(fighter_id)
    if missing:
        raise RuntimeError(f"Could not resolve current-card fighters: {', '.join(missing)}")

    profiles: dict[str, dict] = {}
    with cf.ThreadPoolExecutor(max_workers=6) as executor:
        futures = {executor.submit(collector.parse, url): fighter_id for fighter_id, url in resolved.items()}
        for future in cf.as_completed(futures):
            fighter_id = futures[future]
            profile = future.result()
            if not profile:
                raise RuntimeError(f"Could not parse Sherdog profile for {fighter_id}")
            profiles[fighter_id] = profile
            print(f"Profile {fighter_id}: {len(profile['history'])} bouts", flush=True)

    opponent_urls = sorted(
        {
            bout["opponentSource"]
            for profile in profiles.values()
            for bout in profile["history"][:10]
            if bout.get("opponentSource")
        }
    )
    opponent_profiles = {profile["historySource"]: profile for profile in profiles.values()}
    uncached = [url for url in opponent_urls if url not in opponent_profiles]
    with cf.ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(collector.parse, url): url for url in uncached}
        for future in cf.as_completed(futures):
            url = futures[future]
            profile = future.result()
            if profile:
                opponent_profiles[url] = profile

    reconstructed = 0
    for profile in profiles.values():
        for bout in profile["history"]:
            opponent = opponent_profiles.get(bout.get("opponentSource", ""))
            if not opponent or not opponent["historyComplete"]:
                continue
            prior = [row for row in opponent["history"] if row["date"] < bout["date"]]
            bout["opponentRecord"] = record(prior)
            bout["opponentRecordBasis"] = "reconstructed"
            bout["opponentPromotionBouts"] = sum(
                row["promotion"] == bout["promotion"] for row in prior
            )
            if opponent.get("height"):
                bout["opponentCurrentHeight"] = opponent["height"]
                bout["opponentMeasurementsAsOf"] = CHECKED
            reconstructed += 1

    for fighter_id, profile in profiles.items():
        fighter = seed["fighters"][fighter_id]
        # Retain ESPN division labels where the same dated matchup can be matched.
        divisions = {
            (row.get("date"), collector.norm(row.get("opponent", ""))): row.get("division")
            for row in fighter.get("history", [])
            if row.get("division")
        }
        for row in profile["history"]:
            division = divisions.get((row.get("date"), collector.norm(row.get("opponent", ""))))
            if division:
                row["division"] = division

        fighter["history"] = profile["history"]
        fighter["historyComplete"] = profile["historyComplete"]
        fighter["historySource"] = profile["historySource"]
        fighter["historyChecked"] = CHECKED
        if not fighter.get("country") and profile.get("country"):
            fighter["country"] = profile["country"]
        if not fighter.get("height") and profile.get("height"):
            fighter["height"] = profile["height"]
        if not fighter.get("birthDate") and profile.get("birthDate"):
            fighter["birthDate"] = profile["birthDate"]

        listed = (fighter.get("record") or "").removesuffix("-0")
        rebuilt = profile["record"].removesuffix("-0")
        if listed and listed != rebuilt:
            fighter["recordNote"] = (
                f"ESPN lists {fighter['record']}; the complete Sherdog history reconstructs "
                f"to {profile['record']}. Review the discrepancy before relying on the total."
            )
        if profile.get("nc"):
            fighter["recordNote"] = (
                (fighter.get("recordNote") or "")
                + f" {profile['nc']} no contest(s) are kept separate."
            ).strip()

        fighter["sources"] = [
            source for source in fighter.get("sources", []) if source.get("label") != "Sherdog professional fight history"
        ] + [
            {
                "label": "Sherdog professional fight history",
                "url": profile["historySource"],
                "checked": CHECKED,
                "note": "Full professional MMA history; opponent pre-bout records are reconstructed from dated results. Odds and editorial predictions were not collected.",
            }
        ]

    seed_path.write_text(json.dumps(seed, ensure_ascii=False, indent=2) + "\n")
    complete = sum(profile["historyComplete"] for profile in profiles.values())
    print(
        f"Enriched {len(profiles)} fighters ({complete} complete); "
        f"reconstructed {reconstructed} opponent pre-bout records.",
        flush=True,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        raise
