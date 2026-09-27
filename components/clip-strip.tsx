"use client";
import { useMemo, useState } from "react";
import { clipEventLine, clipLabel, clipMatchup, clipTime, clipTone, type Clip } from "@/lib/clips";
import { ClipCard, ClipStage, useClipMode } from "./clip-art";

/**
 * Compact clip shelf used in fighter profiles and the Film room: the same cards as the Clips page
 * in a horizontal row. Embed mode plays the picked clip in a small stage above the row; link mode
 * opens YouTube in a new tab.
 */
export function ClipStrip({ clips }: { clips: Clip[] }) {
  const mode = useClipMode();
  const list = useMemo(() => {
    const seen = new Set<string>();
    return clips.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).sort((a, b) => clipTime(b) - clipTime(a));
  }, [clips]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const current = list.find((c) => c.id === currentId) ?? null;
  if (!list.length) return null;

  const pick = (c: Clip) => {
    setCurrentId(c.id);
    if (mode === "link") setOpened((s) => new Set(s).add(c.id));
  };

  return (
    <div className="jp-cstrip" data-mode={mode}>
      {mode === "embed" && current && (
        <div className="jp-cstrip-stage">
          <ClipStage clip={current} mode={mode} playing onPlay={() => {}} size="compact" />
          <div className="jp-cstrip-now">
            <span className="jp-fmt" data-format={clipTone(current)}>{clipLabel(current)}</span>
            <b>{clipMatchup(current)}</b>
            <small>{clipEventLine(current)}</small>
          </div>
        </div>
      )}
      <div className="jp-cstrip-row" role="list">
        {list.map((c) => (
          <div role="listitem" key={c.id} className="jp-cstrip-item">
            <ClipCard clip={c} mode={mode} onPick={pick} state={{ selected: c.id === currentId, playing: mode === "embed" && c.id === currentId, opened: opened.has(c.id) }} />
          </div>
        ))}
      </div>
      <p className="jp-cstrip-note">
        {mode === "link" ? (
          "Official promotion uploads · each clip opens on YouTube in a new tab ↗"
        ) : (
          "Official promotion uploads, embedded from YouTube."
        )}
      </p>
    </div>
  );
}
