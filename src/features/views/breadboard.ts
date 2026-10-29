import { isBlock } from "../blocks/blocks";
import { pinsOf, type Doc, type Part } from "../editor/doc";
import { getNetlist, pinKey, type Net, type NetKind } from "../editor/netlist";
import { PARTS } from "../library/parts";

/** Furo da protoboard: coluna e linha (a–e em cima, f–j embaixo, ou um dos trilhos). */
export type Row = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "T+" | "T-" | "B+" | "B-";
export interface Hole {
  col: number;
  row: Row;
}

export interface BbLead {
  partId: string;
  ref: string;
  kind: string;
  holes: Hole[];
}

export interface BbJumper {
  a: Hole;
  b: Hole;
  net: string;
  kind: NetKind;
}

export interface BbModule {
  partId: string;
  ref: string;
  name: string;
  slot: number;
  pins: { name: string; to: Hole; net: string; kind: NetKind }[];
}

export interface BbLayout {
  cols: number;
  chips: { partId: string; ref: string; label: string; col: number; width: number }[];
  leads: BbLead[];
  jumpers: BbJumper[];
  modules: BbModule[];
  /** Nome do nó de cada furo ocupado (para destacar ao passar o mouse). */
  holeNet: Map<string, string>;
}

export const holeKey = (h: Hole) => `${h.col}:${h.row}`;

/** Peças que ficam fora da protoboard, ligadas por fios. */
const OFFBOARD = new Set(["battery9v", "cellAA", "usb5v", "benchSupply", "levelShifter"]);
const TOP_ROWS: Row[] = ["a", "b", "c", "d"];
const BOTTOM_ROWS: Row[] = ["j", "i", "h", "g"];

const isDip = (p: Part) => {
  const def = PARTS[p.kind] as { chip?: unknown; mcu?: unknown } | undefined;
  return !!(def?.chip || def?.mcu || p.kind === "flashSpi");
};

/**
 * Monta a protoboard a partir do esquema. Cada nó ganha uma tira de 5 furos (ou um trilho,
 * se for alimentação/GND); chips atravessam o canal central; peças de 2–4 pernas espetam as
 * pernas nas tiras dos seus nós; o que não cabe vira fio de ligação (jumper).
 */
