/**
 * Small helpers for reading fight history rows: method classification and
 * promotion-specific records (UFC record on UFC cards, PFL record on PFL cards…).
 */
import type { Fighter, PastFight } from "./types";
import { pastBefore, resultRecord } from "./model";

export type MethodKind = "KO" | "SUB" | "DEC" | "DQ" | "DRAW" | "NC" | "OTHER";

/** Classify a free-text method ("TKO (Punches)", "Decision - Split", "Submission (Rear-Naked Choke)"…). */
export function classifyMethod(method = "", result?: PastFight["result"]): { kind: MethodKind; label: string; detail: string } {
  const m = method.trim();
  const inner = (m.match(/\(([^)]+)\)?/)?.[1] ?? m.split(/\s+-\s+/)[1] ?? "").trim();
  const tidy = (s: string) =>
    s
      .replace(/rear[\s-]naked/i, "Rear-Naked")
      .replace(/d.arce/i, "D'Arce")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/(^|[\s(/-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
  if (result === "NC" || /no contest|overturned/i.test(m)) return { kind: "NC", label: "NC", detail: tidy(inner) || "No contest" };
  if (/disqual|\bdq\b/i.test(m)) return { kind: "DQ", label: "DQ", detail: tidy(inner) || "Disqualification" };
  if (result === "D" || /draw/i.test(m)) return { kind: "DRAW", label: "DRAW", detail: tidy(inner) };
  if (/submission|tap/i.test(m)) return { kind: "SUB", label: "SUB", detail: tidy(inner) || "Submission" };
  if (/\b(k\.?o|t\.?k\.?o)\b|knockout|doctor|corner|retire|stoppage|punches|kick/i.test(m)) {
    const ko = /^ko\b|\bko\s*\(/i.test(m) && !/tko/i.test(m) ? "KO" : "TKO";
    return { kind: "KO", label: /doctor|corner|retire/i.test(m) ? "TKO" : ko, detail: tidy(inner) || (ko === "KO" ? "Knockout" : "Strikes") };
  }
  if (/decision|dec\b|points/i.test(m)) {
    const d = /split/i.test(m) ? "Split" : /majority/i.test(m) ? "Majority" : /unanimous/i.test(m) ? "Unanimous" : "";
    return { kind: "DEC", label: "DEC", detail: d ? `${d} decision` : "Decision" };
  }
  return { kind: "OTHER", label: m.split(/[\s(]/)[0]?.toUpperCase().slice(0, 5) || "—", detail: tidy(inner) || m };
}

const ALIASES: Record<string, string> = {
  oktagon: "OKTAGON",
  "oktagon mma": "OKTAGON",
  "professional fighters league": "PFL",
  pfl: "PFL",
  "bellator mma": "Bellator",
  "absolute championship akhmat": "ACA",
  aca: "ACA",
  "dana white's contender series": "DWCS",
  "contender series": "DWCS",
  dwcs: "DWCS",
  ufc: "UFC",
};
export function normalizePromotion(p = ""): string {
  const k = p.trim().toLowerCase();
  return ALIASES[k] ?? p.trim();
}

/** Record inside one promotion before a date, e.g. PFL 4-1. Null when there's no evidence of fights there. */
export function orgRecord(f: Fighter, date: string, promotion: string): string | null {
  const org = normalizePromotion(promotion);
  const rows = pastBefore(f, date, "MMA").filter((x) => normalizePromotion(x.promotion) === org);
  if (org === "UFC") {
    return f.historyComplete || f.ufcHistoryComplete ? resultRecord(rows) : null;
  }
  if (!rows.length && !f.historyComplete) return null;
  return resultRecord(rows);
}

/** Short method badge text for chips: "KO", "TKO", "SUB", "DEC", "DQ". */
export const methodBadge = (h: Pick<PastFight, "method" | "result">) => classifyMethod(h.method, h.result);
