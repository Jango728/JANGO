"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, CircleCheck, CircleX, Minus } from "lucide-react";
import {
  cardCountsFor,
  isLedgerPromotion,
  ledgerLockAt,
  ledgersFor,
  openingVsFinal,
  performanceFor,
  promotionTabs,
  revisionsBeforeLock,
  scoredBouts,
  scoredFor,
  withFinal,
  type LedgerPromotion,
  type Scored,
  type Tally,
} from "@/lib/ledger";
import type { FrozenPick, Ledger } from "@/lib/ledger-types";
import { PromotionLogo } from "./promotion-logo";
import { FighterName } from "./site-nav";
import { classifyMethod } from "@/lib/fightinfo";
import { marketBenchmark } from "@/lib/benchmark";
import { followUpFor } from "@/lib/round-recaps";
import { RoundTimeline, hasRoundRecap } from "./round-timeline";
import "@/src/record.css";
import "@/src/revisions.css";

/** A pick and its verdict sitting together: "Win ✓", "Over 2.5 ✗". */
const Verdict = ({ v, yes, no, muted = false }: { v: boolean | null; yes: string; no: string; muted?: boolean }) => (
  <span className={"jp-verdict " + (v === null ? "none" : v ? "hit" : "miss") + (muted ? " muted" : "")}>
    {v === null ? <Minus size={14} /> : v ? <CircleCheck size={15} /> : <CircleX size={15} />}
    <span>{v === false ? no : yes}</span>
  </span>
);

function Stat({ label, t, noun, note }: { label: string; t: Tally; noun: string; note?: string }) {
  return (
    <div className="jp-stat">
      <span>{label}</span>
      <strong>{t.pct === null ? "—" : `${t.pct}%`}</strong>
      <small>
        {t.n ? `${t.hit} of ${t.n} ${noun} right` : "nothing scored yet"} {note ?? ""}
      </small>
    </div>
  );
}

/** Card summary: plain "4 of 12" with a clear label underneath and the hit rate beside it. */
const TallyItem = ({ a, b, label, tip }: { a: number; b: number; label: string; tip: string }) => (
  <div className="jp-tally-item" title={tip}>
    <div className="jp-tally-num">
      <strong>{a}</strong>
      <span className="of">of {b}</span>
      <span className="pct">{b ? `${Math.round((a / b) * 100)}%` : "—"}</span>
    </div>
    <div className="jp-tally-label">{label}</div>
  </div>
);

function LedgerTally({ won, of, rounds, roundsOf, live }: { won: number; of: number; rounds: number; roundsOf: number; live: boolean }) {
  return (
    <div className="jp-ledger-tally" aria-label={`${won} of ${of} winners picked right, ${rounds} of ${roundsOf} rounds picked right`}>
      <TallyItem a={won} b={of} label="winners picked right" tip="Fights where the fighter we picked won" />
      <TallyItem a={rounds} b={roundsOf} label="rounds picked right" tip="Fights where our over/under rounds call was right" />
      {live && <span className="jp-status s-live">Live</span>}
    </div>
  );
}

/* ---------- promotion tab: ?tr=UFC in the URL, remembered in localStorage ---------- */
type TabId = "All" | LedgerPromotion;
const TR_KEY = "jp-track-promo";
// Read at module load: the app rewrites the query string on its first render, before this page mounts.
// Used once: after that the viewer's latest choice (URL or localStorage) wins.
let linkedTr = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tr");

