import type { Doc } from "../features/editor/doc";
import { pinKey, type Netlist } from "../features/editor/netlist";
import { PARTS } from "../features/library/parts";
import type { SimResult } from "./simulate";

export interface EnergyRow {
  partId: string;
  ref: string;
  name: string;
  /** Watts: entregues (fontes) ou consumidos (cargas). */
  power: number;
}

/** Quem entrega e quem consome energia. A soma das duas listas deve bater (conservação). */
export function energySummary(doc: Doc, sim: SimResult) {
  const sources: EnergyRow[] = [];
  const loads: EnergyRow[] = [];
  for (const part of Object.values(doc.parts)) {
    const s = sim.parts[part.id];
    if (!s?.reading) continue;
    const row = { partId: part.id, ref: part.ref, name: PARTS[part.kind].name, power: Math.abs(s.reading.power) };
    if (s.reading.power < -1e-9) sources.push(row);
    else if (s.reading.power > 1e-9) loads.push(row);
  }
  const by = (a: EnergyRow, b: EnergyRow) => b.power - a.power;
  const total = (rows: EnergyRow[]) => rows.reduce((t, r) => t + r.power, 0);
  return { sources: sources.sort(by), loads: loads.sort(by), delivered: total(sources), consumed: total(loads) };
}

export interface PathStep {
  partId: string;
  ref: string;
  /** Pino por onde a corrente entra e sai desta peça. */
  in: string;
  out: string;
}

/**
 * Caminho da energia: de qual fonte a corrente sai, por onde passa até chegar
 * nesta peça, e por onde volta para a fonte. Segue, em cada nó, o ramo que leva
 * mais corrente.
 */
export function energyPath(doc: Doc, netlist: Netlist, sim: SimResult, partId: string): PathStep[] | null {
  const pins = (id: string) => Object.entries(sim.parts[id]?.reading?.pins ?? {});
  const step = (id: string): PathStep | null => {
    const ps = pins(id);
    if (!ps.length) return null;
    const into = ps.reduce((a, b) => (b[1].i > a[1].i ? b : a));
    const outOf = ps.reduce((a, b) => (b[1].i < a[1].i ? b : a));
    if (into[1].i < 1e-7) return null;
    return { partId: id, ref: doc.parts[id].ref, in: into[0], out: outOf[0] };
  };
  const isSource = (id: string) => (sim.parts[id]?.reading?.power ?? 0) < -1e-9;

  const self = step(partId);
  if (!self) return null;
  const chain: PathStep[] = [self];
  const seen = new Set([partId]);

  // Para trás: quem empurra corrente para dentro do nó de entrada.
  let cur = self;
  while (!isSource(cur.partId) && chain.length < 12) {
    const net = netlist.byPin.get(pinKey(cur.partId, cur.in));
    const feeder = net?.pins
      .filter((p) => !seen.has(p.partId))
      .map((p) => ({ p, i: sim.parts[p.partId]?.reading?.pins[p.pin]?.i ?? 0 }))
      .filter((x) => x.i < -1e-7)
      .sort((a, b) => a.i - b.i)[0];
    const next = feeder && step(feeder.p.partId);
    if (!next) break;
    chain.unshift(next);
    seen.add(next.partId);
    cur = next;
  }

  // Para a frente: para onde vai a corrente que sai.
  cur = self;
  const start = chain[0].partId;
  while (chain.length < 24) {
    if (cur !== self && isSource(cur.partId)) break;
    const net = netlist.byPin.get(pinKey(cur.partId, cur.out));
    const sink = net?.pins
      .filter((p) => p.partId === start || !seen.has(p.partId))
      .map((p) => ({ p, i: sim.parts[p.partId]?.reading?.pins[p.pin]?.i ?? 0 }))
      .filter((x) => x.i > 1e-7 && !(x.p.partId === cur.partId && x.p.pin === cur.out))
      .sort((a, b) => b.i - a.i)[0];
    if (!sink) break;
    if (sink.p.partId === start) {
      chain.push({ ...chain[0], in: sink.p.pin, out: sink.p.pin });
      break;
    }
    const next = step(sink.p.partId);
    if (!next) break;
    chain.push(next);
    seen.add(next.partId);
    cur = next;
  }
  return chain;
}
