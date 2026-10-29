import { key, onSegment, samePoint, type Point } from "../lib/geometry";
import { pinsOf, type Doc } from "../features/editor/doc";
import type { Netlist } from "../features/editor/netlist";

/** Trecho reto de fio com a corrente que passa por ele (positiva de `a` para `b`). */
export interface FlowEdge {
  wire: string;
  a: Point;
  b: Point;
  i: number;
}

/**
 * Distribui a corrente pelos fios. Dentro de um nó os fios não têm resistência,
 * então a corrente em cada trecho sai só da conservação (Kirchhoff): numa árvore,
 * o que atravessa um trecho é a soma do que entra/sai pelos pinos do lado de lá.
 * Laços de fio (raros) ficam com a corrente toda num caminho só.
 *
 * `pinCurrent` é a corrente entrando na peça pelo pino.
 */
export function computeFlows(doc: Doc, netlist: Netlist, pinCurrent: (partId: string, pin: string) => number): FlowEdge[] {
  const edges: FlowEdge[] = [];
  const pinPoints: { p: Point; inject: number }[] = [];
  for (const part of Object.values(doc.parts)) {
    for (const { pin, pos } of pinsOf(part)) pinPoints.push({ p: pos, inject: -pinCurrent(part.id, pin.name) });
  }

  for (const net of netlist.nets) {
    if (!net.wires.length) continue;
    const wires = net.wires.map((id) => doc.wires[id]);

    // Pontos onde um trecho precisa ser dividido: pinos e pontas de fio encostados nele.
    const anchors: Point[] = [...pinPoints.map((x) => x.p), ...wires.flatMap((w) => [w.points[0], w.points[w.points.length - 1]])];

    const local: FlowEdge[] = [];
    for (const w of wires) {
      for (let s = 0; s < w.points.length - 1; s++) {
        const a = w.points[s];
        const b = w.points[s + 1];
        const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
        const cuts = anchors
          .filter((p) => onSegment(p, a, b) && !samePoint(p, a) && !samePoint(p, b))
          .map((p) => ({ p, t: Math.abs(p.x - a.x) + Math.abs(p.y - a.y) }))
          .sort((x, y) => x.t - y.t);
        const seq = [a, ...cuts.filter((c, i) => i === 0 || c.t !== cuts[i - 1].t).map((c) => c.p), b];
        for (let k = 0; k < seq.length - 1; k++) if (len) local.push({ wire: w.id, a: seq[k], b: seq[k + 1], i: 0 });
      }
    }

    const inject = new Map<string, number>();
    for (const { p, inject: i } of pinPoints) {
      const k = key(p);
      if (local.some((e) => samePoint(e.a, p) || samePoint(e.b, p))) inject.set(k, (inject.get(k) ?? 0) + i);
    }

    const adj = new Map<string, number[]>();
    local.forEach((e, idx) => {
      for (const p of [e.a, e.b]) {
        const k = key(p);
        if (!adj.has(k)) adj.set(k, []);
        adj.get(k)!.push(idx);
      }
    });

    // Árvore geradora (BFS) e somas das subárvores, das folhas para a raiz.
    const visited = new Set<string>();
    for (const root of adj.keys()) {
      if (visited.has(root)) continue;
      visited.add(root);
      const order: string[] = [root];
      const parentEdge = new Map<string, number>();
      for (let q = 0; q < order.length; q++) {
        for (const idx of adj.get(order[q])!) {
          const e = local[idx];
          const other = key(e.a) === order[q] ? key(e.b) : key(e.a);
          if (visited.has(other)) continue;
          visited.add(other);
          parentEdge.set(other, idx);
          order.push(other);
        }
      }
      const sum = new Map<string, number>();
      for (let q = order.length - 1; q > 0; q--) {
        const k = order[q];
        const s = (sum.get(k) ?? 0) + (inject.get(k) ?? 0);
        const idx = parentEdge.get(k)!;
        const e = local[idx];
        // `s` é o que sai desta subárvore em direção ao pai.
        e.i = key(e.a) === k ? s : -s;
        const parent = key(e.a) === k ? key(e.b) : key(e.a);
        sum.set(parent, (sum.get(parent) ?? 0) + s);
      }
    }
    edges.push(...local);
  }
  return edges;
}
