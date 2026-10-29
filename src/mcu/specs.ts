import type { McuPin, McuReg, McuSpec } from "./types";

const gpio = (name: string, port: string, bit: number, explain: string, extra: Partial<McuPin> = {}): McuPin => ({
  name,
  title: name,
  kind: "gpio",
  io: { port, bit },
  explain,
  ...extra,
});

/** Bits de um registrador de 8 bits a partir dos nomes dos pinos (índice = bit). */
const bitsOf = (names: string[], width = 8): (string | null)[] => {
  const out: (string | null)[] = Array(width).fill(null);
  for (const n of names) {
    const bit = Number(n.match(/\d+$/)![0]);
    out[bit] = n;
  }
  return out;
};

// ---------------------------------------------------------------- ATtiny85

const T85_PB = ["PB0", "PB1", "PB2", "PB3", "PB4", "PB5"];

export const attiny85: McuSpec = {
  kind: "attiny85",
  name: "ATtiny85",
  label: "ATTINY85",
  sub: "AVR · 8 PINOS",
  labelExplain: "Microcontrolador AVR de 8 pinos: o mesmo núcleo do ATmega328P, com só 6 GPIOs (porta B).",
  summary:
    "Um AVR completo em 8 pinos. Oscilador interno de 8 MHz: não precisa de cristal. Cada pino faz várias coisas, e até o RESET pode virar GPIO (com o fusível RSTDISBL), mas aí você perde o jeito normal de regravar o chip.",
  pins: [
    gpio("PB5", "B", 5, "RESET (ativo em 0, com pull-up interno). Com o fusível RSTDISBL, vira o GPIO PB5.", {
      kind: "reset",
      pull: "up",
      gpioIf: { prop: "rstdisbl", value: "1" },
    }),
    gpio("PB3", "B", 3, "GPIO PB3. Também é XTAL1, se um cristal externo for usado."),
    gpio("PB4", "B", 4, "GPIO PB4. Também é XTAL2."),
    { name: "GND", title: "GND", kind: "gnd", explain: "Terra (0 V)." },
    gpio("PB0", "B", 0, "GPIO PB0. Também é MOSI e PWM (OC0A)."),
    gpio("PB1", "B", 1, "GPIO PB1. Também é MISO e PWM (OC0B)."),
    gpio("PB2", "B", 2, "GPIO PB2. Também é SCK."),
    { name: "VCC", title: "VCC", kind: "vcc", explain: "Alimentação: 2,7 a 5,5 V." },
  ],
  vcc: "VCC",
  gnd: "GND",
  vMin: 2.7,
  vMax: 5.5,
  absMax: 6,
  brownout: 1.8,
  current: 0.005,
  rout: 25,
  rpull: 35_000,
  iPin: 0.02,
  iPinBurn: 0.08,
  pullFromOut: true,
  regs: [
    {
      name: "DDRB",
      role: "dir",
      port: "B",
      bits: bitsOf(T85_PB),
      reset: 0,
      explain: "Direção: 1 = saída, 0 = entrada. Todo pino começa como entrada.",
    },
    {
      name: "PORTB",
      role: "out",
      port: "B",
      bits: bitsOf(T85_PB),
      reset: 0,
      explain: "Em saída: 1 = pino em VCC, 0 = pino em GND. Em entrada: 1 liga o pull-up interno (~35 kΩ). O mesmo registrador faz as duas coisas.",
    },
    {
      name: "PINB",
      role: "in",
      port: "B",
      bits: bitsOf(T85_PB),
      reset: 0,
      explain: "Leitura: o nível que o pino tem agora (acima de metade do VCC = 1).",
    },
  ],
  config: {
    rstdisbl: {
      label: "Fusível RSTDISBL",
      default: "0",
      options: [
        { value: "0", label: "Pino 1 é RESET" },
        { value: "1", label: "Pino 1 é GPIO PB5" },
      ],
      explain: "Fusível é uma configuração gravada uma vez. Com RSTDISBL ligado você ganha um GPIO e perde o reset, e o chip não aceita mais regravação comum.",
    },
  },
  check: (c) => ({
    stop: c.props.rstdisbl !== "1" && !c.high("PB5") ? "RESET (pino 1) em 0: o chip fica parado em reset." : null,
    notes: [],
  }),
};

