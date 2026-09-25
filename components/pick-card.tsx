"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { Check, Scale, ThumbsDown, ThumbsUp, Target, ShieldAlert } from "lucide-react";
import { shortName, type EnginePrediction } from "@/lib/engine";
import type { Fighter, Review } from "@/lib/types";

/** Gold ring that winds up to the confidence value when it mounts. */
export function ConfidenceRing({ value, size = 96 }: { value: number | null; size?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (value === null) return;
    setShown(0);
    const id = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(id);
  }, [value]);
  return (
    <div className="jp-ring" style={{ width: size, height: size } as CSSProperties} role="img" aria-label={value === null ? "No confidence yet" : `${value}% model confidence`}>
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle className="jp-ring-track" cx="22" cy="22" r="19" pathLength="100" />
        <circle className="jp-ring-value" cx="22" cy="22" r="19" pathLength="100" style={{ strokeDashoffset: 100 - shown } as CSSProperties} />
      </svg>
      <span>
        {value === null ? "N/A" : (
          <>
            {value}
            <small>%</small>
          </>
        )}
      </span>
    </div>
  );
}

const TIER_CLASS: Record<string, string> = {
  "Coin flip": "tier-flip",
  "Slight lean": "tier-slight",
  "Solid lean": "tier-solid",
  "Strong pick": "tier-strong",
  Exceptional: "tier-exceptional",
};

export function PickCard({
  p,
  a,
  b,
  review,
  onReview,
  onMyTake,
}: {
  p: EnginePrediction;
  a: Fighter;
  b: Fighter;
  review: Review;
  onReview: (r: Partial<Review>) => void;
  onMyTake: () => void;
}) {
  const winner = p.pick === a.id ? a : p.pick === b.id ? b : null;
  const yours = review.pick === a.id ? a : review.pick === b.id ? b : null;
  return (
    <section className="jp-card jp-pick" aria-label="Model pick">
      <header className="jp-pick-head">
        <div>
          <p className="jp-eyebrow">
            <Target size={13} /> Model pick
          </p>
          <h3>{winner ? winner.name : "Analysis pending"}</h3>
          {p.tier ? <span className={"jp-tier " + TIER_CLASS[p.tier]}>{p.tier}</span> : <span className="jp-tier tier-pending">N/A</span>}
          {yours && (
            <button type="button" className="jp-yours" onClick={onMyTake}>
              Your pick: {yours.name}
            </button>
          )}
        </div>
        <div className="jp-pick-ring">
          <ConfidenceRing value={p.confidence} />
          <small>Model confidence</small>
        </div>
      </header>

      {p.status === "pending" ? (
        <p className="jp-pending">
          <ShieldAlert size={16} /> {p.pendingReason} It will be filled in on the next nightly refresh once the data is verified.
        </p>
      ) : (
        <>
          <div className="jp-block">
            <p className="jp-eyebrow">Why {winner ? shortName(winner.name) : "this pick"}</p>
            <ul className="jp-reasons">
              {p.reasons.map((r, i) => (
                <li key={i}>
                  <Check size={16} />
                  <div>
                    <strong>{r.title}</strong>
                    <p>{r.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          {p.counter && (
            <div className="jp-counter">
              <span>The other side</span>
              <strong>{p.counter.title}</strong>
              <p>{p.counter.text}</p>
            </div>
          )}
          <div className="jp-consensus" aria-label="Model consensus">
            <span className="jp-eyebrow">
              <Scale size={13} /> Consensus
            </span>
            <div>
              {p.models.map((m) => (
                <span key={m.id} className={"jp-chip " + (m.lean === null ? "neutral" : m.lean === p.pick ? "agree" : "disagree")} title={m.lean === null ? "No clear lean / not enough data" : m.lean === p.pick ? "Agrees with the pick" : "Leans the other way"}>
                  {m.label}
                  <b>{m.lean === null ? "—" : m.lean === a.id ? shortName(a.name) : shortName(b.name)}</b>
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      <footer className="jp-pick-foot">
        <span className={"jp-evidence ev-" + p.evidenceLabel.toLowerCase()} title={p.gaps.length ? p.gaps.join(" · ") : "All model inputs loaded"}>
          Data: {p.evidenceLabel}
        </span>
        <span className="jp-fine">No odds · no outside picks</span>
        <div className="jp-actions">
          <button type="button" className={"jp-btn ghost " + (review.agreement === "agree" ? "on" : "")} disabled={!winner} aria-pressed={review.agreement === "agree"} onClick={() => onReview({ agreement: review.agreement === "agree" ? undefined : "agree" })}>
            <ThumbsUp size={14} /> Agree
          </button>
          <button
            type="button"
            className={"jp-btn ghost " + (review.agreement === "disagree" ? "on" : "")}
            onClick={() => {
              onReview({ agreement: "disagree" });
              onMyTake();
            }}
          >
            <ThumbsDown size={14} /> My take
          </button>
        </div>
      </footer>
    </section>
  );
}
