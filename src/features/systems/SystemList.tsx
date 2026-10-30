import { useDoc } from "../editor/store";
import { SYSTEMS } from "./index";
import { openSystem } from "./open";
import { SYSTEM_GROUPS } from "./spec";

/** Lista de sistemas prontos, do mais simples para o mais completo. */
export function SystemList() {
  const current = useDoc((s) => s.doc.system);
  return (
    <>
      <p className="library-intro">Circuitos prontos para abrir, estudar e modificar. Cada um traz um guia no inspetor.</p>
      {SYSTEM_GROUPS.map((group) => (
        <section key={group}>
          <div className="library-group">
            <span className="label">{group}</span>
          </div>
          <ul>
            {SYSTEMS.filter((s) => s.group === group).map((s) => (
              <li key={s.id}>
                <button className="system-item" data-system={s.id} aria-current={current === s.id} onClick={() => openSystem(s)}>
                  <span>{s.name}</span>
                  <small>{s.summary}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