// ---------------------------------------------------------------- RP2040

const RP_GP = ["GP0", "GP1", "GP2", "GP3", "GP4", "GP5", "GP6", "GP7"];

export const rp2040: McuSpec = {
  kind: "rp2040",
  name: "RP2040",
  label: "RP2040",
  sub: "2× ARM M0+ · 3,3 V",
  labelExplain: "Microcontrolador de dois núcleos ARM Cortex-M0+. Não tem memória para programa por dentro: precisa de uma flash SPI externa.",
  summary:
    "Por dentro: dois núcleos de 1,1 V (alimentados pelo regulador interno VREG), GPIOs de 3,3 V e nenhuma memória de programa. Sem uma flash externa, ele liga no modo de gravação USB e fica esperando. Os GPIOs NÃO aguentam 5 V.",
  partial: "QFN-56, só os pinos principais",
  pins: [
    { name: "IOVDD", title: "IOVDD", kind: "vcc", explain: "Alimentação dos pinos: 1,8 a 3,3 V. Máximo absoluto 3,63 V." },
    { name: "GND", title: "GND", kind: "gnd", explain: "Terra (0 V)." },
    { name: "VREGIN", title: "VREG_VIN", kind: "other", explain: "Entrada do regulador interno (3,3 V). Ele gera os 1,1 V do núcleo." },
    { name: "VREGOUT", title: "VREG_VOUT", kind: "other", explain: "Saída do regulador interno: 1,1 V. Precisa ir ligada ao DVDD, por fora." },
    { name: "DVDD", title: "DVDD", kind: "other", explain: "Alimentação do núcleo digital: 1,1 V. Ligue no VREG_VOUT." },
    { name: "RUN", title: "RUN", kind: "reset", pull: "up", explain: "Reset geral, ativo em 0. Tem pull-up interno." },
    { name: "XIN", title: "XIN", kind: "other", explain: "Cristal de 12 MHz (entrada). Sem cristal ele roda no oscilador em anel interno, impreciso e sem USB." },
    { name: "XOUT", title: "XOUT", kind: "other", explain: "Cristal de 12 MHz (saída)." },
    { name: "QSS", title: "QSPI_SS", kind: "other", explain: "Seleção da flash externa (CS)." },
    { name: "QSCK", title: "QSPI_SCLK", kind: "other", explain: "Clock da flash externa." },
    { name: "QSD0", title: "QSPI_SD0", kind: "other", explain: "Dados da flash externa (vai no DI)." },
    { name: "QSD1", title: "QSPI_SD1", kind: "other", explain: "Dados da flash externa (vem do DO)." },
    ...RP_GP.map((n, i) => gpio(n, "0", i, `GPIO${i}. Só 3,3 V: 5 V aqui queima o chip.`)),
  ],
  vcc: "IOVDD",
  gnd: "GND",
  vMin: 1.8,
  vMax: 3.3,
  absMax: 3.63,
  brownout: 1.6,
  current: 0.003,
  rout: 60,
  rpull: 50_000,
  iPin: 0.012,
  iPinBurn: 0.05,
  regs: [
    { name: "GPIO_OE", role: "dir", port: "0", bits: RP_GP, reset: 0, explain: "Habilita a saída: 1 = o pino é saída." },
    { name: "GPIO_OUT", role: "out", port: "0", bits: RP_GP, reset: 0, explain: "Valor de saída de cada pino." },
    { name: "GPIO_IN", role: "in", port: "0", bits: RP_GP, reset: 0, explain: "Nível lido em cada pino." },
    {
      name: "GPIO_OUT_SET",
      role: "set",
      target: "GPIO_OUT",
      bits: RP_GP,
      reset: 0,
      explain: "Escrever 1 num bit liga só aquele bit do GPIO_OUT, sem ler nem mexer nos outros (atômico).",
    },
    { name: "GPIO_OUT_CLR", role: "clr", target: "GPIO_OUT", bits: RP_GP, reset: 0, explain: "Escrever 1 desliga só aquele bit do GPIO_OUT." },
    { name: "GPIO_OUT_XOR", role: "xor", target: "GPIO_OUT", bits: RP_GP, reset: 0, explain: "Escrever 1 inverte só aquele bit do GPIO_OUT." },
    { name: "PADS_PUE", role: "pull", port: "0", bits: RP_GP, reset: 0, explain: "Pull-up interno de cada pino (~50 kΩ)." },
    {
      name: "PADS_PDE",
      role: "pulldown",
      port: "0",
      bits: RP_GP,
      reset: 0xff,
      explain: "Pull-down interno. Vem LIGADO em todos os pinos depois do reset: um botão para o GND não vai ler nada diferente.",
    },
  ],
  check: (c) => {
    const notes: string[] = [];
    let stop: string | null = null;
    if (c.v("DVDD") < 1.0) stop = "Núcleo sem 1,1 V: ligue VREG_VIN no 3,3 V e VREG_VOUT no DVDD. Sem isso, os núcleos estão desligados.";
    else if (!c.high("RUN")) stop = "RUN em 0: o chip está em reset.";
    else {
      const flash = c.wiredTo("QSS", "flashSpi", "CS");
      const ok = flash && c.wiredTo("QSCK", "flashSpi", "CLK") === flash && c.wiredTo("QSD0", "flashSpi", "DI") === flash;
      if (!ok)
        stop =
          "Sem memória flash: o RP2040 não guarda programa por dentro. Ligue uma flash SPI (QSS→CS, QSCK→CLK, QSD0→DI, QSD1←DO). Sem ela, ele liga no modo de gravação USB (BOOTSEL) e fica esperando.";
    }
    const xtal = c.wiredTo("XIN", "crystal", "1") ?? c.wiredTo("XIN", "crystal", "2");
    if (!xtal) notes.push("Sem cristal em XIN/XOUT: roda no oscilador em anel interno, que varia com temperatura e tensão. USB não funciona assim.");
    return { stop, notes };
  },
};

