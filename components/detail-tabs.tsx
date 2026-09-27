"use client";
// Secondary matchup tabs (Compare stats, Full history, My notes). Loaded on first use so the
// Prediction view stays light.
import { ArenaStats } from "./arena-stats";
import { MatchupPaths } from "./matchup-paths";
import { History, RecentSummary } from "./research";
import { NotesPanel } from "./notes-panel";
import type { EnginePrediction } from "@/lib/engine";
import type { Event, Fight, Fighter, Review } from "@/lib/types";

type Props = { a: Fighter; b: Fighter; event: Event; fight: Fight };

export function StatsTab({ a, b, event, fight, prediction, review, onNotes }: Props & { prediction: EnginePrediction; review: Review; onNotes: () => void }) {
  return (
    <>
      <ArenaStats a={a} b={b} event={event} fight={fight} />
      <MatchupPaths key={fight.id} a={a} b={b} event={event} fight={fight} review={review} onNotes={onNotes} />
      <RecentSummary a={a} b={b} event={event} rules={fight.rules} />
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
  );
}

export function HistoryTab({ a, b, event, fight }: Props) {
  return (
    <div className="jp-card">
      <h3 className="jp-h3">Who did they actually fight?</h3>
      <p className="jp-fine">Tap any fight for the opponent's record going in, weight class, promotion and how it ended.</p>
      <div className="history-grid">
        <History key={a.id} f={a} rules={fight.rules} event={event} />
        <History key={b.id} f={b} rules={fight.rules} event={event} />
      </div>
    </div>
  );
}

export function NotesTab({ a, b, fight, review, onSave }: Props & { review: Review; onSave: (patch: Partial<Review>) => void }) {
  return <NotesPanel key={fight.id} a={a} b={b} review={review} onSave={onSave} />;
}
