import { formatSI } from "../../../lib/si";
import { C, Hint, Lead, Print } from "./draw";
import { num, type PartDef } from "./types";

const G = 20;

const fmt = (v: number, digits: number) => v.toFixed(digits);

export const battery9v: PartDef = {
  kind: "battery9v",
  name: "Bateria 9V",
  group: "Fontes",
  prefix: "BT",
  summary: "Fonte de energia química. Por dentro, são 6 células de 1,5 V em série. Tem resistência interna de ~1–2 Ω.",
  props: {},
  pins: () => [
    {
      name: "+",
      x: 3 * G,
      y: -G,
      role: "power_out",
      net: "9V",
      title: "Positivo (+)",
      explain: "Terminal menor e redondo. A corrente sai por aqui, passa pelo circuito e volta pelo −.",
    },
    {
      name: "-",
      x: 3 * G,
      y: G,
      role: "gnd",
      net: "GND",
      title: "Negativo (−)",
      explain: "Terminal maior e sextavado. É a referência do circuito: 0 V.",
    },
  ],
  bounds: { x: -50, y: -28, w: 50 + 3 * G, h: 56 },
  markings: () => ({
    volt: { text: "9V", explain: "Tensão nominal. Nova, mede ~9,5 V; descarregada, cai abaixo de ~7 V." },
    chem: {
      text: "ALCALINA 6LR61",
      explain: "6LR61 = 6 células (6) alcalinas (LR) de 1,5 V empilhadas em série dentro da bateria → 9 V.",
    },
    plus: { text: "+", explain: "Terminal positivo." },
    minus: { text: "−", explain: "Terminal negativo." },
  }),
  value: () => "9 V",
  Body: ({ mk }) => (
    <>
      <Lead x1={46} y1={-G} x2={3 * G} y2={-G} />
      <Lead x1={47} y1={G} x2={3 * G} y2={G} />
      <rect x={-50} y={-28} width={84} height={56} rx={4} fill={C.black} />
      <rect x={-50} y={-28} width={18} height={56} rx={4} fill={C.gold} />
      <Print m={mk.volt} x={-4} y={-3} size={18} weight={700} />
      <Print m={mk.chem} x={-4} y={15} size={5} />
      <Print m={mk.plus} x={24} y={-G} size={9} />
      <Print m={mk.minus} x={24} y={G} size={9} />
      <circle cx={40} cy={-G} r={6} fill={C.metal} stroke="#6b6b73" />
      <polygon points="47,20 43.5,26 36.5,26 33,20 36.5,14 43.5,14" fill={C.metal} stroke="#6b6b73" />
    </>
  ),
};

export const cellAA: PartDef = {
  kind: "cellAA",
  name: "Pilha AA",
  group: "Fontes",
  prefix: "BT",
  summary: "Uma única célula alcalina de 1,5 V. Pilhas em série somam as tensões.",
  props: {},
  pins: () => [
    {
      name: "-",
      x: -3 * G,
      y: 0,
      role: "gnd",
      net: "GND",
      title: "Negativo (−)",
      explain: "O lado plano da pilha. Referência: 0 V.",
    },
    {
      name: "+",
      x: 3 * G,
      y: 0,
      role: "power_out",
      net: "1V5",
      title: "Positivo (+)",
      explain: "O lado com o ressalto (o “botão”). A corrente sai por aqui.",
    },
  ],
  bounds: { x: -3 * G, y: -13, w: 6 * G, h: 26 },
  markings: () => ({
    size: { text: "AA", explain: "Tamanho padrão: 14,5 mm × 50,5 mm." },
    volt: { text: "1,5V", explain: "Tensão de uma célula alcalina nova. Cai para ~1,0 V quando está gasta." },
    iec: { text: "LR6", explain: "Código internacional: L = alcalina, R = redonda, 6 = tamanho AA." },
    plus: { text: "+", explain: "Lado positivo (com o ressalto)." },
  }),
  value: () => "1,5 V",
  Body: ({ mk }) => (
    <>
      <Lead x1={-3 * G} y1={0} x2={-44} y2={0} />
      <Lead x1={42} y1={0} x2={3 * G} y2={0} />
      <rect x={-44} y={-13} width={80} height={26} rx={3} fill="#2b2b2e" />
      <rect x={14} y={-13} width={22} height={26} rx={3} fill={C.copper} />
      <rect x={36} y={-5} width={6} height={10} rx={1.5} fill={C.metal} />
      <Print m={mk.size} x={-22} y={-4} size={10} weight={700} />
      <Print m={mk.volt} x={-22} y={7} size={6} />
      <Print m={mk.iec} x={2} y={0} size={5} />
      <Print m={mk.plus} x={25} y={0} size={10} fill={C.inkDark} weight={700} />
    </>
  ),
};

