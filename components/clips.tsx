"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Eye, LayoutGrid, Search, X } from "lucide-react";
import { FighterName } from "./site-nav";
import {
  CLIPS,
  TAG_LABEL,
  clipEventLine,
  clipLabel,
  clipMatchup,
  clipSearchText,
  clipTime,
  clipTone,
  clipWatchUrl,
  isKnockout,
  isReel,
  isSubmission,
  normalizeClipName,
  type Clip,
  type ClipFormat,
} from "@/lib/clips";
import { SEED_EVENTS, SEED_FIGHTERS } from "@/lib/data";
import { DIVISIONS } from "@/lib/rankings";
import { ClipArt, ClipCard, ClipStage, useClipMode } from "./clip-art";
import "@/src/clips.css";

/* ---------- library shelves ---------- */

type Filter = "all" | "full-fight" | "ko" | "sub" | "finish-clip" | "highlights";

/**
 * Knockouts / Submissions are result-based rows, not formats: they collect the matching clips,
 * knockout- or submission-focused reels, and full fights whose official result was a KO/TKO or a
 * submission. Highlights still lists every reel. `tone` picks the colour dot.
 */
const FILTERS: { id: Filter; label: string; tone: ClipFormat | "all" }[] = [
  { id: "all", label: "All", tone: "all" },
  { id: "full-fight", label: "Full fights", tone: "full-fight" },
  { id: "ko", label: "Knockouts", tone: "ko-clip" },
  { id: "sub", label: "Submissions", tone: "sub-clip" },
  { id: "finish-clip", label: "Finishes", tone: "finish-clip" },
  { id: "highlights", label: "Highlights", tone: "highlights" },
];

/** Knockout and submission rows lead with the clips and reels, then the full fights. */
const clipsFirst = (a: Clip, b: Clip) => Number(a.format === "full-fight") - Number(b.format === "full-fight");

function inFilter(f: Filter, c: Clip): boolean {
  switch (f) {
    case "all":
      return true;
    case "ko":
      return isKnockout(c);
    case "sub":
      return isSubmission(c);
    default:
      return c.format === f;
  }
}

const PAGE = 24;
const ROW_CAP = 18;
const DAY = 86400000;

const byNewest = (a: Clip, b: Clip) => clipTime(b) - clipTime(a);
const LIBRARY = [...CLIPS].sort(byNewest);
const HAS_FINISH = LIBRARY.some((c) => c.format === "finish-clip");

const fighterKey = (n: string) => normalizeClipName(n).split(" ").sort().join(" ");

/** Fighters on UFC / DWCS cards from two days ago through the next week. */
function weekFighters(): Set<string> {
  const now = Date.now();
  const out = new Set<string>();
  for (const e of SEED_EVENTS) {
    if (e.promotion !== "UFC" && e.promotion !== "DWCS") continue;
    const t = Date.parse(e.date + "T12:00:00Z");
    if (!(t >= now - 2 * DAY && t <= now + 8 * DAY)) continue;
    for (const f of e.fights) {
      for (const id of [f.a, f.b]) {
        const name = SEED_FIGHTERS[id]?.name;
        if (name) out.add(fighterKey(name));
      }
    }
  }
  return out;
}

const CHAMPS = new Set(DIVISIONS.map((d) => (d.champion as { name?: string } | undefined)?.name).filter((n): n is string => !!n).map(fighterKey));

type Shelf = { id: string; title: string; note?: string; clips: Clip[]; filter?: Filter };

function buildShelves(): Shelf[] {
  const week = weekFighters();
  const has = (set: Set<string>) => (c: Clip) => c.fighters.some((f) => set.has(fighterKey(f)));
  const fmt = (f: ClipFormat) => LIBRARY.filter((c) => c.format === f);
  const tag = (t: Clip["tags"][number]) => LIBRARY.filter((c) => c.tags.includes(t));
  const shelves: Shelf[] = [
    { id: "week", title: "Fighters on this week's cards", note: "Scout the names you're about to pick", clips: LIBRARY.filter(has(week)) },
    { id: "full", title: "Full fights", clips: fmt("full-fight"), filter: "full-fight" },
    { id: "ko", title: "Knockouts", note: "Knockout clips, KO reels and fights that ended by KO/TKO", clips: LIBRARY.filter(isKnockout).sort(clipsFirst), filter: "ko" },
    { id: "sub", title: "Submissions", note: "Submission clips, reels and fights that ended by tapout", clips: LIBRARY.filter(isSubmission).sort(clipsFirst), filter: "sub" },
    { id: "finish", title: "Finish clips", clips: fmt("finish-clip"), filter: "finish-clip" },
    { id: "title", title: "Title fights", clips: tag("title-fight") },
    { id: "champs", title: "Current champions", clips: LIBRARY.filter(has(CHAMPS)) },
    { id: "upset", title: "Upsets", clips: tag("upset") },
    { id: "hl", title: "Highlights & career reels", clips: fmt("highlights"), filter: "highlights" },
    { id: "women", title: "Women's MMA", clips: tag("women") },
    { id: "classic", title: "Classics", clips: tag("classic") },
  ];
  return shelves.filter((s) => s.clips.length >= (s.filter || s.id === "week" ? 1 : 2));
}

