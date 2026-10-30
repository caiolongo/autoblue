/// <reference types="node" />
import { produce } from "immer";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { onSegment, samePoint, type Point } from "../../lib/geometry";
import { afterFrame, drivesFor, ensureStates } from "../../mcu/runtime";
import { parseSteps, type McuState } from "../../mcu/engine";
import { initSimFromBytes } from "../../sim/engine";
import { simulate, type SimResult } from "../../sim/simulate";
import { pinAt } from "../blocks/boards";
import { flattenDoc } from "../blocks/blocks";
import { partBounds, pinsOf, type Doc } from "../editor/doc";
import { getNetlist } from "../editor/netlist";
import { PART_LIST } from "../library/parts";
import { deserialize, serialize } from "../project/file";
import { buildSystem } from "./build";
import { SYSTEMS, systemById } from "./index";
import { SYSTEM_GROUPS } from "./spec";

beforeAll(async () => {
  await initSimFromBytes(readFileSync(new URL("../../sim/sim-core.wasm", import.meta.url)));
});

const FRAME = 1 / 60;
const id = (ref: string) =>
  ref
    .split(".")
    .map((r) => `p_${r}`)
    .join("/");

/** Roda um sistema como o app roda: mesmo passo, mesma ordem, queimas gravadas no documento. */
class Bench {
  doc: Doc;
  t = 0;
  res!: SimResult;
  private states: Record<string, McuState> = {};
  private state: Record<string, number> = {};
  private guess: number[] = [];
  private tripped = new Set<string>();
  private pressed = new Set<string>();
  /** Avisos vistos nos quadros, depois da partida. */
  warnings = new Set<string>();

  constructor(system: string) {
    this.doc = buildSystem(systemById(system)!);
    this.frame(1e-9);
  }

  private frame(duration: number, probes: (string | null)[] = []) {
    const flat = flattenDoc(this.doc);
    ensureStates(flat, this.states);
    this.res = simulate(this.doc, {
      pressed: this.pressed,
      tripped: this.tripped,
      mcu: drivesFor(flat, this.states),
      tran: { state: this.state, duration, steps: duration < 1e-6 ? 20 : 60, guess: this.guess, t0: this.t, probes },
    });
    expect(this.res.ok, this.res.error).toBe(true);
    expect(this.res.converged, `não convergiu em t = ${this.t}`).toBe(true);
    this.state = this.res.tran!.state;
    this.guess = this.res.tran!.guess;
    for (const n of this.res.newTrips) this.tripped.add(n);
    afterFrame(flat, this.res, this.states, duration);
    this.t += duration;
    if (this.t > 0.2) {
      for (const [pid, p] of Object.entries(this.res.parts)) {
        for (const n of p.notes) if (n.level !== "info") this.warnings.add(`${flat.parts[pid]?.ref}: ${n.text}`);
      }
    }
    if (Object.keys(this.res.newDamage).length) {
      const burned = this.res.newDamage;
      this.doc = produce(this.doc, (d) => {
        for (const [pid, damage] of Object.entries(burned)) {
          const [inst, ...rest] = pid.split("/");
          if (rest.length) d.parts[inst].inner = { ...d.parts[inst].inner, [rest.join("/")]: damage };
          else d.parts[inst].damage = damage;
        }
      });
    }
  }

  run(seconds: number, each?: () => void) {
    for (let k = 0; k < Math.round(seconds / FRAME); k++) {
      this.frame(FRAME);
      each?.();
    }
    return this;
  }

  /** Tensão de um pino a cada passo, durante `seconds`. */
  sample(ref: string, pin: string, seconds: number) {
    const net = getNetlist(flattenDoc(this.doc)).byPin.get(`${id(ref)}:${pin}`)!.id;
    const out: number[] = [];
    for (let k = 0; k < Math.round(seconds / FRAME); k++) {
      this.frame(FRAME, [net]);
      out.push(...this.res.tran!.samples.map((row) => row[1]));
    }
    return out;
  }

