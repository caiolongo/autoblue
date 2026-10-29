import type { Doc, Part } from "../features/editor/doc";
import { getNetlist, pinKey } from "../features/editor/netlist";
import { PARTS } from "../features/library/parts";
import type { McuDef } from "../features/library/parts/mcus";
import type { McuDrive } from "../sim/models";
import type { SimResult } from "../sim/simulate";
import { freshState, parseSteps, pinDrives, runSteps, writeBit, writeMode, type McuState } from "./engine";
import type { CheckCtx, McuSpec } from "./types";

export const specOf = (part: Part | undefined): McuSpec | undefined => (part ? (PARTS[part.kind] as McuDef | undefined)?.mcu : undefined);

/** Garante um estado para cada microcontrolador do documento (e esquece os apagados). */
export function ensureStates(doc: Doc, states: Record<string, McuState>) {
  for (const part of Object.values(doc.parts)) {
    const spec = specOf(part);
    if (spec && !states[part.id]) states[part.id] = freshState(spec);
  }
  for (const id of Object.keys(states)) if (!doc.parts[id]) delete states[id];
}

/** O que cada chip faz nos pinos e quanto consome neste quadro. */
export function drivesFor(doc: Doc, states: Record<string, McuState>): Record<string, { drive: McuDrive; state: McuState }> {
  const out: Record<string, { drive: McuDrive; state: McuState }> = {};
  for (const [id, st] of Object.entries(states)) {
    const part = doc.parts[id];
    const spec = specOf(part);
    if (!part || !spec) continue;
    const burst = spec.burst && st.running && st.phase % spec.burst.every < spec.burst.length;
    const load = st.up ? spec.current + (burst ? spec.burst!.current : 0) : 0;
    out[id] = { drive: { pins: pinDrives(spec, st, part.props), load }, state: st };
  }
  return out;
}

export function ctxFor(doc: Doc, part: Part, spec: McuSpec, result: SimResult): CheckCtx {
  const netlist = getNetlist(doc);
  const pins = result.parts[part.id]?.reading?.pins ?? {};
  const gnd = pins[spec.gnd]?.v ?? 0;
  const v = (p: string) => (pins[p]?.v ?? 0) - gnd;
  const vcc = v(spec.vcc);
  return {
    doc,
    netlist,
    partId: part.id,
    props: part.props,
    v,
    high: (p) => vcc > 0.5 && v(p) > vcc / 2,
    lonely: (p) => (netlist.byPin.get(pinKey(part.id, p))?.pins.length ?? 1) === 1,
    wiredTo: (p, kind, other) =>
      netlist.byPin.get(pinKey(part.id, p))?.pins.find((x) => x.pin === other && doc.parts[x.partId]?.kind === kind)?.partId ?? null,
  };
}

/**
 * Depois de cada quadro: cada chip liga, desliga (brownout) ou reinicia conforme a tensão
 * e o que ele exige; na partida lê os pinos de boot; rodando, avança a sequência.
 */
export function afterFrame(doc: Doc, result: SimResult, states: Record<string, McuState>, duration: number) {
  for (const [id, st] of Object.entries(states)) {
    const part = doc.parts[id];
    const spec = specOf(part);
    if (!part || !spec) continue;
    if (part.damage) {
      Object.assign(st, freshState(spec), { stop: "Queimado." });
      continue;
    }
    const ctx = ctxFor(doc, part, spec, result);
    const vcc = ctx.v(spec.vcc);
    const powered = vcc >= Math.max(spec.brownout, spec.vMin * 0.8);
    const chk = powered ? spec.check(ctx) : { stop: null, notes: [] };
    const stop = !powered
      ? vcc < 0.3
        ? "Sem alimentação."
        : `Tensão baixa (${vcc.toFixed(2)} V): abaixo do mínimo, o chip fica em reset (brownout).`
      : chk.stop;

    if (stop) {
      if (st.up) {
        // Desligou ou reiniciou: registradores voltam ao padrão, como num chip de verdade.
        const resets = st.resets + 1;
        Object.assign(st, freshState(spec), { resets });
      }
      st.stop = stop;
      st.notes = chk.notes;
      continue;
    }
    if (!st.up) {
      st.up = true;
      st.boot = spec.boot?.(ctx) ?? null;
      st.running = !st.boot;
      st.stop = st.boot;
    }
    st.notes = st.resets > 1 ? [...chk.notes, `Reiniciou ${st.resets} vezes desde que a energia foi ligada.`] : chk.notes;
    if (st.running) {
      st.phase += duration;
      runSteps(spec, st, parseSteps(part.props.program), duration, ctx.high);
    }
  }
}

/** Clique num bit (ou troca de modo, no STM32) com o chip ligado. */
export function poke(
  doc: Doc,
  result: SimResult | null,
  states: Record<string, McuState>,
  id: string,
  action: { reg: string; bit: number; value?: 0 | 1; mode?: number },
) {
  const part = doc.parts[id];
  const spec = specOf(part);
  const st = states[id];
  if (!part || !spec || !st?.up || !result) return;
  const high = ctxFor(doc, part, spec, result).high;
  st.event =
    action.mode !== undefined
      ? writeMode(spec, st, action.reg, action.bit, action.mode)
      : writeBit(spec, st, action.reg, action.bit, action.value ?? 1, high);
}
