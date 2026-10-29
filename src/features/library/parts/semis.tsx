import { useId } from "react";
import { C, Hint, Lead, Print } from "./draw";
import { str, type PartDef, type PinDef } from "./types";

const G = 20;

export const LED_COLORS: Record<string, { label: string; hex: string; vf: number; nm: string }> = {
  red: { label: "Vermelho", hex: "#ff3b2f", vf: 2.0, nm: "~630 nm" },
  yellow: { label: "Amarelo", hex: "#ffc400", vf: 2.1, nm: "~590 nm" },
  green: { label: "Verde", hex: "#2fd15a", vf: 2.2, nm: "~570 nm" },
  blue: { label: "Azul", hex: "#2f6bff", vf: 3.0, nm: "~470 nm" },
  white: { label: "Branco", hex: "#f2f4ff", vf: 3.1, nm: "LED azul + fósforo" },
};

export const led: PartDef = {
  kind: "led",
  name: "LED 5 mm",
  group: "Semicondutores",
  prefix: "D",
  summary:
    "Diodo que emite luz. Só conduz do ânodo para o cátodo e precisa de um resistor em série para limitar a corrente (~20 mA).",
  props: {
    color: {
      type: "select",
      label: "Cor",
      default: "red",
      options: Object.entries(LED_COLORS).map(([value, c]) => ({ value, label: c.label })),
      explain: "Cada cor tem uma queda de tensão diferente: vermelho ~2 V, azul e branco ~3 V.",
    },
  },
  pins: () => [
    {
      name: "A",
      x: -2 * G,
      y: 0,
      role: "passive",
      title: "Ânodo (+)",
      explain: "Perna mais longa. A corrente entra por aqui.",
    },
    {
      name: "K",
      x: 2 * G,
      y: 0,
      role: "passive",
      title: "Cátodo (−)",
      explain: "Perna mais curta, do lado chato do encapsulamento. A corrente sai por aqui.",
    },
  ],
  bounds: { x: -2 * G, y: -14, w: 4 * G, h: 28 },
  markings: (p) => {
    const c = LED_COLORS[str(p, "color")];
    return {
      plus: { text: "+", explain: "O ânodo tem a perna mais longa. Ligue no lado de tensão mais alta." },
      flat: {
        text: "Lado chato",
        explain: "A borda do LED tem um lado reto: ele marca o cátodo (−).",
      },
      color: {
        text: c.label,
        explain: `Cor ${c.label.toLowerCase()} (${c.nm}). Queda de tensão típica: ${c.vf.toString().replace(".", ",")} V.`,
      },
    };
  },
  value: (p) => LED_COLORS[str(p, "color")].label,
  Body: ({ p, mk, live }) => {
    const c = LED_COLORS[str(p, "color")];
    const gid = useId();
    const glow = live?.glow ?? 0;
    const dead = !!live?.damaged;
    return (
      <>
        <Lead x1={-2 * G} y1={0} x2={-10} y2={0} />
        <Lead x1={10} y1={0} x2={2 * G} y2={0} />
        {glow > 0 && (
          <>
            <defs>
              <radialGradient id={gid}>
                <stop offset="0%" stopColor={c.hex} stopOpacity={0.75 * glow} />
                <stop offset="100%" stopColor={c.hex} stopOpacity={0} />
              </radialGradient>
            </defs>
            <circle className="led-halo" cx={0} cy={0} r={14 + 26 * glow} fill={`url(#${gid})`} />
          </>
        )}
        <path d="M11 -6.93 A13 13 0 1 0 11 6.93 Z" fill={dead ? "#4a4a4f" : c.hex} opacity={0.55} />
        <Hint title={mk.color.text} explain={mk.color.explain}>
          <circle cx={0} cy={0} r={10} fill={dead ? "#2c2c30" : c.hex} opacity={dead ? 1 : 0.62 + 0.38 * glow} />
          {glow > 0 && <circle cx={0} cy={0} r={4 + 4 * glow} fill="#fff" opacity={0.75 * glow} />}
          {dead ? (
            <path d="M-6 -3 l4 2 l-1 4 l5 2 M2 -7 l1 4" fill="none" stroke="#8a8a92" strokeWidth={1} />
          ) : (
            <ellipse cx={-4} cy={-4} rx={3.5} ry={2.5} fill="#fff" opacity={0.55} />
          )}
        </Hint>
        <Hint title={mk.flat.text} explain={mk.flat.explain}>
          <line x1={11} y1={-6.93} x2={11} y2={6.93} stroke="var(--text-2)" strokeWidth={1.6} />
        </Hint>
        <Print m={mk.plus} x={-22} y={-9} size={9} fill="var(--muted)" />
      </>
    );
  },
};

