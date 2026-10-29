import type { Damage, Part } from "../features/editor/doc";
import { PARTS } from "../features/library/parts";
import { FAMILIES, type ChipDef, type Unit } from "../features/library/parts/chips";
import { LED_COLORS } from "../features/library/parts/semis";
import type { McuDef } from "../features/library/parts/mcus";
import { SMALL_MOSFETS } from "../features/library/parts/transistors";
import { isGpio, pinDrives, type McuState } from "../mcu/engine";
import { num, str } from "../features/library/parts/types";
import { formatSI } from "../lib/si";
import { PHYS, potFraction } from "./models";

export interface PinReading {
  /** Tensão do pino em relação ao GND. */
  v: number;
  /** Corrente entrando na peça por este pino. */
  i: number;
}

export interface Reading {
  pins: Record<string, PinReading>;
  /** Potência absorvida (W). Negativa = a peça está entregando energia. */
  power: number;
  mode?: "cv" | "cc";
}

export type Level = "info" | "warn" | "danger";

export interface Note {
  level: Level;
  text: string;
}

export interface Verdict {
  status: "idle" | "ok" | "warn" | "danger";
  notes: Note[];
  /** A conta, passo a passo, com os números de agora. */
  why: string[];
  /** Brilho do LED, 0–1. */
  glow?: number;
  /** Quão perto do limite térmico, 0–1+. */
  heat?: number;
  /** Se definido, a peça queima com este dano. */
  burn?: Damage;
  /** Quanto passou do limite de queima (para decidir quem queima primeiro). */
  stress?: number;
  /** Queima por aquecimento, que leva segundos (resistor, trilha, enrolamento): proteções atuam antes. */
  slow?: boolean;
  /** Proteção interna atua (fusível do USB, proteção térmica). */
  trip?: boolean;
  /** Sobrecarga sustentada: queima se durar estes segundos. */
  overload?: { seconds: number; burn: Damage };
}

export interface Context {
  /** Tensão que alimenta o ramo do LED, contada a partir do cátodo (para sugerir o resistor). */
  supplyV: number;
  tripped: boolean;
  pressed: boolean;
  /** Pinos desta peça que não estão ligados a mais nada. */
  lonely: Set<string>;
  /** Estado interno da simulação no tempo (flip-flops, contadores, 555). */
  state?: Record<string, number>;
  /** Estado do microcontrolador (registradores, rodando ou não). */
  mcu?: McuState;
}

/** Restos numéricos do simulador (pV, fA) aparecem como zero. */
export const V = (v: number) => formatSI(Math.abs(v) < 1e-6 ? 0 : v, "V");
export const A = (i: number) => formatSI(Math.abs(i) < 1e-9 ? 0 : i, "A");
export const W = (p: number) => formatSI(p, "W");
const R = (r: number) => formatSI(r, "Ω");

const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82];

/** Próximo valor comercial (série E12) acima de `ohms`. */
export function e12Above(ohms: number): number {
  const decade = 10 ** Math.floor(Math.log10(ohms) - 1);
  for (let d = decade; ; d *= 10) {
    const v = E12.map((x) => x * d).find((x) => x >= ohms * 0.999);
    if (v) return v;
  }
}

const IDLE = 1e-7;

type Rule = (part: Part, r: Reading, ctx: Context) => Verdict;

const pin = (r: Reading, name: string): PinReading => r.pins[name] ?? { v: 0, i: 0 };

function source(r: Reading, ctx: Context, plus: string, minus: string, rInt: number, warnAt: number, vNom: number): Verdict {
  const i = -pin(r, plus).i;
  const vt = pin(r, plus).v - pin(r, minus).v;
  if (Math.abs(i) < IDLE) {
    return { status: "idle", notes: [], why: [`Nada consumindo: a fonte está parada em ${V(vt)}.`] };
  }
  const notes: Note[] = [];
  const why = [
    i < 0 ? `Recebendo ${A(-i)}: a corrente entra pelo +.` : `Entregando ${A(i)} ao circuito.`,
    `Tensão nos terminais: ${V(vNom)} ${i < 0 ? "+" : "−"} ${A(Math.abs(i))} × ${R(rInt)} (resistência interna) = ${V(vt)}.`,
    `Potência ${i < 0 ? "recebida" : "entregue"}: P = V × I = ${W(Math.abs(vt * i))}.`,
    `Perdido como calor dentro da fonte: I² × r = ${W(i * i * rInt)}.`,
  ];
  if (i < 0) {
    notes.push({
      level: "warn",
      text: "A corrente está entrando pelo +: outra fonte maior está empurrando corrente para dentro desta.",
    });
  } else if (i > warnAt && !ctx.tripped) {
    notes.push({
      level: "danger",
      text: `Corrente muito alta (${A(i)}): praticamente um curto. A fonte esquenta e a tensão despenca.`,
    });
  }
  return { status: notes.length ? "warn" : "ok", notes, why, heat: Math.abs(i) / warnAt };
}

