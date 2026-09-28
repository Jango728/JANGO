"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Crown, Flame, Shield, Swords, Timer, TrendingDown, TrendingUp, Trophy, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Portrait } from "./fight-experience";
import { Flag } from "./fighter-meta";
import { ResultBadge, methodDetail } from "./method-badge";
import { FighterName, useSiteNav } from "./site-nav";
import { appearancesOf, boutsFor, decodeRef, resolveRef, rosterSlugFor, type DirectoryEntry, type Resolved } from "@/lib/directory";
import { classifyMethod, normalizePromotion } from "@/lib/fightinfo";
import { resultRecord, strengthOfSchedule } from "@/lib/model";
import { formatHeight, formatReach } from "@/lib/measurements";
import { COMBAT_METRICS } from "@/lib/matchup";
import { predict } from "@/lib/engine";
import { resultFor } from "@/lib/ledger";
import { withLoggedResults } from "@/lib/logged-history";
import { followUpFor, recapForHistoryRow } from "@/lib/round-recaps";
import { RoundTimeline } from "./round-timeline";
import { scoutNotes, SCOUT_TAG_LABEL } from "@/lib/scouting";
import type { Fighter, PastFight } from "@/lib/types";
import { clipsForFighter } from "@/lib/clips";
import { FOOTAGE } from "@/lib/footage";
import {
  NAME_BY_SLUG,
  ageFrom,
  boutMinutes,
  divisionAverages,
  looseSameName,
  nearDate,
  useRoster,
  useRosterPhoto,
  type Roster,
  type RosterBout,
  type RosterFighter,
  type RosterPhoto,
  type RosterState,
  type StatKey,
} from "@/lib/roster";
import { ClipStrip } from "./clip-strip";
import { mergeRosterRows, rosterDisplayRow } from "@/lib/roster-profile";

type Tab = "overview" | "history" | "scouting" | "clips" | "stats";
const ORGS = ["UFC", "PFL", "OKTAGON", "Bellator", "ACA", "DWCS", "ONE", "LFA", "Cage Warriors"];
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const fmtMonth = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const firstName = (n: string) => n.split(" ")[0];

/** A history row with the roster's extras when we know them. `opponentSlug: null` = opponent not in the roster. */
type Row = PastFight & { opponentSlug?: string | null; title?: boolean };

// ---------- building the profile model ----------

type StatLine = { key: StatKey; label: string; unit: string; value: number; avg?: number; lower?: boolean; pctScale?: boolean; digits: number };
type StatsModel = { lines: StatLine[]; division?: string; pool?: number; note: string; minutes: number };
type Model = {
  kind: "seed" | "roster";
  key: string;
  name: string;
  nickname?: string;
  country?: string;
  entry?: DirectoryEntry;
  seed?: Fighter; // seed-only extras (next bout, scouting, film)
  rows: Row[]; // MMA, newest first
  record: string;
  recordNote?: string; // e.g. "UFC record · pro record not listed"
  orgChips: string[];
  facts: string[];
  weightClass?: string;
  photoSlug?: string; // roster photo to load when there's no seed portrait
  stats?: StatsModel;
  officialStats?: Fighter["stats"];
  scope?: string;
  historySource?: string;
};

const STAT_DEFS: { key: StatKey; label: string; unit: string; lower?: boolean; pctScale?: boolean; digits: number; group: "Striking" | "Grappling"; seedKey?: keyof NonNullable<Fighter["stats"]> }[] = [
  { key: "slpm", label: "Sig. strikes landed", unit: "per min", digits: 2, group: "Striking", seedKey: "slpm" },
  { key: "sapm", label: "Sig. strikes absorbed", unit: "per min", lower: true, digits: 2, group: "Striking", seedKey: "sapm" },
  { key: "strAcc", label: "Striking accuracy", unit: "%", pctScale: true, digits: 0, group: "Striking", seedKey: "strikeAccuracy" },
  { key: "strDef", label: "Striking defence", unit: "%", pctScale: true, digits: 0, group: "Striking", seedKey: "strikeDefense" },
  { key: "kdPer15", label: "Knockdowns", unit: "per 15 min", digits: 2, group: "Striking", seedKey: "kdPer15" },
  { key: "tdPer15", label: "Takedowns landed", unit: "per 15 min", digits: 2, group: "Grappling", seedKey: "tdPer15" },
  { key: "tdAcc", label: "Takedown accuracy", unit: "%", pctScale: true, digits: 0, group: "Grappling", seedKey: "tdAccuracy" },
  { key: "tdDef", label: "Takedown defence", unit: "%", pctScale: true, digits: 0, group: "Grappling", seedKey: "tdDefense" },
  { key: "subPer15", label: "Submission attempts", unit: "per 15 min", digits: 2, group: "Grappling", seedKey: "subPer15" },
  { key: "ctrlPer15", label: "Control time", unit: "min per 15", digits: 1, group: "Grappling" },
];