// ---------------------------------------------------------------- ESP32

const ESP_OUT = ["IO0", "IO2", "IO4", "IO5", "IO12", "IO13", "IO15"];
const espBits = (names: string[]) => bitsOf(names, 32);

export const esp32: McuSpec = {
  kind: "esp32",
  name: "ESP32 (módulo WROOM-32)",
  label: "ESP32-WROOM-32",
  sub: "Wi-Fi · BT · 3,3 V",
  labelExplain: "Módulo com o chip ESP32, a memória flash, o cristal e a antena dentro da blindagem metálica.",
  summary:
    "Dois núcleos com Wi-Fi e Bluetooth. Quando o rádio transmite, puxa picos de ~400 mA: com fonte fraca ou sem capacitor, a tensão afunda abaixo de 2,43 V e ele reinicia (brownout). O nível do GPIO0 e do GPIO12 na partida decide como ele inicia.",
  module: true,
  partial: "38 pinos, só os principais",
  pins: [
    { name: "3V3", title: "3V3", kind: "vcc", explain: "Alimentação: 3,0 a 3,6 V. Use um regulador (ex.: AMS1117-3.3) e um capacitor grande perto." },
    { name: "GND", title: "GND", kind: "gnd", explain: "Terra (0 V)." },
    { name: "EN", title: "EN", kind: "reset", explain: "Liga o chip quando está em 1. NÃO tem pull-up no módulo: precisa de 10 kΩ para o 3V3 (e 1 µF para o GND)." },
    gpio("IO0", "0", 0, "GPIO0. Pino de boot: em 0 na partida, entra no modo de gravação. Tem pull-up interno.", { pull: "up" }),
    gpio("IO2", "0", 2, "GPIO2. Pino de boot: tem pull-down interno; deixe solto ou em 0 na partida.", { pull: "down" }),
    gpio("IO4", "0", 4, "GPIO4. Livre para uso."),
    gpio("IO5", "0", 5, "GPIO5. Livre para uso."),
    gpio("IO12", "0", 12, "GPIO12 (MTDI). Pino de boot: em 1 na partida, configura a flash para 1,8 V e o boot falha. Tem pull-down interno.", {
      pull: "down",
    }),
    gpio("IO13", "0", 13, "GPIO13. Livre para uso."),
    gpio("IO15", "0", 15, "GPIO15 (MTDO). Pino de boot; tem pull-up interno.", { pull: "up" }),
    gpio("IO34", "1", 2, "GPIO34: SÓ ENTRADA. Não tem saída nem pull-up/pull-down.", { inputOnly: true }),
    gpio("IO35", "1", 3, "GPIO35: SÓ ENTRADA. Não tem saída nem pull-up/pull-down.", { inputOnly: true }),
  ],
  vcc: "3V3",
  gnd: "GND",
  vMin: 3.0,
  vMax: 3.6,
  absMax: 3.9,
  brownout: 2.43,
  current: 0.08,
  rout: 30,
  rpull: 45_000,
  iPin: 0.02,
  iPinBurn: 0.08,
  burst: { current: 0.4, every: 0.3, length: 0.03 },
  regs: [
    { name: "GPIO_ENABLE", role: "dir", port: "0", bits: espBits(ESP_OUT), reset: 0, explain: "Habilita a saída: 1 = o pino é saída." },
    { name: "GPIO_OUT", role: "out", port: "0", bits: espBits(ESP_OUT), reset: 0, explain: "Valor de saída de cada pino." },
    { name: "GPIO_OUT_W1TS", role: "set", target: "GPIO_OUT", bits: espBits(ESP_OUT), reset: 0, explain: "“Write 1 to set”: escrever 1 liga só aquele bit." },
    { name: "GPIO_OUT_W1TC", role: "clr", target: "GPIO_OUT", bits: espBits(ESP_OUT), reset: 0, explain: "“Write 1 to clear”: escrever 1 desliga só aquele bit." },
    { name: "GPIO_IN", role: "in", port: "0", bits: espBits(ESP_OUT), reset: 0, explain: "Nível lido nos GPIO 0 a 31." },
    { name: "GPIO_IN1", role: "in", port: "1", bits: [null, null, "IO34", "IO35"], reset: 0, explain: "Nível lido nos GPIO 32 a 39 (bit 0 = GPIO32)." },
  ],
  check: (c) => ({
    stop: !c.high("EN")
      ? c.lonely("EN")
        ? "EN solto: no módulo ele não tem pull-up, então fica em 0 e o ESP32 não liga. Ligue EN no 3V3 por 10 kΩ."
        : "EN em 0: o ESP32 está desligado (reset)."
      : null,
    notes: [],
  }),
  boot: (c) =>
    !c.high("IO0")
      ? "Modo de gravação: o GPIO0 estava em 0 na partida. Solte o GPIO0 (ele tem pull-up interno) e reinicie pelo EN."
      : c.high("IO12")
        ? "Boot falhou: o GPIO12 estava em 1 na partida, e isso configura a flash interna para 1,8 V. Deixe o GPIO12 solto ou em 0 ao ligar."
        : null,
};

