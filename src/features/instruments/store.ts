import { create } from "zustand";
import { onSegment, samePoint, type Point } from "../../lib/geometry";
import { flattenDoc } from "../blocks/blocks";
import { pinsOf, type Doc } from "../editor/doc";
import { getNetlist, pinKey, type Net } from "../editor/netlist";

/** Ponta vermelha e preta do multímetro; canais 1 e 2 do osciloscópio. */
export type ProbeId = "red" | "black" | "ch1" | "ch2";
export type MeterMode = "V" | "A" | "Ω";

export const PROBES: Record<ProbeId, { label: string; title: string; color: string }> = {
  red: { label: "V", title: "Ponta vermelha", color: "#ff3b2f" },
  black: { label: "COM", title: "Ponta preta (COM)", color: "var(--probe-black)" },
  ch1: { label: "1", title: "Canal 1", color: "var(--e-warn)" },
  ch2: { label: "2", title: "Canal 2", color: "var(--brand-2)" },
};

/** Base de tempo (s por divisão) e escala vertical (V por divisão; 0 = automática). */
export const TIME_DIVS = [100e-6, 1e-3, 10e-3, 100e-3, 1];
export const VOLT_DIVS = [0, 0.1, 0.2, 0.5, 1, 2, 5];

interface InstrState {
  probes: Partial<Record<ProbeId, Point>>;
  /** Ponta "na mão", esperando um clique no circuito. */
  placing: ProbeId | null;
  meter: MeterMode;
  timeDiv: number;
  voltDiv: number;
  setProbe: (id: ProbeId, p: Point | null) => void;
  setPlacing: (id: ProbeId | null) => void;
  setMeter: (m: MeterMode) => void;
  setTimeDiv: (s: number) => void;
  setVoltDiv: (v: number) => void;
}

export const useInstruments = create<InstrState>((set) => ({
  probes: {},
  placing: null,
  meter: "V",
  timeDiv: 100e-3,
  voltDiv: 0,
  setProbe: (id, p) =>
    set((s) => {
      const probes = { ...s.probes };
      if (p) probes[id] = p;
      else delete probes[id];
      return { probes };
    }),
  setPlacing: (placing) => set({ placing }),
  setMeter: (meter) => set({ meter }),
  setTimeDiv: (timeDiv) => set({ timeDiv }),
  setVoltDiv: (voltDiv) => set({ voltDiv }),
}));

/** Nó elétrico no ponto: um pino ali, ou um fio passando por ali. */
export function netAt(original: Doc, p: Point): Net | null {
  // Mesmo documento achatado que a simulação usa: os ids dos nós batem com o resultado.
  const doc = flattenDoc(original);
  const netlist = getNetlist(doc);
  for (const part of Object.values(doc.parts)) {
    const hit = pinsOf(part).find(({ pos }) => samePoint(pos, p));
    if (hit) return netlist.byPin.get(pinKey(part.id, hit.pin.name)) ?? null;
  }
  for (const w of Object.values(doc.wires)) {
    for (let i = 0; i < w.points.length - 1; i++) {
      if (onSegment(p, w.points[i], w.points[i + 1])) return netlist.byWire.get(w.id) ?? null;
    }
  }
  return null;
}

export function probeNet(doc: Doc, id: ProbeId): Net | null {
  const p = useInstruments.getState().probes[id];
  return p ? netAt(doc, p) : null;
}
