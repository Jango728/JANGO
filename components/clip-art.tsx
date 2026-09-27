"use client";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { ArrowUpRight, Play } from "lucide-react";
import {
  TAG_SHORT,
  clipLabel,
  clipLanguage,
  clipEmbedUrl,
  clipEventLine,
  clipInitials,
  clipIsVertical,
  clipMethodShort,
  clipPortrait,
  clipResultWord,
  clipRosterSlug,
  clipSurname,
  clipTone,
  clipWatchUrl,
  clipMatchup,
  detectClipMode,
  isReel,
  normalizeClipName,
  type Clip,
  type ClipMode,
} from "@/lib/clips";
import { rosterPhoto } from "@/lib/roster";
import "@/src/clips.css";

/* ---------- clip mode: embed where YouTube frames work, links everywhere else ---------- */

let mode: ClipMode | null = null;
const subs = new Set<() => void>();

function getMode(): ClipMode {
  if (mode === null) {
    mode = detectClipMode();
    if (mode === "embed" && typeof document !== "undefined") {
      // If the host's CSP blocks YouTube after all, drop to link cards for the whole session.
      document.addEventListener("securitypolicyviolation", (e) => {
        if (/youtube|ytimg/i.test(e.blockedURI || "")) demoteClipMode();
      });
    }
  }
  return mode;
}

/** Switch every clip surface to link cards (an embed failed to load). */
export function demoteClipMode() {
  if (mode === "link") return;
  mode = "link";
  subs.forEach((f) => f());
}

function subscribe(f: () => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

export function useClipMode(): ClipMode {
  return useSyncExternalStore(subscribe, getMode, () => "link" as ClipMode);
}

/* ---------- fighter photos: bundled portrait, else lazily loaded roster photo ---------- */

export type FighterPhoto = { src: string; headshot: boolean };

const photoCache = new Map<string, FighterPhoto | null>();
const photoPending = new Map<string, Promise<FighterPhoto | null>>();

// At most two roster photo lookups in flight; each may pull one ~0.5-1 MB chunk file.
const MAX_LOADS = 2;
let activeLoads = 0;
const loadQueue: (() => void)[] = [];
function limited<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeLoads++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeLoads--;
          loadQueue.shift()?.();
        });
    };
    if (activeLoads < MAX_LOADS) run();
    else loadQueue.push(run);
  });
}

/** Synchronous answer when we have one: a bundled portrait, a cached photo, or null for "none". */
function photoNow(name: string): FighterPhoto | null | undefined {
  const key = normalizeClipName(name);
  if (!key) return null;
  if (photoCache.has(key)) return photoCache.get(key);
  const own = clipPortrait(name);
  if (own) {
    const p = { src: own, headshot: false };
    photoCache.set(key, p);
    return p;
  }
  if (!clipRosterSlug(name)) {
    photoCache.set(key, null);
    return null;
  }
  return undefined; // roster photo possible, not loaded yet
}

function loadPhoto(name: string): Promise<FighterPhoto | null> {
  const key = normalizeClipName(name);
  const now = photoNow(name);
  if (now !== undefined) return Promise.resolve(now);
  let p = photoPending.get(key);
  if (!p) {
    const slug = clipRosterSlug(name)!;
    p = limited(() => rosterPhoto(slug))
      .then((r) => (r ? { src: r.src, headshot: r.kind === "headshot" } : null))
      .catch(() => null)
      .then((r) => {
        photoCache.set(key, r);
        photoPending.delete(key);
        return r;
      });
    photoPending.set(key, p);
  }
  return p;
}

/** A fighter's photo. `undefined` while it may still arrive, `null` when we have none. */
export function useFighterPhoto(name: string, enabled: boolean): FighterPhoto | null | undefined {
  const [photo, setPhoto] = useState<FighterPhoto | null | undefined>(() => photoNow(name));
  useEffect(() => {
    const now = photoNow(name);
    setPhoto(now);
    if (now !== undefined || !enabled) return;
    let live = true;
    loadPhoto(name).then((p) => live && setPhoto(p));
    return () => {
      live = false;
    };
  }, [name, enabled]);
  return photo;
}