function initialTab(valid: TabId[]): TabId {
  const ok = (v: string | null | undefined): v is TabId => !!v && (valid as string[]).includes(v);
  const fromUrl = new URLSearchParams(window.location.search).get("tr") ?? linkedTr;
  linkedTr = null;
  if (ok(fromUrl)) return fromUrl;
  try {
    const saved = window.localStorage.getItem(TR_KEY);
    if (ok(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  return "All";
}

function writeTab(tab: TabId) {
  const apply = () => {
    const q = new URLSearchParams(window.location.search);
    if (tab === "All") q.delete("tr");
    else q.set("tr", tab);
    const qs = q.toString();
    if (qs !== window.location.search.replace(/^\?/, "")) window.history.replaceState(window.history.state, "", (qs ? "?" + qs : window.location.pathname) + window.location.hash);
  };
  apply();
  // The app's own URL sync runs after child effects and rebuilds the query from scratch; re-apply once it has.
  window.setTimeout(apply, 0);
  try {
    window.localStorage.setItem(TR_KEY, tab);
  } catch {
    /* storage blocked */
  }
}

const firstScoredId = (tab: TabId) => ledgersFor(isLedgerPromotion(tab) ? tab : null).find((l) => l.forecast && l.results)?.eventId ?? null;

const CAUSE: Record<string, string> = { data: "Data gap", "style-read": "Style read", variance: "Variance", model: "Model logic" };

/** Band names in the same words the pick cards use ("Slight lean", "Strong pick"). */
const bandLabel = (l: string) => l.replace(/^Slight\b/, "Slight lean").replace(/^Solid\b/, "Solid lean").replace(/^Strong\b/, "Strong pick").replace(/(\d)(\+?)$/, "$1%$2");

/** One honest sentence up top: how the winner picks compare with a coin flip, and rounds with always-Over. */
function Headline({ perf, scope, cards }: { perf: ReturnType<typeof performanceFor>; scope: string | null; cards: number }) {
  const w = perf.winner, r = perf.rounds, base = perf.alwaysOver;
  if (!w.n) return <p className="jp-tr-headline">No graded picks{scope ? ` for ${scope}` : ""} yet — the first frozen picks are scored after their card.</p>;
  const vsFlip = w.pct! < 48 ? "below a coin flip so far" : w.pct! <= 55 ? "about a coin flip so far" : "ahead of a coin flip so far";
  const vsOver = r.n && base.pct !== null ? (r.pct! > base.pct ? `, ahead of always picking Over (${base.pct}%)` : r.pct! < base.pct ? `, behind always picking Over (${base.pct}%)` : `, level with always picking Over`) : "";
  return (
    <p className="jp-tr-headline">
      <strong>
        Winner picks: {w.hit} of {w.n} right ({w.pct}%)
      </strong>{" "}
      — {vsFlip}.
      {r.n ? (
        <>
          {" "}
          <strong>
            Rounds: {r.hit} of {r.n} ({r.pct}%)
          </strong>
          {vsOver}.
        </>
      ) : null}{" "}
      <span className="jp-fine">
        {w.n < 100 ? `Small sample: ${w.n} graded picks${cards ? ` from ${cards} ${cards === 1 ? "card" : "cards"}` : ""}.` : ""}
      </span>
    </p>
  );
}

/** Compact "Model vs market" line. Evaluation only: odds never feed any model. */
function VsMarket({ promo }: { promo: LedgerPromotion | null }) {
  const m = useMemo(() => marketBenchmark(promo), [promo]);
  if (!m.bouts) return null;
  const pct = (x: { pct: number | null }) => (x.pct === null ? "—" : `${x.pct}%`);
  return (
    <section className="jp-card jp-vsmarket" aria-label="Model vs market">
      <div className="jp-vsmarket-head">
        <h2 className="jp-h3">Model vs market</h2>
        <span className="jp-tag">Evaluation only · odds never feed the model</span>
      </div>
      <div className="jp-vsmarket-grid">
        <div>
          <span>Our picks</span>
          <strong>{pct(m.ours)}</strong>
          <small>
            {m.ours.hit} of {m.ours.n} right
          </small>
        </div>
        <div>
          <span>Betting favourite</span>
          <strong>{pct(m.market)}</strong>
          <small>
            {m.market.hit} of {m.market.n} on the same bouts
          </small>
        </div>
        <div>
          <span>When we took the underdog</span>
          <strong>{m.disagreed.n ? `${m.disagreed.hit} of ${m.disagreed.n}` : "—"}</strong>
          <small>{m.disagreed.n ? `the favourite won ${m.disagreed.marketHit}` : "we always sided with the favourite"}</small>
        </div>
        <div>
          <span>Brier score</span>
          <strong>
            {m.brier.ours ?? "—"} <em>vs {m.brier.market ?? "—"}</em>
          </strong>
          <small>ours vs the market's implied odds · lower is better</small>
        </div>
      </div>
    </section>
  );
}

/** "Opening picks: x/y; final picks: x/y" — the headline grades the final pick; this keeps the first freeze visible. */
function OpeningVsFinal({ promo }: { promo: LedgerPromotion | null }) {
  const o = useMemo(() => openingVsFinal(scoredFor(promo)), [promo]);
  if (!o.final.winner.n) return null;
  const t = (x: Tally) => `${x.hit}/${x.n}${x.pct === null ? "" : ` (${x.pct}%)`}`;
  return (
    <p className="jp-tr-openfinal">
      <strong>Opening picks: {t(o.opening.winner)}; final picks: {t(o.final.winner)}</strong> winners
      {o.final.rounds.n ? ` · rounds ${t(o.opening.rounds)} → ${t(o.final.rounds)}` : ""}.{" "}
      {o.revised
        ? `${o.revised} graded ${o.revised === 1 ? "pick was" : "picks were"} revised before lock (${o.changedPicks} changed side). The record above grades the final pick — the last one before the card started.`
        : "No graded pick has been revised yet, so both records match. Picks can be revised before a card starts when something material changes; the opening pick always stays on record."}
    </p>
  );
}

const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "America/Toronto" });
const lockText = (iso: string) =>
  new Date(iso).toLocaleString("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" }) + " ET";

