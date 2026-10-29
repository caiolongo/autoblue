import type { Doc, Part } from "../features/editor/doc";
import { pinKey, type Netlist } from "../features/editor/netlist";
import { FAMILIES, type ChipDef } from "../features/library/parts/chips";
import { PARTS } from "../features/library/parts";
import { LED_COLORS } from "../features/library/parts/semis";
import type { McuDef } from "../features/library/parts/mcus";
import { SMALL_MOSFETS } from "../features/library/parts/transistors";
import type { PinDrive } from "../mcu/engine";
import type { McuSpec } from "../mcu/types";
import { num, str } from "../features/library/parts/types";
import type { SimCircuit, SimElement } from "./engine";

export const VT = 0.025852;

/** Um elemento do simulador e, para cada terminal, o pino da peça a que ele pertence. */
export interface Modeled {
  el: SimElement;
  pins: string[];
}

/** Parâmetros físicos das peças. Valores típicos de datasheet / modelos SPICE comuns. */
export const PHYS = {
  battery9v: { v: 9, r: 1.5 },
  cellAA: { v: 1.5, r: 0.15 },
  usb: { v: 5, r: 0.05, rTripped: 100, trip: 1.0, rated: 0.5 },
  benchR: 0.01,
  inductorDcr: 0.2,
  potWiper: 0.5,
  led: { n: 2, rs: 10, iRated: 0.02, iMax: 0.03, iBurn: 0.06, vReverse: 5 },
  diodes: {
    "1N4007": { is: 7.03e-9, n: 1.81, rs: 0.034, iMax: 1, vrrm: 1000 },
    "1N5819": { is: 3.17e-5, n: 1.37, rs: 0.051, iMax: 1, vrrm: 40 },
    "1N4148": { is: 2.52e-9, n: 1.75, rs: 0.568, iMax: 0.2, vrrm: 100 },
  } as Record<string, { is: number; n: number; rs: number; iMax: number; vrrm: number }>,
  bjts: {
    "2N2222A": { is: 1.4e-14, bf: 200, br: 3, icMax: 0.6, pMax: 0.625, vceo: 40 },
    "2N3904": { is: 6.7e-15, bf: 250, br: 0.7, icMax: 0.2, pMax: 0.625, vceo: 40 },
    BC547: { is: 1.8e-14, bf: 300, br: 8, icMax: 0.1, pMax: 0.5, vceo: 45 },
  } as Record<string, { is: number; bf: number; br: number; icMax: number; pMax: number; vceo: number }>,
  mosfets: {
    IRLZ44N: { k: 13, vth: 1.5, idMax: 47, vdsMax: 55, vgsMax: 20, pWarn: 1, pBurn: 4 },
    IRF540N: { k: 3.2, vth: 3, idMax: 33, vdsMax: 100, vgsMax: 20, pWarn: 1, pBurn: 4 },
  } as Record<string, { k: number; vth: number; idMax: number; vdsMax: number; vgsMax: number; pWarn: number; pBurn: number }>,
  bodyDiode: { is: 1e-12, n: 1, rs: 0.01 },
  pnps: {
    "2N3906": { is: 1.4e-14, bf: 200, br: 4, icMax: 0.2, pMax: 0.625, vceo: 40 },
    BC557: { is: 1e-14, bf: 250, br: 6, icMax: 0.1, pMax: 0.5, vceo: 45 },
  } as Record<string, { is: number; bf: number; br: number; icMax: number; pMax: number; vceo: number }>,
  smallMosfets: {
    "2N7000": { k: 0.1, vth: 2.1, idMax: 0.2, pMax: 0.4, vdsMax: 60, vgsMax: 20 },
    BS250: { k: 0.01, vth: 2.4, idMax: 0.18, pMax: 0.83, vdsMax: 45, vgsMax: 20 },
  } as Record<string, { k: number; vth: number; idMax: number; pMax: number; vdsMax: number; vgsMax: number }>,
  /** Diodos de proteção das entradas dos chips. Sem resistência série: evita um nó interno por entrada. */
  clamp: { is: 1e-12, n: 1, rs: 0 },
  /** Contato fechado de botões e chaves; pernas ligadas por dentro. */
  contact: 0.05,
  internal: 0.01,
  /** Resistência do filamento por corrente nominal; queima instantânea e tempo de sobrecarga. */
  fuses: {
    r: { "0.5": 0.25, "1": 0.1, "2": 0.05, "5": 0.02 } as Record<string, number>,
    F: { instant: 2, seconds: 0.1 },
    T: { instant: 10, seconds: 2 },
  } as const,
  regulators: {
    reg7805: { vref: 5, dropout: 2, iq: 0.005, ilim: 1.5, rout: 0.05, vinMax: 35, pWarn: 1, pTrip: { none: 2, small: 6 } },
    ams1117: { vref: 3.3, dropout: 1.1, iq: 0.005, ilim: 1, rout: 0.05, vinMax: 15, pWarn: 0.6, pTrip: { none: 1.2, small: 1.2 } },
  } as Record<string, { vref: number; dropout: number; iq: number; ilim: number; rout: number; vinMax: number; pWarn: number; pTrip: Record<string, number> }>,
};

