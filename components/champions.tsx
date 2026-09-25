"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Crown, Flame, TrendingDown, TrendingUp } from "lucide-react";
import { DIVISIONS, P4P, RANKINGS_AS_OF, type Contender, type Division } from "@/lib/rankings";

type View = "men" | "women" | "p4p";

function MoveTag({ c }: { c: Contender }) {
  if (c.move === "up") return <span className="jp-ch-move up" title={`Up ${c.by ?? ""}`}><TrendingUp size={12} />{c.by}</span>;
  if (c.move === "down") return <span className="jp-ch-move down" title={`Down ${c.by ?? ""}`}><TrendingDown size={12} />{c.by}</span>;
  if (c.move === "new") return <span className="jp-ch-move new">NEW</span>;
  return null;
}

function Contenders({ list, title, champ }: { list: Contender[]; title: string; champ?: string }) {
  return (
    <div className="jp-ch-list">
      <div className="jp-ch-list-head">
        <span>{title}</span>
        {champ && <em>Chasing {champ.split(" ").slice(-1)[0]}</em>}
      </div>
      <ol>
        {list.map((c, i) => (
          <li key={c.name} style={{ animationDelay: `${60 + i * 45}ms` }} className={i === 0 ? "next" : ""}>
            <b>{i + 1}</b>
            <span className="nm">{c.name}</span>
            {i === 0 && champ && <span className="jp-ch-next">Next in line</span>}
            <MoveTag c={c} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function ChampionHero({ d, onPrev, onNext }: { d: Division; onPrev: () => void; onNext: () => void }) {
  const ch = d.champion;
  const [first, ...rest] = ch.name.split(" ");
  return (
    <div className="jp-ch-hero" key={d.id}>
      <div className="jp-ch-rays" aria-hidden="true" />
      <div className="jp-ch-photo">
        <img src={ch.img} alt={ch.name} loading="lazy" />
        <i className="jp-ch-shine" aria-hidden="true" />
      </div>
      <div className="jp-ch-info">
        <span className="jp-ch-div">
          <Crown size={14} /> {d.name} · {d.limit} lbs
        </span>
        <h2>
          <small>{first}</small>
          {rest.join(" ")}
        </h2>
        {ch.nickname && <span className="jp-ch-nick">“{ch.nickname}”</span>}
        <div className="jp-ch-badges">
          <span className="gold">{ch.interim ? "Interim champion" : "Champion"}</span>
          {ch.p4p && <span>P4P #{ch.p4p}</span>}
        </div>
        <dl className="jp-ch-facts">
          <div><dt>Record</dt><dd>{ch.record}</dd></div>
          <div><dt>Age</dt><dd>{ch.age}</dd></div>
          <div><dt>Height</dt><dd>{ch.height}</dd></div>
          <div><dt>Reach</dt><dd>{ch.reach}″</dd></div>
        </dl>
        <p className="jp-ch-note">{ch.note}{ch.style ? ` · ${ch.style}` : ""} · {ch.from}</p>
      </div>
      <button className="jp-ch-nav prev" onClick={onPrev} aria-label="Previous division"><ChevronLeft size={18} /></button>
      <button className="jp-ch-nav next" onClick={onNext} aria-label="Next division"><ChevronRight size={18} /></button>
    </div>
  );
}

function Threats({ d }: { d: Division }) {
  return (
    <div className="jp-ch-threats">
      <div className="jp-ch-threats-head">
        <Flame size={16} />
        <div>
          <strong>Threat radar <em className="jp-ch-scope">(all listed fighters are outside the division&apos;s top 10)</em></strong>
          <span>Under-the-radar names outside the top 10 — Contender Series signees and unbeaten newcomers who could be coming for the {d.name.toLowerCase()} belt</span>
        </div>
      </div>
      <div className="jp-ch-threat-grid">
        {d.prospects.map((p, i) => (
          <article key={p.name} className={`jp-ch-threat t${p.threat}`} style={{ animationDelay: `${120 + i * 80}ms` }}>
            <div className="top">
              <span className="tag">{p.tag}</span>
              <span className="meter" aria-label={`Threat level ${p.threat} of 3`}>
                {[1, 2, 3].map((k) => (
                  <Flame key={k} size={13} className={k <= p.threat ? "on" : ""} />
                ))}
              </span>
            </div>
            <h4>{p.name}</h4>
            <div className="stats">
              <span>{p.record}</span>
              <span>Age {p.age}</span>
              {p.rank ? <span>#{p.rank} ranked</span> : <span>Unranked</span>}
            </div>
            <p>{p.why}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

export function Champions() {
  const [view, setView] = useState<View>("men");
  const divs = useMemo(() => DIVISIONS.filter((d) => (view === "women" ? d.women : !d.women)), [view]);
  const [sel, setSel] = useState("lw");
  const d = divs.find((x) => x.id === sel) ?? divs[0];
  const idx = divs.indexOf(d);
  const go = (k: number) => setSel(divs[(idx + k + divs.length) % divs.length].id);

  useEffect(() => {
    if (view === "p4p") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea")) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const pick = (v: View) => {
    setView(v);
    if (v === "women") setSel("wfw");
    if (v === "men") setSel("lw");
  };

  return (
    <>
      <section className="jp-page-head">
        <span className="jp-eyebrow">UFC · media rankings as of {RANKINGS_AS_OF}</span>
        <h1>Champions</h1>
        <p>Every UFC belt holder, the top 10 lined up behind them, and the under-the-radar prospects we think are coming for the title.</p>
      </section>

      <div className="jp-ch-tabs" role="tablist" aria-label="Rankings view">
        {([["men", "Men"], ["women", "Women"], ["p4p", "Pound for pound"]] as [View, string][]).map(([v, label]) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => pick(v)}>
            {label}
          </button>
        ))}
      </div>

      {view !== "p4p" ? (
        <>
          <div className="jp-ch-wall" role="tablist" aria-label="Divisions">
            {divs.map((x) => (
              <button key={x.id} role="tab" aria-selected={x.id === d.id} className={"jp-ch-belt " + (x.id === d.id ? "on" : "")} onClick={() => setSel(x.id)}>
                <span className="img"><img src={x.champion.img} alt="" loading="lazy" /></span>
                <span className="lbl">
                  <b>{x.short}</b>
                  <span>{x.champion.name.split(" ").slice(-1)[0]}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="jp-ch-stage">
            <ChampionHero d={d} onPrev={() => go(-1)} onNext={() => go(1)} />
            <Contenders key={d.id} list={d.top10} title={`${d.name} top 10`} champ={d.champion.name} />
          </div>
          <Threats key={"t" + d.id} d={d} />
        </>
      ) : (
        <div className="jp-ch-p4p">
          {(["men", "women"] as const).map((g) => {
            const top = g === "men" ? DIVISIONS.find((x) => x.id === "ww")! : DIVISIONS.find((x) => x.id === "wfw")!;
            return (
              <div key={g} className="jp-ch-p4p-col">
                <div className="jp-ch-p4p-top">
                  <div className="jp-ch-rays small" aria-hidden="true" />
                  <img src={top.champion.img} alt={top.champion.name} />
                  <div>
                    <span className="jp-eyebrow">{g === "men" ? "Men's" : "Women's"} pound-for-pound #1</span>
                    <strong>{top.champion.name}</strong>
                    <em>{top.name} champion · {top.champion.record}</em>
                  </div>
                </div>
                <Contenders list={P4P[g]} title={`${g === "men" ? "Men's" : "Women's"} pound for pound`} />
              </div>
            );
          })}
        </div>
      )}
      <p className="jp-fine jp-ch-foot">
        Champions and rankings: UFC.com media panel. Threat radar: Jango Playz's own picks, based on UFC.com and Tapology records.<span className="jp-ch-keys"> Use ← → to flip divisions.</span>
      </p>
    </>
  );
}
