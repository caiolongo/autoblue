import { ceramicCode, inductorCode, resistorBands } from "../../../lib/colorcode";
import { formatSI } from "../../../lib/si";
import { C, Hint, Lead, Print } from "./draw";
import { num, str, type Marking, type PartDef } from "./types";

const G = 20;

/** Explica um código de 3 dígitos (cerâmicos em pF, indutores em µH). */
function threeDigit(code: string, unit: string, value: string): string {
  if (code.includes("R")) return `O R marca a vírgula: ${code} = ${code.replace("R", ",")} ${unit}.`;
  if (code.length < 3) return `${code} ${unit} (valores pequenos são impressos direto).`;
  const zeros = Number(code[2]);
  return `Os dois primeiros dígitos (${code.slice(0, 2)}) são o valor e o terceiro (${zeros}) é quantos zeros acrescentar, em ${unit}: ${code.slice(0, 2)}${"0".repeat(zeros)} ${unit} = ${value}.`;
}

export const resistor: PartDef = {
  kind: "resistor",
  name: "Resistor",
  group: "Passivos",
  prefix: "R",
  summary: "Limita a corrente. Quanto maior a resistência, menos corrente passa: I = V / R.",
  props: {
    resistance: { type: "number", label: "Resistência", unit: "Ω", default: 220, min: 0.1 },
    power: {
      type: "select",
      label: "Potência máxima",
      default: "0.25",
      options: [
        { value: "0.25", label: "1/4 W" },
        { value: "0.5", label: "1/2 W" },
        { value: "1", label: "1 W" },
      ],
      explain: "Acima disso o resistor esquenta demais e queima. Potência = V × I.",
    },
  },
  pins: () => [
    { name: "1", x: -2 * G, y: 0, role: "passive", title: "Terminal 1", explain: "Resistores não têm polaridade: tanto faz o lado." },
    { name: "2", x: 2 * G, y: 0, role: "passive", title: "Terminal 2", explain: "Resistores não têm polaridade: tanto faz o lado." },
  ],
  bounds: { x: -2 * G, y: -10, w: 4 * G, h: 20 },
  markings: (p) => {
    const { bands, value } = resistorBands(num(p, "resistance"));
    return {
      bands: {
        text: bands.map((b) => b.name).join(" · "),
        explain: `${bands.map((b) => `${b.name}: ${b.meaning}`).join("\n")}\n= ${formatSI(value, "Ω")} ±5%`,
      },
    };
  },
  value: (p) => formatSI(num(p, "resistance"), "Ω"),
  Body: ({ p }) => {
    const { bands } = resistorBands(num(p, "resistance"));
    const xs = [-14, -8, -2, 11];
    return (
      <>
        <Lead x1={-2 * G} y1={0} x2={-20} y2={0} />
        <Lead x1={20} y1={0} x2={2 * G} y2={0} />
        <rect x={-22} y={-7} width={44} height={14} rx={6} fill="#dcc49a" />
        {bands.map((b, i) => (
          <Hint key={i} title={b.name} explain={b.meaning}>
            <rect x={xs[i]} y={-7} width={4} height={14} fill={b.hex} />
          </Hint>
        ))}
      </>
    );
  },
};

function potCode(ohms: number) {
  return formatSI(ohms).replace(" ", "").toUpperCase();
}

