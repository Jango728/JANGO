"use client";
/**
 * Breakdown: the infographic overview of one bout — win probability, how it ends, rounds, the case and
 * the counter-argument, the projected finish film, striking & grappling vs the division, skill shape,
 * recent form, tale of the tape, common opponents and the data behind the call.
 *
 * Shared by the Matchmaker (custom bouts) and every Fight center bout. It never runs its own winner or
 * rounds model: the caller passes the SAME prediction, rounds and finish objects the verdict strip and
 * Prediction tab show, so the numbers here always match them. Every helper reads only bouts before the
 * event date, so a finished bout's breakdown is pre-fight only.
 *
 * The UFC roster (division averages, skill percentiles) is optional: while it loads, those two cards show
 * a skeleton and everything else renders. `roster.request` is called when either card nears the viewport.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { AlertTriangle, BarChart3, Check, Gauge, RotateCcw, Ruler, Scale, Shield, Swords, Target, Timer, TrendingUp, Trophy, Users, Zap } from "lucide-react";
import { Portrait } from "@/components/fight-experience";
import { FinishScene } from "@/components/finish-scene";
import { FighterName } from "@/components/site-nav";
import { ageAt, shortName, type EnginePrediction } from "@/lib/engine";
import { FINISH_LABELS, predictFinish, type FinishMethod, type FinishPrediction } from "@/lib/finish";
import type { RoundsPrediction } from "@/lib/rounds";
import { formatHeight, formatReach } from "@/lib/measurements";
import { divisionAverages, type Roster, type StatKey } from "@/lib/roster-load";
import type { Event, Fight, Fighter } from "@/lib/types";
import { RADAR_AXES, commonOpponents, displayStats, divisionByName, fmtLongDate, methodLetter, radarPercentiles, recentRows, type DisplayStats } from "@/lib/breakdown";
import type { LockInfo } from "@/lib/displayed-pick";
import "@/src/breakdown.css";

export type BreakdownRoster = {
  roster: Roster | null;
  status: "idle" | "loading" | "ready" | "error";
  /** Start loading (idempotent). Called when a card that needs the roster nears the viewport. */
  request?: () => void;
};

/** A finished bout: the official result and how the frozen (graded) pick did. */
export type BreakdownResult = {
  winner: string | null;
  how: string;
  round: number;
  time: string;
  ou: "Over" | "Under";
  line: number;
  graded: {
    pick: string | null;
    confidence: number | null;
    winner: boolean | null;
    rounds: { side: "Over" | "Under"; line: number } | null;
    roundsHit: boolean | null;
    method: string | null;
    methodHit: boolean | null;
  } | null;
};

export type BreakdownProps = {
  a: Fighter;
  b: Fighter;
  /** The bout's displayed prediction (same object as the verdict strip). */
  prediction: EnginePrediction;
  rounds: RoundsPrediction | null;
  /** Method call for the picked winner (same object as the verdict strip). */
  finish: FinishPrediction | null;
  event: Event;
  fight: Fight;
  roster: BreakdownRoster;
  /** "matchmaker" = custom bout (cross-division notes, portraits in the win card); "card" = a real card bout. */
  mode?: "matchmaker" | "card";
  /** Each fighter's own division, for the cross-division weight gap (Matchmaker). */
  divisions?: { a?: string; b?: string };
  cross?: boolean;
  /** Honest notes about the data behind the call. */
  notes?: string[];
  result?: BreakdownResult | null;
  /** Locked or finished card bout: `prediction` / `rounds` / `finish` carry the frozen final pick (lib/displayed-pick.ts). */
  lock?: LockInfo | null;
};

type Shared = BreakdownProps & { data: Analysis; rosterData: RosterData | null };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const sur = (f: Fighter) => shortName(f.name);
const stanceOf = (f: Fighter) => (f.stance && /[a-z]/i.test(f.stance) ? f.stance : "Stance N/A");
const mark = (hit: boolean | null) => (hit === null ? null : hit ? <span className="ok" aria-label="right">✓</span> : <span className="no" aria-label="wrong">✗</span>);

/** Animate a number from 0 once mounted (instant when the viewer prefers reduced motion). */
function useGrow(target: number, deps: unknown[] = []) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(target);
      return;
    }
    setV(0);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setV(target)));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ...deps]);
  return v;
}

