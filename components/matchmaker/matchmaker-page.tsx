"use client";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, AlertTriangle, ArrowLeftRight, BarChart3, Crown, Dices, Eye, History as HistoryIcon, LayoutGrid, Link2, Plus, RotateCcw, Sparkles, Timer, UserRound, X } from "lucide-react";
import { toast } from "@/components/toast";
import { useSiteNav } from "@/components/site-nav";
import { Flag } from "@/components/fighter-meta";
import { TaleOfTape } from "@/components/fight-experience";
import { VerdictStrip } from "@/components/verdict-strip";
import { PickCard } from "@/components/pick-card";
import { EdgeMap } from "@/components/edge-map";
import { RoundsPick } from "@/components/rounds-pick";
import { FinishScene } from "@/components/finish-scene";
import { TechnicalRead } from "@/components/technical-context";
import { PromotionLogo } from "@/components/promotion-logo";
import { predict } from "@/lib/engine";
import { predictRounds } from "@/lib/rounds";
import { predictFinish } from "@/lib/finish";
import { formatHeight, formatReach } from "@/lib/measurements";
import { ageAt } from "@/lib/engine";
import { ufcRecord } from "@/lib/model";
import { SITE_URL } from "@/lib/data";
import { useRoster } from "@/lib/roster";
import {
  MM_DIVISIONS,
  buildFighter,
  candidates,
  clearRecents,
  decodeLink,
  divisionByName,
  encodeLink,
  fmtLongDate,
  initials,
  loadRecents,
  matchmakerBout,
  randomMatchup,
  recentRows,
  resolveKey,
  saveRecent,
  suggestions,
  torontoToday,
  usePortrait,
  useRoundsDoc,
  type BuiltFighter,
  type Candidate,
  type MMRef,
  type Recent,
  type Suggestion,
} from "@/lib/matchmaker";
import { FighterPicker, FormDots, RankBadge } from "./picker";
import { Breakdown, type BreakdownRoster } from "@/components/breakdown/breakdown";
import "@/src/matchmaker.css";

const detailTabs = () => import("@/components/detail-tabs");
const StatsTab = lazy(() => detailTabs().then((m) => ({ default: m.StatsTab })));
const HistoryTab = lazy(() => detailTabs().then((m) => ({ default: m.HistoryTab })));
const FilmRoom = lazy(() => import("@/components/film-room").then((m) => ({ default: m.FilmRoom })));

type Tab = "breakdown" | "pick" | "stats" | "rounds" | "history" | "film";
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "breakdown", label: "Breakdown", icon: <LayoutGrid size={15} aria-hidden="true" /> },
  { id: "pick", label: "Prediction", icon: <Activity size={15} aria-hidden="true" /> },
  { id: "stats", label: "Compare stats", icon: <BarChart3 size={15} aria-hidden="true" /> },
  { id: "rounds", label: "Rounds", icon: <Timer size={15} aria-hidden="true" /> },
  { id: "history", label: "Full history", icon: <HistoryIcon size={15} aria-hidden="true" /> },
  { id: "film", label: "Film room", icon: <Eye size={15} aria-hidden="true" /> },
];
const noop = () => {};
// The last matchup this session, so leaving the tab and coming back keeps it (the page remounts).
let lastHash: string | null = null;
const EMPTY_REVIEW = {};
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const surname = (n: string) => n.replace(/\s+(Jr\.?|Sr\.?|II|III)$/i, "").split(" ").slice(-1)[0];

const Loading = ({ label = "Loading…" }: { label?: string }) => (
  <div className="jp-card jp-loading" role="status" aria-live="polite">
    <span className="jp-loading-bar" aria-hidden="true" />
    <span>{label}</span>
  </div>
);

// ---------- corner card ----------

