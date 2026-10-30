import { useDoc } from "../editor/store";
import { systemById } from "./index";

/** Guia de estudo do sistema aberto: como funciona, as contas, as peças e o que experimentar. */
export function SystemGuide() {
  const doc = useDoc((s) => s.doc);
  const select = useDoc((s) => s.select);
  const spec = systemById(doc.system);
  if (!spec) return null;
  const { how, math, roles, tryIt } = spec.guide;

  return (
    <>
      <header className="guide-head">
        <span className="label">{spec.group}</span>
        <h2>{spec.name}</h2>
        <p className="insp-summary">{spec.summary}</p>
      </header>
      <section>
        <h3 className="label">Como funciona</h3>
        <ol className="why">
          {how.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
      </section>
      <section>
        <h3 className="label">A conta</h3>
        <ul className="why">
          {math.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="label">Peças</h3>
        <ul className="roles">
          {Object.entries(roles).map(([ref, role]) => {
            const id = `p_${ref}`;
            return (
              <li key={ref}>
                <button className="ref-chip mono" disabled={!doc.parts[id]} title={`Selecionar ${ref}`} onClick={() => select([id])}>
                  {ref}
                </button>
                <span>{role}</span>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h3 className="label">Experimente</h3>
        <ul className="why">
          {tryIt.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
