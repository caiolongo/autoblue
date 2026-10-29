import { produce } from "immer";
import { type Point } from "../../lib/geometry";
import { PARTS, type PartDef } from "../library/parts";
import { blockPart } from "../library/parts/block";
import { addPart, newId, nextRef, pinsOf, type BlockDef, type Doc, type Part } from "../editor/doc";
import { buildBoards } from "./boards";
import { snap } from "../editor/viewport";

export const BLOCK = "block:";
export const isBlock = (p: Part) => p.kind.startsWith(BLOCK);
/** Placas prontas: blocos embutidos no app (não ficam no projeto). */
let builtins: Record<string, BlockDef> | null = null;
export function builtinBlocks(): Record<string, BlockDef> {
  if (!builtins) builtins = Object.fromEntries(buildBoards().map((b) => [b.id, b]));
  return builtins;
}
export const blockOf = (doc: Doc, p: Part) => {
  const id = p.kind.slice(BLOCK.length);
  return doc.blocks?.[id] ?? builtinBlocks()[id];
};

/** Registra uma definição de peça para cada bloco do documento. */
export function registerBlocks(doc: Doc) {
  for (const def of [...Object.values(builtinBlocks()), ...Object.values(doc.blocks ?? {})]) {
    const kind = BLOCK + def.id;
    const known = PARTS[kind] as (PartDef & { block?: BlockDef }) | undefined;
    if (known?.block !== def) PARTS[kind] = blockPart(def);
  }
}

/**
 * Transforma a seleção num bloco. Os "Pinos do bloco" selecionados viram os pinos dele;
 * a seleção some e no lugar entra uma peça do bloco novo.
 */
export function createBlock(doc: Doc, selection: string[]): { doc: Doc; id?: string; error?: string } {
  const parts = selection.map((id) => doc.parts[id]).filter(Boolean);
  const wires = selection.map((id) => doc.wires[id]).filter(Boolean);
  const ports = parts.filter((p) => p.kind === "port");
  if (!ports.length)
    return { doc, error: "Coloque peças “Pino do bloco” nos pontos que devem virar pinos, e selecione-as junto com o circuito." };
  const cx = snap(parts.reduce((t, p) => t + p.x, 0) / parts.length);
  const cy = snap(parts.reduce((t, p) => t + p.y, 0) / parts.length);
  const shift = (p: Point) => ({ x: p.x - cx, y: p.y - cy });

  const used = new Set<string>();
  const pins = ports
    .sort((a, b) => String(a.props.name).localeCompare(String(b.props.name), "pt-BR", { numeric: true }))
    .map((p) => {
      let name = String(p.props.name || "P");
      for (let i = 2; used.has(name); i++) name = `${p.props.name}${i}`;
      used.add(name);
      return { name, port: p.id };
    });

  const id = newId("p").replace("p_", "b_");
  const def: BlockDef = {
    id,
    name: `Bloco ${Object.keys(doc.blocks ?? {}).length + 1}`,
    parts: Object.fromEntries(parts.map((p) => [p.id, { ...p, ...shift(p), damage: undefined }])),
    wires: Object.fromEntries(wires.map((w) => [w.id, { ...w, points: w.points.map(shift) }])),
    pins,
  };
  let next = produce(doc, (d) => {
    d.blocks = { ...(d.blocks ?? {}), [id]: def };
    for (const sel of selection) {
      delete d.parts[sel];
      delete d.wires[sel];
    }
  });
  registerBlocks(next);
  let inst: string;
  [next, inst] = addPart(next, BLOCK + id, { x: cx, y: cy });
  return { doc: next, id: inst };
}

/** Desfaz um bloco: as peças de dentro voltam para o circuito, no lugar dele. */
export function explodeBlock(doc: Doc, instId: string): Doc {
  const inst = doc.parts[instId];
  const def = inst && blockOf(doc, inst);
  if (!def) return doc;
  return produce(doc, (d) => {
    delete d.parts[instId];
    const map = new Map<string, string>();
    for (const p of Object.values(def.parts)) {
      const nid = newId("p");
      map.set(p.id, nid);
      const prefix = PARTS[p.kind]?.prefix ?? "X";
      d.parts[nid] = { ...p, id: nid, x: p.x + inst.x, y: p.y + inst.y, ref: nextRef(d as Doc, prefix), damage: inst.inner?.[p.id] };
    }
    for (const w of Object.values(def.wires)) {
      const nid = newId("w");
      d.wires[nid] = { id: nid, points: w.points.map((pt) => ({ x: pt.x + inst.x, y: pt.y + inst.y })) };
    }
  });
}

/** Distância entre cópias achatadas: longe o bastante para nada encostar. */
const FAR = 1_000_000;
const MAX_DEPTH = 8;

const flatCache = new WeakMap<Doc, Doc>();

/**
 * Documento "achatado" para a simulação: cada bloco é trocado pelo que tem dentro.
 * As peças de dentro ganham ids `bloco/peça` e ficam numa região distante; `links`
 * ligam cada pino do bloco à porta correspondente lá dentro.
 */
export function flattenDoc(doc: Doc): Doc {
  if (!Object.values(doc.parts).some(isBlock)) return doc;
  const hit = flatCache.get(doc);
  if (hit) return hit;
  registerBlocks(doc);
  const out: Doc = { parts: {}, wires: { ...doc.wires }, blocks: doc.blocks, links: [] };
  let slot = 0;

  const expand = (inst: Part, depth: number) => {
    const def = blockOf(doc, inst);
    if (!def || depth > MAX_DEPTH) return;
    const dx = FAR * ++slot;
    const prefix = `${inst.id}/`;
    for (const p of Object.values(def.parts)) {
      const inner: Record<string, Part["damage"]> = {};
      for (const [k, v] of Object.entries(inst.inner ?? {})) if (k.startsWith(`${p.id}/`)) inner[k.slice(p.id.length + 1)] = v;
      // Programa gravado nesta cópia da placa (cada cópia tem o seu).
      const program = inst.props[`program:${p.id}`];
      const np: Part = {
        ...p,
        props: program !== undefined ? { ...p.props, program } : p.props,
        id: prefix + p.id,
        ref: `${inst.ref}.${p.ref}`,
        x: p.x + dx,
        damage: inst.inner?.[p.id] ?? p.damage,
        inner: Object.keys(inner).length ? (inner as Part["inner"]) : undefined,
      };
      out.parts[np.id] = np;
      if (isBlock(np)) expand(np, depth + 1);
    }
    for (const w of Object.values(def.wires)) {
      out.wires[prefix + w.id] = { id: prefix + w.id, points: w.points.map((pt) => ({ x: pt.x + dx, y: pt.y })) };
    }
    const instPins = new Map(pinsOf(inst).map((x) => [x.pin.name, x.pos]));
    for (const pin of def.pins) {
      const port = out.parts[prefix + pin.port];
      const at = instPins.get(pin.name);
      if (port && at) out.links!.push([at, pinsOf(port)[0].pos]);
    }
  };

  for (const p of Object.values(doc.parts)) {
    out.parts[p.id] = p;
    if (isBlock(p)) expand(p, 0);
  }
  flatCache.set(doc, out);
  return out;
}

