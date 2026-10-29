import { create } from "zustand";
import type { Point, Rect } from "../../lib/geometry";
import { registerBlocks } from "../blocks/blocks";
import { emptyDoc, type Doc } from "./doc";

const HISTORY_LIMIT = 200;

interface DocState {
  doc: Doc;
  past: Doc[];
  future: Doc[];
  dirty: boolean;
  filePath: string | null;
  selection: string[];

  /** Troca o documento e registra no histórico. */
  commit: (next: Doc, selection?: string[]) => void;
  /** Troca o documento sem registrar (ex.: a cada quadro de um arraste). */
  replace: (next: Doc) => void;
  /** Registra `prev` no histórico (início de um arraste). */
  checkpoint: (prev: Doc) => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[]) => void;
  load: (doc: Doc, filePath: string | null) => void;
  markSaved: (filePath: string) => void;
}

const existing = (doc: Doc, ids: string[]) => ids.filter((id) => doc.parts[id] || doc.wires[id]);

export const useDoc = create<DocState>((set, get) => ({
  doc: emptyDoc(),
  past: [],
  future: [],
  dirty: false,
  filePath: null,
  selection: [],

  commit: (next, selection) => {
    registerBlocks(next);
    const { doc, past } = get();
    if (next === doc) return;
    set({
      doc: next,
      past: [...past, doc].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
      selection: existing(next, selection ?? get().selection),
    });
  },
  replace: (next) => {
    registerBlocks(next);
    set({ doc: next, dirty: true });
  },
  checkpoint: (prev) => set((s) => ({ past: [...s.past, prev].slice(-HISTORY_LIMIT), future: [] })),
  undo: () => {
    const { doc, past, future, selection } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future], dirty: true, selection: existing(prev, selection) });
  },
  redo: () => {
    const { doc, past, future, selection } = get();
    const next = future[0];
    if (!next) return;
    set({ doc: next, past: [...past, doc], future: future.slice(1), dirty: true, selection: existing(next, selection) });
  },
  select: (selection) => set({ selection }),
  load: (doc, filePath) => {
    registerBlocks(doc);
    set({ doc, filePath, past: [], future: [], dirty: false, selection: [] });
  },
  markSaved: (filePath) => set({ filePath, dirty: false }),
}));

export type Tool = "select" | "wire";

interface Placing {
  kind: string;
  rot: number;
  flip: boolean;
}

interface EditorState {
  tool: Tool;
  /** Peça "na mão", seguindo o cursor até o clique. */
  placing: Placing | null;
  /** Fio sendo desenhado: pontos já fixados. */
  draft: Point[] | null;
  marquee: Rect | null;
  /** Nó destacado (hover num fio ou na lista do inspetor). */
  hoverNet: string | null;
  setTool: (t: Tool) => void;
  setPlacing: (p: Placing | null) => void;
  setDraft: (d: Point[] | null) => void;
  setMarquee: (r: Rect | null) => void;
  setHoverNet: (n: string | null) => void;
}

export const useEditor = create<EditorState>((set) => ({
  tool: "select",
  placing: null,
  draft: null,
  marquee: null,
  hoverNet: null,
  setTool: (tool) => set({ tool, draft: null, placing: null }),
  setPlacing: (placing) => set({ placing, draft: null }),
  setDraft: (draft) => set({ draft }),
  setMarquee: (marquee) => set({ marquee }),
  setHoverNet: (hoverNet) => set({ hoverNet }),
}));
