"use client";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useRosterThumbs, type Roster } from "@/lib/roster";
import { SEED_FIGHTERS } from "@/lib/data";
import { MM_DIVISIONS, divisionByName, initials, searchCandidates, thumbFor, type Candidate } from "@/lib/matchmaker";

const PAGE = 60;

/** Last five results, newest first, from the roster (or the seed profile for fighters the roster doesn't have). */
function lastFive(c: Candidate, roster: Roster | null): string[] {
  const r = c.slug ? roster?.bySlug.get(c.slug) : undefined;
  if (r) return r.history.slice(0, 5).map((h) => h.result);
  const f = c.seedId ? SEED_FIGHTERS[c.seedId] : undefined;
  return f ? f.history.filter((h) => (h.rules ?? "MMA") === "MMA").sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map((h) => h.result) : [];
}

export function RankBadge({ c, compact = false }: { c: Pick<Candidate, "rank">; compact?: boolean }) {
  const chip = c.rank.chip, p4p = c.rank.p4p;
  return (
    <>
      {chip && <span className={"mm-rank " + chip.kind}>{chip.kind === "ranked" ? chip.label : compact ? "C" : chip.label}</span>}
      {p4p && !compact && <span className="mm-rank p4p">P4P #{p4p.rank}</span>}
    </>
  );
}

/** Results passed newest first; drawn oldest → newest (left to right), like the Recent form timeline. */
export function FormDots({ results, size = "sm" }: { results: string[]; size?: "sm" | "md" }) {
  if (!results.length) return null;
  return (
    <span className={"mm-dots " + size} aria-label={`Last ${results.length}, oldest to newest: ${[...results].reverse().join(" ")}`} title="Last results, oldest → newest">
      {[...results].reverse().map((r, i) => (
        <i key={i} className={r.toLowerCase()} aria-hidden="true">
          {size === "md" ? r : ""}
        </i>
      ))}
    </span>
  );
}

export function FighterPicker({
  open,
  corner,
  list,
  roster,
  other,
  currentKey,
  onClose,
  onPick,
}: {
  open: boolean;
  corner: "a" | "b";
  list: Candidate[];
  roster: Roster | null;
  other: Candidate | null;
  currentKey: string | null;
  onClose: () => void;
  onPick: (key: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const listRef = useRef<HTMLDivElement>(null);
  const thumbs = useRosterThumbs(open);
  // Mixed bouts aren't a thing: once one corner is set, the other lists the same side of the sport only.
  const women = other ? other.women : null;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setLimit(PAGE);
    // The other corner's division is the default filter (90% of matchups stay in-division).
    setDivision(other ? other.division : null);
  }, [open, other]);

  const results = useMemo(() => searchCandidates(list, query, { division, women }), [list, query, division, women]);
  const shown = results.slice(0, limit);
  useEffect(() => {
    setActive(0);
    setLimit(PAGE);
  }, [query, division]);

  const divs = MM_DIVISIONS.filter((d) => women === null || d.women === women);
  const pick = (c: Candidate | undefined) => {
    if (!c || c.key === other?.key) return;
    onPick(c.key);
  };
  function keys(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = Math.max(0, Math.min(shown.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
      setActive(n);
      listRef.current?.querySelector<HTMLElement>(`[data-i="${n}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(shown[active]);
    }
  }
  const sideName = corner === "a" ? "Red corner" : "Blue corner";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="mm-picker" data-side={corner} showCloseButton={false} onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="mm-picker-head">
          <div>
            <span className={"mm-corner-tag " + corner}>{sideName}</span>
            <DialogTitle className="mm-picker-title">Choose a fighter</DialogTitle>
            <DialogDescription className="mm-picker-sub">
              {list.length.toLocaleString()} UFC fighters · roster since 2021 plus signed debutants
            </DialogDescription>
          </div>
          <button type="button" className="mm-icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <label className="mm-search">
          <Search size={17} aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={keys}
            placeholder="Search by name or nickname"
            aria-label="Search fighters"
            aria-controls="mm-picker-list"
            aria-activedescendant={shown[active] ? `mm-opt-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </label>
        <div className="mm-divs" role="group" aria-label="Filter by division">
          <button type="button" aria-pressed={division === null} className={division === null ? "on" : ""} onClick={() => setDivision(null)}>
            All divisions
          </button>
          {divs.map((d) => (
            <button type="button" key={d.code} aria-pressed={division === d.name} className={division === d.name ? "on" : ""} onClick={() => setDivision(d.name)} title={d.name}>
              {d.short}
            </button>
          ))}
        </div>
        {other && division && division !== other.division && <p className="mm-picker-note">Cross-division: {other.name} is a {other.division.toLowerCase()}.</p>}
        {other && division === other.division && (
          <p className="mm-picker-note">
            Showing {other.name.split(" ").slice(-1)[0]}'s division · <button type="button" onClick={() => setDivision(null)}>All divisions</button> for a superfight
          </p>
        )}
        <div className="mm-picker-list" id="mm-picker-list" role="listbox" aria-label="Fighters" ref={listRef}>
          {shown.map((c, i) => {
            const src = thumbFor(c, thumbs);
            const taken = c.key === other?.key;
            const form = lastFive(c, roster);
            return (
              <button
                type="button"
                role="option"
                id={`mm-opt-${i}`}
                data-i={i}
                key={c.key}
                aria-selected={i === active}
                aria-disabled={taken || undefined}
                className={"mm-opt" + (i === active ? " active" : "") + (c.key === currentKey ? " current" : "") + (taken ? " taken" : "")}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(c)}
              >
                <span className="mm-opt-img">{src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <b>{initials(c.name)}</b>}</span>
                <span className="mm-opt-main">
                  <strong>
                    {c.name}
                    <RankBadge c={c} compact />
                  </strong>
                  <small>
                    {divisionByName(c.division)?.short ?? c.division} · {c.recordKind === "UFC" ? (c.record === "0-0-0" ? "UFC debut" : `UFC ${c.record}`) : `${c.record} pro · UFC debut pending`}
                    {c.nickname ? ` · “${c.nickname}”` : ""}
                    {c.lastYear && c.lastYear < 2025 ? ` · last fought ${c.lastYear}` : ""}
                  </small>
                </span>
                <span className="mm-opt-side">
                  {taken ? <em>Other corner</em> : <FormDots results={form} />}
                </span>
              </button>
            );
          })}
          {!shown.length && <p className="mm-picker-empty">No UFC fighter matches “{query}”{division ? ` in ${division}` : ""}.{division && <button type="button" onClick={() => setDivision(null)}>Search all divisions</button>}</p>}
          {results.length > shown.length && (
            <button type="button" className="mm-more" onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({results.length - shown.length} left)
            </button>
          )}
        </div>
        <p className="mm-picker-foot">↑ ↓ to move · Enter to pick · ranked fighters first, then the most recently active</p>
      </DialogContent>
    </Dialog>
  );
}