function rosterStats(r: RosterFighter, roster: Roster, weightClass: string | undefined): StatsModel | undefined {
  if (!r.stats || !r.stats.fights) return undefined;
  const div = weightClass && /weight/i.test(weightClass) ? weightClass : r.weightClass;
  const avgs = divisionAverages(roster, div);
  const lines: StatLine[] = [];
  for (const d of STAT_DEFS) {
    const raw = r.stats[d.key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const conv = (v: number) => (d.key === "ctrlPer15" ? v / 60 : v);
    const avg = avgs.avg[d.key];
    lines.push({ key: d.key, label: d.label, unit: d.unit, lower: d.lower, pctScale: d.pctScale, digits: d.digits, value: conv(raw), avg: avg === undefined ? undefined : conv(avg) });
  }
  return {
    lines,
    division: div,
    pool: avgs.n,
    minutes: r.stats.minutes,
    note: `${r.stats.minutes < 30 ? "Small sample — read these loosely. " : ""}UFCStats career numbers · ${r.stats.fights} UFC fights · ${Math.round(r.stats.minutes)} minutes in the cage. The marker shows the ${div.toLowerCase()} average across ${avgs.n} fighters with 25+ UFC minutes since 2021.`,
  };
}

const rosterRow = (b: RosterBout): Row => rosterDisplayRow(b);
const mergeRows = (seedRows: PastFight[], ros: RosterBout[] | undefined): Row[] => mergeRosterRows(seedRows, ros);

const isMMA = (x: PastFight) => (x.rules ?? "MMA") === "MMA";
const cleanFact = (x: unknown) => x && !/^\s*(--?|n\/a|unknown)\s*$/i.test(String(x));

function rankedDivision(entry?: DirectoryEntry) {
  return entry?.ranks.find((r) => r.role !== "prospect")?.division.name ?? entry?.ranks[0]?.division.name;
}

function seedModel(seedRaw: Fighter, entry: DirectoryEntry, roster: Roster | null): Model {
  const f = withLoggedResults(seedRaw);
  const slug = rosterSlugFor(seedRaw, roster);
  const r = slug ? roster?.bySlug.get(slug) : undefined;
  const rows = mergeRows(f.history.filter((x) => x.date).sort((a, b) => b.date.localeCompare(a.date)), r?.history).filter(isMMA);
  const record = f.historyComplete ? resultRecord(rows) : f.record || resultRecord(rows);
  const orgChips = ORGS.map((o) => ({ o, rs: rows.filter((x) => normalizePromotion(x.promotion) === o) }))
    .filter((x) => x.rs.length)
    .map((x) => `${x.o} ${resultRecord(x.rs)}`);
  const weightClass = rankedDivision(entry) ?? r?.weightClass ?? rows.find((x) => x.division)?.division;
  const age = f.age ?? ageFrom(f.birthDate) ?? ageFrom(r?.dob);
  const heightCm = f.height ?? (r?.heightIn ? r.heightIn * 2.54 : undefined);
  const reachCm = f.reach ?? (r?.reachIn ? r.reachIn * 2.54 : undefined);
  return {
    kind: "seed",
    key: "seed:" + f.id,
    name: f.name,
    nickname: f.nickname ?? r?.nickname ?? undefined,
    country: f.country ?? r?.country ?? undefined,
    entry,
    seed: f,
    rows,
    record,
    orgChips,
    facts: [age ? `Age ${age}` : null, weightClass, heightCm ? formatHeight(heightCm) : null, reachCm ? `${formatReach(reachCm)} reach` : null, f.stance ?? r?.stance, f.style].filter(cleanFact) as string[],
    weightClass,
    photoSlug: f.image ? undefined : slug,
    stats: r && roster ? rosterStats(r, roster, weightClass) : undefined,
    officialStats: f.stats,
    historySource: f.historySource,
  };
}

function rosterModel(r: RosterFighter, entry: DirectoryEntry | undefined, roster: Roster): Model {
  // Convert to the seed shape so ledger-logged results (a card the nightly scrape hasn't picked up yet) merge in.
  const asFighter: Fighter = { id: "r:" + r.slug, name: r.name, history: r.history.map(rosterRow), sources: [], ufcHistoryComplete: true };
  const logged = withLoggedResults(asFighter).history.filter((x) => !r.history.some((h) => h.date === x.date && h.opponent === x.opponent));
  const rows: Row[] = [...r.history.map(rosterRow), ...logged].sort((a, b) => b.date.localeCompare(a.date));
  const extra = logged.length ? resultRecord(logged) : null;
  const ufc = extra ? resultRecord(rows) : r.ufcRecord;
  const weightClass = rankedDivision(entry) ?? r.weightClass;
  const age = ageFrom(r.dob);
  // Pro record: the roster's (seed-verified), else the UFC.com record lib/rankings.ts carries for champions and prospects.
  const pro = r.proRecord ?? entry?.ranks.find((x) => x.role === "champion")?.division.champion.record ?? entry?.ranks.find((x) => x.role === "prospect")?.prospect?.record ?? null;
  return {
    kind: "roster",
    key: "roster:" + r.slug,
    name: r.name,
    nickname: r.nickname ?? undefined,
    country: r.country ?? undefined,
    entry,
    rows,
    record: pro ?? ufc,
    recordNote: pro ? undefined : "UFC record",
    orgChips: pro ? [`UFC ${ufc}`] : [],
    facts: [age ? `Age ${age}` : null, weightClass, r.heightIn ? formatHeight(r.heightIn * 2.54) : null, r.reachIn ? `${formatReach(r.reachIn * 2.54)} reach` : null, r.stance].filter(cleanFact) as string[],
    weightClass,
    photoSlug: r.slug,
    stats: rosterStats(r, roster, weightClass),
    scope: `Tiles, bars and history cover UFC bouts only (UFCStats, data through ${roster.asOf}).`,
  };
}

// ---------- numbers ----------

function careerNumbers(rows: Row[]) {
  const all = rows;
  const decided = all.filter((x) => x.result !== "NC");
  const wins = decided.filter((x) => x.result === "W"), losses = decided.filter((x) => x.result === "L");
  const by = (rs: PastFight[]) => {
    const c = { KO: 0, SUB: 0, DEC: 0, OTHER: 0 };
    rs.forEach((r) => {
      const k = classifyMethod(r.method, r.result).kind;
      if (k === "KO" || k === "SUB" || k === "DEC") c[k]++;
      else c.OTHER++;
    });
    return c;
  };
  let streak = 0, kind: "W" | "L" | null = null;
  for (const r of decided) {
    if (r.result !== "W" && r.result !== "L") break;
    if (!kind) kind = r.result;
    if (r.result !== kind) break;
    streak++;
  }
  const timed = all.filter((x) => x.minutes !== undefined);
  const rounded = decided.filter((x) => x.round);
  const last = all[0];
  const titles = all.filter((x) => x.title);
  return {
    all,
    wins,
    losses,
    winBy: by(wins),
    lossBy: by(losses),
    streak,
    streakKind: kind,
    avgMin: timed.length ? timed.reduce((s, x) => s + x.minutes!, 0) / timed.length : null,
    reach3: rounded.length ? pct(rounded.filter((x) => (x.round ?? 0) >= 3).length, rounded.length) : null,
    five: decided.filter((x) => (x.round ?? 0) >= 4).length,
    schedule: strengthOfSchedule(all),
    titles,
    lastDays: last ? Math.round((Date.now() - Date.parse(last.date)) / 86400000) : null,
    last,
  };
}

function readBullets(m: Model, n: ReturnType<typeof careerNumbers>) {
  const read: string[] = [];
  const finishes = n.winBy.KO + n.winBy.SUB;
  if (n.wins.length >= 4) read.push(`Finishes ${pct(finishes, n.wins.length)}% of ${m.kind === "roster" ? "UFC " : ""}wins${n.winBy.KO >= n.winBy.SUB ? ", mostly by KO/TKO" : ", mostly by submission"}.`);
  if (n.losses.length === 0 && n.wins.length) read.push(m.kind === "roster" ? "Unbeaten in the UFC." : "Has never lost as a pro.");
  else if (n.lossBy.KO + n.lossBy.SUB === 0 && n.losses.length) read.push("Never been finished — every loss went to the cards.");
  else if (n.lossBy.KO >= 2) read.push(`Stopped by strikes ${n.lossBy.KO} times.`);
  if (n.titles.length) {
    const tw = n.titles.filter((x) => x.result === "W").length, tl = n.titles.filter((x) => x.result === "L").length;
    read.push(`${tw}-${tl} in UFC title fights.`);
  }
  const s = m.stats && m.stats.minutes >= 30 ? m.stats.lines : undefined; // skip stat reads on tiny samples
  const get = (k: StatKey) => s?.find((x) => x.key === k);
  const sl = get("slpm"), sa = get("sapm"), td = get("tdPer15"), tdd = get("tdDef");
  if (sl && sa && Math.abs(sl.value - sa.value) >= 0.8)
    read.push(sl.value > sa.value ? `Out-lands opponents by ${(sl.value - sa.value).toFixed(1)} significant strikes a minute.` : `Gets out-landed by ${(sa.value - sl.value).toFixed(1)} significant strikes a minute on average.`);
  if (td && td.avg !== undefined && td.value >= 1.5 && td.value >= td.avg * 1.6) read.push(`Wrestling-heavy: ${td.value.toFixed(1)} takedowns per 15 minutes (division average ${td.avg.toFixed(1)}).`);
  else if (tdd && tdd.value >= 85 && n.all.length >= 4) read.push(`Hard to take down — stops ${Math.round(tdd.value)}% of attempts.`);
  if (n.five) read.push(`Has fought into round 4 or later ${n.five} time${n.five > 1 ? "s" : ""}.`);
  else if (n.reach3 !== null && n.reach3 < 25 && n.all.length >= 5) read.push(`Only ${n.reach3}% of fights reach round 3 — rarely tested late.`);
  if (n.lastDays !== null && n.lastDays > 540 && n.last) read.push(`Hasn't fought since ${fmtMonth(n.last.date)}.`);
  if (n.schedule) read.push(`Schedule strength ${Math.round(n.schedule.score * 100)}/100 across ${n.schedule.count} verified opponents.`);
  return read.slice(0, 6);
}

// ---------- pieces ----------

function MethodBar({ label, counts, total, tone }: { label: string; counts: Record<string, number>; total: number; tone: "win" | "loss" }) {
  const parts = (["KO", "SUB", "DEC", "OTHER"] as const).filter((k) => counts[k]);
  const name = { KO: "KO/TKO", SUB: "Submission", DEC: "Decision", OTHER: "Other" } as const;
  return (
    <div className={"jp-pf-mbar " + tone}>
      <div className="head">
        <span>{label}</span>
        <b>{total}</b>
      </div>
      <div className="bar" role="img" aria-label={parts.map((k) => `${counts[k]} by ${name[k]}`).join(", ") || "none"}>
        {total ? parts.map((k) => <i key={k} className={"s-" + k.toLowerCase()} style={{ flexGrow: counts[k] }} title={`${counts[k]} by ${name[k]}`} />) : <i className="s-none" style={{ flexGrow: 1 }} />}
      </div>
      <div className="legend">
        {(["KO", "SUB", "DEC"] as const).map((k) => (
          <span key={k} className={"s-" + k.toLowerCase()}>
            <em />
            {name[k]} <b>{counts[k]}</b> <small>{pct(counts[k], total)}%</small>
          </span>
        ))}
      </div>
    </div>
  );
}

function HistoryList({ rows, owner, ownerName, source }: { rows: Row[]; owner: string; ownerName: string; source?: string }) {
  const [filter, setFilter] = useState<"all" | "W" | "L" | "fin" | "UFC" | "title">("all");
  const hasUfc = rows.some((r) => r.promotion === "UFC") && rows.some((r) => r.promotion !== "UFC");
  const hasTitle = rows.some((r) => r.title);
  const shown = rows.filter((r) =>
    filter === "all"
      ? true
      : filter === "fin"
        ? r.result === "W" && ["KO", "SUB"].includes(classifyMethod(r.method, r.result).kind)
        : filter === "UFC"
          ? r.promotion === "UFC"
          : filter === "title"
            ? r.title
            : r.result === filter,
  );
  // Round-by-round recaps we logged for these fights (ledger bouts with `rounds`), keyed by row.
  const rowKey = (r: Row) => `${r.date}|${r.opponent}`;
  const recaps = useMemo(() => {
    const m = new Map<string, NonNullable<ReturnType<typeof recapForHistoryRow>>>();
    for (const r of rows) {
      const x = recapForHistoryRow(ownerName, r.date, r.opponent);
      if (x && (x.rounds.length || x.recap)) m.set(rowKey(r), x);
    }
    return m;
  }, [rows, ownerName]);
  const [openRR, setOpenRR] = useState<string | null>(null);
  const chips: [typeof filter, string][] = [
    ["all", `All ${rows.length}`],
    ["W", "Wins"],
    ["L", "Losses"],
    ["fin", "Finishes"],
    ...(hasUfc ? ([["UFC", "UFC only"]] as [typeof filter, string][]) : []),
    ...(hasTitle ? ([["title", "Title fights"]] as [typeof filter, string][]) : []),
  ];
  return (
    <div className="jp-pf-history">
      <div className="jp-pf-chips" role="tablist" aria-label="Filter fights">
        {chips.map(([k, l]) => (
          <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)} role="tab" aria-selected={filter === k}>
            {l}
          </button>
        ))}
      </div>
      <ol className="jp-pf-rows">
        {shown.map((r, i) => {
          const rc = recaps.get(rowKey(r));
          const hasRounds = !!rc?.rounds.length;
          const isOpen = hasRounds && openRR === rowKey(r);
          const slotId = `rr-${i}-${r.date}`;
          return (
          <li key={`${r.date}-${r.opponent}-${i}`} className={"res-" + r.result.toLowerCase() + (r.title ? " title" : "")} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
            <ResultBadge row={r} />
            <div className="who">
              <b className="optop">
                <FighterName name={r.opponent} slug={r.opponentSlug} vs={r.opponentSlug === undefined ? owner : undefined} date={r.opponentSlug === undefined ? r.date : undefined} className="opp" />
                {r.title && (
                  <em className="jp-pf-belt" title="UFC title fight">
                    <Crown size={11} /> Title
                  </em>
                )}
              </b>
              <span>
                {r.eventName || r.promotion} · {r.date}
              </span>
            </div>
            <div className="how">
              <strong>{methodDetail(r)}</strong>
              <span>
                {r.round ? `R${r.round}` : "R?"}
                {r.time ? ` · ${r.time}` : ""}
                {r.opponentRecord ? ` · opp. ${r.opponentRecord}` : ""}
              </span>
              {hasRounds ? (
                <button type="button" className="rr-toggle" aria-expanded={isOpen} aria-controls={isOpen ? slotId : undefined} onClick={() => setOpenRR(isOpen ? null : rowKey(r))}>
                  Round by round <ChevronDown size={12} aria-hidden="true" />
                </button>
              ) : rc?.recap?.status === "pending" || rc?.recap?.status === "partial" ? (
                <span className="rr-pending-tag">Round-by-round recap pending</span>
              ) : null}
            </div>
            {isOpen && rc && (
              <div className="rr-slot" id={slotId}>
                <RoundTimeline bout={rc.bout} followUpUntil={followUpFor(rc.ledger)} compact />
              </div>
            )}
          </li>
          );
        })}
        {!shown.length && <li className="empty">No fights match this filter.</li>}
      </ol>
      {source && /^https?:/.test(source) && (
        <a className="jp-pf-src" href={source} target="_blank" rel="noopener noreferrer">
          History source ↗
        </a>
      )}
    </div>
  );
}

