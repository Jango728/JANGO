export type Promotion = "UFC" | "DWCS" | "PFL" | "ACA" | "OKTAGON";
export type Rules = "MMA" | "Kickboxing" | "Muay Thai" | "Grappling";
export type Factor = "opposition" | "style" | "size" | "distance" | "form" | "context";
export type Source = { label: string; url: string; checked: string; note?: string };
export type PastFight = { opponent: string; date: string; result: "W"|"L"|"D"|"NC"; promotion: string; method: string; round?: number; minutes?: number; time?:string; rules?:Rules; division?:string; weightLbs?:number; eventName?:string; opponentRecord?: string; opponentRecordBasis?:"reported"|"reconstructed"; opponentSource?:string; opponentHeight?: number; opponentReach?: number; opponentCurrentHeight?:number; opponentMeasurementsAsOf?:string; opponentPromotionBouts?:number; opponentStyle?: string; secondLevel?: number; secondLevelCount?:number; source?: string;
  /** Scheduled length of that bout (3 or 5). Lets the engine count real 5-round experience, including 5-rounders that ended early. Optional; see docs/SCHEMA.md. */
  scheduledRounds?: number;
  /** True for a title fight (any promotion's world title, interim included). */
  title?: boolean };
export type CombatStats = { asOf:string; source:string; scope:string; slpm?:number; sapm?:number; strikeAccuracy?:number; strikeDefense?:number; tdPer15?:number; tdAccuracy?:number; tdDefense?:number; subPer15?:number; kdPer15?:number; controlPer15?:number };
export type Fighter = { id: string; name: string; nickname?: string; record?: string; recordScope?: string; height?: number; reach?: number; age?: number; stance?: string; style?: string; country?: string; birthDate?:string; image?: string; imageDate?: string; imageSource?: string; profile?: string; tapology?:string; instagram?: string; history: PastFight[]; historyComplete?:boolean; historySource?:string; historyChecked?:string; ufcHistoryComplete?:boolean; stats?:CombatStats; sources: Source[]; recordNote?: string;
  /** Where the fighter trains (optional, for travel / time-zone context). tz = IANA zone, e.g. "America/Denver". */
  base?: { location: string; tz?: string; source?: string; checked?: string } };
export type Assessment = { score: number; note: string; source?: string; asOf: string };
export type Fight = { id: string; a: string; b: string; division: string; rules: Rules; rounds: number; section: string; assessments: Partial<Record<Factor, Assessment>>; notes: string[]; unknowns: string[]; odds?: { a: number; b: number; asOf: string; source: string };
  /** Fight-week facts for this bout (weigh-in, short notice, division change). Optional; see docs/SCHEMA.md. Never odds. */
  fightWeek?: FightWeek };
/** One fighter's official weigh-in. lbs = scale weight; missedBy = pounds over the allowance. */
export type WeighIn = { lbs?: number; missed?: boolean; missedBy?: number; note?: string };
export type FightWeek = {
  /** Official weigh-in for this bout. limit = division limit (or catchweight) in lbs; catchweight = true when the bout was contracted or moved to a catchweight. */
  weighIn?: { a?: WeighIn; b?: WeighIn; limit?: number; catchweight?: boolean; checked: string; source: string };
  /** A late replacement: which side stepped in, whom they replaced, the date the booking was announced, and days of notice before the event. */
  shortNotice?: { fighter: "a" | "b"; replaced?: string; announced: string; daysNotice: number; source: string };
  /** A fighter competing outside their usual division (moving up or down). from = the division of their previous bouts. */
  divisionChange?: { fighter: "a" | "b"; from: string; source?: string }[];
};
/** One dated change to a card (audit trail; also what reviews read for short-notice / weight context). */
export type CardChange = { date: string; kind: "withdrawal" | "replacement" | "added" | "cancelled" | "moved" | "weight" | "rounds" | "other"; note: string; source: string };
/** Venue facts that can matter to cardio and pace. altitudeM = metres above sea level; cageFt = Octagon/cage diameter (UFC APEX 25, arenas 30); tz = IANA zone. */
export type Venue = { altitudeM?: number; cageFt?: number; tz?: string; source?: string };
export type Event = { id: string; title: string; promotion: Promotion; date: string; time?: string; location: string; coverage: string; source: Source; fights: Fight[];
  venue?: Venue;
  /** Card-level fight-week status: set once official weigh-ins are checked (per-bout misses go in Fight.fightWeek.weighIn). */
  fightWeek?: { weighInsChecked?: string; allMadeWeight?: boolean; source?: string };
  /** Dated lineup changes, newest last. Append only. */
  changes?: CardChange[] };
/** Machine-readable log of one automated run (data/runs/YYYY-MM-DD.json holds { date, runs: RunLog[] }). Written by scripts/run-log.mjs. */
export type RunLog = {
  kind: "nightly" | "live" | "weigh-in" | "sunday" | "friday" | "manual";
  startedAt: string; finishedAt?: string;
  status: "running" | "ok" | "partial" | "failed" | "no-change";
  /** Which fetch path worked: "firecrawl", "webfetch", "mixed". */
  sourcePath?: string;
  checked: string[]; changed: string[]; failed: { step: string; error: string }[];
  notes?: string[]; warnings?: number; errors?: number;
  published?: { at: string; files: number } | null;
};
export type Weights = Record<Factor, number>;
export type Review = { pick?: string; agreement?: "agree"|"disagree"; notes?: string; observedAt?: string; mediaUrl?: string; physique?: string; ratings?: Partial<Record<Factor, Assessment>>; odds?: { a: number; b: number; asOf: string; source: string } };
export type Snapshot = { id: string; fightId: string; eventId: string; a: string; b: string; pick: string; modelPick: string | null; modelVersion?:string; roundsPrediction?:import('./rounds').RoundsPrediction; finishPrediction?:import('./finish').FinishPrediction; edge: number; coverage: number; notes: string; frozenAt: string; eventDate: string; prospective: boolean; weights: Weights; factors: unknown[]; actual?: string; resultSource?: string };
export type Workspace = { reviews: Record<string, Review>; weights: Weights; imports: Event[]; fighters: Record<string,Fighter> };
