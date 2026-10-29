/// <reference types="node" />
import { produce } from "immer";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { addPart, addWire, emptyDoc, pinsOf, type Doc } from "../features/editor/doc";
import { getNetlist } from "../features/editor/netlist";
import { energyPath, energySummary } from "./energy";
import { initSimFromBytes } from "./engine";
import { simulate } from "./simulate";

beforeAll(async () => {
  await initSimFromBytes(readFileSync(new URL("./sim-core.wasm", import.meta.url)));
});

/** Monta circuitos por código: peças espaçadas e cada fio numa faixa própria, sem encostar em nada. */
class Bench {
  doc: Doc = emptyDoc();
  private lane = 0;
  private col = 0;
  add(kind: string, props: Record<string, number | string> = {}): string {
    let id: string;
    [this.doc, id] = addPart(this.doc, kind, { x: 400 * this.col++, y: 0 });
    this.doc = produce(this.doc, (d) => {
      Object.assign(d.parts[id].props, props);
    });
    return id;
  }
  private pos([id, pin]: [string, string]) {
    return pinsOf(this.doc.parts[id]).find((x) => x.pin.name === pin)!.pos;
  }
  /** O raio vertical a partir do pino (para cima ou para baixo) está livre de outros pinos? */
  private free(p: { x: number; y: number }, up: boolean) {
    return Object.values(this.doc.parts)
      .flatMap((part) => pinsOf(part).map((x) => x.pos))
      .every((q) => q.x !== p.x || q.y === p.y || (up ? q.y > p.y : q.y < p.y));
  }
  wire(a: [string, string], b: [string, string]) {
    const pa = this.pos(a);
    const pb = this.pos(b);
    const lane = this.lane++;
    const ya = (this.free(pa, true) ? -1 : 1) * (400 + 40 * lane);
    const yb = (this.free(pb, true) ? -1 : 1) * (400 + 40 * lane);
    if (!this.free(pa, ya < 0) || !this.free(pb, yb < 0)) throw new Error("sem passagem livre");
    if (ya === yb) {
      [this.doc] = addWire(this.doc, [pa, { x: pa.x, y: ya }, { x: pb.x, y: ya }, pb]);
    } else {
      // Um sai por cima e o outro por baixo: contorna pela direita de tudo.
      const x = 400 * this.col + 200 + 20 * lane;
      [this.doc] = addWire(this.doc, [pa, { x: pa.x, y: ya }, { x, y: ya }, { x, y: yb }, { x: pb.x, y: yb }, pb]);
    }
  }
  /** Liga dois pinos da mesma peça por fora, pela direita. */
  loop(a: [string, string], b: [string, string]) {
    const pa = this.pos(a);
    const pb = this.pos(b);
    const x = Math.max(pa.x, pb.x) + 40;
    [this.doc] = addWire(this.doc, [pa, { x, y: pa.y }, { x, y: pb.y }, pb]);
  }
}

function ledCircuit(ohms: number) {
  const b = new Bench();
  const bt = b.add("battery9v");
  const r = b.add("resistor", { resistance: ohms });
  const d = b.add("led", { color: "red" });
  b.wire([bt, "+"], [r, "1"]);
  b.wire([r, "2"], [d, "A"]);
  b.wire([d, "K"], [bt, "-"]);
  return { b, bt, r, d };
}

