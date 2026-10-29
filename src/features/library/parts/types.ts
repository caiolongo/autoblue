import type { FC } from "react";
import type { Rect } from "../../../lib/geometry";
import type { PartSim } from "../../../sim/simulate";

/**
 * power_out: terminal positivo de uma fonte; gnd: terminal negativo/terra;
 * passive: terminal de componente passivo ou semicondutor; io: sinal/dados.
 */
export type PinRole = "power_out" | "gnd" | "passive" | "io";

export interface PinDef {
  name: string;
  /** Posição local, múltiplos de GRID. */
  x: number;
  y: number;
  role: PinRole;
  title: string;
  explain: string;
  /** Sugestão de nome para o nó ligado a este pino (ex.: "GND", "VBUS"). */
  net?: string;
}

/** Algo impresso ou visível na peça, com a explicação do que significa. */
export interface Marking {
  text: string;
  explain: string;
}

export type PropValue = number | string;
export type Props = Record<string, PropValue>;

export type PropDef =
  | { type: "number"; label: string; unit: string; default: number; min?: number; max?: number; explain?: string }
  | { type: "text"; label: string; default: string; explain?: string }
  | {
      type: "select";
      label: string;
      default: string;
      options: { value: string; label: string }[];
      explain?: string;
    };

export interface BodyProps {
  p: Props;
  mk: Record<string, Marking>;
  /** Estado da simulação, quando a energia está ligada. */
  live?: PartSim;
  /** Botão sendo apertado agora. */
  pressed?: boolean;
}

export interface PartDef {
  kind: string;
  name: string;
  group: string;
  /** Prefixo do designador impresso na placa: R1, D1, Q1… */
  prefix: string;
  summary: string;
  props: Record<string, PropDef>;
  pins: (p: Props) => PinDef[];
  /** Área ocupada, em coordenadas locais. */
  bounds: Rect;
  markings: (p: Props) => Record<string, Marking>;
  /** Valor curto mostrado ao lado do designador (ex.: "220 Ω"). */
  value?: (p: Props) => string;
  Body: FC<BodyProps>;
}

export const num = (p: Props, k: string) => Number(p[k]);
export const str = (p: Props, k: string) => String(p[k]);
