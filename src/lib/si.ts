/** Prefixos do SI aceitos na entrada. "R" funciona como vírgula: 4R7 = 4,7. */
const MULT: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  µ: 1e-6,
  μ: 1e-6,
  m: 1e-3,
  R: 1,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
};

/**
 * Lê valores como "220", "4.7k", "4,7k", "4k7", "100n", "100µF", "10 kΩ".
 * Retorna null quando o texto não é um número válido.
 */
export function parseSI(input: string): number | null {
  const s = input.trim().replace(/\s+/g, "").replace(",", ".");
  const m = s.match(/^(\d+(?:\.\d+)?|\.\d+)([pnuµμmRkKMG])?(\d+)?[a-zA-ZΩ%]*$/);
  if (!m) return null;
  const [, num, prefix, tail] = m;
  if (tail && (!prefix || num.includes("."))) return null;
  const value = parseFloat(tail ? `${num}.${tail}` : num);
  return value * (prefix ? MULT[prefix] : 1);
}

const PREFIXES: [number, string][] = [
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "µ"],
  [1e-9, "n"],
  [1e-12, "p"],
];

/** Formata com prefixo e até 3 algarismos significativos, vírgula decimal: 4700 → "4,7 kΩ". */
export function formatSI(value: number, unit = ""): string {
  if (Math.abs(value) < 1e-12 * 0.9995) return `0 ${unit}`.trim();
  const abs = Math.abs(value);
  const [mult, prefix] = PREFIXES.find(([m]) => abs >= m * 0.9995) ?? PREFIXES[PREFIXES.length - 1];
  const scaled = value / mult;
  const text = Number(scaled.toPrecision(3)).toString().replace(".", ",");
  return `${text} ${prefix}${unit}`.trim();
}
