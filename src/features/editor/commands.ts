import { GRID } from "./viewport";
import { createBlock } from "../blocks/blocks";
import { addWire, deleteIds, duplicate, transformParts } from "./doc";
import { useDoc, useEditor } from "./store";
import { simplify } from "./wires";

export function rotate() {
  const ed = useEditor.getState();
  if (ed.placing) return ed.setPlacing({ ...ed.placing, rot: (ed.placing.rot + 1) % 4 });
  const { doc, selection, commit } = useDoc.getState();
  commit(transformParts(doc, selection, (p) => ({ rot: (p.rot + 1) % 4 })));
}

export function flip() {
  const ed = useEditor.getState();
  if (ed.placing) return ed.setPlacing({ ...ed.placing, flip: !ed.placing.flip });
  const { doc, selection, commit } = useDoc.getState();
  commit(transformParts(doc, selection, (p) => ({ flip: !p.flip })));
}

export function remove() {
  const { doc, selection, commit } = useDoc.getState();
  if (selection.length) commit(deleteIds(doc, selection), []);
}

export function duplicateSelection() {
  const { doc, selection, commit } = useDoc.getState();
  if (!selection.length) return;
  const [next, ids] = duplicate(doc, selection, { x: 2 * GRID, y: 2 * GRID });
  commit(next, ids);
}

/** ⌘G: a seleção vira um bloco. Retorna uma mensagem quando não dá. */
export function makeBlock(): string | null {
  const { doc, selection, commit } = useDoc.getState();
  const out = createBlock(doc, selection);
  if (out.error) return out.error;
  commit(out.doc, out.id ? [out.id] : []);
  return null;
}

export function selectAll() {
  const { doc, select } = useDoc.getState();
  select([...Object.keys(doc.parts), ...Object.keys(doc.wires)]);
}

/** Termina o fio em desenho. Fios com menos de dois pontos distintos são descartados. */
export function finishDraft() {
  const ed = useEditor.getState();
  if (!ed.draft) return;
  const pts = simplify(ed.draft);
  ed.setDraft(null);
  if (pts.length < 2) return;
  const { doc, commit } = useDoc.getState();
  const [next, id] = addWire(doc, pts);
  if (id) commit(next, [id]);
}

/** Esc: solta a peça na mão, termina o fio ou limpa a seleção, nessa ordem. */
export function escape() {
  const ed = useEditor.getState();
  if (ed.placing) return ed.setPlacing(null);
  if (ed.draft) return finishDraft();
  if (ed.tool !== "select") return ed.setTool("select");
  useDoc.getState().select([]);
}
