import { C, Hint, Lead, Print } from "./draw";
import { str, type PartDef } from "./types";

const G = 20;

export const pushButton: PartDef = {
  kind: "pushButton",
  name: "Botão",
  group: "Entrada e proteção",
  prefix: "SW",
  summary:
    "Botão de toque (6 × 6 mm). Só conduz enquanto está apertado. Segure o clique sobre ele para apertar, inclusive com a energia ligada.",
  props: {},
  pins: () => [
    { name: "1", x: -2 * G, y: -G, role: "passive", title: "Pino 1", explain: "Ligado por dentro ao pino 2, sempre." },
    { name: "2", x: -2 * G, y: G, role: "passive", title: "Pino 2", explain: "Ligado por dentro ao pino 1, sempre." },
    { name: "3", x: 2 * G, y: -G, role: "passive", title: "Pino 3", explain: "Ligado por dentro ao pino 4, sempre." },
    { name: "4", x: 2 * G, y: G, role: "passive", title: "Pino 4", explain: "Ligado por dentro ao pino 3, sempre." },
  ],
  bounds: { x: -2 * G, y: -G - 4, w: 4 * G, h: 2 * G + 8 },
  markings: () => ({
    pairs: {
      text: "1–2 · 3–4",
      explain:
        "As pernas do mesmo lado já vêm ligadas por dentro. Apertar o botão liga o lado 1–2 ao lado 3–4. É a confusão número 1 na protoboard: ligar os dois fios no mesmo par não faz nada.",
    },
  }),
  Body: ({ mk, pressed }) => (
    <>
      {[-G, G].map((y) => (
        <g key={y}>
          <Lead x1={-2 * G} y1={y} x2={-20} y2={y} />
          <Lead x1={20} y1={y} x2={2 * G} y2={y} />
        </g>
      ))}
      <rect x={-22} y={-22} width={44} height={44} rx={3} fill={C.metal} />
      <rect x={-19} y={-19} width={38} height={38} rx={2} fill="#2b2b2e" />
      <Hint title={mk.pairs.text} explain={mk.pairs.explain}>
        <line x1={-14} y1={-15} x2={-14} y2={15} stroke={C.metal} strokeWidth={1.4} strokeDasharray="2 2" />
        <line x1={14} y1={-15} x2={14} y2={15} stroke={C.metal} strokeWidth={1.4} strokeDasharray="2 2" />
      </Hint>
      <g data-actuator className="actuator">
        <circle cx={0} cy={0} r={pressed ? 9.5 : 11} fill={pressed ? "#111" : "#1d1d1f"} stroke="#55555c" strokeWidth={1.5} />
        {!pressed && <circle cx={-3} cy={-3} r={3} fill="#fff" opacity={0.12} />}
      </g>
    </>
  ),
};

export const slideSwitch: PartDef = {
  kind: "slideSwitch",
  name: "Chave",
  group: "Entrada e proteção",
  prefix: "SW",
  summary:
    "Chave de 3 pinos (SPDT). O pino do meio (comum) liga ao pino 1 ou ao pino 2, conforme a posição. Clique na alavanca para mudar.",
  props: {
    position: {
      type: "select",
      label: "Posição",
      default: "1",
      options: [
        { value: "1", label: "C ligado ao 1" },
        { value: "2", label: "C ligado ao 2" },
      ],
    },
  },
  pins: () => [
    { name: "1", x: -G, y: 2 * G, role: "passive", title: "Pino 1", explain: "Ligado ao comum quando a alavanca está para este lado." },
    {
      name: "C",
      x: 0,
      y: 2 * G,
      role: "passive",
      title: "C — comum",
      explain: "O pino do meio: é ele que muda de lado. Normalmente vai na alimentação ou no sinal que você quer chavear.",
    },
    { name: "2", x: G, y: 2 * G, role: "passive", title: "Pino 2", explain: "Ligado ao comum quando a alavanca está para este lado." },
  ],
  bounds: { x: -30, y: -20, w: 60, h: 20 + 2 * G },
  markings: () => ({
    lever: {
      text: "Alavanca",
      explain: "SPDT = um polo, duas posições. Usada como liga/desliga ligando só C e um dos lados.",
    },
  }),
  Body: ({ p, mk }) => {
    const left = str(p, "position") === "1";
    return (
      <>
        {[-G, 0, G].map((x) => (
          <Lead key={x} x1={x} y1={12} x2={x} y2={2 * G} />
        ))}
        <rect x={-30} y={-12} width={60} height={24} rx={3} fill={C.metal} />
        <rect x={-26} y={-8} width={52} height={16} rx={2} fill="#2b2b2e" />
        <Hint title={mk.lever.text} explain={mk.lever.explain}>
          <g data-actuator className="actuator">
            <rect x={left ? -24 : 2} y={-14} width={22} height={20} rx={3} fill="#1d1d1f" stroke="#55555c" />
            <line x1={left ? -13 : 13} y1={-11} x2={left ? -13 : 13} y2={3} stroke="#55555c" strokeWidth={1.5} />
          </g>
        </Hint>
        <text x={-24} y={22} fontSize={6} fill="var(--muted)" fontFamily="var(--font-mono)">
          1
        </text>
        <text x={4} y={22} fontSize={6} fill="var(--muted)" fontFamily="var(--font-mono)">
          C
        </text>
        <text x={24} y={22} fontSize={6} fill="var(--muted)" fontFamily="var(--font-mono)">
          2
        </text>
      </>
    );
  },
};

