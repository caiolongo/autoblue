import { MCUS } from "../../../mcu/specs";
import type { McuSpec } from "../../../mcu/types";
import { dipLayout, PackageBody } from "./chips";
import type { PartDef, PinDef, PropDef } from "./types";

const G = 20;

export interface McuDef extends PartDef {
  mcu: McuSpec;
}

function mcuPart(spec: McuSpec): McuDef {
  const layout = dipLayout(spec.pins.length);
  const left = Math.min(...layout.map((p) => p.x)) - 14;
  const right = Math.max(...layout.map((p) => p.x)) + 14;
  const pins: PinDef[] = spec.pins.map((p, k) => ({
    name: p.name,
    ...layout[k],
    role: "passive",
    title: `${k + 1} — ${p.title}`,
    explain: p.explain,
  }));
  const gpios = new Set(spec.pins.filter((p) => p.io).map((p) => p.name));
  const props: Record<string, PropDef> = Object.fromEntries(
    Object.entries(spec.config ?? {}).map(([k, c]) => [k, { type: "select", label: c.label, default: c.default, options: c.options, explain: c.explain }]),
  );

  return {
    kind: spec.kind,
    name: spec.name,
    group: "Microcontroladores",
    prefix: "U",
    summary: spec.partial ? `${spec.summary} (Encapsulamento ${spec.partial}.)` : spec.summary,
    props,
    pins: () => pins,
    bounds: { x: left, y: -2 * G, w: right - left, h: 4 * G },
    markings: () => ({
      label: { text: spec.label, explain: spec.labelExplain },
      notch: {
        text: spec.module ? "Blindagem" : "Marca do pino 1",
        explain: spec.module
          ? "A tampa metálica cobre o chip, a flash e o cristal, e evita que o rádio interfira (e sofra interferência)."
          : "A marca indica o pino 1. Visto de cima, os pinos contam no sentido anti-horário.",
      },
      supply: {
        text: `${spec.vcc} / ${spec.gnd}`,
        explain: `Alimentação: ${spec.vMin} a ${spec.vMax} V. Acima de ${spec.absMax} V o chip queima.`,
      },
    }),
    value: () => spec.label,
    mcu: spec,
    Body: ({ mk, live }) => (
      <PackageBody
        pins={pins}
        left={left}
        right={right}
        sub={spec.sub}
        mk={mk}
        live={live}
        vcc={spec.vcc}
        gnd={spec.gnd}
        logic={gpios}
        fill={spec.module ? "#c4c6cc" : undefined}
        noNotch={spec.module}
      />
    ),
  };
}

export const MCU_PARTS = MCUS.map(mcuPart);