/** Small mark on a pick that changed before lock, with the revision trail in its tooltip. */
function ChangeMark({ opening, lockAt, flipped }: { opening: FrozenPick; lockAt: string; flipped: boolean }) {
  const revs = revisionsBeforeLock(opening, lockAt);
  if (!revs.length) return null;
  const tip = [`Opening: ${opening.pick ?? "N/A"}${opening.confidence != null ? ` ${opening.confidence}%` : ""}`, ...revs.map((r) => `${shortDay(r.at)}: ${r.pick ?? "N/A"}${r.confidence != null ? ` ${r.confidence}%` : ""} — ${r.reason}`)].join("\n");
  return (
    <span className={"jp-tr-chg" + (flipped ? " flip" : "")} title={tip}>
      {flipped ? "changed pick" : "revised"}
    </span>
  );
}

/** Rows for an upcoming card: the current (final-so-far) pick, with retired bouts shown muted at the end. */
function upcomingRows(l: Ledger) {
  const lockAt = ledgerLockAt(l);
  const bouts = l.forecast?.bouts ?? [];
  return [...bouts.filter((b) => !b.status), ...bouts.filter((b) => b.status)].map((b) => {
    const cur = withFinal(b, lockAt);
    return { b, cur, lockAt, flipped: (b.pick ?? null) !== (cur.pick ?? null) };
  });
}
const revisedCount = (l: Ledger) => (l.forecast?.bouts ?? []).filter((b) => revisionsBeforeLock(b, ledgerLockAt(l)).length).length;
const flippedScored = (r: Scored) => r.pickChanged;

