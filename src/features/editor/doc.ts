import { produce } from "immer";
import { key, rotatePoint, type Point, type Rect } from "../../lib/geometry";
import { defaultProps, PARTS, type PinDef, type Props } from "../library/parts";
import { followEndpoints, simplify } from "./wires";

/** Peça danificada pela simulação: virou circuito aberto ou curto. */
export interface Damage {
  mode: "open" | "short";
  reason: string;
}

export interface Part {
  id: string;
  kind: string;
  /** Designador impresso: R1, D2, BT1… */
  ref: string;
  x: number;
  y: number;
  /** Passos de 90° no sentido horário. */
  rot: number;
  flip: boolean;
  props: Props;
  damage?: Damage;
  /** Bloco: peças de dentro que queimaram (por id interno). */
  inner?: Record<string, Damage>;
}

export interface Wire {
  id: string;
  points: Point[];
}

/** Bloco feito pelo usuário: um pedaço de circuito com pinos, reutilizável como peça. */
export interface BlockDef {
  id: string;
  name: string;
  parts: Record<string, Part>;
  wires: Record<string, Wire>;
  /** Pinos do bloco, cada um ligado a um "Pino do bloco" (port) de dentro. */
  pins: { name: string; port: string }[];
  /** Placas prontas: desenhadas como placa (cor, texto) e com descrição própria. */
  board?: { color: string; summary: string };
}

export interface Doc {
  parts: Record<string, Part>;
  wires: Record<string, Wire>;
  blocks?: Record<string, BlockDef>;
  /** Só no documento "achatado" da simulação: ligações extras entre pontos (pino do bloco ↔ porta de dentro). */
  links?: [Point, Point][];
}

export const emptyDoc = (): Doc => ({ parts: {}, wires: {} });

let seq = 0;
export const newId = (prefix: "p" | "w") => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}`;

export const isWireId = (id: string) => id.startsWith("w_");

export function toWorld(part: Pick<Part, "x" | "y" | "rot" | "flip">, p: Point): Point {
  const r = rotatePoint(p, part.rot, part.flip);
  return { x: r.x + part.x, y: r.y + part.y };
}

export function partTransform(part: Pick<Part, "x" | "y" | "rot" | "flip">): string {
  return `translate(${part.x} ${part.y}) rotate(${part.rot * 90}) scale(${part.flip ? -1 : 1} 1)`;
}

export function pinsOf(part: Part): { pin: PinDef; pos: Point }[] {
  return PARTS[part.kind].pins(part.props).map((pin) => ({ pin, pos: toWorld(part, pin) }));
}

export function partBounds(part: Part): Rect {
  const b = PARTS[part.kind].bounds;
  const corners = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x, y: b.y + b.h },
    { x: b.x + b.w, y: b.y + b.h },
  ].map((c) => toWorld(part, c));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function nextRef(doc: Doc, prefix: string): string {
  let max = 0;
  for (const p of Object.values(doc.parts)) {
    const m = p.ref.match(/^([A-Z]+)(\d+)$/);
    if (m && m[1] === prefix) max = Math.max(max, Number(m[2]));
  }
  return `${prefix}${max + 1}`;
}

export function addPart(doc: Doc, kind: string, at: Point, rot = 0, flip = false): [Doc, string] {
  const def = PARTS[kind];
  const id = newId("p");
  const next = produce(doc, (d) => {
    d.parts[id] = { id, kind, ref: nextRef(doc, def.prefix), x: at.x, y: at.y, rot, flip, props: defaultProps(def) };
  });
  return [next, id];
}

export function addWire(doc: Doc, points: Point[]): [Doc, string | null] {
  const pts = simplify(points);
  if (pts.length < 2) return [doc, null];
  const id = newId("w");
  return [
    produce(doc, (d) => {
      d.wires[id] = { id, points: pts };
    }),
    id,
  ];
}

/** Aplica `moved` (posição antiga → nova) às pontas dos fios que não estão em `skip`. */
function followAll(d: Doc, moved: Map<string, Point>, skip: Set<string>) {
  if (moved.size === 0) return;
  for (const w of Object.values(d.wires)) {
    if (skip.has(w.id)) continue;
    const pts = followEndpoints(w.points, moved);
    if (pts) w.points = pts;
  }
}

/** Move peças e fios selecionados; fios presos a eles acompanham. */
export function moveSelection(doc: Doc, ids: string[], dx: number, dy: number): Doc {
  if (dx === 0 && dy === 0) return doc;
  const sel = new Set(ids);
  const moved = new Map<string, Point>();
  return produce(doc, (d) => {
    for (const id of sel) {
      const part = d.parts[id];
      if (part) {
        for (const { pos } of pinsOf(doc.parts[id])) moved.set(key(pos), { x: pos.x + dx, y: pos.y + dy });
        part.x += dx;
        part.y += dy;
      }
      const wire = d.wires[id];
      if (wire) {
        for (const p of [wire.points[0], wire.points[wire.points.length - 1]]) {
          moved.set(key(p), { x: p.x + dx, y: p.y + dy });
        }
        wire.points = wire.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      }
    }
    followAll(d, moved, sel);
  });
}

/** Gira/espelha peças em torno da própria origem; fios presos acompanham. */
export function transformParts(doc: Doc, ids: string[], fn: (p: Part) => Partial<Part>): Doc {
  const moved = new Map<string, Point>();
  return produce(doc, (d) => {
    for (const id of ids) {
      const part = d.parts[id];
      if (!part) continue;
      const before = pinsOf(doc.parts[id]);
      Object.assign(part, fn(doc.parts[id]));
      const after = new Map(pinsOf(part).map(({ pin, pos }) => [pin.name, pos]));
      for (const { pin, pos } of before) {
        const to = after.get(pin.name);
        if (to) moved.set(key(pos), to);
      }
    }
    followAll(d, moved, new Set());
  });
}

export function deleteIds(doc: Doc, ids: string[]): Doc {
  return produce(doc, (d) => {
    for (const id of ids) {
      delete d.parts[id];
      delete d.wires[id];
    }
  });
}

export function duplicate(doc: Doc, ids: string[], offset: Point): [Doc, string[]] {
  const created: string[] = [];
  let next = doc;
  for (const id of ids) {
    const part = doc.parts[id];
    if (part) {
      const [d, nid] = addPart(next, part.kind, { x: part.x + offset.x, y: part.y + offset.y }, part.rot, part.flip);
      next = produce(d, (dd) => {
        dd.parts[nid].props = { ...part.props };
      });
      created.push(nid);
    }
    const wire = doc.wires[id];
    if (wire) {
      const [d, wid] = addWire(
        next,
        wire.points.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y })),
      );
      next = d;
      if (wid) created.push(wid);
    }
  }
  return [next, created];
}
