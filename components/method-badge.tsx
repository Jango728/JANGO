import { CircleSlash, ClipboardList, Equal, Flag, Lock, Zap } from "lucide-react";
import { classifyMethod, type MethodKind } from "@/lib/fightinfo";
import type { PastFight } from "@/lib/types";

const ICON: Record<MethodKind, typeof Zap> = { KO: Zap, SUB: Lock, DEC: ClipboardList, DQ: Flag, DRAW: Equal, NC: CircleSlash, OTHER: ClipboardList };

/** "W · KO" style result + method chip, bold and colour-coded. */
export function ResultBadge({ row, compact = false }: { row: Pick<PastFight, "result" | "method">; compact?: boolean }) {
  const m = classifyMethod(row.method, row.result);
  const Icon = ICON[m.kind];
  const res = row.result === "W" ? "win" : row.result === "L" ? "loss" : "even";
  return (
    <span className={`jp-rb ${res} k-${m.kind.toLowerCase()} ${compact ? "compact" : ""}`} title={`${row.result} · ${row.method}`}>
      <b className="jp-rb-res">{row.result}</b>
      <span className="jp-rb-m">
        <Icon size={compact ? 11 : 13} strokeWidth={2.4} aria-hidden="true" />
        {/* UFCStats doesn't split KO from TKO ("KO/TKO (Punches)"): say so instead of guessing. */}
        {m.kind === "KO" && /^ko\/tko\b/i.test(row.method.trim()) && !/doctor|corner|retire|injury/i.test(row.method) ? (compact ? "KO" : "KO/TKO") : m.label}
      </span>
    </span>
  );
}

export function methodDetail(row: Pick<PastFight, "method" | "result">) {
  const m = classifyMethod(row.method, row.result);
  return m.detail;
}