export function ledIs(vf: number) {
  const { n, rs, iRated } = PHYS.led;
  return iRated / Math.exp((vf - iRated * rs) / (n * VT));
}

/** Desvio pequeno e fixo no limiar de cada porta (±1%), como entre chips de verdade. */
function skewOf(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 201) - 100) / 10_000;
}

/** Fração da trilha entre os pinos 1 e 2 do potenciômetro. */
export function potFraction(p: Part["props"]) {
  const pos = Math.min(Math.max(num(p, "position") / 100, 0), 1);
  return str(p, "taper") === "A" ? (10 ** (2 * pos) - 1) / 99 : pos;
}

type Node = (pin: string) => number;

/** Entre quais pinos a peça fica em curto quando queima assim. */
const SHORT_PINS: Record<string, [string, string]> = {
  npn: ["C", "E"],
  pnp: ["C", "E"],
  mosfet: ["D", "S"],
  mosfetSmall: ["D", "S"],
  diode: ["A", "K"],
};

/** O que um microcontrolador está fazendo neste quadro: pinos e consumo (A). */
export interface McuDrive {
  pins: Record<string, PinDrive>;
  load: number;
}

/**
 * Modelo elétrico de cada tipo de peça. `tripped` = proteção interna atuando
 * (fusível do USB, proteção térmica do regulador); `pressed` = botão apertado.
 */
