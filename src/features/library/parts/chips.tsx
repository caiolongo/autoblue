import type { PartSim } from "../../../sim/simulate";
import { C, Hint, Lead, Print } from "./draw";
import type { Marking, PartDef, PinDef } from "./types";

const G = 20;

/** Família elétrica: alimentação, força da saída e limites. */
export interface Family {
  vcc: string;
  gnd: string;
  vMin: number;
  vMax: number;
  absMax: number;
  /** Resistência de saída (Ω). */
  rout: number;
  /** Corrente de saída máxima recomendada e a que queima (A). */
  iOut: number;
  iOutBurn: number;
  /** Corrente máxima pelos diodos de proteção das entradas (A). */
  iClamp: number;
}

export const FAMILIES: Record<"hc" | "cd" | "555", Family> = {
  hc: { vcc: "VCC", gnd: "GND", vMin: 2, vMax: 6, absMax: 7, rout: 50, iOut: 0.025, iOutBurn: 0.075, iClamp: 0.02 },
  cd: { vcc: "VDD", gnd: "VSS", vMin: 3, vMax: 18, absMax: 20, rout: 400, iOut: 0.01, iOutBurn: 0.05, iClamp: 0.01 },
  "555": { vcc: "VCC", gnd: "GND", vMin: 4.5, vMax: 16, absMax: 18, rout: 10, iOut: 0.2, iOutBurn: 0.4, iClamp: 0.05 },
};

/** Um bloco lógico dentro do chip (uma porta, um flip-flop…), pelos nomes dos pinos. */
export interface Unit {
  kind: "not" | "and" | "nand" | "or" | "nor" | "xor" | "dff" | "decade";
  ins: string[];
  outs: string[];
}

interface ChipSpec {
  kind: string;
  name: string;
  family: keyof typeof FAMILIES;
  label: string;
  sub: string;
  labelExplain: string;
  summary: string;
  /** Na ordem dos números dos pinos (1, 2, 3…): nome e explicação. */
  pins: [string, string][];
  units: Unit[];
}

export interface ChipDef extends PartDef {
  chip: { family: keyof typeof FAMILIES; units: Unit[] };
}

/** Posição de cada pino num DIP visto de cima: 1..N/2 embaixo (esq→dir), o resto em cima (dir→esq). */
export function dipLayout(n: number) {
  const half = n / 2;
  const shift = Math.floor((half - 1) / 2);
  const xs = Array.from({ length: half }, (_, i) => (i - shift) * G);
  return Array.from({ length: n }, (_, k) => (k < half ? { x: xs[k], y: 2 * G } : { x: xs[n - 1 - k], y: -2 * G }));
}

function dip(spec: ChipSpec): ChipDef {
  const fam = FAMILIES[spec.family];
  const layout = dipLayout(spec.pins.length);
  const left = Math.min(...layout.map((p) => p.x)) - 14;
  const right = Math.max(...layout.map((p) => p.x)) + 14;
  const inputs = new Set(spec.units.flatMap((u) => u.ins));
  const outputs = new Set(spec.units.flatMap((u) => u.outs));
  const pins: PinDef[] = spec.pins.map(([name, explain], k) => ({
    name,
    ...layout[k],
    role: "passive",
    title: `${k + 1} — ${name}`,
    explain,
  }));

  return {
    kind: spec.kind,
    name: spec.name,
    group: "Lógica",
    prefix: "U",
    summary: spec.summary,
    props: {},
    pins: () => pins,
    bounds: { x: left, y: -2 * G, w: right - left, h: 4 * G },
    markings: () => ({
      label: { text: spec.label, explain: spec.labelExplain },
      notch: {
        text: "Meia-lua",
        explain:
          "O chanfro marca o lado do pino 1 (com a bolinha). Visto de cima, os pinos contam no sentido anti-horário: 1 embaixo à esquerda, o último em cima à esquerda.",
      },
      supply: {
        text: `${fam.vcc} / ${fam.gnd}`,
        explain: `Alimentação: ${fam.vMin} a ${fam.vMax} V entre ${fam.vcc} e ${fam.gnd}. Sem ela o chip não faz nada; acima de ${fam.absMax} V ele queima.`,
      },
    }),
    value: () => spec.label,
    chip: { family: spec.family, units: spec.units },
    Body: ({ mk, live }) => (
      <PackageBody
        pins={pins}
        left={left}
        right={right}
        sub={spec.sub}
        mk={mk}
        live={live}
        vcc={fam.vcc}
        gnd={fam.gnd}
        logic={new Set([...inputs, ...outputs])}
        bright={outputs}
      />
    ),
  };
}