  press(ref: string) {
    this.pressed.add(id(ref));
    return this;
  }
  release(ref: string) {
    this.pressed.delete(id(ref));
    return this;
  }
  /** Muda um ajuste, como no inspetor. */
  set(ref: string, prop: string, value: string | number) {
    this.doc = produce(this.doc, (d) => {
      d.parts[id(ref)].props[prop] = value;
    });
    return this;
  }
  /** Apaga uma peça, deixando os fios onde estão. */
  remove(ref: string) {
    this.doc = produce(this.doc, (d) => {
      delete d.parts[id(ref)];
    });
    return this;
  }
  /** Liga dois pinos ("R1.2") com um fio. */
  wire(a: string, b: string) {
    const points = [pinAt(this.doc, a, "teste").pos, pinAt(this.doc, b, "teste").pos];
    this.doc = produce(this.doc, (d) => {
      const n = `w_t${Object.keys(d.wires).length}`;
      d.wires[n] = { id: n, points };
    });
    return this;
  }
  glow = (ref: string) => this.res.parts[id(ref)].glow ?? 0;
  lit = (ref: string) => this.glow(ref) > 0.1;
  pin = (ref: string, pin: string) => this.res.parts[id(ref)].reading.pins[pin];
  v = (ref: string, pin: string) => this.pin(ref, pin).v;
  i = (ref: string, pin: string) => Math.abs(this.pin(ref, pin).i);
  part = (ref: string) => this.res.parts[id(ref)];
  burned = (ref: string) => this.doc.parts[id(ref)]?.damage;
  mcu = (ref: string) => this.states[id(ref)];
}