const RULES: Record<string, Rule> = {
  battery9v: (_part, r, ctx) => source(r, ctx, "+", "-", PHYS.battery9v.r, 1, PHYS.battery9v.v),
  cellAA: (_part, r, ctx) => source(r, ctx, "+", "-", PHYS.cellAA.r, 2, PHYS.cellAA.v),

  usb5v: (_part, r, ctx) => {
    const rInt = ctx.tripped ? PHYS.usb.rTripped : PHYS.usb.r;
    const v = source(r, ctx, "VBUS", "GND", rInt, PHYS.usb.trip, PHYS.usb.v);
    const i = -pin(r, "VBUS").i;
    if (ctx.tripped) {
      v.status = "warn";
      v.notes.unshift({
        level: "danger",
        text: `O fusível F1 desarmou: a corrente passou de ${A(PHYS.usb.trip)}. Agora ele limita a ~${A(i)}. Tire o curto e ele volta sozinho.`,
      });
    } else if (i > PHYS.usb.trip) {
      v.trip = true;
    } else if (i > PHYS.usb.rated) {
      v.status = "warn";
      v.notes.push({ level: "warn", text: `Acima dos ${A(PHYS.usb.rated)} que uma porta USB 2.0 garante.` });
    }
    return v;
  },

  benchSupply: (part, r, ctx) => {
    const set = num(part.props, "voltage");
    const v = source(r, ctx, "+", "-", PHYS.benchR, Infinity, set);
    if (r.mode === "cc") {
      const vt = pin(r, "+").v - pin(r, "-").v;
      v.status = "warn";
      v.notes.unshift({
        level: "warn",
        text: `Limitando a corrente (CC): o circuito pediu mais que ${A(num(part.props, "current"))}, então a fonte baixou a tensão para ${V(vt)} para proteger tudo.`,
      });
    }
    return v;
  },

  resistor: (part, r) => {
    const rating = Number(part.props.power);
    const vab = pin(r, "1").v - pin(r, "2").v;
    const i = Math.abs(pin(r, "1").i);
    const p = Math.abs(r.power);
    if (i < IDLE) {
      return { status: "idle", notes: [], why: ["Não passa corrente: não existe caminho fechado passando por este resistor."] };
    }
    const why = [
      `Tensão entre os terminais: ${V(Math.abs(vab))}.`,
      `Lei de Ohm: I = V / R = ${V(Math.abs(vab))} / ${R(num(part.props, "resistance"))} = ${A(i)}.`,
      `Calor: P = V × I = ${W(p)} (aguenta ${W(rating)}).`,
    ];
    const v: Verdict = { status: "ok", notes: [], why, heat: p / rating, stress: p / (2 * rating) };
    if (p > 2 * rating) {
      v.burn = {
        mode: "open",
        reason: `Dissipou ${W(p)}, mais que o dobro dos ${W(rating)} que aguenta. Esquentou até queimar e abriu.`,
      };
      v.slow = true;
    } else if (p > rating) {
      v.status = "warn";
      v.notes.push({
        level: "warn",
        text: "Acima da potência máxima: está esquentando demais. Use um resistor maior em ohms ou de mais watts.",
      });
    }
    return v;
  },

  potentiometer: (part, r) => {
    const rating = 0.25;
    const total = num(part.props, "resistance");
    const f = potFraction(part.props);
    const p = Math.abs(r.power);
    const why = [
      `Cursor em ${num(part.props, "position")}%: entre 1 e 2 há ${R(total * f)}; entre 2 e 3, ${R(total * (1 - f))}.`,
      `Tensões: pino 1 = ${V(pin(r, "1").v)}, cursor = ${V(pin(r, "2").v)}, pino 3 = ${V(pin(r, "3").v)}.`,
      `Calor na trilha: ${W(p)} (aguenta ${W(rating)}).`,
    ];
    const v: Verdict = { status: p < 1e-9 ? "idle" : "ok", notes: [], why, heat: p / rating, stress: p / (2 * rating) };
    if (p > 2 * rating) {
      v.burn = { mode: "open", reason: `A trilha dissipou ${W(p)} e queimou.` };
      v.slow = true;
    }
    else if (p > rating) v.notes.push({ level: "warn", text: "Acima da potência da trilha: esquentando." });
    if (v.notes.length) v.status = "warn";
    return v;
  },

  capacitor: (part, r) => {
    const elec = str(part.props, "type") === "electrolytic";
    const [a, b] = elec ? ["+", "-"] : ["1", "2"];
    const vab = pin(r, a).v - pin(r, b).v;
    const c = num(part.props, "capacitance");
    const vmax = num(part.props, "voltage");
    const i = pin(r, a).i;
    const why = [
      Math.abs(i) > 1e-6
        ? `${i > 0 ? "Carregando" : "Descarregando"}: ${A(Math.abs(i))} ${i > 0 ? "entrando" : "saindo"}. A tensão sobe ou desce aos poucos, e não de uma vez.`
        : "Parado: carregado até a tensão do circuito, já não passa corrente (em corrente contínua o capacitor é um circuito aberto).",
      `Tensão: ${V(vab)}.`,
      `Carga guardada: Q = C × V = ${formatSI(Math.abs(c * vab), "C")}.`,
      `Energia guardada: E = ½ × C × V² = ${formatSI(0.5 * c * vab * vab, "J")}.`,
    ];
    const v: Verdict = { status: Math.abs(vab) < 1e-6 && Math.abs(i) < 1e-6 ? "idle" : "ok", notes: [], why, stress: Math.abs(vab) / vmax };
    if (elec && vab < -1) {
      v.burn = { mode: "open", reason: `Ligado ao contrário (${V(vab)} no +). O eletrolítico estufou.` };
      v.stress = -vab;
    } else if (Math.abs(vab) > vmax) {
      v.burn = { mode: "open", reason: `Recebeu ${V(Math.abs(vab))}, acima dos ${V(vmax)} que aguenta. O dielétrico rompeu.` };
    } else if (elec && vab < -0.3) {
      v.status = "warn";
      v.notes.push({ level: "warn", text: "Tensão invertida no eletrolítico. Acima de ~1 V ao contrário ele estufa." });
    } else if (Math.abs(vab) > 0.8 * vmax) {
      v.status = "warn";
      v.notes.push({ level: "warn", text: "Perto da tensão máxima. O normal é deixar uma folga de 20% ou mais." });
    }
    return v;
  },

  inductor: (_part, r) => {
    const i = Math.abs(pin(r, "1").i);
    if (i < IDLE) return { status: "idle", notes: [], why: ["Não passa corrente."] };
    const v: Verdict = {
      status: "ok",
      notes: [],
      why: [
        Math.abs(pin(r, "1").v - pin(r, "2").v) > i * PHYS.inductorDcr + 1e-3
          ? `A corrente está mudando, e o indutor reage: ${V(Math.abs(pin(r, "1").v - pin(r, "2").v))} entre os terminais seguram a mudança (V = L × ΔI/Δt).`
          : "Corrente estável: em corrente contínua, o indutor é só um fio enrolado.",
        `Corrente: ${A(i)}. Queda na resistência do fio (${R(PHYS.inductorDcr)}): ${V(i * PHYS.inductorDcr)}.`,
      ],
      heat: i / 1,
      stress: i / 3,
    };
    if (i > 3) {
      v.burn = { mode: "open", reason: `Passaram ${A(i)}: o fio fino do enrolamento derreteu.` };
      v.slow = true;
    }
    else if (i > 1) {
      v.status = "warn";
      v.notes.push({ level: "warn", text: "Corrente alta para um indutor pequeno: esquentando." });
    }
    return v;
  },

  led: (part, r, ctx) => {
    const c = LED_COLORS[str(part.props, "color")];
    const { iRated, iMax, iBurn, vReverse } = PHYS.led;
    const i = pin(r, "A").i;
    const vd = pin(r, "A").v - pin(r, "K").v;
    const why: string[] = [];
    const notes: Note[] = [];
    const v: Verdict = { status: "ok", notes, why, glow: 0, stress: i / iBurn };

    if (i < 50e-6) {
      v.status = "idle";
      if (vd < -0.05) {
        why.push(`Está ao contrário: o cátodo está ${V(-vd)} acima do ânodo. Um LED só conduz do ânodo (+) para o cátodo (−).`);
        if (-vd > vReverse) {
          notes.push({ level: "warn", text: `Mais de ${V(vReverse)} ao contrário pode danificar o LED.` });
          v.status = "warn";
        }
      } else if (vd > 0.05) {
        why.push(`Tensão de ${V(vd)} entre os terminais: pouco para acender. Um LED ${c.label.toLowerCase()} precisa de ~${V(c.vf)}.`);
      } else {
        why.push("Sem tensão: não existe caminho fechado passando pelo LED.");
      }
      return v;
    }

    v.glow = Math.min(1, (i / iRated) ** 0.6);
    why.push(
      `Queda no LED: ${V(vd)} (o típico para ${c.label.toLowerCase()} é ${V(c.vf)}).`,
      `Corrente: ${A(i)} → brilho ${Math.round(v.glow * 100)}%.`,
      `Potência: ${W(vd * i)}.`,
    );
    if (i > iBurn) {
      v.burn = {
        mode: "open",
        reason: `Passaram ${A(i)}, e o máximo é ${A(iMax)}. Sem um resistor limitando, o LED queimou e virou circuito aberto.`,
      };
    } else if (i > iMax) {
      v.status = "warn";
      notes.push({ level: "warn", text: `Acima de ${A(iMax)}: muito brilho agora, mas o LED vai durar pouco.` });
    }
    if (i > iRated * 1.25 && ctx.supplyV > c.vf) {
      const target = 0.015;
      const ideal = (ctx.supplyV - c.vf) / target;
      why.push(
        `Para ~${A(target)} com ${V(ctx.supplyV)}: R = (${V(ctx.supplyV)} − ${V(c.vf)}) / ${A(target)} = ${R(ideal)} → use ${R(e12Above(ideal))} em série.`,
      );
    }
    return v;
  },

  diode: (part, r) => {
    const d = PHYS.diodes[str(part.props, "model")];
    const i = pin(r, "A").i;
    const vd = pin(r, "A").v - pin(r, "K").v;
    const v: Verdict = { status: "ok", notes: [], why: [], stress: Math.max(i / (2 * d.iMax), -vd / d.vrrm), heat: i / d.iMax };
    if (-vd > d.vrrm) {
      v.burn = {
        mode: "short",
        reason: `${V(-vd)} ao contrário, acima dos ${V(d.vrrm)} que o ${str(part.props, "model")} aguenta. A junção rompeu e o diodo virou um curto.`,
      };
      return v;
    }
    if (i < 1e-6) {
      v.status = "idle";
      v.why.push(
        vd < -0.05
          ? `Bloqueando: o cátodo está ${V(-vd)} acima do ânodo, então a corrente não passa. É para isso que o diodo serve.`
          : `Tensão de ${V(vd)}: abaixo da que ele precisa para conduzir.`,
      );
      return v;
    }
    v.why.push(`Conduzindo ${A(i)} do ânodo para o cátodo.`, `Queda no diodo: ${V(vd)}. Calor: ${W(vd * i)}.`);
    if (i > 2 * d.iMax) v.burn = { mode: "open", reason: `Passaram ${A(i)}; o máximo do ${str(part.props, "model")} é ${A(d.iMax)}.` };
    else if (i > d.iMax) {
      v.status = "warn";
      v.notes.push({ level: "warn", text: `Acima de ${A(d.iMax)}: esquentando além do limite.` });
    }
    return v;
  },

  npn: (part, r) => {
    const q = PHYS.bjts[str(part.props, "model")];
    const vbe = pin(r, "B").v - pin(r, "E").v;
    const vce = pin(r, "C").v - pin(r, "E").v;
    const ib = pin(r, "B").i;
    const ic = pin(r, "C").i;
    const p = Math.abs(r.power);
    const why = [`Vbe = ${V(vbe)}, Vce = ${V(vce)}.`];
    let status: Verdict["status"] = "ok";
    if (vbe < 0.5 || Math.abs(ic) < 1e-7) {
      status = "idle";
      why.push(
        "Em corte: a base precisa de ~0,65 V acima do emissor para o transistor ligar. Sem isso, não passa corrente entre coletor e emissor.",
      );
    } else {
      why.push(`Corrente na base: ${A(ib)}. Corrente no coletor: ${A(ic)}.`);
      if (vce < 0.25) {
        why.push(
          `Saturado: ligado como uma chave fechada. Só ${V(vce)} sobram entre coletor e emissor; quem limita a corrente é o resto do circuito.`,
        );
      } else {
        why.push(`Região ativa: amplificando. Ic ≈ β × Ib → β ≈ ${(ic / ib).toFixed(0)}.`);
      }
      why.push(`Calor: P ≈ Vce × Ic = ${W(p)} (aguenta ~${W(q.pMax)}).`);
    }
    const v: Verdict = { status, notes: [], why, heat: p / q.pMax, stress: Math.max(ic / (2 * q.icMax), p / (2 * q.pMax), ib / 0.2, vce / q.vceo) };
    if (ib > 0.2) {
      v.burn = { mode: "open", reason: `Passaram ${A(ib)} pela base, sem resistor limitando. A junção base-emissor queimou.` };
    } else if (vce > q.vceo) {
      v.burn = {
        mode: "short",
        reason: `${V(vce)} entre coletor e emissor, acima dos ${V(q.vceo)} que o ${str(part.props, "model")} aguenta. A junção rompeu e queimou em curto.`,
      };
    } else if (ic > 2 * q.icMax || p > 2 * q.pMax) {
      v.burn = {
        mode: "short",
        reason: `Coletor com ${A(ic)} e ${W(p)} de calor, muito acima do que o encapsulamento aguenta. Queimou em curto: coletor e emissor ficaram ligados direto.`,
      };
    } else if (ic > q.icMax || p > q.pMax) {
      v.status = "warn";
      v.notes.push({ level: "warn", text: "Acima do limite de corrente ou de calor: está esquentando demais." });
    }
    return v;
  },

  mosfet: (part, r) => {
    const m = PHYS.mosfets[str(part.props, "model")];
    const vgs = pin(r, "G").v - pin(r, "S").v;
    const vds = pin(r, "D").v - pin(r, "S").v;
    const id = pin(r, "D").i;
    const p = Math.abs(r.power);
    const why = [`Vgs = ${V(vgs)} (liga a partir de ~${V(m.vth)}). Vds = ${V(vds)}.`];
    let status: Verdict["status"] = "ok";
    if (vgs < m.vth && Math.abs(id) < 1e-4) {
      status = "idle";
      why.push("Desligado: a tensão na porta não chega ao limiar, então o canal entre dreno e fonte fica fechado.");
    } else {
      why.push(`Corrente do dreno para a fonte: ${A(id)}.`);
      if (id < -1e-4) why.push("Corrente ao contrário: passa pelo diodo interno (de S para D) que todo MOSFET tem.");
      else if (vds < vgs - m.vth) why.push(`Totalmente ligado: o canal age como um resistor de Rds ≈ ${R(Math.abs(vds / id))}.`);
      else why.push("Parcialmente ligado (saturação): a corrente depende de Vgs. Aqui ele esquenta mais.");
      why.push(`Calor: P = Vds × Id = ${W(p)}.`);
    }
    const v: Verdict = { status, notes: [], why, heat: p / m.pWarn, stress: Math.max(p / m.pBurn, Math.abs(vgs) / m.vgsMax, id / m.idMax, vds / m.vdsMax) };
    if (Math.abs(vgs) > m.vgsMax) {
      v.burn = { mode: "short", reason: `Passou de ${V(m.vgsMax)} entre porta e fonte: a camada isolante da porta furou.` };
    } else if (vds > m.vdsMax) {
      v.burn = { mode: "short", reason: `${V(vds)} entre dreno e fonte, acima dos ${V(m.vdsMax)} que ele aguenta. Rompeu e queimou em curto.` };
    } else if (p > m.pBurn || id > m.idMax) {
      const cause = id > m.idMax ? `Passaram ${A(id)}, acima dos ${A(m.idMax)} que ele aguenta.` : `Dissipou ${W(p)} sem dissipador de calor.`;
      v.burn = { mode: "short", reason: `${cause} Queimou em curto: dreno e fonte ficaram ligados direto.` };
    } else if (p > m.pWarn) {
      v.status = "warn";
      v.notes.push({ level: "warn", text: `Dissipando ${W(p)}: sem dissipador, um TO-220 aguenta só ~1–2 W.` });
    }
    return v;
  },
};

