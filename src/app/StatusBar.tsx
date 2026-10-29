import { getNetlist } from "../features/editor/netlist";
import { formatSI } from "../lib/si";
import { SPEEDS, useSim } from "../sim/store";
import { useDoc, useEditor } from "../features/editor/store";
import { GRID, useViewport } from "../features/editor/viewport";

function useHint(): string {
  const { tool, placing, draft } = useEditor();
  const doc = useDoc((s) => s.doc);
  if (placing) return "Clique para posicionar · R gira · F espelha · Shift+clique coloca vários · Esc cancela";
  if (draft) return "Clique para dobrar · clique num pino ou fio para ligar · duplo clique ou Esc termina o fio aqui";
  if (tool === "wire") return "Clique em qualquer ponto para começar um fio · V volta para seleção";
  const parts = Object.keys(doc.parts).length;
  const wires = Object.keys(doc.wires).length;
  const nets = getNetlist(doc).nets.filter((n) => n.wires.length || n.pins.length > 1).length;
  return `${parts} peças · ${wires} fios · ${nets} nós`;
}

function PowerButton() {
  const { powered, result, setPowered } = useSim();
  const state = !powered
    ? "simulação parada"
    : !result
      ? "carregando simulador…"
      : !result.ok
        ? `erro: ${result.error}`
        : result.converged
          ? `${result.ms.toFixed(1)} ms/quadro`
          : "não convergiu";
  return (
    <>
      <button
        className={powered ? "power on" : "power"}
        onClick={() => setPowered(!powered)}
        title="Ligar/desligar a energia (E)"
      >
        <i className="dot" /> {powered ? "Energia ligada" : "Energia desligada"}
      </button>
      <span>{state}</span>
    </>
  );
}

const SPEED_LABEL: Record<number, string> = { 1: "tempo real", 0.1: "1/10×", 0.01: "1/100×", 0.001: "1/1000×" };

/** Pausar, câmera lenta, passo a passo e reiniciar. */
function TimeControls() {
  const { powered, paused, speed, t, setPaused, setSpeed, step, reset } = useSim();
  if (!powered) return null;
  return (
    <span className="time">
      <button className="status-btn" onClick={() => setPaused(!paused)} title={paused ? "Continuar (P)" : "Pausar (P)"}>
        {paused ? "▶" : "❚❚"}
      </button>
      <button className="status-btn" onClick={step} title="Avançar um quadro (.)">
        ▶❙
      </button>
      <select className="speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="Velocidade do tempo simulado">
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {SPEED_LABEL[s]}
          </option>
        ))}
      </select>
      <button className="status-btn" onClick={reset} title="Voltar ao tempo zero: descarrega capacitores e rearma proteções">
        ⟲
      </button>
      <span>t = {formatSI(t, "s")}</span>
    </span>
  );
}

export function StatusBar() {
  const { zoom, cursor, reset } = useViewport();
  const hint = useHint();

  return (
    <footer className="statusbar mono">
      <PowerButton />
      <TimeControls />
      <span>{hint}</span>
      <span className="spacer" />
      <span>{cursor ? `x ${cursor.x / GRID} · y ${cursor.y / GRID}` : "—"}</span>
      <button className="status-btn" onClick={reset} title="Voltar à origem e ao zoom inicial">
        {Math.round(zoom * 100)}%
      </button>
    </footer>
  );
}