function StatsBars({ stats }: { stats: StatsModel }) {
  const fmt = (v: number, d: number) => (d ? v.toFixed(d) : String(Math.round(v)));
  const groups = (["Striking", "Grappling"] as const).map((g) => ({ g, lines: stats.lines.filter((l) => STAT_DEFS.find((d) => d.key === l.key)?.group === g) })).filter((x) => x.lines.length);
  return (
    <div className="jp-pf-sbars">
      {groups.map(({ g, lines }) => (
        <section key={g}>
          <h4 className="jp-h4">{g}</h4>
          {lines.map((l, i) => {
            const scale = l.pctScale ? 100 : Math.max(l.value, (l.avg ?? l.value) * 2, 0.01);
            const w = Math.min(100, (l.value / scale) * 100), a = l.avg === undefined ? null : Math.min(100, (l.avg / scale) * 100);
            const diff = l.avg === undefined || !l.avg ? 0 : (l.value - l.avg) / l.avg;
            const tone = Math.abs(diff) < 0.06 || l.avg === undefined ? "even" : diff > 0 !== !!l.lower ? "up" : "down";
            return (
              <div key={l.key} className={"jp-pf-sbar " + tone} style={{ animationDelay: `${i * 35}ms` }}>
                <div className="lbl">
                  <span>{l.label}</span>
                  <b>
                    {fmt(l.value, l.digits)}
                    <small> {l.unit}</small>
                  </b>
                </div>
                <div className="track" role="img" aria-label={`${l.label}: ${fmt(l.value, l.digits)} ${l.unit}${a !== null ? `, division average ${fmt(l.avg!, l.digits)}` : ""}`}>
                  <i style={{ width: `${w}%` }} />
                  {a !== null && <u style={{ left: `${a}%` }} />}
                </div>
                {l.avg !== undefined && (
                  <small className="avg">
                    Div. avg {fmt(l.avg, l.digits)}
                    {tone !== "even" && <em>{tone === "up" ? (l.lower ? " · fewer than most" : " · above average") : l.lower ? " · more than most" : " · below average"}</em>}
                  </small>
                )}
              </div>
            );
          })}
        </section>
      ))}
      <p className="jp-pf-empty">{stats.note}</p>
    </div>
  );
}

