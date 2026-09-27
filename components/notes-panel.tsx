"use client";
import { useEffect, useState } from "react";
import { Check, Save } from "lucide-react";
import { toast } from "./toast";
import { shortName } from "@/lib/engine";
import type { Fighter, Review } from "@/lib/types";

/** "My notes": explicit Save button with a clear saved / unsaved state. Stored in this browser only. */
export function NotesPanel({ a, b, review, onSave }: { a: Fighter; b: Fighter; review: Review; onSave: (patch: Partial<Review>) => void }) {
  const [draft, setDraft] = useState(review.notes ?? "");
  const [savedAt, setSavedAt] = useState<string | null>(review.notes ? "earlier" : null);
  useEffect(() => {
    setDraft(review.notes ?? "");
    setSavedAt(review.notes ? "earlier" : null);
    // reset only when switching fights
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id, b.id]);
  const dirty = draft !== (review.notes ?? "");
  const save = () => {
    onSave({ notes: draft });
    setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    toast.success("Notes saved");
  };
  return (
    <div className="jp-card jp-notes-panel">
      <h3 className="jp-h3">Your read</h3>
      <div className="jp-seg" role="radiogroup" aria-label="Your winner">
        {[a, b].map((f) => (
          <button key={f.id} role="radio" aria-checked={review.pick === f.id} className={review.pick === f.id ? "on" : ""} onClick={() => onSave({ pick: review.pick === f.id ? undefined : f.id })}>
            {shortName(f.name)}
          </button>
        ))}
      </div>
      <label className="jp-field">
        <span>Why — and the best case for the other guy</span>
        <textarea
          rows={6}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              save();
            }
          }}
          placeholder="Who wins, how, and why? Physique, film, anything the stats miss…"
        />
      </label>
      <div className="jp-notes-bar">
        <button className="jp-btn jp-save" onClick={save} disabled={!dirty}>
          <Save size={15} /> Save notes
        </button>
        <span className={"jp-save-state " + (dirty ? "dirty" : savedAt ? "ok" : "")}>
          {dirty ? "Unsaved changes" : savedAt ? (
            <>
              <Check size={14} /> Saved{savedAt !== "earlier" ? ` at ${savedAt}` : ""}
            </>
          ) : (
            "Nothing saved yet"
          )}
        </span>
      </div>
      <p className="jp-fine">Saved in this browser only (Ctrl/⌘+S works too). Your notes never change the model's pick.</p>
    </div>
  );
}
