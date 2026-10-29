import { useState } from "react";
import { isGpio, pinDrives, type McuState } from "../../mcu/engine";
import type { McuSpec } from "../../mcu/types";
import { A, V } from "../../sim/rules";
import type { PartSim } from "../../sim/simulate";
import type { Part } from "../editor/doc";

const ON = "var(--e-vcc)";
const OFF = "var(--line-strong)";

/** Nome do registrador (e bit) que controla cada papel deste pino. */
function regsOf(spec: McuSpec, port: string, bit: number, pin: string) {
  const find = (roles: string[]) => spec.regs.find((r) => roles.includes(r.role) && r.port === port);
  const label = (roles: string[]) => {
    const r = find(roles);
    if (!r) return null;
    return r.role === "mode4" ? `${r.name} (${pin})` : `${r.name}.${bit}`;
  };
  return { dir: label(["dir", "dirInv", "mode4"]), out: label(["out"]), inp: label(["in"]) ?? (spec.rmw ? label(["out"]) : null) };
}

/**
 * O pino por dentro: os dois MOSFETs do driver, o pull-up com a chave, os diodos de
 * proteção e o buffer de entrada, acendendo o que está conduzindo agora.
 */
export function PinInternals({ part, spec, st, live }: { part: Part; spec: McuSpec; st?: McuState; live?: PartSim }) {
  const gpios = spec.pins.filter((p) => isGpio(spec, p, part.props));
  const [sel, setSel] = useState(gpios[0]?.name ?? "");
  const pin = gpios.find((p) => p.name === sel) ?? gpios[0];
  if (!pin?.io) return null;

  const pins = live?.reading?.pins ?? {};
  const gnd = pins[spec.gnd]?.v ?? 0;
  const rail = (pins[pin.rail ?? spec.vcc]?.v ?? 0) - gnd;
  const pv = (pins[pin.name]?.v ?? 0) - gnd;
  const pi = pins[pin.name]?.i ?? 0;
  const d = st?.up ? pinDrives(spec, st, part.props)[pin.name] ?? {} : {};
  const high = d.drive === 1;
  const low = d.drive === 0;
  const pullUp = d.pull === "up";
  const pullDown = d.pull === "down";
  const clampTop = !pin.fiveVolt && pv > rail + 0.4;
  const clampBot = pv < -0.4;
  const read = rail > 0.5 && pv > rail / 2 ? 1 : 0;
  const r = regsOf(spec, pin.io.port, pin.io.bit, pin.name);

  const explain = !st?.up
    ? "Chip desligado ou em reset: os dois transistores ficam desligados e o pino fica solto (só os pulls fixos de fábrica, se houver)."
    : high
      ? `Saída em 1: o MOSFET P (de cima) conduz e liga o pino ao ${pin.rail ?? spec.vcc} por ~${spec.rout} Ω. O de baixo fica desligado.`
      : low
        ? `Saída em 0: o MOSFET N (de baixo) conduz e liga o pino ao GND. A corrente da carga entra pelo pino e desce por ele.`
        : pullUp
          ? `Entrada com pull-up: os dois transistores desligados; o resistor de ~${spec.rpull / 1000} kΩ puxa o pino para cima quando nada mais o define.`
          : pullDown
            ? `Entrada com pull-down: o resistor de ~${spec.rpull / 1000} kΩ puxa o pino para o GND.`
            : pin.openDrain && st?.up
              ? "Open-drain em 1 (ou entrada): só existe o transistor de baixo, e ele está desligado. Sem um resistor de pull-up por fora, o pino fica solto."
              : "Entrada sem pull: nada dentro do chip define a tensão. Solto, num chip de verdade ele flutua e lê qualquer coisa.";

  const wire = (on: boolean) => ({ stroke: on ? ON : OFF, strokeWidth: on ? 2.2 : 1.4, fill: "none" });

  return (
    <section>
      <h3 className="label">Por dentro do pino</h3>
      <select className="field small" value={pin.name} onChange={(e) => setSel(e.target.value)}>
        {gpios.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name} (pino {spec.pins.indexOf(p) + 1})
          </option>
        ))}
      </select>
      <svg className="pin-internals" viewBox="0 0 270 210" role="img" aria-label={`Circuito interno do pino ${pin.name}`}>
        {/* Trilhos */}
        <line x1={10} y1={18} x2={250} y2={18} {...wire(rail > 0.5)} />
        <text x={12} y={12} className="pi-txt">
          {pin.rail ?? spec.vcc} {V(rail)}
        </text>
        <line x1={10} y1={192} x2={250} y2={192} {...wire(false)} />
        <text x={12} y={205} className="pi-txt">
          GND
        </text>

        {/* MOSFET P (alto) e N (baixo) */}
        {!pin.openDrain && (
          <g>
            <line x1={170} y1={18} x2={170} y2={48} {...wire(high)} />
            <rect x={160} y={48} width={20} height={26} rx={3} {...wire(high)} />
            <text x={183} y={64} className="pi-txt">
              P
            </text>
            <line x1={170} y1={74} x2={170} y2={105} {...wire(high)} />
          </g>
        )}
        <line x1={170} y1={105} x2={170} y2={136} {...wire(low)} />
        <rect x={160} y={136} width={20} height={26} rx={3} {...wire(low)} />
        <text x={183} y={152} className="pi-txt">
          N
        </text>
        <line x1={170} y1={162} x2={170} y2={192} {...wire(low)} />

        {/* Pull-up e pull-down com chave */}
        <line x1={120} y1={18} x2={120} y2={36} {...wire(pullUp)} />
        <path d="M120 36 l5 4 l-10 6 l10 6 l-10 6 l5 4" {...wire(pullUp)} />
        <line x1={120} y1={62} x2={pullUp ? 120 : 128} y2={pullUp ? 80 : 76} {...wire(pullUp)} />
        <line x1={120} y1={80} x2={120} y2={105} {...wire(pullUp)} />
        <text x={94} y={50} className="pi-txt">
          pull-up
        </text>
        {spec.regs.some((x) => x.role === "pulldown") || pin.pull === "down" ? (
          <g>
            <line x1={120} y1={105} x2={120} y2={124} {...wire(pullDown)} />
            <line x1={120} y1={124} x2={pullDown ? 120 : 128} y2={pullDown ? 142 : 138} {...wire(pullDown)} />
            <path d="M120 142 l5 4 l-10 6 l10 6 l-10 6 l5 4" {...wire(pullDown)} />
            <line x1={120} y1={168} x2={120} y2={192} {...wire(pullDown)} />
            <text x={86} y={160} className="pi-txt">
              pull-down
            </text>
          </g>
        ) : null}

        {/* Nó interno até o pino */}
        <line x1={60} y1={105} x2={250} y2={105} {...wire(high || low || Math.abs(pi) > 1e-6)} />

        {/* Diodos de proteção */}
        {!pin.fiveVolt && (
          <g>
            <line x1={215} y1={105} x2={215} y2={60} {...wire(clampTop)} />
            <path d="M208 60 h14 l-7 -10 z" {...wire(clampTop)} />
            <line x1={208} y1={48} x2={222} y2={48} {...wire(clampTop)} />
            <line x1={215} y1={48} x2={215} y2={18} {...wire(clampTop)} />
          </g>
        )}
        <line x1={215} y1={105} x2={215} y2={150} {...wire(clampBot)} />
        <path d="M208 150 h14 l-7 -10 z" transform="rotate(180 215 145)" {...wire(clampBot)} />
        <line x1={215} y1={160} x2={215} y2={192} {...wire(clampBot)} />

        {/* Pino */}
        <rect x={244} y={96} width={18} height={18} rx={3} fill="var(--panel)" stroke="var(--text-2)" />
        <text x={253} y={128} textAnchor="middle" className="pi-txt strong">
          {pin.name}
        </text>
        <text x={253} y={90} textAnchor="middle" className="pi-txt">
          {V(pv)}
        </text>

        {/* Buffer de entrada → registrador de leitura */}
        <path d="M60 95 v20 l-18 -10 z" fill="none" stroke="var(--text-2)" strokeWidth={1.4} />
        <line x1={42} y1={105} x2={30} y2={105} stroke="var(--text-2)" strokeWidth={1.4} />
        <text x={8} y={124} className="pi-txt">
          lê {read}
        </text>

        {/* Registradores que comandam */}
        <text x={8} y={36} className="pi-txt">
          {r.dir ?? "—"}
        </text>
        <text x={8} y={48} className="pi-txt">
          {r.out ?? "—"}
        </text>
        <text x={8} y={140} className="pi-txt">
          {r.inp ?? ""}
        </text>
      </svg>
      <p className="muted">{explain}</p>
      {Math.abs(pi) > 1e-6 && (
        <p className="muted">
          Corrente no pino agora: {A(Math.abs(pi))} {pi < 0 ? "saindo" : "entrando"}.
        </p>
      )}
      {(clampTop || clampBot) && (
        <div className="note n-warn">
          O diodo de proteção {clampTop ? "de cima" : "de baixo"} está conduzindo: a tensão no pino passou {clampTop ? "do trilho de alimentação" : "abaixo do GND"}. É ele que
          queima quando a corrente é grande.
        </div>
      )}
    </section>
  );
}
