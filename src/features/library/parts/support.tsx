import { dipLayout, PackageBody } from "./chips";
import { C, Hint, Lead, Print } from "./draw";
import { str, type PartDef, type PinDef } from "./types";

const G = 20;

export const crystal: PartDef = {
  kind: "crystal",
  name: "Cristal",
  group: "Apoio para microcontroladores",
  prefix: "Y",
  summary:
    "Lasca de quartzo que vibra numa frequência muito exata. É o “metrônomo” do chip: dá precisão ao tempo e é obrigatório para USB. Ao lado dele vão dois capacitores de carga (~15–22 pF) para o GND.",
  props: {
    freq: {
      type: "select",
      label: "Frequência",
      default: "12",
      options: [
        { value: "8", label: "8 MHz" },
        { value: "12", label: "12 MHz" },
        { value: "16", label: "16 MHz" },
      ],
    },
  },
  pins: () => [
    { name: "1", x: -G, y: G, role: "passive", title: "Terminal 1", explain: "Vai no XIN (ou OSC_IN/XTAL1) do chip. Cristal não tem polaridade." },
    { name: "2", x: G, y: G, role: "passive", title: "Terminal 2", explain: "Vai no XOUT (ou OSC_OUT/XTAL2) do chip." },
  ],
  bounds: { x: -26, y: -12, w: 52, h: 12 + G },
  markings: (p) => ({
    freq: {
      text: `${Number(str(p, "freq")).toFixed(3)}`,
      explain: `${str(p, "freq")},000 MHz: vibra ${str(p, "freq")} milhões de vezes por segundo.`,
    },
  }),
  value: (p) => `${str(p, "freq")} MHz`,
  Body: ({ mk }) => (
    <>
      <Lead x1={-G} y1={8} x2={-G} y2={G} />
      <Lead x1={G} y1={8} x2={G} y2={G} />
      <rect x={-26} y={-12} width={52} height={22} rx={11} fill={C.metal} stroke="#8a8a92" />
      <Print m={mk.freq} x={0} y={-1} size={7} fill={C.inkDark} weight={600} />
    </>
  ),
};

const FLASH_PINS: [string, string][] = [
  ["CS", "Chip select, ativo em 0: o chip só responde quando o CS desce."],
  ["DO", "Dados saindo da flash (vai no QSPI_SD1 / MISO)."],
  ["WP", "Proteção contra escrita, ativa em 0. Ligue no VCC."],
  ["GND", "Terra (0 V)."],
  ["DI", "Dados entrando na flash (vem do QSPI_SD0 / MOSI)."],
  ["CLK", "Clock: cada pulso move um bit."],
  ["HOLD", "Pausa a comunicação, ativo em 0. Ligue no VCC."],
  ["VCC", "Alimentação: 2,7 a 3,6 V."],
];

const flashLayout = dipLayout(8);
const flashPins: PinDef[] = FLASH_PINS.map(([name, explain], k) => ({
  name,
  ...flashLayout[k],
  role: "passive",
  title: `${k + 1} — ${name}`,
  explain,
}));

export const flashSpi: PartDef = {
  kind: "flashSpi",
  name: "Flash SPI (W25Q16)",
  group: "Apoio para microcontroladores",
  prefix: "U",
  summary:
    "Memória flash de 2 MB que guarda o programa e não esquece quando a energia acaba. O RP2040 lê o programa direto dela pela interface QSPI.",
  props: {},
  pins: () => flashPins,
  bounds: { x: -34, y: -2 * G, w: 88, h: 4 * G },
  markings: () => ({
    label: { text: "25Q16", explain: "25 = flash serial (SPI); Q = suporta modo quad (4 linhas de dados); 16 = 16 Mbit = 2 MB." },
    notch: { text: "Marca do pino 1", explain: "A bolinha marca o pino 1 (CS)." },
    supply: { text: "VCC / GND", explain: "Alimentação: 2,7 a 3,6 V." },
  }),
  value: () => "2 MB",
  Body: ({ mk, live }) => (
    <PackageBody pins={flashPins} left={-34} right={54} sub="FLASH 2MB" mk={mk} live={live} vcc="VCC" gnd="GND" logic={new Set()} />
  ),
};

