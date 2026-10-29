import { produce } from "immer";
import { addPart, addWire, emptyDoc, partBounds, pinsOf, type BlockDef, type Doc } from "../editor/doc";
import { route } from "../editor/wires";
import { PARTS, type Props } from "../library/parts";

const G = 20;

/** [ref, tipo, x, y (em passos de 0,1"), ajustes, rotação] */
type PartSpec = [string, string, number, number, Props?, number?];

export interface BoardSpec {
  id: string;
  name: string;
  color: string;
  summary: string;
  parts: PartSpec[];
  /** Cada nó: pinos "REF.PINO" que devem ficar ligados. */
  nets: string[][];
  /** Pinos da placa: nome e o pino de dentro onde ele fica. */
  ports: [string, string][];
}

const range = (prefix: string, from: number, to: number, pin: (i: number) => string): [string, string][] =>
  Array.from({ length: to - from + 1 }, (_, k) => [`${prefix}${from + k}`, pin(from + k)]);

export const BOARD_SPECS: BoardSpec[] = [
  {
    id: "board-uno",
    name: "Placa estilo Uno",
    color: "#0f6e7a",
    summary:
      "Placa no estilo do Arduino Uno: ATmega328P com cristal de 16 MHz (fusíveis de cristal), entrada USB de 5 V, regulador 7805 no VIN, LED “L” no D13, LED de energia, botão de reset com pull-up de 10 kΩ e capacitor de desacoplamento.",
    parts: [
      ["J1", "usb5v", -22, -2],
      ["U1", "atmega328p", 0, 0, { clock: "xtal" }],
      ["U2", "reg7805", -14, -12],
      ["Y1", "crystal", 2, 6, { freq: "16" }],
      ["R1", "resistor", -9, 6, { resistance: 10_000 }, 1],
      ["SW1", "pushButton", -14, 11],
      ["R2", "resistor", 8, -8, { resistance: 1000 }],
      ["D1", "led", 12, -6, { color: "yellow" }, 1],
      ["R3", "resistor", -6, -15, { resistance: 1000 }],
      ["D2", "led", 0, -15, { color: "green" }],
      ["C1", "capacitor", -3, 9, { type: "ceramic", capacitance: 100e-9 }],
    ],
    nets: [
      ["J1.VBUS", "U2.OUT", "R3.1", "U1.VCC", "U1.AVCC", "C1.1", "R1.2"],
      ["J1.GND", "U2.GND", "D2.K", "U1.GND", "U1.GND2", "C1.2", "SW1.3", "D1.K"],
      ["U1.RST", "R1.1", "SW1.1"],
      ["U1.PB5", "R2.1"],
      ["R2.2", "D1.A"],
      ["R3.2", "D2.A"],
      ["U1.PB6", "Y1.1"],
      ["U1.PB7", "Y1.2"],
    ],
    ports: [
      ["VIN", "U2.IN"],
      ["5V", "U1.VCC"],
      ["GND", "U1.GND"],
      ["RESET", "U1.RST"],
      ...range("D", 0, 7, (i) => `U1.PD${i}`),
      ...range("D", 8, 13, (i) => `U1.PB${i - 8}`),
      ...range("A", 0, 5, (i) => `U1.PC${i}`),
    ],
  },
  {
    id: "board-pico",
    name: "Placa estilo Pico",
    color: "#2f7d32",
    summary:
      "Placa no estilo da Raspberry Pi Pico: RP2040 com flash SPI de 2 MB, cristal de 12 MHz, regulador de 3,3 V (aqui um AMS1117; a Pico usa um regulador chaveado), núcleo de 1,1 V pelo VREG interno e LED no GP7 (na Pico de verdade fica no GP25).",
    parts: [
      ["J1", "usb5v", -20, -2],
      ["U1", "rp2040", 0, 0],
      ["U2", "ams1117", -12, -10],
      ["U3", "flashSpi", 8, 8],
      ["Y1", "crystal", 2, 6, { freq: "12" }],
      ["R1", "resistor", 0, -8, { resistance: 330 }],
      ["D1", "led", 4, -6, { color: "green" }, 1],
      ["C1", "capacitor", -6, 7, { type: "ceramic", capacitance: 100e-9 }],
    ],
    nets: [
      ["J1.VBUS", "U2.IN"],
      ["U2.OUT", "U1.IOVDD", "U1.VREGIN", "C1.1", "U3.VCC", "U3.WP", "U3.HOLD"],
      ["J1.GND", "U2.GND", "U1.GND", "C1.2", "U3.GND", "D1.K"],
      ["U1.VREGOUT", "U1.DVDD"],
      ["U1.QSS", "U3.CS"],
      ["U1.QSCK", "U3.CLK"],
      ["U1.QSD0", "U3.DI"],
      ["U1.QSD1", "U3.DO"],
      ["U1.XIN", "Y1.1"],
      ["U1.XOUT", "Y1.2"],
      ["U1.GP7", "R1.1"],
      ["R1.2", "D1.A"],
    ],
    ports: [
      ["VBUS", "J1.VBUS"],
      ["3V3", "U2.OUT"],
      ["GND", "U1.GND"],
      ["RUN", "U1.RUN"],
      ...range("GP", 0, 7, (i) => `U1.GP${i}`),
    ],
  },
  {
    id: "board-esp32",
    name: "ESP32 DevKit",
    color: "#1d1d1f",
    summary:
      "Placa de desenvolvimento do ESP32: módulo WROOM-32, regulador AMS1117-3.3, capacitor de 100 µF contra os picos do rádio, pull-up de 10 kΩ e capacitor de 1 µF no EN (partida atrasada), botões EN (reset) e BOOT (GPIO0) e LED no GPIO2.",
    parts: [
      ["J1", "usb5v", -20, -2],
      ["U1", "esp32", 0, 0],
      ["U2", "ams1117", -12, -10],
      ["C2", "capacitor", -9, 7, { capacitance: 100e-6, voltage: 10 }],
      ["R1", "resistor", 0, 6, { resistance: 10_000 }, 1],
      ["C1", "capacitor", -3, 7, { type: "ceramic", capacitance: 1e-6 }, 1],
      ["SW1", "pushButton", 6, 7],
      ["SW2", "pushButton", 12, 7],
      ["R2", "resistor", 6, -6, { resistance: 470 }],
      ["D1", "led", 10, -4, { color: "blue" }, 1],
    ],
    nets: [
      ["J1.VBUS", "U2.IN"],
      ["U2.OUT", "U1.3V3", "C2.+", "R1.2"],
      ["J1.GND", "U2.GND", "C2.-", "U1.GND", "C1.2", "SW1.3", "SW2.3", "D1.K"],
      ["U1.EN", "R1.1", "C1.1", "SW1.1"],
      ["U1.IO0", "SW2.1"],
      ["U1.IO2", "R2.1"],
      ["R2.2", "D1.A"],
    ],
    ports: [
      ["5V", "J1.VBUS"],
      ["3V3", "U1.3V3"],
      ["GND", "U1.GND"],
      ["EN", "U1.EN"],
      ...["0", "2", "4", "5", "12", "13", "15", "34", "35"].map((n): [string, string] => [`IO${n}`, `U1.IO${n}`]),
    ],
  },
  {
    id: "board-bluepill",
    name: "Placa estilo Blue Pill",
    color: "#1f4fbf",
    summary:
      "Placa no estilo da “Blue Pill”: STM32F103C8, regulador de 3,3 V, BOOT0 em 0 por um resistor de 10 kΩ, botão de reset e LED (na placa de verdade, no PC13; aqui, no PB11). Lembre de ligar o clock da porta no RCC antes de usar o GPIO.",
    parts: [
      ["J1", "usb5v", -20, -2],
      ["U1", "stm32f103", 0, 0],
      ["U2", "ams1117", -14, -12],
      ["R1", "resistor", 1, 6, { resistance: 10_000 }, 1],
      ["SW1", "pushButton", -6, 7],
      ["R2", "resistor", -6, -8, { resistance: 330 }],
      ["D1", "led", -10, -6, { color: "green" }, 1],
      ["C1", "capacitor", -6, 11, { type: "ceramic", capacitance: 100e-9 }],
    ],
    nets: [
      ["J1.VBUS", "U2.IN"],
      ["U2.OUT", "U1.VDD", "C1.1"],
      ["J1.GND", "U2.GND", "U1.VSS", "R1.2", "SW1.3", "C1.2", "D1.K"],
      ["U1.BOOT0", "R1.1"],
      ["U1.NRST", "SW1.1"],
      ["U1.PB11", "R2.2"],
      ["R2.1", "D1.A"],
    ],
    ports: [
      ["5V", "J1.VBUS"],
      ["3V3", "U1.VDD"],
      ["GND", "U1.VSS"],
      ["NRST", "U1.NRST"],
      ["BOOT0", "U1.BOOT0"],
      ...["PA0", "PA1", "PA2", "PA3", "PB8", "PB9", "PB10", "PB11"].map((n): [string, string] => [n, `U1.${n}`]),
    ],
  },
  {
    id: "board-digispark",
    name: "Placa estilo Digispark",
    color: "#2b4c9a",
    summary:
      "Placa no estilo do Digispark: ATtiny85 alimentado pelo USB, regulador 7805 no VIN e LED no P1 (PB1). Na placa de verdade, P3 e P4 também são as linhas de dados do USB.",
    parts: [
      ["J1", "usb5v", -20, -2],
      ["U1", "attiny85", 0, 0],
      ["U2", "reg7805", -10, -12],
      ["R1", "resistor", 5, -6, { resistance: 470 }],
      ["D1", "led", 9, -4, { color: "red" }, 1],
    ],
    nets: [
      ["J1.VBUS", "U2.OUT", "U1.VCC"],
      ["J1.GND", "U2.GND", "U1.GND", "D1.K"],
      ["U1.PB1", "R1.1"],
      ["R1.2", "D1.A"],
    ],
    ports: [
      ["VIN", "U2.IN"],
      ["5V", "U1.VCC"],
      ["GND", "U1.GND"],
      ...range("P", 0, 5, (i) => `U1.PB${i}`),
    ],
  },
];