const FUSE_LABEL: Record<string, string> = { "0.5": "500mA", "1": "1A", "2": "2A", "5": "5A" };

export const fuse: PartDef = {
  kind: "fuse",
  name: "Fusível",
  group: "Entrada e proteção",
  prefix: "F",
  summary:
    "Fio fino dentro de um tubo de vidro. Se a corrente passar do valor dele, o fio derrete e abre o circuito, protegendo o resto. Depois de queimar, precisa ser trocado.",
  props: {
    rating: {
      type: "select",
      label: "Corrente nominal",
      default: "1",
      options: Object.entries(FUSE_LABEL).map(([value, label]) => ({ value, label })),
    },
    speed: {
      type: "select",
      label: "Tipo",
      default: "F",
      options: [
        { value: "F", label: "F — rápido" },
        { value: "T", label: "T — retardado" },
      ],
      explain: "O rápido queima logo. O retardado aguenta picos curtos, como a partida de um motor.",
    },
  },
  pins: () => [
    { name: "1", x: -3 * G, y: 0, role: "passive", title: "Terminal 1", explain: "Fusíveis não têm polaridade." },
    { name: "2", x: 3 * G, y: 0, role: "passive", title: "Terminal 2", explain: "Fusíveis não têm polaridade." },
  ],
  bounds: { x: -3 * G, y: -10, w: 6 * G, h: 20 },
  markings: (p) => {
    const label = `${str(p, "speed")}${FUSE_LABEL[str(p, "rating")]}`;
    return {
      code: {
        text: `${label} 250V`,
        explain: `${str(p, "speed") === "F" ? "F = rápido (fast)" : "T = retardado (time-lag)"}. ${FUSE_LABEL[str(p, "rating")]} = corrente que ele aguenta sem queimar. 250V = a maior tensão que ele consegue interromper com segurança.`,
      },
    };
  },
  value: (p) => `${str(p, "speed")}${FUSE_LABEL[str(p, "rating")]}`,
  Body: ({ mk, live }) => {
    const blown = !!live?.damaged;
    return (
      <>
        <Lead x1={-3 * G} y1={0} x2={-36} y2={0} />
        <Lead x1={36} y1={0} x2={3 * G} y2={0} />
        <rect x={-28} y={-8} width={56} height={16} fill="#c8dce6" opacity={0.35} stroke={C.metal} strokeWidth={0.8} />
        {blown ? (
          <>
            <line x1={-28} y1={0} x2={-6} y2={1} stroke={C.lead} strokeWidth={0.9} />
            <line x1={6} y1={-1} x2={28} y2={0} stroke={C.lead} strokeWidth={0.9} />
            <ellipse cx={0} cy={0} rx={10} ry={6} fill="#3a3a40" opacity={0.6} />
          </>
        ) : (
          <line x1={-28} y1={0} x2={28} y2={0} stroke={C.lead} strokeWidth={0.9} />
        )}
        <rect x={-36} y={-9} width={10} height={18} rx={1.5} fill={C.metal} />
        <rect x={26} y={-9} width={10} height={18} rx={1.5} fill={C.metal} />
        <Print m={mk.code} x={0} y={-14} size={5.5} fill="var(--muted)" />
      </>
    );
  },
};
