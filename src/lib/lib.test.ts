import { describe, expect, it } from "vitest";
import { ceramicCode, inductorCode, resistorBands } from "./colorcode";
import { formatSI, parseSI } from "./si";

describe("parseSI", () => {
  it.each([
    ["220", 220],
    ["4.7k", 4700],
    ["4,7k", 4700],
    ["4k7", 4700],
    ["4R7", 4.7],
    ["100n", 100e-9],
    ["100µF", 100e-6],
    ["100uF", 100e-6],
    ["10 kΩ", 10_000],
    ["1M", 1e6],
    ["50%", 50],
  ])("%s → %d", (input, expected) => {
    expect(parseSI(input)).toBeCloseTo(expected, 15);
  });

  it.each(["", "abc", "4.7k7", "k", "1..2"])("rejeita %s", (input) => {
    expect(parseSI(input)).toBeNull();
  });
});

describe("formatSI", () => {
  it.each([
    [4700, "Ω", "4,7 kΩ"],
    [220, "Ω", "220 Ω"],
    [100e-6, "F", "100 µF"],
    [100e-9, "F", "100 nF"],
    [12, "V", "12 V"],
    [0.02, "A", "20 mA"],
    [1e6, "Ω", "1 MΩ"],
  ])("%d %s → %s", (v, unit, expected) => {
    expect(formatSI(v, unit)).toBe(expected);
  });
});

describe("resistorBands", () => {
  const names = (ohms: number) => resistorBands(ohms).bands.map((b) => b.name);

  it("220 Ω = vermelho vermelho marrom dourado", () => {
    expect(names(220)).toEqual(["Vermelho", "Vermelho", "Marrom", "Dourado"]);
  });
  it("10 kΩ = marrom preto laranja", () => {
    expect(names(10_000).slice(0, 3)).toEqual(["Marrom", "Preto", "Laranja"]);
  });
  it("4,7 Ω usa multiplicador dourado", () => {
    expect(names(4.7).slice(0, 3)).toEqual(["Amarelo", "Violeta", "Dourado"]);
  });
  it("arredonda para 2 algarismos", () => {
    expect(resistorBands(4730).value).toBe(4700);
    expect(resistorBands(996).value).toBe(1000);
  });
});

describe("códigos de 3 dígitos", () => {
  it("cerâmico", () => {
    expect(ceramicCode(100e-9)).toBe("104");
    expect(ceramicCode(22e-12)).toBe("22");
    expect(ceramicCode(4.7e-9)).toBe("472");
    expect(ceramicCode(2.2e-12)).toBe("2R2");
  });
  it("indutor", () => {
    expect(inductorCode(100e-6)).toBe("101");
    expect(inductorCode(4.7e-6)).toBe("4R7");
    expect(inductorCode(10e-3)).toBe("103");
  });
});
