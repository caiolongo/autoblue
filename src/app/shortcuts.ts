import { useEffect } from "react";
import { duplicateSelection, escape, flip, makeBlock, remove, rotate, selectAll } from "../features/editor/commands";
import { useDoc, useEditor } from "../features/editor/store";
import { newProject, openProject, saveProject } from "../features/project/file";
import { useSim } from "../sim/store";

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      // Arquivo: funciona até com foco num campo de texto.
      if (mod && k === "s") return e.preventDefault(), void saveProject(e.shiftKey);
      if (mod && k === "o") return e.preventDefault(), void openProject();
      if (mod && k === "n") return e.preventDefault(), void newProject();

      const t = e.target as HTMLElement;
      if (t.closest("input, select, textarea")) return;

      const doc = useDoc.getState();
      if (mod) {
        if (k === "z") e.shiftKey ? doc.redo() : doc.undo();
        else if (k === "y") doc.redo();
        else if (k === "a") selectAll();
        else if (k === "d") duplicateSelection();
        else if (k === "g") {
          const err = makeBlock();
          if (err) window.alert(err);
        }
        else return;
        e.preventDefault();
        return;
      }

      switch (k) {
        case "r":
          rotate();
          break;
        case "f":
          flip();
          break;
        case "e": {
          const sim = useSim.getState();
          sim.setPowered(!sim.powered);
          break;
        }
        case "p": {
          const sim = useSim.getState();
          sim.setPaused(!sim.paused);
          break;
        }
        case ".":
          useSim.getState().step();
          break;
        case "w":
          useEditor.getState().setTool("wire");
          break;
        case "v":
          useEditor.getState().setTool("select");
          break;
        case "escape":
          escape();
          break;
        case "delete":
        case "backspace":
          remove();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