// ---------------------------------------------------------------- STM32F103C8

const STM_A = ["PA0", "PA1", "PA2", "PA3"];
const STM_B = ["PB8", "PB9", "PB10", "PB11"];
const stmBits = (names: string[]) => bitsOf(names, 16);

export const stm32f103: McuSpec = {
  kind: "stm32f103",
  name: "STM32F103C8",
  label: "STM32F103C8",
  sub: "ARM M3 · 3,3 V",
  labelExplain: "Microcontrolador ARM Cortex-M3 de 72 MHz. Família STM32 “F1”.",
  summary:
    "Para economizar energia, todo periférico começa com o clock desligado, inclusive o GPIO: escrever nos registradores de uma porta não faz nada até ligar o bit dela no RCC_APB2ENR. Cada pino se configura com 4 bits (CRL/CRH). PB8–PB11 aguentam 5 V (FT); PA0–PA3 não.",
  partial: "LQFP-48, só os pinos principais",
  pins: [
    { name: "VDD", title: "VDD", kind: "vcc", explain: "Alimentação: 2,0 a 3,6 V." },
    { name: "VSS", title: "VSS", kind: "gnd", explain: "Terra (0 V)." },
    { name: "NRST", title: "NRST", kind: "reset", pull: "up", explain: "Reset, ativo em 0. Tem pull-up interno." },
    { name: "BOOT0", title: "BOOT0", kind: "other", explain: "Em 0 na partida: roda o seu programa (flash). Em 1: inicia o bootloader de gravação. Ligue no GND por 10 kΩ." },
    gpio("PA0", "A", 0, "GPIO PA0. Não aguenta 5 V."),
    gpio("PA1", "A", 1, "GPIO PA1. Não aguenta 5 V."),
    gpio("PA2", "A", 2, "GPIO PA2. Não aguenta 5 V."),
    gpio("PA3", "A", 3, "GPIO PA3. Não aguenta 5 V."),
    gpio("PB8", "B", 8, "GPIO PB8. FT: aguenta 5 V na entrada.", { fiveVolt: true }),
    gpio("PB9", "B", 9, "GPIO PB9. FT: aguenta 5 V na entrada.", { fiveVolt: true }),
    gpio("PB10", "B", 10, "GPIO PB10. FT: aguenta 5 V na entrada.", { fiveVolt: true }),
    gpio("PB11", "B", 11, "GPIO PB11. FT: aguenta 5 V na entrada.", { fiveVolt: true }),
  ],
  vcc: "VDD",
  gnd: "VSS",
  vMin: 2.0,
  vMax: 3.6,
  absMax: 4.0,
  brownout: 1.9,
  current: 0.025,
  rout: 40,
  rpull: 40_000,
  iPin: 0.008,
  iPinBurn: 0.05,
  regs: [
    {
      name: "RCC_APB2ENR",
      role: "clock",
      bits: [null, null, "IOPAEN", "IOPBEN"],
      reset: 0,
      explain: "Liga o clock dos periféricos. Bit 2 = porta A, bit 3 = porta B. Começa tudo desligado.",
    },
    {
      name: "GPIOA_CRL",
      role: "mode4",
      port: "A",
      bits: STM_A,
      reset: 0x44444444,
      explain: "Configuração dos pinos PA0–PA7, 4 bits cada (MODE e CNF). Depois do reset, todos são entrada flutuante (0100).",
    },
    {
      name: "GPIOB_CRH",
      role: "mode4",
      port: "B",
      bits: STM_B,
      reset: 0x44444444,
      explain: "Configuração dos pinos PB8–PB15, 4 bits cada.",
    },
    { name: "GPIOA_ODR", role: "out", port: "A", bits: stmBits(STM_A), reset: 0, explain: "Saída da porta A. Com o pino em entrada com pull: 1 = pull-up, 0 = pull-down." },
    { name: "GPIOB_ODR", role: "out", port: "B", bits: stmBits(STM_B), reset: 0, explain: "Saída da porta B." },
    { name: "GPIOA_IDR", role: "in", port: "A", bits: stmBits(STM_A), reset: 0, explain: "Leitura da porta A." },
    { name: "GPIOB_IDR", role: "in", port: "B", bits: stmBits(STM_B), reset: 0, explain: "Leitura da porta B." },
  ],
  check: (c) => {
    const notes: string[] = [];
    if (c.lonely("BOOT0")) notes.push("BOOT0 solto: num chip de verdade a partida fica imprevisível. Ligue no GND por 10 kΩ.");
    return {
      stop: !c.high("NRST")
        ? "NRST em 0: o chip está em reset."
        : c.high("BOOT0")
          ? "BOOT0 em 1: o chip iniciou pelo bootloader de gravação (serial), não pelo seu programa."
          : null,
      notes,
    };
  },
};

