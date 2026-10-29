import type { BlockDef } from "../../editor/doc";
import { C, Print } from "./draw";
import { str, type PartDef, type PinDef } from "./types";

const G = 20;

/** "Pino do bloco": marca um ponto do circuito que vira pino quando ele vira um bloco. */
export const port: PartDef = {
  kind: "port",
  name: "Pino do bloco",
  group: "Blocos",
  prefix: "P",
  summary:
    "Marca um ponto do circuito que vai virar pino quando você transformar a seleção num bloco (⌘G). O nome aparece no bloco. Sozinha, ela não faz nada eletricamente: só dá nome ao nó.",
  props: { name: { type: "text", label: "Nome do pino", default: "IN" } },
  pins: (p) => [
    { name: "P", x: 0, y: 0, role: "passive", title: str(p, "name"), explain: "Ligue aqui o ponto do circuito que este pino representa.", net: str(p, "name") },
  ],
  bounds: { x: -4, y: -9, w: 52, h: 18 },
  markings: (p) => ({ name: { text: str(p, "name"), explain: "Nome do pino no bloco." } }),
  Body: ({ mk }) => (
    <>
      <path d="M4 -8 H40 L48 0 L40 8 H4 Z" fill="var(--panel)" stroke="var(--brand)" strokeWidth={1.4} />
      <Print m={mk.name} x={24} y={0} size={6.5} fill="var(--brand)" weight={600} />
    </>
  ),
};

/** Peça gerada a partir de um bloco: metade dos pinos à esquerda, metade à direita. */
export function blockPart(def: BlockDef): PartDef & { block: BlockDef } {
  const n = def.pins.length;
  const left = Math.ceil(n / 2);
  const right = n - left;
  const col = (count: number, i: number) => i * G - Math.floor((count - 1) / 2) * G;
  const pins: PinDef[] = def.pins.map((p, i) => ({
    name: p.name,
    x: i < left ? -2 * G : 2 * G,
    y: i < left ? col(left, i) : col(right, i - left),
    role: "passive",
    title: p.name,
    explain: `Pino “${p.name}” do bloco ${def.name}.`,
  }));
  const ys = pins.map((p) => p.y);
  const top = Math.min(...ys) - 16;
  const bottom = Math.max(...ys) + 16;
  const inside = Object.values(def.parts).filter((p) => p.kind !== "port");
  const board = def.board;
  return {
    kind: `block:${def.id}`,
    name: def.name,
    group: board ? "Placas prontas" : "Meus blocos",
    prefix: board ? "A" : "B",
    summary: board
      ? `${board.summary} Por dentro: ${inside.map((p) => p.ref).join(", ")}. Veja e use tudo no inspetor.`
      : `Bloco feito por você, com ${inside.length} peça(s) dentro: ${inside.map((p) => p.ref).join(", ") || "nenhuma"}. Na simulação, tudo lá dentro funciona (e queima) de verdade.`,
    props: {},
    pins: () => pins,
    bounds: { x: -2 * G, y: top, w: 4 * G, h: bottom - top },
    markings: () => ({ name: { text: def.name, explain: "Nome do bloco. Mude no inspetor." } }),
    block: def,
    Body: ({ mk }) => (
      <>
        {pins.map((p) => (
          <line key={p.name} x1={p.x} y1={p.y} x2={Math.sign(p.x) * 26} y2={p.y} stroke={C.lead} strokeWidth={2} />
        ))}
        {board ? (
          <>
            <rect x={-30} y={top} width={60} height={bottom - top} rx={5} fill={board.color} />
            {pins.map((p) => (
              <circle key={p.name} cx={Math.sign(p.x) * 26} cy={p.y} r={2.6} fill={C.gold} />
            ))}
            <text x={0} y={(top + bottom) / 2} fontSize={7} fill="#fff" textAnchor="middle" fontFamily="var(--font-mono)" fontWeight={700} transform={`rotate(-90 0 ${(top + bottom) / 2})`}>
              {def.name}
            </text>
          </>
        ) : (
          <>
            <rect x={-26} y={top} width={52} height={bottom - top} rx={6} fill="var(--panel)" stroke="var(--brand)" strokeWidth={1.6} strokeDasharray="5 3" />
            <Print m={mk.name} x={0} y={top + 9} size={6.5} fill="var(--brand)" weight={600} />
          </>
        )}
        {pins.map((p) => (
          <text
            key={p.name}
            x={Math.sign(p.x) * (board ? 20 : 22)}
            y={p.y}
            fontSize={5.5}
            fill={board ? "#fff" : "var(--text-2)"}
            textAnchor={p.x < 0 ? "start" : "end"}
            dominantBaseline="central"
            fontFamily="var(--font-mono)"
          >
            {p.name}
          </text>
        ))}
      </>
    ),
  };
}
