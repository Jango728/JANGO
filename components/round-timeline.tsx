"use client";
/**
 * How a logged bout went, round by round (LedgerBout.rounds + recap). Shared by the Track record's
 * "How it went", the Fight center Breakdown's result area and fighter-profile history rows.
 * Renders nothing when the bout has neither rounds nor a recap status.
 */
import { ArrowUpRight, Clock3, Flag } from "lucide-react";
import type { LedgerBout } from "@/lib/ledger-types";
import { endedByFinish, roundTally, surname, type RoundRow } from "@/lib/round-recaps";
import "@/src/rounds.css";

const shortDate = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });

/** Key-moment chips get a kind (colour + dot) from their wording; anything else is a neutral chip. */
function momentKind(m: string): string {
  const s = m.toLowerCase();
  if (/knock ?down|knocked down|dropped|\bkd\b|floored/.test(s)) return "kd";
  if (/rock|hurt|wobbl|stagger|recover|survived/.test(s)) return "rocked";
  if (/cardio|fade|faded|tired|gas|slow(ed)? down/.test(s)) return "cardio";
  if (/takedown|\btd|wrestl|control|top position|slam/.test(s)) return "td";
  if (/cut|blood|swell|eye|poke|foul|point deduct/.test(s)) return "cut";
  if (/sub|choke|armbar|guillotine|lock/.test(s)) return "sub";
  return "other";
}

/** "10-9 a" → "10-9 Van"; unparseable scores are shown as written. */
function scoreText(score: string, a: string, b: string) {
  const m = /^\s*(\d{1,2}\s*-\s*\d{1,2})\s*([ab])?\s*$/i.exec(score);
  if (!m) return score;
  return m[2] ? `${m[1].replace(/\s/g, "")} ${m[2].toLowerCase() === "a" ? surname(a) : surname(b)}` : m[1].replace(/\s/g, "");
}

function EdgeChip({ r, a, b }: { r: RoundRow; a: string; b: string }) {
  if (r.edge === "a" || r.edge === "b") {
    const who = r.edge === "a" ? a : b;
    return (
      <span className={"rr-edge " + r.edge} title={`Round ${r.n} to ${who} per the write-ups`}>
        <i aria-hidden="true" />
        {surname(who)}
        <span className="sr-only"> won round {r.n}</span>
      </span>
    );
  }
  if (r.edge === "even") return <span className="rr-edge even" title={`Round ${r.n} scored even / split by the write-ups`}>Even</span>;
  return <span className="rr-edge none" title="No round winner given in the write-ups">—</span>;
}

export function RoundTimeline({
  bout,
  followUpUntil,
  compact = false,
  heading = "Round by round",
}: {
  bout: LedgerBout;
  /** Last day of the card's review window (lib/round-recaps.ts followUpFor), for the "pending" line. */
  followUpUntil?: string;
  /** Tighter spacing for narrow places (profile rows). */
  compact?: boolean;
  heading?: string | null;
}) {
  const rounds = [...(bout.rounds ?? [])].sort((x, y) => x.n - y.n);
  const recap = bout.recap ?? null;
  if (!rounds.length && !recap) return null;
  const until = followUpUntil ? shortDate(followUpUntil) : null;

  // No rounds yet: just the status line.
  if (!rounds.length) {
    if (recap?.status === "unavailable")
      return (
        <p className="rr-status muted" role="note">
          No round-by-round write-up found for this bout{recap.note ? ` — ${recap.note}` : "."}
        </p>
      );
    return (
      <p className="rr-status pending" role="note">
        <Clock3 size={13} aria-hidden="true" />
        <span>
          Round-by-round recap pending — we keep checking for write-ups{until ? ` until ${until}` : " through the review window"}.
        </span>
      </p>
    );
  }

  const finish = endedByFinish(bout);
  const lastN = rounds[rounds.length - 1].n;
  const t = roundTally(rounds);
  const tally = [t.a ? `${surname(bout.a)} ${t.a}` : null, t.b ? `${surname(bout.b)} ${t.b}` : null, t.even ? `even ${t.even}` : null].filter(Boolean).join(" · ");
  const endText = finish ? `${bout.detail ?? bout.method} · ${bout.time}` : bout.method === "Decision" ? bout.detail?.replace(/\s*\(.*$/, "") ?? "Decision" : bout.detail ?? bout.method;

  return (
    <div className={"rr" + (compact ? " compact" : "")}>
      {heading !== null && (
        <div className="rr-head">
          <strong>{heading}</strong>
          {tally && <span className="rr-tally">Rounds won per the write-ups: {tally}</span>}
          {recap?.status === "partial" && <span className="rr-tag">Partial</span>}
        </div>
      )}
      <ol className="rr-list" aria-label={`Round by round: ${bout.a} vs ${bout.b}`}>
        {rounds.map((r) => {
          const isEnd = r.n === lastN && r.n === bout.round;
          return (
            <li key={r.n} className={"rr-round" + (r.edge ? " e-" + r.edge : "") + (isEnd && finish ? " finish" : "")}>
              <div className="rr-rail">
                <span className="rr-n" aria-label={`Round ${r.n}`}>
                  R{r.n}
                </span>
              </div>
              <div className="rr-body">
                <div className="rr-top">
                  <EdgeChip r={r} a={bout.a} b={bout.b} />
                  {r.score && <span className="rr-score">{scoreText(r.score, bout.a, bout.b)}</span>}
                  {isEnd && (
                    <span className={"rr-end" + (finish ? " fin" : " dec")}>
                      <Flag size={11} aria-hidden="true" />
                      {finish ? "Finish" : "Final bell"} · {endText}
                    </span>
                  )}
                </div>
                <p className="rr-summary">{r.summary}</p>
                {r.keyMoments && r.keyMoments.length > 0 && (
                  <ul className="rr-moments" aria-label={`Key moments, round ${r.n}`}>
                    {r.keyMoments.map((m, i) => (
                      <li key={i} className={"k-" + momentKind(m)}>
                        {m}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {recap?.status === "partial" && (
        <p className="rr-status pending" role="note">
          <Clock3 size={13} aria-hidden="true" />
          <span>Partial recap — some rounds are still thin; we keep checking for write-ups{until ? ` until ${until}` : " through the review window"}.</span>
        </p>
      )}
      {recap && (recap.sources.length > 0 || recap.checkedAt) && (
        <div className="rr-sources">
          {recap.sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
              {s.label} <ArrowUpRight size={11} aria-hidden="true" />
            </a>
          ))}
          {recap.checkedAt && <span className="rr-checked">checked {shortDate(recap.checkedAt.slice(0, 10))}</span>}
        </div>
      )}
      {recap?.note && recap.status !== "partial" && <p className="rr-note">{recap.note}</p>}
    </div>
  );
}

/** True when a bout has anything the timeline would show. */
export const hasRoundRecap = (b: LedgerBout) => !!(b.rounds?.length || b.recap);