function model(part: Part, n: Node, tripped: boolean, pressed: boolean, mcu?: McuDrive): Modeled[] {
  const id = part.id;
  const p = part.props;
  const two = (el: SimElement, a: string, b: string): Modeled => ({ el, pins: [a, b] });

  if (part.damage?.mode === "open") return [];
  if (part.damage?.mode === "short") {
    const [a, b] = SHORT_PINS[part.kind] ?? ["1", "2"];
    return [two({ type: "resistor", id, a: n(a), b: n(b), r: 0.05 }, a, b)];
  }

  switch (part.kind) {
    case "battery9v":
    case "cellAA": {
      const { v, r } = PHYS[part.kind];
      return [two({ type: "source", id, p: n("+"), n: n("-"), v, r }, "+", "-")];
    }
    case "usb5v": {
      const r = tripped ? PHYS.usb.rTripped : PHYS.usb.r;
      return [two({ type: "source", id, p: n("VBUS"), n: n("GND"), v: PHYS.usb.v, r }, "VBUS", "GND")];
    }
    case "benchSupply":
      return [
        two(
          { type: "supply", id, p: n("+"), n: n("-"), v: num(p, "voltage"), r: PHYS.benchR, ilim: num(p, "current") },
          "+",
          "-",
        ),
      ];
    case "resistor":
      return [two({ type: "resistor", id, a: n("1"), b: n("2"), r: num(p, "resistance") }, "1", "2")];
    case "potentiometer": {
      const r = num(p, "resistance");
      const f = potFraction(p);
      const w = PHYS.potWiper;
      return [
        two({ type: "resistor", id: `${id}#a`, a: n("1"), b: n("2"), r: r * f + w }, "1", "2"),
        two({ type: "resistor", id: `${id}#b`, a: n("2"), b: n("3"), r: r * (1 - f) + w }, "2", "3"),
      ];
    }
    case "capacitor": {
      const [a, b] = str(p, "type") === "electrolytic" ? ["+", "-"] : ["1", "2"];
      return [two({ type: "capacitor", id, a: n(a), b: n(b), c: num(p, "capacitance") }, a, b)];
    }
    case "inductor":
      return [
        two({ type: "inductor", id, a: n("1"), b: n("2"), l: num(p, "inductance"), rs: PHYS.inductorDcr }, "1", "2"),
      ];
    case "pushButton": {
      const out = [
        two({ type: "resistor", id: `${id}#12`, a: n("1"), b: n("2"), r: PHYS.internal }, "1", "2"),
        two({ type: "resistor", id: `${id}#34`, a: n("3"), b: n("4"), r: PHYS.internal }, "3", "4"),
      ];
      if (pressed) out.push(two({ type: "resistor", id, a: n("1"), b: n("3"), r: PHYS.contact }, "1", "3"));
      return out;
    }
    case "slideSwitch": {
      const side = str(p, "position");
      return [two({ type: "resistor", id, a: n("C"), b: n(side), r: PHYS.contact }, "C", side)];
    }
    case "fuse":
      return [two({ type: "resistor", id, a: n("1"), b: n("2"), r: PHYS.fuses.r[str(p, "rating")] }, "1", "2")];
    case "reg7805":
    case "ams1117": {
      const g = PHYS.regulators[part.kind];
      return [
        {
          el: {
            type: "regulator",
            id,
            in: n("IN"),
            gnd: n("GND"),
            out: n("OUT"),
            vref: g.vref,
            dropout: g.dropout,
            iq: g.iq,
            ilim: tripped ? 0 : g.ilim,
            rout: g.rout,
          },
          pins: ["IN", "GND", "OUT"],
        },
      ];
    }
    case "led": {
      const vf = LED_COLORS[str(p, "color")].vf;
      const { n: ideality, rs } = PHYS.led;
      return [two({ type: "diode", id, a: n("A"), k: n("K"), is: ledIs(vf), n: ideality, rs }, "A", "K")];
    }
    case "diode": {
      const d = PHYS.diodes[str(p, "model")];
      return [two({ type: "diode", id, a: n("A"), k: n("K"), is: d.is, n: d.n, rs: d.rs }, "A", "K")];
    }
    case "npn": {
      const q = PHYS.bjts[str(p, "model")];
      return [{ el: { type: "npn", id, c: n("C"), b: n("B"), e: n("E"), is: q.is, bf: q.bf, br: q.br }, pins: ["C", "B", "E"] }];
    }
    case "pnp": {
      const q = PHYS.pnps[str(p, "model")];
      return [{ el: { type: "pnp", id, c: n("C"), b: n("B"), e: n("E"), is: q.is, bf: q.bf, br: q.br }, pins: ["C", "B", "E"] }];
    }
    case "mosfetSmall": {
      const model = str(p, "model");
      const m = PHYS.smallMosfets[model];
      const pch = SMALL_MOSFETS[model].channel === "P";
      const bd = PHYS.bodyDiode;
      // O diodo interno vai de S para D no canal N, e de D para S no canal P.
      const [ba, bk] = pch ? ["D", "S"] : ["S", "D"];
      return [
        { el: { type: pch ? "pmos" : "nmos", id, d: n("D"), g: n("G"), s: n("S"), k: m.k, vth: m.vth }, pins: ["D", "G", "S"] },
        two({ type: "diode", id: `${id}#body`, a: n(ba), k: n(bk), is: bd.is, n: bd.n, rs: bd.rs }, ba, bk),
      ];
    }
    case "crystal":
      return [];
    case "flashSpi": {
      const c = PHYS.clamp;
      return [
        two({ type: "resistor", id: `${id}#load`, a: n("VCC"), b: n("GND"), r: 660 }, "VCC", "GND"),
        ...["CS", "DI", "CLK", "WP", "HOLD"].flatMap((pin) => [
          two({ type: "diode", id: `${id}#cv${pin}`, a: n(pin), k: n("VCC"), is: c.is, n: c.n, rs: 0 }, pin, "VCC"),
          two({ type: "diode", id: `${id}#cg${pin}`, a: n("GND"), k: n(pin), is: c.is, n: c.n, rs: 0 }, "GND", pin),
        ]),
      ];
    }
    case "levelShifter":
      return ["1", "2"].flatMap((ch) => {
        const [lo, hi] = [`LV${ch}`, `HV${ch}`];
        const bd = PHYS.bodyDiode;
        return [
          { el: { type: "nmos", id: `${id}#q${ch}`, d: n(hi), g: n("LV"), s: n(lo), k: 0.3, vth: 1.3 }, pins: [hi, "LV", lo] },
          two({ type: "diode", id: `${id}#bd${ch}`, a: n(lo), k: n(hi), is: bd.is, n: bd.n, rs: bd.rs }, lo, hi),
          two({ type: "resistor", id: `${id}#rl${ch}`, a: n("LV"), b: n(lo), r: 10_000 }, "LV", lo),
          two({ type: "resistor", id: `${id}#rh${ch}`, a: n("HV"), b: n(hi), r: 10_000 }, "HV", hi),
        ] as Modeled[];
      });
    case "ne555": {
      const pins = ["GND", "TRIG", "OUT", "RESET", "CTRL", "THRES", "DIS", "VCC"];
      const [gnd, trig, out, reset, ctrl, thresh, dis, vcc] = pins.map(n);
      return [{ el: { type: "timer555", id, gnd, trig, out, reset, ctrl, thresh, dis, vcc }, pins }];
    }
    case "mosfet": {
      const m = PHYS.mosfets[str(p, "model")];
      const bd = PHYS.bodyDiode;
      return [
        { el: { type: "nmos", id, d: n("D"), g: n("G"), s: n("S"), k: m.k, vth: m.vth }, pins: ["D", "G", "S"] },
        two({ type: "diode", id: `${id}#body`, a: n("S"), k: n("D"), is: bd.is, n: bd.n, rs: bd.rs }, "S", "D"),
      ];
    }
  }
  const chip = (PARTS[part.kind] as ChipDef | undefined)?.chip;
  if (chip) return chipModel(id, chip, n);
  const spec = (PARTS[part.kind] as McuDef | undefined)?.mcu;
  if (spec) return mcuModel(id, spec, n, mcu);
  return [];
}

