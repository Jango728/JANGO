"use client";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Expand } from "lucide-react";
import { PromotionLogo } from "./promotion-logo";
import { Flag, UFCRecord } from "./fighter-meta";
import { useSiteNav } from "./site-nav";
import { recordAtEvent } from "@/lib/model";
import type { Event, Fight, Fighter } from "@/lib/types";
import { formatHeight, formatReach } from "@/lib/measurements";

export function Portrait({
  f,
  small = false,
}: {
  f: Fighter;
  small?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  return f.image && !broken ? (
    <img
      className={small ? "avatar" : "portrait"}
      src={f.image}
      alt={f.name}
      onError={() => setBroken(true)}
      loading={small ? "lazy" : "eager"}
      decoding="async"
    />
  ) : (
    <div
      className={small ? "avatar initials" : "portrait initials"}
      role="img"
      aria-label={`${f.name}: photo unavailable`}
    >
      <span>
        {f.name
          .split(" ")
          .slice(0, 2)
          .map((x) => x[0])
          .join("")}
      </span>
      {!small && <small>Photo unavailable</small>}
    </div>
  );
}
function FighterStage({
  f,
  event,
  onOpen,
  motion,
  rules,
}: {
  f: Fighter;
  event: Event;
  rules: Fight["rules"];
  onOpen: () => void;
  motion: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  function move(e: PointerEvent<HTMLButtonElement>) {
    if (
      !motion ||
      e.pointerType !== "mouse" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const r = e.currentTarget.getBoundingClientRect(),
      x = (e.clientX - r.left) / r.width,
      y = (e.clientY - r.top) / r.height;
    ref.current?.style.setProperty("--tilt-x", `${(y - 0.5) * -8}deg`);
    ref.current?.style.setProperty("--tilt-y", `${(x - 0.5) * 10}deg`);
    ref.current?.style.setProperty("--light-x", `${x * 100}%`);
  }
  function reset() {
    ref.current?.style.setProperty("--tilt-x", "0deg");
    ref.current?.style.setProperty("--tilt-y", "0deg");
  }
  return (
    <button
      type="button"
      ref={ref}
      className="fighter-stage"
      onPointerMove={move}
      onPointerLeave={reset}
      onBlur={reset}
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={`Open ${f.name} portrait and profile`}
    >
      <div className="stage-depth">
        <div className="stage-rank" aria-hidden="true">
          {f.name.split(" ").slice(-1)[0]}
        </div>
        <Portrait key={f.id} f={f} />
        <div className="stage-title">
          <span className="stage-country">
            <Flag country={f.country} /> {f.country || "Country unverified"}
          </span>
          <h2>{f.name}</h2>
          <div className="stage-record">
            {recordAtEvent(f, event.date, rules)}
          </div>
          <UFCRecord f={f} date={event.date} promotion={event.promotion} />
        </div>
        <span className="portrait-expand">
          <Expand size={16} />
          <span>View fighter</span>
        </span>
      </div>
    </button>
  );
}
export function Faceoff({ a, b, event, fight, children }: { a: Fighter; b: Fighter; event: Event; fight: Fight; children?: ReactNode }) {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(preference.matches);
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);
  const nav = useSiteNav();
  const tiltEnabled = !reducedMotion;
  return (
    <div className={"arena " + (!tiltEnabled ? "motion-off" : "")}>
      <div className="arena-topline">
        <span className="arena-promotion">
          <PromotionLogo promotion={event.promotion} />
          <span>
            {fight.section} · {fight.division}
          </span>
        </span>
        <span>
          {fight.rules} · {fight.rounds} rounds
        </span>
      </div>
      <div className="arena-fighters">
        <FighterStage key={a.id} f={a} event={event} rules={fight.rules} motion={tiltEnabled} onOpen={() => nav.openFighter(a.id)} />
        <span className="arena-vs" aria-hidden="true">
          VS
        </span>
        <FighterStage key={b.id} f={b} event={event} rules={fight.rules} motion={tiltEnabled} onOpen={() => nav.openFighter(b.id)} />
      </div>
      {children}
    </div>
  );
}
const stance = (s?: string) => (s && /[a-z]/i.test(s) ? s : "—");
export function TaleOfTape({ a, b }: { a: Fighter; b: Fighter }) {
  return (
    <div className="quick-tape">
      {[
        ["Height", formatHeight(a.height), formatHeight(b.height)],
        ["Reach", formatReach(a.reach), formatReach(b.reach)],
        ["Stance", stance(a.stance), stance(b.stance)],
      ].map(([label, x, y]) => (
        <div key={label}>
          <strong>{x}</strong>
          <span>{label}</span>
          <strong>{y}</strong>
        </div>
      ))}
    </div>
  );
}
