import { produce } from "immer";
import { create } from "zustand";
import type { Damage } from "../features/editor/doc";
import { useDoc } from "../features/editor/store";
import { probeNet, useInstruments } from "../features/instruments/store";
import type { McuState } from "../mcu/engine";
import { parseSteps } from "../mcu/engine";
import { afterFrame, drivesFor, ensureStates, poke, specOf } from "../mcu/runtime";
import { flattenDoc } from "../features/blocks/blocks";
import { simReady } from "./engine";
import { simulate, type SimResult } from "./simulate";

/** Velocidades: tempo simulado por segundo de relógio. */
export const SPEEDS = [1, 0.1, 0.01, 0.001];

/** Passos de simulação por quadro (~60 quadros/s). */
const STEPS = 60;
/** Quadro mais longo considerado (aba em segundo plano não vira um salto enorme). */
const MAX_WALL = 0.05;
const SCOPE_MAX = 4000;

interface SimState {
  /** Energia ligada: com ela desligada nada é simulado e nada queima. */
  powered: boolean;
  paused: boolean;
  speed: number;
  /** Tempo simulado desde que a energia foi ligada (s). */
  t: number;
  result: SimResult | null;
  /** Botões sendo apertados agora. */
  pressed: Set<string>;
  /** Muda a cada amostra nova do osciloscópio. */
  scopeVersion: number;
  /** Muda quando o estado dos microcontroladores muda. */
  mcuVersion: number;
  setPowered: (on: boolean) => void;
  setPaused: (p: boolean) => void;
  setSpeed: (s: number) => void;
  /** Avança um quadro com a simulação pausada. */
  step: () => void;
  /** Volta ao tempo zero: capacitores descarregados, proteções rearmadas. */
  reset: () => void;
  press: (id: string, down: boolean) => void;
  /** Clique num bit de registrador (ou modo de pino) de um microcontrolador ligado. */
  poke: (id: string, action: { reg: string; bit: number; value?: 0 | 1; mode?: number }) => void;
}

/** Amostras do osciloscópio: tempo e tensão de cada canal. */
export const scope = { t: [] as number[], ch1: [] as number[], ch2: [] as number[] };

/** Estado que passa de um quadro para o outro. */
const rt = {
  state: {} as Record<string, number>,
  guess: [] as number[],
  tripped: new Set<string>(),
  /** Segundos em sobrecarga (fusíveis). */
  overload: {} as Record<string, number>,
  raf: 0,
  last: 0,
  settled: false,
  /** Próxima mudança no documento é nossa (peça queimando), não do usuário. */
  ownChange: false,
  /** Microcontroladores: registradores e estado (somem quando a energia desliga). */
  mcu: {} as Record<string, McuState>,
};

/** Estado atual dos microcontroladores, para o inspetor. */
export const mcuStates = () => rt.mcu;

function clearRuntime() {
  rt.state = {};
  rt.guess = [];
  rt.tripped.clear();
  rt.overload = {};
  rt.settled = false;
  rt.mcu = {};
  scope.t.length = scope.ch1.length = scope.ch2.length = 0;
}

export const useSim = create<SimState>((set, get) => ({
  powered: true,
  paused: false,
  speed: 1,
  t: 0,
  result: null,
  pressed: new Set(),
  scopeVersion: 0,
  mcuVersion: 0,
  setPowered: (powered) => {
    clearRuntime();
    set({ powered, t: 0, result: null });
    if (powered) refresh();
  },
  setPaused: (paused) => {
    set({ paused });
    if (!paused) wake();
  },
  setSpeed: (speed) => {
    set({ speed });
    wake();
  },
  step: () => {
    if (!get().powered) return;
    set({ paused: true });
    frame(get().speed / 60);
  },
  reset: () => {
    clearRuntime();
    set({ t: 0 });
    refresh();
  },
  press: (id, down) => {
    const pressed = new Set(get().pressed);
    if (down) pressed.add(id);
    else pressed.delete(id);
    set({ pressed });
    refresh();
  },
  poke: (id, action) => {
    poke(useDoc.getState().doc, get().result, rt.mcu, id, action);
    refresh();
  },
}));

function scopeActive() {
  const { probes } = useInstruments.getState();
  return !!(probes.ch1 || probes.ch2);
}

function appendScope(samples: number[][]) {
  // Guarda ~1000 pontos por tela, qualquer que seja a base de tempo.
  const minGap = (useInstruments.getState().timeDiv * 10) / 1000;
  for (const [t, a, b] of samples) {
    const last = scope.t[scope.t.length - 1];
    if (last !== undefined && t - last < minGap) continue;
    scope.t.push(t);
    scope.ch1.push(a);
    scope.ch2.push(b);
  }
  const extra = scope.t.length - SCOPE_MAX;
  if (extra > 0) for (const arr of [scope.t, scope.ch1, scope.ch2]) arr.splice(0, extra);
}

