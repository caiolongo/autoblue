import { V } from "../sim/rules";
import { useSim } from "../sim/store";
import { useMode } from "./mode";

/** Escala de cores das tensões (modos Energia e Testar). */
export function Legend() {
  const mode = useMode((s) => s.mode);
  const { powered, result } = useSim();
  if (mode === "criar") return null;
  if (!powered) {
    return (
      <div className="legend">
        Energia desligada. Ligue com <kbd>E</kbd> para ver tensões e correntes.
      </div>
    );
  }
  if (!result?.ok) return null;
  return (
    <div className="legend">
      <span className="mono">0 V</span>
      <span className="scale" />
      <span className="mono">{V(result.vmax)}</span>
      {mode === "energia" && (
        <span className="flow-key">
          <i /> corrente, do + para o −
        </span>
      )}
    </div>
  );
}
