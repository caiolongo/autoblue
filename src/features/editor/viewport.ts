import { create } from "zustand";
import type { Point } from "../../lib/geometry";

/** Unidade do mundo: 1 célula da grade = 20 unidades = 0,1" (passo da protoboard). */
export const GRID = 20;

export const MIN_ZOOM = 0.25;
export const DEFAULT_ZOOM = 1.5;
export const MAX_ZOOM = 8;

interface ViewportState {
  /** Posição do canto superior esquerdo da tela no mundo. */
  x: number;
  y: number;
  zoom: number;
  /** Cursor em coordenadas do mundo, já alinhado à grade. */
  cursor: Point | null;
  panBy: (dx: number, dy: number) => void;
  /** Zoom mantendo fixo o ponto da tela (sx, sy). */
  zoomAt: (factor: number, sx: number, sy: number) => void;
  setCursor: (p: Point | null) => void;
  reset: () => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const useViewport = create<ViewportState>((set) => ({
  x: -200,
  y: -160,
  zoom: DEFAULT_ZOOM,
  cursor: null,
  panBy: (dx, dy) => set((s) => ({ x: s.x - dx / s.zoom, y: s.y - dy / s.zoom })),
  zoomAt: (factor, sx, sy) =>
    set((s) => {
      const zoom = clamp(s.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const wx = s.x + sx / s.zoom;
      const wy = s.y + sy / s.zoom;
      return { zoom, x: wx - sx / zoom, y: wy - sy / zoom };
    }),
  setCursor: (cursor) => set({ cursor }),
  reset: () => set({ x: -200, y: -160, zoom: DEFAULT_ZOOM }),
}));

export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}
