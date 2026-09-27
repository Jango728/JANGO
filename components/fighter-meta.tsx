"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { normalizePromotion, orgRecord } from "@/lib/fightinfo";
import { ufcRecord } from "@/lib/model";
import type { Fighter } from "@/lib/types";

// Light, dependency-free fighter bits used on every Fight center view (flags, promotion record, theme switch).
const countries:Record<string,string>={'United States':'US','USA':'US','Brazil':'BR','Mexico':'MX','France':'FR','Morocco':'MA','Dominican Republic':'DO','Chile':'CL','Russia':'RU','Netherlands':'NL','China':'CN','Japan':'JP','South Korea':'KR','South Africa':'ZA','United Kingdom':'GB','England':'GB','Scotland':'GB','Australia':'AU','New Zealand':'NZ','Canada':'CA','Argentina':'AR','Georgia':'GE','Belgium':'BE','Uzbekistan':'UZ','Türkiye':'TR','Turkey':'TR','Senegal':'SN','Sweden':'SE','Tajikistan':'TJ','Czech Republic':'CZ','Czechia':'CZ','Slovakia':'SK','Germany':'DE','Austria':'AT','Denmark':'DK','Poland':'PL','Norway':'NO','Finland':'FI','Ireland':'IE','Italy':'IT','Spain':'ES','Portugal':'PT','Romania':'RO','Bulgaria':'BG','Ukraine':'UA','Belarus':'BY','Serbia':'RS','Croatia':'HR','Bosnia and Herzegovina':'BA','Armenia':'AM','Azerbaijan':'AZ','Albania':'AL','Aruba':'AW','Kazakhstan':'KZ','Kyrgyzstan':'KG','Thailand':'TH','Myanmar':'MM','Malaysia':'MY','Singapore':'SG','Indonesia':'ID','Philippines':'PH','Vietnam':'VN','Iran':'IR','Iraq':'IQ','Tunisia':'TN','Algeria':'DZ','Nigeria':'NG','Cameroon':'CM','Ghana':'GH','Egypt':'EG','Bahrain':'BH','United Arab Emirates':'AE','Saudi Arabia':'SA','Israel':'IL','India':'IN','Pakistan':'PK','Hong Kong':'HK','Taiwan':'TW','Mongolia':'MN','Peru':'PE','Colombia':'CO','Venezuela':'VE','Ecuador':'EC','Bolivia':'BO','Paraguay':'PY','Uruguay':'UY','Cuba':'CU','Jamaica':'JM','Haiti':'HT','Puerto Rico':'PR','Costa Rica':'CR','Panama':'PA'};
// Flags ship as separate SVG files next to the bundle and only load when a flag is on screen.
const FLAG_FILES = import.meta.glob("../lib/flags/*.svg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const FLAG_URLS: Record<string, string> = Object.fromEntries(Object.entries(FLAG_FILES).map(([p, url]) => [p.split("/").pop()!.replace(".svg", ""), url]));
export function Flag({ country }: { country?: string }) {
  const code = country ? countries[country] : undefined;
  const src = code ? FLAG_URLS[code.toLowerCase()] : undefined;
  return src ? (
    <span className="country-flag" role="img" aria-label={country} title={country}>
      <img src={src} alt="" width={22} height={15} loading="lazy" decoding="async" />
    </span>
  ) : null;
}
const DEBUT = /^0-0(-0)?$/;
/** Record inside the card's promotion before this event, e.g. "[UFC: 4-1]"; "UFC debut" for a first appearance. Hidden on Contender Series cards, where everyone debuts. */
export function UFCRecord({ f, date, promotion = "UFC" }: { f: Fighter; date: string; promotion?: string }) {
  const org = normalizePromotion(promotion);
  if (org !== "UFC") {
    const r = orgRecord(f, date, org);
    if (r === null || (org === "DWCS" && DEBUT.test(r))) return null;
    return (
      <span className="ufc-record" title={`Completed professional ${org} bouts before this event.`}>
        {DEBUT.test(r) ? `${org} debut` : `[${org}: ${r}]`}
      </span>
    );
  }
  const hasUFCProfile = [f.profile, ...f.sources.map((s) => s.url)].some((url) => url && /^https?:\/\/(?:www\.)?ufc\.com\//i.test(url));
  if (!hasUFCProfile && !f.ufcHistoryComplete && !f.history.some((h) => h.promotion === "UFC")) return null;
  const r = ufcRecord(f, date);
  return (
    <span className="ufc-record" title="Completed professional UFC bouts before this event. Contender Series, Road to UFC cards and TUF exhibitions excluded.">
      {r && DEBUT.test(r) ? "UFC debut" : `[UFC: ${r ?? "unverified"}]`}
    </span>
  );
}
/** Dark / light toggle. A native switch keeps the header free of UI-library code. */
export function ThemeSwitch() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    let preferred = true;
    try {
      const saved = localStorage.getItem("fightlens-theme-v2");
      if (saved) preferred = saved === "dark";
    } catch {}
    setDark(preferred);
    document.documentElement.classList.toggle("dark", preferred);
  }, []);
  function change(v: boolean) {
    setDark(v);
    document.documentElement.classList.toggle("dark", v);
    try {
      localStorage.setItem("fightlens-theme-v2", v ? "dark" : "light");
    } catch {}
  }
  return (
    <button type="button" role="switch" aria-checked={dark} aria-label="Dark mode" className="theme-control" onClick={() => change(!dark)} title={dark ? "Switch to light mode" : "Switch to dark mode"}>
      <Sun size={16} aria-hidden="true" />
      <span className="theme-track" aria-hidden="true">
        <span />
      </span>
      <Moon size={16} aria-hidden="true" />
      <span className="theme-label">{dark ? "Dark" : "Light"}</span>
    </button>
  );
}
