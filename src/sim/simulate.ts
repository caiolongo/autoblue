import type { Damage, Doc } from "../features/editor/doc";
import { getNetlist, pinKey, type Netlist } from "../features/editor/netlist";
import { PARTS } from "../features/library/parts";
import { solve, transient, type Solution } from "./engine";
import { computeFlows, type FlowEdge } from "./flow";
import { flattenDoc, isBlock } from "../features/blocks/blocks";
import type { McuState } from "../mcu/engine";
import { buildCircuit, PHYS, type Built, type McuDrive } from "./models";
import { judge, type Reading, type Verdict } from "./rules";

export interface PartSim extends Verdict {
  reading: Reading;
  tripped?: boolean;
  damaged?: Damage;
}

export interface SimResult {
  ok: boolean;
  error?: string;
  converged: boolean;
  strategy: string;
  ms: number;
  parts: Record<string, PartSim>;
  /** Tensão de cada nó da netlist. */
  nets: Record<string, number>;
  /** Maior tensão do circuito (para a escala de cores). */
  vmax: number;
  flows: FlowEdge[];
  /** Peças que queimaram agora (ainda não gravadas no documento). */
  newDamage: Record<string, Damage>;
  /** Proteções que atuaram agora. */
  newTrips: string[];
  /** Só no modo tempo. */
  tran?: {
    state: Record<string, number>;
    /** Tensões dos nós no fim do quadro (palpite para o próximo). */
    guess: number[];
    /** [t, tensão de cada sonda] por passo; sonda sem nó = NaN. */
    samples: number[][];
    settled: boolean;
  };
}

export interface SimOptions {
  pressed?: Set<string>;
  /** Microcontroladores: o que os pinos fazem e o estado (registradores) de cada um. */
  mcu?: Record<string, { drive: McuDrive; state: McuState }>;
  /** Proteções já atuando (persistem entre quadros). */
  tripped?: Set<string>;
  /** Simulação no tempo: avança `duration` segundos a partir de `state`. */
  tran?: {
    state: Record<string, number>;
    duration: number;
    steps: number;
    guess: number[];
    t0: number;
    /** Nós (ids da netlist) gravados a cada passo, para o osciloscópio. */
    probes: (string | null)[];
  };
}

/** Soma as correntes e potências dos elementos de cada peça, pino a pino. */
function readings(doc: Doc, netlist: Netlist, built: Built, sol: Solution): Record<string, Reading> {
  const byId = new Map(sol.elements.map((e) => [e.id, e]));
  const out: Record<string, Reading> = {};
  for (const part of Object.values(doc.parts)) {
    const r: Reading = { pins: {}, power: 0 };
    for (const pin of PARTS[part.kind].pins(part.props)) {
      const net = netlist.byPin.get(pinKey(part.id, pin.name))!;
      r.pins[pin.name] = { v: sol.voltages[built.nodeOfNet.get(net.id)!] ?? 0, i: 0 };
    }
    for (const m of built.byPart.get(part.id) ?? []) {
      const res = byId.get(m.el.id);
      if (!res) continue;
      res.currents.forEach((i, t) => (r.pins[m.pins[t]].i += i));
      r.power += res.power;
      if (res.mode) r.mode = res.mode;
    }
    out[part.id] = r;
  }
  return out;
}

function supplyVoltage(doc: Doc) {
  return Math.max(
    0,
    ...Object.values(doc.parts).map((p) =>
      p.kind === "battery9v"
        ? PHYS.battery9v.v
        : p.kind === "cellAA"
          ? PHYS.cellAA.v
          : p.kind === "usb5v"
            ? PHYS.usb.v
            : p.kind === "benchSupply"
              ? Number(p.props.voltage)
              : 0,
    ),
  );
}

const MAX_ROUNDS = 12;

/**
 * Simula o circuito. Quando algo passa do limite, a peça mais sobrecarregada queima
 * (ou uma proteção atua). Em corrente contínua o circuito é resolvido de novo na hora;
 * no modo tempo, a mudança vale a partir do próximo quadro. Assim, quem queima
 * primeiro protege o resto, como na vida real.
 */
