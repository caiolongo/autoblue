import type { Point, Rect } from "../../lib/geometry";
import { partBounds, pinsOf, type Doc } from "../editor/doc";
import { getNetlist, pinKey, type NetKind } from "../editor/netlist";
import { simplify } from "../editor/wires";
import { PARTS } from "../library/parts";

export type Layer = "top" | "bottom";

export interface Pad {
  x: number;
  y: number;
  net: string;
  kind: NetKind;
  /** Pad quadrado: pino 1 de chips e peças de 3+ pinos. */
  square: boolean;
}

export interface Silk {
  partId: string;
  ref: string;
  value: string;
  outline: Rect;
  /** Marca de polaridade (+ do LED/eletrolítico, faixa do diodo). */
  mark?: { x: number; y: number; text: string };
}

export interface PcbLayout {
  board: Rect;
  pads: Pad[];
  traces: { points: Point[]; layer: Layer; net: string }[];
  /** Ligações que não couberam: viram linhas tracejadas (ratsnest). */
  unrouted: { a: Point; b: Point; net: string }[];
  silk: Silk[];
}

/** Passo da grade de roteamento: meio passo de pino (0,05"). */
const STEP = 10;
const MARGIN = 60;
const BEND = 2;

/** Pino de polaridade de peças de 2 pinos. */
const POLARITY: Record<string, { pin: string; text: string }> = {
  led: { pin: "A", text: "+" },
  diode: { pin: "K", text: "|" },
  capacitor: { pin: "+", text: "+" },
};

/**
 * Placa de circuito a partir do esquema: as peças ficam onde estão no esquema, cada pino
 * vira um pad, e cada nó é ligado pela árvore mais curta entre os pads, roteada na face
 * de cima ou, se não couber, na de baixo. O que não couber nas duas fica como linha de ar.
 */
