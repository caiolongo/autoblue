import { create } from "zustand";

export type Mode = "criar" | "energia" | "testar";

export const MODES: { id: Mode; label: string }[] = [
  { id: "criar", label: "Criar" },
  { id: "energia", label: "Energia" },
  { id: "testar", label: "Testar" },
];

export type View = "esquema" | "protoboard" | "placa";

export const VIEWS: { id: View; label: string }[] = [
  { id: "esquema", label: "Esquema" },
  { id: "protoboard", label: "Protoboard" },
  { id: "placa", label: "Placa" },
];

interface ModeState {
  mode: Mode;
  view: View;
  setMode: (m: Mode) => void;
  setView: (v: View) => void;
}

export const useMode = create<ModeState>((set) => ({
  mode: "criar",
  view: "esquema",
  setMode: (mode) => set({ mode }),
  setView: (view) => set({ view }),
}));
