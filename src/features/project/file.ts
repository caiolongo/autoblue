import { invoke, isTauri } from "@tauri-apps/api/core";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import type { Point } from "../../lib/geometry";
import { emptyDoc, type Doc } from "../editor/doc";
import { useDoc } from "../editor/store";
import { registerBlocks } from "../blocks/blocks";
import { defaultProps, PARTS } from "../library/parts";

const FORMAT = "autoblue";
const VERSION = 1;
const FILTERS = [{ name: "Projeto AutoBlue", extensions: ["abp"] }];

export function serialize(doc: Doc): string {
  return JSON.stringify(
    { format: FORMAT, version: VERSION, system: doc.system, parts: Object.values(doc.parts), wires: Object.values(doc.wires), blocks: Object.values(doc.blocks ?? {}) },
    null,
    2,
  );
}

const isPoint = (p: unknown): p is Point =>
  typeof p === "object" && p !== null && Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y);

/** Lê um .abp. Peças de tipo desconhecido são ignoradas; propriedades que faltam recebem o padrão. */
export function deserialize(text: string): Doc {
  const raw = JSON.parse(text);
  if (raw?.format !== FORMAT) throw new Error("Este arquivo não é um projeto AutoBlue.");
  const doc = emptyDoc();
  if (typeof raw.system === "string") doc.system = raw.system;
  // Blocos primeiro: as peças podem ser instâncias deles.
  for (const b of raw.blocks ?? []) {
    if (typeof b?.id !== "string" || !Array.isArray(b.pins)) continue;
    const inner = deserialize(JSON.stringify({ format: FORMAT, parts: b.parts ? Object.values(b.parts) : [], wires: b.wires ? Object.values(b.wires) : [], blocks: raw.blocks.filter((x: { id: string }) => x.id !== b.id) }));
    doc.blocks = { ...doc.blocks, [b.id]: { id: b.id, name: String(b.name ?? "Bloco"), parts: inner.parts, wires: inner.wires, pins: b.pins } };
  }
  registerBlocks(doc);
  for (const p of raw.parts ?? []) {
    const def = PARTS[p?.kind];
    if (!def || typeof p.id !== "string" || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    doc.parts[p.id] = {
      id: p.id,
      kind: p.kind,
      ref: typeof p.ref === "string" ? p.ref : def.prefix,
      x: p.x,
      y: p.y,
      rot: Number.isInteger(p.rot) ? ((p.rot % 4) + 4) % 4 : 0,
      flip: p.flip === true,
      props: { ...defaultProps(def), ...(typeof p.props === "object" ? p.props : {}) },
    };
    if (p.inner && typeof p.inner === "object") doc.parts[p.id].inner = p.inner;
    if ((p.damage?.mode === "open" || p.damage?.mode === "short") && typeof p.damage.reason === "string") {
      doc.parts[p.id].damage = { mode: p.damage.mode, reason: p.damage.reason };
    }
  }
  for (const w of raw.wires ?? []) {
    if (typeof w?.id !== "string" || !Array.isArray(w.points)) continue;
    const points = w.points.filter(isPoint).map((p: Point) => ({ x: p.x, y: p.y }));
    if (points.length >= 2) doc.wires[w.id] = { id: w.id, points };
  }
  return doc;
}

async function requireApp(): Promise<boolean> {
  if (isTauri()) return true;
  window.alert("Salvar e abrir só funcionam dentro do app (pnpm tauri dev).");
  return false;
}

export async function confirmDiscard(): Promise<boolean> {
  if (!useDoc.getState().dirty) return true;
  return ask("Há alterações não salvas. Descartar?", {
    title: "AutoBlue",
    kind: "warning",
    okLabel: "Descartar",
    cancelLabel: "Cancelar",
  });
}

const showError = (err: unknown) => message(String(err), { title: "AutoBlue", kind: "error" });

export async function newProject() {
  if (isTauri() && !(await confirmDiscard())) return;
  useDoc.getState().load(emptyDoc(), null);
}

export async function openProject() {
  if (!(await requireApp()) || !(await confirmDiscard())) return;
  const path = await open({ filters: FILTERS, multiple: false, directory: false });
  if (!path) return;
  try {
    const text = await invoke<string>("read_project", { path });
    useDoc.getState().load(deserialize(text), path);
  } catch (err) {
    await showError(err);
  }
}

export async function saveProject(saveAs = false) {
  if (!(await requireApp())) return;
  const { doc, filePath, markSaved } = useDoc.getState();
  let path = filePath;
  if (saveAs || !path) {
    path = await save({ filters: FILTERS, defaultPath: "sem título.abp" });
    if (!path) return;
    if (!path.endsWith(".abp")) path += ".abp";
  }
  try {
    await invoke("write_project", { path, contents: serialize(doc) });
    markSaved(path);
  } catch (err) {
    await showError(err);
  }
}

export function fileName(path: string | null): string {
  return path ? path.split(/[\\/]/).pop()! : "sem título.abp";
}