// ---------------------------------------------------------------- PIC16F628A

const PIC_A = ["RA0", "RA1", "RA2", "RA3", "RA4", "RA5", "RA6", "RA7"];
const PIC_B = ["RB0", "RB1", "RB2", "RB3", "RB4", "RB5", "RB6", "RB7"];

export const pic16f628a: McuSpec = {
  kind: "pic16f628a",
  name: "PIC16F628A",
  label: "PIC16F628A",
  sub: "PIC · 18 PINOS",
  labelExplain: "Microcontrolador PIC de 8 bits da Microchip, muito usado em projetos clássicos. Oscilador interno de 4 MHz.",
  summary:
    "Lógica diferente do AVR: no TRIS, 1 = ENTRADA. Os comparadores vêm ligados no PORTA (RA0–RA3 leem sempre 0 até CMCON = 111). Sem registrador LAT, ligar um bit com BSF lê os pinos da porta inteira e regrava tudo: um pino com carga pesada é lido como 0 e desliga sozinho.",
  pins: [
    gpio("RA2", "A", 2, "GPIO RA2. Também é entrada de comparador."),
    gpio("RA3", "A", 3, "GPIO RA3. Também é entrada de comparador."),
    gpio("RA4", "A", 4, "GPIO RA4: saída OPEN-DRAIN. Só consegue puxar para 0; para dar 1 precisa de um resistor de pull-up.", { openDrain: true }),
    gpio("RA5", "A", 5, "MCLR: reset, ativo em 0, SEM pull-up interno. Ligue no VDD por 10 kΩ. Com MCLRE desligado, vira entrada RA5 (só entrada).", {
      kind: "reset",
      inputOnly: true,
      gpioIf: { prop: "mclre", value: "0" },
    }),
    { name: "VSS", title: "VSS", kind: "gnd", explain: "Terra (0 V)." },
    ...PIC_B.map((n, i) => gpio(n, "B", i, `GPIO ${n}. A porta B tem pull-ups fracos opcionais (OPTION_REG).`)),
    { name: "VDD", title: "VDD", kind: "vcc", explain: "Alimentação: 3,0 a 5,5 V." },
    gpio("RA6", "A", 6, "GPIO RA6 (OSC2, livre com o oscilador interno)."),
    gpio("RA7", "A", 7, "GPIO RA7 (OSC1, livre com o oscilador interno)."),
    gpio("RA0", "A", 0, "GPIO RA0. Também é entrada de comparador."),
    gpio("RA1", "A", 1, "GPIO RA1. Também é entrada de comparador."),
  ],
  vcc: "VDD",
  gnd: "VSS",
  vMin: 3.0,
  vMax: 5.5,
  absMax: 6.5,
  brownout: 0,
  current: 0.002,
  rout: 25,
  rpull: 20_000,
  iPin: 0.025,
  iPinBurn: 0.08,
  rmw: true,
  regs: [
    { name: "TRISA", role: "dirInv", port: "A", bits: PIC_A, reset: 0xff, explain: "Direção da porta A: 1 = ENTRADA, 0 = saída (ao contrário do AVR). Começa tudo em entrada." },
    { name: "TRISB", role: "dirInv", port: "B", bits: PIC_B, reset: 0xff, explain: "Direção da porta B: 1 = entrada, 0 = saída." },
    {
      name: "PORTA",
      role: "out",
      port: "A",
      bits: PIC_A,
      reset: 0,
      explain: "Escrever: muda a saída. Ler: devolve o nível dos PINOS, não o que você escreveu. Ligar um bit (BSF) lê a porta toda, muda o bit e regrava tudo.",
    },
    { name: "PORTB", role: "out", port: "B", bits: PIC_B, reset: 0, explain: "Como o PORTA, para a porta B." },
    {
      name: "OPTION_REG",
      role: "rbpu",
      port: "B",
      bits: [null, null, null, null, null, null, null, "RBPU"],
      reset: 0xff,
      explain: "Bit 7 (RBPU, ativo em 0): em 0 liga os pull-ups fracos da porta B nos pinos em entrada.",
    },
    {
      name: "CMCON",
      role: "cmcon",
      port: "A",
      bits: ["CM0", "CM1", "CM2"],
      reset: 0,
      explain: "Comparadores. Depois do reset (000) eles ocupam RA0–RA3, que leem sempre 0. Escreva 111 para usar esses pinos como digitais.",
    },
  ],
  config: {
    mclre: {
      label: "Configuração MCLRE",
      default: "1",
      options: [
        { value: "1", label: "Pino 4 é MCLR (reset)" },
        { value: "0", label: "Pino 4 é entrada RA5" },
      ],
      explain: "Bit de configuração gravado junto com o programa.",
    },
    boren: {
      label: "Configuração BOREN",
      default: "1",
      options: [
        { value: "1", label: "Brown-out ligado (reinicia abaixo de ~4 V)" },
        { value: "0", label: "Brown-out desligado" },
      ],
      explain: "Com o brown-out ligado (padrão), o PIC16F628A reinicia abaixo de ~4 V: a 3,3 V ele nunca roda.",
    },
  },
  check: (c) => {
    if (c.props.mclre !== "0" && !c.high("RA5"))
      return {
        stop: c.lonely("RA5")
          ? "MCLR (pino 4) solto: sem pull-up interno, ele fica em 0 e o PIC em reset. Ligue no VDD por 10 kΩ."
          : "MCLR (pino 4) em 0: o PIC está em reset.",
        notes: [],
      };
    if (c.props.boren !== "0" && c.v("VDD") < 4.0)
      return { stop: `Brown-out: com BOREN ligado, abaixo de ~4 V o PIC fica reiniciando (agora: ${c.v("VDD").toFixed(2)} V).`, notes: [] };
    return { stop: null, notes: [] };
  },
};


