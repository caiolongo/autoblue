import { onSegment, samePoint, type Point, type Rect } from "../../lib/geometry";
import { pinAt, placeParts } from "../blocks/boards";
import { registerBlocks } from "../blocks/blocks";
import { partBounds, pinsOf, type Doc } from "../editor/doc";
import { route, simplify } from "../editor/wires";
import { GRID, snap } from "../editor/viewport";
import type { SystemSpec } from "./spec";

const on = (p: Point, w: Point[]) => w.some((_, i) => i > 0 && onSegment(p, w[i - 1], w[i]));

/** Pontos da grade ao longo de um fio. */
function gridPoints(w: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 1; i < w.length; i++) {
    const [a, b] = [w[i - 1], w[i]];
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / GRID;
    for (let k = 0; k <= n; k++) {
      out.push({ x: a.x + (Math.sign(b.x - a.x) * k * GRID), y: a.y + (Math.sign(b.y - a.y) * k * GRID) });
    }
  }
  return out;
}

/** Pontos da grade estritamente dentro do corpo de uma peça: fio nenhum passa por cima deles. */
function solidCells(r: Rect): Point[] {
  const out: Point[] = [];
  for (let y = Math.floor(r.y / GRID) + 1; y * GRID < r.y + r.h; y++)
    for (let x = Math.floor(r.x / GRID) + 1; x * GRID < r.x + r.w; x++) out.push({ x: x * GRID, y: y * GRID });
  return out;
}

/**
 * Liga os pinos de um nó em árvore: cada pino sai para o ponto mais próximo do que já está
 * ligado, formando junções em T como num esquema feito à mão. Nunca termina num ponto por
 * onde passa um fio de outro nó, porque isso ligaria os dois.
 */
function routeNet(doc: Doc, pins: Point[], nextId: () => string, rail?: Point[]) {
  const mine: Point[][] = rail ? [rail] : [];
  const tree: Point[] = rail ? gridPoints(rail) : [pins[0]];
  const left = rail ? [...pins] : pins.slice(1);
  const pinPoints = Object.values(doc.parts).flatMap((p) => pinsOf(p).map((x) => x.pos));
  const bodies = Object.values(doc.parts).map(partBounds);
  const solid = bodies.flatMap(solidCells);

  while (left.length) {
    const others = Object.values(doc.wires)
      .map((w) => w.points)
      .filter((w) => !mine.includes(w));
    const free = tree.filter((t) => !others.some((w) => on(t, w)) && !solid.some((c) => samePoint(c, t)));
    let best = { dist: Infinity, pin: 0, to: pins[0] };
    left.forEach((p, i) => {
      for (const t of free) {
        const dist = Math.abs(p.x - t.x) + Math.abs(p.y - t.y);
        if (dist < best.dist) best = { dist, pin: i, to: t };
      }
    });
    const from = left.splice(best.pin, 1)[0];
    const blocked = [...pinPoints, ...solid, ...others.flatMap((w) => [w[0], w[w.length - 1]])];
    const path = simplify(route(from, best.to, GRID, blocked, bodies, Object.values(doc.wires).map((w) => w.points)));
    const id = nextId();
    doc.wires[id] = { id, points: path };
    mine.push(path);
    tree.push(...gridPoints(path));
  }
}

/** Monta o circuito de um sistema pronto: peças nos lugares, fios roteados. */
export function buildSystem(spec: SystemSpec): Doc {
  registerBlocks({ parts: {}, wires: {} });
  const doc = placeParts(spec.parts);
  doc.system = spec.id;
  let n = 0;
  const nextId = () => `w_${spec.id}_${n++}`;
  const pinsOfNet = (net: string[]) => {
    const pins = net.map((pinRef) => pinAt(doc, pinRef, spec.id).pos);
    return pins.filter((p, i) => pins.findIndex((q) => samePoint(p, q)) === i);
  };

  // Trilhos primeiro, de ponta a ponta do circuito: os sinais cruzam por eles e, no fim, cada pino desce até o seu.
  const area = docBounds(doc);
  const rails = new Map<string[], string>();
  for (const net of spec.nets) {
    const y = net.map((pinRef) => spec.rails?.[pinRef]).find((v) => v !== undefined);
    if (y === undefined) continue;
    const id = nextId();
    doc.wires[id] = { id, points: [{ x: snap(area.x) - 4 * GRID, y: y * GRID }, { x: snap(area.x + area.w) + 4 * GRID, y: y * GRID }] };
    rails.set(net, id);
  }
  for (const net of spec.nets) if (!rails.has(net)) routeNet(doc, pinsOfNet(net), nextId);
  for (const [net, id] of rails) {
    routeNet(doc, pinsOfNet(net), nextId, doc.wires[id].points);
    // O trilho termina no último pino que desce nele, sem ponta solta.
    const rail = doc.wires[id].points;
    const y = rail[0].y;
    const stops = Object.values(doc.wires)
      .filter((w) => w.id !== id)
      .flatMap((w) => [w.points[0], w.points[w.points.length - 1]])
      .filter((p) => p.y === y && onSegment(p, rail[0], rail[1]));
    doc.wires[id].points = [{ x: Math.min(...stops.map((p) => p.x)), y }, { x: Math.max(...stops.map((p) => p.x)), y }];
  }
  return doc;
}

/** Área ocupada pelo circuito: peças e fios. */
export function docBounds(doc: Doc): Rect {
  const rects = Object.values(doc.parts).map(partBounds);
  const pts = Object.values(doc.wires).flatMap((w) => w.points);
  const x1 = Math.min(...rects.map((r) => r.x), ...pts.map((p) => p.x));
  const y1 = Math.min(...rects.map((r) => r.y), ...pts.map((p) => p.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w), ...pts.map((p) => p.x));
  const y2 = Math.max(...rects.map((r) => r.y + r.h), ...pts.map((p) => p.y));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
