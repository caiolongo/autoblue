import { key, onSegment, type Point } from "../../lib/geometry";
import type { PinRole } from "../library/parts";
import { registerBlocks } from "../blocks/blocks";
import { pinsOf, type Doc } from "./doc";

export interface NetPin {
  partId: string;
  ref: string;
  pin: string;
  title: string;
  role: PinRole;
}

export type NetKind = "gnd" | "power" | "signal" | "short";

export interface Net {
  id: string;
  name: string;
  kind: NetKind;
  pins: NetPin[];
  wires: string[];
}

export interface Short {
  net: Net;
  ref: string;
}

export interface Netlist {
  nets: Net[];
  /** "partId:pino" → nó */
  byPin: Map<string, Net>;
  byWire: Map<string, Net>;
  /** Pontos onde 3 ou mais conexões se encontram. */
  junctions: Point[];
  /** Pontas de fio que não tocam em nada. */
  loose: Point[];
  /** + e − da mesma fonte ligados direto. */
  shorts: Short[];
}

export const pinKey = (partId: string, pin: string) => `${partId}:${pin}`;

class UnionFind {
  private parent = new Map<string, string>();
  find(a: string): string {
    let p = this.parent.get(a) ?? a;
    if (p !== a) {
      p = this.find(p);
      this.parent.set(a, p);
    }
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * Regras de conexão (geométricas, como num esquemático):
 * - todos os pontos de um fio são o mesmo condutor;
 * - um pino e uma ponta de fio no mesmo ponto estão ligados;
 * - uma ponta de fio (ou pino) encostada no meio de outro fio cria uma junção;
 * - fios que só se cruzam, sem ponta no cruzamento, NÃO estão ligados.
 */
export function buildNetlist(doc: Doc): Netlist {
  registerBlocks(doc);
  const uf = new UnionFind();
  const wires = Object.values(doc.wires);
  const parts = Object.values(doc.parts);

  const pinsAt = new Map<string, NetPin[]>();
  const anchors = new Map<string, Point>(); // pinos e pontas de fio
  const incidence = new Map<string, number>();
  const bump = (k: string, n = 1) => incidence.set(k, (incidence.get(k) ?? 0) + n);

  for (const part of parts) {
    for (const { pin, pos } of pinsOf(part)) {
      const k = key(pos);
      const list = pinsAt.get(k) ?? [];
      list.push({ partId: part.id, ref: part.ref, pin: pin.name, title: pin.title, role: pin.role });
      pinsAt.set(k, list);
      anchors.set(k, pos);
      uf.find(k);
      bump(k);
    }
  }

  for (const w of wires) {
    const pts = w.points;
    pts.forEach((p, i) => {
      uf.union(key(p), key(pts[0]));
      bump(key(p), i === 0 || i === pts.length - 1 ? 1 : 2);
    });
    anchors.set(key(pts[0]), pts[0]);
    anchors.set(key(pts[pts.length - 1]), pts[pts.length - 1]);
  }

  // Ligações que não são fios (pino de bloco ↔ porta de dentro do bloco).
  for (const [a, b] of doc.links ?? []) uf.union(key(a), key(b));

  // Âncoras encostadas no meio de algum segmento.
  for (const w of wires) {
    const vertices = new Set(w.points.map(key));
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i];
      const b = w.points[i + 1];
      for (const [k, p] of anchors) {
        if (!onSegment(p, a, b)) continue;
        uf.union(k, key(a));
        if (!vertices.has(k)) bump(k, 2);
      }
    }
  }

  // Agrupa por raiz.
  const groups = new Map<string, { pins: NetPin[]; wires: string[] }>();
  const group = (root: string) => {
    let g = groups.get(root);
    if (!g) groups.set(root, (g = { pins: [], wires: [] }));
    return g;
  };
  for (const [k, list] of pinsAt) group(uf.find(k)).pins.push(...list);
  for (const w of wires) group(uf.find(key(w.points[0]))).wires.push(w.id);

  const nets: Net[] = [];
  const byPin = new Map<string, Net>();
  const byWire = new Map<string, Net>();
  const used = new Set<string>();
  const shorts: Short[] = [];
  let anon = 0;

  const hintOf = (p: NetPin) => {
    const part = doc.parts[p.partId];
    return pinsOf(part).find((x) => x.pin.name === p.pin)?.pin.net;
  };

  for (const g of groups.values()) {
    const hints = [...new Set(g.pins.map(hintOf).filter((h): h is string => !!h))].sort((a, b) =>
      a === "GND" ? -1 : b === "GND" ? 1 : a.localeCompare(b),
    );
    const hasGnd = g.pins.some((p) => p.role === "gnd");
    const hasPower = g.pins.some((p) => p.role === "power_out");
    const shortedRefs = new Set(
      g.pins
        .filter((p) => p.role === "power_out")
        .filter((p) => g.pins.some((q) => q.role === "gnd" && q.partId === p.partId))
        .map((p) => p.ref),
    );
    const kind: NetKind = shortedRefs.size ? "short" : hasGnd ? "gnd" : hasPower ? "power" : "signal";

    let name = kind === "short" ? "CURTO" : (hints[0] ?? `N${++anon}`);
    if (used.has(name)) {
      let i = 2;
      while (used.has(`${name}_${i}`)) i++;
      name = `${name}_${i}`;
    }
    used.add(name);

    const net: Net = { id: name, name, kind, pins: g.pins, wires: g.wires };
    nets.push(net);
    for (const p of g.pins) byPin.set(pinKey(p.partId, p.pin), net);
    for (const w of g.wires) byWire.set(w, net);
    for (const ref of shortedRefs) shorts.push({ net, ref });
  }

  const junctions: Point[] = [];
  const loose: Point[] = [];
  for (const [k, n] of incidence) {
    const p = anchors.get(k);
    if (!p) continue;
    if (n >= 3) junctions.push(p);
    else if (n === 1 && !pinsAt.has(k)) loose.push(p);
  }

  nets.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name, "pt-BR", { numeric: true }));
  return { nets, byPin, byWire, junctions, loose, shorts };
}

const order = (n: Net) => ({ short: 0, gnd: 1, power: 2, signal: 3 })[n.kind];

const cache = new WeakMap<Doc, Netlist>();

/** Netlist memorizada por versão do documento (o documento é imutável). */
export function getNetlist(doc: Doc): Netlist {
  let n = cache.get(doc);
  if (!n) cache.set(doc, (n = buildNetlist(doc)));
  return n;
}