const pair = (el: SimElement, a: string, b: string): Modeled => ({ el, pins: [a, b] });

/** Pinos que não têm diodos de proteção comuns (alimentação e núcleo). */
const POWER_PINS = new Set(["VREGIN", "VREGOUT", "DVDD", "AVCC", "GND2", "AREF"]);

/** Microcontrolador: consumo, driver/pull de cada pino e diodos de proteção. */
function mcuModel(id: string, spec: McuSpec, n: Node, drive: McuDrive | undefined): Modeled[] {
  const out: Modeled[] = [];
  const { vcc, gnd } = spec;
  const load = drive?.load ?? 0;
  out.push(pair({ type: "resistor", id: `${id}#load`, a: n(vcc), b: n(gnd), r: load > 0 ? spec.vMax / load : 1e6 }, vcc, gnd));
  if (spec.kind === "rp2040") {
    // Regulador interno: VREG_VIN (3,3 V) → VREG_VOUT (1,1 V), que precisa ir ao DVDD por fora.
    out.push(
      {
        el: { type: "regulator", id: `${id}#vreg`, in: n("VREGIN"), gnd: n(gnd), out: n("VREGOUT"), vref: 1.1, dropout: 0.3, iq: 1e-4, ilim: 0.2, rout: 0.05 },
        pins: ["VREGIN", gnd, "VREGOUT"],
      },
      pair({ type: "resistor", id: `${id}#core`, a: n("DVDD"), b: n(gnd), r: 55 }, "DVDD", gnd),
    );
  }
  const c = PHYS.clamp;
  for (const pin of spec.pins) {
    if (pin.kind === "vcc" || pin.kind === "gnd" || POWER_PINS.has(pin.name)) continue;
    out.push(pair({ type: "diode", id: `${id}#cg${pin.name}`, a: n(gnd), k: n(pin.name), is: c.is, n: c.n, rs: 0 }, gnd, pin.name));
    const top = pin.rail ?? vcc;
    if (!pin.fiveVolt) {
      out.push(pair({ type: "diode", id: `${id}#cv${pin.name}`, a: n(pin.name), k: n(top), is: c.is, n: c.n, rs: 0 }, pin.name, top));
    }
    const d = drive?.pins[pin.name];
    if (d?.drive !== undefined) {
      const rail = d.drive ? top : gnd;
      out.push(pair({ type: "resistor", id: `${id}#drv${pin.name}`, a: n(pin.name), b: n(rail), r: spec.rout }, pin.name, rail));
    } else if (d?.pull) {
      const rail = d.pull === "up" ? top : gnd;
      out.push(pair({ type: "resistor", id: `${id}#pull${pin.name}`, a: n(pin.name), b: n(rail), r: spec.rpull }, pin.name, rail));
    }
  }
  return out;
}