function regulator(part: Part, r: Reading, ctx: Context): Verdict {
  const g = PHYS.regulators[part.kind];
  const vin = pin(r, "IN").v - pin(r, "GND").v;
  const vout = pin(r, "OUT").v - pin(r, "GND").v;
  const iout = -pin(r, "OUT").i;
  const iin = pin(r, "IN").i;
  const p = Math.max(0, r.power);
  const pTrip = g.pTrip[String(part.props.heatsink ?? "none")] ?? g.pTrip.none;
  if (vin < 0.5) return { status: "idle", notes: [], why: ["Sem tensão na entrada (IN em relação ao GND)."] };

  const why = [
    `Entrada: ${V(vin)} → saída: ${V(vout)}.`,
    `Para dar ${V(g.vref)}, precisa de pelo menos ${V(g.vref + g.dropout)} na entrada (queda mínima de ${V(g.dropout)}).`,
    `Corrente: ${A(iout)} na saída e ${A(iin)} na entrada (a diferença o próprio regulador usa).`,
    `Calor: P ≈ (${V(vin)} − ${V(vout)}) × ${A(iout)} = ${W(p)}.`,
  ];
  if (iin > 1e-4) why.push(`Eficiência: ${Math.round((100 * vout * iout) / (vin * iin))}%. O resto vira calor.`);
  const v: Verdict = { status: "ok", notes: [], why, heat: p / g.pWarn, stress: vin / g.vinMax };

  if (vin > g.vinMax) {
    v.burn = { mode: "open", reason: `Recebeu ${V(vin)} na entrada; o máximo é ${V(g.vinMax)}.` };
    return v;
  }
  if (ctx.tripped) {
    v.status = "warn";
    v.notes.push({
      level: "danger",
      text: `Proteção térmica: com ${W(p)} de calor ele desligou a saída para não queimar. Diminua a tensão de entrada ou a corrente, ou use dissipador.`,
    });
  } else if (p > pTrip) {
    v.trip = true;
  } else if (p > g.pWarn) {
    v.status = "warn";
    v.notes.push({ level: "warn", text: `Esquentando: ${W(p)}. ${part.props.heatsink === "small" ? "" : "Um dissipador ajudaria."}` });
  }
  if (!ctx.tripped && vin < g.vref + g.dropout - 0.05) {
    v.status = "warn";
    v.notes.push({
      level: "warn",
      text: `Entrada baixa demais: sem os ${V(g.dropout)} de folga, a saída cai junto com a entrada (dropout).`,
    });
  } else if (!ctx.tripped && iout > g.ilim * 0.97) {
    v.status = "warn";
    v.notes.push({ level: "warn", text: `No limite de corrente (${A(g.ilim)}): a saída caiu para se proteger.` });
  }
  return v;
}

