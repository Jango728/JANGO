import { useMemo, useState } from "react";
import { History, Target, Timer, Zap } from "lucide-react";
import { tierFor, type EnginePrediction } from "@/lib/engine";
import type { RoundsPrediction } from "@/lib/rounds";
import type { FinishPrediction } from "@/lib/finish";
import type { Fighter } from "@/lib/types";
import type { PickCall, PickRevision } from "@/lib/ledger-types";
import { sameCall, type LockInfo } from "@/lib/displayed-pick";
import { pickHistory, sameFighter } from "@/lib/ledger";
import "@/src/revisions.css";

/** Confidence wording shared by every pick on the site: "64% · Solid lean". */
export const confidenceLine = (pct: number | null | undefined) => (pct == null ? "N/A" : `${pct}% · ${tierFor(pct)}`);

/**
 * The three calls for a bout in one line, directly under the faceoff so they stay visible on every tab:
 * winner (with confidence tier), rounds over/under, and method.
 */
export function VerdictStrip({ p, rounds, finish, a, b, lock = null }: { p: EnginePrediction; rounds: RoundsPrediction | null; finish: FinishPrediction | null; a: Fighter; b: Fighter; lock?: LockInfo | null }) {
  const winner = p.pick === a.id ? a : p.pick === b.id ? b : null;
  const corner = winner === a ? "red" : winner === b ? "blue" : "";
  return (
    <div className="jp-verdict-strip" aria-label="Model calls for this fight">
      <div className={"jp-vs-cell win " + corner}>
        <span className="jp-vs-label">
          <Target size={13} aria-hidden="true" /> Winner
          {lock && <em className="jp-vs-lock" title="The frozen final pick from before the card locked: what the Track record grades">Locked</em>}
        </span>
        <strong>{winner ? winner.name : "N/A"}</strong>
        <small title={winner ? undefined : p.pendingReason}>{winner ? `${p.confidence}% · ${p.tier}` : lock ? "No pick was frozen" : "Not enough verified data yet"}</small>
      </div>
      <div className="jp-vs-cell">
        <span className="jp-vs-label">
          <Timer size={13} aria-hidden="true" /> Rounds
        </span>
        <strong>{rounds ? `${rounds.side} ${rounds.line}` : "—"}</strong>
        <small>{lock ? (rounds ? "Frozen before the fight" : "No rounds call frozen") : rounds ? (rounds.limited ? `${confidenceLine(rounds.confidence)} · thin data` : confidenceLine(rounds.confidence)) : "No standard line for this format"}</small>
      </div>
      <div className="jp-vs-cell">
        <span className="jp-vs-label">
          <Zap size={13} aria-hidden="true" /> Method
        </span>
        <strong>{finish ? finish.label : "—"}</strong>
        <small>{lock ? (finish ? "Frozen before the fight" : "No method call frozen") : finish ? (finish.limited ? "Low evidence" : "Most likely finish") : "Needs a winner pick"}</small>
      </div>
    </div>
  );
}

/* ---------- pick revisions: "Updated Sep 27: was X 61% → now Y 58% · reason" ---------- */

const TZ = "America/Toronto";
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: TZ });
const fmtLock = (iso: string) =>
  new Date(iso).toLocaleString("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ }) + " ET";
const winnerText = (c: PickCall) => (c.pick ? `${c.pick}${c.confidence != null ? ` ${c.confidence}%` : ""}` : "N/A");
const roundsText = (c: PickCall) => (c.rounds ? `${c.rounds.side} ${c.rounds.line}` : "no rounds line");
const fullText = (c: PickCall) => [winnerText(c), roundsText(c), c.method ?? "no method"].join(" · ");
/** Only the parts that changed (the winner is always shown so the line reads on its own). */
const partsText = (c: PickCall, changed: PickRevision["changed"]) =>
  [winnerText(c), changed.includes("rounds") ? roundsText(c) : null, changed.includes("method") ? c.method ?? "no method" : null].filter(Boolean).join(" · ");

/**
 * The recorded pick's story for one bout: shown under the verdict strip only when the pick was revised
 * before lock, or when the bout is a replacement. The opening pick always stays on record.
 */
export function PickUpdates({ eventId, a, b, live = null }: { eventId: string; a: Fighter; b: Fighter; live?: PickCall | null }) {
  const h = useMemo(() => pickHistory(eventId, a.name, b.name), [eventId, a.name, b.name]);
  const [open, setOpen] = useState(false);
  if (!h) return null;
  const rep = h.frozen.replaces ? pickHistory(eventId, h.frozen.replaces.a, h.frozen.replaces.b) : null;
  if (!h.revisions.length && !rep && !h.frozen.note) return null;
  const last = h.revisions[h.revisions.length - 1];
  const prev: PickCall = h.revisions.length > 1 ? h.revisions[h.revisions.length - 2] : h.opening;
  const oldOpponent = rep ? [rep.frozen.a, rep.frozen.b].find((n) => !sameFighter(n, a.name) && !sameFighter(n, b.name)) : null;
  const steps = h.revisions.length + 1 + (rep ? 1 : 0);
  const stale = !!live && !sameCall(live, h.final, { a: a.name, b: b.name });
  return (
    <div className="jp-pick-updates" aria-label="Pick history">
      <p className="jp-pu-line">
        <History size={13} aria-hidden="true" />
        {last && stale ? (
          // Before lock the page shows the live engine; when it has moved since the last logged revision (by less
          // than the revision threshold, or since last night), this line is history, not the current pick.
          <span>
            <b>Last recorded {fmtDay(last.at)}:</b> {fullText(last)} · {last.reason} — updates are logged nightly when the change is material
          </span>
        ) : last ? (
          <span>
            <b>Updated {fmtDay(last.at)}:</b> was <span className="jp-pu-was">{partsText(prev, last.changed)}</span> → now <strong>{partsText(last, last.changed)}</strong> · {last.reason}
          </span>
        ) : rep ? (
          <span>
            <b>{h.frozen.note ?? "Replacement bout"}:</b> the pick vs {oldOpponent ?? "the original opponent"} was {winnerText(rep.final)} (kept on record, not graded)
          </span>
        ) : (
          <span>
            <b>{h.frozen.note}</b>
          </span>
        )}
        <button type="button" className="jp-pu-toggle" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
          {open ? "Hide" : "History"} ({steps})
        </button>
      </p>
      {open && (
        <ol className="jp-pu-history">
          {rep && (
            <li className="jp-pu-old">
              <time>{fmtDay(rep.openedAt)}</time>
              <span className="jp-pu-kind">Original bout</span>
              <span>
                {rep.frozen.a} vs {rep.frozen.b}: {fullText(rep.final)} · {rep.frozen.statusNote ?? "replaced"} · not graded
              </span>
            </li>
          )}
          <li>
            <time>{fmtDay(h.openedAt)}</time>
            <span className="jp-pu-kind">Opening</span>
            <span>
              {fullText(h.opening)}
              {h.frozen.note ? ` · ${h.frozen.note}` : ""} <em>engine {h.openingEngine}</em>
            </span>
          </li>
          {h.revisions.map((r) => (
            <li key={r.at}>
              <time>{fmtDay(r.at)}</time>
              <span className="jp-pu-kind">Revised</span>
              <span>
                {fullText(r)} · {r.reason} <em>engine {r.engine}</em>
              </span>
            </li>
          ))}
          <li className="jp-pu-lock">
            {h.locked ? "Locked" : "Locks"} {fmtLock(h.lockAt)} · the last pick before lock is the one graded; the opening pick is graded too, for transparency.
          </li>
        </ol>
      )}
    </div>
  );
}
