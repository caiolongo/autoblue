import { produce } from "immer";
import { useEffect, useState } from "react";
import { useMode } from "../../app/mode";
import { formatSI, parseSI } from "../../lib/si";
import type { Part } from "../editor/doc";
import { getNetlist, pinKey, type Net, type Netlist } from "../editor/netlist";
import { useDoc, useEditor } from "../editor/store";
import { PARTS, type PropDef, type PropValue } from "../library/parts";
import { specOf } from "../../mcu/runtime";
import { isBlock } from "../blocks/blocks";
import { BlockPanel } from "./BlockPanel";
import { EnergyOverview, PartLive, WireLive } from "./LivePanel";
import { McuPanel } from "./McuPanel";

const HINT = {
  criar: "Arraste componentes da biblioteca e ligue os fios onde quiser. Clique numa peça para ver o que está escrito nela.",
  energia:
    "As cores dos fios mostram a tensão e as bolinhas mostram a corrente, do + para o −. Clique numa peça para ver de onde vem a energia dela.",
  testar: "Cada nó mostra a tensão medida em relação ao GND. Passe o mouse num pino ou fio para ver a corrente.",
} as const;

const KIND_LABEL: Record<Net["kind"], string> = {
  short: "Curto-circuito",
  gnd: "Terra (0 V)",
  power: "Alimentação",
  signal: "Sinal",
};

function NetChip({ net }: { net: Net | undefined }) {
  const setHoverNet = useEditor((s) => s.setHoverNet);
  if (!net) return <span className="net-chip k-none">solto</span>;
  return (
    <span
      className={`net-chip k-${net.kind}`}
      onPointerEnter={() => setHoverNet(net.id)}
      onPointerLeave={() => setHoverNet(null)}
      title={KIND_LABEL[net.kind]}
    >
      {net.name}
    </span>
  );
}

function ShortWarnings({ netlist, refs }: { netlist: Netlist; refs?: string[] }) {
  const shorts = netlist.shorts.filter((s) => !refs || refs.includes(s.ref));
  if (!shorts.length) return null;
  return (
    <div className="warning">
      {shorts.map((s) => (
        <p key={s.ref}>
          <strong>Curto-circuito em {s.ref}.</strong> O + e o − estão ligados direto pelo nó {s.net.name}, sem nada para
          limitar a corrente além da resistência interna da própria fonte.
        </p>
      ))}
    </div>
  );
}

function NumberField({ def, value, onChange }: { def: Extract<PropDef, { type: "number" }>; value: number; onChange: (v: number) => void }) {
  const shown = formatSI(value, def.unit);
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => setText(shown), [shown]);

  const apply = () => {
    const v = parseSI(text);
    if (v === null || (def.min !== undefined && v < def.min) || (def.max !== undefined && v > def.max)) {
      setBad(true);
      setTimeout(() => setBad(false), 900);
      setText(shown);
      return;
    }
    if (v !== value) onChange(v);
    else setText(shown);
  };

  return (
    <input
      className={bad ? "field bad" : "field"}
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setText(shown);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function TextField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="field"
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() && text !== value && onChange(text.trim())}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

