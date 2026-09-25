import { ENGINE_VERSION } from "@/lib/engine";
import { ROUNDS_MODEL_VERSION } from "@/lib/rounds";
import { ledgers, performance } from "@/lib/ledger";

const CHANGELOG = [
  {
    version: "1.1 · Sep 25, 2026",
    items: [
      "Projected finish rebuilt from scratch: a pre-rendered broadcast-style clip for every KO, submission and decision. It has a full arena with lights and a crowd (beers included), a sponsor canvas, 4oz gloves, motion-captured movement, slow-motion impact, and name tags that follow each fighter. It plays once, then a small Replay appears.",
      "KO: a real exchange (slip, counter hook) and the knockout. The ref waves it off, and it ends on the loser's view of the winner standing over him with double middle fingers. Submission: rear-naked choke, tap, the ref pulls him off, then the clown face. Decision: the ref raises the hand, then the winner climbs the cage.",
      "Sully's collection: smoother shooting sequence (the gun stays level, the reticle locks on, the round lands, the face is revealed). The blood tear now wells up under the eye and runs down the cheek. Bigger clip counter and reload button up top.",
      "New Champions tab: every UFC belt holder with official photos and stats, the media top 10 with rank movement, pound for pound, and a Threat radar of under-the-radar prospects outside the top 10 (Contender Series signees and unbeaten newcomers).",
      "Portraits converted to WebP, about 8× smaller, so cards load faster.",
      "Every faceoff portrait now has a transparent background so it blends into the stage: official UFC.com cut-outs where they exist, and clean background removal for the rest. Phone layout fixed so both fighters show in full with names readable over them.",
      "Women's bouts get their own finish clips (sports top and fight shorts), in red- and blue-corner versions.",
      "Champions sits right next to Fight center, and tapping JANGO PLAYZ always takes you back to Fight center. The headshot counter's magazine now stands upright under the trigger next to the rounds.",
      "Nightly refresh at 2:30 a.m.: new and changed cards, results and postmortems, 3-day re-reviews, rankings, then fresh frozen picks.",
    ],
  },
  {
    version: "1.0 · Sep 24, 2026",
    items: [
      "Moved off ChatGPT. Rebuilt as a four-model consensus: Résumé, Style matchup, Form & readiness, plus a simple Challenger baseline. When they disagree, confidence drops.",
      "Confidence = matchup edge × evidence quality × consensus. Obvious mismatches can now reach 80%+; thin résumés (under 6 pro fights or no UFC/DWCS fights) are capped at 68%.",
      "New signals: head-to-head history (Yan–Merab is a rematch), and who beat them — losses to strong opponents are treated very differently from losses to weak ones.",
      "Every announced fight gets a pick if the data exists. If it doesn't, it shows N/A and gets filled on the next nightly refresh.",
      "Rounds model 1.1: fighter duration history blended with division base rates, so thin histories stop defaulting to Over.",
      "New layout: event rail, sticky bout list, six boxed tabs, gold confidence ring, Track record page with accuracy by confidence band, and postmortems for every finished card.",
      "Fixed: fights wrongly labelled 4 rounds, the backwards 'activity advantage', and 70%+ picks labelled 'slight lean'.",
    ],
  },
  {
    version: "0.3 · Sep 16–23, 2026 (GPT)",
    items: [
      "Scope tightened to UFC, DWCS, PFL and ACA. RIZIN, K-1, OKTAGON and ONE removed.",
      "Winner pick shows up to five real advantages plus the strongest counterargument. Rounds got its own card with three blunt reasons.",
      "Technical context added for the four biggest UFC 331 matchups, taken from original fight reports. It's kept separate from the stats score.",
      "Finish scene lengthened to ten seconds. Decisions start with the ref between both fighters and raise the winner's hand. KOs and submissions get taunts instead of a hand raise.",
      "Sully's collection (headshot list) added. UFC 332, UFC 333 and the Sep 26 Fight Night cards loaded, with missing flags filled in.",
      "Four-stage audit planned (trust, experience, model, premium). It was carried out in 1.0.",
    ],
  },
  {
    version: "0.2 · Sep 12–15, 2026 (GPT)",
    items: [
      "Renamed from FightLens to JANGO PLAYZ, with a charcoal and gold theme and light mode kept.",
      "Compact matchup workspace (portraits, height/reach/stance, verdict side by side) and main card / prelims tabs.",
      "First 3D finish scene: an octagon with seating, light banks and generic Rocketbox fighters, playing once with a Replay button.",
      "ESPN athlete pages filled in 34 stances and 11 missing reaches. UFC 331 updated from the official listing (Moicano–Ortega out, Steveson–Sharaf moved to the main card).",
      "Rounds 0.3: last-10 fight durations and promotion splits, with non-UFC history counting less once UFC evidence exists. Losing streaks (e.g. Tuivasa) now show as counterarguments.",
    ],
  },
  {
    version: "0.1 · Sep 9–11, 2026 (GPT, as FightLens)",
    items: [
      "First version: upcoming cards with records, last-10 histories and a weighted six-factor winner model.",
      "Rounds over/under on every bout (1.5 for three-round fights, 2.5 for five). Odds shown for reference only, never used by the model.",
      "Picks frozen before each card and kept exactly as published. The Noche UFC forecast from Sep 11 is the oldest one on record (7/12 winners, 9/13 rounds).",
      "Known weakness fixed later: confidence clustered at 50–60% no matter how lopsided the fight was.",
    ],
  },
];

