"use client";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  ArrowUpRight,
  Check,
  Expand,
  Eye,
  Target,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RoundsPick } from "./rounds-pick";
import { FinishScene } from "./finish-scene";
import { FighterDossier } from "./fighter-dossier";
import { MarketOdds } from "./market-odds";
import { ArenaStats } from "./arena-stats";
import { PromotionLogo } from "./promotion-logo";
import { Flag, UFCRecord } from "./research";
import { historySummary, usableStats, recordAtEvent } from "@/lib/model";
import {
  conciseReasons,
  confidence,
  strikingLosses,
  type Prediction,
} from "@/lib/matchup";
import type { Event, Fight, Fighter, Review } from "@/lib/types";
import { formatHeight, formatReach } from "@/lib/measurements";

export function Portrait({
  f,
  small = false,
}: {
  f: Fighter;
  small?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  return f.image && !broken ? (
    <img
      className={small ? "avatar" : "portrait"}
      src={f.image}
      alt={f.name}
      onError={() => setBroken(true)}
      loading={small ? "lazy" : "eager"}
      decoding="async"
    />
  ) : (
    <div
      className={small ? "avatar initials" : "portrait initials"}
      role="img"
      aria-label={`${f.name}: photo unavailable`}
    >
      <span>
        {f.name
          .split(" ")
          .slice(0, 2)
          .map((x) => x[0])
          .join("")}
      </span>
      {!small && <small>Photo unavailable</small>}
    </div>
  );
}
function FighterStage({
  f,
  event,
  onOpen,
  motion,
  rules,
}: {
  f: Fighter;
  event: Event;
  rules: Fight["rules"];
  onOpen: () => void;
  motion: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  function move(e: PointerEvent<HTMLButtonElement>) {
    if (
      !motion ||
      e.pointerType !== "mouse" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const r = e.currentTarget.getBoundingClientRect(),
      x = (e.clientX - r.left) / r.width,
      y = (e.clientY - r.top) / r.height;
    ref.current?.style.setProperty("--tilt-x", `${(y - 0.5) * -8}deg`);
    ref.current?.style.setProperty("--tilt-y", `${(x - 0.5) * 10}deg`);
    ref.current?.style.setProperty("--light-x", `${x * 100}%`);
  }
  function reset() {
    ref.current?.style.setProperty("--tilt-x", "0deg");
    ref.current?.style.setProperty("--tilt-y", "0deg");
  }
  return (
    <button
      type="button"
      ref={ref}
      className="fighter-stage"
      onPointerMove={move}
      onPointerLeave={reset}
      onBlur={reset}
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`Open ${f.name} portrait and profile`}
    >
      <div className="stage-depth">
        <div className="stage-rank" aria-hidden="true">
          {f.name.split(" ").slice(-1)[0]}
        </div>
        <Portrait key={f.id} f={f} />
        <div className="stage-title">
          <span className="stage-country">
            <Flag country={f.country} /> {f.country || "Country unverified"}
          </span>
          <h2>{f.name}</h2>
          <div className="stage-record">
            {recordAtEvent(f, event.date, rules)}
          </div>
          <UFCRecord f={f} date={event.date} />
        </div>
        <span className="portrait-expand">
          <Expand size={16} />
          <span>View fighter</span>
        </span>
      </div>
    </button>
  );
}
export function Faceoff({
  a,
  b,
  event,
  fight,
  onEdit,
  children,
}: {
  a: Fighter;
  b: Fighter;
  event: Event;
  fight: Fight;
  onEdit?: (f: Fighter) => void;
  children?: import("react").ReactNode;
}) {
  const [selected, setSelected] = useState<Fighter | null>(null),
    [reducedMotion, setReducedMotion] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(preference.matches);
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);
  function open(f: Fighter) {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setSelected(f);
  }
  const tiltEnabled = !reducedMotion;
  return (
    <>
      <div className={"arena " + (!tiltEnabled ? "motion-off" : "")}>
        <div className="arena-topline">
          <span className="arena-promotion">
            <PromotionLogo promotion={event.promotion} />
            <span>
              {fight.section} · {fight.division}
            </span>
          </span>
          <span>
            {fight.rules} · {fight.rounds} rounds
          </span>
        </div>
        <div className="arena-fighters">
          <FighterStage
            key={a.id}
            f={a}
            event={event}
            rules={fight.rules}
            motion={tiltEnabled}
            onOpen={() => open(a)}
          />
          <span className="arena-vs" aria-hidden="true">
            VS
          </span>
          <FighterStage
            key={b.id}
            f={b}
            event={event}
            rules={fight.rules}
            motion={tiltEnabled}
            onOpen={() => open(b)}
          />
        </div>
        {children}
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent
          className="portrait-dialog dossier-dialog"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            opener.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogDescription>
              Profile photo · {selected?.imageDate || "capture date unknown"}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <FighterDossier
              f={selected}
              event={event}
              fight={fight}
              onEdit={
                onEdit
                  ? () => {
                      onEdit(selected);
                      setSelected(null);
                    }
                  : undefined
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function PickVerdict({
  prediction: p,
  a,
  b,
  event,
  fight,
  review,
  onReview,
  onNotes,
  loaded,
}: {
  prediction: Prediction;
  a: Fighter;
  b: Fighter;
  event: Event;
  fight: Fight;
  review: Review;
  onReview: (r: Partial<Review>) => void;
  onNotes: () => void;
  loaded: boolean;
}) {
  const c = confidence(p),
    brief = conciseReasons(p, a, b, event, fight),
    winner = p.pick === a.id ? a : p.pick === b.id ? b : null;
  const yourPick = review.pick === a.id ? a : review.pick === b.id ? b : null;
  return (
    <div className="surface pick-verdict">
      <div className="pick-summary">
        <div className="pick-name">
          <p className="eyebrow">
            <Target size={14} /> MODEL PICK
          </p>
          <h3>{winner?.name || "Too close / needs research"}</h3>
          <span className="lean-label">{p.label}</span>
          {yourPick && (
            <button className="your-pick-pill" onClick={onNotes}>
              Your pick: {yourPick.name} <ArrowUpRight size={12} />
            </button>
          )}
        </div>
        <div className="confidence-display">
          <div
            className="confidence-ring"
            role="img"
            aria-label={
              c === null
                ? "No supported confidence estimate"
                : `${c}% model confidence, unvalidated`
            }
          >
            <svg key={c ?? "none"} viewBox="0 0 44 44" aria-hidden="true">
              <circle
                className="confidence-track"
                cx="22"
                cy="22"
                r="19"
                pathLength="100"
              />
              <circle
                className="confidence-value"
                cx="22"
                cy="22"
                r="19"
                pathLength="100"
                style={
                  { "--ring-end": String(100 - (c ?? 0)) } as CSSProperties
                }
              />
            </svg>
            <span>
              {c !== null ? (
                <>
                  {c}
                  <small>%</small>
                </>
              ) : (
                "—"
              )}
            </span>
          </div>
          <strong>Model confidence</strong>
          <small>Unvalidated estimate</small>
        </div>
      </div>
      <div className="pick-reasons">
        <p className="eyebrow">
          {winner ? "WHY THIS PICK" : "WHAT THE EVIDENCE SAYS"}
        </p>
        {brief.supporting.length ? (
          <ul>
            {brief.supporting.map((r, i) => (
              <li key={i}>
                <Check size={17} />
                <div>
                  <strong>{r.title}</strong>
                  <p>
                    {r.text}{" "}
                    {r.source && (
                      <a
                        href={r.source}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Source: ${r.title}`}
                      >
                        <ArrowUpRight size={13} />
                      </a>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>There isn’t enough comparable evidence for a supported pick.</p>
        )}
      </div>
      {brief.counter && (
        <div className="counter-case">
          <span>THE OTHER SIDE</span>
          <strong>{brief.counter.title}</strong>
          <p>
            {brief.counter.text}{" "}
            {brief.counter.source && (
              <a
                className="out"
                href={brief.counter.source}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Counterargument source"
              >
                <ArrowUpRight size={14} />
              </a>
            )}
          </p>
        </div>
      )}
      <div className="verdict-bottom">
        <span>No odds or outside predictions</span>
        <div>
          <Button
            size="sm"
            variant={review.agreement === "agree" ? "default" : "outline"}
            onClick={() =>
              onReview({
                agreement: review.agreement === "agree" ? undefined : "agree",
              })
            }
            disabled={!loaded || !winner}
            aria-pressed={review.agreement === "agree"}
          >
            <ThumbsUp size={14} />
            Agree
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onReview({ agreement: "disagree" });
              onNotes();
            }}
            disabled={!loaded}
          >
            <ThumbsDown size={14} />
            My take
          </Button>
        </div>
      </div>
      <details className="confidence-note">
        <summary>What does confidence mean?</summary>
        <p>
          It expresses the strength of this model’s lean, not a proven chance of
          winning. It is derived from the directional edge and starts near 50%
          for close calls, while strong evidence can reach 70–85%. It remains
          an unvalidated conviction score rather than a calibrated win
          probability. Missing evidence reduces the edge; no supported pick
          means no percentage.
        </p>
      </details>
    </div>
  );
}
const number = (v: number | undefined, places = 2) =>
  v === undefined || !Number.isFinite(v)
    ? "—"
    : v.toFixed(places).replace(/\.00$/, "");
export function MatchupPaths({
  a,
  b,
  event,
  fight,
  review,
  onNotes,
}: {
  a: Fighter;
  b: Fighter;
  event: Event;
  fight: Fight;
  review: Review;
  onNotes: () => void;
}) {
  const as = usableStats(a, event.date, fight.rules),
    bs = usableStats(b, event.date, fight.rules),
    ah = historySummary(a, event.date, fight.rules),
    bh = historySummary(b, event.date, fight.rules);
  const common = [...new Set(ah.all.map((h) => h.opponent))].filter((name) =>
    bh.all.some((h) => h.opponent === name),
  );
  const isWaldo =
    [a.id, b.id].includes("waldo-cortes-acosta") &&
    [a.id, b.id].includes("curtis-blaydes");
  return (
    <div className="surface matchup-paths">
      <div className="section-head">
        <h3>How this fight could play out</h3>
        <span className="tag">Explore the matchup</span>
      </div>
      <Tabs defaultValue="feet">
        <TabsList className="path-tabs">
          <TabsTrigger value="feet">On the feet</TabsTrigger>
          {fight.rules === "MMA" && (
            <TabsTrigger value="grappling">Wrestling & control</TabsTrigger>
          )}
          <TabsTrigger value="resume">Past opponents</TabsTrigger>
        </TabsList>
        <TabsContent value="feet">
          <div className="path-grid">
            {[a, b].map((f, i) => {
              const s = i === 0 ? as : bs,
                losses = strikingLosses(f, event.date, fight.rules);
              return (
                <div key={f.id} className="path-fighter">
                  <strong>
                    <Flag country={f.country} /> {f.name}
                  </strong>
                  <dl>
                    <div>
                      <dt>Strikes landed / absorbed</dt>
                      <dd>
                        {number(s?.slpm)} / {number(s?.sapm)}
                        <small>per minute</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Knockdowns</dt>
                      <dd>
                        {number(s?.kdPer15)}
                        <small>per 15 minutes</small>
                      </dd>
                    </div>
                    <div>
                      <dt>
                        KO/TKO losses in last{" "}
                        {i === 0 ? ah.recent.length : bh.recent.length}
                      </dt>
                      <dd>
                        {(i === 0 ? ah.recent.length : bh.recent.length)
                          ? losses.length
                          : "—"}
                        <small>
                          {losses.map((h) => h.opponent).join(", ") ||
                            ((i === 0 ? ah.recent.length : bh.recent.length)
                              ? "None in loaded sample"
                              : "History unavailable")}
                        </small>
                      </dd>
                    </div>
                  </dl>
                  {s && (
                    <a
                      className="out"
                      href={s.source}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      UFC stats <ArrowUpRight size={13} />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
          <p className="path-take">
            Striking output, defensive exposure and stoppage history belong
            together. These figures do not measure footwork or speed.
          </p>
        </TabsContent>
        {fight.rules === "MMA" && (
          <TabsContent value="grappling">
            <div className="path-grid">
              {[a, b].map((f, i) => {
                const s = i === 0 ? as : bs,
                  o = i === 0 ? bs : as,
                  opp = i === 0 ? b : a;
                return (
                  <div key={f.id} className="path-fighter">
                    <strong>
                      <Flag country={f.country} /> {f.name}
                    </strong>
                    <dl>
                      <div>
                        <dt>Takedowns landed / 15 min</dt>
                        <dd>{number(s?.tdPer15)}</dd>
                      </div>
                      <div>
                        <dt>{opp.name}’s takedown defence</dt>
                        <dd>
                          {number(o?.tdDefense, 0)}
                          {o?.tdDefense !== undefined ? "%" : ""}
                        </dd>
                      </div>
                      <div>
                        <dt>Control time / 15 min</dt>
                        <dd>
                          {number(s?.controlPer15)}
                          <small>
                            {s?.controlPer15 === undefined
                              ? "Not supplied by UFC profile"
                              : "minutes"}
                          </small>
                        </dd>
                      </div>
                    </dl>
                  </div>
                );
              })}
            </div>
            <p className="path-take">
              The question is whether the takedowns work against this
              opponent—and whether they lead to sustained control. A wrestling
              label alone cannot answer that.
            </p>
          </TabsContent>
        )}
        <TabsContent value="resume">
          {common.length ? (
            <div className="common-opponents">
              {common.slice(0, 6).map((name) => (
                <div key={name}>
                  <strong>{name}</strong>
                  <div>
                    {[ah, bh].map((h, i) => (
                      <div key={i}>
                        <b>{i === 0 ? a.name : b.name}</b>
                        {h.all
                          .filter((x) => x.opponent === name)
                          .map((x, j) => (
                            <p key={j}>
                              <span
                                className={"result " + x.result.toLowerCase()}
                              >
                                {x.result}
                              </span>{" "}
                              {x.method} · R{x.round ?? "?"}
                              <small>
                                {x.date} · opponent{" "}
                                {x.opponentRecord || "record unknown"}
                              </small>
                            </p>
                          ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <p className="fine">
                Shared opponents provide context. Different dates, styles and
                circumstances prevent a direct A-beats-B comparison.
              </p>
            </div>
          ) : (
            <div className="path-grid">
              {[a, b].map((f, i) => (
                <div key={f.id} className="path-fighter">
                  <strong>{f.name}</strong>
                  {(i === 0 ? ah : bh).recent.slice(0, 3).map((h, j) => (
                    <p key={j}>
                      <span className={"result " + h.result.toLowerCase()}>
                        {h.result}
                      </span>{" "}
                      {h.opponent}
                      <small>
                        {h.opponentRecord || "Pre-fight record unknown"} ·{" "}
                        {h.method}
                      </small>
                    </p>
                  ))}
                </div>
              ))}
              <p className="fine">No common opponents in the loaded history.</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
      {(isWaldo || review.physique) && (
        <div className="film-read">
          <Eye size={18} />
          <div>
            <strong>Your film read</strong>
            <p>
              {review.physique ||
                "You lean Cortés-Acosta: his movement and agility on the feet stand out to you, even with similar listed size."}
            </p>
            <small>
              {review.observedAt ||
                (isWaldo ? "2026-09-10" : "Date not recorded")}{" "}
              · Your observation, not a measured stat
            </small>
            {review.mediaUrl && (
              <a
                className="out"
                href={review.mediaUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Footage <ArrowUpRight size={13} />
              </a>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onNotes}>
            Add context
          </Button>
        </div>
      )}
    </div>
  );
}

export function TaleOfTape({ a, b }: { a: Fighter; b: Fighter }) {
  return (
    <div className="quick-tape">
      {[
        ["Height", formatHeight(a.height), formatHeight(b.height)],
        ["Reach", formatReach(a.reach), formatReach(b.reach)],
        ["Stance", a.stance || "Unverified", b.stance || "Unverified"],
      ].map(([label, x, y]) => (
        <div key={label}>
          <strong>{x}</strong>
          <span>{label}</span>
          <strong>{y}</strong>
        </div>
      ))}
    </div>
  );
}
