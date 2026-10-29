export interface Band {
  name: string;
  hex: string;
  meaning: string;
}

const DIGITS: { name: string; hex: string }[] = [
  { name: "Preto", hex: "#1b1b1d" },
  { name: "Marrom", hex: "#7a4a2a" },
  { name: "Vermelho", hex: "#d42a20" },
  { name: "Laranja", hex: "#f07f13" },
  { name: "Amarelo", hex: "#f4c80f" },
  { name: "Verde", hex: "#2f9e44" },
  { name: "Azul", hex: "#1f5fd6" },
  { name: "Violeta", hex: "#7d3ac1" },
  { name: "Cinza", hex: "#8a8a8a" },
  { name: "Branco", hex: "#f4f4f4" },
];

const GOLD = { name: "Dourado", hex: "#c9a43a" };
const SILVER = { name: "Prata", hex: "#b8b8bf" };

const MULT_TEXT = (exp: number) => (exp >= 0 ? `×${(10 ** exp).toLocaleString("pt-BR")}` : `×${(10 ** exp).toString().replace(".", ",")}`);

/**
 * Código de 4 faixas (2 dígitos, multiplicador, tolerância de 5%).
 * Valores são arredondados para 2 algarismos significativos, como nos resistores comuns.
 */
export function resistorBands(ohms: number): { bands: Band[]; value: number } {
  const v = Math.max(ohms, 0.1);
  let exp = Math.floor(Math.log10(v)) - 1;
  let digits = Math.round(v / 10 ** exp);
  if (digits >= 100) {
    digits = 10;
    exp += 1;
  }
  exp = Math.min(Math.max(exp, -2), 9);
  const d1 = Math.floor(digits / 10);
  const d2 = digits % 10;
  const mult = exp === -1 ? GOLD : exp === -2 ? SILVER : DIGITS[exp];

  return {
    value: digits * 10 ** exp,
    bands: [
      { ...DIGITS[d1], meaning: `1º dígito = ${d1}` },
      { ...DIGITS[d2], meaning: `2º dígito = ${d2}` },
      { ...mult, meaning: `Multiplicador ${MULT_TEXT(exp)}` },
      { ...GOLD, meaning: "Tolerância ±5%" },
    ],
  };
}

/** Código de 3 dígitos em pF dos capacitores cerâmicos: 100 nF → "104". */
export function ceramicCode(farads: number): string {
  const pf = Math.max(Math.round(farads * 1e12), 1);
  if (pf < 100) return String(pf);
  const exp = Math.floor(Math.log10(pf)) - 1;
  const digits = Math.round(pf / 10 ** exp);
  return digits >= 100 ? `10${exp + 1}` : `${digits}${exp}`;
}

/** Mesmo código de 3 dígitos, em µH, usado em indutores: 100 µH → "101". */
export function inductorCode(henries: number): string {
  const uh = henries * 1e6;
  if (uh < 10) return uh.toFixed(1).replace(".", "R");
  const exp = Math.floor(Math.log10(uh)) - 1;
  const digits = Math.round(uh / 10 ** exp);
  return digits >= 100 ? `10${exp + 1}` : `${digits}${exp}`;
}