RULES.reg7805 = regulator;
RULES.ams1117 = regulator;

RULES.pushButton = (_part, r, ctx) => {
  const i = Math.abs(r.pins["1"].i + r.pins["2"].i);
  return {
    status: ctx.pressed ? "ok" : "idle",
    notes: [],
    why: ctx.pressed
      ? [`Apertado: o lado 1–2 está ligado ao lado 3–4. Passando ${A(i)} pelo contato.`]
      : [
          "Solto: o lado 1–2 não toca no lado 3–4.",
          `Diferença de tensão entre os lados: ${V(Math.abs(pin(r, "1").v - pin(r, "3").v))}. Apertando, ela some e a corrente passa.`,
        ],
  };
};

RULES.slideSwitch = (part, r) => {
  const side = String(part.props.position);
  const i = Math.abs(pin(r, "C").i);
  return {
    status: i > IDLE ? "ok" : "idle",
    notes: [],
    why: [`Comum (C) ligado ao pino ${side}. O pino ${side === "1" ? "2" : "1"} está solto.`, `Corrente pela chave: ${A(i)}.`],
  };
};

RULES.fuse = (part, r) => {
  const rating = Number(part.props.rating);
  const speed = PHYS.fuses[String(part.props.speed) as "F" | "T"];
  const i = Math.abs(pin(r, "1").i);
  const v: Verdict = {
    status: i > IDLE ? "ok" : "idle",
    notes: [],
    why: [`Corrente: ${A(i)} de ${A(rating)} nominais (${Math.round((100 * i) / rating)}%).`],
    heat: i / rating,
    stress: i / (speed.instant * rating),
  };
  const burn = {
    mode: "open" as const,
    reason: `O filamento derreteu: passaram ${A(i)} por um fusível de ${A(rating)}. Ele fez o trabalho dele: abriu o circuito antes que outra coisa queimasse.`,
  };
  if (i > speed.instant * rating) v.burn = burn;
  else if (i > rating) {
    v.status = "warn";
    v.notes.push({ level: "warn", text: `Acima da corrente nominal: queima em ~${formatSI(speed.seconds, "s")} se continuar assim.` });
    v.overload = { seconds: speed.seconds, burn };
  }
  return v;
};

