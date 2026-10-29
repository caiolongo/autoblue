import type { Doc } from "../features/editor/doc";
import type { Netlist } from "../features/editor/netlist";

export type PinKind = "vcc" | "gnd" | "gpio" | "reset" | "other";

export interface McuPin {
  name: string;
  title: string;
  kind: PinKind;
  explain: string;
  /** Porta e bit do GPIO (ex.: PB3 = { port: "B", bit: 3 }). */
  io?: { port: string; bit: number };
  /** Aguenta 5 V mesmo com o chip a 3,3 V (sem diodo para o VCC). */
  fiveVolt?: boolean;
  inputOnly?: boolean;
  /** Só puxa para 0; em 1 fica solto (open-drain). */
  openDrain?: boolean;
  /** Pull interno fixo (strapping, reset). */
  pull?: "up" | "down";
  /** Só é GPIO com esta configuração (ex.: RESET vira GPIO com o fusível RSTDISBL). */
  gpioIf?: { prop: string; value: string };
  /** Alimentação do driver do pino, se não for o VCC (ex.: porta C do ATmega328P vem do AVCC). */
  rail?: string;
}

/**
 * Papel de um registrador:
 * dir: 1 = saída · dirInv: 1 = entrada (TRIS do PIC) · out: o que sai no pino · in: o que o pino lê
 * pull/pulldown: liga pull-up/pull-down · set/clr/xor: escrever 1 liga/desliga/inverte o bit de `target`
 * mode4: 4 bits por pino (CRL/CRH do STM32) · clock: liga o clock das portas
 * rbpu: bit 7 em 0 liga os pull-ups da porta B (PIC) · cmcon: comparadores do PORTA (PIC)
 */
export type RegRole = "dir" | "dirInv" | "out" | "in" | "pull" | "pulldown" | "set" | "clr" | "xor" | "mode4" | "clock" | "rbpu" | "cmcon";

export interface McuReg {
  name: string;
  role: RegRole;
  explain: string;
  /** Porta GPIO que o registrador controla. */
  port?: string;
  /** Rótulo de cada bit (índice = bit). Pinos pelo nome; null = bit sem uso aqui. Em mode4, cada item é um campo de 4 bits. */
  bits: (string | null)[];
  reset: number;
  /** Para set/clr/xor: o registrador alterado. */
  target?: string;
}

/** O que o chip precisa para funcionar, verificado a cada quadro. */
export interface CheckCtx {
  doc: Doc;
  netlist: Netlist;
  partId: string;
  props: Record<string, string | number>;
  /** Tensão do pino em relação ao GND do chip. */
  v: (pin: string) => number;
  /** Nível lógico (relativo ao VCC do chip). */
  high: (pin: string) => boolean;
  /** Pino sem nada ligado. */
  lonely: (pin: string) => boolean;
  /** Algum pino de outra peça do tipo `kind`, chamado `pin`, está no mesmo nó? */
  wiredTo: (pin: string, kind: string, otherPin: string) => string | null;
}

export interface CheckResult {
  /** Motivo para o chip não rodar (null = pode rodar). */
  stop: string | null;
  notes: string[];
}

export interface McuSpec {
  kind: string;
  name: string;
  label: string;
  sub: string;
  labelExplain: string;
  summary: string;
  /** Módulo blindado (corpo metálico). */
  module?: boolean;
  /** Mostra só os pinos principais de um encapsulamento maior. */
  partial?: string;
  pins: McuPin[];
  vcc: string;
  gnd: string;
  vMin: number;
  vMax: number;
  absMax: number;
  /** Abaixo disso o chip reinicia (brownout). */
  brownout: number;
  /** Consumo rodando (A). */
  current: number;
  /** Resistência do driver do pino, do pull interno; corrente recomendada e de queima por pino. */
  rout: number;
  rpull: number;
  iPin: number;
  iPinBurn: number;
  regs: McuReg[];
  /** AVR: PORT em 1 num pino de entrada liga o pull-up. */
  pullFromOut?: boolean;
  /** PIC: escrever um bit da porta lê os pinos, muda o bit e regrava tudo. */
  rmw?: boolean;
  /** Ajustes de configuração (fusíveis). */
  config?: Record<string, { label: string; default: string; options: { value: string; label: string }[]; explain: string }>;
  check: (ctx: CheckCtx) => CheckResult;
  /** Lido na partida (pinos de boot). Retorna motivo para não rodar o programa, ou null. */
  boot?: (ctx: CheckCtx) => string | null;
  /** Picos de consumo periódicos (rádio). */
  burst?: { current: number; every: number; length: number };
}

export type StepOp = "set" | "clear" | "toggle" | "mode" | "wait";

/** Um passo da sequência (o "programa" sem código). */
export interface Step {
  op: StepOp;
  reg?: string;
  bit?: number;
  /** Para "mode": código de 4 bits; para "wait": milissegundos. */
  value?: number;
}