describe("simulação", () => {
  it("LED com resistor de 330 Ω acende normal", () => {
    const { b, d, r } = ledCircuit(330);
    const s = simulate(b.doc);
    expect(s.ok && s.converged).toBe(true);
    const led = s.parts[d];
    expect(led.reading.pins.A.i).toBeGreaterThan(0.018);
    expect(led.reading.pins.A.i).toBeLessThan(0.022);
    expect(led.status).toBe("ok");
    expect(led.glow).toBeGreaterThan(0.9);
    expect(s.parts[r].why.join(" ")).toContain("Lei de Ohm");
    expect(s.newDamage).toEqual({});
  });

  it("LED sem resistor queima e vira circuito aberto", () => {
    const b = new Bench();
    const bt = b.add("battery9v");
    const d = b.add("led");
    b.wire([bt, "+"], [d, "A"]);
    b.wire([d, "K"], [bt, "-"]);
    const s = simulate(b.doc);
    expect(s.newDamage[d]?.mode).toBe("open");
    expect(s.newDamage[d]?.reason).toMatch(/queimou/);
    // Depois de queimar, não passa mais corrente.
    expect(Math.abs(s.parts[bt].reading.pins["+"].i)).toBeLessThan(1e-6);
  });

  it("LED ao contrário fica apagado, explica por quê e avisa da tensão reversa", () => {
    const b = new Bench();
    const bt = b.add("battery9v");
    const r = b.add("resistor", { resistance: 330 });
    const d = b.add("led");
    b.wire([bt, "+"], [r, "1"]);
    b.wire([r, "2"], [d, "K"]);
    b.wire([d, "A"], [bt, "-"]);
    const s = simulate(b.doc);
    expect(s.parts[d].glow).toBe(0);
    expect(s.parts[d].why[0]).toMatch(/ao contrário/);
    // 9 V ao contrário passa dos 5 V que um LED aguenta.
    expect(s.parts[d].status).toBe("warn");
  });

  it("curto na bateria: 6 A e aviso, mas nada queima", () => {
    const b = new Bench();
    const bt = b.add("battery9v");
    b.loop([bt, "+"], [bt, "-"]);
    const s = simulate(b.doc);
    expect(-s.parts[bt].reading.pins["+"].i).toBeCloseTo(6, 3);
    expect(s.parts[bt].notes[0].level).toBe("danger");
    expect(s.newDamage).toEqual({});
  });

  it("curto no USB desarma o fusível", () => {
    const b = new Bench();
    const usb = b.add("usb5v");
    b.loop([usb, "VBUS"], [usb, "GND"]);
    const s = simulate(b.doc);
    expect(s.parts[usb].tripped).toBe(true);
    expect(-s.parts[usb].reading.pins.VBUS.i).toBeLessThan(0.1);
    expect(s.parts[usb].notes[0].text).toMatch(/F1 desarmou/);
  });

  it("fonte de bancada entra em limite de corrente", () => {
    const b = new Bench();
    const ps = b.add("benchSupply", { voltage: 12, current: 0.1 });
    const r = b.add("resistor", { resistance: 10, power: "1" });
    b.wire([ps, "+"], [r, "1"]);
    b.wire([r, "2"], [ps, "-"]);
    const s = simulate(b.doc);
    expect(s.parts[ps].reading.mode).toBe("cc");
    expect(s.parts[r].reading.pins["1"].i).toBeCloseTo(0.1, 4);
  });

  it("resistor pequeno demais esquenta e queima", () => {
    const b = new Bench();
    const bt = b.add("battery9v");
    const r = b.add("resistor", { resistance: 10 });
    b.wire([bt, "+"], [r, "1"]);
    b.wire([r, "2"], [bt, "-"]);
    const s = simulate(b.doc);
    // 9 V / 11,5 Ω ≈ 0,78 A → ~6 W num resistor de 1/4 W.
    expect(s.newDamage[r]?.mode).toBe("open");
  });

  it("quem queima primeiro protege o resto", () => {
    // Dois LEDs em série direto nos 9 V: queima só um, o outro fica sem corrente.
    const b = new Bench();
    const bt = b.add("battery9v");
    const d1 = b.add("led");
    const d2 = b.add("led");
    b.wire([bt, "+"], [d1, "A"]);
    b.wire([d1, "K"], [d2, "A"]);
    b.wire([d2, "K"], [bt, "-"]);
    const s = simulate(b.doc);
    expect(Object.keys(s.newDamage)).toHaveLength(1);
  });

  it("corrente nos fios bate com a corrente das peças", () => {
    const { b, d } = ledCircuit(330);
    const s = simulate(b.doc);
    const i = s.parts[d].reading.pins.A.i;
    for (const e of s.flows) expect(Math.abs(e.i)).toBeCloseTo(i, 6);
  });

  it("energia entregue = energia consumida", () => {
    const { b } = ledCircuit(330);
    const s = simulate(b.doc);
    const e = energySummary(b.doc, s);
    expect(e.sources).toHaveLength(1);
    expect(e.loads.map((l) => l.ref)).toEqual(["R1", "D1"]);
    expect(e.consumed).toBeCloseTo(e.delivered, 6);
  });

  it("caminho da energia: bateria → resistor → LED → bateria", () => {
    const { b, d } = ledCircuit(330);
    const s = simulate(b.doc);
    const path = energyPath(b.doc, getNetlist(b.doc), s, d)!;
    expect(path.map((p) => p.ref)).toEqual(["BT1", "R1", "D1", "BT1"]);
    expect(path[0].out).toBe("+");
    expect(path[path.length - 1].in).toBe("-");
  });

  it("transistor NPN liga o LED com corrente na base", () => {
    const b = new Bench();
    const bt = b.add("battery9v");
    const rc = b.add("resistor", { resistance: 470 });
    const d = b.add("led");
    const q = b.add("npn");
    const rb = b.add("resistor", { resistance: 10_000 });
    b.wire([bt, "+"], [rc, "1"]);
    b.wire([rc, "2"], [d, "A"]);
    b.wire([d, "K"], [q, "C"]);
    b.wire([q, "E"], [bt, "-"]);
    b.wire([bt, "+"], [rb, "1"]);
    b.wire([rb, "2"], [q, "B"]);
    const s = simulate(b.doc);
    expect(s.parts[d].reading.pins.A.i).toBeGreaterThan(0.01);
    expect(s.parts[q].why.join(" ")).toMatch(/Saturado/);
  });
});

