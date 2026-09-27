"use client";
import { createContext, useContext, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { encodeRef } from "@/lib/fighter-ref";

/** Site-wide actions any component can call: open a fighter profile, open search, jump to a fight. */
export type SiteNav = {
  /** A seed id, a display name, or an encoded reference from `encodeRef`. */
  openFighter: (idOrName: string) => void;
  openSearch: () => void;
  goFight: (eventId: string, fightId?: string) => void;
};

const Ctx = createContext<SiteNav>({ openFighter: () => {}, openSearch: () => {}, goFight: () => {} });
export const SiteNavProvider = ({ value, children }: { value: SiteNav; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export const useSiteNav = () => useContext(Ctx);

/**
 * A fighter's name that opens their profile. Every name is clickable: seed fighters open their full
 * profile, roster fighters their UFC profile, anyone else an opponent card built from known bouts.
 *
 * Pass `slug` (roster slug, or null when the row says "not a roster fighter") or `vs` + `date` (whose
 * history row this is) so namesakes resolve to the right person. Rendered as a span with button
 * semantics so it can sit inside <summary>, <button> rows or table cells without nesting buttons.
 */
export function FighterName({
  name,
  id,
  slug,
  vs,
  date,
  className = "",
  children,
}: {
  name: string;
  id?: string;
  slug?: string | null;
  vs?: string;
  date?: string;
  className?: string;
  children?: ReactNode;
}) {
  const nav = useSiteNav();
  if (!name.trim()) return <span className={className}>{children ?? name}</span>;
  const open = (e: MouseEvent | KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    nav.openFighter(encodeRef({ name, id, slug, vs, date }));
  };
  return (
    <span
      role="button"
      tabIndex={0}
      className={"jp-fname " + className}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") open(e);
      }}
      title={`Open ${name}'s profile`}
    >
      {children ?? name}
    </span>
  );
}
