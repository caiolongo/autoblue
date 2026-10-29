import { C, Hint, Lead, Print } from "./draw";
import type { PartDef } from "./types";

const G = 20;

const HEATSINK = {
  type: "select" as const,
  label: "Dissipador",
  default: "none",
  options: [
    { value: "none", label: "Sem dissipador" },
    { value: "small", label: "Dissipador pequeno" },
  ],
  explain: "Tudo que o regulador “joga fora” vira calor. Com dissipador, ele aguenta bem mais antes de desligar.",
};

export const reg7805: PartDef = {
  kind: "reg7805",
  name: "Regulador 7805",
  group: "Reguladores",
  prefix: "U",
  summary:
    "Regulador linear de 5 V. Recebe de ~7 a 35 V e entrega 5 V estáveis. A diferença de tensão vezes a corrente vira calor.",
  props: { heatsink: HEATSINK },
  pins: () => [
    {
      name: "IN",
      x: -G,
      y: 3 * G,
      role: "passive",
      title: "IN — entrada",
      explain: "Tensão não regulada (bateria, fonte). Precisa ser pelo menos 2 V maior que a saída.",
    },
    {
      name: "GND",
      x: 0,
      y: 3 * G,
      role: "passive",
      title: "GND — terra",
      explain: "Referência comum da entrada e da saída. Também está ligado à aba metálica.",
    },
    { name: "OUT", x: G, y: 3 * G, role: "passive", title: "OUT — saída 5 V", explain: "5 V regulados para o seu circuito." },
  ],
  bounds: { x: -30, y: -54, w: 60, h: 54 + 3 * G },
  markings: () => ({
    model: {
      text: "7805",
      explain: "78 = família de reguladores positivos de 3 pinos. 05 = 5 V na saída (7809 dá 9 V, 7812 dá 12 V…).",
    },
    volts: { text: "+5V", explain: "Tensão de saída." },
    tab: {
      text: "Aba metálica",
      explain: "Furo para parafusar um dissipador. Está ligada ao GND (pino do meio).",
    },
    pinout: { text: "IN GND OUT", explain: "Com a face escrita virada para você, da esquerda para a direita." },
  }),
  value: () => "5 V",
  Body: ({ mk }) => (
    <>
      {[-G, 0, G].map((x) => (
        <Lead key={x} x1={x} y1={14} x2={x} y2={3 * G} />
      ))}
      <Hint title={mk.tab.text} explain={mk.tab.explain}>
        <rect x={-30} y={-54} width={60} height={28} rx={2} fill={C.metal} />
        <circle cx={0} cy={-41} r={6} fill="var(--bg)" />
      </Hint>
      <rect x={-30} y={-28} width={60} height={42} rx={2} fill={C.black} />
      <Print m={mk.model} x={0} y={-14} size={8} weight={600} />
      <Print m={mk.volts} x={0} y={-2} size={6} />
      <Hint title={`Pinagem ${mk.pinout.text}`} explain={mk.pinout.explain}>
        {["IN", "GND", "OUT"].map((n, i) => (
          <text key={n} x={(i - 1) * G + 3} y={34} fontSize={5.5} fill="var(--muted)" fontFamily="var(--font-mono)" dominantBaseline="central">
            {n}
          </text>
        ))}
      </Hint>
    </>
  ),
};

export const ams1117: PartDef = {
  kind: "ams1117",
  name: "Regulador AMS1117-3.3",
  group: "Reguladores",
  prefix: "U",
  summary:
    "Regulador de 3,3 V de baixa queda (LDO): precisa de só ~1,1 V de folga. Muito usado para alimentar ESP32 e sensores a partir de 5 V. Aguenta no máximo 15 V na entrada.",
  props: {},
  pins: () => [
    {
      name: "GND",
      x: -G,
      y: 2 * G,
      role: "passive",
      title: "1 — GND/ADJ",
      explain: "Terra. Nas versões ajustáveis, este pino recebe o divisor de tensão.",
    },
    {
      name: "OUT",
      x: 0,
      y: 2 * G,
      role: "passive",
      title: "2 — OUT (3,3 V)",
      explain: "Saída regulada. A aba grande em cima também é a saída.",
    },
    {
      name: "IN",
      x: G,
      y: 2 * G,
      role: "passive",
      title: "3 — IN",
      explain: "Entrada: de ~4,4 V até 15 V. Atenção: a ordem é diferente do 7805!",
    },
  ],
  bounds: { x: -26, y: -30, w: 52, h: 30 + 2 * G },
  markings: () => ({
    model: { text: "AMS1117", explain: "Regulador LDO (low dropout) de até 1 A." },
    volts: { text: "3.3", explain: "Versão de 3,3 V fixos na saída." },
    tab: { text: "Aba", explain: "A aba larga é o pino 2 (OUT): ela também ajuda a tirar o calor pela placa." },
    pinout: { text: "GND OUT IN", explain: "Pinos 1, 2 e 3, da esquerda para a direita, com o texto virado para você." },
  }),
  value: () => "3,3 V",
  Body: ({ mk }) => (
    <>
      {[-G, 0, G].map((x) => (
        <Lead key={x} x1={x} y1={12} x2={x} y2={2 * G} />
      ))}
      <Hint title={mk.tab.text} explain={mk.tab.explain}>
        <rect x={-14} y={-30} width={28} height={10} rx={1} fill={C.metal} />
      </Hint>
      <rect x={-26} y={-20} width={52} height={32} rx={2} fill={C.black} />
      <Print m={mk.model} x={0} y={-9} size={6.5} weight={600} />
      <Print m={mk.volts} x={0} y={2} size={6} />
      <Hint title={`Pinagem ${mk.pinout.text}`} explain={mk.pinout.explain}>
        {["GND", "OUT", "IN"].map((n, i) => (
          <text key={n} x={(i - 1) * G + 3} y={26} fontSize={5.5} fill="var(--muted)" fontFamily="var(--font-mono)" dominantBaseline="central">
            {n}
          </text>
        ))}
      </Hint>
    </>
  ),
};
