import { create } from "zustand";

export type ThemePref = "system" | "light" | "dark";

const STORAGE_KEY = "autoblue.theme";
const ORDER: ThemePref[] = ["system", "light", "dark"];

function load(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // armazenamento indisponível: segue o sistema
  }
  return "system";
}

function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}

interface ThemeState {
  pref: ThemePref;
  cycle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => {
  const initial = load();
  apply(initial);
  return {
    pref: initial,
    cycle: () => {
      const next = ORDER[(ORDER.indexOf(get().pref) + 1) % ORDER.length];
      apply(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignora
      }
      set({ pref: next });
    },
  };
});
