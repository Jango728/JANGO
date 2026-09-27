"use client";
import { ArrowUpRight, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Flag } from "./fighter-meta";
import { historySummary, usableStats } from "@/lib/model";
import { strikingLosses } from "@/lib/matchup";
import type { Event, Fight, Fighter, Review } from "@/lib/types";

const number = (v: number | undefined, places = 2) =>
  v === undefined || !Number.isFinite(v)
    ? "—"
    : v.toFixed(places).replace(/\.00$/, "");
export function MatchupPaths({
  a,
  b,
  event,
  fight,
  review,
  onNotes,
}: {
  a: Fighter;
  b: Fighter;
  event: Event;
  fight: Fight;
  review: Review;
  onNotes: () => void;
}) {
  const as = usableStats(a, event.date, fight.rules),
    bs = usableStats(b, event.date, fight.rules),
    ah = historySummary(a, event.date, fight.rules),
    bh = historySummary(b, event.date, fight.rules);
  const common = [...new Set(ah.all.map((h) => h.opponent))].filter((name) =>
    bh.all.some((h) => h.opponent === name),
  );
  const isWaldo =
    [a.id, b.id].includes("waldo-cortes-acosta") &&
    [a.id, b.id].includes("curtis-blaydes");
  return (
    <div className="surface matchup-paths">
      <div className="section-head">
        <h3>How this fight could play out</h3>
        <span className="tag">Explore the matchup</span>
      </div>
      <Tabs defaultValue="feet">
        <TabsList className="path-tabs">
          <TabsTrigger value="feet">On the feet</TabsTrigger>
          {fight.rules === "MMA" && (
            <TabsTrigger value="grappling">Wrestling & control</TabsTrigger>
          )}
          <TabsTrigger value="resume">Past opponents</TabsTrigger>
        </TabsList>
        <TabsContent value="feet">
          <div className="path-grid">
            {[a, b].map((f, i) => {
              const s = i === 0 ? as : bs,
                losses = strikingLosses(f, event.date, fight.rules);
              return (
                <div key={f.id} className="path-fighter">
                  <strong>
                    <Flag country={f.country} /> {f.name}
                  </strong>
                  <dl>
                    <div>
                      <dt>Strikes landed / absorbed</dt>
                      <dd>
                        {number(s?.slpm)} / {number(s?.sapm)}
                        <small>per minute</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Knockdowns</dt>
                      <dd>
                        {number(s?.kdPer15)}
                        <small>per 15 minutes</small>
                      </dd>
                    </div>
                    <div>
                      <dt>
                        KO/TKO losses in last{" "}
                        {i === 0 ? ah.recent.length : bh.recent.length}
                      </dt>
                      <dd>
                        {(i === 0 ? ah.recent.length : bh.recent.length)
                          ? losses.length
                          : "—"}
                        <small>
                          {losses.map((h) => h.opponent).join(", ") ||
                            ((i === 0 ? ah.recent.length : bh.recent.length)
                              ? "None in loaded sample"
                              : "History unavailable")}
                        </small>
                      </dd>
                    </div>
                  </dl>
                  {s && (
                    <a
                      className="out"
                      href={s.source}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      UFC stats <ArrowUpRight size={13} />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
          <p className="path-take">
            Striking output, defensive exposure and stoppage history belong
            together. These figures do not measure footwork or speed.
          </p>
        </TabsContent>
        {fight.rules === "MMA" && (
          <TabsContent value="grappling">
            <div className="path-grid">
              {[a, b].map((f, i) => {
                const s = i === 0 ? as : bs,
                  o = i === 0 ? bs : as,
                  opp = i === 0 ? b : a;
                return (
                  <div key={f.id} className="path-fighter">
                    <strong>
                      <Flag country={f.country} /> {f.name}
                    </strong>
                    <dl>
                      <div>
                        <dt>Takedowns landed / 15 min</dt>
                        <dd>{number(s?.tdPer15)}</dd>
                      </div>
                      <div>
                        <dt>{opp.name}’s takedown defence</dt>
                        <dd>
                          {number(o?.tdDefense, 0)}
                          {o?.tdDefense !== undefined ? "%" : ""}
                        </dd>
                      </div>
                      <div>
                        <dt>Control time / 15 min</dt>
                        <dd>
                          {number(s?.controlPer15)}
                          <small>
                            {s?.controlPer15 === undefined
                              ? "Not supplied by UFC profile"
                              : "minutes"}
                          </small>
                        </dd>
                      </div>
                    </dl>
                  </div>
                );
              })}
            </div>
            <p className="path-take">
              The question is whether the takedowns work against this
              opponent—and whether they lead to sustained control. A wrestling
              label alone cannot answer that.
            </p>
          </TabsContent>
        )}
        <TabsContent value="resume">
          {common.length ? (
            <div className="common-opponents">
              {common.slice(0, 6).map((name) => (
                <div key={name}>
                  <strong>{name}</strong>
                  <div>
                    {[ah, bh].map((h, i) => (
                      <div key={i}>
                        <b>{i === 0 ? a.name : b.name}</b>
                        {h.all
                          .filter((x) => x.opponent === name)
                          .map((x, j) => (
                            <p key={j}>
                              <span
                                className={"result " + x.result.toLowerCase()}
                              >
                                {x.result}
                              </span>{" "}
                              {x.method} · R{x.round ?? "?"}
                              <small>
                                {x.date} · opponent{" "}
                                {x.opponentRecord || "record unknown"}
                              </small>
                            </p>
                          ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <p className="fine">
                Shared opponents provide context. Different dates, styles and
                circumstances prevent a direct A-beats-B comparison.
              </p>
            </div>
          ) : (
            <div className="path-grid">
              {[a, b].map((f, i) => (
                <div key={f.id} className="path-fighter">
                  <strong>{f.name}</strong>
                  {(i === 0 ? ah : bh).recent.slice(0, 3).map((h, j) => (
                    <p key={j}>
                      <span className={"result " + h.result.toLowerCase()}>
                        {h.result}
                      </span>{" "}
                      {h.opponent}
                      <small>
                        {h.opponentRecord || "Pre-fight record unknown"} ·{" "}
                        {h.method}
                      </small>
                    </p>
                  ))}
                </div>
              ))}
              <p className="fine">No common opponents in the loaded history.</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
      {(isWaldo || review.physique) && (
        <div className="film-read">
          <Eye size={18} />
          <div>
            <strong>Your film read</strong>
            <p>
              {review.physique ||
                "You lean Cortés-Acosta: his movement and agility on the feet stand out to you, even with similar listed size."}
            </p>
            <small>
              {review.observedAt ||
                (isWaldo ? "2026-09-10" : "Date not recorded")}{" "}
              · Your observation, not a measured stat
            </small>
            {review.mediaUrl && (
              <a
                className="out"
                href={review.mediaUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Footage <ArrowUpRight size={13} />
              </a>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onNotes}>
            Add context
          </Button>
        </div>
      )}
    </div>
  );
}