export function simulate(original: Doc, opts: SimOptions = {}): SimResult {
  const t0 = performance.now();
  // Blocos viram as peças de dentro (ids "bloco/peça").
  const doc = flattenDoc(original);
  const netlist = getNetlist(doc);
  const pressed = opts.pressed ?? new Set<string>();
  const tripped = new Set(opts.tripped ?? []);
  const newDamage: Record<string, Damage> = {};
  const newTrips: string[] = [];
  const supplyV = supplyVoltage(doc);

  try {
    let built!: Built;
    let sol!: Solution;
    let reads!: Record<string, Reading>;
    let verdicts!: Record<string, Verdict>;
    let tran: SimResult["tran"];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const drives = Object.fromEntries(Object.entries(opts.mcu ?? {}).map(([id, m]) => [id, m.drive]));
      built = buildCircuit(doc, netlist, newDamage, tripped, pressed, drives);
      if (opts.tran) {
        const probes = opts.tran.probes.map((id) => (id === null ? -1 : (built.nodeOfNet.get(id) ?? -1)));
        const out = transient({
          circuit: built.circuit,
          state: opts.tran.state,
          duration: opts.tran.duration,
          steps: opts.tran.steps,
          guess: opts.tran.guess,
          t0: opts.tran.t0,
          probes: probes.map((n) => Math.max(n, 0)),
        });
        sol = out.solution;
        tran = {
          state: out.state,
          guess: out.solution.voltages,
          samples: out.samples.map((row) => row.map((x, k) => (k > 0 && probes[k - 1] < 0 ? NaN : x))),
          settled: out.settled,
        };
      } else {
        sol = solve(built.circuit);
      }
      reads = readings(doc, netlist, built, sol);
      verdicts = {};
      for (const part of Object.values(doc.parts)) {
        if (part.damage || newDamage[part.id]) continue;
        const lonely = new Set(
          PARTS[part.kind]
            .pins(part.props)
            .map((p) => p.name)
            .filter((name) => netlist.byPin.get(pinKey(part.id, name))!.pins.length === 1),
        );
        verdicts[part.id] = judge(part, reads[part.id], {
          supplyV,
          tripped: tripped.has(part.id),
          pressed: pressed.has(part.id),
          lonely,
          state: tran?.state,
          mcu: opts.mcu?.[part.id]?.state,
        });
      }

      // Ordem do que acontece primeiro: junções e sobretensão queimam em microssegundos;
      // proteções (polyfuse, proteção térmica) atuam em milissegundos a segundos; resistores
      // queimam por calor, em segundos. Entre queimas do mesmo tipo, a mais sobrecarregada vai antes.
      const trip = Object.entries(verdicts).find(([, v]) => v.trip);
      const burns = Object.entries(verdicts)
        .filter(([, v]) => v.burn)
        .sort(([, a], [, b]) => Number(!!a.slow) - Number(!!b.slow) || (b.stress ?? 0) - (a.stress ?? 0));
      const worst = burns[0];
      // Quadro sem tempo (só mostrar o instante): picos de nanossegundos, como a carga
      // inicial de um capacitor, não queimam nada nem disparam proteções.
      if (opts.tran && opts.tran.duration < 1e-6) break;
      if (worst && (!worst[1].slow || !trip)) {
        newDamage[worst[0]] = worst[1].burn!;
      } else if (trip) {
        tripped.add(trip[0]);
        newTrips.push(trip[0]);
      }
      if ((!trip && !worst) || opts.tran) break;
    }

    const parts: Record<string, PartSim> = {};
    for (const part of Object.values(doc.parts)) {
      const damaged = part.damage ?? newDamage[part.id];
      parts[part.id] = damaged
        ? { status: "danger", notes: [], why: [], reading: reads[part.id], damaged }
        : { ...verdicts[part.id], reading: reads[part.id], tripped: tripped.has(part.id) || undefined };
    }

    // Cada bloco resume o estado das peças de dentro.
    for (const inst of Object.values(doc.parts).filter(isBlock)) {
      const inside = Object.entries(parts).filter(([id]) => id.startsWith(`${inst.id}/`) && !id.slice(inst.id.length + 1).includes("/"));
      const rank = { idle: 0, ok: 1, warn: 2, danger: 3 } as const;
      const worst = inside.reduce<keyof typeof rank>((w, [, p]) => (rank[p.status] > rank[w] ? p.status : w), "idle");
      parts[inst.id] = {
        ...parts[inst.id],
        status: worst,
        notes: inside.flatMap(([id, p]) => p.notes.map((n) => ({ ...n, text: `${doc.parts[id].ref}: ${n.text}` }))),
        why: [],
      };
    }

    const nets: Record<string, number> = {};
    for (const net of netlist.nets) nets[net.id] = sol.voltages[built.nodeOfNet.get(net.id)!] ?? 0;
    const flows = computeFlows(doc, netlist, (pid, pin) => reads[pid]?.pins[pin]?.i ?? 0);

    return {
      ok: true,
      converged: sol.converged,
      strategy: sol.strategy,
      ms: performance.now() - t0,
      parts,
      nets,
      vmax: Math.max(0, ...Object.values(nets)),
      flows,
      newDamage,
      newTrips,
      tran,
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err),
      converged: false,
      strategy: "",
      ms: performance.now() - t0,
      parts: {},
      nets: {},
      vmax: 0,
      flows: [],
      newDamage: {},
      newTrips: [],
    };
  }
}