export const potentiometer: PartDef = {
  kind: "potentiometer",
  name: "Potenciômetro",
  group: "Passivos",
  prefix: "RV",
  summary: "Resistor ajustável. O cursor (pino 2) desliza sobre uma trilha resistiva entre os pinos 1 e 3.",
  props: {
    resistance: { type: "number", label: "Resistência total", unit: "Ω", default: 10_000, min: 1 },
    position: { type: "number", label: "Posição do cursor", unit: "%", default: 50, min: 0, max: 100 },
    taper: {
      type: "select",
      label: "Curva",
      default: "B",
      options: [
        { value: "B", label: "B — linear" },
        { value: "A", label: "A — logarítmica" },
      ],
    },
  },
  pins: () => [
    { name: "1", x: -G, y: 2 * G, role: "passive", title: "Pino 1", explain: "Uma ponta da trilha resistiva." },
    {
      name: "2",
      x: 0,
      y: 2 * G,
      role: "passive",
      title: "Pino 2 — cursor",
      explain: "Contato que desliza sobre a trilha. A resistência entre 1 e 2 (e entre 2 e 3) muda com a posição.",
    },
    { name: "3", x: G, y: 2 * G, role: "passive", title: "Pino 3", explain: "A outra ponta da trilha resistiva." },
  ],
  bounds: { x: -24, y: -22, w: 48, h: 22 + 2 * G },
  markings: (p) => {
    const taper = str(p, "taper");
    const code = potCode(num(p, "resistance"));
    return {
      code: {
        text: `${taper}${code}`,
        explain: `${taper} = curva ${taper === "B" ? "linear: metade do giro, metade da resistência" : "logarítmica, usada em volume de áudio"}. ${code} = ${formatSI(num(p, "resistance"), "Ω")} entre os pinos 1 e 3.`,
      },
    };
  },
  value: (p) => formatSI(num(p, "resistance"), "Ω"),
  Body: ({ p, mk }) => {
    const angle = -135 + (num(p, "position") / 100) * 270;
    return (
      <>
        {[-G, 0, G].map((x) => (
          <Lead key={x} x1={x} y1={18} x2={x} y2={2 * G} />
        ))}
        <rect x={-24} y={-22} width={48} height={42} rx={4} fill="#2650c8" />
        <Print m={mk.code} x={0} y={-14} size={7} />
        <Hint title="Eixo" explain={`Posição atual: ${num(p, "position")}% do giro.`}>
          <circle cx={0} cy={4} r={11} fill="#f1f1f3" />
          <line x1={0} y1={4} x2={0} y2={-5} stroke={C.inkDark} strokeWidth={2.4} strokeLinecap="round" transform={`rotate(${angle} 0 4)`} />
        </Hint>
      </>
    );
  },
};