export const usb5v: PartDef = {
  kind: "usb5v",
  name: "USB 5V",
  group: "Fontes",
  prefix: "J",
  summary:
    "Placa com conector USB-C. Entrega 5 V pelo VBUS, protegidos por um fusível de 500 mA. D+ e D− são linhas de dados.",
  props: {},
  pins: () => [
    {
      name: "VBUS",
      x: 2 * G,
      y: -2 * G,
      role: "power_out",
      net: "VBUS",
      title: "VBUS — 5 V",
      explain: "Alimentação que vem do computador ou carregador, já passando pelo fusível F1.",
    },
    {
      name: "D-",
      x: 2 * G,
      y: -G,
      role: "io",
      title: "D− — dados",
      explain: "Metade do par de dados USB. Não serve para alimentar nada.",
    },
    {
      name: "D+",
      x: 2 * G,
      y: 0,
      role: "io",
      title: "D+ — dados",
      explain: "Outra metade do par de dados USB. Trabalha em conjunto com o D−.",
    },
    {
      name: "GND",
      x: 2 * G,
      y: G,
      role: "gnd",
      net: "GND",
      title: "GND — terra",
      explain: "Retorno da corrente e referência de 0 V.",
    },
  ],
  bounds: { x: -46, y: -54, w: 46 + 2 * G, h: 88 },
  markings: () => ({
    title: { text: "USB-C 5V", explain: "Conector USB tipo C. Sem negociação, a porta entrega 5 V." },
    fuse: {
      text: "F1",
      explain:
        "Polyfuse de 500 mA: um fusível que se rearma sozinho. Se a corrente passar disso, ele esquenta e corta; quando esfria, volta a conduzir.",
    },
    vbus: { text: "VBUS", explain: "Saída de 5 V." },
    dm: { text: "D−", explain: "Dados (−)." },
    dp: { text: "D+", explain: "Dados (+)." },
    gnd: { text: "GND", explain: "Terra: 0 V." },
  }),
  value: () => "5 V",
  Body: ({ mk }) => (
    <>
      <rect x={-36} y={-54} width={66} height={88} rx={4} fill={C.pcb} />
      <rect x={-46} y={-16} width={28} height={22} rx={6} fill={C.metal} />
      <rect x={-42} y={-10} width={20} height={10} rx={3} fill="#3a3a40" />
      <Print m={mk.title} x={-6} y={24} size={6} />
      <Hint title={mk.fuse.text} explain={mk.fuse.explain}>
        <rect x={-14} y={-46} width={14} height={7} rx={1} fill="#d6b84a" />
      </Hint>
      <Print m={mk.fuse} x={-7} y={-32} size={5} />
      {[mk.vbus, mk.dm, mk.dp, mk.gnd].map((m, i) => (
        <g key={m.text}>
          <Print m={m} x={21} y={(i - 2) * G} size={5.5} anchor="end" />
          <Lead x1={30} y1={(i - 2) * G} x2={2 * G} y2={(i - 2) * G} />
          <circle cx={30} cy={(i - 2) * G} r={4.5} fill={C.gold} />
          <circle cx={30} cy={(i - 2) * G} r={1.8} fill="#3a3a40" />
        </g>
      ))}
    </>
  ),
};

