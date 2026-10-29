import { useEffect, useMemo, useRef } from "react";
import { onSegment, samePoint } from "../../lib/geometry";
import { formatSI } from "../../lib/si";
import { useSim } from "../../sim/store";
import { pinsOf } from "../editor/doc";
import { useDoc } from "../editor/store";
import { measureOhms } from "./ohms";
import { netAt, PROBES, useInstruments, type MeterMode, type ProbeId } from "./store";

const MODES: { id: MeterMode; label: string; title: string }[] = [
  { id: "V", label: "V", title: "Voltímetro: diferença de tensão entre a ponta vermelha e a preta" },
  { id: "A", label: "A", title: "Alicate amperímetro: corrente no fio onde a ponta vermelha está presa" },
  { id: "Ω", label: "Ω", title: "Ohmímetro: resistência entre as pontas, com o circuito desligado" },
];

/** Um bipe curto, como o da continuidade de um multímetro. */
function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 2400;
    gain.gain.value = 0.04;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => ctx.close();
  } catch {
    // sem áudio disponível
  }
}

export function ProbeButton({ id }: { id: ProbeId }) {
  const { probes, placing, setPlacing, setProbe } = useInstruments();
  const doc = useDoc((s) => s.doc);
  const p = probes[id];
  const net = p ? netAt(doc, p) : null;
  const where = placing === id ? "clique no circuito…" : !p ? "não colocada" : net ? net.name : "solta";
  return (
    <div className="probe-row">
      <i className="probe-dot" style={{ background: PROBES[id].color }} />
      <span>{PROBES[id].title}</span>
      <span className="mono muted">{where}</span>
      <button className="link" onClick={() => setPlacing(placing === id ? null : id)}>
        {p ? "mover" : "colocar"}
      </button>
      {p && (
        <button className="link" onClick={() => setProbe(id, null)}>
          tirar
        </button>
      )}
    </div>
  );
}

export function Multimeter() {
  const { meter, setMeter, probes } = useInstruments();
  const doc = useDoc((s) => s.doc);
  const { result, powered, pressed } = useSim();
  const red = probes.red ? netAt(doc, probes.red) : null;
  const black = probes.black ? netAt(doc, probes.black) : null;

  const ohms = useMemo(() => {
    if (meter !== "Ω" || !red) return null;
    const ref = black ?? null;
    if (!ref) return null;
    try {
      return measureOhms(doc, pressed, red.id, ref.id);
    } catch {
      return null;
    }
  }, [meter, doc, pressed, red, black]);

  let display = "----";
  let unit = meter;
  let help = "";

  if (meter === "V") {
    if (!red) help = "Coloque a ponta vermelha num ponto do circuito. Sem a preta, a referência é o GND.";
    else if (!powered || !result?.ok) help = "Ligue a energia para medir tensão.";
    else {
      const v = (result.nets[red.id] ?? 0) - (black ? (result.nets[black.id] ?? 0) : 0);
      display = Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(2);
      unit = "V";
      help = `Tensão em ${red.name} em relação a ${black?.name ?? "GND"}.`;
    }
  } else if (meter === "A") {
    const p = probes.red;
    if (!p) help = "Prenda a ponta vermelha (o alicate) num fio ou num pino.";
    else if (!powered || !result?.ok) help = "Ligue a energia para medir corrente.";
    else {
      const edge = result.flows.find((f) => onSegment(p, f.a, f.b));
      const pin = Object.values(doc.parts)
        .flatMap((part) => pinsOf(part).map((x) => ({ part, ...x })))
        .find((x) => samePoint(x.pos, p));
      const i = edge ? Math.abs(edge.i) : pin ? Math.abs(result.parts[pin.part.id]?.reading.pins[pin.pin.name]?.i ?? 0) : null;
      if (i === null) help = "A ponta vermelha não está num fio nem num pino.";
      else {
        const [num, u] = formatSI(i, "A").split(" ");
        display = num;
        unit = u as MeterMode;
        help = edge ? "Corrente passando pelo fio, sem precisar abrir o circuito." : "Corrente entrando ou saindo por este pino.";
      }
    }
  } else {
    if (!red || !black) help = "Coloque as duas pontas, uma em cada lado do que você quer medir.";
    else if (ohms === null) help = "Não foi possível medir.";
    else if (ohms === Infinity) {
      display = "OL";
      unit = "Ω";
      help = "Fora da escala: não há caminho entre as pontas (circuito aberto).";
    } else {
      const [num, u] = formatSI(ohms, "Ω").split(" ");
      display = num;
      unit = u as MeterMode;
      help = ohms < 30 ? "Continuidade: as pontas estão ligadas (bipe)." : "Resistência entre as pontas, com o circuito desligado.";
      if (powered) help += " Num multímetro de verdade, desligue a energia antes de medir resistência.";
    }
  }

  const continuity = meter === "Ω" && ohms !== null && ohms < 30;
  const was = useRef(false);
  useEffect(() => {
    if (continuity && !was.current) beep();
    was.current = continuity;
  }, [continuity]);

  return (
    <section className="instrument meter">
      <header>
        <h3 className="label">Multímetro</h3>
        <div className="segmented small">
          {MODES.map((m) => (
            <button key={m.id} aria-pressed={meter === m.id} title={m.title} onClick={() => setMeter(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </header>
      <div className={continuity ? "lcd beeping" : "lcd"}>
        <span className="mono">{display}</span>
        <small className="mono">{unit}</small>
      </div>
      <p className="muted help">{help}</p>
      <ProbeButton id="red" />
      {meter !== "A" && <ProbeButton id="black" />}
    </section>
  );
}