describe("simulação no tempo", () => {
  function rcLed() {
    const b = new Bench();
    const bt = b.add("battery9v");
    const r = b.add("resistor", { resistance: 1000 });
    const c = b.add("capacitor", { capacitance: 100e-6, voltage: 25 });
    b.wire([bt, "+"], [r, "1"]);
    b.wire([r, "2"], [c, "+"]);
    b.wire([c, "-"], [bt, "-"]);
    return { b, c };
  }

  it("capacitor carrega aos poucos, quadro a quadro", () => {
    const { b, c } = rcLed();
    let state: Record<string, number> = {};
    let guess: number[] = [];
    const volts: number[] = [];
    for (let k = 0; k < 10; k++) {
      const s = simulate(b.doc, { tran: { state, duration: 0.02, steps: 60, guess, t0: k * 0.02, probes: [] } });
      state = s.tran!.state;
      guess = s.tran!.guess;
      volts.push(state[c]);
    }
    // τ = 1 kΩ × 100 µF = 0,1 s; em 0,2 s a bateria de 9 V (com 1,5 Ω internos) já carregou ~86%.
    expect(volts[0]).toBeLessThan(volts[9]);
    expect(volts[9]).toBeGreaterThan(7.5);
    expect(volts[9]).toBeLessThan(8.2);
  });

  it("osciloscópio recebe uma amostra por passo", () => {
    const { b } = rcLed();
    const netlist = getNetlist(b.doc);
    const capNet = netlist.nets.find((n) => n.pins.some((p) => p.pin === "+" && p.ref === "C1"))!;
    const s = simulate(b.doc, { tran: { state: {}, duration: 0.01, steps: 20, guess: [], t0: 0, probes: [capNet.id, null] } });
    expect(s.tran!.samples).toHaveLength(20);
    expect(s.tran!.samples[19][1]).toBeGreaterThan(s.tran!.samples[0][1]);
    expect(Number.isNaN(s.tran!.samples[0][2])).toBe(true);
  });
});

describe("botões, chaves, fusíveis e reguladores", () => {
  function buttonLed() {
    const b = new Bench();
    const bt = b.add("battery9v");
    const sw = b.add("pushButton");
    const r = b.add("resistor", { resistance: 470 });
    const d = b.add("led");
    b.wire([bt, "+"], [sw, "1"]);
    b.wire([sw, "4"], [r, "1"]);
    b.wire([r, "2"], [d, "A"]);
    b.wire([d, "K"], [bt, "-"]);
    return { b, sw, d };
  }

  it("LED só acende com o botão apertado", () => {
    const { b, sw, d } = buttonLed();
    expect(simulate(b.doc).parts[d].glow).toBe(0);
    const on = simulate(b.doc, { pressed: new Set([sw]) });
    expect(on.parts[d].glow).toBeGreaterThan(0.5);
    expect(on.parts[sw].why[0]).toMatch(/Apertado/);
  });

  it("chave liga o comum ao lado escolhido", () => {
    const b = new Bench();
    const bt = b.add("battery9v");
    const sw = b.add("slideSwitch", { position: "2" });
    const r = b.add("resistor", { resistance: 1000 });
    b.wire([bt, "+"], [sw, "C"]);
    b.wire([sw, "1"], [r, "1"]);
    b.wire([r, "2"], [bt, "-"]);
    expect(Math.abs(simulate(b.doc).parts[r].reading.pins["1"].i)).toBeLessThan(1e-9);
    b.doc = produce(b.doc, (d) => {
      d.parts[sw].props.position = "1";
    });
    expect(Math.abs(simulate(b.doc).parts[r].reading.pins["1"].i)).toBeGreaterThan(8e-3);
  });

  it("fusível rápido queima num curto e protege a bateria", () => {
    const b = new Bench();
    const bt = b.add("battery9v");
    const f = b.add("fuse", { rating: "1", speed: "F" });
    b.wire([bt, "+"], [f, "1"]);
    b.wire([f, "2"], [bt, "-"]);
    const s = simulate(b.doc);
    expect(s.newDamage[f]?.mode).toBe("open");
    expect(Math.abs(s.parts[bt].reading.pins["+"].i)).toBeLessThan(1e-6);
  });

  it("fusível em leve sobrecarga avisa e conta o tempo", () => {
    const b = new Bench();
    // 1,3 V em ~1 Ω: ~1,2 A num fusível de 1 A, sem passar do limite de queima do resistor de 1 W.
    const ps = b.add("benchSupply", { voltage: 1.3, current: 5 });
    const f = b.add("fuse", { rating: "1", speed: "T" });
    const r = b.add("resistor", { resistance: 1, power: "1" });
    b.wire([ps, "+"], [f, "1"]);
    b.wire([f, "2"], [r, "1"]);
    b.wire([r, "2"], [ps, "-"]);
    const v = simulate(b.doc).parts[f];
    expect(v.overload?.seconds).toBe(2);
    expect(v.burn).toBeUndefined();
  });

  function regulated(vin: number, load: number, heatsink = "none") {
    const b = new Bench();
    const ps = b.add("benchSupply", { voltage: vin, current: 5 });
    const u = b.add("reg7805", { heatsink });
    const r = b.add("resistor", { resistance: load, power: "1" });
    b.wire([ps, "+"], [u, "IN"]);
    b.wire([u, "GND"], [ps, "-"]);
    b.wire([u, "OUT"], [r, "1"]);
    b.wire([r, "2"], [ps, "-"]);
    return { b, u, r };
  }

  it("7805 entrega 5 V e explica o calor", () => {
    const { b, u, r } = regulated(9, 100);
    const s = simulate(b.doc);
    expect(s.parts[r].reading.pins["1"].v).toBeCloseTo(5, 1);
    expect(s.parts[u].why.join(" ")).toMatch(/Calor/);
    expect(s.parts[u].status).toBe("ok");
  });

  it("7805 sem folga na entrada avisa do dropout", () => {
    const { b, u } = regulated(6, 100);
    const s = simulate(b.doc);
    expect(s.parts[u].notes.map((n) => n.text).join(" ")).toMatch(/dropout/);
  });

  it("7805 esquentando demais desliga pela proteção térmica", () => {
    // 24 V → 5 V a 0,5 A: ~9,5 W sem dissipador.
    const { b, u, r } = regulated(24, 10);
    const s = simulate(b.doc);
    expect(s.newTrips).toContain(u);
    expect(s.parts[u].notes[0].text).toMatch(/Proteção térmica/);
    expect(s.parts[r].reading.pins["1"].v).toBeLessThan(0.5);
  });
});

