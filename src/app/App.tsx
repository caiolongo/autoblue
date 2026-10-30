import { Canvas } from "../features/editor/Canvas";
import { useDoc } from "../features/editor/store";
import { Toolbar } from "../features/editor/Toolbar";
import { InspectorPanel } from "../features/inspect/InspectorPanel";
import { InstrumentDock } from "../features/instruments/InstrumentDock";
import { BoardView } from "../features/views/BoardView";
import { LibraryPanel } from "../features/library/LibraryPanel";
import { Tooltip } from "../ui/Tooltip";
import { Legend } from "./Legend";
import { useMode } from "./mode";
import { useShortcuts } from "./shortcuts";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import "./app.css";

export function App() {
  useShortcuts();
  const mode = useMode((s) => s.mode);
  const view = useMode((s) => s.view);
  const empty = useDoc((s) => Object.keys(s.doc.parts).length === 0 && Object.keys(s.doc.wires).length === 0);

  return (
    <div className={mode === "testar" && view === "esquema" ? "shell with-dock" : "shell"}>
      <TopBar />
      <LibraryPanel />
      <main className="panel canvas-panel" style={{ gridArea: "canvas" }}>
        {view !== "esquema" ? <BoardView view={view} /> : <>
        <Canvas />
        <Toolbar />
        <Legend />
        {empty && (
          <div className="canvas-empty">
            Arraste uma peça da biblioteca para cá, ou clique nela e depois no canvas.
            <br />
            Ligue fios clicando num pino. Pode ligar qualquer coisa em qualquer lugar.
            <br />
            Para estudar um circuito pronto, abra a aba Sistemas da biblioteca.
          </div>
        )}
        </>}
      </main>
      {mode === "testar" && view === "esquema" && <InstrumentDock />}
      <InspectorPanel />
      <StatusBar />
      <Tooltip />
    </div>
  );
}
