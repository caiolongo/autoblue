import { produce } from "immer";
import { energyPath, energySummary } from "../../sim/energy";
import { A, V, W } from "../../sim/rules";
import { useSim } from "../../sim/store";
import { wireCurrents } from "../../sim/view";
import type { Part } from "../editor/doc";
import { pinKey, type Net, type Netlist } from "../editor/netlist";
import { useDoc } from "../editor/store";

const STATUS = {
  idle: { label: "Parado", cls: "s-idle" },
  ok: { label: "Funcionando", cls: "s-ok" },
  warn: { label: "Atenção", cls: "s-warn" },
  danger: { label: "Queimado", cls: "s-danger" },
} as const;

function PowerOff() {
  return (
    <section>
      <h3 className="label">Agora</h3>
      <p className="muted">
        Energia desligada. Ligue com <kbd>E</kbd> ou no botão da barra de baixo para ver tensões e correntes.
      </p>
    </section>
  );
}

/** Estado da peça na simulação: o que está acontecendo, por quê e de onde vem a energia. */
export function PartLive({ part, netlist }: { part: Part; netlist: Netlist }) {
  const { powered, result } = useSim();
  const doc = useDoc((s) => s.doc);
  if (!powered) return <PowerOff />;
  const ps = result?.parts[part.id];
  if (!result?.ok || !ps) return null;

  const repair = () => {
    const { doc, commit } = useDoc.getState();
    commit(
      produce(doc, (d) => {
        delete d.parts[part.id].damage;
      }),
    );
  };

  if (part.damage) {
    return (
      <section>
        <h3 className="label">Agora</h3>
        <div className="note n-danger">
          <strong>Queimou.</strong> {part.damage.reason}
          <p>
            {part.damage.mode === "open"
              ? "Agora ela é um circuito aberto: não passa corrente."
              : "Agora ela é um curto: os terminais estão ligados direto por dentro."}
          </p>
          <button className="btn" onClick={repair}>
            Trocar por uma nova
          </button>
        </div>
      </section>
    );
  }

  const path = energyPath(doc, netlist, result, part.id);
  const st = STATUS[ps.status];

  return (
    <>
      <section>
        <h3 className="label">
          Agora <span className={`status ${st.cls}`}>{st.label}</span>
        </h3>
        {ps.notes.map((n, i) => (
          <div key={i} className={`note n-${n.level}`}>
            {n.text}
          </div>
        ))}
        <ol className="why">
          {ps.why.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ol>
      </section>

      {path && path.length > 1 && (
        <section>
          <h3 className="label">De onde vem a energia</h3>
          <div className="path">
            {path.map((s, i) => (
              <span key={i} className={s.partId === part.id ? "step self" : "step"}>
                {i > 0 && <i>→</i>}
                <span className="mono">
                  {s.ref}
                  {i === 0 && <small> {s.out}</small>}
                  {i === path.length - 1 && i > 0 && <small> {s.in}</small>}
                </span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="label">Medido nos pinos</h3>
        <table className="readings mono">
          <tbody>
            {Object.entries(ps.reading.pins).map(([name, r]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{(netlist.byPin.get(pinKey(part.id, name))?.pins.length ?? 2) < 2 ? <span className="muted">solto</span> : V(r.v)}</td>
                <td>
                  {A(Math.abs(r.i))} <span className="muted">{Math.abs(r.i) < 1e-9 ? "" : r.i > 0 ? "entra" : "sai"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          {ps.reading.power < -1e-9
            ? `Entregando ${W(-ps.reading.power)} ao circuito.`
            : `Consumindo ${W(Math.max(0, ps.reading.power))}.`}
        </p>
      </section>
    </>
  );
}

export function WireLive({ id, net }: { id: string; net: Net }) {
  const { powered, result } = useSim();
  if (!powered) return <PowerOff />;
  if (!result?.ok) return null;
  const i = wireCurrents(result.flows).get(id) ?? 0;
  return (
    <section>
      <h3 className="label">Agora</h3>
      <ol className="why">
        <li>
          Tensão neste nó: {V(result.nets[net.id] ?? 0)} em relação ao GND. Todo ponto deste nó tem essa mesma tensão.
        </li>
        <li>Corrente passando por este fio: {A(i)}.</li>
      </ol>
    </section>
  );
}

/** Quem entrega e quem consome energia no circuito todo. */
export function EnergyOverview() {
  const { powered, result } = useSim();
  const doc = useDoc((s) => s.doc);
  const select = useDoc((s) => s.select);
  if (!powered || !result?.ok) return null;
  const e = energySummary(doc, result);
  const burned = Object.values(doc.parts).filter((p) => p.damage);
  const max = Math.max(e.delivered, 1e-12);

  const rows = (list: typeof e.loads, kind: string) =>
    list.map((r) => (
      <li key={r.partId} onClick={() => select([r.partId])}>
        <div className="energy-row">
          <span className="mono">{r.ref}</span>
          <span>{r.name}</span>
          <span className="mono">{W(r.power)}</span>
        </div>
        <div className={`bar ${kind}`} style={{ width: `${Math.min(100, (r.power / max) * 100)}%` }} />
      </li>
    ));

  return (
    <>
      {burned.length > 0 && (
        <section>
          <h3 className="label">Queimadas ({burned.length})</h3>
          <ul className="energy">
            {burned.map((p) => (
              <li key={p.id} onClick={() => select([p.id])}>
                <div className="energy-row">
                  <span className="mono">{p.ref}</span>
                  <span className="muted">{p.damage!.reason}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="label">Energia</h3>
        {e.sources.length === 0 ? (
          <p className="muted">Nenhuma fonte entregando energia. Ligue uma fonte a um circuito fechado.</p>
        ) : (
          <>
            <p className="muted">Entregue pelas fontes</p>
            <ul className="energy">{rows(e.sources, "src")}</ul>
            <p className="muted">Consumido (vira calor, luz…)</p>
            <ul className="energy">{rows(e.loads, "load")}</ul>
            <p className="muted mono">
              {W(e.delivered)} entregues = {W(e.consumed)} consumidos
            </p>
          </>
        )}
      </section>
    </>
  );
}