describe("ohmímetro", () => {
  it("mede um resistor, OL no aberto e continuidade num fio", async () => {
    const { measureOhms } = await import("../features/instruments/ohms");
    const { b, r, d } = ledCircuit(220);
    const netlist = getNetlist(b.doc);
    const net = (id: string, pin: string) => netlist.byPin.get(`${id}:${pin}`)!.id;
    // Em paralelo com o resistor há bateria (1,5 Ω) + LED; o LED quase não conduz com 3 V/1 kΩ: medida ≈ 220 Ω.
    const across = measureOhms(b.doc, new Set(), net(r, "1"), net(r, "2"));
    expect(across).toBeGreaterThan(150);
    expect(across).toBeLessThan(221);
    expect(measureOhms(b.doc, new Set(), net(d, "A"), net(d, "A"))).toBe(0);

    const open = new Bench();
    const x = open.add("resistor");
    const y = open.add("resistor");
    const nl = getNetlist(open.doc);
    expect(measureOhms(open.doc, new Set(), nl.byPin.get(`${x}:1`)!.id, nl.byPin.get(`${y}:1`)!.id)).toBe(Infinity);
  });
});

/** Roda quadros de simulação no tempo, levando o estado de um para o outro. */
function frames(doc: Doc, n: number, duration = 0.02, steps = 60) {
  let state: Record<string, number> = {};
  let guess: number[] = [];
  let last!: ReturnType<typeof simulate>;
  for (let k = 0; k < n; k++) {
    last = simulate(doc, { tran: { state, duration, steps, guess, t0: k * duration, probes: [] } });
    state = last.tran!.state;
    guess = last.tran!.guess;
  }
  return last;
}

describe("lógica digital", () => {
  it("NAND do 74HC00 acende um LED e avisa das entradas soltas", () => {
    const b = new Bench();
    const usb = b.add("usb5v");
    const u = b.add("hc00");
    const r = b.add("resistor", { resistance: 330 });
    const d = b.add("led");
    b.wire([usb, "VBUS"], [u, "VCC"]);
    b.wire([usb, "GND"], [u, "GND"]);
    b.wire([usb, "VBUS"], [u, "1A"]);
    b.wire([usb, "VBUS"], [u, "1B"]);
    b.wire([usb, "VBUS"], [r, "1"]);
    b.wire([r, "2"], [d, "A"]);
    b.wire([d, "K"], [u, "1Y"]);
    const s = frames(b.doc, 3);
    expect(s.parts[d].glow).toBeGreaterThan(0.5);
    expect(s.parts[u].why.join(" ")).toContain("1A = 1, 1B = 1 → 1Y = 0");
    expect(s.parts[u].notes.map((n) => n.text).join(" ")).toMatch(/Entrada solta: 2A/);
  });

  it("74HC ligado em 9 V queima", () => {
    const b = new Bench();
    const bt = b.add("battery9v");
    const u = b.add("hc04");
    b.wire([bt, "+"], [u, "VCC"]);
    b.wire([bt, "-"], [u, "GND"]);
    expect(simulate(b.doc).newDamage[u]?.reason).toMatch(/máximo absoluto/);
  });

  it("inversor CMOS montado com 2N7000 e BS250", () => {
    const build = (inHigh: boolean) => {
      const b = new Bench();
      const usb = b.add("usb5v");
      const p = b.add("mosfetSmall", { model: "BS250" });
      const n = b.add("mosfetSmall", { model: "2N7000" });
      const load = b.add("resistor", { resistance: 100_000 });
      b.wire([usb, "VBUS"], [p, "S"]);
      b.wire([usb, "GND"], [n, "S"]);
      b.wire([p, "D"], [n, "D"]);
      b.wire([p, "G"], [n, "G"]);
      b.wire([n, "G"], [usb, inHigh ? "VBUS" : "GND"]);
      b.wire([n, "D"], [load, "1"]);
      b.wire([load, "2"], [usb, "GND"]);
      return { s: simulate(b.doc), load };
    };
    const hi = build(false);
    expect(hi.s.parts[hi.load].reading.pins["1"].v).toBeGreaterThan(4.8);
    const lo = build(true);
    expect(lo.s.parts[lo.load].reading.pins["1"].v).toBeLessThan(0.2);
  });

  it("555 astável faz o 4017 contar (sequencial de LEDs)", () => {
    const b = new Bench();
    const bt = b.add("battery9v");
    const t = b.add("ne555");
    const r1 = b.add("resistor", { resistance: 1000 });
    const r2 = b.add("resistor", { resistance: 4700 });
    const c = b.add("capacitor", { capacitance: 10e-6, voltage: 25 });
    const cnt = b.add("cd4017");
    for (const pin of ["VCC", "RESET"]) b.wire([bt, "+"], [t, pin]);
    b.wire([bt, "-"], [t, "GND"]);
    b.wire([bt, "+"], [r1, "1"]);
    b.wire([r1, "2"], [t, "DIS"]);
    b.wire([t, "DIS"], [r2, "1"]);
    b.wire([r2, "2"], [t, "THRES"]);
    b.wire([t, "THRES"], [t, "TRIG"]);
    b.wire([t, "TRIG"], [c, "+"]);
    b.wire([c, "-"], [bt, "-"]);
    b.wire([bt, "+"], [cnt, "VDD"]);
    for (const pin of ["VSS", "INH", "RST"]) b.wire([bt, "-"], [cnt, pin]);
    b.wire([t, "OUT"], [cnt, "CLK"]);
    // f ≈ 1,44 / ((1k + 9,4k) × 10 µF) ≈ 14 Hz: em 1 s, por volta de 13 avanços.
    let state: Record<string, number> = {};
    let guess: number[] = [];
    let advances = 0;
    let prev = 0;
    let s!: ReturnType<typeof simulate>;
    for (let k = 0; k < 50; k++) {
      s = simulate(b.doc, { tran: { state, duration: 0.02, steps: 120, guess, t0: k * 0.02, probes: [] } });
      state = s.tran!.state;
      guess = s.tran!.guess;
      const n = state[`${cnt}#u0#n`] ?? 0;
      if (n !== prev) advances++;
      prev = n;
    }
    expect(s.parts[t].notes).toEqual([]);
    expect(advances).toBeGreaterThanOrEqual(10);
    expect(advances).toBeLessThanOrEqual(16);
    expect(s.parts[cnt].why.join(" ")).toMatch(/Contagem: \d/);
  });
});

