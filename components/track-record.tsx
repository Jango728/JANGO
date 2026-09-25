"use client";
import { useState } from "react";
import { ArrowUpRight, ChevronDown, CircleCheck, CircleX, Minus } from "lucide-react";
import { ledgers, performance, scoredBouts, type Tally } from "@/lib/ledger";
import { PromotionLogo } from "./promotion-logo";

const Mark = ({ v }: { v: boolean | null }) =>
  v === null ? <Minus size={15} className="mk none" aria-label="Not scored" /> : v ? <CircleCheck size={15} className="mk hit" aria-label="Correct" /> : <CircleX size={15} className="mk miss" aria-label="Wrong" />;

function Stat({ label, t, note }: { label: string; t: Tally; note?: string }) {
  return (
    <div className="jp-stat">
      <span>{label}</span>
      <strong>{t.pct === null ? "—" : `${t.pct}%`}</strong>
      <small>
        {t.hit}/{t.n} {note ?? ""}
      </small>
    </div>
  );
}

const CAUSE: Record<string, string> = { data: "Data gap", "style-read": "Style read", variance: "Variance", model: "Model logic" };

export function TrackRecord() {
  const perf = performance();
  const [open, setOpen] = useState<string | null>(ledgers.find((l) => l.forecast && l.results)?.eventId ?? null);
  return (
    <div className="jp-track">
      <div className="jp-stats">
        <Stat label="Winner picks" t={perf.winner} />
        <Stat label="Rounds O/U" t={perf.rounds} note={`· always-Over would hit ${perf.alwaysOver.pct ?? "—"}%`} />
        <Stat label="Method" t={perf.method} />
        <Stat label="UFC cards" t={perf.ufc} />
        <Stat label="DWCS" t={perf.dwcs} />
        <div className="jp-stat">
          <span>Brier score</span>
          <strong>{perf.brier ?? "—"}</strong>
          <small>lower is better · 0.25 = coin flip</small>
        </div>
      </div>

      <div className="jp-card">
        <h3 className="jp-h3">Accuracy by confidence band</h3>
        <p className="jp-fine">If the model is calibrated, higher bands hit more often. Only frozen pre-fight picks count.</p>
        <div className="jp-bands">
          {perf.bands.map((b) => (
            <div key={b.label} className="jp-band">
              <span>{b.label}</span>
              <div className="jp-bar">
                <i style={{ width: `${b.pct ?? 0}%` }} />
              </div>
              <strong>{b.pct === null ? "—" : `${b.pct}%`}</strong>
              <small>{b.n} picks</small>
            </div>
          ))}
        </div>
      </div>

      <div className="jp-ledger">
        {ledgers.map((l) => {
          const rows = scoredBouts(l);
          const w = rows.filter((r) => r.winner !== null), rr = rows.filter((r) => r.rounds !== null);
          const isOpen = open === l.eventId;
          return (
            <section key={l.eventId} className={"jp-card jp-ledger-card " + (isOpen ? "open" : "")}>
              <button className="jp-ledger-head" onClick={() => setOpen(isOpen ? null : l.eventId)} aria-expanded={isOpen}>
                <PromotionLogo promotion={l.promotion} />
                <div>
                  <strong>{l.title}</strong>
                  <span>
                    {l.date} · {l.forecast ? `frozen ${l.forecast.frozenAt.slice(0, 10)} · engine ${l.forecast.engine}` : "no pre-fight forecast preserved — excluded from accuracy"}
                  </span>
                </div>
                {l.forecast && !l.results ? (
                  <span className="jp-tag gold">{l.forecast.bouts.length} {l.forecast.bouts.length === 1 ? "pick" : "picks"} locked</span>
                ) : l.forecast ? (
                  <div className="jp-ledger-score">
                    <b>
                      {w.filter((r) => r.winner).length}/{w.length}
                    </b>
                    <small>winners</small>
                    <b>
                      {rr.filter((r) => r.rounds).length}/{rr.length}
                    </b>
                    <small>rounds</small>
                  </div>
                ) : (
                  <span className="jp-tag">Results only</span>
                )}
                <ChevronDown size={18} className="jp-chev" />
              </button>
              {isOpen && !l.results && l.forecast && (
                <div className="jp-ledger-body">
                  <table className="jp-table">
                    <thead>
                      <tr>
                        <th>Fight</th>
                        <th>Locked pick</th>
                        <th>Conf.</th>
                        <th>Rounds</th>
                        <th>Method</th>
                      </tr>
                    </thead>
                    <tbody>
                      {l.forecast.bouts.map((f, i) => (
                        <tr key={i}>
                          <td>
                            <strong>{f.a}</strong> vs <strong>{f.b}</strong>
                            <div className="jp-fine">{f.scheduledRounds} rounds</div>
                          </td>
                          <td>{f.pick ?? "N/A · pending"}</td>
                          <td>{f.confidence ? `${f.confidence}%` : "—"}</td>
                          <td>{f.rounds ? `${f.rounds.side} ${f.rounds.line}` : "—"}</td>
                          <td>{f.method ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="jp-fine">Locked {l.forecast.frozenAt.slice(0, 10)}. Results and a postmortem are added after the card.</p>
                </div>
              )}
              {isOpen && l.results && (
                <div className="jp-ledger-body">
                  <table className="jp-table">
                    <thead>
                      <tr>
                        <th>Result</th>
                        <th>Pick</th>
                        <th>W</th>
                        <th>O/U</th>
                        <th>R</th>
                        <th>Method</th>
                        <th>M</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          <td>
                            <strong>{r.bout.winner ?? "Draw / NC"}</strong> def. {r.bout.loser}
                            <div className="jp-fine">
                              {r.bout.detail ?? r.bout.method} · R{r.bout.round} {r.bout.time}
                              {r.bout.contract ? " · UFC contract" : ""}
                            </div>
                            {r.bout.notes.length > 0 && (
                              <details className="jp-notes">
                                <summary>How it went</summary>
                                <ul>
                                  {r.bout.notes.map((n, j) => (
                                    <li key={j}>{n}</li>
                                  ))}
                                </ul>
                                {r.bout.context && <p className="jp-fine">{r.bout.context}</p>}
                              </details>
                            )}
                          </td>
                          <td>
                            {r.forecast?.pick ?? "—"}
                            {r.forecast?.confidence ? <span className="jp-fine"> {r.forecast.confidence}%</span> : null}
                          </td>
                          <td>
                            <Mark v={r.winner} />
                          </td>
                          <td>
                            {r.forecast?.rounds ? `${r.forecast.rounds.side} ${r.forecast.rounds.line}` : "—"}
                            <div className="jp-fine">went {r.bout.ou}</div>
                          </td>
                          <td>
                            <Mark v={r.rounds} />
                          </td>
                          <td>{r.forecast?.method ?? "—"}</td>
                          <td>
                            <Mark v={r.method} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {l.review && (
                    <div className="jp-review">
                      <h4>
                        Postmortem <span className="jp-tag">{l.review.status}</span>
                      </h4>
                      <ul>
                        {l.review.lessons.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                      {l.review.bouts.length > 0 && (
                        <div className="jp-misses">
                          {l.review.bouts.map((m, i) => (
                            <div key={i} className="jp-miss">
                              <strong>
                                {m.a} vs {m.b}
                              </strong>
                              {m.cause && <span className={"jp-cause c-" + m.cause}>{CAUSE[m.cause]}</span>}
                              <p>{m.note}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      {l.review.modelChanges && (
                        <>
                          <h5>What changed in the model</h5>
                          <ul>
                            {l.review.modelChanges.map((x, i) => (
                              <li key={i}>{x}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                  <div className="jp-sources">
                    {l.results?.sources.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
                        {s.label} <ArrowUpRight size={12} />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
