"use client";
/**
 * Breakdown tab for a Fight center bout. Loaded as its own chunk the first time the tab shows.
 *
 * Consistency: it receives the exact prediction / rounds / finish objects App.tsx computes for the
 * verdict strip and the Prediction tab (the live engine, run as of the event date), so every number
 * here matches them. For a finished bout it adds the official result and how the FROZEN final pick
 * (lib/ledger.ts: last revision before lock) was graded; nothing is recomputed with post-fight data.
 *
 * The UFC roster (4.6 MB, for division averages and skill percentiles) is fetched only when those
 * cards near the viewport, once per session (lib/roster-load.ts caches it).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EnginePrediction } from "@/lib/engine";
import type { FinishPrediction } from "@/lib/finish";
import type { RoundsPrediction } from "@/lib/rounds";
import { loadRoster, peekRoster, type Roster } from "@/lib/roster-load";
import { resultFor } from "@/lib/ledger";
import { displayStats, fmtLongDate } from "@/lib/breakdown";
import type { Event, Fight, Fighter } from "@/lib/types";
import type { LockInfo } from "@/lib/displayed-pick";
import { Breakdown, type BreakdownResult, type BreakdownRoster } from "./breakdown";

function useLazyRoster(): BreakdownRoster {
  const [st, set] = useState<{ status: BreakdownRoster["status"]; roster: Roster | null }>(() => {
    const r = peekRoster();
    return r ? { status: "ready", roster: r } : { status: "idle", roster: null };
  });
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const request = useCallback(() => {
    const r = peekRoster();
    if (r) {
      set({ status: "ready", roster: r });
      return;
    }
    set((s) => (s.status === "loading" ? s : { status: "loading", roster: null }));
    loadRoster().then(
      (x) => live.current && set({ status: "ready", roster: x }),
      () => live.current && set({ status: "error", roster: null }),
    );
  }, []);
  return useMemo(() => ({ ...st, request }), [st, request]);
}

export function BoutBreakdown({ a, b, event, fight, prediction, rounds, finish, lock = null }: { a: Fighter; b: Fighter; event: Event; fight: Fight; prediction: EnginePrediction; rounds: RoundsPrediction | null; finish: FinishPrediction | null; lock?: LockInfo | null }) {
  const roster = useLazyRoster();

  const result = useMemo<BreakdownResult | null>(() => {
    const s = resultFor(event.id, a.name, b.name);
    if (!s) return null;
    const bout = s.bout, fc = s.forecast;
    const raw = bout.detail ?? bout.method;
    // "won by split decision (…)", "won by KO/TKO (punches)": lower-case the first word unless it's an acronym.
    const how = bout.method === "Draw" || bout.method === "No contest" ? raw : /^[A-Z]{2}/.test(raw) ? raw : raw.charAt(0).toLowerCase() + raw.slice(1);
    return {
      winner: bout.winner,
      how,
      round: bout.round,
      time: bout.time,
      ou: bout.ou,
      line: bout.line,
      graded: fc ? { pick: fc.pick, confidence: fc.confidence, winner: s.winner, rounds: fc.rounds, roundsHit: s.rounds, method: fc.method, methodHit: s.method } : null,
    };
  }, [event.id, a, b]);

  const notes = useMemo(() => {
    const out: string[] = [];
    const finished = !!result;
    out.push(
      finished
        ? `Pre-fight data only: every number here reads bouts before ${fmtLongDate(event.date)}, so the result itself never feeds the breakdown.`
        : `As of fight night (${fmtLongDate(event.date)}): only bouts before the event count; the nightly refresh adds new results and scouting notes.`,
    );
    for (const f of [a, b])
      // Skip when the engine already lists the same gap (it's shown right below).
      if (fight.rules === "MMA" && !displayStats(f, event.date) && !prediction.gaps.some((g) => g.startsWith(f.name) && /UFC striking/i.test(g)))
        out.push(`${f.name}: no UFC fight with official stats yet, so striking and grappling show "no UFC data" and the engine leaves those factors out. Record, form, size and opposition still count.`);
    return out;
  }, [a, b, event.date, fight.rules, result, prediction.gaps]);

  return <Breakdown a={a} b={b} prediction={prediction} rounds={rounds} finish={finish} event={event} fight={fight} roster={roster} mode="card" notes={notes} result={result} lock={lock} />;
}
