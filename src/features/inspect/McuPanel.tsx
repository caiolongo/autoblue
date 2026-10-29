import { produce } from "immer";
import { parseSteps, readReg } from "../../mcu/engine";
import { ctxFor, specOf } from "../../mcu/runtime";
import { STM_MODES } from "../../mcu/specs";
import type { McuReg, McuSpec, Step, StepOp } from "../../mcu/types";
import { mcuStates, useSim } from "../../sim/store";
import type { Part } from "../editor/doc";
import { useDoc } from "../editor/store";
import { PinInternals } from "./PinInternals";

const hex = (x: number, width: number) => `0x${(x >>> 0).toString(16).toUpperCase().padStart(width / 4, "0")}`;
const widthOf = (r: McuReg) => (r.role === "mode4" ? 32 : r.bits.length <= 8 ? 8 : r.bits.length <= 16 ? 16 : 32);

/** Bits com rótulo, do mais alto para o mais baixo (como nos datasheets). */
const labeled = (r: McuReg) =>
  r.bits
    .map((label, bit) => ({ label, bit }))
    .filter((b): b is { label: string; bit: number } => !!b.label)
    .reverse();

function Register({ spec, part, r }: { spec: McuSpec; part: Part; r: McuReg }) {
  const doc = useDoc((s) => s.doc);
  const result = useSim((s) => s.result);
  const poke = useSim((s) => s.poke);
  const st = mcuStates()[part.id];
  if (!st || !result) return null;
  const high = ctxFor(doc, part, spec, result).high;
  const value = readReg(spec, st, r.name, high);
  const latch = st.regs[r.name] >>> 0;
  const strobe = r.role === "set" || r.role === "clr" || r.role === "xor";

  return (
    <div className="reg">
      <div className="reg-head" title={r.explain}>
        <span className="mono">{r.name}</span>
        <span className="mono muted">{strobe ? "escrita" : r.role === "mode4" ? "" : hex(value, widthOf(r))}</span>
      </div>
      {r.role === "mode4" ? (
        <div className="reg-modes">
          {r.bits.map((pin, field) =>
            pin ? (
              <label key={pin} className="mono">
                {pin}
                <select
                  className="field small"
                  value={(latch >>> (field * 4)) & 0xf}
                  onChange={(e) => poke(part.id, { reg: r.name, bit: field, mode: Number(e.target.value) })}
                >
                  {STM_MODES.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null,
          )}
        </div>
      ) : (
        <div className="reg-bits">
          {labeled(r).map(({ label, bit }) => {
            const on = (value >>> bit) & 1;
            return (
              <button
                key={bit}
                className={on ? "bit on" : "bit"}
                disabled={r.role === "in"}
                title={`bit ${bit}${strobe ? ": clique para escrever 1" : ""}`}
                onClick={() => poke(part.id, { reg: r.name, bit, value: strobe ? 1 : on ? 0 : 1 })}
              >
                <span>{strobe ? "1" : on}</span>
                <small>{label}</small>
              </button>
            );
          })}
        </div>
      )}
      {r.role === "out" && spec.rmw && latch !== value && (
        <p className="muted mono reg-note">escrito {hex(latch, 8)}, lido nos pinos {hex(value, 8)}</p>
      )}
    </div>
  );
}

const OPS: { op: StepOp; label: string }[] = [
  { op: "set", label: "Ligar bit" },
  { op: "clear", label: "Desligar bit" },
  { op: "toggle", label: "Inverter bit" },
  { op: "mode", label: "Modo do pino" },
  { op: "wait", label: "Esperar" },
];

function StepRow({ spec, step, active, onChange, onRemove }: { spec: McuSpec; step: Step; active: boolean; onChange: (s: Step) => void; onRemove: () => void }) {
  const writable = spec.regs.filter((r) => (step.op === "mode" ? r.role === "mode4" : r.role !== "in" && r.role !== "mode4"));
  const reg = spec.regs.find((r) => r.name === step.reg);
  const ops = OPS.filter((o) => o.op !== "mode" || spec.regs.some((r) => r.role === "mode4"));
  return (
    <li className={active ? "step-row active" : "step-row"}>
      <select
        className="field small"
        value={step.op}
        onChange={(e) => {
          const op = e.target.value as StepOp;
          onChange(op === "wait" ? { op, value: 500 } : { op, reg: undefined, bit: undefined, value: op === "mode" ? 0x2 : undefined });
        }}
      >
        {ops.map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </select>
      {step.op === "wait" ? (
        <label className="inline">
          <input
            className="field small ms"
            type="number"
            min={0}
            value={step.value ?? 0}
            onChange={(e) => onChange({ ...step, value: Math.max(0, Number(e.target.value)) })}
          />
          <span className="muted">ms</span>
        </label>
      ) : (
        <>
          <select className="field small" value={step.reg ?? ""} onChange={(e) => onChange({ ...step, reg: e.target.value, bit: undefined })}>
            <option value="" disabled>
              registrador
            </option>
            {writable.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
          {reg && (
            <select className="field small" value={step.bit ?? ""} onChange={(e) => onChange({ ...step, bit: Number(e.target.value) })}>
              <option value="" disabled>
                bit
              </option>
              {reg.bits.map((label, i) =>
                label ? (
                  <option key={i} value={i}>
                    {label}
                  </option>
                ) : null,
              )}
            </select>
          )}
          {step.op === "mode" && (
            <select className="field small" value={step.value ?? 0} onChange={(e) => onChange({ ...step, value: Number(e.target.value) })}>
              {STM_MODES.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
        </>
      )}
      <button className="link" onClick={onRemove} title="Remover passo">
        ×
      </button>
    </li>
  );
}

/** Registradores ao vivo e a sequência de passos (o "programa" gravado no chip). */
export function McuPanel({ part }: { part: Part }) {
  const spec = specOf(part)!;
  useSim((s) => s.mcuVersion);
  const powered = useSim((s) => s.powered);
  const st = mcuStates()[part.id];
  const steps = parseSteps(part.props.program);

  const save = (next: Step[]) => {
    const { doc, commit } = useDoc.getState();
    commit(
      produce(doc, (d) => {
        // Chip dentro de uma placa: o programa fica gravado nesta cópia da placa.
        const [inst, ...inner] = part.id.split("/");
        if (inner.length) d.parts[inst].props[`program:${inner.join("/")}`] = JSON.stringify(next);
        else d.parts[part.id].props.program = JSON.stringify(next);
      }),
    );
  };

  const live = useSim((s) => s.result?.parts[part.id]);
  return (
    <>
      <PinInternals part={part} spec={spec} st={st} live={live} />
      <section>
        <h3 className="label">Registradores</h3>
        {!powered || !st?.up ? (
          <p className="muted">
            O chip não está ligado. Registradores só existem com ele funcionando, e voltam ao valor de fábrica a cada reset.
          </p>
        ) : (
          <div className="regs">
            {spec.regs.map((r) => (
              <Register key={r.name} spec={spec} part={part} r={r} />
            ))}
          </div>
        )}
      </section>
      <section>
        <h3 className="label">Sequência (gravada no chip)</h3>
        <p className="muted">
          Passos que o chip repete sem parar enquanto está rodando, como um programa. Ficam salvos no projeto, como na memória
          flash.
        </p>
        <ol className="steps">
          {steps.map((s, i) => (
            <StepRow
              key={i}
              spec={spec}
              step={s}
              active={!!st?.running && st.pc === i}
              onChange={(next) => save(steps.map((x, k) => (k === i ? next : x)))}
              onRemove={() => save(steps.filter((_, k) => k !== i))}
            />
          ))}
        </ol>
        <button className="btn" onClick={() => save([...steps, { op: "set" }])}>
          + passo
        </button>
      </section>
    </>
  );
}