export function ModelLab() {
  const perf = performance();
  return (
    <>
      <section className="jp-page-head">
        <span className="jp-eyebrow">
          Engine {ENGINE_VERSION} · rounds {ROUNDS_MODEL_VERSION} · stats only, never odds
        </span>
        <h1>How a take is made</h1>
        <p>Every factor you'd look at gets checked in full, then four independent models vote. The weights stay under the hood and get re-tuned after every card.</p>
      </section>

      <div className="jp-lab">
        <div className="jp-card">
          <h3 className="jp-h3">The four models</h3>
          <div className="jp-models">
            <div>
              <strong>Résumé</strong>
              <p>Who they beat and who beat them (opponents' records going in), head-to-head, and how they've done at UFC level. Regional finishes against weak opposition are discounted.</p>
            </div>
            <div>
              <strong>Style matchup</strong>
              <p>Striking and grappling rates, finishing threat against the other guy's durability, height and reach, and results once fights reach round 3.</p>
            </div>
            <div>
              <strong>Form & readiness</strong>
              <p>Last-10 results (newest weighted most), win and loss streaks, layoffs and very short turnarounds, and age curve after 32.</p>
            </div>
            <div>
              <strong>Challenger</strong>
              <p>A deliberately simple baseline: top-level win rate plus schedule. If the fancy models can't beat it over time, they get changed.</p>
            </div>
          </div>
        </div>

        <div className="jp-card">
          <h3 className="jp-h3">Confidence scale</h3>
          <div className="jp-scale">
            <span className="tier-flip">50–54 · Coin flip</span>
            <span className="tier-slight">55–62 · Slight lean</span>
            <span className="tier-solid">63–71 · Solid lean</span>
            <span className="tier-strong">72–81 · Strong pick</span>
            <span className="tier-exceptional">82+ · Exceptional</span>
          </div>
          <p className="jp-fine">
            Data quality is shown separately (Complete / Good / Limited / Pending). A big edge built on thin data can't reach the top tiers.
          </p>
          {(() => {
            const live = ledgers.filter((l) => l.forecast && !l.results).flatMap((l) => l.forecast!.bouts).filter((b) => b.confidence);
            const bands: [string, string, number, number][] = [
              ["Coin flip", "tier-flip", 50, 54], ["Slight", "tier-slight", 55, 62], ["Solid", "tier-solid", 63, 71], ["Strong", "tier-strong", 72, 81], ["Exceptional", "tier-exceptional", 82, 100],
            ];
            const counts = bands.map(([, , lo, hi]) => live.filter((b) => (b.confidence ?? 0) >= lo && (b.confidence ?? 0) <= hi).length);
            const max = Math.max(1, ...counts);
            return live.length ? (
              <div className="jp-spread" aria-label="Locked upcoming picks by confidence tier">
                <span className="jp-spread-title">Locked upcoming picks by tier · {live.length} fights</span>
                {bands.map(([label, cls], i) => (
                  <div key={label} className="jp-spread-row">
                    <span>{label}</span>
                    <div className="jp-spread-bar"><i className={cls} style={{ width: `${(counts[i] / max) * 100}%` }} /></div>
                    <b>{counts[i]}</b>
                  </div>
                ))}
              </div>
            ) : null;
          })()}
        </div>

        <div className="jp-card">
          <h3 className="jp-h3">Rounds over/under</h3>
          <p>Three-round fights always get an O/U 1.5 pick (7:30 of fight time); five-round fights always get O/U 2.5 (12:30).</p>
          <ul className="jp-list">
            <li>Each fighter's last 10: how often they went past the line, weighted toward UFC fights over regional ones.</li>
            <li>Finishes against weak opposition count for less — they don't carry over to the UFC.</li>
            <li>A finisher who meets someone who keeps getting stopped moves the lean Under.</li>
            <li>Two elite fighters who both finish lesser opponents often cancel each other out, so the lean moves toward Over — unless both are proven knockout artists.</li>
            <li>Division base rates fill in when history is thin; heavyweight ends early far more often.</li>
          </ul>
        </div>

        <div className="jp-card">
          <h3 className="jp-h3">The learning loop</h3>
          <ol className="jp-list">
            <li>Picks freeze before the event with a timestamp and are locked in the ledger for good.</li>
            <li>After the card, results go in from Sherdog's play-by-play and round scoring, cross-checked against UFC.com.</li>
            <li>Every miss gets a cause: data gap, style read, variance (like a split decision Sherdog scored the other way), or model logic.</li>
            <li>Reviews stay open for 3 days so recaps and commentary can be added before the review is marked final.</li>
            <li>Model changes are backtested on every completed card before they ship.</li>
          </ol>
          <p className="jp-fine">
            So far: {perf.winner.hit}/{perf.winner.n} winners and {perf.rounds.hit}/{perf.rounds.n} rounds on frozen picks across {ledgers.filter((l) => l.forecast && l.results).length} finished cards. That's still a small sample — no claims of calibration yet.
          </p>
        </div>

        <div className="jp-lab-stack">
        <div className="jp-card">
          <h3 className="jp-h3">Never used</h3>
          <p>Betting odds, other people's predictions, flags, nationality and photos. Odds are shown next to each fight for reference only. Your notes and "Agree / My take" clicks don't change a pick.</p>
        </div>

        <div className="jp-card">
          <h3 className="jp-h3">Sources</h3>
          <p className="jp-fine">
            Tapology (preferred for records and opponent histories), Sherdog (full histories and post-fight play-by-play), UFC.com (official stats, photos, scorecards), ESPN fightcenter (cards and profiles) and BestFightOdds (odds, display only). Every stat links to where it came from.
          </p>
        </div>
        </div>
        <div className="jp-card jp-changelog">
          <h3 className="jp-h3">Change log</h3>
          {CHANGELOG.map((c) => (
            <div key={c.version} className="jp-change">
              <strong>{c.version}</strong>
              <ul className="jp-list">
                {c.items.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

      </div>
    </>
  );
}