// ---------------------------------------------------------------- ATmega328P

const M_B = ["PB0", "PB1", "PB2", "PB3", "PB4", "PB5", "PB6", "PB7"];
const M_C = ["PC0", "PC1", "PC2", "PC3", "PC4", "PC5"];
const M_D = ["PD0", "PD1", "PD2", "PD3", "PD4", "PD5", "PD6", "PD7"];
const ARDUINO: Record<string, string> = {
  ...Object.fromEntries(M_D.map((n, i) => [n, `D${i}`])),
  ...Object.fromEntries(M_B.slice(0, 6).map((n, i) => [n, `D${i + 8}`])),
  ...Object.fromEntries(M_C.map((n, i) => [n, `A${i}`])),
};
const EXTRA: Record<string, string> = {
  PD0: " Também é RX da serial.",
  PD1: " Também é TX da serial.",
  PB3: " Também é MOSI.",
  PB4: " Também é MISO.",
  PB5: " Também é SCK. No Arduino Uno, é o LED da placa.",
  PC4: " Também é SDA (I2C).",
  PC5: " Também é SCL (I2C).",
};
const mpin = (name: string, port: string, bit: number, extra: Partial<McuPin> = {}) =>
  gpio(name, port, bit, `GPIO ${name} (${ARDUINO[name]} no Arduino).${EXTRA[name] ?? ""}`, extra);