RULES.pnp = (part, r) => {
  const q = PHYS.pnps[str(part.props, "model")];
  const veb = pin(r, "E").v - pin(r, "B").v;
  const vec = pin(r, "E").v - pin(r, "C").v;
  const ib = -pin(r, "B").i;
  const ic = -pin(r, "C").i;
  const p = Math.abs(r.power);
  const why = [`Veb = ${V(veb)} (emissor acima da base), Vec = ${V(vec)}.`];
  let status: Verdict["status"] = "ok";
  if (veb < 0.5 || Math.abs(ic) < 1e-7) {
    status = "idle";
    why.push("Em corte: no PNP, a base precisa ficar ~0,65 V ABAIXO do emissor para ligar.");
  } else {
    why.push(`Corrente saindo pela base: ${A(ib)}. Corrente saindo pelo coletor: ${A(ic)}.`);
    why.push(vec < 0.25 ? `Saturado: chave fechada entre emissor e coletor (sobram ${V(vec)}).` : `Região ativa: β ≈ ${(ic / ib).toFixed(0)}.`);
    why.push(`Calor: ${W(p)} (aguenta ~${W(q.pMax)}).`);
  }
  const v: Verdict = { status, notes: [], why, heat: p / q.pMax, stress: Math.max(ic / (2 * q.icMax), p / (2 * q.pMax), ib / 0.2, vec / q.vceo) };
  if (ib > 0.2) v.burn = { mode: "open", reason: `Passaram ${A(ib)} pela base, sem resistor limitando.` };
  else if (vec > q.vceo) v.burn = { mode: "short", reason: `${V(vec)} entre emissor e coletor, acima dos ${V(q.vceo)} que ele aguenta: rompeu e queimou em curto.` };
  else if (ic > 2 * q.icMax || p > 2 * q.pMax) v.burn = { mode: "short", reason: `Coletor com ${A(ic)} e ${W(p)} de calor: queimou em curto.` };
  else if (ic > q.icMax || p > q.pMax) {
    v.status = "warn";
    v.notes.push({ level: "warn", text: "Acima do limite de corrente ou de calor." });
  }
  return v;
};