/** Calls `cb` once the element is within ~one screen of the viewport (immediately without IntersectionObserver). */
function useWhenNear(ref: React.RefObject<HTMLElement | null>, active: boolean, cb?: () => void) {
  useEffect(() => {
    if (!active || !cb) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      cb();
      return;
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          io.disconnect();
          cb();
        }
      },
      { rootMargin: "700px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, active, cb]);
}

function Card({ icon, title, sub, className = "", children, style, innerRef, label }: { icon: ReactNode; title: string; sub?: ReactNode; className?: string; children: ReactNode; style?: CSSProperties; innerRef?: Ref<HTMLElement>; label?: string }) {
  return (
    <section className={"mm-card " + className} style={style} ref={innerRef} aria-label={label ?? title}>
      <header className="mm-card-head">
        <h3>
          {icon}
          {title}
        </h3>
        {sub && <span>{sub}</span>}
      </header>
      {children}
    </section>
  );
}

function NoUfcData({ both, who, what = "striking or grappling", short = false }: { both: boolean; who?: string; what?: string; short?: boolean }) {
  return (
    <div className="mm-nodata" role="note">
      <BarChart3 size={18} aria-hidden="true" />
      <div>
        <strong>No UFC {what} data yet</strong>
        <p>
          {short
            ? "Percentiles need official UFC stat lines, and neither fighter has one before this bout."
            : `${both ? "Neither fighter has" : `${who} has`} a UFC fight with official stats before this bout (Contender Series and regional fights aren't tracked by UFCStats). The engine leaves these factors out instead of guessing.`}
        </p>
      </div>
    </div>
  );
}

// ---------- win probability ----------

function ResultLine({ r }: { r: BreakdownResult }) {
  const g = r.graded;
  const tone = g?.winner === true ? " hit" : g?.winner === false ? " miss" : "";
  const decided = !!r.winner && !/draw|no contest/i.test(r.how);
  return (
    <div className={"mm-result" + tone} role="note" aria-label="Result">
      <Trophy size={16} aria-hidden="true" />
      <p>
        <b>Result:</b> {decided ? `${r.winner} won by ${r.how}` : r.how} · R{r.round} {r.time}
        {g ? (
          <>
            {" "}
            — our pick{" "}
            <b>
              {g.pick ?? "N/A"}
              {g.pick && g.confidence != null ? ` ${g.confidence}%` : ""}
            </b>{" "}
            {mark(g.winner)}
          </>
        ) : (
          " — no frozen pick for this bout"
        )}
        {g && (g.rounds || g.method) && (
          <small>
            {g.rounds ? (
              <>
                Rounds {g.rounds.side} {g.rounds.line} {mark(g.roundsHit)} (went {r.ou} {r.line})
              </>
            ) : null}
            {g.rounds && g.method ? " · " : ""}
            {g.method ? (
              <>
                Method {g.method} {mark(g.methodHit)}
              </>
            ) : null}
            {" · the graded pick, frozen before the fight"}
          </small>
        )}
      </p>
    </div>
  );
}

function WinCard({ a, b, prediction: p, mode, result, lock }: Shared) {
  const winA = p.pick === a.id, winB = p.pick === b.id;
  const pa = p.confidence === null ? null : winA ? p.confidence : 100 - p.confidence;
  const grow = useGrow(pa ?? 50, [a.id, b.id]);
  const growE = useGrow(1, [a.id, b.id]);
  const card = mode === "card";
  // Same order the pick's reasons use; the internal weights themselves are never shown.
  const top = useMemo(
    () =>
      p.signals
        .filter((sg) => sg.score !== null && Math.abs(sg.score) >= 0.03)
        .sort((x, y) => Math.abs(y.score! * y.weight) - Math.abs(x.score! * x.weight))
        .slice(0, 4),
    [p],
  );
  return (
    <Card icon={<Target size={15} aria-hidden="true" />} title="Win probability" sub={lock ? `Locked pick · engine v${p.version}` : `Engine v${p.version} · calibrated`} className="mm-win span2">
      {/* The Fight center shows both portraits large right above the tabs, so card bouts skip the avatars here. */}
      <div className={"mm-win-names" + (card ? " plain" : "")}>
        <div className={"a" + (winA ? " fav" : "")}>
          {!card && <Portrait f={a} small />}
          <span>
            <strong>{a.name}</strong>
            <small>Red corner</small>
          </span>
        </div>
        <div className={"b" + (winB ? " fav" : "")}>
          <span>
            <strong>{b.name}</strong>
            <small>Blue corner</small>
          </span>
          {!card && <Portrait f={b} small />}
        </div>
      </div>
      {pa === null ? (
        <div className="mm-win-na">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            <b>No pick: N/A.</b> {p.pendingReason}
          </span>
        </div>
      ) : (
        <>
          <div className="mm-winbar" role="img" aria-label={`${a.name} ${pa}%, ${b.name} ${100 - pa}%`}>
            <i className="a" style={{ width: `${grow}%` }}>
              <b>{pa}%</b>
            </i>
            <i className="b" style={{ width: `${100 - grow}%` }}>
              <b>{100 - pa}%</b>
            </i>
            <span className="mm-winbar-mid" aria-hidden="true" />
          </div>
          <p className="mm-win-line">
            <strong>{winA ? a.name : b.name}</strong> {p.confidence}% · <span className="mm-tier">{p.tier}</span>
            <span className={"mm-ev ev-" + p.evidenceLabel.toLowerCase()}>Data: {p.evidenceLabel}</span>
          </p>
        </>
      )}
      {result && <ResultLine r={result} />}
      {top.length > 0 && (
        <div className="mm-keyedges" aria-label="Biggest edges">
          <p className="mm-sub-h">Biggest edges</p>
          {top.map((sg) => {
            const w = Math.max(8, Math.min(100, Math.abs(sg.score!) * 100)) * growE;
            const side = sg.score! > 0 ? "a" : "b";
            return (
              <div key={sg.id} className={"mm-ke " + side}>
                <div className="l">{side === "a" && <i style={{ width: `${w}%` }} />}</div>
                <span>
                  <strong>{sg.label}</strong>
                  <small>{side === "a" ? sur(a) : sur(b)}</small>
                </span>
                <div className="r">{side === "b" && <i style={{ width: `${w}%` }} />}</div>
              </div>
            );
          })}
        </div>
      )}
      {p.models.length > 0 && <div className="mm-models" aria-label="Sub-model votes">
        {p.models.map((m) => (
          <span key={m.id} className={m.lean === null ? "none" : m.lean === a.id ? "a" : "b"} title={m.lean === null ? "No clear lean" : `Leans ${m.lean === a.id ? a.name : b.name}`}>
            <em>{m.label}</em>
            <b>{m.lean === null ? "Even" : m.lean === a.id ? sur(a) : sur(b)}</b>
          </span>
        ))}
      </div>}
    </Card>
  );
}

// ---------- method ----------

const METHODS: FinishMethod[] = ["ko", "submission", "decision"];
const SHORT: Record<FinishMethod, string> = { ko: "KO/TKO", submission: "Sub", decision: "Decision" };

function Donut({ probs, lead }: { probs: Record<FinishMethod, number>; lead: FinishMethod }) {
  let cum = 0;
  const total = METHODS.reduce((s, m) => s + probs[m], 0) || 1;
  const grow = useGrow(1, [probs.ko, probs.submission]);
  return (
    <svg viewBox="0 0 120 120" className="mm-donut" role="img" aria-label={METHODS.map((m) => `${FINISH_LABELS[m]} ${pct(probs[m] / total)}`).join(", ")}>
      <circle cx="60" cy="60" r="46" className="track" pathLength={100} />
      {METHODS.map((m) => {
        const v = (probs[m] / total) * 100 * grow;
        const el = <circle key={m} cx="60" cy="60" r="46" className={"seg " + m + (m === lead ? " lead" : "")} pathLength={100} style={{ strokeDasharray: `${Math.max(0, v - 0.8)} ${100}`, strokeDashoffset: -cum }} />;
        cum += v;
        return el;
      })}
      <text x="60" y="56" className="big">
        {pct(probs[lead] / total)}
      </text>
      <text x="60" y="73" className="small">
        {SHORT[lead]}
      </text>
    </svg>
  );
}

function MethodCard({ a, b, prediction: p, finish, data, lock }: Shared) {
  const { finA: fa, finB: fb } = data;
  // The picked side's split is the exact object the verdict strip shows.
  const pick = p.pick === a.id || p.pick === b.id ? finish : null;
  const winner = p.pick === a.id ? a : p.pick === b.id ? b : null;
  const pa = p.confidence === null ? null : (p.pick === a.id ? p.confidence : 100 - p.confidence) / 100;
  const cells = pa === null || !fa || !fb ? [] : [...METHODS.map((m) => ({ side: "a" as const, f: a, m, v: pa * fa.probabilities[m] })), ...METHODS.map((m) => ({ side: "b" as const, f: b, m, v: (1 - pa) * fb.probabilities[m] }))];
  const top = cells.reduce<(typeof cells)[number] | null>((t, c) => (!t || c.v > t.v ? c : t), null);
  return (
    <Card icon={<Zap size={15} aria-hidden="true" />} title="How it ends" sub={winner ? `If ${sur(winner)} wins` : "Needs a winner pick"} className="mm-method">
      {pick && winner ? (
        <div className="mm-method-top">
          <Donut probs={pick.probabilities} lead={pick.method} />
          <ul className="mm-legend">
            {METHODS.map((m) => (
              <li key={m} className={m + (m === pick.method ? " lead" : "")}>
                <i aria-hidden="true" />
                <span>{FINISH_LABELS[m]}</span>
                <b>{pct(pick.probabilities[m])}</b>
              </li>
            ))}
            <li className="note">{lock ? (lock.methodAgree ? "Locked method pick (frozen before the fight)" : "Locked method pick; the split is today's model for this winner") : pick.limited ? "Low evidence" : "Method pick: most likely route"}</li>
          </ul>
        </div>
      ) : (
        <p className="mm-na">N/A · the method model needs a winner pick first.</p>
      )}
      {cells.length > 0 && (
        <>
          <p className="mm-sub-h">Every outcome</p>
          <div className="mm-outcomes" role="table" aria-label="Chance of each outcome">
            {cells.map((c) => (
              <div key={c.side + c.m} role="row" className={c.side + (c === top ? " top" : "")} style={{ "--v": Math.min(1, c.v / (top?.v || 1)) } as CSSProperties}>
                <span role="cell">
                  {sur(c.f)} · {SHORT[c.m]}
                </span>
                <b role="cell">{pct(c.v)}</b>
              </div>
            ))}
          </div>
          <p className="mm-fine">Win chance × that fighter's method split (method model 1.3). Most likely single outcome highlighted.</p>
        </>
      )}
    </Card>
  );
}

// ---------- rounds gauge ----------

function RoundsCard({ rounds: r, fight, lock }: Shared) {
  const grow = useGrow(r?.pOver ?? 0.5, [fight.id]);
  // Locked bout whose frozen call differs from today's rounds model: the gauge (today's numbers) would argue with it.
  const gauge = !lock || lock.roundsAgree;
  if (!r)
    return (
      <Card icon={<Timer size={15} aria-hidden="true" />} title="Rounds" className="mm-rounds">
        <p className="mm-na">No standard line for this format.</p>
      </Card>
    );
  const ang = Math.PI * (1 - grow);
  const nx = 80 + 52 * Math.cos(ang), ny = 84 - 52 * Math.sin(ang);
  const half = r.roundMinutes / 2;
  const clock = `${Math.floor(half)}:${String(Math.round((half % 1) * 60)).padStart(2, "0")}`;
  return (
    <Card icon={<Timer size={15} aria-hidden="true" />} title="Rounds over/under" sub={`${fight.rounds} × ${r.roundMinutes} min`} className="mm-rounds">
      {gauge && <svg viewBox="0 0 160 100" className="mm-gauge" role="img" aria-label={`Chance it goes over ${r.line} rounds: ${pct(r.pOver)}`}>
        <path d="M18 84 A62 62 0 0 1 142 84" className="track" pathLength={100} />
        <path d="M18 84 A62 62 0 0 1 142 84" className={"fill " + r.side.toLowerCase()} pathLength={100} style={{ strokeDasharray: `${grow * 100} 100` }} />
        <line x1="80" y1="84" x2={nx} y2={ny} className="needle" />
        <circle cx="80" cy="84" r="5" className="hub" />
        <text x="18" y="98" className="lab">
          Under
        </text>
        <text x="142" y="98" className="lab end">
          Over
        </text>
      </svg>}
      <div className="mm-rounds-call">
        <strong>
          {r.side} {r.line}
        </strong>
        {lock ? (
          <>
            <span>Locked call, frozen before the fight</span>
            <small>
              {lock.roundsAgree
                ? `Today's model agrees: ${pct(r.pOver)} chance it's still going at ${clock} of round ${Math.ceil(r.line)}`
                : lock.liveRounds
                  ? `Today's model leans ${lock.liveRounds.side} ${lock.liveRounds.line} (${pct(lock.liveRounds.pOver)} chance of Over)`
                  : ""}
            </small>
          </>
        ) : (
          <>
            <span>
              {pct(r.pOver)} chance it's still going at {clock} of round {Math.ceil(r.line)}
            </span>
            <small>
              {r.confidence === null ? "Low evidence" : `${r.confidence}% confidence`}
              {r.limited ? " · thin duration data" : ""} · base rate {pct(r.prior)} for {fight.division.toLowerCase()} {fight.rounds}-rounders
            </small>
          </>
        )}
      </div>
    </Card>
  );
}

// ---------- physical ----------

function Mirror({ label, av, bv, dom, fmt, lowerBetter = false, note }: { label: string; av?: number; bv?: number; dom: [number, number]; fmt: (v: number) => string; lowerBetter?: boolean; note?: string }) {
  const w = (v?: number) => (v === undefined ? 0 : Math.max(6, Math.min(100, ((v - dom[0]) / (dom[1] - dom[0])) * 100)));
  const edge = av === undefined || bv === undefined || av === bv ? null : (av > bv) !== lowerBetter ? "a" : "b";
  const grow = useGrow(1, [av, bv]);
  return (
    <div className="mm-mirror">
      <span className={"v a" + (edge === "a" ? " edge" : "")}>{av === undefined ? "N/A" : fmt(av)}</span>
      <div className="bars">
        <div className="l">
          <i className={edge === "a" ? "edge" : ""} style={{ width: `${w(av) * grow}%` }} />
        </div>
        <em>{label}</em>
        <div className="r">
          <i className={edge === "b" ? "edge" : ""} style={{ width: `${w(bv) * grow}%` }} />
        </div>
      </div>
      <span className={"v b" + (edge === "b" ? " edge" : "")}>{bv === undefined ? "N/A" : fmt(bv)}</span>
      {note && <small className="mm-mirror-note">{note}</small>}
    </div>
  );
}

function PhysicalCard({ a, b, divisions, event, cross, fight }: Shared) {
  const agA = ageAt(a, event.date), agB = ageAt(b, event.date);
  const da = divisionByName(divisions?.a), db = divisionByName(divisions?.b), bout = divisionByName(fight.division);
  const diff = (x?: number, y?: number, f?: (v: number) => string) => (x && y && Math.abs(x - y) >= 1 && f ? `${f(Math.abs(x - y))} ${x > y ? sur(a) : sur(b)}` : undefined);
  const inch = (cm: number) => `${(cm / 2.54).toFixed(cm / 2.54 >= 10 ? 0 : 1)}″`;
  return (
    <Card icon={<Ruler size={15} aria-hidden="true" />} title="Tale of the tape" sub="Size, age, stance" className="mm-phys">
      {cross && da && db && (
        <div className="mm-weightgap">
          <div className={da.limit > db.limit ? "heavy" : ""}>
            <b>{da.limit}</b>
            <small>
              {da.short} · {sur(a)}
            </small>
          </div>
          <span>
            <strong>{Math.abs(da.limit - db.limit)} lb</strong>
            <small>division gap</small>
          </span>
          <div className={db.limit > da.limit ? "heavy" : ""}>
            <b>{db.limit}</b>
            <small>
              {db.short} · {sur(b)}
            </small>
          </div>
        </div>
      )}
      <Mirror label="Height" av={a.height} bv={b.height} dom={[150, 205]} fmt={(v) => formatHeight(v)} note={diff(a.height, b.height, inch) ? `+${diff(a.height, b.height, inch)}` : undefined} />
      <Mirror label="Reach" av={a.reach} bv={b.reach} dom={[150, 215]} fmt={(v) => formatReach(v)} note={diff(a.reach, b.reach, inch) ? `+${diff(a.reach, b.reach, inch)}` : undefined} />
      <Mirror label="Age" av={agA} bv={agB} dom={[18, 45]} fmt={(v) => String(v)} lowerBetter note={agA && agB && agA !== agB ? `${Math.abs(agA - agB)} yrs younger: ${agA < agB ? sur(a) : sur(b)}` : undefined} />
      <div className="mm-stance">
        <span>{stanceOf(a)}</span>
        <em>Stance</em>
        <span>{stanceOf(b)}</span>
      </div>
      <p className="mm-fine">
        {bout ? `Bout set at ${bout.name.toLowerCase()} (${bout.limit} lb). ` : `${fight.division} bout. `}Listed measurements{event.id === "matchmaker" ? "" : `, age on fight night`}; the model caps size so it never decides a fight alone.
      </p>
    </Card>
  );
}

// ---------- radar ----------

function RadarSkeleton({ failed, retry }: { failed: boolean; retry?: () => void }) {
  const N = RADAR_AXES.length, C = 100, R = 66;
  const pt = (i: number, v: number) => {
    const t = -Math.PI / 2 + (i * 2 * Math.PI) / N;
    return [C + Math.cos(t) * R * v, C + Math.sin(t) * R * v];
  };
  return (
    <div className={"mm-radar-skel" + (failed ? "" : " mm-skel")} role="status" aria-live="polite">
      <svg viewBox="0 0 200 200" className="mm-radar-svg" aria-hidden="true">
        {[0.25, 0.5, 0.75, 1].map((r) => (
          <polygon key={r} className="ring" points={RADAR_AXES.map((_, i) => pt(i, r).join(",")).join(" ")} />
        ))}
        {RADAR_AXES.map((_, i) => {
          const [x, y] = pt(i, 1);
          return <line key={i} x1={C} y1={C} x2={x} y2={y} className="spoke" />;
        })}
      </svg>
      {failed ? (
        <>
          <p>The UFC percentile table didn't load.</p>
          {retry && (
            <button type="button" className="mm-retry" onClick={retry}>
              <RotateCcw size={13} aria-hidden="true" /> Try again
            </button>
          )}
        </>
      ) : (
        <p>Loading UFC percentiles…</p>
      )}
    </div>
  );
}

function RadarCard({ a, b, data, rosterData, roster }: Shared) {
  const { sa, sb } = data;
  const grow = useGrow(rosterData ? 1 : 0, [a.id, b.id]);
  const ref = useRef<HTMLElement>(null);
  const none = !sa && !sb;
  useWhenNear(ref, !none && !rosterData && roster.status === "idle", roster.request);
  const N = RADAR_AXES.length, C = 100, R = 66;
  const pt = (i: number, v: number) => {
    const t = -Math.PI / 2 + (i * 2 * Math.PI) / N;
    return [C + Math.cos(t) * R * v, C + Math.sin(t) * R * v];
  };
  const poly = (ps: (number | null)[]) => ps.map((v, i) => pt(i, ((v ?? 0) / 100) * grow).join(",")).join(" ");
  const pa = rosterData?.pa ?? [], pb = rosterData?.pb ?? [];
  return (
    <Card icon={<Shield size={15} aria-hidden="true" />} title="Skill shape" sub="UFC percentile" className="mm-radar" innerRef={ref}>
      {none ? (
        <NoUfcData both what="skill" short />
      ) : !rosterData ? (
        <RadarSkeleton failed={roster.status === "error"} retry={roster.request} />
      ) : (
        <>
          <svg viewBox="-44 0 288 200" className="mm-radar-svg" role="img" aria-label={RADAR_AXES.map((ax, i) => `${ax.label}: ${a.name} ${pa[i] ?? "N/A"}, ${b.name} ${pb[i] ?? "N/A"}`).join("; ")}>
            {[0.25, 0.5, 0.75, 1].map((r) => (
              <polygon key={r} className="ring" points={RADAR_AXES.map((_, i) => pt(i, r).join(",")).join(" ")} />
            ))}
            {RADAR_AXES.map((_, i) => {
              const [x, y] = pt(i, 1);
              return <line key={i} x1={C} y1={C} x2={x} y2={y} className="spoke" />;
            })}
            {sa && <polygon className="shape a" points={poly(pa)} />}
            {sb && <polygon className="shape b" points={poly(pb)} />}
            {RADAR_AXES.map((ax, i) => {
              const [x, y] = pt(i, 1.24);
              return (
                <text key={ax.key} x={x} y={y + 3} className="axis" textAnchor={Math.abs(x - C) < 5 ? "middle" : x > C ? "start" : "end"}>
                  {ax.label}
                </text>
              );
            })}
          </svg>
          <div className="mm-radar-legend">
            <span className="a">
              <i /> {sur(a)} {sa ? "" : "· no UFC stats yet"}
            </span>
            <span className="b">
              <i /> {sur(b)} {sb ? "" : "· no UFC stats yet"}
            </span>
          </div>
          <p className="mm-fine">Percentile vs every UFC fighter since 2021 with 25+ cage minutes (outer ring = best). Small samples swing hard.</p>
        </>
      )}
    </Card>
  );
}

// ---------- stat bars ----------

type Row = { key: keyof DisplayStats; avgKey: StatKey; label: string; unit: string; pctv?: boolean; lower?: boolean; digits: number };
const ROWS: Row[] = [
  { key: "slpm", avgKey: "slpm", label: "Sig. strikes landed", unit: "/min", digits: 2 },
  { key: "sapm", avgKey: "sapm", label: "Sig. strikes absorbed", unit: "/min", lower: true, digits: 2 },
  { key: "strAcc", avgKey: "strAcc", label: "Striking accuracy", unit: "%", pctv: true, digits: 0 },
  { key: "strDef", avgKey: "strDef", label: "Striking defence", unit: "%", pctv: true, digits: 0 },
  { key: "kdPer15", avgKey: "kdPer15", label: "Knockdowns", unit: "/15", digits: 2 },
  { key: "tdPer15", avgKey: "tdPer15", label: "Takedowns landed", unit: "/15", digits: 2 },
  { key: "tdAcc", avgKey: "tdAcc", label: "Takedown accuracy", unit: "%", pctv: true, digits: 0 },
  { key: "tdDef", avgKey: "tdDef", label: "Takedown defence", unit: "%", pctv: true, digits: 0 },
  { key: "subPer15", avgKey: "subPer15", label: "Submission attempts", unit: "/15", digits: 2 },
  { key: "ctrlPer15", avgKey: "ctrlPer15", label: "Control time", unit: "min/15", digits: 1 },
];
const STR_KEYS = ["slpm", "sapm", "strAcc", "strDef", "kdPer15"], GRP_KEYS = ["tdPer15", "tdAcc", "tdDef", "subPer15", "ctrlPer15"];

function StatsCard({ a, b, event, fight, data, rosterData, roster, mode }: Shared) {
  const { sa, sb } = data;
  const avg = rosterData?.avg ?? null;
  const [grp, setGrp] = useState<"str" | "grp">("str");
  const grow = useGrow(1, [a.id, b.id, grp]);
  const ref = useRef<HTMLElement>(null);
  const none = !sa && !sb;
  useWhenNear(ref, !none && !rosterData && roster.status === "idle", roster.request);
  const rows = ROWS.filter((r) => (grp === "str" ? STR_KEYS : GRP_KEYS).includes(r.key));
  const val = (s: DisplayStats | null, r: Row) => {
    const v = s ? (s[r.key] as number | null) : null;
    return v === null || v === undefined || !Number.isFinite(v) ? null : r.pctv ? v * 100 : v;
  };
  const avgOf = (r: Row) => {
    const v = avg?.[r.avgKey];
    return v === undefined ? null : r.key === "ctrlPer15" ? v / 60 : v;
  };
  const fmt = (v: number | null, r: Row) => (v === null ? "N/A" : r.pctv ? `${Math.round(v)}%` : v.toFixed(r.digits));
  const src = (s: DisplayStats | null, f: Fighter) => (s ? `${sur(f)}: ${s.source === "timeline" ? `${s.fights} UFC fights · ${Math.round(s.minutes)} min` : "official UFC profile averages"}` : `${sur(f)}: no UFC stat lines yet`);
  const avgNote = avg ? `Tick = UFC ${fight.division.toLowerCase()} average.` : roster.status === "error" ? "Division averages didn't load." : rosterData === null && !none ? "Loading UFC division averages…" : "";
  return (
    <Card
      icon={<Swords size={15} aria-hidden="true" />}
      title="Striking & grappling"
      innerRef={ref}
      sub={
        none ? undefined : (
          <span className="mm-seg" role="group" aria-label="Stat group">
            <button type="button" aria-pressed={grp === "str"} className={grp === "str" ? "on" : ""} onClick={() => setGrp("str")}>
              Striking
            </button>
            <button type="button" aria-pressed={grp === "grp"} className={grp === "grp" ? "on" : ""} onClick={() => setGrp("grp")}>
              Grappling
            </button>
          </span>
        )
      }
      className="mm-stats span2"
    >
      {none ? (
        <NoUfcData both />
      ) : (
        <>
          <div className="mm-stats-names">
            <span className="a">
              {a.name}
              {!sa && <small>No UFC data yet</small>}
            </span>
            <span className="b">
              {b.name}
              {!sb && <small>No UFC data yet</small>}
            </span>
          </div>
          <div className={"mm-bars" + (!avg && roster.status !== "error" ? " loading-avg" : "")}>
            {rows.map((r) => {
              const x = val(sa, r), y = val(sb, r), m = avgOf(r);
              const max = Math.max(x ?? 0, y ?? 0, (m ?? 0) * 1.25) || 1;
              const edge = x === null || y === null || Math.abs(x - y) < 1e-9 ? null : (x > y) !== !!r.lower ? "a" : "b";
              const cell = (v: number | null, s: DisplayStats | null, side: "a" | "b") => (
                <span className={"v" + (edge === side ? " edge" : "") + (s ? "" : " none")} title={s ? undefined : "No UFC stat lines yet"}>
                  {s ? fmt(v, r) : "—"}
                </span>
              );
              return (
                <div className="mm-bar" key={r.key}>
                  {cell(x, sa, "a")}
                  <div className="track l">
                    <i className={edge === "a" ? "edge" : ""} style={{ width: `${((x ?? 0) / max) * 100 * grow}%` }} />
                    {m !== null && <u style={{ right: `${(m / max) * 100}%` }} title={`Division average ${fmt(m, r)}`} />}
                  </div>
                  <div className="lab">
                    <strong>{r.label}</strong>
                    <small>
                      {r.unit.replace("/15", "per 15 min").replace("/min", "per min").replace("min/15", "min per 15")}
                      {m !== null ? ` · avg ${fmt(m, r)}` : ""}
                    </small>
                  </div>
                  <div className="track r">
                    <i className={edge === "b" ? "edge" : ""} style={{ width: `${((y ?? 0) / max) * 100 * grow}%` }} />
                    {m !== null && <u style={{ left: `${(m / max) * 100}%` }} />}
                  </div>
                  {cell(y, sb, "b")}
                </div>
              );
            })}
          </div>
          <p className="mm-fine">
            UFC fights before {fmtLongDate(event.date)} (UFCStats formulas, unsmoothed). {avgNote} {src(sa, a)} · {src(sb, b)}. The engine uses the same lines, shrunk toward league average for small samples
            {mode === "card" ? "; fighters without UFC stats have those factors left out." : "."}
          </p>
          {roster.status === "error" && roster.request && (
            <button type="button" className="mm-retry" onClick={roster.request}>
              <RotateCcw size={13} aria-hidden="true" /> Load division averages
            </button>
          )}
        </>
      )}
    </Card>
  );
}

// ---------- form ----------

function FormCard({ a, b, event, data }: Shared) {
  return (
    <Card icon={<TrendingUp size={15} aria-hidden="true" />} title="Recent form" sub="Oldest → newest" className="mm-form span2">
      {[a, b].map((f, idx) => {
        const rows = idx ? data.recentB : data.recentA;
        const decided = rows.filter((r) => r.result !== "NC");
        let streak = 0;
        const s0 = decided[0]?.result;
        for (const r of decided) {
          if (r.result !== s0) break;
          streak++;
        }
        const days = rows[0] ? Math.round((Date.parse(event.date) - Date.parse(rows[0].date)) / 86400000) : null;
        return (
          <div className={"mm-form-row " + (idx ? "b" : "a")} key={f.id}>
            <div className="mm-form-who">
              <strong>{f.name}</strong>
              <small>
                {s0 && streak ? `${streak} ${s0 === "W" ? "win" : s0 === "L" ? "loss" : "draw"}${streak > 1 ? (s0 === "L" ? "es" : "s") : ""} in a row` : "No recent results"}
                {days !== null ? ` · ${event.id === "matchmaker" ? "last fought" : "out"} ${days} days${event.id === "matchmaker" ? " ago" : " before this bout"}` : ""}
              </small>
            </div>
            {rows.length ? (
              <ol className="mm-timeline">
                {[...rows].reverse().map((r, i) => (
                  <li key={r.date + r.opponent + i} className={r.result.toLowerCase()} title={`${r.date} · ${r.result} vs ${r.opponent} · ${r.method}${r.round ? ` R${r.round}` : ""} · ${r.promotion}`}>
                    <b>{r.result}</b>
                    <small>{methodLetter(r.method, r.result)}</small>
                    <FighterName name={r.opponent} vs={f.id} date={r.date} className="opp">
                      {r.opponent.split(" ").slice(-1)[0]}
                    </FighterName>
                    <em>{r.date.slice(2, 4) === "" ? "" : `’${r.date.slice(2, 4)}`}</em>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mm-na">N/A · no pro fights on record before this bout.</p>
            )}
          </div>
        );
      })}
    </Card>
  );
}

// ---------- common opponents ----------

function OpponentsCard({ a, b, data }: Shared) {
  const { shared, meetings } = data.opps;
  const chip = (r: { result: string; method: string; round?: number; date: string }, i: number) => (
    <span key={i} className={"mm-res " + r.result.toLowerCase()} title={`${r.method}${r.round ? ` · R${r.round}` : ""} · ${r.date}`}>
      <b>{r.result}</b> {methodLetter(r.method, r.result)}
      {r.round ? ` R${r.round}` : ""} <small>’{r.date.slice(2, 4)}</small>
    </span>
  );
  return (
    <Card icon={<Users size={15} aria-hidden="true" />} title="Common opponents" sub={shared.length ? `${shared.length} shared` : undefined} className="mm-opps">
      {meetings.length > 0 && (
        <div className="mm-meet">
          <strong>They've met before</strong>
          {meetings.map((m, i) => (
            <p key={i}>
              {m.date.slice(0, 4)} · {m.result === "W" ? a.name : m.result === "L" ? b.name : "Draw"}
              {m.result === "W" || m.result === "L" ? ` won by ${m.method}` : ` (${m.method})`}
              {m.round ? `, R${m.round}` : ""}
            </p>
          ))}
        </div>
      )}
      {shared.length ? (
        <div className="mm-opps-list">
          <div className="mm-opps-head">
            <span>{sur(a)}</span>
            <span>Opponent</span>
            <span>{sur(b)}</span>
          </div>
          {shared.slice(0, 7).map((o) => (
            <div className="mm-opp" key={o.name}>
              <span className="l">{o.a.map(chip)}</span>
              <FighterName name={o.name} slug={o.slug} className="mid">
                {o.name}
              </FighterName>
              <span className="r">{o.b.map(chip)}</span>
            </div>
          ))}
          {shared.length > 7 && <p className="mm-fine">+{shared.length - 7} more in Full history.</p>}
        </div>
      ) : (
        <p className="mm-na">No shared opponents in their pro histories{meetings.length ? "" : ", and they haven't met before"}.</p>
      )}
      <p className="mm-fine">Context only: different dates and circumstances. Tap a name for that fighter's profile.</p>
    </Card>
  );
}

// ---------- the case ----------

function CaseCard({ a, b, prediction: p, lock }: Shared) {
  const winner = p.pick === a.id ? a : p.pick === b.id ? b : null;
  return (
    <Card icon={<Scale size={15} aria-hidden="true" />} title={winner ? `The case for ${sur(winner)}` : "The case"} className={"mm-case " + (p.pick === a.id ? "a" : p.pick === b.id ? "b" : "")}>
      {lock?.note && <p className="mm-locked-note">{lock.note}</p>}
      {winner ? (
        <ul className="mm-reasons">
          {p.reasons.slice(0, 3).map((r, i) => (
            <li key={i}>
              <Check size={15} aria-hidden="true" />
              <span>
                <strong>{r.title}</strong>
                {r.text}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mm-na">{p.pendingReason}</p>
      )}
      {p.counter && (
        <div className="mm-counter">
          <span>Strongest counter-argument</span>
          <strong>{p.counter.title}</strong>
          <p>{p.counter.text}</p>
        </div>
      )}
    </Card>
  );
}

// ---------- data notes ----------

function NotesCard({ prediction: p, cross, notes = [], mode, lock }: Shared) {
  return (
    <Card icon={<Gauge size={15} aria-hidden="true" />} title="Data behind this call" sub={`Evidence ${p.evidence}/100`} className="mm-notes span2">
      <ul>
        {cross && <li className="warn">Cross-division bout: moving up one division is treated as free (fighters moving up held their own in our backtest). Beyond that, every extra pound of natural size shifts the odds toward the bigger fighter — a rule of thumb, not backtested, because real cross-division fights are rare.</li>}
        {notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
        {p.gaps.map((g) => (
          <li key={g} className="gap">
            {g}
          </li>
        ))}
        {lock && <li>Winner, confidence, rounds and method are the frozen final pick from before the card locked (engine {lock.engine}), exactly what the Track record grades. The fighter panels use only fights before the event.</li>}
        <li>{mode === "card" ? "Same engine output as the verdict strip and Prediction tab. No odds, no outside picks." : "Same engine, rounds and method models as every card bout. No odds, no outside picks."}</li>
      </ul>
    </Card>
  );
}

function FilmCard({ a, b, event, fight, prediction: p, finish, lock }: Shared) {
  // A locked bout plays its frozen method call.
  const method = lock ? finish?.method : undefined;
  return (
    <section className="mm-card mm-film" aria-label="Projected finish film">
      <FinishScene key={fight.id + String(p.pick) + (method ?? "")} a={a} b={b} event={event} fight={fight} winnerId={p.pick} method={method} />
    </section>
  );
}

// ---------- analysis (memoised once per bout) ----------

type Analysis = {
  sa: DisplayStats | null;
  sb: DisplayStats | null;
  recentA: ReturnType<typeof recentRows>;
  recentB: ReturnType<typeof recentRows>;
  opps: ReturnType<typeof commonOpponents>;
  finA: FinishPrediction | null;
  finB: FinishPrediction | null;
};
type RosterData = { pa: (number | null)[]; pb: (number | null)[]; avg: Partial<Record<StatKey, number>> };

export function Breakdown(props: BreakdownProps) {
  const { a, b, event, fight, prediction, finish, roster } = props;
  const data = useMemo<Analysis>(
    () => ({
      sa: displayStats(a, event.date),
      sb: displayStats(b, event.date),
      recentA: recentRows(a, event.date, 8),
      recentB: recentRows(b, event.date, 8),
      opps: commonOpponents(a, b, event.date),
      // The picked side reuses the verdict strip's finish object; only the other side is computed here.
      finA: prediction.pick === a.id && finish ? finish : predictFinish(fight, a, b, event, a.id),
      finB: prediction.pick === b.id && finish ? finish : predictFinish(fight, a, b, event, b.id),
    }),
    [a, b, event, fight, prediction.pick, finish],
  );
  const r = roster.roster;
  const rosterData = useMemo<RosterData | null>(() => (r ? { pa: radarPercentiles(data.sa, r), pb: radarPercentiles(data.sb, r), avg: divisionAverages(r, fight.division).avg } : null), [r, data.sa, data.sb, fight.division]);
  const s: Shared = { ...props, data, rosterData };
  return (
    <div className="bd-root">
      <div className="mm-grid">
        <WinCard {...s} />
        <MethodCard {...s} />
        <RoundsCard {...s} />
        <CaseCard {...s} />
        <FilmCard {...s} />
        <StatsCard {...s} />
        <RadarCard {...s} />
        <FormCard {...s} />
        <PhysicalCard {...s} />
        <OpponentsCard {...s} />
        <NotesCard {...s} />
      </div>
    </div>
  );
}
