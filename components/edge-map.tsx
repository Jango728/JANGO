import { useState } from "react";
import type { EnginePrediction } from "@/lib/engine";
import { shortName } from "@/lib/engine";
import type { Fighter } from "@/lib/types";

/** Every factor on one diverging bar: left = fighter A's edge, right = fighter B's. No weights shown. */
export function EdgeMap({ p, a, b }: { p: EnginePrediction; a: Fighter; b: Fighter }) {
  const rows = p.signals.filter((s) => s.id !== "h2h" || s.score !== null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((s) => s.id === openId);
  return (
    <section className="jp-card jp-edges" aria-label="Where the edges are">
      <header>
        <span className="jp-edge-name a">{shortName(a.name)}</span>
        <h3 className="jp-h3">Where the edges are</h3>
        <span className="jp-edge-name b">{shortName(b.name)}</span>
      </header>
      <div className="jp-edge-rows">
        {rows.map((s) => {
          const v = s.score ?? 0;
          const w = Math.min(100, Math.abs(v) * 100);
          const side = s.score === null ? "none" : Math.abs(v) < 0.03 ? "even" : v > 0 ? "a" : "b";
          return (
            <button
              type="button"
              key={s.id}
              className={"jp-edge " + side + (openId === s.id ? " sel" : "")}
              aria-pressed={openId === s.id}
              onClick={() => setOpenId(openId === s.id ? null : s.id)}
            >
              <div className="jp-edge-bar left">{side === "a" && <i style={{ width: `${w}%` }} />}</div>
              <span>{s.label}</span>
              <div className="jp-edge-bar right">{side === "b" && <i style={{ width: `${w}%` }} />}</div>
            </button>
          );
        })}
      </div>
      {open ? (
        <p className="jp-edge-why" key={open.id}>
          <b>{open.label}:</b> {open.reason ? `${open.reason.title} — ${open.reason.text}` : open.score === null ? "Not enough verified data yet." : "Dead even on this one."}
        </p>
      ) : (
        <p className="jp-fine">Tap a row for the reason. Grey = even, dashed = not enough data yet.</p>
      )}
    </section>
  );
}