export const levelShifter: PartDef = {
  kind: "levelShifter",
  name: "Conversor de nível 3,3 ↔ 5 V",
  group: "Apoio para microcontroladores",
  prefix: "U",
  summary:
    "Placa com dois canais, cada um com um MOSFET BSS138 e dois resistores de 10 kΩ. Liga um lado de 3,3 V a um de 5 V nos dois sentidos, sem que os 5 V cheguem ao pino do chip de 3,3 V.",
  props: {},
  pins: () => [
    { name: "LV", x: -2 * G, y: -G, role: "passive", title: "LV", explain: "Tensão do lado baixo (ex.: 3,3 V)." },
    { name: "LV1", x: -2 * G, y: 0, role: "passive", title: "LV1", explain: "Canal 1, lado baixo." },
    { name: "LV2", x: -2 * G, y: G, role: "passive", title: "LV2", explain: "Canal 2, lado baixo." },
    { name: "GND", x: -2 * G, y: 2 * G, role: "passive", title: "GND", explain: "Terra comum aos dois lados." },
    { name: "HV", x: 2 * G, y: -G, role: "passive", title: "HV", explain: "Tensão do lado alto (ex.: 5 V)." },
    { name: "HV1", x: 2 * G, y: 0, role: "passive", title: "HV1", explain: "Canal 1, lado alto." },
    { name: "HV2", x: 2 * G, y: G, role: "passive", title: "HV2", explain: "Canal 2, lado alto." },
  ],
  bounds: { x: -2 * G, y: -G - 14, w: 4 * G, h: 3 * G + 28 },
  markings: () => ({
    lv: { text: "LV", explain: "Lado de baixa tensão." },
    hv: { text: "HV", explain: "Lado de alta tensão." },
    fets: {
      text: "BSS138",
      explain:
        "Em cada canal: porta no LV, fonte no lado baixo, dreno no lado alto. Quando o lado baixo vai a 0, o MOSFET liga e puxa o lado alto para 0 também. Em 1, ele desliga e os resistores puxam cada lado para a própria tensão.",
    },
  }),
  Body: ({ mk }) => (
    <>
      {[-G, 0, G, 2 * G].map((y) => (
        <Lead key={`l${y}`} x1={-2 * G} y1={y} x2={-28} y2={y} />
      ))}
      {[-G, 0, G].map((y) => (
        <Lead key={`r${y}`} x1={28} y1={y} x2={2 * G} y2={y} />
      ))}
      <rect x={-30} y={-G - 14} width={60} height={3 * G + 28} rx={3} fill={C.pcb} />
      <Print m={mk.lv} x={-8} y={-G - 8} size={5.5} weight={700} />
      <Print m={mk.hv} x={8} y={-G - 8} size={5.5} weight={700} />
      <Hint title={mk.fets.text} explain={mk.fets.explain}>
        {[0, G].map((y) => (
          <rect key={y} x={-6} y={y - 4} width={12} height={8} rx={1} fill={C.black} />
        ))}
      </Hint>
      {["LV", "LV1", "LV2", "GND"].map((n, i) => (
        <text key={n} x={-24} y={(i - 1) * G} fontSize={4.6} fill={C.ink} fontFamily="var(--font-mono)" dominantBaseline="central">
          {n}
        </text>
      ))}
      {["HV", "HV1", "HV2"].map((n, i) => (
        <text key={n} x={24} y={(i - 1) * G} fontSize={4.6} fill={C.ink} fontFamily="var(--font-mono)" textAnchor="end" dominantBaseline="central">
          {n}
        </text>
      ))}
    </>
  ),
};

export const SUPPORT = [crystal, flashSpi, levelShifter];
