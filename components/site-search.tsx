"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Crown, Search, User } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DIRECTORY, EVENTS, encodeRef, normName, probableRosterSlug } from "@/lib/directory";
import { NAME_BY_SLUG, ROSTER_NAMES, slugsForName, useRosterThumbs } from "@/lib/roster";
import { ledgerFor } from "@/lib/ledger";
import { PromotionLogo } from "./promotion-logo";
import { useSiteNav } from "./site-nav";

type Hit =
  | { kind: "fighter"; key: string; name: string; sub: string; img?: string; slug?: string; champ?: boolean; target: string; score: number }
  | { kind: "event"; key: string; name: string; sub: string; promotion: string; eventId: string; status: string; score: number };

function score(hay: string, q: string) {
  const h = normName(hay), n = normName(q);
  if (!n) return 0;
  const words = hay.toLowerCase().split(/\s+/).map(normName);
  if (words.includes(n) || h === n) return 3.2; // exact name or surname beats a longer name that merely starts with it
  if (h.startsWith(n)) return 3;
  if (hay.toLowerCase().split(/\s+/).some((w) => normName(w).startsWith(n))) return 2;
  return h.includes(n) ? 1 : 0;
}

export function SiteSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const nav = useSiteNav();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);

  const hits = useMemo<Hit[]>(() => {
    const status = (id: string, date: string) => (ledgerFor(id)?.results ? "Results in" : date < today ? "Results due" : date === today ? "Tonight" : "Upcoming");
    if (!q.trim()) {
      // Empty query: show the cards (upcoming first) so search doubles as a quick card picker.
      const up = EVENTS.filter((e) => e.date >= today), past = EVENTS.filter((e) => e.date < today).reverse();
      return [...up, ...past].slice(0, 8).map((e) => ({ kind: "event", key: e.id, name: e.title, sub: `${e.date} · ${e.fights.length} bouts`, promotion: e.promotion, eventId: e.id, status: status(e.id, e.date), score: 1 }));
    }
    const year = new Date().getFullYear();
    const recency = (y?: number) => (!y ? 0 : y >= year ? 0.35 : y === year - 1 ? 0.25 : y === year - 2 ? 0.15 : y === year - 3 ? 0.05 : 0);
    const covered = new Set<string>();
    const fighters: Hit[] = [];
    // Seed profiles and ranked names first (their roster twin is folded in), then the rest of the UFC roster.
    for (const d of DIRECTORY) {
      const r = d.ranks[0];
      const slug = d.fighter ? probableRosterSlug(d.fighter) : slugsForName(d.name).length === 1 ? slugsForName(d.name)[0] : undefined;
      if (slug) covered.add(slug);
      const s = score(d.name, q);
      if (s < 1) continue;
      const row = slug ? NAME_BY_SLUG.get(slug) : undefined;
      const rankText = r ? (r.role === "champion" ? `${r.division.name} champion` : r.role === "contender" ? `#${r.rank} ${r.division.name}` : `Threat radar · ${r.division.short}`) : null;
      const boost = Math.max(d.fighter ? 0.6 : 0, r ? (r.role === "champion" ? 0.8 : r.role === "contender" ? 0.5 : 0.4) : 0, d.p4p ? 0.5 : 0);
      const sub = d.fighter
        ? [rankText ?? row?.[3], row ? `UFC ${row[5]}` : d.fighter.record, d.fighter.country].filter(Boolean).join(" · ")
        : [rankText, row ? `UFC ${row[5]}` : r?.role === "champion" ? r.division.champion.record : null].filter(Boolean).join(" · ") || "UFC rankings";
      fighters.push({
        kind: "fighter",
        key: d.key,
        name: d.name,
        sub,
        img: d.fighter?.image ?? (r?.role === "champion" ? r.division.champion.img : undefined),
        slug,
        champ: r?.role === "champion",
        target: d.fighter?.id ?? (slug ? encodeRef({ name: d.name, slug }) : d.name),
        score: s + boost + recency(row?.[4]),
      });
    }
    for (const [slug, name, nick, wc, y, rec] of ROSTER_NAMES) {
      if (covered.has(slug)) continue;
      const s = Math.max(score(name, q), nick ? score(nick, q) * 0.6 : 0);
      if (s < 1) continue;
      fighters.push({ kind: "fighter", key: "r:" + slug, name, sub: [wc, `UFC ${rec}`, y < year - 1 ? `last fought ${y}` : null].filter(Boolean).join(" · "), slug, target: encodeRef({ name, slug }), score: s + 0.3 + recency(y) });
    }
    const events: Hit[] = EVENTS.map((e) => {
      const s = Math.max(score(e.title, q), score(`${e.promotion} ${e.title}`, q), score(e.date, q), score(e.location, q) * 0.5);
      return { kind: "event" as const, key: e.id, name: e.title, sub: `${e.date} · ${e.location}`, promotion: e.promotion, eventId: e.id, status: status(e.id, e.date), score: s + 0.2 };
    }).filter((h) => h.score >= 1.2);
    return [...events, ...fighters].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 16);
  }, [q, today]);

  const thumbs = useRosterThumbs(open && hits.some((h) => h.kind === "fighter" && !h.img && h.slug));

  const choose = (h: Hit) => {
    onOpenChange(false);
    if (h.kind === "fighter") setTimeout(() => nav.openFighter(h.target), 60);
    else nav.goFight(h.eventId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="jp-search-dialog">
        <DialogTitle className="sr-only">Search Jango Playz</DialogTitle>
        <DialogDescription className="sr-only">Find a fighter or a card</DialogDescription>
        <div className="jp-search-box">
          <Search size={18} />
          <input
            ref={input}
            value={q}
            placeholder="Search any UFC fighter or card…  (e.g. Holloway, UFC 333)"
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, hits.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter" && hits[sel]) choose(hits[sel]);
            }}
            aria-label="Search fighters or cards"
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="jp-search-list" role="listbox">
          {!q.trim() && <li className="jp-search-head">Cards</li>}
          {hits.map((h, i) => (
            <li key={h.kind + h.key} role="option" aria-selected={i === sel}>
              <button className={i === sel ? "on" : ""} onMouseEnter={() => setSel(i)} onClick={() => choose(h)}>
                {h.kind === "fighter" ? (
                  <span className={"ico" + (h.img || (h.slug && thumbs?.[h.slug]) ? "" : " mono")}>
                    {h.img ? (
                      <img src={h.img} alt="" loading="lazy" />
                    ) : h.slug && thumbs?.[h.slug] ? (
                      <img className="head" src={thumbs[h.slug]} alt="" />
                    ) : h.slug ? (
                      h.name
                        .split(/\s+/)
                        .map((w) => w[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()
                    ) : (
                      <User size={16} />
                    )}
                  </span>
                ) : (
                  <span className="ico ev">
                    <PromotionLogo promotion={h.promotion} />
                  </span>
                )}
                <span className="txt">
                  <b>{h.name}</b>
                  <small>{h.sub}</small>
                </span>
                {h.kind === "event" ? (
                  <em className={"st " + (h.status === "Results in" ? "done" : h.status === "Upcoming" || h.status === "Tonight" ? "up" : "wait")}>
                    <CalendarDays size={12} /> {h.status}
                  </em>
                ) : h.champ ? (
                  <em className="st champ">
                    <Crown size={12} /> Champ
                  </em>
                ) : (
                  <em className="st">Fighter</em>
                )}
              </button>
            </li>
          ))}
          {q.trim() && !hits.length && <li className="jp-search-empty">No fighter or card matches “{q}”.</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
