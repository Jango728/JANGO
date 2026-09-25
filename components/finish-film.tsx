"use client";
import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { FinishMethod } from "@/lib/finish";

/**
 * Pre-rendered projected-finish film. Plays once when it scrolls into view,
 * then holds the last frame with a small Replay button. Name tags follow
 * the fighters using per-frame screen positions exported by the renderer.
 */
type Track = Record<string, { w: [number, number, number]; l: [number, number, number] }>;
const FPS = 24;
const FILE: Record<FinishMethod, string> = { ko: "ko", submission: "sub", decision: "dec" };
// All clips' name-tag tracks live in one file (films/tracks.json, keyed by clip name) to keep the artifact's file count down.
let allTracks: Promise<Record<string, Track> | null> | null = null;
function loadTrack(name: string) {
  allTracks ??= fetch("films/tracks.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return allTracks.then((a) => a?.[name] ?? null);
}

export function FinishFilm({ method, winner, opponent, winnerCorner, isPreview, female = false }: { method: FinishMethod; winner: string; opponent: string; winnerCorner: "red" | "blue"; isPreview: boolean; female?: boolean }) {
  const [useFemale, setUseFemale] = useState(female);
  const base = `films/${FILE[method]}-${winnerCorner}${useFemale ? "-f" : ""}`;
  const video = useRef<HTMLVideoElement>(null);
  const wTag = useRef<HTMLSpanElement>(null);
  const lTag = useRef<HTMLSpanElement>(null);
  const [ended, setEnded] = useState(false);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const track = useRef<Track | null>(null);
  const live = useRef(false);
  live.current = started || ended;

  useEffect(() => {
    let live = true;
    loadTrack(base.replace(/^films\//, "")).then((t) => live && (track.current = t));
    return () => {
      live = false;
    };
  }, [base]);

  // start when at least half visible (once), respect reduced motion
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setEnded(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !started) {
          v.play().then(() => setStarted(true)).catch(() => setEnded(true));
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [base, started]);

  // name tags follow the fighters
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = video.current, t = track.current;
      if (v && t) {
        const f = Math.min(Math.floor(v.currentTime * FPS), Object.keys(t).length - 1);
        const row = t[f];
        for (const [el, p] of [
          [wTag.current, row?.w],
          [lTag.current, row?.l],
        ] as const) {
          if (!el || !p) continue;
          const vis = live.current && p[2] === 1 && p[0] > 0.04 && p[0] < 0.96 && p[1] > 0.06 && p[1] < 0.9;
          el.dataset.vis = vis ? "1" : "0";
          el.style.transform = `translate(${(p[0] * 100).toFixed(2)}cqw, ${(p[1] * 100).toFixed(2)}cqh) translate(-50%, -100%)`;
        }
        // keep the two tags from stacking: if they overlap, the winner's tag wins
        const a = wTag.current, b = lTag.current;
        if (a && b) {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          const clash = a.dataset.vis === "1" && ra.left < rb.right + 6 && rb.left < ra.right + 6 && ra.top < rb.bottom && rb.top < ra.bottom;
          a.style.opacity = a.dataset.vis === "1" ? "1" : "0";
          b.style.opacity = b.dataset.vis === "1" && !clash ? "1" : "0";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const replay = () => {
    const v = video.current;
    if (!v) return;
    v.currentTime = 0;
    setEnded(false);
    v.play().catch(() => setEnded(true));
  };

  return (
    <div className="jp-ff">
      <div className="jp-ff-stage">
        <video
          key={base}
          ref={video}
          poster={`${base}.jpg`}
          muted
          playsInline
          preload="metadata"
          onEnded={() => setEnded(true)}
          aria-label={`Projected finish animation: ${winner} beats ${opponent}`}
        >
          <source src={`${base}.mp4`} type="video/mp4" />
          <source src={`${base}.webm`} type="video/webm" onError={() => (useFemale ? setUseFemale(false) : (setFailed(true), setEnded(true)))} />
        </video>
        <span ref={wTag} className="jp-ff-tag w">
          {winner}
        </span>
        <span ref={lTag} className="jp-ff-tag l">
          {opponent}
        </span>

        {ended && (
          <>
            <div className="jp-ff-result">
              <strong>{winner}</strong>
              <span>{isPreview ? "Scenario winner" : "Predicted winner"}</span>
            </div>
            {!failed && (
              <button type="button" className="jp-ff-replay" onClick={replay} aria-label="Replay the animation">
                <RotateCcw size={13} /> Replay
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