/** Simula `duration` segundos (0 = só recalcula o instante atual, sem andar no tempo). */
function frame(duration: number) {
  const sim = useSim.getState();
  if (!sim.powered || !simReady()) return;
  const { doc: original, replace } = useDoc.getState();
  // Microcontroladores dentro de blocos também rodam: o runtime vê o documento achatado.
  const doc = flattenDoc(original);
  ensureStates(doc, rt.mcu);

  const result = simulate(doc, {
    pressed: sim.pressed,
    tripped: rt.tripped,
    mcu: drivesFor(doc, rt.mcu),
    tran: {
      state: rt.state,
      duration: duration > 0 ? duration : 1e-9,
      // Pausado: vários passos minúsculos, para a lógica digital propagar sem o tempo andar.
      steps: duration > 0 ? STEPS : 20,
      guess: rt.guess,
      t0: sim.t,
      probes: [probeNet(doc, "ch1")?.id ?? null, probeNet(doc, "ch2")?.id ?? null],
    },
  });
  if (!result.ok || !result.tran) {
    useSim.setState({ result });
    return;
  }
  rt.state = result.tran.state;
  rt.guess = result.tran.guess;
  for (const id of result.newTrips) rt.tripped.add(id);

  // Fusíveis: sobrecarga que dura tempo demais queima.
  const burned: Record<string, Damage> = { ...result.newDamage };
  for (const [id, p] of Object.entries(result.parts)) {
    if (!p.overload) {
      delete rt.overload[id];
      continue;
    }
    rt.overload[id] = (rt.overload[id] ?? 0) + duration;
    if (rt.overload[id] >= p.overload.seconds) burned[id] = p.overload.burn;
  }

  if (duration > 0) appendScope(result.tran.samples);
  const sig = () => JSON.stringify(Object.values(rt.mcu).map((m) => [m.up, m.running, m.regs]));
  const before = sig();
  afterFrame(doc, result, rt.mcu, duration);
  // Chip que mudou só aparece nos pinos no próximo quadro; sequência e rádio andam com o tempo.
  const mcuBusy =
    sig() !== before ||
    Object.entries(rt.mcu).some(
      ([id, m]) => m.running && (parseSteps(doc.parts[id]?.props.program).length > 0 || !!specOf(doc.parts[id])?.burst),
    );
  useSim.setState((s) => ({
    mcuVersion: s.mcuVersion + 1,
    result,
    t: s.t + (duration > 0 ? duration : 0),
    scopeVersion: duration > 0 ? s.scopeVersion + 1 : s.scopeVersion,
  }));
  rt.settled = result.tran.settled && !Object.keys(burned).length && !result.newTrips.length && !mcuBusy;

  if (Object.keys(burned).length) {
    rt.ownChange = true;
    replace(
      produce(original, (d) => {
        for (const [id, damage] of Object.entries(burned)) {
          // Peça dentro de bloco: o dano fica guardado no bloco (por id interno).
          const [inst, ...rest] = id.split("/");
          if (!d.parts[inst]) continue;
          if (rest.length) d.parts[inst].inner = { ...d.parts[inst].inner, [rest.join("/")]: damage };
          else d.parts[inst].damage = damage;
        }
      }),
    );
  }
}

function tick(now: number) {
  rt.raf = 0;
  const s = useSim.getState();
  if (!s.powered || s.paused) return;
  const wall = Math.min((now - rt.last) / 1000, MAX_WALL);
  rt.last = now;
  frame(wall * s.speed);
  // Parado e sem nada para mostrar no osciloscópio: dorme até a próxima mudança.
  if (!rt.settled || scopeActive() || s.pressed.size) rt.raf = requestAnimationFrame(tick);
}

function wake() {
  if (rt.raf || !useSim.getState().powered || useSim.getState().paused) return;
  rt.last = performance.now();
  rt.raf = requestAnimationFrame(tick);
}

/** Algo mudou: mostra na hora e volta a andar no tempo. */
function refresh() {
  frame(0);
  wake();
}

/** Liga a simulação ao vivo: roda a cada mudança no documento e ao longo do tempo. */
export function startSimulation() {
  useDoc.subscribe((s, prev) => {
    if (s.doc === prev.doc) return;
    // Editar o circuito rearma as proteções; queimar uma peça, não.
    if (!rt.ownChange) rt.tripped.clear();
    rt.ownChange = false;
    rt.settled = false;
    refresh();
  });
  useInstruments.subscribe((s, prev) => {
    if (s.probes !== prev.probes) wake();
  });
  refresh();
}
