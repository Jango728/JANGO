"use client";
import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, BarChart3, ChevronLeft, ChevronRight, Eye, FileText, History as HistoryIcon, Link2, Timer, Trophy } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { CHECKED_AT, PROMOTIONS, SEED_EVENTS, SEED_FIGHTERS, SITE_URL } from "@/lib/data";
import { predictRounds } from "@/lib/rounds";
import { predict, shortName } from "@/lib/engine";
import { resultFor } from "@/lib/ledger";
import { loadReviews, saveReviews } from "@/lib/local-store";
import type { Event, Fight, Fighter, Review } from "@/lib/types";
import { CardBouts, cardGroup } from "@/components/card-bouts";
import { CardPulse } from "@/components/card-pulse";
import { EventRail } from "@/components/event-rail";
import { PickCard } from "@/components/pick-card";
import { EdgeMap } from "@/components/edge-map";
import { TrackRecord } from "@/components/track-record";
import { ModelLab } from "@/components/model-lab";
import { Champions } from "@/components/champions";
import { ArenaStats } from "@/components/arena-stats";
import { TechnicalRead } from "@/components/technical-context";
import { FinishScene } from "@/components/finish-scene";
import { RoundsPick } from "@/components/rounds-pick";
import { MarketOdds } from "@/components/market-odds";
import { History, RecentSummary, ThemeSwitch } from "@/components/research";
import { Faceoff, MatchupPaths, Portrait, TaleOfTape } from "@/components/fight-experience";
import { PromotionLogo } from "@/components/promotion-logo";
import { HeadshotList } from "@/components/headshot-list";
import { FOOTAGE } from "@/lib/footage";

type Page = "cards" | "record" | "model" | "champions";
type Detail = "pick" | "stats" | "rounds" | "history" | "film" | "notes";
const DETAIL_TABS: { id: Detail; label: string; icon: React.ReactNode }[] = [
  { id: "pick", label: "Prediction", icon: <Activity size={15} /> },
  { id: "stats", label: "Compare stats", icon: <BarChart3 size={15} /> },
  { id: "rounds", label: "Rounds", icon: <Timer size={15} /> },
  { id: "history", label: "Full history", icon: <HistoryIcon size={15} /> },
  { id: "film", label: "Film room", icon: <Eye size={15} /> },
  { id: "notes", label: "My notes", icon: <FileText size={15} /> },
];

const fighters: Record<string, Fighter> = SEED_FIGHTERS;
const EVENTS: Event[] = SEED_EVENTS.filter((e) => (PROMOTIONS as readonly string[]).includes(e.promotion)).sort((a, b) => a.date.localeCompare(b.date));
const fmtDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { weekday: "short", month: "long", day: "numeric", timeZone: "UTC" });

function readLink() {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search);
  return { e: q.get("e") ?? undefined, f: q.get("f") ?? undefined, t: (q.get("t") as Detail) ?? undefined, p: (q.get("p") as Page) ?? undefined };
}