interface PackageProps {
  pins: PinDef[];
  left: number;
  right: number;
  sub: string;
  mk: Record<string, Marking>;
  live?: PartSim;
  vcc: string;
  gnd: string;
  /** Pinos que ganham o pontinho de nível lógico. */
  logic: Set<string>;
  /** Pinos com o nome em destaque (saídas). */
  bright?: Set<string>;
  /** Cor do corpo: preto (chip) ou metal (módulo blindado). */
  fill?: string;
  /** Sem meia-lua (módulos e encapsulamentos sem chanfro). */
  noNotch?: boolean;
}

/** Corpo de chip com duas fileiras de pinos, nomes, código impresso e níveis lógicos ao vivo. */
export function PackageBody({ pins, left, right, sub, mk, live, vcc, gnd, logic, bright, fill = C.black, noNotch }: PackageProps) {
  const pv = live?.reading?.pins;
  const supply = pv ? pv[vcc].v - pv[gnd].v : 0;
  const metal = fill !== C.black;
  return (
    <>
      {pins.map((p) => (
        <Lead key={p.name} x1={p.x} y1={Math.sign(p.y) * 26} x2={p.x} y2={p.y} />
      ))}
      <rect x={left} y={-26} width={right - left} height={52} rx={2} fill={fill} />
      {!noNotch && (
        <Hint title={mk.notch.text} explain={mk.notch.explain}>
          <path d={`M${left} -6 A6 6 0 0 1 ${left} 6 Z`} fill="#3a3a40" />
          <circle cx={pins[0].x} cy={14} r={2} fill="#3a3a40" />
        </Hint>
      )}
      <Print m={mk.label} x={(left + right) / 2} y={-3} size={7.5} weight={600} fill={metal ? C.inkDark : C.ink} />
      <text x={(left + right) / 2} y={7} fontSize={5} fill={metal ? "#55555c" : "#8a8a92"} textAnchor="middle" fontFamily="var(--font-mono)">
        {sub}
      </text>
      {pins.map((p) => {
        const top = p.y < 0;
        const lvl = pv && supply > 1 && logic.has(p.name) ? (pv[p.name].v - pv[gnd].v) / supply : null;
        return (
          <g key={p.name}>
            <text
              x={p.x}
              y={top ? -18 : 20}
              fontSize={4.6}
              fill={
                p.name === vcc || p.name === gnd
                  ? "#f4c80f"
                  : bright?.has(p.name)
                    ? metal
                      ? C.inkDark
                      : "#cfd3dc"
                    : metal
                      ? "#55555c"
                      : "#8a8a92"
              }
              textAnchor="middle"
              fontFamily="var(--font-mono)"
            >
              {p.name}
            </text>
            {lvl !== null && (
              <circle
                className="logic-dot"
                cx={p.x + 6}
                cy={top ? -31 : 31}
                r={2.4}
                fill={lvl > 0.7 ? "var(--e-vcc)" : lvl < 0.3 ? "var(--muted)" : "var(--e-warn)"}
              />
            )}
          </g>
        );
      })}
    </>
  );
}

const QUAD_PINS = (g: string): [string, string][] => [
  ["1A", `Entrada A da porta ${g} 1.`],
  ["1B", `Entrada B da porta ${g} 1.`],
  ["1Y", "Saída da porta 1."],
  ["2A", `Entrada A da porta ${g} 2.`],
  ["2B", `Entrada B da porta ${g} 2.`],
  ["2Y", "Saída da porta 2."],
  ["GND", "Terra (0 V)."],
  ["3Y", "Saída da porta 3."],
  ["3A", `Entrada A da porta ${g} 3.`],
  ["3B", `Entrada B da porta ${g} 3.`],
  ["4Y", "Saída da porta 4."],
  ["4A", `Entrada A da porta ${g} 4.`],
  ["4B", `Entrada B da porta ${g} 4.`],
  ["VCC", "Alimentação: 2 a 6 V. Num 74HC, 9 V queima o chip."],
];