export function layoutPcb(doc: Doc): PcbLayout {
  const netlist = getNetlist(doc);
  const pads: Pad[] = [];
  const silk: Silk[] = [];
  for (const part of Object.values(doc.parts)) {
    if (part.kind === "port") continue;
    const def = PARTS[part.kind];
    const pins = pinsOf(part);
    pins.forEach(({ pin, pos }, i) => {
      const net = netlist.byPin.get(pinKey(part.id, pin.name))!;
      pads.push({ x: pos.x, y: pos.y, net: net.id, kind: net.kind, square: i === 0 && pins.length >= 3 });
    });
    const pol = POLARITY[part.kind];
    const polPin = pol && pins.find((p) => p.pin.name === pol.pin);
    silk.push({
      partId: part.id,
      ref: part.ref,
      value: def.value?.(part.props) ?? "",
      outline: partBounds(part),
      mark: polPin ? { x: polPin.pos.x, y: polPin.pos.y - 14, text: pol.text } : undefined,
    });
  }

  const xs = pads.map((p) => p.x);
  const ys = pads.map((p) => p.y);
  const outlines = silk.map((s) => s.outline);
  // Alinhado à grade de roteamento, para os pads caírem exatamente nas células.
  const minX = Math.floor((Math.min(...xs, ...outlines.map((o) => o.x)) - MARGIN) / STEP) * STEP;
  const minY = Math.floor((Math.min(...ys, ...outlines.map((o) => o.y)) - MARGIN) / STEP) * STEP;
  const maxX = Math.max(...xs, ...outlines.map((o) => o.x + o.w)) + MARGIN;
  const maxY = Math.max(...ys, ...outlines.map((o) => o.y + o.h)) + MARGIN;
  const board = pads.length ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : { x: 0, y: 0, w: 200, h: 120 };

  // Grade de roteamento: cada célula guarda o nó que a ocupa, por face.
  const W = Math.floor(board.w / STEP) + 1;
  const H = Math.floor(board.h / STEP) + 1;
  const cell = (p: Point) => Math.round((p.y - board.y) / STEP) * W + Math.round((p.x - board.x) / STEP);
  const occ: Record<Layer, (string | null)[]> = { top: Array(W * H).fill(null), bottom: Array(W * H).fill(null) };
  // Folga: as 4 células em volta de cada pad ficam proibidas para outros nós ("*" = vizinha de dois nós).
  const halo: (string | null)[] = Array(W * H).fill(null);
  for (const p of pads) {
    const c = cell(p);
    occ.top[c] = p.net;
    occ.bottom[c] = p.net;
    for (const n of [c + 1, c - 1, c + W, c - W]) {
      if (n < 0 || n >= W * H) continue;
      halo[n] = halo[n] === null || halo[n] === p.net ? p.net : "*";
    }
  }

  const route = (a: Point, b: Point, net: string, layer: Layer): Point[] | null => {
    const grid = occ[layer];
    const start = cell(a);
    const goal = cell(b);
    const N = W * H * 5;
    const cost = new Float64Array(N).fill(Infinity);
    const from = new Int32Array(N).fill(-1);
    const open: [number, number][] = [];
    const gx = goal % W;
    const gy = Math.floor(goal / W);
    const h = (c: number) => Math.abs((c % W) - gx) + Math.abs(Math.floor(c / W) - gy);
    const push = (f: number, s: number) => {
      open.push([f, s]);
      let i = open.length - 1;
      while (i > 0 && open[(i - 1) >> 1][0] > open[i][0]) {
        [open[i], open[(i - 1) >> 1]] = [open[(i - 1) >> 1], open[i]];
        i = (i - 1) >> 1;
      }
    };
    const pop = () => {
      const top = open[0];
      const last = open.pop()!;
      if (open.length) {
        open[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < open.length && open[l][0] < open[m][0]) m = l;
          if (r < open.length && open[r][0] < open[m][0]) m = r;
          if (m === i) break;
          [open[i], open[m]] = [open[m], open[i]];
          i = m;
        }
      }
      return top;
    };
    cost[start * 5 + 4] = 0;
    push(h(start), start * 5 + 4);
    const D = [1, -1, W, -W];
    let found = -1;
    while (open.length) {
      const [, s] = pop();
      const c = Math.floor(s / 5);
      const dir = s % 5;
      if (c === goal) {
        found = s;
        break;
      }
      for (let d = 0; d < 4; d++) {
        const n = c + D[d];
        if (n < 0 || n >= W * H || (d < 2 && Math.floor(n / W) !== Math.floor(c / W))) continue;
        if (grid[n] !== null && grid[n] !== net) continue;
        if (halo[n] !== null && halo[n] !== net && n !== goal) continue;
        const ns = n * 5 + d;
        const g = cost[s] + 1 + (dir !== 4 && dir !== d ? BEND : 0);
        if (g < cost[ns]) {
          cost[ns] = g;
          from[ns] = s;
          push(g + h(n), ns);
        }
      }
    }
    if (found < 0) return null;
    const path: Point[] = [];
    for (let s = found; s >= 0; s = from[s]) {
      const c = Math.floor(s / 5);
      path.push({ x: board.x + (c % W) * STEP, y: board.y + Math.floor(c / W) * STEP });
      grid[c] = net;
    }
    return simplify(path.reverse());
  };

  // Árvore mínima (Prim, distância de Manhattan) por nó; ligações mais curtas primeiro.
  const edges: { a: Pad; b: Pad; len: number }[] = [];
  const byNet = new Map<string, Pad[]>();
  for (const p of pads) byNet.set(p.net, [...(byNet.get(p.net) ?? []), p]);
  for (const list of byNet.values()) {
    if (list.length < 2) continue;
    const inTree = [list[0]];
    const rest = list.slice(1);
    while (rest.length) {
      let best = { i: 0, from: inTree[0], len: Infinity };
      rest.forEach((p, i) => {
        for (const q of inTree) {
          const len = Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
          if (len < best.len) best = { i, from: q, len };
        }
      });
      const [p] = rest.splice(best.i, 1);
      inTree.push(p);
      if (best.len > 0) edges.push({ a: best.from, b: p, len: best.len });
    }
  }
  edges.sort((x, y) => x.len - y.len);

  const traces: PcbLayout["traces"] = [];
  const unrouted: PcbLayout["unrouted"] = [];
  for (const { a, b } of edges) {
    const top = route(a, b, a.net, "top");
    if (top) {
      traces.push({ points: top, layer: "top", net: a.net });
      continue;
    }
    const bottom = route(a, b, a.net, "bottom");
    if (bottom) traces.push({ points: bottom, layer: "bottom", net: a.net });
    else unrouted.push({ a, b, net: a.net });
  }
  return { board, pads, traces, unrouted, silk };
}
