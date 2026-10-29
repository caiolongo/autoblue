import type { McuPin, McuReg, McuSpec, Step } from "./types";

/** Estado volátil do chip: some quando ele desliga ou reinicia, como na vida real. */
export interface McuState {
  regs: Record<string, number>;
  /** Alimentado e fora do reset (já passou pela partida). */
  up: boolean;
  /** Rodando o programa. */
  running: boolean;
  /** Por que não está rodando. */
  stop: string | null;
  /** Motivo de boot errado, lido na partida. */
  boot: string | null;
  notes: string[];
  /** Sequência: passo atual e quanto já esperou nele (s). */
  pc: number;
  waited: number;
  /** Fase do pico de consumo do rádio (s). */
  phase: number;
  /** Última escrita ignorada ou com efeito surpresa, para explicar no inspetor. */
  event: string | null;
  /** Quantas vezes reiniciou desde que a energia foi ligada. */
  resets: number;
}

export function freshState(spec: McuSpec): McuState {
  return {
    regs: Object.fromEntries(spec.regs.map((r) => [r.name, r.reset])),
    up: false,
    running: false,
    stop: null,
    boot: null,
    notes: [],
    pc: 0,
    waited: 0,
    phase: 0,
    event: null,
    resets: 0,
  };
}

const bit = (x: number, b: number) => (x >>> b) & 1;
const reg = (spec: McuSpec, name: string) => spec.regs.find((r) => r.name === name);
const portReg = (spec: McuSpec, role: McuReg["role"], port: string) => spec.regs.find((r) => r.role === role && r.port === port);

/** O pino é GPIO agora? (RESET vira GPIO conforme a configuração.) */
export function isGpio(_spec: McuSpec, pin: McuPin, props: Record<string, string | number>) {
  if (!pin.io) return false;
  if (pin.gpioIf) return String(props[pin.gpioIf.prop]) === pin.gpioIf.value;
  return pin.kind === "gpio";
}

/** STM32: clock da porta ligado? Os outros chips não têm essa trava. */
function clockOn(spec: McuSpec, st: McuState, port: string | undefined): boolean {
  const rcc = spec.regs.find((r) => r.role === "clock");
  if (!rcc || !port) return true;
  const b = rcc.bits.findIndex((label) => label === `IOP${port}EN`);
  return b < 0 || bit(st.regs[rcc.name], b) === 1;
}

/** PIC: comparadores ligados tomam RA0–RA3 (leem 0). */
function comparatorsOn(spec: McuSpec, st: McuState) {
  const cm = spec.regs.find((r) => r.role === "cmcon");
  return !!cm && (st.regs[cm.name] & 7) !== 7;
}

/** Nível lido por uma entrada, já com as travas do chip. */
function readPin(spec: McuSpec, st: McuState, pin: string, high: (p: string) => boolean) {
  const p = spec.pins.find((x) => x.name === pin);
  if (!p?.io) return 0;
  if (!clockOn(spec, st, p.io.port)) return 0;
  if (p.io.port === "A" && p.io.bit <= 3 && comparatorsOn(spec, st)) return 0;
  return high(pin) ? 1 : 0;
}

/** Valor de um registrador como o programa o veria agora. */
export function readReg(spec: McuSpec, st: McuState, name: string, high: (p: string) => boolean): number {
  const r = reg(spec, name);
  if (!r) return 0;
  if (r.role === "in" || (r.role === "out" && spec.rmw)) {
    // Registradores de leitura (e o PORT do PIC) devolvem o nível dos pinos.
    if (!clockOn(spec, st, r.port)) return 0;
    return r.bits.reduce((acc, p, b) => acc | (p ? readPin(spec, st, p, high) << b : 0), 0);
  }
  if (r.role === "set" || r.role === "clr" || r.role === "xor") return 0;
  return st.regs[name] >>> 0;
}

/**
 * Escreve um bit (como clicar nele, ou um passo da sequência). Retorna uma explicação quando
 * a escrita não faz o que parece: porta sem clock, registrador só de leitura, BSF que regrava a porta…
 */
export function writeBit(spec: McuSpec, st: McuState, name: string, b: number, value: 0 | 1, high: (p: string) => boolean): string | null {
  const r = reg(spec, name);
  if (!r) return null;
  if (r.role === "in") return `${name} é só leitura: mostra o nível dos pinos.`;
  if (!clockOn(spec, st, r.port)) return `Escrita em ${name} ignorada: o clock da porta ${r.port} está desligado (RCC_APB2ENR).`;
  if (r.role === "set" || r.role === "clr" || r.role === "xor") {
    if (!value || !r.target) return null;
    const t = st.regs[r.target];
    st.regs[r.target] = (r.role === "set" ? t | (1 << b) : r.role === "clr" ? t & ~(1 << b) : t ^ (1 << b)) >>> 0;
    return null;
  }
  if (r.role === "out" && spec.rmw) {
    // Ler-modificar-escrever: o latch inteiro vira o que os pinos mostram, com o bit mudado.
    const before = st.regs[name];
    const read = readReg(spec, st, name, high);
    const next = value ? read | (1 << b) : read & ~(1 << b);
    st.regs[name] = next & 0xff;
    const lost = before & ~next & ~(1 << b) & 0xff;
    if (lost) {
      const pins = r.bits.filter((p, i) => p && bit(lost, i)).join(", ");
      return `${value ? "BSF" : "BCF"} ${name},${b} leu a porta inteira e regravou: ${pins} estava(m) em 1 no registrador, mas o pino lia 0 (carga pesada, pino em entrada ou comparador), e agora ficou em 0.`;
    }
    return null;
  }
  st.regs[name] = (value ? st.regs[name] | (1 << b) : st.regs[name] & ~(1 << b)) >>> 0;
  return null;
}