/* ---------- "is this card near the viewport?" (one shared observer) ---------- */

const nearCallbacks = new WeakMap<Element, () => void>();
let observer: IntersectionObserver | null = null;
function getObserver(): IntersectionObserver | null {
  if (typeof window === "undefined" || !("IntersectionObserver" in window)) return null;
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          nearCallbacks.get(e.target)?.();
          nearCallbacks.delete(e.target);
          observer?.unobserve(e.target);
        }
      },
      { rootMargin: "240px 120px" },
    );
  }
  return observer;
}

/** True once the element has come within ~a screen of the viewport (stays true). */
export function useNearViewport(ref: RefObject<Element | null>, skip = false): boolean {
  const [near, setNear] = useState(skip);
  useEffect(() => {
    if (near || skip) return;
    const el = ref.current;
    const io = getObserver();
    if (!el || !io) {
      setNear(true);
      return;
    }
    nearCallbacks.set(el, () => setNear(true));
    io.observe(el);
    return () => {
      nearCallbacks.delete(el);
      io.unobserve(el);
    };
  }, [near, skip, ref]);
  return near || skip;
}

/* ---------- artwork ---------- */

export type ArtSize = "hero" | "card" | "mini";

function Figure({ name, side, enabled, win, lose }: { name: string; side: "l" | "r" | "solo"; enabled: boolean; win?: boolean; lose?: boolean }) {
  const photo = useFighterPhoto(name, enabled);
  // Shape is measured on load and tied to the src it was measured for (no reset race).
  const [measured, setMeasured] = useState<{ src: string; shape: "cut" | "head" } | null>(null);
  const shape = photo && measured?.src === photo.src ? measured.shape : null;
  const ready = shape !== null;
  return (
    <span className="jp-ca-fig" data-side={side} data-win={win ? "1" : undefined} data-lose={lose ? "1" : undefined} data-ready={ready ? "1" : "0"}>
      <span className="jp-ca-mono" aria-hidden>
        <b>{clipInitials(name)}</b>
        <small>{clipSurname(name)}</small>
      </span>
      {photo && (
        <img
          key={photo.src}
          src={photo.src}
          alt=""
          decoding="async"
          loading={side === "solo" ? "eager" : "lazy"}
          data-shape={shape ?? undefined}
          onLoad={(e) => {
            const im = e.currentTarget;
            setMeasured({ src: photo.src, shape: photo.headshot || im.naturalWidth / Math.max(1, im.naturalHeight) > 0.9 ? "head" : "cut" });
          }}
        />
      )}
    </span>
  );
}

/**
 * A designed video thumbnail that needs no external images: both fighters facing off over a dark
 * arena gradient (one large fighter for highlight reels), the format label, event and a VS/result
 * badge. Fighters without a photo get a monogram plate of the same size, so the layout never shifts.
 */