RULES.mosfetSmall = (part, r) => {
  const model = str(part.props, "model");
  const m = PHYS.smallMosfets[model];
  const pch = SMALL_MOSFETS[model].channel === "P";
  const drive = pch ? pin(r, "S").v - pin(r, "G").v : pin(r, "G").v - pin(r, "S").v;
  const vds = Math.abs(pin(r, "D").v - pin(r, "S").v);
  const id = Math.abs(pin(r, "D").i);
  const p = Math.abs(r.power);
  const why = [
    pch
      ? `Canal P: a porta está ${V(drive)} abaixo da fonte (liga a partir de ~${V(m.vth)}).`
      : `Canal N: a porta está ${V(drive)} acima da fonte (liga a partir de ~${V(m.vth)}).`,
  ];
  let status: Verdict["status"] = "ok";
  if (drive < m.vth && id < 1e-4) {
    status = "idle";
    why.push("Desligado: o canal entre dreno e fonte está fechado.");
  } else {
    why.push(`Corrente no canal: ${A(id)}; queda: ${V(vds)}${id > 1e-6 ? ` (Rds ≈ ${R(vds / id)})` : ""}.`);
    why.push(`Calor: ${W(p)}.`);
  }
  const v: Verdict = { status, notes: [], why, heat: p / m.pMax, stress: Math.max(p / (2 * m.pMax), id / (2 * m.idMax), Math.abs(drive) / m.vgsMax, vds / m.vdsMax) };
  if (Math.abs(drive) > m.vgsMax) v.burn = { mode: "short", reason: `Mais de ${V(m.vgsMax)} entre porta e fonte: o isolante da porta furou.` };
  else if (vds > m.vdsMax) v.burn = { mode: "short", reason: `${V(vds)} entre dreno e fonte, acima dos ${V(m.vdsMax)} que ele aguenta: queimou em curto.` };
  else if (p > 2 * m.pMax || id > 2 * m.idMax) v.burn = { mode: "short", reason: `${A(id)} e ${W(p)} num MOSFET pequeno: queimou em curto.` };
  else if (p > m.pMax || id > m.idMax) {
    v.status = "warn";
    v.notes.push({ level: "warn", text: "Acima do limite: este é um MOSFET de sinal, para correntes pequenas." });
  }
  return v;
};

const GATE_RULE: Record<string, string> = {
  nand: "NAND: só dá 0 quando todas as entradas estão em 1",
  and: "AND: só dá 1 quando todas as entradas estão em 1",
  or: "OR: dá 1 se qualquer entrada estiver em 1",
  nor: "NOR: só dá 1 quando todas as entradas estão em 0",
  xor: "XOR: dá 1 quando as entradas são diferentes",
  not: "NOT: inverte a entrada",
};

/** Chips lógicos: alimentação, entradas soltas, nível de cada porta e limites de corrente. */
function chip(part: Part, r: Reading, ctx: Context): Verdict {
  const def = PARTS[part.kind] as ChipDef;
  const fam = FAMILIES[def.chip.family];
  const gnd = pin(r, fam.gnd).v;
  const vcc = pin(r, fam.vcc).v - gnd;
  const units = def.chip.units;
  const inputs = [...new Set(units.flatMap((u) => u.ins))];
  const outputs = [...new Set(units.flatMap((u) => u.outs))];
  const lv = (name: string) => {
    const x = (pin(r, name).v - gnd) / vcc;
    return x > 0.7 ? "1" : x < 0.3 ? "0" : "?";
  };
  const notes: Note[] = [];
  const why: string[] = [];
  const v: Verdict = { status: "ok", notes, why };

  const iSupply = Math.abs(pin(r, fam.vcc).i);
  const clampWorst = Math.max(0, ...inputs.map((n) => Math.abs(pin(r, n).i)));
  const outWorst = Math.max(0, ...outputs.map((n) => Math.abs(pin(r, n).i)));
  v.stress = Math.max(vcc / fam.absMax, clampWorst / (2 * fam.iClamp), outWorst / fam.iOutBurn);
  v.heat = outWorst / fam.iOut;

  if (vcc > fam.absMax) {
    v.burn = { mode: "open", reason: `Alimentado com ${V(vcc)}; o máximo absoluto é ${V(fam.absMax)}. O chip queimou.` };
    return v;
  }
  if (clampWorst > 2 * fam.iClamp) {
    v.burn = {
      mode: "open",
      reason: `Passaram ${A(clampWorst)} pelos diodos de proteção de uma entrada (máximo ${A(fam.iClamp)}). Entrada acima do ${fam.vcc} ou abaixo do ${fam.gnd} sem resistor.`,
    };
    return v;
  }
  if (outWorst > fam.iOutBurn) {
    v.burn = { mode: "open", reason: `Uma saída forneceu ${A(outWorst)}; o estágio de saída aguenta ~${A(fam.iOut)}. Queimou.` };
    return v;
  }

  const phantom = inputs.filter((n) => pin(r, n).v - gnd > vcc + 0.5);
  if (vcc < 0.5) {
    v.status = "idle";
    why.push(`Sem alimentação: ligue ${fam.vcc} (positivo) e ${fam.gnd} (terra). Sem isso, nenhuma porta funciona.`);
    if (phantom.length) {
      v.status = "warn";
      notes.push({
        level: "warn",
        text: `Tensão na entrada ${phantom.join(", ")} com o chip sem alimentação: a corrente passa pelo diodo de proteção e alimenta o chip pelo lugar errado.`,
      });
    }
    return v;
  }

  why.push(`Alimentação: ${V(vcc)} entre ${fam.vcc} e ${fam.gnd} (faixa ${V(fam.vMin)}–${V(fam.vMax)}). Consumo: ${A(iSupply)}.`);
  units.forEach((u: Unit, i) => why.push(unitLine(part.id, u, i, lv, ctx)));

  if (vcc < fam.vMin) {
    v.status = "warn";
    notes.push({ level: "warn", text: `Abaixo dos ${V(fam.vMin)} mínimos: o chip pode se comportar de forma imprevisível.` });
  } else if (vcc > fam.vMax) {
    v.status = "warn";
    notes.push({ level: "warn", text: `Acima dos ${V(fam.vMax)} recomendados (queima em ${V(fam.absMax)}).` });
  }
  const loose = inputs.filter((n) => ctx.lonely.has(n));
  if (loose.length) {
    v.status = "warn";
    notes.push({
      level: "warn",
      text: `Entrada solta: ${loose.join(", ")}. Num chip CMOS de verdade, uma entrada solta pega ruído e muda sozinha. Aqui ela lê 0. Ligue em ${fam.gnd}, em ${fam.vcc} ou num resistor de pull-up/pull-down — inclusive nas portas que você não usa.`,
    });
  }
  const middle = inputs.filter((n) => !ctx.lonely.has(n) && lv(n) === "?");
  if (middle.length) {
    v.status = "warn";
    notes.push({
      level: "warn",
      text: `Entrada ${middle.join(", ")} entre 0 e 1 (${middle.map((n) => V(pin(r, n).v - gnd)).join(", ")}): a saída fica indefinida e os dois transistores internos conduzem ao mesmo tempo, esquentando o chip.`,
    });
  }
  if (phantom.length) {
    v.status = "warn";
    notes.push({ level: "warn", text: `Entrada ${phantom.join(", ")} acima do ${fam.vcc}: corrente entrando pelo diodo de proteção.` });
  }
  if (outWorst > fam.iOut) {
    v.status = "warn";
    notes.push({ level: "warn", text: `Uma saída está fornecendo ${A(outWorst)}, acima dos ${A(fam.iOut)} recomendados. Use um resistor maior ou um transistor.` });
  }
  return v;
}

