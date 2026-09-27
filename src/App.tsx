"use client";
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, ArrowUpRight, BarChart3, ChevronLeft, ChevronRight, Eye, FileText, History as HistoryIcon, Link2, RotateCcw, Search, Timer, Trophy } from "lucide-react";
import { Toaster, toast } from "@/components/toast";
import { CHECKED_AT, PROMOTIONS, SEED_EVENTS, SEED_FIGHTERS, SITE_URL, loadAllFighters, useEventFighters } from "@/lib/site-data";
import { predictRounds } from "@/lib/rounds";
import { predictFinish } from "@/lib/finish";
import { predict } from "@/lib/engine";
import { resultFor, ledgerFor } from "@/lib/ledger";
import { loadReviews, saveReviews } from "@/lib/local-store";
import type { Event, Fight, Fighter, Review } from "@/lib/types";
import { CardBouts, cardGroup } from "@/components/card-bouts";
import { CardPulse } from "@/components/card-pulse";
import { EventRail } from "@/components/event-rail";
import { PickCard } from "@/components/pick-card";
import { EdgeMap } from "@/components/edge-map";
import { TechnicalRead } from "@/components/technical-context";
import { FinishScene } from "@/components/finish-scene";
import { RoundsPick } from "@/components/rounds-pick";
import { MarketOdds } from "@/components/market-odds";
import { ThemeSwitch } from "@/components/fighter-meta";
import { Faceoff, TaleOfTape } from "@/components/fight-experience";
import { PickUpdates, VerdictStrip } from "@/components/verdict-strip";
import { PromotionLogo } from "@/components/promotion-logo";
import { SiteNavProvider, type SiteNav } from "@/components/site-nav";

// Everything off the first screen loads on demand. Features that need every fighter profile
// (search, profiles, clips, film room) wait for the full roster of profiles first.
const named = <T,>(p: Promise<T>, pick: (m: T) => React.ComponentType<any>) => p.then((m) => ({ default: pick(m) })); // eslint-disable-line @typescript-eslint/no-explicit-any
const withAll = <T,>(load: () => Promise<T>) => () => loadAllFighters().then(load);
// Track record waits for every profile too: its market benchmark falls back to card odds stored with the fighters.
const TrackRecord = lazy(() => named(withAll(() => import("@/components/track-record"))(), (m) => m.TrackRecord));
const ModelLab = lazy(() => named(import("@/components/model-lab"), (m) => m.ModelLab));
const Champions = lazy(() => named(import("@/components/champions"), (m) => m.Champions));
const HeadshotList = lazy(() => named(import("@/components/headshot-list"), (m) => m.HeadshotList));
const ClipsPage = lazy(() => named(withAll(() => import("@/components/clips"))(), (m) => m.ClipsPage));
const FighterProfileDialog = lazy(() => named(withAll(() => import("@/components/fighter-profile"))(), (m) => m.FighterProfileDialog));
const SiteSearch = lazy(() => named(withAll(() => import("@/components/site-search"))(), (m) => m.SiteSearch));
const FilmRoom = lazy(() => named(withAll(() => import("@/components/film-room"))(), (m) => m.FilmRoom));
const detailTabs = () => import("@/components/detail-tabs");
const StatsTab = lazy(() => named(detailTabs(), (m) => m.StatsTab));
const HistoryTab = lazy(() => named(detailTabs(), (m) => m.HistoryTab));
const NotesTab = lazy(() => named(detailTabs(), (m) => m.NotesTab));

