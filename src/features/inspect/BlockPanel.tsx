import { produce } from "immer";
import { useEffect, useState } from "react";
import { useSim } from "../../sim/store";
import { specOf } from "../../mcu/runtime";
import { blockOf, explodeBlock, flattenDoc } from "../blocks/blocks";
import { McuPanel } from "./McuPanel";
import type { Part } from "../editor/doc";
import { useDoc } from "../editor/store";
import { PARTS } from "../library/parts";

const STATUS = { idle: "parado", ok: "funcionando", warn: "atenção", danger: "queimado" } as const;

/** Bloco: nome, peças de dentro (com estado ao vivo), consertar e desmontar. */
export function BlockPanel({ part }: { part: Part }) {
  const doc = useDoc((s) => s.doc);
  const result = useSim((s) => s.result);
  const press = useSim((s) => s.press);
  const def = blockOf(doc, part);
  const [name, setName] = useState(def?.name ?? "");
  useEffect(() => setName(def?.name ?? ""), [def?.name]);
  if (!def) return null;
  const { commit } = useDoc.getState();
  const uses = Object.values(doc.parts).filter((p) => p.kind === part.kind).length;
  const inside = Object.values(def.parts).filter((p) => p.kind !== "port");
  const flat = flattenDoc(doc);
  const buttons = inside.filter((p) => p.kind === "pushButton");
  const chips = inside.map((p) => flat.parts[`${part.id}/${p.id}`]).filter((p) => p && specOf(p));

  const rename = () =>
    name.trim() &&
    name !== def.name &&
    commit(
      produce(doc, (d) => {
        d.blocks![def.id].name = name.trim();
      }),
    );

  return (
    <>
      {buttons.length > 0 && (
        <section>
          <h3 className="label">Botões da placa</h3>
          <div className="board-buttons">
            {buttons.map((b) => {
              const id = `${part.id}/${b.id}`;
              const up = () => press(id, false);
              return (
                <button key={b.id} className="btn" onPointerDown={() => press(id, true)} onPointerUp={up} onPointerLeave={up}>
                  Segurar {b.ref}
                </button>
              );
            })}
          </div>
        </section>
      )}
      {chips.map((c) => (
        <McuPanel key={c.id} part={c} />
      ))}
      <section>
        <h3 className="label">{def.board ? "Placa" : "Bloco"}</h3>
        {!def.board && (
        <label className="prop">
          <span>Nome (vale para as {uses} cópias)</span>
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </label>
        )}
        <p className="muted">Pinos: {def.pins.map((p) => p.name).join(", ")}.</p>
      </section>
      <section>
        <h3 className="label">Por dentro</h3>
        <ul className="members">
          {inside.map((p) => {
            const st = result?.parts[`${part.id}/${p.id}`];
            return (
              <li key={p.id}>
                <span className="mono">{p.ref}</span> {PARTS[p.kind]?.name}
                {st && <span className="muted"> — {STATUS[st.status]}</span>}
              </li>
            );
          })}
        </ul>
        {Object.keys(part.inner ?? {}).length > 0 && (
          <button
            className="btn"
            onClick={() =>
              commit(
                produce(doc, (d) => {
                  delete d.parts[part.id].inner;
                }),
              )
            }
          >
            Trocar as peças queimadas
          </button>
        )}
        <button className="btn" onClick={() => commit(explodeBlock(doc, part.id), [])}>
          Desmontar (voltar às peças)
        </button>
      </section>
    </>
  );
}