/** Monta o circuito de dentro de uma placa: peças, fios roteados e pinos externos. */
export function buildBoard(spec: BoardSpec): BlockDef {
  let doc: Doc = emptyDoc();
  const byRef: Record<string, string> = {};
  for (const [ref, kind, gx, gy, props, rot] of spec.parts) {
    let id: string;
    [doc, id] = addPart(doc, kind, { x: gx * G, y: gy * G }, rot ?? 0);
    doc = produce(doc, (d) => {
      d.parts[id].ref = ref;
      Object.assign(d.parts[id].props, props ?? {});
    });
    byRef[ref] = id;
  }
  const at = (pinRef: string) => {
    const [ref, pin] = [pinRef.slice(0, pinRef.indexOf(".")), pinRef.slice(pinRef.indexOf(".") + 1)];
    const part = doc.parts[byRef[ref]];
    const hit = part && pinsOf(part).find((x) => x.pin.name === pin);
    if (!hit) throw new Error(`${spec.id}: pino ${pinRef} não existe`);
    return { part, pin: hit.pin, pos: hit.pos };
  };

  for (const net of spec.nets) {
    for (let i = 1; i < net.length; i++) {
      const a = at(net[i - 1]).pos;
      const b = at(net[i]).pos;
      const blocked = [
        ...Object.values(doc.parts).flatMap((p) => pinsOf(p).map((x) => x.pos)),
        ...Object.values(doc.wires).flatMap((w) => [w.points[0], w.points[w.points.length - 1]]),
      ];
      const path = route(a, b, G, blocked, Object.values(doc.parts).map(partBounds), Object.values(doc.wires).map((w) => w.points));
      [doc] = addWire(doc, path);
    }
  }

  // Pinos da placa: cada "Pino do bloco" fica em cima do pino de dentro, virado para fora.
  const pins: BlockDef["pins"] = [];
  for (const [name, target] of spec.ports) {
    const { pin, pos } = at(target);
    const rot = pin.y > 0 ? 1 : pin.y < 0 ? 3 : pin.x < 0 ? 2 : 0;
    let id: string;
    [doc, id] = addPart(doc, "port", pos, rot);
    doc = produce(doc, (d) => {
      d.parts[id].props.name = name;
      d.parts[id].ref = `P_${name}`;
    });
    pins.push({ name, port: id });
  }

  return { id: spec.id, name: spec.name, parts: doc.parts, wires: doc.wires, pins, board: { color: spec.color, summary: spec.summary } };
}

export function buildBoards(): BlockDef[] {
  // Garante que as peças usadas já estão registradas.
  void PARTS;
  return BOARD_SPECS.map(buildBoard);
}