function unitLine(id: string, u: Unit, i: number, lv: (n: string) => string, ctx: Context): string {
  if (u.kind === "dff") {
    const [d, clk, clr, pre] = u.ins;
    const forced = lv(clr) === "0" ? ` ${clr} em 0 força Q = 0.` : lv(pre) === "0" ? ` ${pre} em 0 força Q = 1.` : "";
    return `Flip-flop ${i + 1}: Q = ${lv(u.outs[0])}. Guarda o valor que D tinha na última subida do CLK (agora D = ${lv(d)}, CLK = ${lv(clk)}).${forced}`;
  }
  if (u.kind === "decade") {
    const n = ctx.state?.[`${id}#u${i}#n`];
    const on = u.outs.slice(0, 10).filter((o) => lv(o) === "1");
    return `Contagem: ${n ?? on.map((o) => o.slice(1)).join(", ")} → ${on.join(", ") || "nenhuma saída"} em 1. Cada subida do CLK avança uma${lv(u.ins[2]) === "1" ? " (RST em 1: preso no Q0)" : lv(u.ins[1]) === "1" ? " (INH em 1: contagem parada)" : ""}.`;
  }
  const ins = u.ins.map((n) => `${n} = ${lv(n)}`).join(", ");
  return `Porta ${i + 1}: ${ins} → ${u.outs[0]} = ${lv(u.outs[0])} (${GATE_RULE[u.kind]}).`;
}

for (const kind of ["hc00", "hc04", "hc08", "hc32", "hc86", "hc74", "cd4017"]) RULES[kind] = chip;

RULES.ne555 = (part, r, ctx) => {
  const gnd = pin(r, "GND").v;
  const vcc = pin(r, "VCC").v - gnd;
  const fam = FAMILIES["555"];
  const at = (n: string) => pin(r, n).v - gnd;
  const iOut = Math.abs(pin(r, "OUT").i);
  const v: Verdict = { status: "ok", notes: [], why: [], stress: Math.max(vcc / fam.absMax, iOut / fam.iOutBurn), heat: iOut / fam.iOut };
  if (vcc > fam.absMax) {
    v.burn = { mode: "open", reason: `Alimentado com ${V(vcc)}; o máximo é ${V(fam.absMax)}.` };
    return v;
  }
  if (iOut > fam.iOutBurn) {
    v.burn = { mode: "open", reason: `A saída forneceu ${A(iOut)}; aguenta ${A(fam.iOut)}.` };
    return v;
  }
  if (vcc < 0.5) return { status: "idle", notes: [], why: ["Sem alimentação: ligue VCC (pino 8) e GND (pino 1)."] };

  const q = ctx.state?.[`${part.id}#q`];
  const high = q !== undefined ? q > 0.5 : at("OUT") > vcc / 2;
  v.why.push(
    `Saída ${high ? "alta" : "baixa"}: ${V(at("OUT"))}.`,
    `TRIG = ${V(at("TRIG"))}. Abaixo de ⅓ do VCC (${V(vcc / 3)}) a saída vai a 1.`,
    `THRES = ${V(at("THRES"))}. Acima de ⅔ do VCC (${V((2 * vcc) / 3)}) a saída vai a 0.`,
    high ? "DIS aberto: o capacitor de tempo pode carregar." : "DIS ligado ao GND por dentro: o capacitor de tempo descarrega por ele.",
  );
  if (at("RESET") < 0.7) {
    v.status = "warn";
    v.notes.push({
      level: "warn",
      text: ctx.lonely.has("RESET")
        ? "RESET solto (lê 0): o 555 fica travado com a saída em 0. Ligue o RESET no VCC."
        : "RESET em 0: o 555 fica travado com a saída em 0.",
    });
  }
  if (vcc < fam.vMin) {
    v.status = "warn";
    v.notes.push({ level: "warn", text: `Abaixo dos ${V(fam.vMin)} mínimos do NE555.` });
  }
  if (iOut > fam.iOut) {
    v.status = "warn";
    v.notes.push({ level: "warn", text: `Saída fornecendo ${A(iOut)}: acima dos ${A(fam.iOut)} que ela aguenta.` });
  }
  return v;
};