export const benchSupply: PartDef = {
  kind: "benchSupply",
  name: "Fonte de bancada",
  group: "Fontes",
  prefix: "PS",
  summary:
    "Fonte ajustável. Você escolhe a tensão e o limite de corrente; se o circuito pedir mais, ela baixa a tensão para proteger tudo (modo CC).",
  props: {
    voltage: { type: "number", label: "Tensão", unit: "V", default: 12, min: 0, max: 30 },
    current: {
      type: "number",
      label: "Limite de corrente",
      unit: "A",
      default: 1,
      min: 0,
      max: 5,
      explain: "Se o circuito tentar puxar mais que isso, a fonte limita. Ótimo para testar sem queimar nada.",
    },
  },
  pins: () => [
    {
      name: "+",
      x: -G,
      y: 3 * G,
      role: "power_out",
      net: "VOUT",
      title: "Saída + (vermelho)",
      explain: "Borne positivo: sai a tensão ajustada.",
    },
    {
      name: "-",
      x: G,
      y: 3 * G,
      role: "gnd",
      net: "GND",
      title: "Saída − (preto)",
      explain: "Borne negativo: retorno e referência de 0 V.",
    },
  ],
  bounds: { x: -60, y: -52, w: 120, h: 52 + 3 * G },
  markings: (p) => {
    const v = num(p, "voltage");
    const a = num(p, "current");
    return {
      volts: { text: `${fmt(v, 2)}V`, explain: `Tensão ajustada: ${formatSI(v, "V")}.` },
      amps: {
        text: `${fmt(a, 3)}A`,
        explain: `Com o circuito ligado, mostra a corrente real. Limite ajustado: ${formatSI(a, "A")}.`,
      },
      cv: {
        text: "CV",
        explain: "CV = tensão constante (tudo normal). Muda para CC = corrente constante quando o limite é atingido.",
      },
      vKnob: { text: "V", explain: "Botão de ajuste da tensão." },
      aKnob: { text: "A", explain: "Botão de ajuste do limite de corrente." },
      plus: { text: "+", explain: "Borne positivo." },
      minus: { text: "−", explain: "Borne negativo." },
    };
  },
  value: (p) => formatSI(num(p, "voltage"), "V"),
  Body: ({ mk, live }) => {
    // Com energia, o visor mostra o que está saindo de verdade.
    const pins = live?.reading?.pins;
    const volts = pins ? { ...mk.volts, text: `${fmt(pins["+"].v - pins["-"].v, 2)}V` } : mk.volts;
    const amps = pins ? { ...mk.amps, text: `${fmt(Math.max(0, -pins["+"].i), 3)}A` } : mk.amps;
    const cc = live?.reading?.mode === "cc";
    const cv = cc ? { text: "CC", explain: mk.cv.explain } : mk.cv;
    return (
    <>
      <Lead x1={-G} y1={24} x2={-G} y2={3 * G} />
      <Lead x1={G} y1={24} x2={G} y2={3 * G} />
      <rect x={-60} y={-52} width={120} height={86} rx={6} fill="#2a2a2e" />
      <rect x={-52} y={-44} width={66} height={36} rx={3} fill="#0f380f" />
      <Print m={volts} x={-21} y={-33} size={12} fill="#9bbc0f" weight={600} />
      <Print m={amps} x={-21} y={-17} size={8} fill="#9bbc0f" />
      <Print m={cv} x={8} y={-39} size={4.5} fill={cc ? "#ff4a2b" : "#9bbc0f"} />
      {[
        { x: 30, m: mk.vKnob },
        { x: 48, m: mk.aKnob },
      ].map(({ x, m }) => (
        <g key={m.text}>
          <circle cx={x} cy={-30} r={7.5} fill="#d9d9de" />
          <line x1={x} y1={-30} x2={x} y2={-36} stroke={C.inkDark} strokeWidth={1.6} />
          <Print m={m} x={x} y={-15} size={5.5} />
        </g>
      ))}
      <Print m={mk.plus} x={-G} y={4} size={9} />
      <Print m={mk.minus} x={G} y={4} size={9} />
      <circle cx={-G} cy={18} r={7} fill="#d42a20" />
      <circle cx={G} cy={18} r={7} fill="#111" stroke={C.metal} />
    </>
    );
  },
};