export default function Home() {
  const [page, setPage] = useState<Page>("cards");
  const [today, setToday] = useState(CHECKED_AT);
  const [promo, setPromo] = useState<string>("All");
  const [eventId, setEventId] = useState<string>(() => EVENTS.find((e) => e.date >= CHECKED_AT && e.fights.length)?.id ?? EVENTS[0].id);
  const [fightId, setFightId] = useState<string>("");
  const [detail, setDetail] = useState<Detail>("pick");
  const [reviews, setReviews] = useState<Record<string, Review>>({});

  // Restore deep link + saved notes after hydration.
  useEffect(() => {
    const now = new Date().toISOString().slice(0, 10);
    setToday(now);
    setReviews(loadReviews());
    const l = readLink();
    const ev = EVENTS.find((x) => x.id === l.e) ?? EVENTS.find((x) => x.date >= now && x.fights.length) ?? EVENTS[EVENTS.length - 1];
    setEventId(ev.id);
    setFightId(ev.fights.find((f) => f.id === l.f)?.id ?? ev.fights[0]?.id ?? "");
    if (l.t && DETAIL_TABS.some((d) => d.id === l.t)) setDetail(l.t);
    if (l.p && ["cards", "record", "model", "champions"].includes(l.p)) setPage(l.p);
  }, []);

  const events = useMemo(() => EVENTS.filter((e) => promo === "All" || e.promotion === promo), [promo]);
  const current = EVENTS.find((e) => e.id === eventId) ?? EVENTS[0];
  const fight: Fight | undefined = current.fights.find((f) => f.id === fightId) ?? current.fights[0];
  const a = fight ? fighters[fight.a] : undefined, b = fight ? fighters[fight.b] : undefined;
  const prediction = fight && a && b ? predict(fight, a, b, current) : null;
  const review: Review = fight ? reviews[fight.id] ?? {} : {};
  const result = a && b ? resultFor(current.id, a.name, b.name) : null;

  // Keep the URL shareable: every event / fight / tab is a deep link.
  useEffect(() => {
    const q = new URLSearchParams();
    if (page !== "cards") q.set("p", page);
    q.set("e", current.id);
    if (fight) q.set("f", fight.id);
    if (detail !== "pick") q.set("t", detail);
    window.history.replaceState(null, "", "?" + q.toString());
  }, [page, current.id, fight, detail]);

  function goPage(p: Page) {
    setPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function chooseEvent(e: Event) {
    setEventId(e.id);
    setFightId(e.fights[0]?.id ?? "");
    setDetail("pick");
  }
  function choosePromo(p: string) {
    setPromo(p);
    const list = EVENTS.filter((e) => p === "All" || e.promotion === p);
    if (!list.some((e) => e.id === current.id) && list.length) chooseEvent(list.find((e) => e.date >= today && e.fights.length) ?? list[list.length - 1]);
  }
  function updateReview(patch: Partial<Review>) {
    if (!fight) return;
    setReviews((r) => {
      const next = { ...r, [fight.id]: { ...r[fight.id], ...patch } };
      saveReviews(next);
      return next;
    });
  }
  function step(dir: number) {
    if (!fight) return;
    const i = current.fights.indexOf(fight);
    const next = current.fights[i + dir];
    if (next) {
      setFightId(next.id);
      setDetail("pick");
    }
  }
  async function copyLink() {
    if (!fight || !a || !b || !prediction) return;
    const winner = prediction.pick === a.id ? a : prediction.pick === b.id ? b : null;
    const rounds = predictRounds(fight, a, b, current);
    const text = [
      `${current.title} — ${a.name} vs ${b.name}`,
      winner ? `Jango pick: ${winner.name} (${prediction.confidence}%, ${prediction.tier})` : "Jango pick: pending",
      rounds ? `Rounds: ${rounds.side} ${rounds.line}` : "",
      ...prediction.reasons.slice(0, 3).map((r) => `• ${r.title}: ${r.text}`),
      SITE_URL,
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Pick copied — paste it anywhere");
    } catch {
      toast.error("Couldn't copy on this device");
    }
  }

  const film = a && b ? FOOTAGE.filter((v) => [a.id, b.id].includes(v.fighter) && v.date < current.date) : [];

  return (
    <div className="jp-shell">
      <Toaster position="bottom-right" richColors />
      <header className="jp-top">
        <a
          className="jp-brand"
          href="?"
          aria-label="Jango Playz — Fight center"
          onClick={(e) => {
            e.preventDefault();
            goPage("cards");
          }}
        >
          <img src="favicon.svg" alt="" width={40} height={40} />
          <span>
            <strong>JANGO</strong> <em>PLAYZ</em>
          </span>
        </a>
        <nav className="jp-nav" aria-label="Main">
          {([
            ["cards", "Fight center"],
            ["champions", "Champions"],
            ["record", "Track record"],
            ["model", "Model lab"],
          ] as [Page, string][]).map(([id, label]) => (
            <button key={id} className={page === id ? "on" : ""} aria-current={page === id ? "page" : undefined} onClick={() => goPage(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="jp-top-tools">
          <ThemeSwitch />
        </div>
      </header>

      <main className="jp-main">
        {page === "cards" && (
          <>
            <div className="jp-filters" role="tablist" aria-label="Promotion">
              {["All", ...PROMOTIONS].map((p) => (
                <button key={p} role="tab" aria-selected={promo === p} className={"jp-promo " + (promo === p ? "on" : "")} onClick={() => choosePromo(p)}>
                  {p === "All" ? <span className="jp-promo-all">All cards</span> : <PromotionLogo promotion={p} />}
                </button>
              ))}
            </div>
            <EventRail events={events} selected={current.id} today={today} onSelect={chooseEvent} />

            <section className="jp-event-head">
              <div>
                <span className="jp-eyebrow">
                  {current.promotion === "DWCS" ? "Dana White's Contender Series" : current.promotion} · {fmtDate(current.date)}
                </span>
                <h1>{current.title}</h1>
                <p>
                  {current.location}
                  {current.time ? ` · ${current.time}` : ""}
                </p>
              </div>
              {current.fights.length > 0 && <CardPulse event={current} fighters={fighters} />}
            </section>

            {!fight || !a || !b || !prediction ? (
              <div className="jp-card jp-empty">
                <h3>Lineup not announced yet</h3>
                <p>The date is confirmed by the promotion. Bouts are added on the nightly 2:30 a.m. refresh as soon as they're published — every fighter shows N/A until their data is verified.</p>
              </div>
            ) : (
              <div className="jp-layout">
                <CardBouts event={current} fighters={fighters} selected={fight.id} onSelect={(id) => { setFightId(id); setDetail("pick"); }} />
                <section className="jp-detail">
                  <div className="jp-matchnav">
                    <button className="jp-btn ghost" onClick={() => step(-1)} disabled={current.fights.indexOf(fight) === 0} aria-label="Previous fight">
                      <ChevronLeft size={16} /> Prev
                    </button>
                    <span>
                      Fight {current.fights.indexOf(fight) + 1} of {current.fights.length} · {cardGroup(fight.section) === "main" ? "Main card" : "Prelims"}
                    </span>
                    <button className="jp-btn ghost" onClick={copyLink} aria-label="Copy this pick to share">
                      <Link2 size={15} /> Share pick
                    </button>
                    <button className="jp-btn ghost" onClick={() => step(1)} disabled={current.fights.indexOf(fight) === current.fights.length - 1} aria-label="Next fight">
                      Next <ChevronRight size={16} />
                    </button>
                  </div>

                  {result && (
                    <div className={"jp-final " + (result.winner === null ? "" : result.winner ? "hit" : "miss")}>
                      <Trophy size={18} />
                      <div>
                        <strong>
                          {result.bout.winner} def. {result.bout.loser}
                        </strong>
                        <span>
                          {result.bout.detail ?? result.bout.method} · R{result.bout.round} {result.bout.time} · went {result.bout.ou} {result.bout.line}
                        </span>
                      </div>
                      {result.forecast ? (
                        <span className="jp-final-tag">
                          Frozen pick: {result.forecast.pick ?? "none"} {result.winner === null ? "" : result.winner ? "✓" : "✗"}
                        </span>
                      ) : (
                        <span className="jp-final-tag">No frozen pick · results only</span>
                      )}
                      <button className="jp-btn ghost" onClick={() => goPage("record")}>
                        Review <ArrowUpRight size={13} />
                      </button>
                    </div>
                  )}

                  <Faceoff key={fight.id} a={a} b={b} event={current} fight={fight}>
                    <div className="jp-tabs" role="tablist" aria-label="Matchup sections">
                      {DETAIL_TABS.map((t) => (
                        <button key={t.id} role="tab" aria-selected={detail === t.id} className={detail === t.id ? "on" : ""} onClick={() => setDetail(t.id)}>
                          {t.icon}
                          <span>{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </Faceoff>

                  <div className="jp-panel" role="tabpanel">
                    {detail === "pick" && (
                      <>
                        <TaleOfTape a={a} b={b} />
                        <div className="jp-pick-grid">
                          <div className="jp-pick-col">
                            <PickCard p={prediction} a={a} b={b} review={review} onReview={updateReview} onMyTake={() => setDetail("notes")} />
                            <EdgeMap p={prediction} a={a} b={b} />
                          </div>
                          <div className="jp-side-col">
                            <RoundsPick fight={fight} a={a} b={b} event={current} compact />
                            <MarketOdds fight={fight} a={a} b={b} />
                          </div>
                        </div>
                        <div className="jp-finish-wide">
                          <FinishScene key={fight.id + String(prediction.pick)} a={a} b={b} event={current} fight={fight} winnerId={prediction.pick} />
                        </div>
                        <TechnicalRead event={current} fight={fight} compact />
                      </>
                    )}
                    {detail === "stats" && (
                      <>
                        <ArenaStats a={a} b={b} event={current} fight={fight} />
                        <MatchupPaths key={fight.id} a={a} b={b} event={current} fight={fight} review={review} onNotes={() => setDetail("notes")} />
                        <RecentSummary a={a} b={b} event={current} rules={fight.rules} />
                        {prediction.gaps.length > 0 && (
                          <div className="jp-card jp-gaps">
                            <h3 className="jp-h3">Evidence gaps</h3>
                            <ul>
                              {prediction.gaps.map((g) => (
                                <li key={g}>{g}</li>
                              ))}
                            </ul>
                            <p className="jp-fine">Gaps are re-checked on every nightly refresh.</p>
                          </div>
                        )}
                      </>
                    )}
                    {detail === "rounds" && <RoundsPick fight={fight} a={a} b={b} event={current} />}
                    {detail === "history" && (
                      <div className="jp-card">
                        <h3 className="jp-h3">Who did they actually fight?</h3>
                        <p className="jp-fine">Tap any fight for the opponent's record going in, weight class, promotion and how it ended.</p>
                        <div className="history-grid">
                          <History key={a.id} f={a} rules={fight.rules} event={current} />
                          <History key={b.id} f={b} rules={fight.rules} event={current} />
                        </div>
                      </div>
                    )}
                    {detail === "film" && (
                      <div className="jp-film">
                        <TechnicalRead event={current} fight={fight} />
                        <div className="jp-card">
                          <h3 className="jp-h3">Film room</h3>
                          {film.length ? (
                            <div className="footage-grid">
                              {film.map((v) => (
                                <a key={v.url} href={v.url} target="_blank" rel="noopener noreferrer" className="footage-card">
                                  <span className="jp-tag">{v.kind}</span>
                                  <strong>
                                    {v.title} <ArrowUpRight size={14} />
                                  </strong>
                                  <span>
                                    {v.publisher} · {v.date}
                                  </span>
                                  <p>Watch for: {v.focus}</p>
                                </a>
                              ))}
                            </div>
                          ) : (
                            <p className="jp-fine">No verified full fights or breakdowns linked yet for this matchup.</p>
                          )}
                          <div className="jp-film-search">
                            {[a, b].map((f) => (
                              <div key={f.id}>
                                <Portrait f={f} small />
                                <strong>{f.name}</strong>
                                <a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(f.name + " full fight UFC")}`} target="_blank" rel="noopener noreferrer">
                                  YouTube full fights <ArrowUpRight size={12} />
                                </a>
                                <a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(f.name + " fight breakdown")}`} target="_blank" rel="noopener noreferrer">
                                  Breakdowns <ArrowUpRight size={12} />
                                </a>
                                {f.instagram && (
                                  <a href={f.instagram} target="_blank" rel="noopener noreferrer">
                                    Instagram <ArrowUpRight size={12} />
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    {detail === "notes" && (
                      <div className="jp-card jp-notes-panel">
                        <h3 className="jp-h3">Your read</h3>
                        <div className="jp-seg" role="radiogroup" aria-label="Your winner">
                          {[a, b].map((f) => (
                            <button key={f.id} role="radio" aria-checked={review.pick === f.id} className={review.pick === f.id ? "on" : ""} onClick={() => updateReview({ pick: review.pick === f.id ? undefined : f.id })}>
                              {shortName(f.name)}
                            </button>
                          ))}
                        </div>
                        <label className="jp-field">
                          <span>Why — and the best case for the other guy</span>
                          <textarea rows={6} value={review.notes ?? ""} onChange={(e) => updateReview({ notes: e.target.value })} placeholder="Who wins, how, and why? Physique, film, anything the stats miss…" />
                        </label>
                        <p className="jp-fine">Saved automatically in this browser. Your notes never change the model's pick.</p>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}

            <HeadshotList />
          </>
        )}

        {page === "record" && (
          <>
            <section className="jp-page-head">
              <span className="jp-eyebrow">Predict · record · learn</span>
              <h1>Track record</h1>
              <p>Every pick is frozen and timestamped before the fight, then locked in the ledger so it can never be edited after the result. Misses get a postmortem and feed the next model version.</p>
            </section>
            <TrackRecord />
          </>
        )}

        {page === "model" && <ModelLab />}
        {page === "champions" && <Champions />}
      </main>
      <footer className="jp-foot">
        <span>JANGO PLAYZ</span>
        <span>Data refreshed nightly · last snapshot {CHECKED_AT} · odds shown for reference only, never used by the model</span>
      </footer>
    </div>
  );
}