type Page = "cards" | "record" | "model" | "champions" | "clips";
type Detail = "pick" | "stats" | "rounds" | "history" | "film" | "notes";
const PAGES: [Page, string, string][] = [
  ["cards", "Fight center", "Fights"],
  ["champions", "Champions", "Champs"],
  ["record", "Track record", "Record"],
  ["clips", "Clips", "Clips"],
  ["model", "Model lab", "Lab"],
];
const DETAIL_TABS: { id: Detail; label: string; icon: ReactNode }[] = [
  { id: "pick", label: "Prediction", icon: <Activity size={15} aria-hidden="true" /> },
  { id: "stats", label: "Compare stats", icon: <BarChart3 size={15} aria-hidden="true" /> },
  { id: "rounds", label: "Rounds", icon: <Timer size={15} aria-hidden="true" /> },
  { id: "history", label: "Full history", icon: <HistoryIcon size={15} aria-hidden="true" /> },
  { id: "film", label: "Film room", icon: <Eye size={15} aria-hidden="true" /> },
  { id: "notes", label: "My notes", icon: <FileText size={15} aria-hidden="true" /> },
];

const fighters: Record<string, Fighter> = SEED_FIGHTERS;
const EVENTS: Event[] = SEED_EVENTS.filter((e) => (PROMOTIONS as readonly string[]).includes(e.promotion)).sort((a, b) => a.date.localeCompare(b.date));
const fmtDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { weekday: "short", month: "long", day: "numeric", timeZone: "UTC" });

function readLink() {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search);
  return { e: q.get("e") ?? undefined, f: q.get("f") ?? undefined, t: (q.get("t") as Detail) ?? undefined, p: (q.get("p") as Page) ?? undefined };
}

const Loading = ({ label = "Loading…", tall = false }: { label?: string; tall?: boolean }) => (
  <div className={"jp-card jp-loading" + (tall ? " tall" : "")} role="status" aria-live="polite">
    <span className="jp-loading-bar" aria-hidden="true" />
    <span>{label}</span>
  </div>
);