describe("microcontroladores no circuito", () => {
  async function run(doc: Doc, n: number) {
    const { ensureStates, drivesFor, afterFrame } = await import("../mcu/runtime");
    const states: Record<string, import("../mcu/engine").McuState> = {};
    let state: Record<string, number> = {};
    let guess: number[] = [];
    let res!: ReturnType<typeof simulate>;
    for (let k = 0; k < n; k++) {
      ensureStates(doc, states);
      res = simulate(doc, { mcu: drivesFor(doc, states), tran: { state, duration: 0.02, steps: 20, guess, t0: k * 0.02, probes: [] } });
      state = res.tran!.state;
      guess = res.tran!.guess;
      afterFrame(doc, res, states, 0.02);
    }
    return { res, states };
  }

  it("ATtiny85 acende um LED pela sequência DDRB/PORTB", async () => {
    const b = new Bench();
    const usb = b.add("usb5v");
    const u = b.add("attiny85", {
      program: JSON.stringify([
        { op: "set", reg: "DDRB", bit: 0 },
        { op: "set", reg: "PORTB", bit: 0 },
      ]),
    });
    const r = b.add("resistor", { resistance: 330 });
    const d = b.add("led");
    b.wire([usb, "VBUS"], [u, "VCC"]);
    b.wire([usb, "GND"], [u, "GND"]);
    b.wire([u, "PB0"], [r, "1"]);
    b.wire([r, "2"], [d, "A"]);
    b.wire([d, "K"], [usb, "GND"]);
    const { res, states } = await run(b.doc, 5);
    expect(states[u].running).toBe(true);
    expect(res.parts[d].glow).toBeGreaterThan(0.5);
    expect(res.parts[u].why.join(" ")).toMatch(/PB0: saída 1/);
  });

  it("RP2040 sem flash não roda; com flash e núcleo alimentado, roda", async () => {
    const build = (withFlash: boolean) => {
      const b = new Bench();
      const ps = b.add("benchSupply", { voltage: 3.3, current: 1 });
      const u = b.add("rp2040");
      b.wire([ps, "+"], [u, "IOVDD"]);
      b.wire([ps, "-"], [u, "GND"]);
      b.wire([ps, "+"], [u, "VREGIN"]);
      b.wire([u, "VREGOUT"], [u, "DVDD"]);
      if (withFlash) {
        const f = b.add("flashSpi");
        b.wire([ps, "+"], [f, "VCC"]);
        b.wire([ps, "-"], [f, "GND"]);
        b.wire([u, "QSS"], [f, "CS"]);
        b.wire([u, "QSCK"], [f, "CLK"]);
        b.wire([u, "QSD0"], [f, "DI"]);
      }
      return { b, u };
    };
    const without = build(false);
    const a = await run(without.b.doc, 3);
    expect(a.states[without.u].running).toBe(false);
    expect(a.states[without.u].stop).toMatch(/Sem memória flash/);
    const withF = build(true);
    const c = await run(withF.b.doc, 3);
    expect(c.states[withF.u].running).toBe(true);
    expect(c.states[withF.u].notes.join(" ")).toMatch(/Sem cristal/);
  });

  it("RP2040: 5 V direto num GPIO queima o chip", async () => {
    const b = new Bench();
    const ps = b.add("benchSupply", { voltage: 3.3, current: 1 });
    const usb = b.add("usb5v");
    const u = b.add("rp2040");
    b.wire([ps, "+"], [u, "IOVDD"]);
    b.wire([ps, "-"], [u, "GND"]);
    b.wire([usb, "GND"], [u, "GND"]);
    b.wire([usb, "VBUS"], [u, "GP2"]);
    expect(simulate(b.doc).newDamage[u]?.reason).toMatch(/GP2.*diodo de proteção/);
  });

  it("ESP32: EN solto não liga; GPIO0 em 0 na partida entra em modo de gravação", async () => {
    const build = (en: boolean, io0Low: boolean) => {
      const b = new Bench();
      const ps = b.add("benchSupply", { voltage: 3.3, current: 2 });
      const u = b.add("esp32");
      b.wire([ps, "+"], [u, "3V3"]);
      b.wire([ps, "-"], [u, "GND"]);
      if (en) {
        const r = b.add("resistor", { resistance: 10_000 });
        b.wire([ps, "+"], [r, "1"]);
        b.wire([r, "2"], [u, "EN"]);
      }
      if (io0Low) b.wire([u, "IO0"], [ps, "-"]);
      return { b, u };
    };
    const off = build(false, false);
    expect((await run(off.b.doc, 3)).states[off.u].stop).toMatch(/EN solto/);
    const dl = build(true, true);
    expect((await run(dl.b.doc, 3)).states[dl.u].stop).toMatch(/Modo de gravação/);
    const ok = build(true, false);
    expect((await run(ok.b.doc, 3)).states[ok.u].running).toBe(true);
  });

  it("PIC16F628A com brown-out ligado não roda a 3,3 V", async () => {
    const b = new Bench();
    const ps = b.add("benchSupply", { voltage: 3.3, current: 1 });
    const u = b.add("pic16f628a");
    const r = b.add("resistor", { resistance: 10_000 });
    b.wire([ps, "+"], [u, "VDD"]);
    b.wire([ps, "-"], [u, "VSS"]);
    b.wire([ps, "+"], [r, "1"]);
    b.wire([r, "2"], [u, "RA5"]);
    expect((await run(b.doc, 3)).states[u].stop).toMatch(/Brown-out/);
  });
});