/** Instantes em que `on` muda, olhando um quadro por vez. */
function edges(b: Bench, seconds: number, on: () => boolean) {
  const out: number[] = [];
  let last = on();
  b.run(seconds, () => {
    if (on() !== last) out.push(b.t);
    last = on();
  });
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const period = (e: number[]) => (e[e.length - 1] - e[0]) / ((e.length - 1) / 2);

/** Avisos que fazem parte do que o sistema ensina. */
const EXPECTED: Record<string, RegExp> = {
  "esp32-nivel": /^(A1: )?A1\.U2: Esquentando/,
  "esp32-brownout": /^PS1: Limitando|^U2: (Entrada baixa|Esquentando)/,
};

/** O que cada sistema promete no guia, medido na simulação. */
const BEHAVIOR: Record<string, () => void> = {
  lanterna() {
    const b = new Bench("lanterna").run(0.2);
    expect(b.v("BT3", "+")).toBeCloseTo(4.5, 0);
    expect(b.i("D1", "A")).toBeCloseTo(0.0146, 3);
    expect(b.part("R1").reading.power).toBeLessThan(0.025);
    b.set("SW1", "position", "1").run(0.1);
    expect(b.i("D1", "A")).toBeLessThan(1e-6);

    const forte = new Bench("lanterna").set("R1", "resistance", 33).run(0.2);
    expect(forte.part("D1").why.join(" ")).toMatch(/use .* em série/);
    expect(forte.burned("D1")).toBeUndefined();

    const curto = new Bench("lanterna").wire("R1.1", "D1.K").run(0.1);
    expect(curto.burned("F1")).toBeDefined();
  },
  divisor() {
    const b = new Bench("divisor").run(0.1);
    expect(b.v("R2", "1")).toBeCloseTo(4.5, 1);
    b.set("SW1", "position", "2").run(0.1);
    expect(b.v("R2", "1")).toBeCloseTo(3, 1);
    const firme = new Bench("divisor").set("R1", "resistance", 1000).set("R2", "resistance", 1000).set("SW1", "position", "2").run(0.1);
    expect(firme.v("R2", "1")).toBeGreaterThan(4.2);
  },
  "fonte-dupla"() {
    const b = new Bench("fonte-dupla").run(0.5);
    expect(b.v("U1", "IN")).toBeCloseTo(11.3, 0);
    expect(b.v("U1", "OUT")).toBeCloseTo(5, 1);
    expect(b.v("U2", "OUT")).toBeCloseTo(3.3, 1);
    expect(b.lit("D2") && b.lit("D3")).toBe(true);
    b.set("SW1", "position", "2").run(0.2);
    expect(b.i("R2", "1")).toBeCloseTo(0.15, 1);
    expect(b.part("U1").reading.power).toBeGreaterThan(0.8);
    expect(b.part("U1").reading.power).toBeLessThan(1.2);

    const baixa = new Bench("fonte-dupla").set("PS1", "voltage", 6).run(0.5);
    expect(baixa.v("U1", "OUT")).toBeLessThan(4.6);
    expect(baixa.part("U1").notes.map((n) => n.text).join()).toMatch(/dropout/);

    const alta = new Bench("fonte-dupla").set("PS1", "voltage", 24).set("SW1", "position", "2").run(0.2);
    expect(alta.part("U1").notes.map((n) => n.text).join()).toMatch(/Proteção térmica/);
    const dissipada = new Bench("fonte-dupla").set("PS1", "voltage", 24).set("SW1", "position", "2").set("U1", "heatsink", "small").run(0.2);
    expect(dissipada.v("U1", "OUT")).toBeCloseTo(5, 1);
  },
  "rc-capacitor"() {
    const b = new Bench("rc-capacitor").run(1);
    expect(b.v("C1", "+")).toBeGreaterThan(5.4);
    expect(b.v("C1", "+")).toBeLessThan(5.9);
    b.run(4);
    expect(b.v("C1", "+")).toBeGreaterThan(8.8);
    b.set("SW1", "position", "2").run(0.1);
    const inicio = b.glow("D1");
    expect(inicio).toBeGreaterThan(0.3);
    b.run(1.5);
    expect(b.glow("D1")).toBeLessThan(inicio);
    b.run(5);
    expect(b.v("C1", "+")).toBeGreaterThan(1.5);
    expect(b.i("D1", "A")).toBeLessThan(1e-4);
  },
  "dimmer-pot"() {
    const b = new Bench("dimmer-pot").run(0.1);
    expect(b.i("D1", "A")).toBeGreaterThan(0.009);
    expect(b.i("D1", "A")).toBeLessThan(0.013);
    expect(b.i("Q1", "B")).toBeLessThan(0.0001);
    expect(b.set("RV1", "position", 20).run(0.1).lit("D1")).toBe(false);
    expect(b.set("RV1", "position", 100).run(0.1).i("D1", "A")).toBeGreaterThan(0.015);
    expect(b.burned("Q1")).toBeUndefined();
  },
  chaves() {
    const b = new Bench("chaves").run(0.1);
    expect(b.lit("D1") || b.lit("D2")).toBe(false);
    b.press("SW1").run(0.1);
    expect(b.i("Q1", "B")).toBeCloseTo(0.00083, 4);
    expect(b.i("D1", "A")).toBeCloseTo(0.014, 2);
    expect(b.i("Q2", "G")).toBeLessThan(1e-9);
    expect(b.v("Q2", "D")).toBeLessThan(b.v("Q1", "C"));
    expect(b.release("SW1").run(0.1).lit("D2")).toBe(false);
    const fraca = new Bench("chaves").set("R1", "resistance", 1_000_000).press("SW1").run(0.1);
    expect(fraca.i("D1", "A")).toBeLessThan(0.005);
    expect(fraca.i("D2", "A")).toBeGreaterThan(0.01);
  },
  "fonte-corrente"() {
    const at = (volts: number) => new Bench("fonte-corrente").set("PS1", "voltage", volts).run(0.1).i("D1", "A");
    expect(at(5)).toBeGreaterThan(0.017);
    expect(at(5)).toBeLessThan(0.023);
    expect(Math.abs(at(20) - at(5))).toBeLessThan(0.003);
    expect(new Bench("fonte-corrente").set("R2", "resistance", 68).run(0.1).i("D1", "A")).toBeLessThan(0.012);
  },
  "bobina-flyback"() {
    const b = new Bench("bobina-flyback").run(0.1).press("SW1").run(0.1);
    expect(b.i("L1", "1")).toBeCloseTo(0.027, 2);
    expect(b.lit("D2")).toBe(false);
    // Ao soltar, a corrente da bobina segue pelos diodos, o coletor passa dos 9 V e nada queima.
    b.release("SW1");
    const volts = b.sample("Q1", "C", FRAME);
    expect(Math.max(...volts)).toBeGreaterThan(9.5);
    expect(Math.max(...volts)).toBeLessThan(13);
    b.run(0.1);
    expect(b.burned("Q1")).toBeUndefined();
    const sem = new Bench("bobina-flyback").remove("D1").run(0.1).press("SW1").run(0.1).release("SW1");
    expect(Math.max(...sem.sample("Q1", "C", FRAME))).toBeGreaterThan(45);
  },
  "ponte-h"() {
    const b = new Bench("ponte-h").run(0.1);
    const state = () => [b.lit("D1"), b.lit("D2")];
    expect(state()).toEqual([true, false]);
    expect(b.i("R5", "1")).toBeCloseTo(0.014, 2);
    expect(b.set("SW1", "position", "2").run(0.1) && state()).toEqual([false, false]);
    expect(b.set("SW2", "position", "2").run(0.1) && state()).toEqual([false, true]);
    expect(b.set("SW1", "position", "1").run(0.1) && state()).toEqual([false, false]);
    // O mesmo nó das bases, pelo lado do resistor: o fio reto entre os pinos passaria pelos coletores.
    const erro = new Bench("ponte-h").wire("R1.2", "R2.2").run(0.1);
    expect(erro.burned("Q2") ?? erro.burned("Q1")).toBeDefined();
  },
  "nand-cmos"() {
    const b = new Bench("nand-cmos");
    for (const [a, c, on] of [
      ["1", "1", true],
      ["1", "2", true],
      ["2", "1", true],
      ["2", "2", false],
    ] as const) {
      b.set("SW1", "position", a).set("SW2", "position", c).run(0.05);
      expect(b.lit("D1"), `A=${a} B=${c}`).toBe(on);
    }
  },
  "pisca-transistores"() {
    const b = new Bench("pisca-transistores").run(1);
    const e = edges(b, 4, () => b.lit("D1"));
    expect(e.length).toBeGreaterThanOrEqual(6);
    expect(period(e)).toBeGreaterThan(0.7);
    expect(period(e)).toBeLessThan(0.95);
    expect(Math.min(...b.sample("Q2", "B", 1))).toBeLessThan(-1);
  },
  "pisca-555"() {
    const b = new Bench("pisca-555").run(0.5);
    const e = edges(b, 5, () => b.lit("D1"));
    expect(period(e)).toBeCloseTo(0.95, 0);
    const volts = b.sample("C1", "+", 2);
    expect(Math.min(...volts)).toBeCloseTo(3, 0);
    expect(Math.max(...volts)).toBeCloseTo(6, 0);
    expect(b.lit("D1")).not.toBe(b.lit("D2"));
  },
  "mono-555"() {
    const b = new Bench("mono-555").run(0.2);
    expect(b.lit("D1")).toBe(false);
    b.press("SW1").run(0.1).release("SW1");
    const inicio = b.t;
    expect(b.lit("D1")).toBe(true);
    b.run(2).press("SW1").run(0.1).release("SW1");
    const e = edges(b, 5, () => b.lit("D1"));
    expect(e).toHaveLength(1);
    expect(e[0] - inicio).toBeCloseTo(5.2, 0);
  },
  "pwm-555"() {
    const duty = (position: number) => {
      const b = new Bench("pwm-555").set("RV1", "position", position).run(0.3);
      const out = b.sample("U1", "OUT", 1);
      return { duty: mean(out.map((v) => (v > 4 ? 1 : 0))), heat: b.part("Q1").reading.power };
    };
    expect(duty(25).duty).toBeCloseTo(0.26, 1);
    expect(duty(75).duty).toBeCloseTo(0.75, 1);
    expect(duty(75).heat).toBeLessThan(0.01);
    const b = new Bench("pwm-555").run(0.3);
    const e = edges(b, 2, () => b.v("Q1", "G") > 4);
    expect(period(e)).toBeGreaterThan(0.05);
    expect(period(e)).toBeLessThan(0.09);
  },
  "buck-555"() {
    const b = new Bench("buck-555").run(4);
    const out = mean(b.sample("C2", "+", 0.5));
    expect(out).toBeCloseTo(4.4, 0);
    let entrada = 0;
    let saida = 0;
    b.run(0.5, () => {
      entrada += b.pin("PS1", "+").i * -b.v("PS1", "+");
      saida += b.part("R3").reading.power + b.part("R4").reading.power + b.part("D2").reading.power;
    });
    expect(saida / entrada).toBeGreaterThan(0.72);
    expect(saida / entrada).toBeLessThan(0.86);
  },
  maioria() {
    const b = new Bench("maioria");
    for (let k = 0; k < 8; k++) {
      const votes = [k & 1, (k >> 1) & 1, (k >> 2) & 1];
      votes.forEach((v, i) => b.set(`SW${i + 1}`, "position", v ? "2" : "1"));
      b.run(0.05);
      expect(b.lit("D1"), votes.join()).toBe(votes[0] + votes[1] + votes[2] >= 2);
    }
  },
  somador() {
    const b = new Bench("somador");
    for (let k = 0; k < 8; k++) {
      const bits = [k & 1, (k >> 1) & 1, (k >> 2) & 1];
      bits.forEach((v, i) => b.set(`SW${i + 1}`, "position", v ? "2" : "1"));
      b.run(0.05);
      const sum = bits[0] + bits[1] + bits[2];
      expect([b.lit("D1"), b.lit("D2")], bits.join()).toEqual([sum % 2 === 1, sum >= 2]);
    }
  },
  "latch-sr"() {
    const b = new Bench("latch-sr").run(0.1);
    expect(b.lit("D1")).not.toBe(b.lit("D2"));
    b.press("SW1").run(0.05).release("SW1").run(0.05);
    expect([b.lit("D1"), b.lit("D2")]).toEqual([true, false]);
    b.press("SW2").run(0.05).release("SW2").run(0.05);
    expect([b.lit("D1"), b.lit("D2")]).toEqual([false, true]);
    b.press("SW1").press("SW2").run(0.05);
    expect([b.lit("D1"), b.lit("D2")]).toEqual([true, true]);
  },
  "toggle-ff"() {
    const b = new Bench("toggle-ff").run(0.1);
    const antes = b.lit("D1");
    b.press("SW1").run(0.05);
    expect(b.lit("D1")).toBe(!antes);
    b.run(0.2);
    expect(b.lit("D1")).toBe(!antes);
    b.release("SW1").run(0.05);
    expect(b.lit("D1")).toBe(!antes);
    b.press("SW1").run(0.05).release("SW1").run(0.05);
    expect(b.lit("D1")).toBe(antes);
  },
  "contador-binario"() {
    const b = new Bench("contador-binario").run(0.5);
    const seq: number[] = [];
    const value = () => (b.lit("D1") ? 1 : 0) + (b.lit("D2") ? 2 : 0);
    b.run(9, () => {
      if (seq[seq.length - 1] !== value()) seq.push(value());
    });
    expect(seq.length).toBeGreaterThanOrEqual(7);
    seq.slice(1).forEach((v, i) => expect(v).toBe((seq[i] + 1) % 4));
  },
  "sequencial-4017"() {
    const b = new Bench("sequencial-4017").run(0.2);
    const leds = ["D1", "D2", "D3", "D4", "D5", "D6"];
    const seq: number[] = [];
    b.run(5, () => {
      const on = leds.findIndex(b.lit);
      expect(leds.filter(b.lit).length).toBeLessThanOrEqual(1);
      if (on >= 0 && seq[seq.length - 1] !== on) seq.push(on);
    });
    expect(seq.length).toBeGreaterThanOrEqual(6);
    seq.slice(1).forEach((v, i) => expect(v).toBe((seq[i] + 1) % 6));
  },
  "semaforo-4017"() {
    const b = new Bench("semaforo-4017").run(0.2);
    const cor = () => (b.lit("D7") ? "vermelho" : b.lit("D8") ? "verde" : b.lit("D9") ? "amarelo" : "");
    const seq: [string, number][] = [];
    b.run(20, () => {
      const c = cor();
      if (c && seq[seq.length - 1]?.[0] !== c) seq.push([c, b.t]);
    });
    const ordem = seq.map(([c]) => c);
    expect(ordem.join().includes("vermelho,verde,amarelo,vermelho")).toBe(true);
    const k = ordem.indexOf("verde");
    expect(seq[k + 1][1] - seq[k][1]).toBeCloseTo(2.9, 0);
    expect(seq[k + 2][1] - seq[k + 1][1]).toBeCloseTo(1.45, 0);
  },
  alarme() {
    const b = new Bench("alarme").run(1);
    expect(b.lit("D1")).toBe(true);
    expect(edges(b, 1, () => b.lit("D2"))).toHaveLength(0);
    b.set("SW1", "position", "1").run(0.2);
    expect(b.lit("D1")).toBe(false);
    b.set("SW1", "position", "2");
    const e = edges(b, 3, () => b.lit("D2"));
    expect(period(e)).toBeCloseTo(0.47, 0);
    b.press("SW2").run(0.1).release("SW2").run(0.2);
    expect(b.lit("D1")).toBe(true);
    expect(edges(b, 1, () => b.lit("D2"))).toHaveLength(0);
  },
  "pisca-attiny"() {
    const b = new Bench("pisca-attiny").run(0.2);
    const e = edges(b, 4, () => b.lit("D1"));
    expect(period(e)).toBeCloseTo(1, 0);
    expect(b.lit("D1")).not.toBe(b.lit("D2"));
    expect(b.i("R1", "1") + b.i("R2", "1")).toBeCloseTo(0.0085, 2);
  },
  "semaforo-avr"() {
    const b = new Bench("semaforo-avr").run(0.1);
    const seq: string[] = [];
    b.run(14, () => {
      const c = b.lit("D1") ? "vermelho" : b.lit("D3") ? "verde" : b.lit("D2") ? "amarelo" : "";
      if (c && seq[seq.length - 1] !== c) seq.push(c);
    });
    expect(seq.slice(0, 4)).toEqual(["vermelho", "verde", "amarelo", "vermelho"]);
    b.press("SW1").run(0.1);
    expect(b.mcu("U1").running).toBe(false);
    expect(b.lit("D1") || b.lit("D2") || b.lit("D3")).toBe(false);
    b.release("SW1").run(0.2);
    expect(b.lit("D1")).toBe(true);
  },
  "carga-uno"() {
    const b = new Bench("carga-uno").run(0.2);
    expect(b.mcu("A1.U1").running).toBe(true);
    const e = edges(b, 5, () => b.lit("D1"));
    expect(period(e)).toBeCloseTo(2, 0);
    b.run(1, () => {
      if (b.lit("D1")) expect(b.i("R3", "1")).toBeCloseTo(0.02, 2);
    });
    expect(b.i("Q1", "G")).toBeLessThan(1e-6);
    expect(b.part("Q1").reading.power).toBeLessThan(0.01);
  },
  "rp2040-minimo"() {
    const b = new Bench("rp2040-minimo").run(0.2);
    expect(b.mcu("U1").running).toBe(true);
    expect(b.mcu("U1").notes).toEqual([]);
    expect(b.v("U1", "DVDD")).toBeCloseTo(1.1, 1);
    expect(period(edges(b, 3, () => b.lit("D1")))).toBeCloseTo(0.6, 0);
    expect(b.lit("D1")).not.toBe(b.lit("D2"));
    expect(new Bench("rp2040-minimo").remove("U3").run(0.1).mcu("U1").stop).toMatch(/flash/);
    expect(new Bench("rp2040-minimo").remove("Y1").run(0.1).mcu("U1").notes.join()).toMatch(/cristal/i);
    const sem = new Bench("rp2040-minimo");
    const ends = [pinAt(sem.doc, "U1.VREGOUT", "t").pos, pinAt(sem.doc, "U1.DVDD", "t").pos];
    sem.doc = produce(sem.doc, (d) => {
      for (const w of Object.values(d.wires)) if (ends.every((p) => w.points.some((q) => samePoint(p, q)))) delete d.wires[w.id];
    });
    expect(sem.run(0.1).mcu("U1").stop).toMatch(/1,1 V/);
    expect(new Bench("rp2040-minimo").wire("U1.GP5", "J1.VBUS").run(0.1).burned("U1")).toBeDefined();
  },
  "stm32-rcc"() {
    const b = new Bench("stm32-rcc").run(0.2);
    expect(b.mcu("U1").running).toBe(true);
    expect(period(edges(b, 4, () => b.lit("D1")))).toBeCloseTo(1, 0);
    const steps = parseSteps(b.doc.parts.p_U1.props.program);
    const sem = new Bench("stm32-rcc").set("U1", "program", JSON.stringify(steps.slice(1))).run(1);
    expect(sem.lit("D1")).toBe(false);
    expect(sem.mcu("U1").event).toMatch(/ignorada/);
    const boot = new Bench("stm32-rcc").wire("U1.BOOT0", "C1.1").run(0.2);
    expect(boot.mcu("U1").stop).toMatch(/bootloader/);
  },
  "pic-rmw"() {
    const b = new Bench("pic-rmw");
    let vermelho = false;
    let amarelo = false;
    b.run(6, () => {
      vermelho ||= b.lit("D2");
      amarelo ||= b.lit("D1");
    });
    expect(amarelo).toBe(true);
    expect(vermelho).toBe(false);
    expect(b.mcu("U1").event).toMatch(/BSF PORTA,6.*RA4/);

    const steps = parseSteps(b.doc.parts.p_U1.props.program);
    const paciente = new Bench("pic-rmw").set("U1", "program", JSON.stringify(steps.map((s) => (s.value === 200 ? { ...s, value: 2000 } : s))));
    let acendeu = false;
    paciente.run(8, () => {
      acendeu ||= paciente.lit("D2");
    });
    expect(acendeu).toBe(true);
  },
  "esp32-nivel"() {
    const b = new Bench("esp32-nivel").run(0.2);
    expect(b.mcu("A1.U1").running).toBe(true);
    const lado5 = b.sample("U1", "HV1", 2);
    const lado3 = b.sample("U1", "LV1", 2);
    expect(Math.max(...lado5)).toBeGreaterThan(4.8);
    expect(Math.max(...lado3)).toBeLessThan(3.4);
    expect(period(edges(b, 4, () => b.lit("D1")))).toBeCloseTo(1, 0);
    const direto = new Bench("esp32-nivel").wire("A1.IO4", "U2.1A");
    let aviso = false;
    direto.run(2, () => {
      aviso ||= direto.part("U2").notes.some((n) => /entre 0 e 1/.test(n.text));
    });
    expect(aviso).toBe(true);
  },
  "esp32-brownout"() {
    const com = new Bench("esp32-brownout").run(6);
    expect(com.mcu("U1").running).toBe(true);
    expect(Math.min(...com.sample("U2", "IN", 1))).toBeGreaterThan(3.9);
    expect(com.mcu("U1").resets).toBeLessThanOrEqual(1);
    const inicial = com.mcu("U1").resets;
    com.run(3);
    expect(com.mcu("U1").resets).toBe(inicial);

    const sem = new Bench("esp32-brownout").set("SW1", "position", "1").run(6);
    expect(sem.mcu("U1").resets).toBeGreaterThan(3);
    const forte = new Bench("esp32-brownout").set("SW1", "position", "1").set("PS1", "current", 1).run(6);
    expect(forte.mcu("U1").resets).toBe(0);
  },
};

describe("sistemas prontos: catálogo", () => {
  it("ids únicos, grupos válidos e um teste de comportamento para cada sistema", () => {
    expect(new Set(SYSTEMS.map((s) => s.id)).size).toBe(SYSTEMS.length);
    for (const s of SYSTEMS) expect(SYSTEM_GROUPS).toContain(s.group);
    expect(Object.keys(BEHAVIOR).sort()).toEqual(SYSTEMS.map((s) => s.id).sort());
  });

  it("usam todas as peças da biblioteca", () => {
    const used = new Set(SYSTEMS.flatMap((s) => s.parts.map((p) => p[1])));
    expect(PART_LIST.map((d) => d.kind).filter((k) => k !== "port" && !used.has(k))).toEqual([]);
  });

  it("o guia explica todas as peças, e só as que existem", () => {
    for (const s of SYSTEMS) expect(Object.keys(s.guide.roles).sort(), s.id).toEqual(s.parts.map((p) => p[0]).sort());
  });

  it("o programa gravado numa placa aponta para uma peça que existe, com id fixo", () => {
    const doc = buildSystem(systemById("carga-uno")!);
    const key = Object.keys(doc.parts.p_A1.props).find((k) => k.startsWith("program:"))!;
    expect(flattenDoc(deserialize(serialize(doc))).parts[`p_A1/${key.slice("program:".length)}`].props.program).toBe(doc.parts.p_A1.props[key]);
  });

  it("abrir de novo dá exatamente o mesmo circuito", () => {
    for (const s of SYSTEMS) expect(buildSystem(s), s.id).toEqual(buildSystem(s));
  });

  it("salvar e abrir mantém o guia e a fiação", () => {
    for (const s of SYSTEMS) {
      const doc = buildSystem(s);
      const back = deserialize(serialize(doc));
      expect(back.system).toBe(s.id);
      expect(getNetlist(back).nets.length).toBe(getNetlist(doc).nets.length);
    }
  });
});

/** Pontos da grade por onde um fio passa. */
function cells(points: Point[]) {
  return points.flatMap((a, i) => {
    const b = points[i + 1];
    if (!b) return [];
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / 20;
    return Array.from({ length: n + 1 }, (_, k) => ({ x: a.x + Math.sign(b.x - a.x) * k * 20, y: a.y + Math.sign(b.y - a.y) * k * 20 }));
  });
}

describe.each(SYSTEMS.map((s) => [s.id, s] as const))("%s", (name, spec) => {
  it("fiação: cada nó planejado é um nó só, nada se mistura e nada fica fora", () => {
    const doc = buildSystem(spec);
    const nl = getNetlist(doc);
    const netOf = (r: string) => nl.byPin.get(`p_${r.slice(0, r.indexOf("."))}:${r.slice(r.indexOf(".") + 1)}`)!.id;
    const seen = new Map<string, number>();
    spec.nets.forEach((net, i) => {
      const ids = new Set(net.map(netOf));
      expect(ids.size, `nó ${i} (${net[0]}) partido`).toBe(1);
      const only = [...ids][0];
      expect(seen.get(only), `nós ${seen.get(only)} e ${i} misturados`).toBeUndefined();
      seen.set(only, i);
    });
    expect(nl.shorts).toEqual([]);
    expect(nl.loose).toEqual([]);
    for (const part of Object.values(doc.parts)) {
      for (const { pin } of pinsOf(part)) {
        const net = nl.byPin.get(`${part.id}:${pin.name}`)!;
        if (!seen.has(net.id)) expect(net.pins, `${part.ref}.${pin.name} encostou em outro pino`).toHaveLength(1);
      }
    }
  });

  it("desenho: fio nenhum passa sobre um corpo nem corre sobre outro nó", () => {
    const doc = buildSystem(spec);
    const nl = getNetlist(doc);
    const wires = Object.values(doc.wires);
    for (const w of wires) {
      for (let i = 1; i < w.points.length; i++) {
        expect(w.points[i].x === w.points[i - 1].x || w.points[i].y === w.points[i - 1].y, `${w.id} na diagonal`).toBe(true);
      }
      for (const part of Object.values(doc.parts)) {
        const r = partBounds(part);
        for (const p of cells(w.points)) expect(p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h, `${w.id} sobre ${part.ref}`).toBe(false);
      }
      for (const o of wires) {
        if (nl.byWire.get(o.id) === nl.byWire.get(w.id)) continue;
        for (let i = 1; i < w.points.length; i++) {
          for (let j = 1; j < o.points.length; j++) {
            const [a, b, c, d] = [w.points[i - 1], w.points[i], o.points[j - 1], o.points[j]];
            const sameLine = (a.y === b.y && c.y === d.y && a.y === c.y) || (a.x === b.x && c.x === d.x && a.x === c.x);
            const overlap = sameLine && (onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b));
            expect(overlap, `${w.id} corre sobre ${o.id}`).toBe(false);
          }
        }
      }
    }
  });

  it("liga sozinho e fica estável: nada queima, sem avisos fora do esperado", () => {
    const b = new Bench(name).run(3);
    expect(Object.values(b.doc.parts).filter((p) => p.damage || p.inner).map((p) => p.ref)).toEqual([]);
    const allowed = EXPECTED[name];
    expect([...b.warnings].filter((w) => !allowed?.test(w))).toEqual([]);
  }, 60_000);

  it("faz o que o guia promete", () => BEHAVIOR[name](), 60_000);
});