export function ClipArt({ clip, size = "card", eager = false }: { clip: Clip; size?: ArtSize; eager?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const near = useNearViewport(ref, eager);
  const reel = isReel(clip);
  const [a, b] = clip.fighters;
  const word = clipResultWord(clip);
  const spoilerFree = clip.format === "full-fight";
  const winA = !spoilerFree && !!clip.winner && normalizeClipName(clip.winner) === normalizeClipName(a);
  const winB = !spoilerFree && !!clip.winner && !!b && normalizeClipName(clip.winner) === normalizeClipName(b);
  // "UFC Fight Night: Rosas Jr. vs. Barcelos" -> "UFC Fight Night" on the artwork (names are already there).
  const ev = clipEventLine({ ...clip, event: clip.event.split(":")[0].trim() });
  return (
    <span ref={ref} className="jp-ca" data-format={clipTone(clip)} data-size={size} data-kind={reel ? "solo" : "duo"} aria-hidden>
      <span className="jp-ca-bg" />
      <span className="jp-ca-fence" />
      {reel ? (
        <>
          <Figure name={a} side="solo" enabled={near} />
          <span className="jp-ca-solo">
            <small>{a.split(/\s+/).length > 1 ? a.slice(0, a.length - clipSurname(a).length).trim() : ""}</small>
            <b style={{ fontSize: `clamp(13px, ${Math.min(11.5, 62 / Math.max(1, clipSurname(a).length)).toFixed(2)}cqw, 104px)` }}>{clipSurname(a)}</b>
            <em>{clip.method && !/reel|compilation/i.test(clip.method) ? clip.method : clipLabel(clip)}</em>
          </span>
        </>
      ) : (
        <>
          <Figure name={a} side="l" enabled={near} win={winA} lose={winB} />
          <Figure name={b} side="r" enabled={near} win={winB} lose={winA} />
          <span className="jp-ca-badge" data-word={word}>
            {word}
          </span>
          <span className="jp-ca-names">
            <b data-win={winA ? "1" : undefined} data-lose={winB ? "1" : undefined}>{clipSurname(a)}</b>
            <b data-win={winB ? "1" : undefined} data-lose={winA ? "1" : undefined}>{clipSurname(b)}</b>
          </span>
        </>
      )}
      <span className="jp-ca-shade" />
      <span className="jp-ca-label">{clipLabel(clip)}</span>
      {ev && size !== "mini" && <span className="jp-ca-event">{ev}</span>}
    </span>
  );
}

/* ---------- card ---------- */

export type CardState = { selected?: boolean; playing?: boolean; opened?: boolean };

function cardMeta(c: Clip): string {
  const parts = [clipEventLine(c)];
  if (isReel(c)) parts.push(c.division ?? "");
  else if (c.format === "full-fight") parts.push(c.division ?? "");
  else parts.push(clipMethodShort(c));
  return parts.filter(Boolean).join(" · ");
}

function Tags({ clip, max = 3 }: { clip: Clip; max?: number }) {
  const tags = clip.tags.slice(0, max);
  const lang = clipLanguage(clip);
  if (!tags.length && !lang) return null;
  return (
    <span className="jp-cc-tags">
      {tags.map((t) => (
        <i key={t} data-tag={t}>
          {TAG_SHORT[t]}
        </i>
      ))}
      {lang && <i data-tag="lang" title={`Official ${clip.channel} upload`}>{lang.replace(" commentary", "")}</i>}
    </span>
  );
}

/**
 * One clip card. Link mode renders a real <a target="_blank"> to YouTube (the only thing that works
 * under the artifact CSP) and reports the click so the page can feature it; embed mode renders a
 * button that plays the clip in the page's player.
 */
export function ClipCard({
  clip,
  mode,
  state = {},
  onPick,
  eager,
}: {
  clip: Clip;
  mode: ClipMode;
  state?: CardState;
  onPick: (c: Clip) => void;
  eager?: boolean;
}) {
  const title = clipMatchup(clip);
  const inner: ReactNode = (
    <>
      <span className="jp-cc-thumb">
        <ClipArt clip={clip} size="card" eager={eager} />
        <span className="jp-cc-hover" aria-hidden>
          {mode === "link" ? (
            <span className="yt">
              <Play size={13} fill="currentColor" /> YouTube <ArrowUpRight size={14} strokeWidth={2.6} />
            </span>
          ) : (
            <span className="play">
              <Play size={20} fill="currentColor" />
            </span>
          )}
        </span>
        {state.playing && (
          <span className="jp-cc-state" aria-hidden>
            <span className="jp-eq">
              <i />
              <i />
              <i />
            </span>
            Playing
          </span>
        )}
        {!state.playing && state.opened && (
          <span className="jp-cc-state" aria-hidden>
            Opened <ArrowUpRight size={11} strokeWidth={2.8} />
          </span>
        )}
      </span>
      <span className="jp-cc-body">
        <b className="jp-cc-title">{title}</b>
        <span className="jp-cc-meta">{cardMeta(clip) || clip.channel}</span>
        <span className="jp-cc-foot">
          <Tags clip={clip} />
          {mode === "link" && (
            <span className="jp-cc-yt" aria-hidden>
              Watch on YouTube <ArrowUpRight size={11} strokeWidth={2.8} />
            </span>
          )}
        </span>
      </span>
    </>
  );
  const cls = `jp-cc${state.selected ? " on" : ""}`;
  if (mode === "link") {
    return (
      <a
        className={cls}
        href={clipWatchUrl(clip)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onPick(clip)}
        aria-label={`${clipLabel(clip)}: ${title}${clipEventLine(clip) ? `, ${clipEventLine(clip)}` : ""}. Opens on YouTube in a new tab`}
      >
        {inner}
      </a>
    );
  }
  return (
    <button type="button" className={cls} onClick={() => onPick(clip)} aria-current={state.selected ? "true" : undefined} aria-label={`Play ${clipLabel(clip).toLowerCase()}: ${title}`}>
      {inner}
    </button>
  );
}

/** Watches an embedded player; if it hasn't loaded after `ms`, reports failure. */
export function useEmbedWatchdog(active: boolean, key: string, ms = 10000) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [key]);
  useEffect(() => {
    if (!active || loaded) return;
    const t = window.setTimeout(() => setFailed(true), ms);
    return () => window.clearTimeout(t);
  }, [active, loaded, key, ms]);
  return { failed, onLoad: () => setLoaded(true) };
}