export function TrackRecord() {
  const tabs = useMemo(() => promotionTabs(), []);
  const [tab, setTab] = useState<TabId>("All");
  const [open, setOpen] = useState<string | null>(() => firstScoredId("All"));

  // Restore the tab after hydration (URL first, then the viewer's last choice).
  useEffect(() => {
    const t = initialTab(tabs.map((x) => x.id));
    if (t !== "All") {
      setTab(t);
      setOpen(firstScoredId(t));
    }
    writeTab(t);
  }, [tabs]);

  function choose(t: TabId) {
    if (t === tab) return;
    setTab(t);
    setOpen(firstScoredId(t));
    writeTab(t);
  }

  const promo = isLedgerPromotion(tab) ? tab : null;
  const perf = useMemo(() => performanceFor(promo), [promo]);
  const counts = useMemo(() => cardCountsFor(promo), [promo]);
  const shown = useMemo(() => ledgersFor(promo), [promo]);
  const tabLabel = tabs.find((x) => x.id === tab)?.label ?? tab;

  return (
    <div className="jp-track">
      <div className="jp-tr-tabs" role="tablist" aria-label="Track record by promotion">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={"jp-promo jp-tr-tab " + (tab === t.id ? "on" : "")}
            onClick={() => choose(t.id)}
            title={`${t.scored} scored ${t.scored === 1 ? "fight" : "fights"}`}
          >
            {t.id !== "All" && <PromotionLogo promotion={t.id} />}
            <span className={"jp-tr-tab-label" + (t.id !== "All" ? " sr-only" : "")}>{t.label}</span>
            <span className="jp-tr-count" aria-label={`${t.scored} scored fights`}>
              {t.scored}
            </span>
          </button>
        ))}
      </div>

      <Headline perf={perf} scope={promo ? tabLabel : null} cards={counts.scoredCards} />
      <OpeningVsFinal promo={promo} />
      <VsMarket promo={promo} />

      <div className="jp-stats">
        <Stat label="Winner picks" t={perf.winner} noun="winners" />
        <Stat label="Rounds O/U" t={perf.rounds} noun="rounds" note={perf.alwaysOver.pct === null ? "" : `· always-Over would hit ${perf.alwaysOver.pct}%`} />
        <Stat label="Method" t={perf.method} noun="methods" />
        {promo ? (
          <>
            <div className="jp-stat">
              <span>Cards scored</span>
              <strong>{counts.scoredCards}</strong>
              <small>
                {counts.scoredCards === 1 ? "card" : "cards"} with frozen picks + results{counts.resultsOnly ? ` · ${counts.resultsOnly} results-only` : ""}
              </small>
            </div>
            <div className="jp-stat">
              <span>Picks on upcoming cards</span>
              <strong>{counts.lockedPicks}</strong>
              <small>{counts.upcomingCards ? `across ${counts.upcomingCards} upcoming ${counts.upcomingCards === 1 ? "card" : "cards"} · lock at each start` : "no upcoming card frozen"}</small>
            </div>
          </>
        ) : (
          <>
            <Stat label="UFC cards" t={perf.ufc} noun="winners" />
            <Stat label="DWCS" t={perf.dwcs} noun="winners" />
          </>
        )}
        <div className="jp-stat">
          <span>Brier score</span>
          <strong>{perf.brier ?? "—"}</strong>
          <small>lower is better · 0.25 = coin flip</small>
        </div>
      </div>

      <div className="jp-card">
        <h2 className="jp-h3">Accuracy by confidence band{promo ? ` · ${tabLabel}` : ""}</h2>
        <p className="jp-fine">If the model is calibrated, higher bands hit more often. The line marks 50% (a coin flip). Only frozen pre-fight picks count (the final pick before lock).</p>
        <div className="jp-bands">
          {perf.bands.map((b) => (
            <div key={b.label} className="jp-band">
              <span>{bandLabel(b.label)}</span>
              <div className="jp-bar" role="img" aria-label={b.pct === null ? "No picks in this band yet" : `${b.pct}% right, ${b.n} picks`}>
                <i style={{ width: `${b.pct ?? 0}%` }} />
                <em className="jp-bar-even" title="50% = coin flip" />
              </div>
              <strong>{b.pct === null ? "—" : `${b.pct}%`}</strong>
              <small>{b.n} picks</small>
            </div>
          ))}
        </div>
      </div>

      <div className="jp-ledger">
        {shown.length === 0 && <p className="jp-fine">No {tabLabel} cards in the ledger yet.</p>}
        {shown.map((l) => {
          const rows = scoredBouts(l);
          const w = rows.filter((r) => r.winner !== null), rr = rows.filter((r) => r.rounds !== null);
          const isOpen = open === l.eventId;
          const nRevised = revisedCount(l);
          return (
            <section key={l.eventId} className={"jp-card jp-ledger-card " + (isOpen ? "open" : "")}>
              <button className={"jp-ledger-head" + (l.forecast && l.results ? " has-tally" : "")} onClick={() => setOpen(isOpen ? null : l.eventId)} aria-expanded={isOpen}>
                <PromotionLogo promotion={l.promotion} />
                <div>
                  <strong>{l.title}</strong>
                  <span>
                    {l.date} · {l.forecast ? `frozen ${l.forecast.frozenAt.slice(0, 10)} · engine ${l.forecast.engine}${nRevised ? ` · ${nRevised} revised before lock` : ""}` : "no pre-fight forecast preserved — excluded from accuracy"}
                  </span>
                </div>
                {l.forecast && !l.results ? (
                  <span className="jp-tag gold">
                    {l.forecast.bouts.filter((b) => !b.status).length} {l.forecast.bouts.filter((b) => !b.status).length === 1 ? "pick" : "picks"}
                    {nRevised ? ` · ${nRevised} revised` : ""}
                  </span>
                ) : l.forecast ? (
                  <LedgerTally won={w.filter((r) => r.winner).length} of={w.length} rounds={rr.filter((r) => r.rounds).length} roundsOf={rr.length} live={!!l.results?.live} />
                ) : (
                  <span className="jp-tag">Results only</span>
                )}
                <ChevronDown size={18} className="jp-chev" />
              </button>
              {isOpen && !l.results && l.forecast && (
                <div className="jp-ledger-body">
                  <table className="jp-table">
                    <thead>
                      <tr>
                        <th>Fight</th>
                        <th>Current pick</th>
                        <th>Conf.</th>
                        <th>Rounds</th>
                        <th>Method</th>
                      </tr>
                    </thead>
                    <tbody>
                      {upcomingRows(l).map(({ b: o, cur: f, lockAt, flipped }, i) => (
                        <tr key={i} className={o.status ? "jp-tr-off" : undefined}>
                          <td>
                            <strong><FighterName name={f.a} /></strong> vs <strong><FighterName name={f.b} /></strong>
                            <div className="jp-fine">
                              {o.status ? `${o.status === "replaced" ? "Replaced" : "Cancelled"} · ${o.statusNote ?? "off the card"} · not graded` : `${f.scheduledRounds} rounds${o.note ? ` · ${o.note}` : ""}`}
                            </div>
                          </td>
                          <td>
                            {f.pick ? <strong className="jp-tr-pick"><FighterName name={f.pick} /></strong> : "N/A · pending"}
                            {flipped && o.pick ? <span className="jp-tr-was">opened: {o.pick}{o.confidence ? ` ${o.confidence}%` : ""}</span> : null}
                            <ChangeMark opening={o} lockAt={lockAt} flipped={flipped} />
                          </td>
                          <td>{f.confidence ? <span className="jp-tr-conf">{f.confidence}%</span> : "—"}</td>
                          <td>{f.rounds ? <span className="jp-tr-ou">{f.rounds.side} {f.rounds.line}</span> : "—"}</td>
                          <td>{f.method ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="jp-fine">
                    Opened {l.forecast.frozenAt.slice(0, 10)}. Picks can still be revised when something material changes (a replacement, missed weight, new results, a model update) until they lock at {lockText(ledgerLockAt(l))}; every opening pick stays on record. Results and a postmortem are added after the card.
                  </p>
                </div>
              )}
              {isOpen && l.results && (
                <div className="jp-ledger-body">
                  <table className="jp-table jp-tr-results">
                    <thead>
                      <tr>
                        <th>Result</th>
                        <th>Our pick</th>
                        <th>Winner</th>
                        <th>Rounds</th>
                        <th>Method</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => {
                        const m = classifyMethod(r.bout.method);
                        return (
                          <tr key={i}>
                            <td>
                              <div className="jp-tr-who">
                                <strong>{r.bout.winner ? <FighterName name={r.bout.winner} /> : "Draw / NC"}</strong> <span>def.</span> <FighterName name={r.bout.loser ?? ""} />
                              </div>
                              <div className={"jp-tr-how k-" + m.kind.toLowerCase()}>
                                <b>{m.kind === "KO" ? m.label : m.kind === "SUB" ? "SUB" : m.kind === "DEC" ? "DEC" : m.label}</b>
                                <span>{r.bout.detail ?? r.bout.method}</span>
                                <em>
                                  R{r.bout.round} · {r.bout.time}
                                </em>
                                {r.bout.contract ? <small>UFC contract</small> : null}
                              </div>
                              {(r.bout.notes.length > 0 || hasRoundRecap(r.bout)) && (
                                <details className="jp-notes">
                                  <summary>
                                    How it went
                                    {r.bout.rounds?.length ? ` · round by round (${r.bout.rounds.length})` : r.bout.recap?.status === "pending" ? " · recap pending" : ""}
                                  </summary>
                                  <RoundTimeline bout={r.bout} followUpUntil={followUpFor(l)} />
                                  {r.bout.notes.length > 0 && (
                                    <>
                                      {r.bout.rounds?.length ? <p className="rr-notes-h">Notes</p> : null}
                                      <ul>
                                        {r.bout.notes.map((n, j) => (
                                          <li key={j}>{n}</li>
                                        ))}
                                      </ul>
                                    </>
                                  )}
                                  {r.bout.context && <p className="jp-fine">{r.bout.context}</p>}
                                </details>
                              )}
                            </td>
                            <td>
                              {r.forecast?.pick ? (
                                <div className="jp-tr-pickcell">
                                  <strong className="jp-tr-pick">
                                    <FighterName name={r.forecast.pick} />
                                  </strong>
                                  {r.forecast.confidence ? <span className="jp-tr-conf">{r.forecast.confidence}%</span> : null}
                                </div>
                              ) : (
                                <span className="jp-fine">No pick</span>
                              )}
                              {flippedScored(r) && r.opening ? (
                                <span className="jp-tr-was">
                                  opened: {r.opening.pick ?? "N/A"}
                                  {r.openingGrade.winner === null ? "" : r.openingGrade.winner ? " ✓" : " ✗"}
                                </span>
                              ) : null}
                              {r.opening ? <ChangeMark opening={r.opening} lockAt={ledgerLockAt(l)} flipped={flippedScored(r)} /> : null}
                            </td>
                            <td>
                              <Verdict v={r.winner} yes="Win" no="Miss" />
                            </td>
                            <td>
                              {r.forecast?.rounds ? (
                                <>
                                  <Verdict v={r.rounds} yes={`${r.forecast.rounds.side} ${r.forecast.rounds.line}`} no={`${r.forecast.rounds.side} ${r.forecast.rounds.line}`} />
                                  <div className="jp-fine">went {r.bout.ou}</div>
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td>{r.forecast?.method ? <Verdict v={r.method} yes={r.forecast.method} no={r.forecast.method} muted /> : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="jp-fine jp-tr-key">
                    <b>Winner</b> = did our picked fighter win · <b>Rounds</b> = was our over/under call right · <b>Method</b> = did it end the way we projected. ✓ right · ✗ wrong. Grades use the final pick before lock; <b>changed pick</b> marks a pick that switched sides after the opening freeze.
                  </p>
                  {l.review && (
                    <div className="jp-review">
                      <h4>
                        Postmortem <span className="jp-tag">{l.review.status}</span>
                      </h4>
                      <ul>
                        {l.review.lessons.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                      {l.review.bouts.length > 0 && (
                        <div className="jp-misses">
                          {l.review.bouts.map((m, i) => (
                            <div key={i} className="jp-miss">
                              <strong>
                                {m.a} vs {m.b}
                              </strong>
                              {m.cause && <span className={"jp-cause c-" + m.cause}>{CAUSE[m.cause]}</span>}
                              <p>{m.note}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {l.review.modelChanges && (
                        <>
                          <h5>What changed in the model</h5>
                          <ul>
                            {l.review.modelChanges.map((x, i) => (
                              <li key={i}>{x}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                  <div className="jp-sources">
                    {l.results?.sources.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.label} <ArrowUpRight size={12} />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