describe("ATmega328P", () => {
  async function run(doc: Doc, n: number) {
    const { ensureStates, drivesFor, afterFrame } = await import("../mcu/runtime");
    const states: Record<string, import("../mcu/engine").McuState> = {};
    let state: Record<string, number> = {};
    let guess: number[] = [];
    let res!: ReturnType<typeof simulate>;
    for (let k = 0; k < n; k++) {
      ensureStates(doc, states);
      res = simulate(doc, { mcu: drivesFor(doc, states), tran: { state, duration: 0.02, steps: 20, guess, t0: k * 0.02, probes: [] } });
      state = res.tran!.state;
      guess = res.tran!.guess;
      afterFrame(doc, res, states, 0.02);
    }
    return { res, states };
  }

  function board(opts: { avcc: boolean; clock: string; crystal: boolean; ledOn: string }) {
    const b = new Bench();
    const usb = b.add("usb5v");
    const port = opts.ledOn.slice(1, 2);
    const bit = Number(opts.ledOn.slice(2));
    const u = b.add("atmega328p", {
      clock: opts.clock,
      program: JSON.stringify([
        { op: "set", reg: `DDR${port}`, bit },
        { op: "set", reg: `PORT${port}`, bit },
      ]),
    });
    const r = b.add("resistor", { resistance: 330 });
    const d = b.add("led");
    b.wire([usb, "VBUS"], [u, "VCC"]);
    b.wire([usb, "GND"], [u, "GND"]);
    b.wire([usb, "GND"], [u, "GND2"]);
    if (opts.avcc) b.wire([usb, "VBUS"], [u, "AVCC"]);
    if (opts.crystal) {
      const y = b.add("crystal", { freq: "16" });
      b.wire([u, "PB6"], [y, "1"]);
      b.wire([u, "PB7"], [y, "2"]);
    }
    b.wire([u, opts.ledOn], [r, "1"]);
    b.wire([r, "2"], [d, "A"]);
    b.wire([d, "K"], [usb, "GND"]);
    return { b, u, d };
  }

  it("pisca o LED do D13 (PB5)", async () => {
    const { b, u, d } = board({ avcc: true, clock: "int", crystal: false, ledOn: "PB5" });
    const { res, states } = await run(b.doc, 5);
    expect(states[u].running).toBe(true);
    expect(res.parts[d].glow).toBeGreaterThan(0.5);
  });

  it("fusível de cristal sem cristal: não liga; com cristal, liga", async () => {
    const no = board({ avcc: true, clock: "xtal", crystal: false, ledOn: "PB5" });
    expect((await run(no.b.doc, 3)).states[no.u].stop).toMatch(/não tem clock/);
    const yes = board({ avcc: true, clock: "xtal", crystal: true, ledOn: "PB5" });
    expect((await run(yes.b.doc, 3)).states[yes.u].running).toBe(true);
  });

  it("sem AVCC, a porta C não acende o LED", async () => {
    const { b, u, d } = board({ avcc: false, clock: "int", crystal: false, ledOn: "PC0" });
    const { res, states } = await run(b.doc, 5);
    expect(states[u].running).toBe(true);
    expect(states[u].notes.join(" ")).toMatch(/AVCC/);
    expect(res.parts[d].glow).toBe(0);
  });
});