/* ---------- stage: the 16:9 player area shared by the Clips page and clip strips ---------- */

/**
 * Link mode: the whole poster is a real link to YouTube with a clear "opens in a new tab" CTA.
 * Embed mode: poster with a play button, then the YouTube iframe; if the player hasn't loaded after
 * 10s (or the host blocks it) it falls back to the link poster.
 */
export function ClipStage({
  clip,
  mode,
  playing,
  onPlay,
  onOpen,
  size = "hero",
}: {
  clip: Clip;
  mode: ClipMode;
  playing: boolean;
  onPlay: () => void;
  onOpen?: () => void;
  size?: "hero" | "compact";
}) {
  const watchdog = useEmbedWatchdog(mode === "embed" && playing, clip.id);
  const vertical = clipIsVertical(clip);
  const linkPoster = (note?: string) => (
    <a
      className="jp-stage-poster is-link"
      href={clipWatchUrl(clip)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onOpen}
      aria-label={`Watch ${clipMatchup(clip)} on YouTube (opens in a new tab)`}
    >
      <ClipArt clip={clip} size="hero" eager />
      <span className="jp-stage-cta" aria-hidden>
        <span className="btn">
          <Play size={size === "hero" ? 17 : 14} fill="currentColor" />
          <span>Watch on YouTube</span>
          <ArrowUpRight size={size === "hero" ? 17 : 14} strokeWidth={2.6} />
        </span>
        <small>{note ?? `Official ${clip.channel} upload · opens in a new tab`}</small>
      </span>
    </a>
  );
  return (
    <div className="jp-stage" data-format={clipTone(clip)} data-size={size}>
      {mode === "link" ? (
        linkPoster()
      ) : playing && watchdog.failed ? (
        linkPoster("The player didn't load here · watch it on YouTube instead")
      ) : playing ? (
        <div className="jp-stage-player" data-vertical={vertical ? "1" : undefined}>
          {vertical && (
            <span className="jp-stage-backdrop" aria-hidden>
              <ClipArt clip={clip} size="hero" eager />
            </span>
          )}
          <iframe
            key={clip.id}
            src={clipEmbedUrl(clip)}
            title={clip.title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={watchdog.onLoad}
          />
        </div>
      ) : (
        <button type="button" className="jp-stage-poster" onClick={onPlay} aria-label={`Play ${clipMatchup(clip)}`}>
          <ClipArt clip={clip} size="hero" eager />
          <span className="jp-stage-play" aria-hidden>
            <Play size={size === "hero" ? 30 : 22} fill="currentColor" />
          </span>
        </button>
      )}
    </div>
  );
}
