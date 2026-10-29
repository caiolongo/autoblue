import { createContext } from "react";
import { create } from "zustand";

interface Tip {
  x: number;
  y: number;
  title: string;
  body?: string;
}

interface TipState {
  tip: Tip | null;
  show: (e: { clientX: number; clientY: number }, title: string, body?: string) => void;
  hide: () => void;
}

export const useTooltip = create<TipState>((set) => ({
  tip: null,
  show: (e, title, body) => set({ tip: { x: e.clientX, y: e.clientY, title, body } }),
  hide: () => set({ tip: null }),
}));

/** Desliga as explicações ao passar o mouse (ex.: miniaturas da biblioteca). */
export const HintsEnabled = createContext(true);
