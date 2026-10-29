import { Multimeter } from "./Multimeter";
import { Oscilloscope } from "./Oscilloscope";

/** Bancada de instrumentos do modo Testar. */
export function InstrumentDock() {
  return (
    <div className="panel dock">
      <Multimeter />
      <Oscilloscope />
    </div>
  );
}
