import { isTauri } from "@tauri-apps/api/core";
import { useMode } from "../../app/mode";
import { useSim } from "../../sim/store";
import { useDoc } from "../editor/store";
import { useViewport } from "../editor/viewport";
import { confirmDiscard } from "../project/file";
import { buildSystem, docBounds } from "./build";
import type { SystemSpec } from "./spec";

/** Abre um sistema pronto no lugar do circuito atual: enquadrado, ligado e no modo Energia. */
export async function openSystem(spec: SystemSpec) {
  if (isTauri() && !(await confirmDiscard())) return;
  const doc = buildSystem(spec);
  useDoc.getState().load(doc, null);
  // Os ids se repetem entre aberturas: sem isso, cargas e registradores da vez anterior continuariam valendo.
  useSim.getState().reset();
  const { setView, setMode } = useMode.getState();
  setView("esquema");
  setMode("energia");
  const panel = document.querySelector(".canvas-panel")?.getBoundingClientRect();
  if (panel) useViewport.getState().fit(docBounds(doc), panel.width, panel.height);
}