/** Microcontroladores: alimentação, pinos (5 V onde não pode, corrente demais) e se está rodando. */
function mcu(part: Part, r: Reading, ctx: Context): Verdict {
  const spec = (PARTS[part.kind] as McuDef).mcu;
  const gnd = pin(r, spec.gnd).v;
  const vcc = pin(r, spec.vcc).v - gnd;
  const notes: Note[] = [];
  const why: string[] = [];
  const v: Verdict = { status: "ok", notes, why };
  const ios = spec.pins.filter((p) => p.kind !== "vcc" && p.kind !== "gnd" && !["VREGIN", "VREGOUT", "DVDD", "AVCC", "GND2", "AREF"].includes(p.name));
  const worstI = Math.max(0, ...ios.map((p) => Math.abs(pin(r, p.name).i)));
  v.stress = Math.max(vcc / spec.absMax, worstI / spec.iPinBurn);
  v.heat = worstI / spec.iPin;

  if (vcc > spec.absMax) {
    v.burn = { mode: "open", reason: `Alimentado com ${V(vcc)}; o máximo absoluto do ${spec.name} é ${V(spec.absMax)}.` };
    return v;
  }
  for (const p of ios) {
    const pv = pin(r, p.name).v - gnd;
    const i = Math.abs(pin(r, p.name).i);
    if (!p.fiveVolt && pv > vcc + 0.6 && i > 0.02) {
      v.burn = {
        mode: "open",
        reason: `O pino ${p.title} recebeu ${V(pv)} com o chip em ${V(vcc)}. O diodo de proteção conduziu ${A(i)} e o pino queimou. Use um divisor de tensão ou um conversor de nível.`,
      };
      return v;
    }
    if (p.fiveVolt && pv > 5.6) {
      v.burn = { mode: "open", reason: `O pino ${p.title} aguenta 5 V, mas recebeu ${V(pv)}.` };
      return v;
    }
    if (i > spec.iPinBurn) {
      v.burn = { mode: "open", reason: `O pino ${p.title} passou ${A(i)}; aguenta ~${A(spec.iPin)}. Faltou um resistor (ou um transistor) para a carga.` };
      return v;
    }
  }

  const st = ctx.mcu;
  if (vcc < 0.3) return { status: "idle", notes: [], why: [`Sem alimentação: ligue ${spec.vcc} e ${spec.gnd}.`] };
  why.push(`Alimentação: ${V(vcc)} (faixa ${V(spec.vMin)}–${V(spec.vMax)}).`);
  if (!st?.running) {
    v.status = "warn";
    notes.push({ level: "warn", text: st?.stop ?? "Ligando…" });
  } else {
    why.push("Rodando. Os registradores estão no painel abaixo: clique nos bits para mudar os pinos.");
  }
  for (const n of st?.notes ?? []) notes.push({ level: "info", text: n });
  if (st?.event) notes.push({ level: "info", text: st.event });
  if (vcc > spec.vMax) {
    v.status = "warn";
    notes.push({ level: "warn", text: `Acima dos ${V(spec.vMax)} recomendados (queima em ${V(spec.absMax)}).` });
  }

  const drives = st ? pinDrives(spec, st, part.props) : {};
  for (const p of ios) {
    if (!isGpio(spec, p, part.props)) continue;
    const d = drives[p.name] ?? {};
    const pv = pin(r, p.name).v - gnd;
    const i = pin(r, p.name).i;
    const mode = d.drive !== undefined ? `saída ${d.drive}` : `entrada${d.pull ? ` (pull-${d.pull})` : ""}`;
    why.push(`${p.name}: ${mode} — ${V(pv)}${Math.abs(i) > 1e-6 ? `, ${A(Math.abs(i))} ${i < 0 ? "saindo" : "entrando"}` : ""}.`);
    if (Math.abs(i) > spec.iPin) {
      v.status = "warn";
      notes.push({ level: "warn", text: `${p.name} passando ${A(Math.abs(i))}: acima dos ${A(spec.iPin)} recomendados por pino.` });
    }
    if (!p.fiveVolt && pv > vcc + 0.3) {
      v.status = "warn";
      notes.push({ level: "warn", text: `${p.name} está ${V(pv - vcc)} acima do ${spec.vcc}: corrente entrando pelo diodo de proteção.` });
    }
  }
  return v;
}

for (const kind of ["atmega328p", "attiny85", "rp2040", "esp32", "stm32f103", "pic16f628a"]) RULES[kind] = mcu;

RULES.flashSpi = (_part, r) => {
  const vcc = pin(r, "VCC").v - pin(r, "GND").v;
  if (vcc > 4) return { status: "danger", notes: [], why: [], burn: { mode: "open", reason: `Alimentada com ${V(vcc)}; a flash aguenta até 3,6 V (máximo 4 V).` }, stress: vcc / 4 };
  if (vcc < 0.3) return { status: "idle", notes: [], why: ["Sem alimentação."] };
  const v: Verdict = { status: "ok", notes: [], why: [`Alimentação: ${V(vcc)} (2,7–3,6 V).`, "Guarda o programa; o chip principal lê dela pela interface SPI/QSPI."] };
  if (vcc < 2.7) {
    v.status = "warn";
    v.notes.push({ level: "warn", text: "Abaixo de 2,7 V: a flash não funciona direito." });
  }
  return v;
};

RULES.levelShifter = (_part, r) => {
  const lv = pin(r, "LV").v - pin(r, "GND").v;
  const hv = pin(r, "HV").v - pin(r, "GND").v;
  return {
    status: lv > 0.5 && hv > 0.5 ? "ok" : "idle",
    notes: lv > hv + 0.3 ? [{ level: "warn", text: "LV maior que HV: os lados estão trocados." }] : [],
    why: [
      `Lado baixo: ${V(lv)}; lado alto: ${V(hv)}.`,
      ...["1", "2"].map((ch) => `Canal ${ch}: LV${ch} = ${V(pin(r, `LV${ch}`).v)} ↔ HV${ch} = ${V(pin(r, `HV${ch}`).v)}.`),
    ],
  };
};

export function judge(part: Part, r: Reading, ctx: Context): Verdict {
  return RULES[part.kind]?.(part, r, ctx) ?? { status: "ok", notes: [], why: [] };
}