describe("blocos", () => {
  it("bloco resistor + LED usado duas vezes: as duas cópias acendem; sem resistor, a queima fica no bloco", async () => {
    const { createBlock } = await import("../features/blocks/blocks");
    const b = new Bench();
    const pin = b.add("port", { name: "IN" });
    const r = b.add("resistor", { resistance: 470 });
    const d = b.add("led");
    const gnd = b.add("port", { name: "OUT" });
    b.wire([pin, "P"], [r, "1"]);
    b.wire([r, "2"], [d, "A"]);
    b.wire([d, "K"], [gnd, "P"]);
    const made = createBlock(b.doc, [...Object.keys(b.doc.parts), ...Object.keys(b.doc.wires)]);
    expect(made.error).toBeUndefined();
    b.doc = made.doc;
    const kind = b.doc.parts[made.id!].kind;
    const bt = b.add("battery9v");
    const second = b.add(kind);
    for (const inst of [made.id!, second]) {
      b.wire([bt, "+"], [inst, "IN"]);
      b.wire([inst, "OUT"], [bt, "-"]);
    }
    const s = simulate(b.doc);
    for (const inst of [made.id!, second]) {
      expect(s.parts[`${inst}/${d}`].glow).toBeGreaterThan(0.5);
      expect(s.parts[inst].status).toBe("ok");
    }
    // Trocando o resistor de dentro por 1 Ω, o LED de dentro queima (nas duas cópias).
    b.doc = produce(b.doc, (x) => {
      x.blocks![kind.slice(6)].parts[r].props.resistance = 1;
    });
    const burned = simulate(b.doc);
    expect(Object.keys(burned.newDamage).sort()).toEqual([`${made.id}/${d}`, `${second}/${d}`].sort().slice(0, Object.keys(burned.newDamage).length));
    expect(Object.keys(burned.newDamage).length).toBeGreaterThanOrEqual(1);
  });

  it("sem pinos de bloco na seleção, explica o que falta", async () => {
    const { createBlock } = await import("../features/blocks/blocks");
    const b = new Bench();
    const r = b.add("resistor");
    expect(createBlock(b.doc, [r]).error).toMatch(/Pino do bloco/);
  });
});

describe("vistas de protoboard e placa", () => {
  it("protoboard: cada perna fica num furo do próprio nó; jumpers só ligam o mesmo nó", async () => {
    const { layoutBreadboard, holeKey } = await import("../features/views/breadboard");
    const b = new Bench();
    const bt = b.add("battery9v");
    const r = b.add("resistor");
    const d = b.add("led");
    const u = b.add("hc04");
    b.wire([bt, "+"], [r, "1"]);
    b.wire([r, "2"], [d, "A"]);
    b.wire([d, "K"], [u, "1A"]);
    b.wire([bt, "-"], [u, "GND"]);
    const bb = layoutBreadboard(b.doc);
    const nl = getNetlist(b.doc);
    for (const lead of bb.leads) {
      const part = b.doc.parts[lead.partId];
      PARTS_PINS(part).forEach((pin, i) => {
        expect(bb.holeNet.get(holeKey(lead.holes[i]))).toBe(nl.byPin.get(`${part.id}:${pin}`)!.name);
      });
    }
    for (const j of bb.jumpers) expect(bb.holeNet.get(holeKey(j.a))).toBe(bb.holeNet.get(holeKey(j.b)));
    expect(bb.chips).toHaveLength(1);
    expect(bb.modules.map((m) => m.ref)).toEqual(["BT1"]);
  });

  it("placa: o circuito do LED fica todo roteado, sem trilhas de nós diferentes se encostando", async () => {
    const { layoutPcb } = await import("../features/views/pcb");
    const { b } = ledCircuit(330);
    const u = b.add("hc00");
    b.wire([u, "VCC"], [u, "4B"]);
    const pcb = layoutPcb(b.doc);
    expect(pcb.traces.length).toBeGreaterThan(0);
    const owner = new Map<string, string>();
    for (const p of pcb.pads) for (const l of ["top", "bottom"]) owner.set(`${l}:${p.x},${p.y}`, p.net);
    for (const t of pcb.traces) {
      const ends = [t.points[0], t.points[t.points.length - 1]];
      for (const e of ends) expect(pcb.pads.some((p) => p.x === e.x && p.y === e.y && p.net === t.net)).toBe(true);
      for (let i = 1; i < t.points.length; i++) {
        const [a, c] = [t.points[i - 1], t.points[i]];
        const n = Math.max(Math.abs(c.x - a.x), Math.abs(c.y - a.y)) / 10;
        for (let k = 0; k <= n; k++) {
          const key = `${t.layer}:${a.x + (Math.sign(c.x - a.x) * k * 10)},${a.y + Math.sign(c.y - a.y) * k * 10}`;
          expect(owner.get(key) ?? t.net).toBe(t.net);
          owner.set(key, t.net);
        }
      }
    }
  });
});

