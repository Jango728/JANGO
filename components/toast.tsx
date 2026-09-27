"use client";
import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";

/** Tiny toast: one short status line at a time, announced politely to screen readers. */
type Toast = { id: number; kind: "success" | "error"; text: string };
let listener: ((t: Toast) => void) | null = null;
let seq = 0;
const push = (kind: Toast["kind"], text: string) => listener?.({ id: ++seq, kind, text });
export const toast = { success: (text: string) => push("success", text), error: (text: string) => push("error", text) };

export function Toaster() {
  const [current, setCurrent] = useState<Toast | null>(null);
  useEffect(() => {
    listener = setCurrent;
    return () => {
      listener = null;
    };
  }, []);
  useEffect(() => {
    if (!current) return;
    const id = setTimeout(() => setCurrent(null), 3200);
    return () => clearTimeout(id);
  }, [current]);
  return (
    <div className="jp-toaster" role="status" aria-live="polite">
      {current && (
        <div key={current.id} className={"jp-toast " + current.kind}>
          {current.kind === "success" ? <CircleCheck size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
          <span>{current.text}</span>
        </div>
      )}
    </div>
  );
}