const portC = (name: string, bit: number) =>
  mpin(name, "C", bit, { rail: "AVCC", explain: `GPIO ${name} (${ARDUINO[name]} no Arduino). A porta C é alimentada pelo AVCC.${EXTRA[name] ?? ""}` });

export const atmega328p: McuSpec = {
  kind: "atmega328p",
  name: "ATmega328P",
  label: "ATMEGA328P",
  sub: "AVR · DIP-28",
  labelExplain: "O microcontrolador do Arduino Uno: AVR de 8 bits, 32 KB de flash, 23 GPIOs em três portas (B, C e D).",
  summary:
    "O chip do Arduino Uno, sem a placa. Precisa de VCC e dos DOIS GND, e também do AVCC (que alimenta a porta C, os pinos A0–A5). De fábrica roda no oscilador interno; o Arduino grava os fusíveis para usar um cristal de 16 MHz em XTAL1/XTAL2.",
  pins: [
    { name: "RST", title: "PC6 / RESET", kind: "reset", pull: "up", explain: "RESET, ativo em 0, com pull-up interno. No Arduino, o botão de reset puxa este pino para o GND." },
    mpin("PD0", "D", 0),
    mpin("PD1", "D", 1),
    mpin("PD2", "D", 2),
    mpin("PD3", "D", 3),
    mpin("PD4", "D", 4),
    { name: "VCC", title: "VCC", kind: "vcc", explain: "Alimentação digital: 1,8 a 5,5 V." },
    { name: "GND", title: "GND", kind: "gnd", explain: "Terra (0 V). Ligue os dois GND do chip." },
    mpin("PB6", "B", 6, {
      kind: "other",
      gpioIf: { prop: "clock", value: "int" },
      explain: "XTAL1: entrada do cristal. Com o oscilador interno, vira o GPIO PB6.",
    }),
    mpin("PB7", "B", 7, {
      kind: "other",
      gpioIf: { prop: "clock", value: "int" },
      explain: "XTAL2: saída do cristal. Com o oscilador interno, vira o GPIO PB7.",
    }),
    mpin("PD5", "D", 5),
    mpin("PD6", "D", 6),
    mpin("PD7", "D", 7),
    mpin("PB0", "B", 0),
    mpin("PB1", "B", 1),
    mpin("PB2", "B", 2),
    mpin("PB3", "B", 3),
    mpin("PB4", "B", 4),
    mpin("PB5", "B", 5),
    { name: "AVCC", title: "AVCC", kind: "other", explain: "Alimentação da parte analógica e da porta C. Ligue no VCC, mesmo sem usar o conversor A/D." },
    { name: "AREF", title: "AREF", kind: "other", explain: "Referência do conversor A/D. Normalmente fica com um capacitor de 100 nF para o GND." },
    { name: "GND2", title: "GND", kind: "other", explain: "O segundo GND (lado analógico). Ligue junto com o outro." },
    ...M_C.map(portC),
  ],
  vcc: "VCC",
  gnd: "GND",
  vMin: 1.8,
  vMax: 5.5,
  absMax: 6,
  brownout: 1.8,
  current: 0.01,
  rout: 25,
  rpull: 35_000,
  iPin: 0.02,
  iPinBurn: 0.08,
  pullFromOut: true,
  regs: (["B", "C", "D"] as const).flatMap((port) => {
    const names = port === "B" ? M_B : port === "C" ? M_C : M_D;
    return [
      { name: `DDR${port}`, role: "dir" as const, port, bits: bitsOf(names), reset: 0, explain: `Direção da porta ${port}: 1 = saída, 0 = entrada.` },
      {
        name: `PORT${port}`,
        role: "out" as const,
        port,
        bits: bitsOf(names),
        reset: 0,
        explain: `Em saída: 1 = VCC, 0 = GND. Em entrada: 1 liga o pull-up interno.`,
      },
      { name: `PIN${port}`, role: "in" as const, port, bits: bitsOf(names), reset: 0, explain: `Leitura da porta ${port}.` },
    ];
  }),
  config: {
    clock: {
      label: "Fusíveis de clock",
      default: "int",
      options: [
        { value: "int", label: "Oscilador interno 8 MHz (de fábrica)" },
        { value: "xtal", label: "Cristal externo 16 MHz (como no Arduino)" },
      ],
      explain: "Com cristal externo, PB6/PB7 viram XTAL1/XTAL2. Sem um cristal ali, o chip fica sem clock e não faz nada.",
    },
  },
  check: (c) => {
    const notes: string[] = [];
    if (c.lonely("GND2")) notes.push("O segundo GND (pino 22) está solto. Ligue os dois GND.");
    if (c.v("AVCC") < c.v("VCC") - 0.5) notes.push("AVCC sem alimentação: a porta C (A0–A5) não funciona. Ligue o AVCC no VCC.");
    const xtal = c.wiredTo("PB6", "crystal", "1") ?? c.wiredTo("PB6", "crystal", "2");
    return {
      stop: !c.high("RST")
        ? "RESET (pino 1) em 0: o chip está em reset."
        : c.props.clock === "xtal" && !xtal
          ? "Fusíveis pedem cristal externo, mas não há cristal em XTAL1/XTAL2: o chip não tem clock e fica parado."
          : null,
      notes,
    };
  },
};

export const MCUS: McuSpec[] = [atmega328p, attiny85, rp2040, esp32, stm32f103, pic16f628a];

/** Código de 4 bits do STM32 para cada modo de pino (CNF[1:0] MODE[1:0]). */
export const STM_MODES: { code: number; label: string }[] = [
  { code: 0x4, label: "Entrada flutuante (0100)" },
  { code: 0x8, label: "Entrada com pull (1000)" },
  { code: 0x0, label: "Analógico (0000)" },
  { code: 0x2, label: "Saída push-pull (0010)" },
  { code: 0x6, label: "Saída open-drain (0110)" },
];

export type { McuReg };