const DIODES: Record<string, { glass: boolean; explain: string }> = {
  "1N4007": {
    glass: false,
    explain: "Diodo retificador de silício. Aguenta 1 A e até 1000 V ao contrário. Queda de ~0,7 V quando conduz.",
  },
  "1N5819": {
    glass: false,
    explain: "Diodo Schottky. Queda menor (~0,3 V), bom para proteger contra bateria invertida. Aguenta 1 A.",
  },
  "1N4148": {
    glass: true,
    explain: "Diodo de sinal pequeno, corpo de vidro. Rápido, mas só aguenta ~200 mA contínuos.",
  },
};

export const diode: PartDef = {
  kind: "diode",
  name: "Diodo",
  group: "Semicondutores",
  prefix: "D",
  summary: "Válvula de mão única para a corrente: passa do ânodo para o cátodo e bloqueia no sentido contrário.",
  props: {
    model: {
      type: "select",
      label: "Modelo",
      default: "1N4007",
      options: Object.keys(DIODES).map((value) => ({ value, label: value })),
    },
  },
  pins: () => [
    { name: "A", x: -2 * G, y: 0, role: "passive", title: "Ânodo (+)", explain: "Lado sem faixa. A corrente entra por aqui." },
    {
      name: "K",
      x: 2 * G,
      y: 0,
      role: "passive",
      title: "Cátodo (−)",
      explain: "Lado da faixa. A corrente sai por aqui.",
    },
  ],
  bounds: { x: -2 * G, y: -8, w: 4 * G, h: 16 },
  markings: (p) => {
    const model = str(p, "model");
    return {
      model: { text: model, explain: `${model}: ${DIODES[model].explain}` },
      band: { text: "Faixa", explain: "A faixa marca o cátodo (−)." },
    };
  },
  value: (p) => str(p, "model"),
  Body: ({ p, mk }) => {
    const glass = DIODES[str(p, "model")].glass;
    return (
      <>
        <Lead x1={-2 * G} y1={0} x2={-16} y2={0} />
        <Lead x1={16} y1={0} x2={2 * G} y2={0} />
        <rect x={-17} y={-6.5} width={34} height={13} rx={2} fill={glass ? "#e8823a" : C.black} opacity={glass ? 0.8 : 1} />
        <Hint title={mk.band.text} explain={mk.band.explain}>
          <rect x={9} y={-6.5} width={4} height={13} fill={glass ? C.black : "#c9cdd6"} />
        </Hint>
        {!glass && <Print m={mk.model} x={-3} y={0} size={5.5} />}
      </>
    );
  },
};

type Pinout = ("E" | "B" | "C")[];

const BJTS: Record<string, { pinout: Pinout; explain: string }> = {
  "2N2222A": { pinout: ["E", "B", "C"], explain: "Transistor NPN de uso geral. Até 600 mA no coletor e 40 V." },
  "2N3904": { pinout: ["E", "B", "C"], explain: "Transistor NPN pequeno. Até 200 mA no coletor e 40 V." },
  BC547: {
    pinout: ["C", "B", "E"],
    explain: "Transistor NPN pequeno, comum em kits europeus. Até 100 mA. Atenção: pinagem C B E!",
  },
};

const BJT_PIN: Record<string, Omit<PinDef, "x" | "y" | "name">> = {
  C: {
    role: "passive",
    title: "C — Coletor",
    explain: "A corrente principal entra por aqui e sai pelo emissor, quando a base deixa.",
  },
  B: {
    role: "passive",
    title: "B — Base",
    explain: "Uma corrente pequena entrando aqui controla uma corrente bem maior entre coletor e emissor.",
  },
  E: { role: "passive", title: "E — Emissor", explain: "Por onde sai a soma das correntes da base e do coletor." },
};