function pickFeatured(shelves: Shelf[]): Clip | undefined {
  return (
    shelves.find((s) => s.id === "week")?.clips.find((c) => !isReel(c)) ??
    LIBRARY.find((c) => c.tags.includes("title-fight") && c.tags.includes("recent")) ??
    LIBRARY.find((c) => c.tags.includes("title-fight")) ??
    LIBRARY[0]
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/* ---------- a horizontally scrolling shelf ---------- */

function Row({ shelf, children, onSeeAll }: { shelf: Shelf; children: ReactNode; onSeeAll?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  }, []);
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update]);
  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };
  const id = `jp-shelf-${shelf.id}`;
  return (
    <section className="jp-shelf" aria-labelledby={id}>
      <header className="jp-shelf-head">
        <h2 id={id}>
          {shelf.title} <span className="n">{shelf.clips.length}</span>
        </h2>
        {shelf.note && <small>{shelf.note}</small>}
        {onSeeAll && shelf.clips.length > 3 && (
          <button type="button" className="jp-shelf-all" onClick={onSeeAll}>
            See all <ChevronRight size={14} aria-hidden />
          </button>
        )}
      </header>
      <div className="jp-shelf-wrap" data-start={edges.start ? "1" : undefined} data-end={edges.end ? "1" : undefined}>
        <button type="button" className="jp-shelf-arrow l" onClick={() => page(-1)} aria-label={`Scroll ${shelf.title} left`} tabIndex={-1}>
          <ChevronLeft size={22} aria-hidden />
        </button>
        <div className="jp-shelf-track" ref={ref} onScroll={update} role="list">
          {children}
        </div>
        <button type="button" className="jp-shelf-arrow r" onClick={() => page(1)} aria-label={`Scroll ${shelf.title} right`} tabIndex={-1}>
          <ChevronRight size={22} aria-hidden />
        </button>
      </div>
    </section>
  );
}

/* ---------- page ---------- */

