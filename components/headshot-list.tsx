"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Gem, RotateCcw } from "lucide-react";

/**
 * Sully's Collection v2 — a 3D shooting sequence driven by the Web Animations API.
 * Gun slides in level, the reticle locks on each rival, it fires (slide blowback, flash, casing),
 * the round lands and the face is revealed,
 * then a real blood tear wells up under the eye and runs down the cheek.
 * Rest state (no motion / before it plays) is the finished picture.
 * v1 is kept in archive/headshot-v1 and git tag `headshot-v1`.
 */
type Rival = {
  name: string;
  conqueror: string;
  image: string;
  size: number; // background-size % of circle width
  x: number; // background offset, fraction of diameter
  y: number;
  tear: [number, number]; // just under the eye, fraction of diameter
};
const RIVALS: Rival[] = [
  { name: "Merab Dvalishvili", conqueror: "Petr Yan", image: "fighters/ufc333-merab-dvalishvili.webp", size: 157, x: -0.3, y: 0.075, tear: [0.64, 0.5] },
  { name: "Ilia Topuria", conqueror: "Justin Gaethje", image: "rivals/ilia-topuria.webp", size: 189, x: -0.44, y: -0.05, tear: [0.635, 0.52] },
];
const SLOTS = 5;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function HeadshotList() {
  const stage = useRef<HTMLDivElement>(null);
  const gun = useRef<HTMLDivElement>(null);
  const slide = useRef<HTMLImageElement>(null);
  const muzzle = useRef<HTMLSpanElement>(null);
  const flash = useRef<HTMLSpanElement>(null);
  const casing = useRef<HTMLSpanElement>(null);
  const bullet = useRef<HTMLSpanElement>(null);
  const mag = useRef<HTMLDivElement>(null);
  const count = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLElement | null)[]>([]);
  const [phase, setPhase] = useState<"rest" | "armed" | "playing" | "done">("rest");
  const [hits, setHits] = useState<number>(RIVALS.length);
  const run = useRef(0);

  const play = useCallback(async () => {
    const id = ++run.current;
    const alive = () => id === run.current;
    const st = stage.current, g = gun.current;
    if (!st || !g) return;
    setHits(0);
    setPhase("playing");
    await wait(30);
    const E: KeyframeAnimationOptions = { fill: "forwards", easing: "cubic-bezier(.2,.8,.2,1)" };
    // gun swings in from the side in 3D
    await g.animate([{ transform: "translateX(-40px)", opacity: 0 }, { transform: "translateX(0)", opacity: 1 }], { ...E, duration: 700 }).finished;
    for (let i = 0; i < RIVALS.length; i++) {
      if (!alive()) return;
      const card = cards.current[i];
      if (!card) continue;
      const m = muzzle.current!.getBoundingClientRect(), c = card.querySelector(".face")!.getBoundingClientRect(), s = st.getBoundingClientRect();
      const dx = c.left + c.width / 2 - m.left, dy = c.top + c.height / 2 - m.top;
      const ang = Math.atan2(dy, dx) * (180 / Math.PI);
      // reticle locks on (the gun stays level)
      card.classList.add("aim");
      await wait(520);
      if (!alive()) return;
      // fire: flash, slide blowback, recoil, casing, smoke
      card.classList.remove("aim");
      flash.current!.animate([{ opacity: 1, transform: "translate(-8px,-50%) scale(.4) rotate(0deg)" }, { opacity: 1, transform: "translate(-8px,-50%) scale(1.25) rotate(20deg)", offset: 0.35 }, { opacity: 0, transform: "translate(-8px,-50%) scale(.6) rotate(35deg)" }], { duration: 150 });
      slide.current!.animate([{ transform: "translateX(0)" }, { transform: "translateX(-9%)", offset: 0.3 }, { transform: "translateX(0)" }], { duration: 170, easing: "ease-out" });
      g.animate([{ transform: "translateX(0)" }, { transform: "translateX(-7px)", offset: 0.25 }, { transform: "translateX(0)" }], { duration: 420, easing: "ease-out" });
      casing.current!.animate(
        [
          { opacity: 1, transform: "translate3d(0,0,0) rotateZ(0deg) rotateX(0deg)" },
          { opacity: 1, transform: "translate3d(-30px,-70px,40px) rotateZ(-340deg) rotateX(260deg)", offset: 0.45 },
          { opacity: 1, transform: "translate3d(-58px,62px,10px) rotateZ(-700deg) rotateX(520deg)", offset: 0.85 },
          { opacity: 0, transform: "translate3d(-66px,56px,0) rotateZ(-760deg) rotateX(560deg)" },
        ],
        { duration: 900, easing: "cubic-bezier(.3,.6,.6,1)" },
      );
      st.querySelectorAll<HTMLElement>(".jp-hs2-smoke").forEach((el, k) =>
        el.animate([{ opacity: 0.7, transform: "translate(0,0) scale(.4)" }, { opacity: 0, transform: `translate(${10 + k * 8}px,${-26 - k * 10}px) scale(${1.6 + k * 0.5})` }], { duration: 1100 + k * 200, easing: "ease-out", delay: k * 60 }),
      );
      // the round flies into depth toward the face
      const b = bullet.current!;
      const bx = m.left - s.left, by = m.top - s.top;
      await b.animate(
        [
          { opacity: 1, transform: `translate(${bx}px, ${by}px) rotate(${ang}deg) scale(1)` },
          { opacity: 1, transform: `translate(${bx + dx}px, ${by + dy}px) rotate(${ang}deg) scale(.55)` },
        ],
        { duration: 240, easing: "cubic-bezier(.5,0,1,1)" },
      ).finished;
      if (!alive()) return;
      // impact: soft flash and the face is revealed
      card.classList.add("hit");
      setHits(i + 1);
      await wait(620);
      if (!alive()) return;
      card.classList.add("cry");
      await wait(900);
    }
    if (!alive()) return;
    // magazine drops straight out of the grip (upright), and the counter appears below the trigger
    await mag.current!.animate(
      [
        { transform: "translate(0,0)", opacity: 1 },
        { transform: "translate(0,48px)", opacity: 1, offset: 0.6, easing: "cubic-bezier(.5,0,1,1)" },
        { transform: "translate(0,62px)", opacity: 0 },
      ],
      { duration: 700, fill: "forwards" },
    ).finished;
    count.current?.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 350, fill: "forwards" });
    setPhase("done");
  }, []);

  // play once when scrolled into view
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setPhase("armed");
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          io.disconnect();
          play();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [play]);

  const replay = () => {
    cards.current.forEach((c) => c?.classList.remove("hit", "cry", "aim"));
    [mag.current, count.current, gun.current].forEach((el) => el?.getAnimations().forEach((a) => a.cancel()));
    play();
  };

  const cls = "jp-hs2 " + (phase === "rest" ? "rest" : phase === "done" ? "done" : "live");
  return (
    <section className={cls} aria-labelledby="jp-hs-title">
      <div className="jp-hs2-copy">
        <span className="jp-eyebrow">Sully&apos;s collection</span>
        <h2 id="jp-hs-title">Headshot list</h2>
        <p>Rivals get marked off after they lose. Just for fun — it never touches a prediction.</p>
        <div className="jp-hs2-gems" aria-label={`${RIVALS.length} of ${SLOTS} collected`}>
          {Array.from({ length: SLOTS }, (_, i) => (
            <span key={i} className={i < (phase === "rest" ? RIVALS.length : hits) ? "on" : ""}>
              <Gem size={14} />
            </span>
          ))}
          <b>
            {RIVALS.length}/{SLOTS}
          </b>
        </div>
      </div>

      <div ref={stage} className="jp-hs2-stage">
        <div className="jp-hs2-gunwrap" aria-hidden="true">
          <div ref={gun} className="jp-hs2-gun">
            <div ref={mag} className="jp-hs2-mag">
              <img src="rivals/collection-magazine.png" alt="" />
            </div>
            <img className="frame" src="rivals/collection-pistol.png" alt="" />
            <img ref={slide} className="slide" src="rivals/collection-pistol.png" alt="" />
            <span ref={casing} className="jp-hs2-casing" />
            <span ref={muzzle} className="jp-hs2-muzzle">
              <span ref={flash} className="jp-hs2-flash">
                <svg viewBox="0 0 100 60">
                  <path d="M0 30 L42 18 L50 0 L58 20 L100 30 L58 40 L50 60 L42 42 Z" />
                  <circle cx="22" cy="30" r="16" />
                </svg>
              </span>
              <i className="jp-hs2-smoke" />
              <i className="jp-hs2-smoke" />
              <i className="jp-hs2-smoke" />
            </span>
          </div>
          <div ref={count} className="jp-hs2-count">
            <img className="clip" src="rivals/collection-magazine.png" alt="" />
            <span className="rounds">
              {Array.from({ length: SLOTS }, (_, i) => (
                <i key={i} className={i < SLOTS - RIVALS.length ? "live" : "spent"} />
              ))}
            </span>
            <b>
              {RIVALS.length}/{SLOTS}
            </b>
          </div>
        </div>

        <div className="jp-hs2-targets">
          {RIVALS.map((r, i) => (
            <article
              key={r.name}
              className="jp-hs2-card"
              ref={(el) => {
                cards.current[i] = el;
              }}
              style={{ "--tx": `${r.tear[0] * 100}%`, "--ty": `${r.tear[1] * 100}%` } as CSSProperties}
            >
              <div className="face">
                <div className="photo" style={{ backgroundImage: `url(${r.image})`, backgroundSize: `${r.size}% auto`, backgroundPosition: `calc(var(--d) * ${r.x}) calc(var(--d) * ${r.y})` }} />
                <svg className="scope" viewBox="0 0 100 100" aria-hidden="true">
                  <circle cx="50" cy="50" r="47" />
                  <circle className="inner" cx="50" cy="50" r="30" />
                  <path d="M50 2 V20 M50 80 V98 M2 50 H20 M80 50 H98" />
                </svg>
                <span className="tear" aria-hidden="true">
                  <svg className="trail" viewBox="0 0 10 60" preserveAspectRatio="none">
                    <path d="M5 2 C5.6 16 4.2 30 5.2 58" pathLength={1} />
                  </svg>
                  <svg className="drop first" viewBox="0 0 12 18">
                    <path d="M6 0 C6 0 0.8 8.4 0.8 12.2 A5.2 5.2 0 0 0 11.2 12.2 C11.2 8.4 6 0 6 0Z" />
                    <ellipse cx="4.2" cy="11.6" rx="1.3" ry="2.1" />
                  </svg>
                  <svg className="drop again" viewBox="0 0 12 18">
                    <path d="M6 0 C6 0 0.8 8.4 0.8 12.2 A5.2 5.2 0 0 0 11.2 12.2 C11.2 8.4 6 0 6 0Z" />
                    <ellipse cx="4.2" cy="11.6" rx="1.3" ry="2.1" />
                  </svg>
                </span>
                <i className="flashhit" />
              </div>
              <div className="label">
                <strong>{r.name}</strong>
                <span>
                  Son of <b>{r.conqueror}</b>
                </span>
              </div>
            </article>
          ))}
        </div>
        <span ref={bullet} className="jp-hs2-bullet" aria-hidden="true" />

      </div>
      {phase === "done" && (
        <button className="jp-hs2-reload" type="button" onClick={replay} aria-label="Replay the animation" title="Replay">
          <RotateCcw size={16} />
        </button>
      )}
    </section>
  );
}