export const capacitor: PartDef = {
  kind: "capacitor",
  name: "Capacitor",
  group: "Passivos",
  prefix: "C",
  summary: "Guarda carga elétrica por pouco tempo. Bloqueia corrente contínua e deixa passar variações.",
  props: {
    type: {
      type: "select",
      label: "Tipo",
      default: "electrolytic",
      options: [
        { value: "electrolytic", label: "Eletrolítico (polarizado)" },
        { value: "ceramic", label: "Cerâmico" },
      ],
    },
    capacitance: { type: "number", label: "Capacitância", unit: "F", default: 100e-6, min: 1e-12 },
    voltage: {
      type: "number",
      label: "Tensão máxima",
      unit: "V",
      default: 25,
      min: 1,
      explain: "Passar disso danifica o capacitor.",
    },
  },
  pins: (p) =>
    str(p, "type") === "electrolytic"
      ? [
          {
            name: "+",
            x: -2 * G,
            y: 0,
            role: "passive",
            title: "Positivo (+)",
            explain: "Perna mais longa. Precisa ficar na tensão mais alta: invertido, o eletrolítico pode estufar ou estourar.",
          },
          {
            name: "-",
            x: 2 * G,
            y: 0,
            role: "passive",
            title: "Negativo (−)",
            explain: "Lado da faixa clara com sinais de menos, perna mais curta.",
          },
        ]
      : [
          { name: "1", x: -2 * G, y: 0, role: "passive", title: "Terminal 1", explain: "Cerâmicos não têm polaridade." },
          { name: "2", x: 2 * G, y: 0, role: "passive", title: "Terminal 2", explain: "Cerâmicos não têm polaridade." },
        ],
  bounds: { x: -2 * G, y: -12, w: 4 * G, h: 24 },
  markings: (p): Record<string, Marking> => {
    const c = num(p, "capacitance");
    if (str(p, "type") === "ceramic") {
      const code = ceramicCode(c);
      return { code: { text: code, explain: threeDigit(code, "pF", formatSI(c, "F")) } };
    }
    return {
      value: { text: formatSI(c, "F").replace(" ", ""), explain: `Capacitância: ${formatSI(c, "F")}.` },
      voltage: {
        text: `${num(p, "voltage")}V`,
        explain: `Tensão máxima que o capacitor aguenta: ${num(p, "voltage")} V.`,
      },
      stripe: { text: "−", explain: "Faixa clara com sinais de menos: indica o terminal negativo." },
    };
  },
  value: (p) => formatSI(num(p, "capacitance"), "F"),
  Body: ({ p, mk }) =>
    str(p, "type") === "ceramic" ? (
      <>
        <Lead x1={-2 * G} y1={0} x2={-10} y2={0} />
        <Lead x1={10} y1={0} x2={2 * G} y2={0} />
        <ellipse cx={0} cy={0} rx={11} ry={10} fill="#e08a2c" />
        <Print m={mk.code} x={0} y={0} size={7} fill={C.inkDark} />
      </>
    ) : (
      <>
        <Lead x1={-2 * G} y1={0} x2={-20} y2={0} />
        <Lead x1={20} y1={0} x2={2 * G} y2={0} />
        <rect x={-21} y={-12} width={42} height={24} rx={4} fill="#1f3f8f" />
        <Hint title={mk.stripe.text} explain={mk.stripe.explain}>
          <path d="M9 -12 H17 a4 4 0 0 1 4 4 V8 a4 4 0 0 1 -4 4 H9 Z" fill="#c9cdd6" />
          <text x={15} y={0} fontSize={9} fill={C.inkDark} textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-mono)">
            −
          </text>
        </Hint>
        <Print m={mk.value} x={-6} y={-4} size={6.5} />
        <Print m={mk.voltage} x={-6} y={5} size={5.5} />
      </>
    ),
};

export const inductor: PartDef = {
  kind: "inductor",
  name: "Indutor",
  group: "Passivos",
  prefix: "L",
  summary: "Bobina de fio. Guarda energia num campo magnético e resiste a mudanças bruscas de corrente.",
  props: {
    inductance: { type: "number", label: "Indutância", unit: "H", default: 100e-6, min: 1e-9 },
  },
  pins: () => [
    { name: "1", x: -2 * G, y: 0, role: "passive", title: "Terminal 1", explain: "Indutores não têm polaridade." },
    { name: "2", x: 2 * G, y: 0, role: "passive", title: "Terminal 2", explain: "Indutores não têm polaridade." },
  ],
  bounds: { x: -2 * G, y: -12, w: 4 * G, h: 24 },
  markings: (p) => {
    const l = num(p, "inductance");
    const code = inductorCode(l);
    return { code: { text: code, explain: threeDigit(code, "µH", formatSI(l, "H")) } };
  },
  value: (p) => formatSI(num(p, "inductance"), "H"),
  Body: ({ mk }) => (
    <>
      <Lead x1={-2 * G} y1={0} x2={-16} y2={0} />
      <Lead x1={16} y1={0} x2={2 * G} y2={0} />
      <rect x={-17} y={-11} width={34} height={22} rx={3} fill="#2b2b2e" />
      <Hint title="Enrolamento" explain="Fio de cobre enrolado: cada volta soma ao campo magnético.">
        {Array.from({ length: 9 }, (_, i) => (
          <line key={i} x1={-12 + i * 3} y1={-8} x2={-12 + i * 3} y2={8} stroke={C.copper} strokeWidth={1.8} />
        ))}
      </Hint>
      <rect x={-10} y={-5} width={20} height={10} rx={2} fill="#e9e9ec" />
      <Print m={mk.code} x={0} y={0} size={6.5} fill={C.inkDark} />
    </>
  ),
};