function PartInspector({ part, netlist }: { part: Part; netlist: Netlist }) {
  const def = PARTS[part.kind];
  const markings = Object.values(def.markings(part.props));
  const pins = def.pins(part.props);

  const setProp = (k: string, v: PropValue) => {
    const { doc, commit } = useDoc.getState();
    commit(
      produce(doc, (d) => {
        d.parts[part.id].props[k] = v;
      }),
    );
  };

  return (
    <>
      <header className="insp-head">
        <span className="ref-chip mono">{part.ref}</span>
        <h2>{def.name}</h2>
      </header>
      <p className="insp-summary">{def.summary}</p>
      <ShortWarnings netlist={netlist} refs={[part.ref]} />
      <PartLive part={part} netlist={netlist} />
      {specOf(part) && <McuPanel part={part} />}
      {isBlock(part) && <BlockPanel part={part} />}

      {Object.keys(def.props).length > 0 && (
        <section>
          <h3 className="label">Ajustes</h3>
          {Object.entries(def.props).map(([k, pd]) => (
            <label key={k} className="prop">
              <span>{pd.label}</span>
              {pd.type === "number" ? (
                <NumberField def={pd} value={Number(part.props[k])} onChange={(v) => setProp(k, v)} />
              ) : pd.type === "text" ? (
                <TextField value={String(part.props[k] ?? "")} onChange={(v) => setProp(k, v)} />
              ) : (
                <select className="field" value={String(part.props[k])} onChange={(e) => setProp(k, e.target.value)}>
                  {pd.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
              {pd.explain && <small>{pd.explain}</small>}
            </label>
          ))}
        </section>
      )}

      <section>
        <h3 className="label">O que está escrito</h3>
        <ul className="markings">
          {markings.map((m) => (
            <li key={m.text}>
              <code>{m.text}</code>
              <span>{m.explain}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="label">Pinos</h3>
        <ul className="pins">
          {pins.map((pin) => (
            <li key={pin.name}>
              <div className="pin-row">
                <span>{pin.title}</span>
                <NetChip net={netlist.byPin.get(pinKey(part.id, pin.name))} />
              </div>
              <small>{pin.explain}</small>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function NetMembers({ net }: { net: Net }) {
  if (!net.pins.length) return <p className="muted">Não toca em nenhum pino.</p>;
  return (
    <ul className="members">
      {net.pins.map((p) => (
        <li key={`${p.partId}:${p.pin}`}>
          <span className="mono">{p.ref}</span> {p.title}
        </li>
      ))}
    </ul>
  );
}

function WireInspector({ id, netlist }: { id: string; netlist: Netlist }) {
  const net = netlist.byWire.get(id)!;
  return (
    <>
      <header className="insp-head">
        <NetChip net={net} />
        <h2>Fio</h2>
      </header>
      <p className="insp-summary">
        {KIND_LABEL[net.kind]}. Tudo ligado neste nó está no mesmo potencial elétrico: é como se fosse um único pedaço de
        metal.
      </p>
      {net.kind === "short" && <ShortWarnings netlist={netlist} refs={netlist.shorts.filter((s) => s.net === net).map((s) => s.ref)} />}
      <WireLive id={id} net={net} />
      <section>
        <h3 className="label">Ligado a</h3>
        <NetMembers net={net} />
      </section>
    </>
  );
}

function ProjectInspector({ netlist }: { netlist: Netlist }) {
  const mode = useMode((s) => s.mode);
  const doc = useDoc((s) => s.doc);
  const setHoverNet = useEditor((s) => s.setHoverNet);
  const nParts = Object.keys(doc.parts).length;
  const connected = netlist.nets.filter((n) => n.wires.length > 0 || n.pins.length > 1);

  return (
    <>
      <p className="insp-summary">{HINT[mode]}</p>
      <ShortWarnings netlist={netlist} />
      <EnergyOverview />
      {nParts > 0 && (
        <section>
          <h3 className="label">Nós ({connected.length})</h3>
          {connected.length === 0 && <p className="muted">Nenhuma ligação ainda.</p>}
          <ul className="nets">
            {connected.map((n) => (
              <li key={n.id} onPointerEnter={() => setHoverNet(n.id)} onPointerLeave={() => setHoverNet(null)}>
                <NetChip net={n} />
                <span className="muted">{n.pins.map((p) => `${p.ref}.${p.pin}`).join(", ") || "sem pinos"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function InspectorPanel() {
  const doc = useDoc((s) => s.doc);
  const selection = useDoc((s) => s.selection);
  const netlist = getNetlist(doc);
  const only = selection.length === 1 ? selection[0] : null;
  const part = only ? doc.parts[only] : undefined;
  const wire = only ? doc.wires[only] : undefined;

  return (
    <aside className="panel" style={{ gridArea: "right" }}>
      <div className="panel-head">
        Inspetor <span className="label">Por quê?</span>
      </div>
      <div className="panel-body inspector">
        {part ? (
          <PartInspector part={part} netlist={netlist} />
        ) : wire ? (
          <WireInspector id={wire.id} netlist={netlist} />
        ) : selection.length > 1 ? (
          <p className="insp-summary">
            {selection.length} itens selecionados. <kbd>R</kbd> gira, <kbd>F</kbd> espelha, <kbd>⌘D</kbd> duplica,{" "}
            <kbd>⌫</kbd> apaga.
          </p>
        ) : (
          <ProjectInspector netlist={netlist} />
        )}
      </div>
    </aside>
  );
}