function CornerCard({
  side,
  ref_,
  cand,
  built,
  today,
  onPick,
  onProfile,
  onClear,
}: {
  side: "a" | "b";
  ref_: MMRef | null;
  cand: Candidate | null;
  built: BuiltFighter | null;
  today: string;
  onPick: () => void;
  onProfile: () => void;
  onClear: () => void;
}) {
  const portrait = usePortrait(ref_);
  const [shape, setShape] = useState<{ src: string; head: boolean } | null>(null);
  const label = side === "a" ? "Red corner" : "Blue corner";
  if (!ref_)
    return (
      <button type="button" className={"mm-corner empty " + side} onClick={onPick}>
        <span className="mm-corner-tag">{label}</span>
        <span className="mm-empty-sil" aria-hidden="true">
          <UserRound size={120} strokeWidth={1} />
        </span>
        <span className="mm-empty-cta">
          <Plus size={20} aria-hidden="true" />
          <strong>Choose a fighter</strong>
          <small>Search 1,200+ UFC fighters</small>
        </span>
      </button>
    );
  const f = built?.fighter;
  const name = f?.name ?? ref_.name;
  const rank = built?.rank ?? cand?.rank;
  const division = built?.division ?? cand?.division;
  const form = f ? recentRows(f, today, 5).map((r) => r.result) : [];
  const ufc = f ? ufcRecord(f, today) : null;
  const head = portrait.headshot || (shape?.src === portrait.src && !!shape?.head);
  return (
    <div className={"mm-corner filled " + side} data-head={head ? "1" : undefined}>
      <span className="mm-corner-tag">{label}</span>
      <span className="mm-corner-bgname" aria-hidden="true">
        {surname(name)}
      </span>
      <div className="mm-portrait">
        {portrait.src ? (
          <img
            key={portrait.src}
            src={portrait.src}
            alt={name}
            decoding="async"
            onLoad={(e) => {
              const im = e.currentTarget;
              setShape({ src: portrait.src!, head: im.naturalWidth / Math.max(1, im.naturalHeight) > 0.9 });
            }}
          />
        ) : (
          <span className={"mm-mono" + (portrait.src === undefined ? " loading" : "")} role="img" aria-label={`${name}: ${portrait.src === undefined ? "photo loading" : "photo unavailable"}`}>
            {initials(name)}
          </span>
        )}
      </div>
      <div className="mm-corner-info">
        <div className="mm-chips">
          {rank && <RankBadge c={{ rank }} />}
          {division && <span className="mm-div">{divisionByName(division)?.short ?? division}</span>}
        </div>
        <span className="mm-country">
          <Flag country={f?.country} /> {f?.country ?? (f ? "Country unverified" : "")}
        </span>
        <h2>{name}</h2>
        {(f?.nickname ?? cand?.nickname) && <span className="mm-nick">“{f?.nickname ?? cand?.nickname}”</span>}
        <div className="mm-rec">
          <strong>{f?.record ?? cand?.record ?? "—"}</strong>
          {f && (built?.proKnown === false ? <span className="scope" title={f.recordNote}>UFC record · pre-UFC not loaded</span> : <span>{ufc && /^0-0(-0)?$/.test(ufc) ? "UFC debut" : `[UFC: ${ufc ?? "unverified"}]`}</span>)}
        </div>
        {form.length > 0 && <FormDots results={form} size="md" />}
        <div className="mm-corner-actions">
          <button type="button" className="mm-btn" onClick={onPick}>
            <ArrowLeftRight size={14} aria-hidden="true" /> Change
          </button>
          <button type="button" className="mm-btn ghost" onClick={onProfile} disabled={!built}>
            <UserRound size={14} aria-hidden="true" /> Profile
          </button>
          <button type="button" className="mm-icon-btn sm" onClick={onClear} aria-label={`Clear ${label.toLowerCase()}`}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- tape (between the corners) ----------

function Tape({ a, b, today }: { a: BuiltFighter; b: BuiltFighter; today: string }) {
  const fa = a.fighter, fb = b.fighter;
  const ago = (d?: string) => {
    if (!d) return "N/A";
    const m = Math.round((Date.parse(today) - Date.parse(d)) / (30.44 * 86400000));
    return m < 1 ? "This month" : m < 12 ? `${m} mo ago` : `${(m / 12).toFixed(1)} yrs ago`;
  };
  const rows: [string, string, string, number | null][] = [
    ["Height", formatHeight(fa.height), formatHeight(fb.height), fa.height && fb.height ? fa.height - fb.height : null],
    ["Reach", formatReach(fa.reach), formatReach(fb.reach), fa.reach && fb.reach ? fa.reach - fb.reach : null],
    ["Age", String(ageAt(fa, today) ?? "N/A"), String(ageAt(fb, today) ?? "N/A"), null],
    ["Stance", fa.stance ?? "N/A", fb.stance ?? "N/A", null],
    ["Division", divisionByName(a.division)?.short ?? a.division, divisionByName(b.division)?.short ?? b.division, null],
    ["Last fight", ago(a.lastFight), ago(b.lastFight), null],
  ];
  return (
    <dl className="mm-tape">
      {rows.map(([k, x, y, d]) => (
        <div key={k}>
          <dd className={d !== null && d > 1 ? "edge" : ""}>{x}</dd>
          <dt>{k}</dt>
          <dd className={d !== null && d < -1 ? "edge" : ""}>{y}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------- quick start ----------

function QuickStart({ list, recents, onPick, onRandom, onClearRecents }: { list: Suggestion[]; recents: Recent[]; onPick: (s: Suggestion | Recent) => void; onRandom: () => void; onClearRecents: () => void }) {
  const groups: [string, ReactNode, Suggestion[]][] = [
    ["Title picture", <Crown size={14} key="c" aria-hidden="true" />, list.filter((s) => s.group === "title")],
    ["Superfights", <Sparkles size={14} key="s" aria-hidden="true" />, list.filter((s) => s.group === "super")],
    ["Contenders", <Activity size={14} key="a" aria-hidden="true" />, list.filter((s) => s.group === "contender")],
  ];
  const [open, setOpen] = useState(0);
  return (
    <section className="mm-quick" aria-label="Quick start">
      <div className="mm-quick-tabs" role="tablist" aria-label="Suggestion groups">
        {recents.length > 0 && (
          <button type="button" role="tab" aria-selected={open === -1} className={open === -1 ? "on" : ""} onClick={() => setOpen(-1)}>
            <HistoryIcon size={14} aria-hidden="true" /> Recent
          </button>
        )}
        {groups.map(([label, icon], i) => (
          <button type="button" role="tab" key={label} aria-selected={open === i} className={open === i ? "on" : ""} onClick={() => setOpen(i)}>
            {icon} {label}
          </button>
        ))}
        <button type="button" className="mm-random" onClick={onRandom}>
          <Dices size={15} aria-hidden="true" /> Random
        </button>
      </div>
      <div className="mm-quick-row" role="tabpanel">
        {open === -1
          ? recents.map((r) => (
              <button type="button" key={r.a + r.b + r.rounds + (r.div ?? "")} className="mm-sugg" onClick={() => onPick(r)}>
                <strong>
                  {surname(r.names[0])} vs {surname(r.names[1])}
                </strong>
                <small>
                  {r.rounds} rds{r.div ? ` · ${divisionByName(r.div)?.short}` : ""}
                  {r.title ? " · title" : ""}
                </small>
              </button>
            ))
          : groups[Math.max(0, open)][2].map((s) => (
              <button type="button" key={s.a + s.b} className={"mm-sugg " + s.group} onClick={() => onPick(s)}>
                <strong>{s.title}</strong>
                <small>{s.tag}</small>
              </button>
            ))}
        {open === -1 && (
          <button type="button" className="mm-sugg clear" onClick={onClearRecents}>
            <small>Clear recent</small>
          </button>
        )}
      </div>
    </section>
  );
}

// ---------- page ----------

export function MatchmakerPage({ bootHash }: { bootHash?: string }) {
  const nav = useSiteNav();
  const rosterState = useRoster(true);
  const roster = rosterState.roster;
  const rounds = useRoundsDoc(true);
  const [today] = useState(torontoToday);
  const boot = useMemo(() => decodeLink(lastHash ?? (bootHash || (typeof window !== "undefined" ? window.location.hash : ""))) ?? {}, [bootHash]);
  const [aKey, setA] = useState<string | null>(boot.a ?? null);
  const [bKey, setB] = useState<string | null>(boot.b ?? null);
  const [roundsPick, setRoundsPick] = useState<3 | 5 | null>(boot.rounds ?? null);
  const [divPick, setDivPick] = useState<string | null>(boot.div ?? null);
  const [title, setTitle] = useState<boolean>(!!boot.title);
  const [picker, setPicker] = useState<null | "a" | "b">(null);
  const [tab, setTab] = useState<Tab>("breakdown");
  const [recents, setRecents] = useState<Recent[]>(() => loadRecents());
  const [phase, setPhase] = useState<"idle" | "computing" | "shown">("idle");

  const list = useMemo(() => candidates(roster), [roster]);
  const byKey = useMemo(() => new Map(list.map((c) => [c.key, c])), [list]);
  const refA = useMemo(() => resolveKey(aKey, roster), [aKey, roster]);
  const refB = useMemo(() => resolveKey(bKey, roster), [bKey, roster]);
  const candA = refA ? (byKey.get(refA.key) ?? null) : null;
  const candB = refB ? (byKey.get(refB.key) ?? null) : null;
  const dataReady = !!roster && rounds.status !== "loading";
  const ctx = useMemo(() => (roster && dataReady ? { roster, rounds: rounds.doc, today } : null), [roster, dataReady, rounds.doc, today]);
  const builtA = useMemo(() => (ctx && refA ? buildFighter(refA, ctx) : null), [ctx, refA]);
  const builtB = useMemo(() => (ctx && refB ? buildFighter(refB, ctx) : null), [ctx, refB]);
  const portraitA = usePortrait(refA), portraitB = usePortrait(refB);

  // Unknown keys from an old link: tell the viewer instead of silently dropping them.
  useEffect(() => {
    if (!roster) return;
    for (const [k, set] of [[aKey, setA], [bKey, setB]] as const)
      if (k && !resolveKey(k, roster)) {
        set(null);
        toast.error("That fighter isn't in the UFC roster any more");
      }
  }, [roster, aKey, bKey]);

  const mixed = !!(candA && candB && candA.women !== candB.women);
  const champ = (x: BuiltFighter | null) => x?.rank.chip?.kind === "champ" || x?.rank.chip?.kind === "interim";
  const divA = builtA?.division ?? candA?.division, divB = builtB?.division ?? candB?.division;
  const cross = !!(divA && divB && divA !== divB);
  const heavier = [divA, divB].map((d) => divisionByName(d)).filter(Boolean).sort((x, y) => y!.limit - x!.limit)[0]?.name ?? divA ?? "Lightweight";
  const division = divPick && divisionByName(divPick) ? divPick : cross ? heavier : (divA ?? divB ?? "Lightweight");
  const roundsN: 3 | 5 = roundsPick ?? (title || champ(builtA) || champ(builtB) ? 5 : 3);

  const display = useCallback(
    (x: BuiltFighter | null, p: { src: string | null | undefined }) => (x ? { ...x.fighter, image: p.src ?? x.fighter.image ?? undefined } : null),
    [],
  );
  const a = useMemo(() => display(builtA, portraitA), [builtA, portraitA.src, display]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = useMemo(() => display(builtB, portraitB), [builtB, portraitB.src, display]); // eslint-disable-line react-hooks/exhaustive-deps
  const bout = useMemo(() => (builtA && builtB && !mixed ? matchmakerBout(builtA.fighter, builtB.fighter, division, roundsN, today, title, { a: divA, b: divB }) : null), [builtA, builtB, mixed, division, roundsN, today, title, divA, divB]);
  const prediction = useMemo(() => (bout && builtA && builtB ? predict(bout.fight, builtA.fighter, builtB.fighter, bout.event) : null), [bout, builtA, builtB]);
  const roundsPred = useMemo(() => (bout && builtA && builtB ? predictRounds(bout.fight, builtA.fighter, builtB.fighter, bout.event) : null), [bout, builtA, builtB]);
  const finish = useMemo(() => (bout && builtA && builtB && prediction ? predictFinish(bout.fight, builtA.fighter, builtB.fighter, bout.event, prediction.pick) : null), [bout, builtA, builtB, prediction]);
  const matchId = bout?.fight.id ?? null;

  // A short reveal each time the matchup changes (skipped for reduced motion).
  useEffect(() => {
    if (!matchId) {
      setPhase("idle");
      return;
    }
    if (reduced()) {
      setPhase("shown");
      return;
    }
    setPhase("computing");
    const t = window.setTimeout(() => setPhase("shown"), 750);
    return () => clearTimeout(t);
  }, [matchId]);

  // Deep link: a plain #anchor (the only part of a link the published artifact keeps).
  useEffect(() => {
    const hash = aKey || bKey ? encodeLink({ a: refA?.key ?? aKey ?? "-", b: refB?.key ?? bKey ?? "-", rounds: roundsN, div: divPick ?? undefined, title }) : "";
    lastHash = hash;
    const url = window.location.pathname + window.location.search + hash;
    if (window.location.hash !== hash) window.history.replaceState(null, "", url);
  }, [aKey, bKey, refA, refB, roundsN, divPick, title]);
  useEffect(() => {
    const onHash = () => {
      const l = decodeLink(window.location.hash);
      if (!l) return;
      setA(l.a ?? null);
      setB(l.b ?? null);
      setRoundsPick(l.rounds ?? null);
      setDivPick(l.div ?? null);
      setTitle(!!l.title);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Remember finished matchups on this device.
  useEffect(() => {
    if (!matchId || !builtA || !builtB) return;
    setRecents(saveRecent({ a: builtA.ref.key, b: builtB.ref.key, rounds: roundsN, div: divPick ?? undefined, title, names: [builtA.fighter.name, builtB.fighter.name], at: Date.now() }));
  }, [matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sugg = useMemo(() => suggestions(roster), [roster]);

  function choose(corner: "a" | "b", key: string) {
    if (corner === "a") setA(key);
    else setB(key);
    setRoundsPick(null);
    setDivPick(null);
    setTitle(false);
    setPicker(null);
    setTab("breakdown");
  }
  function apply(s: Suggestion | Recent) {
    setA(s.a);
    setB(s.b);
    const isSugg = "group" in s;
    setRoundsPick(isSugg ? null : s.rounds);
    setTitle(isSugg ? s.titleFight : !!s.title);
    setDivPick(isSugg ? (s.division === heavierOf(s.a, s.b) ? null : s.division) : (s.div ?? null));
    setTab("breakdown");
    setTimeout(() => document.querySelector(".mm-stage")?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" }), 60);
  }
  function heavierOf(x: string, y: string) {
    const dx = byKey.get(x)?.division, dy = byKey.get(y)?.division;
    if (dx === dy) return dx;
    return [dx, dy].map((d) => divisionByName(d)).filter(Boolean).sort((p, q) => q!.limit - p!.limit)[0]?.name;
  }
  function random() {
    const s = randomMatchup(roster);
    if (s) apply(s);
  }
  function swap() {
    setA(bKey);
    setB(aKey);
  }
  function reset() {
    setA(null);
    setB(null);
    setRoundsPick(null);
    setDivPick(null);
    setTitle(false);
  }
  async function copyLink() {
    if (!aKey || !bKey) return;
    const hash = encodeLink({ a: refA?.key ?? aKey, b: refB?.key ?? bKey, rounds: roundsN, div: divPick ?? undefined, title });
    const base = /github\.io$/.test(window.location.hostname) ? window.location.origin + window.location.pathname + "?p=matchmaker" : SITE_URL;
    const winner = prediction?.pick && a && b ? (prediction.pick === a.id ? a : b) : null;
    const text = [
      `Jango Playz Matchmaker — ${a?.name ?? refA?.name} vs ${b?.name ?? refB?.name} (${division}, ${roundsN} rounds)`,
      winner && prediction ? `Pick: ${winner.name} (${prediction.confidence}%, ${prediction.tier})` : "",
      roundsPred ? `Rounds: ${roundsPred.side} ${roundsPred.line}` : "",
      finish ? `Method: ${finish.label}` : "",
      `As of ${fmtLongDate(today)}`,
      base + hash,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Matchup link copied");
    } catch {
      toast.error("Couldn't copy on this device");
    }
  }
  function tabKeys(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = TABS.findIndex((t) => t.id === tab), n = TABS.length;
    const j = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    setTab(TABS[j].id);
    document.getElementById("mmtab-" + TABS[j].id)?.focus();
  }

  const stageRef = useRef<HTMLDivElement>(null);
  const both = !!(refA && refB);
  const ready = !!(bout && prediction && a && b && builtA && builtB);
  const tabProps = ready ? { a: a!, b: b!, event: bout!.event, fight: bout!.fight } : null;
  const bdRoster = useMemo<BreakdownRoster | null>(() => (roster ? { roster, status: "ready" } : null), [roster]);
  const bdNotes = useMemo(() => [...(builtA?.notes ?? []), ...(builtB?.notes ?? [])], [builtA, builtB]);
  const sexDivs = MM_DIVISIONS.filter((d) => d.women === (candA?.women ?? candB?.women ?? false));

  return (
    <div className="mm-page">
      <header className="mm-head">
        <div>
          <span className="jp-eyebrow">Matchmaker · build any UFC fight</span>
          <h1>Matchmaker</h1>
          <p>Pick two UFC fighters and get the full main-card breakdown: winner, rounds and method, with every stat and reason. Built on each fighter's record and form as of today.</p>
        </div>
        <div className="mm-asof" aria-live="polite">
          <span>Analysis as of</span>
          <strong>{fmtLongDate(today)}</strong>
          <small>{roster ? `UFC fights through ${fmtLongDate(roster.asOf)}` : rosterState.status === "error" ? "Roster didn't load" : "Loading the UFC roster…"}</small>
        </div>
      </header>

      <QuickStart
        list={sugg}
        recents={recents}
        onPick={apply}
        onRandom={random}
        onClearRecents={() => {
          clearRecents();
          setRecents([]);
        }}
      />

      <section className="jp-detail mm-detail" aria-label="Matchup">
        <div className={"mm-stage" + (both ? " both" : "") + (phase === "computing" ? " computing" : "")} ref={stageRef}>
          <div className="mm-topline">
            <span className="mm-topline-l">
              <PromotionLogo promotion="UFC" />
              <span>
                Matchmaker · {aKey || bKey ? `${title ? "Title fight · " : ""}${division}` : "Build a fight"}
              </span>
            </span>
            <span className="mm-topline-r">
              {roundsN} rounds<span className="mm-hypo"> · Hypothetical</span>
              {both && (
                <button type="button" className="mm-icon-btn sm light" onClick={reset} aria-label="Start over" title="Start over">
                  <RotateCcw size={14} aria-hidden="true" />
                </button>
              )}
            </span>
          </div>
          <div className="mm-corners">
            <CornerCard side="a" ref_={refA} cand={candA} built={builtA} today={today} onPick={() => setPicker("a")} onProfile={() => builtA && nav.openFighter(builtA.profileTarget)} onClear={() => setA(null)} />
            <div className="mm-center">
              <span className={"mm-vs" + (phase === "computing" ? " spin" : "")} aria-hidden="true">
                VS
              </span>
              <button type="button" className="mm-swap" onClick={swap} disabled={!aKey && !bKey} aria-label="Swap corners" title="Swap corners">
                <ArrowLeftRight size={16} aria-hidden="true" />
                <span>Swap</span>
              </button>
              {builtA && builtB && <Tape a={builtA} b={builtB} today={today} />}
            </div>
            <CornerCard side="b" ref_={refB} cand={candB} built={builtB} today={today} onPick={() => setPicker("b")} onProfile={() => builtB && nav.openFighter(builtB.profileTarget)} onClear={() => setB(null)} />
          </div>

          <div className="mm-options" role="group" aria-label="Bout options">
            <div className="mm-opt-group">
              <span className="mm-opt-label">Rounds</span>
              <span className="mm-seg dark" role="group" aria-label="Scheduled rounds">
                {([3, 5] as const).map((n) => (
                  <button type="button" key={n} aria-pressed={roundsN === n} className={roundsN === n ? "on" : ""} onClick={() => setRoundsPick(n)}>
                    {n}
                  </button>
                ))}
              </span>
            </div>
            <label className="mm-opt-group">
              <span className="mm-opt-label">Weight class</span>
              <select value={division} onChange={(e) => setDivPick(e.target.value)} aria-label="Bout weight class">
                {sexDivs.map((d) => (
                  <option key={d.code} value={d.name}>
                    {d.name} · {d.limit} lb
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={"mm-toggle" + (title ? " on" : "")}
              aria-pressed={title}
              onClick={() => {
                setTitle(!title);
                if (!title) setRoundsPick(null);
              }}
            >
              <Crown size={14} aria-hidden="true" /> Title fight
            </button>
            <span className="mm-opt-spacer" />
            <button type="button" className="mm-btn light" onClick={random}>
              <Dices size={15} aria-hidden="true" /> Random
            </button>
            <button type="button" className="mm-btn light" onClick={copyLink} disabled={!both}>
              <Link2 size={15} aria-hidden="true" /> Copy link
            </button>
          </div>

          {cross && !mixed && (
            <div className="mm-cross" role="note">
              <AlertTriangle size={17} aria-hidden="true" />
              <p>
                <strong>Catchweight / cross-division — the model is less reliable here.</strong> {refA?.name} ({divisionByName(divA)?.short}) and {refB?.name} ({divisionByName(divB)?.short}) fight{" "}
                {Math.abs((divisionByName(divA)?.limit ?? 0) - (divisionByName(divB)?.limit ?? 0))} lb apart; the bout is set at {division.toLowerCase()}. A one-division move is treated as free (movers-up held their own in our backtest); beyond that, each extra pound of natural size shifts the odds toward the bigger fighter.
                That size rule is a rule of thumb, not backtested, so read this pick with extra caution.
              </p>
            </div>
          )}
          {mixed && (
            <div className="mm-cross" role="alert">
              <AlertTriangle size={17} aria-hidden="true" />
              <p>
                <strong>Men's and women's divisions can't be matched.</strong> Pick two fighters from the same side of the sport.
              </p>
            </div>
          )}

          {both && !mixed && !ready && (
            <div className="mm-wait">
              {rosterState.status === "error" ? (
                <>
                  <span>The UFC roster didn't load. Check your connection.</span>
                  <button type="button" className="mm-btn light" onClick={() => window.location.reload()}>
                    <RotateCcw size={14} aria-hidden="true" /> Try again
                  </button>
                </>
              ) : (
                <>
                  <span className="jp-loading-bar" aria-hidden="true" />
                  <span>Loading UFC fight data (roster and round-by-round lines)…</span>
                </>
              )}
            </div>
          )}

          {ready && (
            <div className={"mm-reveal" + (phase === "computing" ? " hold" : "")} key={matchId}>
              {phase === "computing" ? (
                <div className="mm-computing" role="status">
                  <span className="mm-scan" aria-hidden="true" />
                  <strong>Running the engine</strong>
                  <small>14 factors · rounds · method · as of {fmtLongDate(today)}</small>
                </div>
              ) : (
                <>
                  <VerdictStrip p={prediction!} rounds={roundsPred} finish={finish} a={a!} b={b!} />
                  <div className="jp-tabs mm-tabs" role="tablist" aria-label="Matchup sections" onKeyDown={tabKeys}>
                    {TABS.map((t) => (
                      <button key={t.id} id={"mmtab-" + t.id} role="tab" aria-selected={tab === t.id} aria-controls="mm-panel" tabIndex={tab === t.id ? 0 : -1} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                        {t.icon}
                        <span>{t.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {!both && (
          <div className="mm-intro">
            <div>
              <b>1</b>
              <span>
                <strong>Pick the red corner</strong>Search anyone who's fought in the UFC since 2021, or signed debutants.
              </span>
            </div>
            <div>
              <b>2</b>
              <span>
                <strong>Pick the blue corner</strong>The list opens on the same division. Switch to All divisions for a superfight.
              </span>
            </div>
            <div>
              <b>3</b>
              <span>
                <strong>Get the breakdown</strong>Same engine, rounds and method models as every card bout, as of today.
              </span>
            </div>
          </div>
        )}

        {ready && phase === "shown" && tabProps && (
          <div className="jp-panel mm-panel" id="mm-panel" role="tabpanel" aria-labelledby={"mmtab-" + tab} key={matchId + tab}>
            <Suspense fallback={<Loading />}>
              {tab === "breakdown" && <Breakdown a={a!} b={b!} prediction={prediction!} rounds={roundsPred} finish={finish} event={bout!.event} fight={bout!.fight} roster={bdRoster!} mode="matchmaker" divisions={{ a: builtA!.division, b: builtB!.division }} cross={cross} notes={bdNotes} />}
              {tab === "pick" && (
                <>
                  <div className="jp-pick-grid">
                    <div className="jp-pick-col">
                      <PickCard p={prediction!} a={a!} b={b!} review={EMPTY_REVIEW} onReview={noop} onMyTake={noop} actions={false} />
                      <EdgeMap p={prediction!} a={a!} b={b!} />
                    </div>
                    <div className="jp-side-col">
                      <RoundsPick fight={bout!.fight} a={a!} b={b!} event={bout!.event} compact />
                      <TaleOfTape a={a!} b={b!} />
                      <FinishScene key={matchId + String(prediction!.pick)} a={a!} b={b!} event={bout!.event} fight={bout!.fight} winnerId={prediction!.pick} />
                    </div>
                  </div>
                  <TechnicalRead event={bout!.event} fight={bout!.fight} compact />
                </>
              )}
              {tab === "stats" && <StatsTab {...tabProps} prediction={prediction!} review={EMPTY_REVIEW} onNotes={noop} />}
              {tab === "rounds" && <RoundsPick fight={bout!.fight} a={a!} b={b!} event={bout!.event} />}
              {tab === "history" && <HistoryTab {...tabProps} />}
              {tab === "film" && <FilmRoom {...tabProps} />}
            </Suspense>
          </div>
        )}
      </section>

      <FighterPicker
        open={picker !== null}
        corner={picker ?? "a"}
        list={list}
        roster={roster}
        other={picker === "a" ? candB : picker === "b" ? candA : null}
        currentKey={picker === "a" ? (refA?.key ?? null) : (refB?.key ?? null)}
        onClose={() => setPicker(null)}
        onPick={(k) => choose(picker ?? "a", k)}
      />
    </div>
  );
}
