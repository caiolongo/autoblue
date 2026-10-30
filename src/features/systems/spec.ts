import type { PartSpec } from "../blocks/boards";
import type { Step } from "../../mcu/types";

/** Ordem em que os grupos aparecem na biblioteca: do mais simples para o mais completo. */
export const SYSTEM_GROUPS = ["Energia", "Transistores", "Temporizadores", "Lógica digital", "Microcontroladores"] as const;

export type SystemGroup = (typeof SYSTEM_GROUPS)[number];

/** O que aparece no inspetor enquanto o sistema está aberto. */
export interface SystemGuide {
  /** Como funciona, na ordem em que a energia ou o sinal percorre o circuito. */
  how: string[];
  /** As contas, com os valores deste circuito. */
  math: string[];
  /** Papel de cada peça neste circuito, por designador. */
  roles: Record<string, string>;
  /** O que mudar para ver o circuito reagir. */
  tryIt: string[];
}

export interface SystemSpec {
  id: string;
  name: string;
  group: SystemGroup;
  /** Uma frase, mostrada na lista. */
  summary: string;
  parts: PartSpec[];
  /** Cada nó: pinos "REF.PINO". Os primeiros nós ganham os caminhos mais diretos. */
  nets: string[][];
  /** Nós desenhados como trilho horizontal: pino de qualquer um deles → y do trilho, em passos de 0,1". */
  rails?: Record<string, number>;
  guide: SystemGuide;
}

/** Passos da sequência gravada nos microcontroladores. */
export const program = (...steps: Step[]) => JSON.stringify(steps);
export const set = (reg: string, bit: number): Step => ({ op: "set", reg, bit });
export const clear = (reg: string, bit: number): Step => ({ op: "clear", reg, bit });
export const toggle = (reg: string, bit: number): Step => ({ op: "toggle", reg, bit });
export const mode = (reg: string, field: number, code: number): Step => ({ op: "mode", reg, bit: field, value: code });
export const wait = (ms: number): Step => ({ op: "wait", value: ms });
