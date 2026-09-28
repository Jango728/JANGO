import { FinishFilm } from "./finish-film";
import { FINISH_LABELS, predictFinish, type FinishMethod } from "@/lib/finish";
import type { Fighter, Fight, Event } from "@/lib/types";

/** `method` overrides the model's ending (a locked bout shows its frozen method call). */
export function FinishScene({ a, b, event, fight, winnerId, method: forced }: { a: Fighter; b: Fighter; event: Event; fight: Fight; winnerId: string | null; method?: FinishMethod }) {
  const prediction = predictFinish(fight, a, b, event, winnerId);
  const overridden = !!forced && !!prediction && forced !== prediction.method;
  const method = forced ?? prediction?.method ?? "decision", selected = prediction?.winnerId ?? a.id, winner = selected === a.id ? a : b, opponent = selected === a.id ? b : a;
  return (
    <section className="finish-feature">
      <div className="finish-heading">
        <strong>{FINISH_LABELS[method]}</strong>
        <span>Projected finish</span>
      </div>
      <FinishFilm key={fight.id + method + selected} method={method} winner={winner.name} opponent={opponent.name} winnerCorner={selected === a.id ? "red" : "blue"} isPreview={!prediction} female={/^w\b|women/i.test(fight.division)} />
      <details className="scene-options">
        <summary>Why this ending</summary>
        {overridden ? (
          <p className="fine">The locked method call from before the fight. Today's model's most likely ending for this winner is {FINISH_LABELS[prediction!.method]}.</p>
        ) : prediction && (
          <ul>
            {prediction.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
        <p className="fine">Stand-in characters, not the actual fighters. A choreographed prediction, not fight footage.</p>
        <p className="fine">
          Characters: <a className="out" href="https://github.com/microsoft/Microsoft-Rocketbox" target="_blank" rel="noopener noreferrer">Microsoft Rocketbox</a> (MIT). Motion:{" "}
          <a className="out" href="https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset" target="_blank" rel="noopener noreferrer">Bandai Namco Research Motion Dataset</a> (CC BY-NC 4.0).
        </p>
      </details>
    </section>
  );
}