/** STM32: troca os 4 bits de configuração de um pino. */
export function writeMode(spec: McuSpec, st: McuState, name: string, field: number, code: number): string | null {
  const r = reg(spec, name);
  if (!r) return null;
  if (!clockOn(spec, st, r.port)) return `Escrita em ${name} ignorada: o clock da porta ${r.port} está desligado (RCC_APB2ENR).`;
  const shift = field * 4;
  st.regs[name] = ((st.regs[name] & ~(0xf << shift)) | ((code & 0xf) << shift)) >>> 0;
  return null;
}

export interface PinDrive {
  /** Saída: 1 = puxa para VCC, 0 = puxa para GND. */
  drive?: 0 | 1;
  pull?: "up" | "down";
}

/** O que cada pino está fazendo eletricamente, a partir dos registradores. */
export function pinDrives(spec: McuSpec, st: McuState, props: Record<string, string | number>): Record<string, PinDrive> {
  const out: Record<string, PinDrive> = {};
  for (const p of spec.pins) {
    // Pulls fixos (reset, pinos de boot) valem mesmo com o chip desligado.
    if (p.pull) out[p.name] = { pull: p.pull };
    if (!st.up || !isGpio(spec, p, props) || !p.io) continue;
    const { port, bit: b } = p.io;
    const d: PinDrive = {};
    const outReg = portReg(spec, "out", port);
    const level = outReg ? bit(st.regs[outReg.name], b) : 0;
    const modeReg = portReg(spec, "mode4", port);
    let output = false;
    if (modeReg) {
      const field = modeReg.bits.indexOf(p.name);
      const code = (st.regs[modeReg.name] >>> (field * 4)) & 0xf;
      const mode = code & 3;
      const cnf = code >> 2;
      if (mode) {
        output = true;
        if (!(cnf & 1) || !level) d.drive = level as 0 | 1;
      } else if (cnf === 2) d.pull = level ? "up" : "down";
    } else {
      const dir = portReg(spec, "dir", port);
      const dirInv = portReg(spec, "dirInv", port);
      output = dir ? !!bit(st.regs[dir.name], b) : dirInv ? !bit(st.regs[dirInv.name], b) : false;
      if (output && !p.inputOnly) {
        // Open-drain: em 1 o pino só solta.
        if (!(p.openDrain && level)) d.drive = level as 0 | 1;
      } else {
        const pu = portReg(spec, "pull", port);
        const pd = portReg(spec, "pulldown", port);
        const rbpu = portReg(spec, "rbpu", port);
        if (spec.pullFromOut && level) d.pull = "up";
        else if (pu && bit(st.regs[pu.name], b)) d.pull = "up";
        else if (rbpu && !bit(st.regs[rbpu.name], 7)) d.pull = "up";
        else if (pd && bit(st.regs[pd.name], b)) d.pull = "down";
        else if (p.pull) d.pull = p.pull;
      }
    }
    if (p.inputOnly) delete d.drive;
    out[p.name] = d;
  }
  return out;
}

/** Roda a sequência por `duration` segundos. Escritas valem a partir do próximo quadro. */
export function runSteps(spec: McuSpec, st: McuState, steps: Step[], duration: number, high: (p: string) => boolean) {
  if (!st.running || !steps.length) return;
  let budget = duration;
  for (let guard = 0; guard < 256; guard++) {
    const s = steps[st.pc % steps.length];
    if (s.op === "wait") {
      const need = Math.max((s.value ?? 0) / 1000, 0) - st.waited;
      if (budget < need) {
        st.waited += budget;
        return;
      }
      budget -= need;
      st.waited = 0;
    } else if (s.reg !== undefined && s.bit !== undefined) {
      const ev =
        s.op === "mode"
          ? writeMode(spec, st, s.reg, s.bit, s.value ?? 0)
          : writeBit(
              spec,
              st,
              s.reg,
              s.bit,
              s.op === "set" ? 1 : s.op === "clear" ? 0 : ((readReg(spec, st, s.reg, high) >>> s.bit) & 1 ? 0 : 1),
              high,
            );
      if (ev) st.event = ev;
    }
    st.pc = (st.pc + 1) % steps.length;
  }
}

export function parseSteps(raw: unknown): Step[] {
  try {
    const list = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(list) ? list.filter((s) => s && typeof s.op === "string") : [];
  } catch {
    return [];
  }
}