export function ClipsPage() {
  const shelves = useMemo(buildShelves, []);
  const featured = useMemo(() => pickFeatured(shelves), [shelves]);
  const mode = useClipMode();
  const linkMode = mode === "link";

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [browseAll, setBrowseAll] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [currentId, setCurrentId] = useState<string | undefined>(featured?.id);
  const [playing, setPlaying] = useState(false);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [reveal, setReveal] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const current = LIBRARY.find((c) => c.id === currentId) ?? featured;

  useEffect(() => setReveal(false), [currentId]);

  const searched = useMemo(() => {
    const q = normalizeClipName(query);
    if (!q) return LIBRARY;
    const terms = q.split(" ");
    return LIBRARY.filter((c) => {
      const hay = clipSearchText(c);
      return terms.every((t) => hay.includes(t));
    });
  }, [query]);

  const counts = useMemo(() => {
    const out = {} as Record<Filter, number>;
    for (const f of FILTERS) out[f.id] = searched.reduce((n, c) => n + Number(inFilter(f.id, c)), 0);
    return out;
  }, [searched]);

  const results = useMemo(() => {
    if (filter === "all") return searched;
    const list = searched.filter((c) => inFilter(filter, c));
    return filter === "ko" || filter === "sub" ? list.sort(clipsFirst) : list;
  }, [searched, filter]);
  const gridView = filter !== "all" || !!query.trim() || browseAll;

  useEffect(() => setShown(PAGE), [filter, query, browseAll]);

  const scrollTo = useCallback((el: HTMLElement | null) => {
    el?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }, []);

  /** Card click: embed mode plays in the hero; link mode (the <a> opens YouTube) features it. */
  const pick = useCallback(
    (c: Clip) => {
      setCurrentId(c.id);
      if (linkMode) {
        setOpened((s) => new Set(s).add(c.id));
      } else {
        setPlaying(true);
        scrollTo(heroRef.current);
      }
    },
    [linkMode, scrollTo],
  );

  const choose = (f: Filter) => {
    setFilter(f);
    setBrowseAll(false);
    if (f !== "all") requestAnimationFrame(() => scrollTo(resultsRef.current));
  };

  const cardState = (c: Clip) => ({
    selected: c.id === current?.id,
    playing: !linkMode && playing && c.id === current?.id,
    opened: linkMode && opened.has(c.id),
  });

  if (!current) {
    return (
      <div className="jp-clips">
        <section className="jp-page-head">
          <span className="jp-eyebrow">Official clips</span>
          <h1>Clips</h1>
          <p>The clip library is being refreshed. Check back shortly.</p>
        </section>
      </div>
    );
  }

  // Up next: the next few items in the current list (or library).
  const queueSrc = gridView && results.some((c) => c.id === current.id) ? results : LIBRARY;
  const qi = Math.max(0, queueSrc.findIndex((c) => c.id === current.id));
  const upNext = Array.from({ length: Math.min(3, queueSrc.length - 1) }, (_, i) => queueSrc[(qi + 1 + i) % queueSrc.length]);

  const spoilerGuard = current.format === "full-fight" && !!current.method;
  const reel = isReel(current);
  const [a, b] = current.fighters;

  return (
    <div className="jp-clips" data-mode={mode}>
      <section className="jp-page-head jp-clips-head">
        <span className="jp-eyebrow">Official clips · {LIBRARY.length} videos</span>
        <h1>Clips</h1>
        <p>
          Full fights, knockouts, submissions and career reels from the official promotion channels.{" "}
          {linkMode ? "Every clip opens on YouTube in a new tab." : "Pick one and it plays right here."}
        </p>
      </section>

      {/* ---------- hero ---------- */}
      <div className="jp-hero" ref={heroRef}>
        <div className="jp-hero-stage">
          <ClipStage
            key={current.id}
            clip={current}
            mode={mode}
            playing={playing}
            onPlay={() => setPlaying(true)}
            onOpen={() => setOpened((s) => new Set(s).add(current.id))}
          />
        </div>
        <aside className="jp-hero-info">
          <div className="jp-hero-kicker">
            <span className="jp-fmt" data-format={clipTone(current)}>{clipLabel(current)}</span>
            {current.tags.map((t) => (
              <span key={t} className="jp-tag-chip" data-tag={t}>
                {TAG_LABEL[t]}
              </span>
            ))}
          </div>
          <h2 className="jp-hero-title" aria-live="polite">
            {reel ? (
              <b>
                <FighterName name={a} />
              </b>
            ) : (
              <>
                <b>
                  <FighterName name={a} />
                </b>{" "}
                <span className="vs">vs</span>{" "}
                <b>
                  <FighterName name={b} />
                </b>
              </>
            )}
          </h2>
          <div className="jp-hero-meta">
            {[clipEventLine(current), current.division].filter(Boolean).join(" · ")}
          </div>
          {current.method && !reel && (
            <div className="jp-hero-result">
              {spoilerGuard && !reel && !reveal ? (
                <button type="button" className="jp-hero-reveal" onClick={() => setReveal(true)}>
                  <Eye size={14} aria-hidden /> Show result
                </button>
              ) : (
                <>
                  <span className="k">Result</span>
                  <span>
                    {current.winner ? <b>{current.winner}</b> : null}
                    {current.winner ? " wins · " : ""}
                    {current.method}
                  </span>
                </>
              )}
            </div>
          )}
          {/* Blurbs usually name the winner, so they stay behind the same spoiler guard as the result. */}
          {current.blurb && (!spoilerGuard || reveal) && <p className="jp-hero-blurb">{current.blurb}</p>}
          <div className="jp-hero-actions">
            <a className="jp-hero-yt" href={clipWatchUrl(current)} target="_blank" rel="noopener noreferrer" onClick={() => setOpened((s) => new Set(s).add(current.id))}>
              {linkMode ? "Watch on YouTube" : "Open on YouTube"} <ExternalLink size={14} aria-hidden />
            </a>
            <span className="jp-hero-src">
              via {current.channel}
              {linkMode ? " · new tab" : ""}
            </span>
          </div>
          {upNext.length > 0 && (
            <div className="jp-hero-next">
              <div className="jp-hero-next-head">Up next</div>
              <ol>
                {upNext.map((c) => (
                  <li key={c.id}>
                    {linkMode ? (
                      <a href={clipWatchUrl(c)} target="_blank" rel="noopener noreferrer" onClick={() => pick(c)} aria-label={`${clipMatchup(c)} (opens on YouTube in a new tab)`}>
                        <NextItem c={c} link />
                      </a>
                    ) : (
                      <button type="button" onClick={() => pick(c)}>
                        <NextItem c={c} />
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>
      </div>

      {/* ---------- toolbar ---------- */}
      <div className="jp-clips-toolbar" ref={resultsRef}>
        <div className="jp-clips-tabs" role="group" aria-label="Filter by format">
          {FILTERS.filter((f) => f.id !== "finish-clip" || HAS_FINISH).map((f) => (
            <button key={f.id} type="button" className={filter === f.id ? "on" : ""} aria-pressed={filter === f.id} data-format={f.tone} onClick={() => choose(f.id)}>
              {f.label}
              <span className="n">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <label className="jp-clips-find">
          <Search size={15} aria-hidden />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search fighter or event" aria-label="Search clips by fighter or event" />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
              <X size={14} aria-hidden />
            </button>
          )}
        </label>
      </div>

      {/* ---------- shelves or grid ---------- */}
      {!gridView ? (
        <>
          {shelves.map((s) => (
            <Row key={s.id} shelf={s} onSeeAll={s.filter ? () => choose(s.filter!) : undefined}>
              {s.clips.slice(0, ROW_CAP).map((c) => (
                <div role="listitem" className="jp-shelf-item" key={c.id}>
                  <ClipCard clip={c} mode={mode} state={cardState(c)} onPick={pick} />
                </div>
              ))}
            </Row>
          ))}
          <div className="jp-clips-browse">
            <button
              type="button"
              onClick={() => {
                setBrowseAll(true);
                requestAnimationFrame(() => scrollTo(resultsRef.current));
              }}
            >
              <LayoutGrid size={16} aria-hidden /> Browse all {LIBRARY.length} clips
            </button>
          </div>
        </>
      ) : (
        <section className="jp-clips-results" aria-live="polite">
          <div className="jp-clips-results-head">
            <h2>
              {query.trim() ? <>Results for “{query.trim()}”</> : filter === "all" ? "All clips" : FILTERS.find((f) => f.id === filter)?.label}
              <span className="n">{results.length}</span>
            </h2>
            {(filter !== "all" || query || browseAll) && (
              <button
                type="button"
                className="jp-shelf-all"
                onClick={() => {
                  setFilter("all");
                  setQuery("");
                  setBrowseAll(false);
                }}
              >
                <ChevronLeft size={14} aria-hidden /> Back to shelves
              </button>
            )}
          </div>
          {results.length ? (
            <>
              <ul className="jp-clips-grid">
                {results.slice(0, shown).map((c) => (
                  <li key={c.id}>
                    <ClipCard clip={c} mode={mode} state={cardState(c)} onPick={pick} />
                  </li>
                ))}
              </ul>
              {shown < results.length && (
                <div className="jp-clips-browse">
                  <button type="button" onClick={() => setShown((n) => n + PAGE)}>
                    Show more · {results.length - shown} left
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="jp-clips-empty">
              <p>No clips match that search.</p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                Clear filters
              </button>
            </div>
          )}
        </section>
      )}

      <p className="jp-clips-foot">
        {linkMode ? (
          <>
            Clips open on the official promotion channels on YouTube, in a new tab. Jango Playz doesn't host or own any footage.
          </>
        ) : (
          "Clips are embedded from official promotion channels on YouTube. Jango Playz doesn't host or own any footage."
        )}
      </p>
    </div>
  );
}

function NextItem({ c, link }: { c: Clip; link?: boolean }) {
  return (
    <>
      <span className="thumb">
        <ClipArt clip={c} size="mini" />
      </span>
      <span className="txt">
        <small className="jp-fmt-text" data-format={clipTone(c)}>{clipLabel(c)}</small>
        <b>{clipMatchup(c)}</b>
        <small>
          {clipEventLine(c)}
          {link ? " · YouTube ↗" : ""}
        </small>
      </span>
    </>
  );
}

export default ClipsPage;
