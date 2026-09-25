"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Gem, RotateCcw } from "lucide-react";

/**
 * Sully's Collection. Face framing is set per photo so the eyes land in the same
 * place inside the crosshair, and the blood tear sits right under one eye.
 * All coordinates are fractions of the circle diameter.
 */
type Rival = {
  name: string;
  conqueror: string;
  image: string;
  /** background-size as % of the circle width, background offset as fraction of diameter */
  size: number;
  x: number;
  y: number;
  /** tear anchor (just under the eye) as fraction of diameter */
  tear: [number, number];
};
const RIVALS: Rival[] = [
  { name: "Merab Dvalishvili", conqueror: "Petr Yan", image: "fighters/ufc333-merab-dvalishvili.webp", size: 157, x: -0.3, y: 0.075, tear: [0.64, 0.49] },
  { name: "Ilia Topuria", conqueror: "Justin Gaethje", image: "rivals/ilia-topuria.webp", size: 189, x: -0.44, y: -0.05, tear: [0.635, 0.51] },
];
const SLOTS = 5;

export function HeadshotList() {
  const [run, setRun] = useState(0);
  const [armed, setArmed] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const muzzle = useRef<HTMLSpanElement>(null);
  const targets = useRef<(HTMLDivElement | null)[]>([]);
  const [paths, setPaths] = useState<CSSProperties>({});

  // Bullet flight paths are measured from the real muzzle to each target so they work at any width.
  const measure = useCallback(() => {
    const s = stage.current?.getBoundingClientRect(), m = muzzle.current?.getBoundingClientRect();
    if (!s || !m) return;
    const vars: Record<string, string> = {};
    targets.current.forEach((t, i) => {
      const r = t?.getBoundingClientRect();
      if (!r) return;
      vars[`--bx${i + 1}`] = `${r.left + r.width / 2 - m.left}px`;
      vars[`--by${i + 1}`] = `${r.top + r.height / 2 - m.top}px`;
      vars[`--ang${i + 1}`] = `${Math.atan2(r.top + r.height / 2 - m.top, r.left + r.width / 2 - m.left)}rad`;
    });
    vars["--mx"] = `${m.left - s.left}px`;
    vars["--my"] = `${m.top - s.top}px`;
    setPaths(vars as CSSProperties);
  }, []);
  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // Fire when the section scrolls into view (and again on the reload button).
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") return setArmed(true);
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        measure();
        setArmed(true);
        io.disconnect();
      }
    }, { threshold: 0.45 });
    io.observe(node);
    return () => io.disconnect();
  }, [measure]);

  const replay = () => {
    measure();
    setArmed(true);
    setRun((v) => v + 1);
  };

  return (
    <section className="jp-hs" aria-labelledby="jp-hs-title">
      <div className="jp-hs-copy">
        <span className="jp-eyebrow">Sully&apos;s collection</span>
        <h2 id="jp-hs-title">Headshot list</h2>
        <p>Rivals marked off after they lose. Just for fun — it never touches a prediction.</p>
        <div className="jp-hs-gems" aria-label={`${RIVALS.length} of ${SLOTS} collected`}>
          {Array.from({ length: SLOTS }, (_, i) => (
            <span key={`${run}-${i}`} className={i < RIVALS.length ? `on g${i + 1}` : ""}>
              <Gem size={14} />
            </span>
          ))}
          <b>
            {RIVALS.length}/{SLOTS}
          </b>
        </div>
      </div>

      <div ref={stage} className={"jp-hs-stage " + (armed ? "fire" : "")} style={paths} key={run}>
        <div className="jp-hs-gun" aria-hidden="true">
          {/* magazine sits behind the pistol, then drops out of the grip */}
          <div className="jp-hs-mag">
            <img src="rivals/collection-magazine.png" alt="" />
          </div>
          <div className="jp-hs-mag-count">
            <span className="jp-hs-rounds">
              {Array.from({ length: SLOTS }, (_, i) => (
                <i key={i} className={i < SLOTS - RIVALS.length ? "live" : "spent"} />
              ))}
            </span>
            <b>
              {RIVALS.length}/{SLOTS}
            </b>
          </div>
          <img className="jp-hs-pistol" src="rivals/collection-pistol.png" alt="" />
          <span className="jp-hs-muzzle" ref={muzzle}>
            <i className="flash f1" />
            <i className="flash f2" />
            <i className="smoke s1" />
            <i className="smoke s2" />
            <i className="jp-hs-bullet b1" />
            <i className="jp-hs-bullet b2" />
          </span>
        </div>

        <div className="jp-hs-targets">
          {RIVALS.map((r, i) => (
            <article key={r.name} className={`jp-hs-card c${i + 1}`}>
              <div
                className="jp-hs-face"
                ref={(el) => {
                  targets.current[i] = el;
                }}
              >
                <div
                  className="jp-hs-photo"
                  style={{
                    backgroundImage: `url(${r.image})`,
                    backgroundSize: `${r.size}% auto`,
                    backgroundPosition: `calc(var(--d) * ${r.x}) calc(var(--d) * ${r.y})`,
                  }}
                />
                <svg className="jp-hs-scope" viewBox="0 0 100 100" aria-hidden="true">
                  <circle cx="50" cy="50" r="47" />
                  <path d="M50 1 V16 M50 84 V99 M1 50 H13 M87 50 H99" />
                  <path className="ticks" d="M50 20 V24 M50 76 V80 M20 50 H24 M76 50 H80" />
                </svg>
                <svg className="jp-hs-tear" style={{ left: `${r.tear[0] * 100}%`, top: `${r.tear[1] * 100}%` }} viewBox="0 0 10 16" aria-hidden="true">
                  <path d="M5 0 C5 0 0.6 7.2 0.6 10.6 A4.4 4.4 0 0 0 9.4 10.6 C9.4 7.2 5 0 5 0Z" />
                  <ellipse cx="3.6" cy="10.2" rx="1.1" ry="1.8" />
                </svg>
                <i className="jp-hs-burst" />
                <i className="jp-hs-ring" />
                {Array.from({ length: 10 }, (_, k) => (
                  <i key={k} className="jp-hs-shard" style={{ "--a": `${k * 36 + (i ? 18 : 0)}deg` } as CSSProperties} />
                ))}
              </div>
              <div className="jp-hs-label">
                <strong>{r.name}</strong>
                <span>
                  Son of <b>{r.conqueror}</b>
                </span>
              </div>
            </article>
          ))}
        </div>

        <button className="jp-hs-reload" type="button" onClick={replay} aria-label="Replay the animation" title="Replay">
          <RotateCcw size={11} />
        </button>
      </div>
    </section>
  );
}
