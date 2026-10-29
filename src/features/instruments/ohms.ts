import { solve, type SimElement } from "../../sim/engine";
import { buildCircuit } from "../../sim/models";
import { flattenDoc } from "../blocks/blocks";
import type { Doc } from "../editor/doc";
import { getNetlist } from "../editor/netlist";

/** O ohmímetro é uma fonte de 3 V com 1 kΩ em série, como num multímetro de verdade. */
const METER_V = 3;
const METER_R = 1000;
/** Acima disso o visor mostra OL (fora da escala). */
export const OHMS_MAX = 40e6;

/**
 * Mede a resistência entre dois nós com o circuito desligado: as fontes viram só a
 * resistência interna delas e o multímetro injeta a própria corrente de teste.
 * Retorna Infinity quando não há caminho (OL).
 */
export function measureOhms(original: Doc, pressed: Set<string>, red: string, black: string): number {
  if (red === black) return 0;
  // Blocos (placas prontas) viram as peças de dentro, como na simulação.
  const doc = flattenDoc(original);
  const netlist = getNetlist(doc);
  const built = buildCircuit(doc, netlist, {}, new Set(), pressed);
  const off = (el: SimElement): SimElement | null => {
    if (el.type === "source" || el.type === "supply") return { type: "resistor", id: el.id, a: el.p, b: el.n, r: el.r };
    if (el.type === "regulator") return null;
    return el;
  };
  const p = built.nodeOfNet.get(red)!;
  const n = built.nodeOfNet.get(black)!;
  const elements = built.circuit.elements.map(off).filter((e): e is SimElement => e !== null);
  elements.push({ type: "source", id: "__meter", p, n, v: METER_V, r: METER_R });
  const sol = solve({ ...built.circuit, elements });
  const v = sol.voltages[p] - sol.voltages[n];
  if (v >= METER_V * 0.99999) return Infinity;
  const r = (v * METER_R) / (METER_V - v);
  return r > OHMS_MAX ? Infinity : Math.max(r, 0);
}