export default function Home() {
  const [page, setPage] = useState<Page>("cards");
  const [today, setToday] = useState(CHECKED_AT);
  const [promo, setPromo] = useState<string>("All");
  const [eventId, setEventId] = useState<string>(() => EVENTS.find((e) => ledgerFor(e.id)?.results?.live)?.id ?? EVENTS.find((e) => e.date >= CHECKED_AT && e.fights.length)?.id ?? EVENTS[0].id);
  const [fightId, setFightId] = useState<string>("");
  const [detail, setDetail] = useState<Detail>("pick");
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const [profile, setProfile] = useState<string | null>(null);
  const [profileMounted, setProfileMounted] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMounted, setSearchMounted] = useState(false);

  // Restore deep link + saved notes after hydration.
  useEffect(() => {
    const now = new Date().toISOString().slice(0, 10);
    setToday(now);
    setReviews(loadReviews());
    const l = readLink();
    const ev = EVENTS.find((x) => x.id === l.e) ?? EVENTS.find((x) => ledgerFor(x.id)?.results?.live) ?? EVENTS.find((x) => x.date >= now && x.fights.length) ?? EVENTS[EVENTS.length - 1];
    setEventId(ev.id);
    setFightId(ev.fights.find((f) => f.id === l.f)?.id ?? ev.fights[0]?.id ?? "");
    if (l.t && DETAIL_TABS.some((d) => d.id === l.t)) setDetail(l.t);
    if (l.p && PAGES.some(([id]) => id === l.p)) setPage(l.p);
  }, []);

  // Once the first card is on screen, fetch the remaining profiles in the background so search and
  // profiles open instantly.
  useEffect(() => {
    const start = () => void loadAllFighters().catch(() => {});
    if (typeof window.requestIdleCallback !== "function") {
      const id = window.setTimeout(start, 2500);
      return () => clearTimeout(id);
    }
    const id = window.requestIdleCallback(start, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }, []);

  // "/" or Ctrl/Cmd+K opens search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.closest("input,textarea,[contenteditable=true]")) return;
      if (e.key === "/" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const events = useMemo(() => EVENTS.filter((e) => promo === "All" || e.promotion === promo), [promo]);
  const current = EVENTS.find((e) => e.id === eventId) ?? EVENTS[0];
  const card = useEventFighters(current);
  const fight: Fight | undefined = current.fights.find((f) => f.id === fightId) ?? current.fights[0];
  const a = fight && card.ready ? fighters[fight.a] : undefined,
    b = fight && card.ready ? fighters[fight.b] : undefined;
  const prediction = useMemo(() => (fight && a && b ? predict(fight, a, b, current) : null), [fight, a, b, current]);
  const rounds = useMemo(() => (fight && a && b ? predictRounds(fight, a, b, current) : null), [fight, a, b, current]);
  const finish = useMemo(() => (fight && a && b && prediction ? predictFinish(fight, a, b, current, prediction.pick) : null), [fight, a, b, current, prediction]);
  const review: Review = fight ? (reviews[fight.id] ?? {}) : {};
  const result = a && b ? resultFor(current.id, a.name, b.name) : null;

  // Keep the URL shareable: every event / fight / tab is a deep link.
  useEffect(() => {
    const q = new URLSearchParams();
    if (page !== "cards") q.set("p", page);
    q.set("e", current.id);
    if (fight) q.set("f", fight.id);
    if (detail !== "pick") q.set("t", detail);
    // Keep page-specific params other components own (e.g. the Track record promotion tab).
    const keep = new URLSearchParams(window.location.search).get("tr");
    if (page === "record" && keep) q.set("tr", keep);
    window.history.replaceState(null, "", "?" + q.toString());
  }, [page, current.id, fight, detail]);

  function openSearch() {
    setSearchMounted(true);
    setSearchOpen(true);
  }
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
    const next = current.fights[current.fights.indexOf(fight) + dir];
    if (next) setFightId(next.id);
  }
  async function copyLink() {
    if (!fight || !a || !b || !prediction) return;
    const winner = prediction.pick === a.id ? a : prediction.pick === b.id ? b : null;
    const text = [
      `${current.title} — ${a.name} vs ${b.name}`,
      winner ? `Jango pick: ${winner.name} (${prediction.confidence}%, ${prediction.tier})` : "Jango pick: pending",
      rounds ? `Rounds: ${rounds.side} ${rounds.line}` : "",
      finish ? `Method: ${finish.label}` : "",
      ...prediction.reasons.slice(0, 3).map((r) => `• ${r.title}: ${r.text}`),
      SITE_URL,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Pick copied — paste it anywhere");
    } catch {
      toast.error("Couldn't copy on this device");
    }
  }

  const siteNav: SiteNav = {
    openFighter: (id) => {
      setProfileMounted(true);
      setProfile(id);
    },
    openSearch,
    goFight: (eId, fId) => {
      const ev = EVENTS.find((x) => x.id === eId);
      if (!ev) return;
      setProfile(null);
      setPage("cards");
      if (promo !== "All" && ev.promotion !== promo) setPromo("All");
      setEventId(ev.id);
      setFightId(fId ?? ev.fights[0]?.id ?? "");
      setDetail("pick");
      setTimeout(() => document.querySelector(fId ? ".jp-detail" : ".jp-event-head")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    },
  };

  // Arrow keys / Home / End move between matchup tabs (WAI-ARIA tabs pattern).
  function tabKeys(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = DETAIL_TABS.findIndex((t) => t.id === detail);
    const n = DETAIL_TABS.length;
    const j = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    setDetail(DETAIL_TABS[j].id);
    document.getElementById("tab-" + DETAIL_TABS[j].id)?.focus();
  }
  const index = fight ? current.fights.indexOf(fight) : -1;
  const tabProps = a && b && fight ? { a, b, event: current, fight } : null;

  return (
    <SiteNavProvider value={siteNav}>
      <div className="jp-shell">
        <a className="jp-skip" href="#main">
          Skip to content
        </a>
        <Toaster />
        {profileMounted && (
          <Suspense fallback={null}>
            <FighterProfileDialog target={profile} onClose={() => setProfile(null)} />
          </Suspense>
        )}
        {searchMounted && (
          <Suspense fallback={null}>
            <SiteSearch open={searchOpen} onOpenChange={setSearchOpen} />
          </Suspense>
        )}
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
            {PAGES.map(([id, label, short]) => (
              <button key={id} className={page === id ? "on" : ""} aria-current={page === id ? "page" : undefined} onClick={() => goPage(id)} aria-label={label}>
                <span className="jp-nav-long">{label}</span>
                <span className="jp-nav-short" aria-hidden="true">
                  {short}
                </span>
              </button>
            ))}
          </nav>
          <div className="jp-top-tools">
            <button className="jp-search-btn" onClick={openSearch} onPointerEnter={() => void loadAllFighters().catch(() => {})} aria-label="Search fighters and cards" title="Search (press /)">
              <Search size={16} aria-hidden="true" />
              <span>Search</span>
              <kbd>/</kbd>
            </button>
            <ThemeSwitch />
          </div>
        </header>

        <main className="jp-main" id="main">
          {page === "cards" && (
            <>
              <div className="jp-filters" role="group" aria-label="Filter cards by promotion">
                {["All", ...PROMOTIONS].map((p) => (
                  <button key={p} aria-pressed={promo === p} className={"jp-promo " + (promo === p ? "on" : "")} onClick={() => choosePromo(p)} aria-label={p === "All" ? "All cards" : p}>
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
                  {(() => {
                    const live = ledgerFor(current.id)?.results;
                    if (!live?.live) return null;
                    const t = live.updatedAt ? new Date(live.updatedAt).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" }) : null;
                    return (
                      <span className="jp-live-badge" role="status">
                        Live{" "}
                        <small>
                          {live.bouts.length} of {current.fights.length} results in{t ? ` · updated ${t} ET` : ""}
                        </small>
                      </span>
                    );
                  })()}
                </div>
                {current.fights.length > 0 && card.ready && <CardPulse event={current} fighters={fighters} />}
              </section>

              {!current.fights.length ? (
                <div className="jp-card jp-empty">
                  <h3>Lineup not announced yet</h3>
                  <p>The date is confirmed by the promotion. Bouts are added on the nightly 2:30 a.m. refresh as soon as they're published — every fighter shows N/A until their data is verified.</p>
                </div>
              ) : card.failed ? (
                <div className="jp-card jp-empty" role="alert">
                  <h3>This card didn't load</h3>
                  <p>Check your connection and try again.</p>
                  <button className="jp-btn" onClick={card.retry}>
                    <RotateCcw size={15} aria-hidden="true" /> Try again
                  </button>
                </div>
              ) : !fight || !a || !b || !prediction || !tabProps ? (
                <Loading label="Loading the card…" tall />
              ) : (
                <div className="jp-layout">
                  <CardBouts event={current} fighters={fighters} selected={fight.id} onSelect={setFightId} />
                  <section className="jp-detail" aria-label={`${a.name} vs ${b.name}`}>
                    <div className="jp-matchnav">
                      <button className="jp-btn ghost" onClick={() => step(-1)} disabled={index === 0} aria-label="Previous fight">
                        <ChevronLeft size={16} aria-hidden="true" /> <span>Prev</span>
                      </button>
                      <span className="jp-matchnav-pos">
                        Fight {index + 1} of {current.fights.length} · {cardGroup(fight.section) === "main" ? "Main card" : "Prelims"}
                      </span>
                      <button className="jp-btn ghost" onClick={copyLink} aria-label="Copy this pick to share">
                        <Link2 size={15} aria-hidden="true" /> <span>Share pick</span>
                      </button>
                      <button className="jp-btn ghost" onClick={() => step(1)} disabled={index === current.fights.length - 1} aria-label="Next fight">
                        <span>Next</span> <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    </div>

                    {result && (
                      <div className={"jp-final " + (result.winner === null ? "" : result.winner ? "hit" : "miss")}>
                        <Trophy size={18} aria-hidden="true" />
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
                            Final pick: {result.forecast.pick ?? "none"} {result.winner === null ? "" : result.winner ? "✓" : "✗"}
                            {result.pickChanged && result.opening ? ` · opened ${result.opening.pick ?? "N/A"}` : ""}
                          </span>
                        ) : (
                          <span className="jp-final-tag">No frozen pick · results only</span>
                        )}
                        <button className="jp-btn ghost" onClick={() => goPage("record")}>
                          Review <ArrowUpRight size={13} aria-hidden="true" />
                        </button>
                      </div>
                    )}

                    <Faceoff key={fight.id} a={a} b={b} event={current} fight={fight}>
                      <VerdictStrip p={prediction} rounds={rounds} finish={finish} a={a} b={b} />
                      <PickUpdates eventId={current.id} a={a} b={b} />
                      <div className="jp-tabs" role="tablist" aria-label="Matchup sections" onKeyDown={tabKeys}>
                        {DETAIL_TABS.map((t) => (
                          <button key={t.id} id={"tab-" + t.id} role="tab" aria-selected={detail === t.id} aria-controls="jp-panel" tabIndex={detail === t.id ? 0 : -1} className={detail === t.id ? "on" : ""} onClick={() => setDetail(t.id)}>
                            {t.icon}
                            <span>{t.label}</span>
                          </button>
                        ))}
                      </div>
                    </Faceoff>

                    <div className="jp-panel" id="jp-panel" role="tabpanel" aria-labelledby={"tab-" + detail}>
                      <Suspense fallback={<Loading />}>
                        {detail === "pick" && (
                          <>
                            <div className="jp-pick-grid">
                              <div className="jp-pick-col">
                                <PickCard p={prediction} a={a} b={b} review={review} onReview={updateReview} onMyTake={() => setDetail("notes")} />
                                <EdgeMap p={prediction} a={a} b={b} />
                              </div>
                              <div className="jp-side-col">
                                <RoundsPick fight={fight} a={a} b={b} event={current} compact />
                                <TaleOfTape a={a} b={b} />
                                <FinishScene key={fight.id + String(prediction.pick)} a={a} b={b} event={current} fight={fight} winnerId={prediction.pick} />
                                <MarketOdds fight={fight} a={a} b={b} />
                              </div>
                            </div>
                            <TechnicalRead event={current} fight={fight} compact />
                          </>
                        )}
                        {detail === "stats" && <StatsTab {...tabProps} prediction={prediction} review={review} onNotes={() => setDetail("notes")} />}
                        {detail === "rounds" && <RoundsPick fight={fight} a={a} b={b} event={current} />}
                        {detail === "history" && <HistoryTab {...tabProps} />}
                        {detail === "film" && <FilmRoom {...tabProps} />}
                        {detail === "notes" && <NotesTab {...tabProps} review={review} onSave={updateReview} />}
                      </Suspense>
                    </div>
                  </section>
                </div>
              )}

              <Suspense fallback={null}>
                <HeadshotList />
              </Suspense>
            </>
          )}

          <Suspense fallback={<Loading tall />}>
            {page === "record" && (
              <>
                <section className="jp-page-head">
                  <span className="jp-eyebrow">Predict · record · learn</span>
                  <h1>Track record</h1>
                  <p>Every pick is frozen and timestamped before the fight. If something material changes before the card starts — a replacement, a missed weight, new results, a model update — the change is added as a dated revision with its reason; the opening pick is never edited. Picks lock when the card starts, and the record grades that final pick (opening picks are shown too). Misses get a postmortem and feed the next model version.</p>
                </section>
                <TrackRecord />
              </>
            )}
            {page === "model" && <ModelLab />}
            {page === "champions" && <Champions />}
            {page === "clips" && <ClipsPage />}
          </Suspense>
        </main>
        <footer className="jp-foot">
          <span>JANGO PLAYZ</span>
          <span>Data refreshed nightly · last snapshot {CHECKED_AT} · odds shown for reference only, never used by the model</span>
        </footer>
      </div>
    </SiteNavProvider>
  );
}