function HeroPhoto({ name, image, slug }: { name: string; image?: string; slug?: string }) {
  const photo = useRosterPhoto(image ? null : slug);
  const [broken, setBroken] = useState(false);
  if (image && !broken) return <img className="portrait" src={image} alt={name} onError={() => setBroken(true)} />;
  if (photo === undefined && slug) return <div className="portrait initials loading" aria-hidden="true" />;
  if (photo) return <PhotoImg photo={photo} name={name} />;
  return (
    <div className="portrait initials" role="img" aria-label={`${name}: photo unavailable`}>
      <span>{initials(name)}</span>
    </div>
  );
}
const PhotoImg = ({ photo, name }: { photo: RosterPhoto; name: string }) => <img className={"portrait" + (photo.kind === "headshot" ? " hs" : "")} src={photo.src} alt={name} />;

function RankChips({ entry }: { entry?: DirectoryEntry }) {
  const rank = entry?.ranks[0];
  return (
    <>
      {rank && (
        <em className={"rank " + rank.role}>
          {rank.role === "champion" ? <Crown size={12} /> : null}
          {rank.role === "champion" ? `${rank.division.name} champion` : rank.role === "contender" ? `#${rank.rank} ${rank.division.name}` : `Threat radar · ${rank.division.name}`}
        </em>
      )}
      {entry?.p4p && <em className="rank p4p">P4P #{entry.p4p.rank}</em>}
    </>
  );
}

// ---------- full profile (seed + roster fighters share it) ----------

function FullProfile({ m }: { m: Model }) {
  const nav = useSiteNav();
  const [tab, setTab] = useState<Tab>("overview");
  const n = useMemo(() => careerNumbers(m.rows), [m.rows]);
  const f = m.seed;
  const notes = f ? scoutNotes(f.id) : [];
  const clips = clipsForFighter(m.name);
  const film = f ? FOOTAGE.filter((v) => v.fighter === f.id) : [];
  const today = new Date().toISOString().slice(0, 10);
  const bouts = f ? boutsFor(f.id) : [];
  const next = bouts.find((b) => b.event.date >= today);
  const tracked = bouts.filter((b) => b.event.date < today).reverse();
  const nextPick = f && next && next.opponent ? predict(next.fight, next.fight.a === f.id ? f : next.opponent, next.fight.a === f.id ? next.opponent : f, next.event) : null;
  const finishes = n.winBy.KO + n.winBy.SUB;
  const read = readBullets(m, n);
  const hasStats = !!(m.stats?.lines.length || m.officialStats);
  const tabs: [Tab, string][] = [
    ["overview", "Overview"],
    ["history", `Fight history · ${m.rows.length}`],
    ...(hasStats ? ([["stats", "Stats"]] as [Tab, string][]) : []),
    ...(f ? ([["scouting", `Scouting${notes.length ? ` · ${notes.length}` : ""}`]] as [Tab, string][]) : []),
    ["clips", `Clips${clips.length + film.length ? ` · ${clips.length + film.length}` : ""}`],
  ];
  const owner = f ? f.id : "r:" + (m.photoSlug ?? "");

  return (
    <div className="jp-pf">
      <header className="jp-pf-hero">
        <div className="glow" aria-hidden="true" />
        <div className="pic">{f?.image ? <Portrait f={f} /> : <HeroPhoto name={m.name} slug={m.photoSlug} />}</div>
        <div className="id">
          <span className="country">
            {m.country ? (
              <>
                <Flag country={m.country} /> {m.country}
              </>
            ) : m.kind === "seed" ? (
              "Country unverified"
            ) : null}
            <RankChips entry={m.entry} />
          </span>
          <DialogTitle className="name">{m.name}</DialogTitle>
          {m.nickname && <span className="nick">“{m.nickname}”</span>}
          <div className="rec">
            <strong>{m.record}</strong>
            {m.recordNote && <span className="lbl">{m.recordNote}</span>}
            {m.orgChips.map((o) => (
              <span key={o} className="org">
                {o}
              </span>
            ))}
          </div>
          <DialogDescription className="facts">{m.facts.join(" · ") || "Physical details not verified yet"}</DialogDescription>
          {f && next && next.opponent && (
            <button className="next" onClick={() => nav.goFight(next.event.id, next.fight.id)}>
              <Swords size={15} />
              <span>
                Next: vs <b>{next.opponent.name}</b> · {next.event.title.replace(/^UFC Fight Night: /, "Fight Night: ")} · {next.event.date.slice(5).replace("-", "/")}
                {nextPick?.pick && (
                  <em className={nextPick.pick === f.id ? "fav" : "dog"}>
                    {nextPick.pick === f.id ? `Jango pick · ${nextPick.confidence}%` : `Jango picks opponent · ${nextPick.confidence}%`}
                  </em>
                )}
              </span>
              <ArrowRight size={15} />
            </button>
          )}
        </div>
      </header>

      <div className="jp-pf-tiles">
        <div>
          {n.streakKind === "L" ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
          <span>Streak</span>
          <b className={n.streakKind === "L" ? "neg" : "pos"}>{n.streakKind ? `${n.streak}${n.streakKind}` : "—"}</b>
        </div>
        <div>
          <Flame size={16} />
          <span>Finish rate</span>
          <b>{n.wins.length ? `${pct(finishes, n.wins.length)}%` : "—"}</b>
        </div>
        <div>
          <Timer size={16} />
          <span>Avg fight</span>
          <b>{n.avgMin !== null ? `${n.avgMin.toFixed(1)} min` : "—"}</b>
        </div>
        <div>
          <Shield size={16} />
          <span>Last fight</span>
          <b title={n.last?.date}>{n.lastDays === null ? "—" : n.lastDays > 400 ? fmtMonth(n.last!.date) : `${n.lastDays}d ago`}</b>
        </div>
      </div>

      <nav className="jp-pf-tabs" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </nav>

      <div className="jp-pf-body" key={tab}>
        {tab === "overview" && (
          <>
            <div className="jp-pf-grid">
              <MethodBar label="How they win" counts={n.winBy} total={n.wins.length} tone="win" />
              <MethodBar label="How they lose" counts={n.lossBy} total={n.losses.length} tone="loss" />
            </div>
            {n.all.length > 0 && (
              <div className="jp-pf-form">
                <span>Last {Math.min(10, n.all.length)} · newest first</span>
                <div>
                  {n.all.slice(0, 10).map((r, i) => (
                    <ResultBadge key={i} row={r} compact />
                  ))}
                </div>
              </div>
            )}
            {read.length > 0 && (
              <ul className="jp-pf-read">
                {read.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
            {tracked.length > 0 && f && (
              <div className="jp-pf-tracked">
                <h4>
                  <Trophy size={14} /> On Jango Playz
                </h4>
                {tracked.slice(0, 4).map((b) => {
                  const r = b.opponent ? resultFor(b.event.id, f.name, b.opponent.name) : null;
                  return (
                    <button key={b.fight.id} onClick={() => nav.goFight(b.event.id, b.fight.id)}>
                      <span>
                        vs {b.opponent?.name ?? "—"} · {b.event.title}
                      </span>
                      {r?.bout.winner ? (
                        <em className={r.bout.winner && f.name.includes(r.bout.winner.split(" ").slice(-1)[0]) ? "pos" : "neg"}>
                          {r.bout.winner.split(" ").slice(-1)[0]} · {r.bout.method} R{r.bout.round}
                        </em>
                      ) : (
                        <em>{b.event.date}</em>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {m.scope && <p className="jp-pf-empty">{m.scope}</p>}
          </>
        )}
        {tab === "history" && <HistoryList rows={m.rows} owner={owner} ownerName={m.name} source={m.historySource} />}
        {tab === "scouting" && (
          <div className="jp-pf-scout">
            {notes.length ? (
              notes.map((s, i) => (
                <article key={i} className={"k-" + s.kind}>
                  <div className="tags">
                    {s.tags.map((t) => (
                      <span key={t}>{SCOUT_TAG_LABEL[t] ?? t}</span>
                    ))}
                  </div>
                  <p>{s.note}</p>
                  <small>
                    {s.event} · {s.date} · {s.source}
                  </small>
                </article>
              ))
            ) : (
              <p className="jp-pf-empty">No scouting notes yet. They're added after each fight review from round-by-round reports, and they feed future picks.</p>
            )}
          </div>
        )}
        {tab === "clips" && (
          <div className="jp-pf-clips">
            <ClipStrip clips={clips} />
            {film.length > 0 && (
              <div className="jp-pf-tracked">
                <h4>Film room links</h4>
                {film.map((v) => (
                  <a key={v.url} className="jp-pf-filmlink" href={v.url} target="_blank" rel="noopener noreferrer">
                    <span>
                      {v.title} · {v.kind}
                    </span>
                    <em>{v.publisher} ↗</em>
                  </a>
                ))}
              </div>
            )}
            {!clips.length && !film.length && <p className="jp-pf-empty">No official clips linked for {firstName(m.name)} yet.</p>}
            <a className="jp-pf-src" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(m.name + " UFC")}`} target="_blank" rel="noopener noreferrer">
              Search more on YouTube ↗
            </a>
          </div>
        )}
        {tab === "stats" && (
          <>
            {m.stats && m.stats.lines.length > 0 && <StatsBars stats={m.stats} />}
            {m.officialStats && (
              <>
                {m.stats && <h4 className="jp-h4">UFC.com profile numbers</h4>}
                <div className="jp-pf-stats">
                  {COMBAT_METRICS.map((cm) => (
                    <div key={cm.key}>
                      <span>{cm.label}</span>
                      <b>
                        {m.officialStats![cm.key] ?? "—"} <small>{m.officialStats![cm.key] === undefined ? "" : cm.unit}</small>
                      </b>
                    </div>
                  ))}
                  <p className="jp-pf-empty">
                    {m.officialStats.scope} · checked {m.officialStats.asOf}.{" "}
                    <a href={m.officialStats.source} target="_blank" rel="noopener noreferrer">
                      Official stats ↗
                    </a>
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------- loading / fallback / opponent card ----------

function ProfileSkeleton({ name, slug, entry }: { name: string; slug?: string; entry?: DirectoryEntry }) {
  const row = slug ? NAME_BY_SLUG.get(slug) : undefined;
  return (
    <div className="jp-pf jp-pf-skel" aria-busy="true">
      <header className="jp-pf-hero">
        <div className="glow" aria-hidden="true" />
        <div className="pic">{slug ? <HeroPhoto name={name} slug={slug} /> : <div className="portrait initials loading" aria-hidden="true" />}</div>
        <div className="id">
          <span className="country">{entry?.ranks.length || entry?.p4p ? <RankChips entry={entry} /> : <i className="sk" style={{ width: 120 }} />}</span>
          <DialogTitle className="name">{row?.[1] ?? name}</DialogTitle>
          {row?.[2] && <span className="nick">“{row[2]}”</span>}
          <div className="rec">{row ? <strong>{row[5]}</strong> : <i className="sk" style={{ width: 90, height: 28 }} />}</div>
          <DialogDescription className="facts">{row ? `${rankedDivision(entry) ?? row[3]} · loading UFC career…` : "Loading profile…"}</DialogDescription>
        </div>
      </header>
      <div className="jp-pf-tiles">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <i className="sk dot" />
            <i className="sk" style={{ width: "70%" }} />
          </div>
        ))}
      </div>
      <div className="jp-pf-body">
        {[0, 1, 2, 3].map((i) => (
          <i key={i} className="sk row" />
        ))}
      </div>
    </div>
  );
}

/** When roster.json can't load: show what the bundled index knows. */
function RosterLite({ slug, entry }: { slug: string; entry?: DirectoryEntry }) {
  const row = NAME_BY_SLUG.get(slug)!;
  const [, name, nick, wc, year, rec] = row;
  return (
    <div className="jp-pf">
      <header className="jp-pf-hero">
        <div className="glow" aria-hidden="true" />
        <div className="pic">
          <HeroPhoto name={name} slug={slug} />
        </div>
        <div className="id">
          <span className="country">
            <RankChips entry={entry} />
          </span>
          <DialogTitle className="name">{name}</DialogTitle>
          {nick && <span className="nick">“{nick}”</span>}
          <div className="rec">
            <strong>{rec}</strong>
            <span className="lbl">UFC record</span>
          </div>
          <DialogDescription className="facts">
            {rankedDivision(entry) ?? wc} · last UFC fight {year}
          </DialogDescription>
        </div>
      </header>
      <div className="jp-pf-body">
        <p className="jp-pf-empty">The full UFC history couldn't load just now. Close and reopen the profile to try again.</p>
      </div>
    </div>
  );
}

function OpponentCard({ name, roster }: { name: string; roster: RosterState }) {
  const apps = useMemo(() => appearancesOf(name, roster.roster), [name, roster.roster]);
  const rec = resultRecord(apps.map((a) => ({ result: a.result }) as PastFight));
  const last = apps.find((a) => a.record);
  return (
    <div className="jp-pf jp-pf-opp">
      <header className="jp-pf-hero mini">
        <div className="glow" aria-hidden="true" />
        <div className="pic">
          <div className="portrait initials" role="img" aria-label={`${name}: no photo`}>
            <span>{initials(name) || <UserRound size={40} />}</span>
          </div>
        </div>
        <div className="id">
          <span className="country">
            <em className="rank">Opponent file</em>
          </span>
          <DialogTitle className="name">{name}</DialogTitle>
          <div className="rec">
            {apps.length > 0 && <strong>{rec}</strong>}
            <span className="lbl">{apps.length ? `vs fighters on Jango Playz · ${apps.length} known bout${apps.length > 1 ? "s" : ""}` : "No bouts on file"}</span>
          </div>
          <DialogDescription className="facts">
            {last?.record ? `Went into their ${fmtMonth(last.date)} bout at ${last.record}. ` : ""}No UFC fights since 2021, so there's no roster profile — this card collects every bout we know of from the fighters we track.
          </DialogDescription>
        </div>
      </header>
      <div className="jp-pf-body">
        <ol className="jp-pf-rows">
          {apps.map((a, i) => (
            <li key={`${a.date}-${a.vs.name}-${i}`} className={"res-" + a.result.toLowerCase()} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              <ResultBadge row={a} />
              <div className="who">
                <b className="optop">
                  <span className="vs">vs</span> <FighterName name={a.vs.name} id={a.vs.id} slug={a.vs.slug} className="opp" />
                </b>
                <span>
                  {a.event} · {a.date}
                </span>
              </div>
              <div className="how">
                <strong>{methodDetail(a)}</strong>
                <span>
                  {a.round ? `R${a.round}` : "R?"}
                  {a.time ? ` · ${a.time}` : ""}
                  {a.record ? ` · was ${a.record}` : ""}
                </span>
              </div>
            </li>
          ))}
          {roster.status === "loading" && <li className="sk row" aria-hidden="true" />}
          {!apps.length && roster.status !== "loading" && <li className="empty">We don't have any bouts on file for {name} yet.</li>}
        </ol>
        <p className="jp-pf-empty">Results are shown from {firstName(name)}'s side. “Was” is their record going into the bout when the source lists it.</p>
      </div>
    </div>
  );
}

function LightProfile({ entry }: { entry: DirectoryEntry }) {
  const champ = entry.ranks.find((r) => r.role === "champion");
  const prospect = entry.ranks.find((r) => r.role === "prospect");
  const contender = entry.ranks.find((r) => r.role === "contender");
  const c = champ?.division.champion;
  return (
    <div className="jp-pf light">
      <header className="jp-pf-hero">
        <div className="glow" aria-hidden="true" />
        <div className="pic">
          {c ? (
            <img className="portrait" src={c.img} alt={entry.name} />
          ) : (
            <div className="portrait initials">
              <span>{initials(entry.name)}</span>
            </div>
          )}
        </div>
        <div className="id">
          <span className="country">
            {champ ? (
              <em className="rank champion">
                <Crown size={12} /> {champ.division.name} champion
              </em>
            ) : contender ? (
              <em className="rank contender">
                #{contender.rank} {contender.division.name}
              </em>
            ) : prospect ? (
              <em className="rank prospect">Threat radar · {prospect.division.name}</em>
            ) : null}
            {entry.p4p && <em className="rank p4p">P4P #{entry.p4p.rank}</em>}
          </span>
          <DialogTitle className="name">{entry.name}</DialogTitle>
          {c?.nickname && <span className="nick">“{c.nickname}”</span>}
          <div className="rec">
            <strong>{c?.record ?? prospect?.prospect?.record ?? "Record on UFC.com"}</strong>
          </div>
          <DialogDescription className="facts">{c ? `Age ${c.age} · ${c.height} · ${c.reach}″ reach · ${c.from}` : prospect?.prospect ? `Age ${prospect.prospect.age} · ${prospect.prospect.tag}` : "UFC media rankings"}</DialogDescription>
        </div>
      </header>
      <div className="jp-pf-body">
        {c && (
          <p className="jp-pf-lead">
            {c.note}
            {c.style ? ` · ${c.style}` : ""}
          </p>
        )}
        {prospect?.prospect && <p className="jp-pf-lead">{prospect.prospect.why}</p>}
        {entry.ranks
          .filter((r) => r.role === "contender")
          .map((r) => (
            <p key={r.division.id} className="jp-pf-lead">
              Ranked #{r.rank} at {r.division.name.toLowerCase()} in the UFC media rankings
              {r.move === "up" ? `, up ${r.by}` : r.move === "down" ? `, down ${r.by}` : r.move === "new" ? " (new entry)" : ""}.
            </p>
          ))}
        {clipsForFighter(entry.name).length > 0 && <ClipStrip clips={clipsForFighter(entry.name)} />}
        <p className="jp-pf-empty">No UFC bouts on file for {firstName(entry.name)} yet — the full profile fills in after their UFC debut.</p>
      </div>
    </div>
  );
}

function ProfileView({ resolved, roster }: { resolved: Resolved; roster: RosterState }) {
  const seedM = useMemo(() => (resolved.kind === "seed" ? seedModel(resolved.fighter, resolved.entry, roster.roster) : null), [resolved, roster.roster]);
  const rosterM = useMemo(() => {
    if (resolved.kind !== "roster" || !roster.roster) return null;
    const r = roster.roster.bySlug.get(resolved.slug);
    return r ? rosterModel(r, resolved.entry, roster.roster) : null;
  }, [resolved, roster.roster]);
  if (seedM) return <FullProfile key={seedM.key} m={seedM} />;
  if (resolved.kind === "roster") {
    if (rosterM) return <FullProfile key={rosterM.key} m={rosterM} />;
    if (roster.status === "loading") return <ProfileSkeleton name={resolved.name} slug={resolved.slug} entry={resolved.entry} />;
    return <RosterLite slug={resolved.slug} entry={resolved.entry} />;
  }
  if (resolved.kind === "ranked") return <LightProfile key={resolved.entry.key} entry={resolved.entry} />;
  if (resolved.kind === "unknown") return <OpponentCard key={resolved.name} name={resolved.name} roster={roster} />;
  return null;
}

export function FighterProfileDialog({ target, onClose }: { target: string | null; onClose: () => void }) {
  const roster = useRoster(!!target);
  const ref = useMemo(() => (target ? decodeRef(target) : null), [target]);
  const resolved = useMemo(() => {
    if (!ref) return null;
    let r = resolveRef(ref, roster.roster);
    // Roster failed to load: resolve from names alone rather than spinning forever.
    if (r === "need-roster" && roster.status === "error") r = resolveRef({ name: ref.name, id: ref.id, slug: ref.slug }, null);
    if (r === "need-roster" && roster.status === "error") r = { kind: "unknown", name: ref.name };
    return r;
  }, [ref, roster.roster, roster.status]);
  // Scroll the dialog body back to the top when switching fighters (e.g. clicking an opponent's name).
  useEffect(() => {
    document.querySelector(".jp-pf-dialog")?.scrollTo({ top: 0 });
  }, [target]);
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="jp-pf-dialog">
        {ref && resolved ? resolved === "need-roster" ? <ProfileSkeleton name={ref.name} /> : <ProfileView key={target} resolved={resolved} roster={roster} /> : null}
      </DialogContent>
    </Dialog>
  );
}