export const npn: PartDef = {
  kind: "npn",
  name: "Transistor NPN",
  group: "Semicondutores",
  prefix: "Q",
  summary: "Interruptor/amplificador controlado por corrente: a base comanda a passagem entre coletor e emissor.",
  props: {
    model: {
      type: "select",
      label: "Modelo",
      default: "2N2222A",
      options: Object.keys(BJTS).map((value) => ({ value, label: value })),
      explain: "Modelos diferentes podem ter a ordem dos pinos diferente.",
    },
  },
  pins: (p) =>
    BJTS[str(p, "model")].pinout.map((name, i) => ({ name, x: (i - 1) * G, y: 2 * G, ...BJT_PIN[name] })),
  bounds: { x: -18, y: -20, w: 36, h: 20 + 2 * G },
  markings: (p) => {
    const model = str(p, "model");
    const { pinout } = BJTS[model];
    return {
      model: { text: model, explain: `${model}: ${BJTS[model].explain}` },
      pinout: {
        text: pinout.join(" "),
        explain: `Com a face reta virada para você e as pernas para baixo, da esquerda para a direita: ${pinout.join(", ")}. Cada modelo tem a sua ordem; confira sempre o datasheet.`,
      },
    };
  },
  value: (p) => str(p, "model"),
  Body: ({ p, mk }) => {
    const model = str(p, "model");
    const top = model.slice(0, 2);
    const rest = model.slice(2);
    return (
      <>
        {[-G, 0, G].map((x) => (
          <Lead key={x} x1={x} y1={12} x2={x} y2={2 * G} />
        ))}
        <path d="M-18 14 V-2 A18 18 0 0 1 18 -2 V14 Z" fill={C.black} />
        <Print m={{ ...mk.model, text: top }} x={0} y={-3} size={6} />
        <Print m={{ ...mk.model, text: rest }} x={0} y={6} size={6} />
        <Hint title={`Pinagem ${mk.pinout.text}`} explain={mk.pinout.explain}>
          {BJTS[model].pinout.map((n, i) => (
            <text
              key={n}
              x={(i - 1) * G + 4}
              y={28}
              fontSize={7}
              fill="var(--muted)"
              fontFamily="var(--font-mono)"
              dominantBaseline="central"
            >
              {n}
            </text>
          ))}
        </Hint>
      </>
    );
  },
};

const MOSFETS: Record<string, string> = {
  IRLZ44N: "MOSFET canal N de nível lógico (o L): liga totalmente com 5 V na porta. Até 47 A e 55 V.",
  IRF540N: "MOSFET canal N. Precisa de ~10 V na porta para ligar totalmente. Até 33 A e 100 V.",
};

export const mosfet: PartDef = {
  kind: "mosfet",
  name: "MOSFET canal N",
  group: "Semicondutores",
  prefix: "Q",
  summary: "Interruptor controlado por tensão: tensão na porta (G) liga a passagem entre dreno (D) e fonte (S).",
  props: {
    model: {
      type: "select",
      label: "Modelo",
      default: "IRLZ44N",
      options: Object.keys(MOSFETS).map((value) => ({ value, label: value })),
    },
  },
  pins: () => [
    {
      name: "G",
      x: -G,
      y: 3 * G,
      role: "passive",
      title: "G — Porta (gate)",
      explain: "Isolada do resto: quase não puxa corrente. A tensão aqui, em relação à fonte (S), liga ou desliga o MOSFET.",
    },
    {
      name: "D",
      x: 0,
      y: 3 * G,
      role: "passive",
      title: "D — Dreno (drain)",
      explain: "A corrente da carga entra por aqui. Também está ligado à aba metálica.",
    },
    {
      name: "S",
      x: G,
      y: 3 * G,
      role: "passive",
      title: "S — Fonte (source)",
      explain: "Normalmente vai para o GND. A corrente sai por aqui.",
    },
  ],
  bounds: { x: -30, y: -54, w: 60, h: 54 + 3 * G },
  markings: (p) => {
    const model = str(p, "model");
    return {
      model: { text: model, explain: `${model}: ${MOSFETS[model]}` },
      tab: {
        text: "Aba metálica",
        explain: "Furo para parafusar num dissipador de calor. A aba está ligada ao dreno (D)!",
      },
      pinout: { text: "G D S", explain: "Com a face escrita virada para você: porta, dreno, fonte." },
    };
  },
  value: (p) => str(p, "model"),
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
      <Print m={mk.model} x={0} y={-10} size={7} />
      <Hint title={`Pinagem ${mk.pinout.text}`} explain={mk.pinout.explain}>
        {["G", "D", "S"].map((n, i) => (
          <text key={n} x={(i - 1) * G + 4} y={34} fontSize={7} fill="var(--muted)" fontFamily="var(--font-mono)" dominantBaseline="central">
            {n}
          </text>
        ))}
      </Hint>
    </>
  ),
};