export function layoutBreadboard(doc: Doc): BbLayout {
  const netlist = getNetlist(doc);
  const netOf = (part: Part, pin: string) => netlist.byPin.get(pinKey(part.id, pin))!;

  // Trilhos: GND no "−"; as duas primeiras alimentações no "+" de cima e de baixo.
  const rail = new Map<string, Row>();
  const gnd = netlist.nets.find((n) => n.kind === "gnd");
  if (gnd) rail.set(gnd.id, "T-");
  netlist.nets.filter((n) => n.kind === "power").slice(0, 2).forEach((n, i) => rail.set(n.id, i ? "B+" : "T+"));

  const holeNet = new Map<string, string>();
  const stripNet = new Map<string, string>();
  const stripUsed = new Map<string, Row[]>();
  const home = new Map<string, string>();
  const railUsed = new Set<string>();
  const jumpers: BbJumper[] = [];
  let cursor = 2;
  /** Primeira coluna das tiras dos nós (logo depois dos chips). */
  let base = 0;
  let nextStrip = 0;

  const stripOf = (h: Hole) => `${h.col}${"abcde".includes(h.row) ? "t" : "b"}`;
  const take = (h: Hole, net: Net) => {
    holeNet.set(holeKey(h), net.name);
    if (h.row.length === 2) railUsed.add(holeKey(h));
    else stripUsed.set(stripOf(h), [...(stripUsed.get(stripOf(h)) ?? []), h.row]);
    return h;
  };
  const newStrip = (net: Net) => {
    const col = base + Math.floor(nextStrip / 2);
    const id = `${col}${nextStrip % 2 ? "b" : "t"}`;
    nextStrip++;
    stripNet.set(id, net.id);
    return id;
  };
  const railHole = (row: Row, near: number, net: Net) => {
    for (let d = 0; ; d++)
      for (const c of [near + d, near - d]) if (c >= 1 && !railUsed.has(`${c}:${row}`)) return take({ col: c, row }, net);
  };
  const freeIn = (strip: string): Hole | null => {
    const col = Number(strip.slice(0, -1));
    const rows = strip.endsWith("t") ? TOP_ROWS : BOTTOM_ROWS;
    const used = stripUsed.get(strip) ?? [];
    const row = rows.find((r) => !used.includes(r));
    return row ? { col, row } : null;
  };
  /** Um furo livre ligado ao nó: no trilho, na tira dele, ou numa tira extra com jumper. */
  const holeFor = (net: Net, near: number): Hole => {
    const r = rail.get(net.id);
    if (r) return railHole(r, near, net);
    let strip = home.get(net.id);
    if (!strip) home.set(net.id, (strip = newStrip(net)));
    const free = freeIn(strip);
    if (free) return take(free, net);
    // Tira cheia: abre outra e liga as duas com um jumper.
    const extra = newStrip(net);
    const a = freeIn(strip) ?? { col: Number(strip.slice(0, -1)), row: strip.endsWith("t") ? "a" : "j" };
    const b = take(freeIn(extra)!, net);
    jumpers.push({ a, b, net: net.name, kind: net.kind });
    home.set(net.id, extra);
    return take(freeIn(extra)!, net);
  };

  // 1. Chips atravessando o canal central.
  const chips: BbLayout["chips"] = [];
  const parts = Object.values(doc.parts).sort((a, b) => a.x - b.x);
  for (const part of parts.filter(isDip)) {
    const pins = PARTS[part.kind].pins(part.props);
    const xs = [...new Set(pins.map((p) => p.x))].sort((a, b) => a - b);
    const col0 = cursor;
    for (const pin of pins) {
      const h: Hole = { col: col0 + xs.indexOf(pin.x), row: pin.y > 0 ? "f" : "e" };
      const net = netOf(part, pin.name);
      stripNet.set(stripOf(h), net.id);
      take(h, net);
      if (!home.has(net.id) && !rail.has(net.id)) home.set(net.id, stripOf(h));
    }
    chips.push({ partId: part.id, ref: part.ref, label: PARTS[part.kind].value?.(part.props) ?? part.ref, col: col0, width: xs.length });
    cursor += xs.length + 1;
  }
  base = cursor + 1;
  // Pinos de chip cujo nó mora em outro lugar: jumper até lá.
  for (const part of parts.filter(isDip)) {
    for (const { pin } of pinsOf(part)) {
      const net = netOf(part, pin.name);
      const c = chips.find((x) => x.partId === part.id)!;
      const xs = [...new Set(PARTS[part.kind].pins(part.props).map((p) => p.x))].sort((a, b) => a - b);
      const mine = `${c.col + xs.indexOf(pin.x)}${pin.y > 0 ? "b" : "t"}`;
      if (home.get(net.id) === mine) continue;
      if (net.pins.length < 2) continue;
      const from = freeIn(mine);
      if (!from) continue;
      take(from, net);
      jumpers.push({ a: from, b: holeFor(net, from.col), net: net.name, kind: net.kind });
    }
  }
  // 2. Peças de 2 a 4 pernas, espetadas nas tiras dos seus nós.
  const leads: BbLead[] = [];
  const modules: BbModule[] = [];
  for (const part of parts) {
    if (isDip(part) || part.kind === "port") continue;
    const def = PARTS[part.kind];
    if (OFFBOARD.has(part.kind) || isBlock(part)) {
      modules.push({
        partId: part.id,
        ref: part.ref,
        name: def.name,
        slot: modules.length,
        pins: def.pins(part.props).map((p) => {
          const net = netOf(part, p.name);
          return { name: p.name, to: holeFor(net, 1), net: net.name, kind: net.kind };
        }),
      });
      continue;
    }
    const near = base;
    leads.push({ partId: part.id, ref: part.ref, kind: part.kind, holes: def.pins(part.props).map((p) => holeFor(netOf(part, p.name), near)) });
  }

  const maxCol = Math.max(
    base + Math.ceil(nextStrip / 2),
    ...[...holeNet.keys()].map((k) => Number(k.split(":")[0])),
    20,
  );
  return { cols: maxCol + 2, chips, leads, jumpers, modules, holeNet };
}