const quadUnits = (kind: Unit["kind"]): Unit[] =>
  [1, 2, 3, 4].map((i) => ({ kind, ins: [`${i}A`, `${i}B`], outs: [`${i}Y`] }));

const HC = "74 = série lógica padrão; HC = CMOS de alta velocidade, alimentado com 2 a 6 V";

function quad(kind: Unit["kind"], num: string, gate: string, rule: string): ChipDef {
  return dip({
    kind: `hc${num}`,
    name: `74HC${num} — 4 portas ${gate}`,
    family: "hc",
    label: `74HC${num}`,
    sub: `4× ${gate}`,
    labelExplain: `${HC}; ${num} = quatro portas ${gate} de 2 entradas.`,
    summary: `Quatro portas ${gate} independentes no mesmo chip. ${rule} Alimente VCC (pino 14) e GND (pino 7).`,
    pins: QUAD_PINS(gate),
    units: quadUnits(kind),
  });
}

export const hc00 = quad("nand", "00", "NAND", "A saída só vai a 0 quando as duas entradas estão em 1. Com NANDs dá para montar qualquer outra porta.");
export const hc08 = quad("and", "08", "AND", "A saída só vai a 1 quando as duas entradas estão em 1.");
export const hc32 = quad("or", "32", "OR", "A saída vai a 1 se qualquer entrada estiver em 1.");
export const hc86 = quad("xor", "86", "XOR", "A saída vai a 1 quando as entradas são diferentes.");

export const hc04 = dip({
  kind: "hc04",
  name: "74HC04 — 6 inversores",
  family: "hc",
  label: "74HC04",
  sub: "6× NOT",
  labelExplain: `${HC}; 04 = seis inversores (NOT).`,
  summary: "Seis inversores: cada saída é o contrário da entrada. Por dentro, cada um é um par de MOSFETs (um P e um N).",
  pins: [
    ["1A", "Entrada do inversor 1."],
    ["1Y", "Saída do inversor 1."],
    ["2A", "Entrada do inversor 2."],
    ["2Y", "Saída do inversor 2."],
    ["3A", "Entrada do inversor 3."],
    ["3Y", "Saída do inversor 3."],
    ["GND", "Terra (0 V)."],
    ["4Y", "Saída do inversor 4."],
    ["4A", "Entrada do inversor 4."],
    ["5Y", "Saída do inversor 5."],
    ["5A", "Entrada do inversor 5."],
    ["6Y", "Saída do inversor 6."],
    ["6A", "Entrada do inversor 6."],
    ["VCC", "Alimentação: 2 a 6 V."],
  ],
  units: [1, 2, 3, 4, 5, 6].map((i) => ({ kind: "not", ins: [`${i}A`], outs: [`${i}Y`] })),
});

export const hc74 = dip({
  kind: "hc74",
  name: "74HC74 — 2 flip-flops D",
  family: "hc",
  label: "74HC74",
  sub: "2× FLIP-FLOP D",
  labelExplain: `${HC}; 74 = dois flip-flops tipo D. Cada um guarda 1 bit.`,
  summary:
    "Memória de 1 bit, duas vezes. Na subida do CLK (0 → 1), Q copia o valor de D e guarda até a próxima subida. /CLR e /PRE são ativos em 0: deixe-os em VCC para o flip-flop funcionar.",
  pins: [
    ["1/CLR", "Zera o flip-flop 1 quando está em 0 (Q = 0). Normalmente fica em VCC."],
    ["1D", "Dado do flip-flop 1: o valor que será guardado."],
    ["1CLK", "Clock do flip-flop 1: na subida, Q copia D."],
    ["1/PRE", "Liga o flip-flop 1 quando está em 0 (Q = 1). Normalmente fica em VCC."],
    ["1Q", "Saída do flip-flop 1."],
    ["1/Q", "Saída invertida do flip-flop 1."],
    ["GND", "Terra (0 V)."],
    ["2/Q", "Saída invertida do flip-flop 2."],
    ["2Q", "Saída do flip-flop 2."],
    ["2/PRE", "Liga o flip-flop 2 quando está em 0."],
    ["2CLK", "Clock do flip-flop 2."],
    ["2D", "Dado do flip-flop 2."],
    ["2/CLR", "Zera o flip-flop 2 quando está em 0."],
    ["VCC", "Alimentação: 2 a 6 V."],
  ],
  units: [1, 2].map((i) => ({ kind: "dff", ins: [`${i}D`, `${i}CLK`, `${i}/CLR`, `${i}/PRE`], outs: [`${i}Q`, `${i}/Q`] })),
});

