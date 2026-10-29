import { C, Hint, Lead, Print } from "./draw";
import { str, type Marking, type PartDef, type PinDef } from "./types";

const G = 20;

/** Corpo TO-92 (face reta para você, pernas para baixo) com o código impresso e a pinagem embaixo. */
function To92({ model, mk, pinout }: { model: string; mk: Record<string, Marking>; pinout: string[] }) {
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
        {pinout.map((n, i) => (
          <text key={n} x={(i - 1) * G + 4} y={28} fontSize={7} fill="var(--muted)" fontFamily="var(--font-mono)" dominantBaseline="central">
            {n}
          </text>
        ))}
      </Hint>
    </>
  );
}

const TO92_BOUNDS = { x: -18, y: -20, w: 36, h: 20 + 2 * G };

type Pin3 = Omit<PinDef, "x" | "y" | "name">;

const PNPS: Record<string, { pinout: string[]; explain: string }> = {
  "2N3906": { pinout: ["E", "B", "C"], explain: "Transistor PNP de uso geral, par do 2N3904. Até 200 mA." },
  BC557: { pinout: ["C", "B", "E"], explain: "Transistor PNP pequeno, par do BC547. Até 100 mA. Pinagem C B E!" },
};

const PNP_PIN: Record<string, Pin3> = {
  E: {
    role: "passive",
    title: "E — Emissor",
    explain: "No PNP, o emissor vai no lado positivo. A corrente entra por aqui.",
  },
  B: {
    role: "passive",
    title: "B — Base",
    explain: "Ao contrário do NPN: o PNP liga quando a base fica ~0,65 V ABAIXO do emissor (puxando corrente para fora).",
  },
  C: { role: "passive", title: "C — Coletor", explain: "A corrente sai por aqui em direção à carga, que vai para o GND." },
};

export const pnp: PartDef = {
  kind: "pnp",
  name: "Transistor PNP",
  group: "Semicondutores",
  prefix: "Q",
  summary:
    "O espelho do NPN: fica do lado positivo da carga e liga quando a base é puxada para baixo. Com um NPN, forma pares complementares.",
  props: {
    model: {
      type: "select",
      label: "Modelo",
      default: "2N3906",
      options: Object.keys(PNPS).map((value) => ({ value, label: value })),
    },
  },
  pins: (p) => PNPS[str(p, "model")].pinout.map((name, i) => ({ name, x: (i - 1) * G, y: 2 * G, ...PNP_PIN[name] })),
  bounds: TO92_BOUNDS,
  markings: (p) => {
    const model = str(p, "model");
    const { pinout } = PNPS[model];
    return {
      model: { text: model, explain: `${model}: ${PNPS[model].explain}` },
      pinout: {
        text: pinout.join(" "),
        explain: `Com a face reta virada para você: ${pinout.join(", ")}. Confira sempre o datasheet do modelo.`,
      },
    };
  },
  value: (p) => str(p, "model"),
  Body: ({ p, mk }) => <To92 model={str(p, "model")} mk={mk} pinout={PNPS[str(p, "model")].pinout} />,
};

/** MOSFETs pequenos para lógica. `channel` decide se liga com a porta acima (N) ou abaixo (P) da fonte. */
export const SMALL_MOSFETS: Record<string, { channel: "N" | "P"; pinout: string[]; explain: string }> = {
  "2N7000": {
    channel: "N",
    pinout: ["S", "G", "D"],
    explain: "MOSFET canal N pequeno. Liga com ~2–3 V na porta. Até 200 mA.",
  },
  BS250: {
    channel: "P",
    pinout: ["D", "G", "S"],
    explain: "MOSFET canal P pequeno. Liga quando a porta fica uns 3 V abaixo da fonte. Até 180 mA.",
  },
};

export const mosfetSmall: PartDef = {
  kind: "mosfetSmall",
  name: "MOSFET pequeno (N/P)",
  group: "Semicondutores",
  prefix: "Q",
  summary:
    "MOSFETs de sinal, para montar lógica do zero. Um canal N (porta alta = liga) e um canal P (porta baixa = liga) em série formam um inversor CMOS: a base de todo chip digital.",
  props: {
    model: {
      type: "select",
      label: "Modelo",
      default: "2N7000",
      options: [
        { value: "2N7000", label: "2N7000 (canal N)" },
        { value: "BS250", label: "BS250 (canal P)" },
      ],
    },
  },
  pins: (p) => {
    const m = SMALL_MOSFETS[str(p, "model")];
    const n = m.channel === "N";
    const info: Record<string, Pin3> = {
      G: {
        role: "passive",
        title: "G — Porta",
        explain: n
          ? "Tensão aqui acima da fonte (S) liga o canal. Quase não puxa corrente."
          : "Tensão aqui ABAIXO da fonte (S) liga o canal. Quase não puxa corrente.",
      },
      D: { role: "passive", title: "D — Dreno", explain: n ? "Vai para a carga." : "Vai para a carga, que desce até o GND." },
      S: { role: "passive", title: "S — Fonte", explain: n ? "Normalmente no GND." : "Normalmente no positivo (VCC)." },
    };
    return m.pinout.map((name, i) => ({ name, x: (i - 1) * G, y: 2 * G, ...info[name] }));
  },
  bounds: TO92_BOUNDS,
  markings: (p) => {
    const model = str(p, "model");
    const m = SMALL_MOSFETS[model];
    return {
      model: { text: model, explain: `${model}: ${m.explain}` },
      pinout: {
        text: m.pinout.join(" "),
        explain: `Com a face reta virada para você: ${m.pinout.join(", ")}. Modelos diferentes no mesmo encapsulamento mudam a ordem!`,
      },
    };
  },
  value: (p) => `${str(p, "model")} (${SMALL_MOSFETS[str(p, "model")].channel})`,
  Body: ({ p, mk }) => <To92 model={str(p, "model")} mk={mk} pinout={SMALL_MOSFETS[str(p, "model")].pinout} />,
};