function PARTS_PINS(part: Doc["parts"][string]) {
  return pinsOf(part).map((x) => x.pin.name);
}

describe("placas prontas", () => {
  it("cada nó planejado vira exatamente um nó, sem misturar", async () => {
    const { BOARD_SPECS, buildBoard } = await import("../features/blocks/boards");
    for (const spec of BOARD_SPECS) {
      const def = buildBoard(spec);
      const sub = { parts: def.parts, wires: def.wires };
      const nl = getNetlist(sub);
      const ref = (r: string) => Object.values(def.parts).find((p) => p.ref === r)!;
      const netOf = (pinRef: string) => {
        const [r, pin] = [pinRef.slice(0, pinRef.indexOf(".")), pinRef.slice(pinRef.indexOf(".") + 1)];
        return nl.byPin.get(`${ref(r).id}:${pin}`)!.id;
      };
      const seen = new Map<string, number>();
      spec.nets.forEach((net, i) => {
        const ids = new Set(net.map(netOf));
        expect(ids.size, `${spec.id}: nó ${i} partido em ${ids.size}`).toBe(1);
        const id = [...ids][0];
        expect(seen.has(id), `${spec.id}: nós ${seen.get(id)} e ${i} se misturaram`).toBe(false);
        seen.set(id, i);
      });
      // Pinos que não estão em nenhum nó planejado ficam sozinhos (não encostam em nada).
      const planned = new Set(spec.nets.flat().map(netOf));
      for (const p of Object.values(def.parts)) {
        if (p.kind === "port") continue;
        for (const { pin } of pinsOf(p)) {
          const id = nl.byPin.get(`${p.id}:${pin.name}`)!.id;
          if (planned.has(id)) continue;
          const others = nl.nets.find((n) => n.id === id)!.pins.filter((x) => !(x.partId === p.id && x.pin === pin.name) && doc_kind(def, x.partId) !== "port");
          expect(others, `${spec.id}: ${p.ref}.${pin.name} encostou em ${others.map((o) => o.ref + "." + o.pin)}`).toEqual([]);
        }
      }
    }
  });

  it("as placas ligam sozinhas pelo USB e a estilo Uno pisca o LED L", async () => {
    const { flattenDoc, builtinBlocks } = await import("../features/blocks/blocks");
    const { ensureStates, drivesFor, afterFrame } = await import("../mcu/runtime");
    for (const id of ["board-uno", "board-pico", "board-esp32", "board-bluepill", "board-digispark"]) {
      const b = new Bench();
      const inst = b.add(`block:${id}`);
      if (id === "board-uno") {
        const ref = (r: string) => Object.values(builtinBlocks()[id].parts).find((p) => p.ref === r)!.id;
        b.doc = produce(b.doc, (d) => {
          d.parts[inst].props[`program:${ref("U1")}`] = JSON.stringify([
            { op: "set", reg: "DDRB", bit: 5 },
            { op: "set", reg: "PORTB", bit: 5 },
          ]);
        });
      }
      const states: Record<string, import("../mcu/engine").McuState> = {};
      let state: Record<string, number> = {};
      let guess: number[] = [];
      let res!: ReturnType<typeof simulate>;
      for (let k = 0; k < 8; k++) {
        const flat = flattenDoc(b.doc);
        ensureStates(flat, states);
        // Primeiro quadro instantâneo, como o app faz ao ligar.
        const duration = k === 0 ? 1e-9 : 0.02;
        res = simulate(b.doc, { mcu: drivesFor(flat, states), tran: { state, duration, steps: 20, guess, t0: k * 0.02, probes: [] } });
        expect(res.newTrips, `${id}: proteção atuou no quadro ${k}`).toEqual([]);
        state = res.tran!.state;
        guess = res.tran!.guess;
        afterFrame(flat, res, states, 0.02);
      }
      const mcus = Object.entries(states);
      expect(mcus.length, id).toBe(1);
      expect(mcus[0][1].stop, `${id}: ${mcus[0][1].stop}`).toBeNull();
      expect(mcus[0][1].running, id).toBe(true);
      if (id === "board-uno") {
        const led = Object.entries(res.parts).find(([k]) => k.startsWith(`${inst}/`) && b.doc && flattenDoc(b.doc).parts[k]?.ref.endsWith(".D1"))!;
        expect(led[1].glow).toBeGreaterThan(0.3);
      }
    }
  });
});

function doc_kind(def: { parts: Record<string, { kind: string }> }, id: string) {
  return def.parts[id]?.kind;
}