export const cd4017 = dip({
  kind: "cd4017",
  name: "CD4017 — contador de 0 a 9",
  family: "cd",
  label: "CD4017",
  sub: "CONTADOR 0–9",
  labelExplain:
    "CD = família CMOS 4000, alimentada com 3 a 18 V (funciona direto numa bateria de 9 V); 4017 = contador de década com 10 saídas decodificadas.",
  summary:
    "A cada subida do CLK, a saída ligada passa para a próxima: Q0, Q1, … Q9 e volta. Com um 555 no CLK vira o clássico sequencial de LEDs. Saídas fracas (~400 Ω): bom para LEDs com pouca corrente.",
  pins: [
    ["Q5", "Em 1 quando a contagem é 5."],
    ["Q1", "Em 1 quando a contagem é 1."],
    ["Q0", "Em 1 quando a contagem é 0."],
    ["Q2", "Em 1 quando a contagem é 2."],
    ["Q6", "Em 1 quando a contagem é 6."],
    ["Q7", "Em 1 quando a contagem é 7."],
    ["Q3", "Em 1 quando a contagem é 3."],
    ["VSS", "Terra (0 V)."],
    ["Q8", "Em 1 quando a contagem é 8."],
    ["Q4", "Em 1 quando a contagem é 4."],
    ["Q9", "Em 1 quando a contagem é 9."],
    ["CO", "Carry out: em 1 nas contagens 0 a 4, em 0 de 5 a 9. Serve para ligar um segundo 4017 em cascata."],
    ["INH", "Inibe a contagem quando está em 1. Ligue no VSS para contar."],
    ["CLK", "Clock: cada subida avança uma posição."],
    ["RST", "Volta para Q0 quando está em 1. Ligue no VSS para contar."],
    ["VDD", "Alimentação: 3 a 18 V."],
  ],
  units: [{ kind: "decade", ins: ["CLK", "INH", "RST"], outs: ["Q0", "Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "CO"] }],
});

export const ne555 = dip({
  kind: "ne555",
  name: "NE555 — temporizador",
  family: "555",
  label: "NE555",
  sub: "TIMER",
  labelExplain: "O 555: o chip mais vendido da história. Dois comparadores, um flip-flop e um transistor de descarga num só lugar.",
  summary:
    "Por dentro: três resistores de 5 kΩ dividem o VCC em ⅓ e ⅔. Quando TRIG cai abaixo de ⅓, a saída vai a 1; quando THRES passa de ⅔, a saída vai a 0 e o DIS descarrega o capacitor. Com 2 resistores e 1 capacitor vira um oscilador (astável).",
  pins: [
    ["GND", "Terra (0 V)."],
    ["TRIG", "Disparo: abaixo de ⅓ do VCC, liga a saída (1)."],
    ["OUT", "Saída: alta fica ~1,7 V abaixo do VCC. Aguenta até 200 mA."],
    ["RESET", "Em 0, trava a saída em 0. Ligue no VCC para o 555 funcionar."],
    ["CTRL", "Acesso ao ponto de ⅔ do divisor interno. Normalmente fica solto ou com um capacitor de 10 nF para o GND."],
    ["THRES", "Limiar: acima de ⅔ do VCC, desliga a saída (0)."],
    ["DIS", "Descarga: ligado ao GND por dentro enquanto a saída está em 0. Esvazia o capacitor de tempo."],
    ["VCC", "Alimentação: 4,5 a 16 V."],
  ],
  units: [],
});

export const CHIPS = [hc00, hc04, hc08, hc32, hc86, hc74, cd4017, ne555];
