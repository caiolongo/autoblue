/**
 * Ponte para o simulador em Rust (crates/sim-core) compilado para WebAssembly.
 * O circuito vai como JSON para a memória do módulo e o resultado volta em JSON.
 */

export type SimElement =
  | { type: "resistor"; id: string; a: number; b: number; r: number }
  | { type: "source"; id: string; p: number; n: number; v: number; r: number }
  | { type: "supply"; id: string; p: number; n: number; v: number; r: number; ilim: number }
  | { type: "diode"; id: string; a: number; k: number; is: number; n: number; rs: number }
  | { type: "npn"; id: string; c: number; b: number; e: number; is: number; bf: number; br: number }
  | { type: "nmos"; id: string; d: number; g: number; s: number; k: number; vth: number }
  | { type: "pnp"; id: string; c: number; b: number; e: number; is: number; bf: number; br: number }
  | { type: "pmos"; id: string; d: number; g: number; s: number; k: number; vth: number }
  | {
      type: "logic";
      id: string;
      kind: "not" | "buf" | "and" | "nand" | "or" | "nor" | "xor" | "dff" | "decade";
      vcc: number;
      gnd: number;
      ins: number[];
      outs: number[];
      rout: number;
      skew: number;
    }
  | {
      type: "timer555";
      id: string;
      gnd: number;
      trig: number;
      out: number;
      reset: number;
      ctrl: number;
      thresh: number;
      dis: number;
      vcc: number;
    }
  | { type: "capacitor"; id: string; a: number; b: number; c: number }
  | { type: "inductor"; id: string; a: number; b: number; l: number; rs: number }
  | {
      type: "regulator";
      id: string;
      in: number;
      gnd: number;
      out: number;
      vref: number;
      dropout: number;
      iq: number;
      ilim: number;
      rout: number;
    };

export interface SimCircuit {
  nodes: number;
  elements: SimElement[];
  prefer_ref: number[];
}

export interface ElementResult {
  id: string;
  /** Corrente entrando no elemento por cada terminal, na ordem do tipo. */
  currents: number[];
  /** Potência absorvida (W). Negativa = entregando. */
  power: number;
  mode?: "cv" | "cc";
}

export interface Solution {
  converged: boolean;
  iterations: number;
  strategy: string;
  voltages: number[];
  elements: ElementResult[];
}

export interface TransientRequest {
  circuit: SimCircuit;
  /** Tensão de cada capacitor e corrente de cada indutor, por id. */
  state: Record<string, number>;
  duration: number;
  steps: number;
  guess: number[];
  /** Nós gravados a cada passo (osciloscópio). */
  probes: number[];
  t0: number;
}

export interface TransientResult {
  solution: Solution;
  state: Record<string, number>;
  /** [t, tensão de cada nó de `probes`] por passo. */
  samples: number[][];
  settled: boolean;
}

interface Exports {
  memory: WebAssembly.Memory;
  sim_alloc: (len: number) => number;
  sim_free: (ptr: number, cap: number) => void;
  sim_solve: (ptr: number, len: number) => bigint;
  sim_transient: (ptr: number, len: number) => bigint;
}

let wasm: Exports | null = null;

export async function initSimFromBytes(bytes: BufferSource) {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  wasm = instance.exports as unknown as Exports;
}

export async function initSim() {
  const url = (await import("./sim-core.wasm?url")).default;
  await initSimFromBytes(await (await fetch(url)).arrayBuffer());
}

export const simReady = () => wasm !== null;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function call<T>(fn: "sim_solve" | "sim_transient", request: unknown): T {
  if (!wasm) throw new Error("simulador ainda não carregado");
  const input = encoder.encode(JSON.stringify(request));
  const inPtr = wasm.sim_alloc(input.length);
  new Uint8Array(wasm.memory.buffer, inPtr, input.length).set(input);
  const packed = wasm[fn](inPtr, input.length);
  wasm.sim_free(inPtr, input.length);
  const outPtr = Number(packed >> 32n);
  const outLen = Number(packed & 0xffffffffn);
  // Copia antes de liberar: a memória pode ser reaproveitada.
  const text = decoder.decode(new Uint8Array(wasm.memory.buffer, outPtr, outLen).slice());
  wasm.sim_free(outPtr, outLen);
  const out = JSON.parse(text) as { ok?: T; error?: string };
  if (out.error) throw new Error(out.error);
  return out.ok!;
}

/** Ponto de operação em corrente contínua. */
export const solve = (circuit: SimCircuit) => call<Solution>("sim_solve", circuit);

/** Avança no tempo a partir do estado guardado. */
export const transient = (req: TransientRequest) => call<TransientResult>("sim_transient", req);
