import { useState } from "react";
import { HintsEnabled } from "../../ui/tooltipStore";
import { PART_MIME } from "../editor/Canvas";
import { builtinBlocks, registerBlocks } from "../blocks/blocks";
import { emptyDoc } from "../editor/doc";
import { useDoc, useEditor } from "../editor/store";
import { SystemList } from "../systems/SystemList";

registerBlocks(emptyDoc());
import { defaultProps, PART_LIST, PARTS, type PartDef } from "./parts";

/** Grupos que ainda não chegaram; aparecem desativados com a fase em que entram. */
const UPCOMING: { group: string; phase: number; items: string[] }[] = [
];

const GROUPS = [...new Set(PART_LIST.map((d) => d.group))];

function Preview({ def }: { def: PartDef }) {
  const b = def.bounds;
  const p = defaultProps(def);
  const pad = 4;
  return (
    <svg className="preview" viewBox={`${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`} aria-hidden>
      <HintsEnabled.Provider value={false}>
        <def.Body p={p} mk={def.markings(p)} />
      </HintsEnabled.Provider>
    </svg>
  );
}

export function LibraryPanel() {
  const [tab, setTab] = useState<"pecas" | "sistemas">("pecas");
  const placing = useEditor((s) => s.placing);
  const setPlacing = useEditor((s) => s.setPlacing);
  const blocks = useDoc((s) => s.doc.blocks);
  const mine = Object.keys(blocks ?? {})
    .map((id) => PARTS[`block:${id}`])
    .filter(Boolean);
  const boards = Object.keys(builtinBlocks())
    .map((id) => PARTS[`block:${id}`])
    .filter(Boolean);

  return (
    <aside className="panel" style={{ gridArea: "left" }}>
      <div className="panel-head">
        <nav className="segmented small" aria-label="Biblioteca">
          <button aria-pressed={tab === "pecas"} onClick={() => setTab("pecas")}>
            Peças
          </button>
          <button aria-pressed={tab === "sistemas"} onClick={() => setTab("sistemas")}>
            Sistemas
          </button>
        </nav>
      </div>
      <div className="panel-body library">
        {tab === "sistemas" ? <SystemList /> : <>
        {[
          { title: "Placas prontas", list: boards },
          { title: "Meus blocos", list: mine },
        ].filter((g) => g.list.length > 0).map((g) => (
          <section key={g.title}>
            <div className="library-group">
              <span className="label">{g.title}</span>
            </div>
            <ul>
              {g.list.map((def) => (
                <li key={def.kind}>
                  <button
                    className="library-item"
                    aria-pressed={placing?.kind === def.kind}
                    draggable
                    title={def.summary}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(PART_MIME, def.kind);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => setPlacing(placing?.kind === def.kind ? null : { kind: def.kind, rot: 0, flip: false })}
                  >
                    <Preview def={def} />
                    <span>{def.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {GROUPS.map((group) => (
          <section key={group}>
            <div className="library-group">
              <span className="label">{group}</span>
            </div>
            <ul>
              {PART_LIST.filter((d) => d.group === group).map((def) => (
                <li key={def.kind}>
                  <button
                    className="library-item"
                    aria-pressed={placing?.kind === def.kind}
                    draggable
                    title={def.summary}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(PART_MIME, def.kind);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => setPlacing(placing?.kind === def.kind ? null : { kind: def.kind, rot: 0, flip: false })}
                  >
                    <Preview def={def} />
                    <span>{def.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {UPCOMING.map((c) => (
          <section key={c.group}>
            <div className="library-group">
              <span className="label">{c.group}</span>
              <span className="phase mono">fase {c.phase}</span>
            </div>
            <ul>
              {c.items.map((i) => (
                <li key={i} className="upcoming">
                  {i}
                </li>
              ))}
            </ul>
          </section>
        ))}
        </>}
      </div>
    </aside>
  );
}
