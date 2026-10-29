import { describe, expect, it } from "vitest";
import { freshState, pinDrives, readReg, runSteps, writeBit, writeMode } from "./engine";
import { attiny85, pic16f628a, rp2040, stm32f103 } from "./specs";

const up = (spec: Parameters<typeof freshState>[0]) => ({ ...freshState(spec), up: true, running: true });
const never = () => false;

describe("motor de microcontrolador", () => {
  it("AVR: PORT em 1 num pino de entrada liga o pull-up; com DDR em 1 vira saída", () => {
    const st = up(attiny85);
    writeBit(attiny85, st, "PORTB", 0, 1, never);
    expect(pinDrives(attiny85, st, {}).PB0).toEqual({ pull: "up" });
    writeBit(attiny85, st, "DDRB", 0, 1, never);
    expect(pinDrives(attiny85, st, {}).PB0).toEqual({ drive: 1 });
  });

  it("AVR: PINB é só leitura e mostra os pinos", () => {
    const st = up(attiny85);
    expect(writeBit(attiny85, st, "PINB", 2, 1, never)).toMatch(/só leitura/);
    expect(readReg(attiny85, st, "PINB", (p) => p === "PB2")).toBe(0b100);
  });

  it("PIC: TRIS em 0 é saída (ao contrário do AVR)", () => {
    const st = up(pic16f628a);
    writeBit(pic16f628a, st, "TRISB", 3, 0, never);
    writeBit(pic16f628a, st, "PORTB", 3, 1, (p) => p === "RB3");
    expect(pinDrives(pic16f628a, st, {}).RB3).toEqual({ drive: 1 });
  });

  it("PIC: BSF lê a porta inteira e apaga um pino que estava em 1 mas lia 0", () => {
    const st = up(pic16f628a);
    st.regs.TRISB = 0;
    st.regs.PORTB = 0b01;
    // RB0 está em 1 no registrador, mas um LED sem resistor segura o pino em ~0 V.
    const note = writeBit(pic16f628a, st, "PORTB", 1, 1, never);
    expect(st.regs.PORTB).toBe(0b10);
    expect(note).toMatch(/RB0/);
  });

  it("PIC: com os comparadores ligados (padrão), RA0–RA3 leem 0", () => {
    const st = up(pic16f628a);
    const allHigh = () => true;
    expect(readReg(pic16f628a, st, "PORTA", allHigh) & 0b1111).toBe(0);
    st.regs.CMCON = 7;
    expect(readReg(pic16f628a, st, "PORTA", allHigh) & 0b1111).toBe(0b1111);
  });

  it("PIC: RA4 é open-drain (em 1 só solta)", () => {
    const st = up(pic16f628a);
    st.regs.CMCON = 7;
    st.regs.TRISA = 0;
    st.regs.PORTA = 0b10000;
    expect(pinDrives(pic16f628a, st, {}).RA4).toEqual({});
  });

  it("STM32: sem o clock da porta, escrever no GPIO não faz nada", () => {
    const st = up(stm32f103);
    expect(writeBit(stm32f103, st, "GPIOA_ODR", 0, 1, never)).toMatch(/clock da porta A/);
    expect(st.regs.GPIOA_ODR).toBe(0);
    writeBit(stm32f103, st, "RCC_APB2ENR", 2, 1, never);
    writeMode(stm32f103, st, "GPIOA_CRL", 0, 0x2);
    writeBit(stm32f103, st, "GPIOA_ODR", 0, 1, never);
    expect(pinDrives(stm32f103, st, {}).PA0).toEqual({ drive: 1 });
    // Depois do reset todo pino é entrada flutuante.
    expect(pinDrives(stm32f103, st, {}).PA1).toEqual({});
  });

  it("RP2040: SET/CLR/XOR mexem só no bit escrito; pull-down vem ligado", () => {
    const st = up(rp2040);
    expect(pinDrives(rp2040, st, {}).GP3).toEqual({ pull: "down" });
    writeBit(rp2040, st, "GPIO_OUT_SET", 3, 1, never);
    writeBit(rp2040, st, "GPIO_OUT_SET", 5, 1, never);
    writeBit(rp2040, st, "GPIO_OUT_CLR", 3, 1, never);
    writeBit(rp2040, st, "GPIO_OUT_XOR", 0, 1, never);
    expect(st.regs.GPIO_OUT).toBe(0b100001);
  });

  it("sequência: esperar consome tempo, os outros passos são instantâneos", () => {
    const st = up(attiny85);
    const steps = [
      { op: "set" as const, reg: "DDRB", bit: 0 },
      { op: "toggle" as const, reg: "PORTB", bit: 0 },
      { op: "wait" as const, value: 100 },
    ];
    runSteps(attiny85, st, steps, 0.05, never);
    expect(st.regs.PORTB & 1).toBe(1);
    runSteps(attiny85, st, steps, 0.06, (p) => p === "PB0");
    expect(st.regs.PORTB & 1).toBe(0);
  });
});
