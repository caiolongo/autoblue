import type { FlowEdge } from "./flow";

/** Cor de um fio pela tensão: 0 V neutro, até vermelho na maior tensão do circuito. */
export function voltColor(v: number, vmax: number): string {
  if (vmax <= 1e-6) return "var(--muted)";
  const t = Math.max(-1, Math.min(1, v / vmax));
  const pct = Math.round(Math.abs(t) * 100);
  return `color-mix(in oklab, ${t >= 0 ? "var(--e-vcc)" : "var(--brand)"} ${pct}%, var(--muted))`;
}

export const FLOW_SPACING = 16;

/**
 * Velocidade das partículas (unidades/s), em escala logarítmica: 1 µA quase parado,
 * 20 mA bem visível, amperes rapidíssimo.
 */
export function flowSpeed(i: number): number {
  return Math.min(140, Math.max(8, 18 * Math.log10(Math.abs(i) / 1e-6)));
}

/** Maior corrente em cada fio. */
export function wireCurrents(flows: FlowEdge[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of flows) out.set(f.wire, Math.max(out.get(f.wire) ?? 0, Math.abs(f.i)));
  return out;
}