/** Um elemento lógico por porta/flip-flop e dois diodos de proteção por entrada. */
function chipModel(id: string, chip: ChipDef["chip"], n: Node): Modeled[] {
  const fam = FAMILIES[chip.family];
  const out: Modeled[] = chip.units.map((u, i) => ({
    el: {
      type: "logic",
      id: `${id}#u${i}`,
      kind: u.kind,
      vcc: n(fam.vcc),
      gnd: n(fam.gnd),
      ins: u.ins.map(n),
      outs: u.outs.map(n),
      rout: fam.rout,
      skew: skewOf(`${id}#u${i}`),
    },
    pins: [fam.vcc, fam.gnd, ...u.outs, ...u.ins],
  }));
  const c = PHYS.clamp;
  for (const pin of new Set(chip.units.flatMap((u) => u.ins))) {
    out.push(
      { el: { type: "diode", id: `${id}#cv${pin}`, a: n(pin), k: n(fam.vcc), is: c.is, n: c.n, rs: c.rs }, pins: [pin, fam.vcc] },
      { el: { type: "diode", id: `${id}#cg${pin}`, a: n(fam.gnd), k: n(pin), is: c.is, n: c.n, rs: c.rs }, pins: [fam.gnd, pin] },
    );
  }
  return out;
}

export interface Built {
  circuit: SimCircuit;
  /** Nó do simulador de cada nó da netlist. */
  nodeOfNet: Map<string, number>;
  /** Elementos de cada peça. */
  byPart: Map<string, Modeled[]>;
}

/**
 * Transforma o documento em circuito para o simulador. O nó 0 é o GND (se houver um);
 * os outros nós da netlist ganham índices a partir de 1.
 */
export function buildCircuit(
  doc: Doc,
  netlist: Netlist,
  damage: Record<string, Part["damage"]>,
  tripped: Set<string>,
  pressed: Set<string> = new Set(),
  mcu: Record<string, McuDrive> = {},
): Built {
  const nodeOfNet = new Map<string, number>();
  const ground = netlist.nets.find((n) => n.kind === "gnd");
  if (ground) nodeOfNet.set(ground.id, 0);
  let next = 1;
  for (const net of netlist.nets) if (!nodeOfNet.has(net.id)) nodeOfNet.set(net.id, next++);

  const prefer = netlist.nets.filter((n) => n.pins.some((p) => p.role === "gnd")).map((n) => nodeOfNet.get(n.id)!);

  const byPart = new Map<string, Modeled[]>();
  const elements: SimElement[] = [];
  for (const part of Object.values(doc.parts)) {
    const node: Node = (pin) => nodeOfNet.get(netlist.byPin.get(pinKey(part.id, pin))!.id)!;
    const effective = damage[part.id] ? { ...part, damage: damage[part.id] } : part;
    const ms = model(effective, node, tripped.has(part.id), pressed.has(part.id), mcu[part.id]);
    byPart.set(part.id, ms);
    elements.push(...ms.map((m) => m.el));
  }
  return { circuit: { nodes: next, elements, prefer_ref: prefer }, nodeOfNet, byPart };
}
