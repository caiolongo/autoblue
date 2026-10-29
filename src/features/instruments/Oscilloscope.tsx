import { formatSI } from "../../lib/si";
import { scope, useSim } from "../../sim/store";
import { ProbeButton } from "./Multimeter";
import { PROBES, TIME_DIVS, useInstruments, VOLT_DIVS } from "./store";

const W = 400;
const H = 240;
const DIV_X = 10;
const DIV_Y = 8;
/** O 0 V fica 2 divisões acima da base: sobra espaço para tensões positivas. */
const ZERO_DIV = 2;

/** Menor escala em que o maior valor cabe na tela. */
function autoVolts(max: number) {
  return VOLT_DIVS.find((v) => v > 0 && max <= v * (DIV_Y - ZERO_DIV - 0.5)) ?? VOLT_DIVS[VOLT_DIVS.length - 1];
}

function stats(values: number[]) {
  const ok = values.filter((v) => Number.isFinite(v));
  if (!ok.length) return null;
  return { now: ok[ok.length - 1], min: Math.min(...ok), max: Math.max(...ok) };
}

export function Oscilloscope() {
  useSim((s) => s.scopeVersion);
  const t = useSim((s) => s.t);
  const { timeDiv, voltDiv, setTimeDiv, setVoltDiv, probes } = useInstruments();

  const span = timeDiv * DIV_X;
  const start = Math.max(0, t - span);
  const first = scope.t.findIndex((x) => x >= start);
  const from = first < 0 ? scope.t.length : first;
  const ts = scope.t.slice(from);
  const chans = [
    { id: "ch1" as const, values: scope.ch1.slice(from) },
    { id: "ch2" as const, values: scope.ch2.slice(from) },
  ].filter((c) => probes[c.id]);

  const peak = Math.max(0, ...chans.flatMap((c) => c.values.filter(Number.isFinite).map(Math.abs)));
  const vdiv = voltDiv || autoVolts(peak);
  const x = (tt: number) => ((tt - start) / span) * W;
  const y = (v: number) => H - ((v / vdiv + ZERO_DIV) / DIV_Y) * H;

  return (
    <section className="instrument scope">
      <header>
        <h3 className="label">Osciloscópio</h3>
        <label className="inline">
          <span className="muted">tempo/div</span>
          <select className="field small" value={timeDiv} onChange={(e) => setTimeDiv(Number(e.target.value))}>
            {TIME_DIVS.map((v) => (
              <option key={v} value={v}>
                {formatSI(v, "s")}
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          <span className="muted">volts/div</span>
          <select className="field small" value={voltDiv} onChange={(e) => setVoltDiv(Number(e.target.value))}>
            {VOLT_DIVS.map((v) => (
              <option key={v} value={v}>
                {v === 0 ? `auto (${formatSI(vdiv, "V")})` : formatSI(v, "V")}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="scope-body">
        <svg className="screen" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {Array.from({ length: DIV_X - 1 }, (_, i) => (
            <line key={`x${i}`} className="grid" x1={((i + 1) * W) / DIV_X} y1={0} x2={((i + 1) * W) / DIV_X} y2={H} />
          ))}
          {Array.from({ length: DIV_Y - 1 }, (_, i) => (
            <line key={`y${i}`} className="grid" x1={0} y1={((i + 1) * H) / DIV_Y} x2={W} y2={((i + 1) * H) / DIV_Y} />
          ))}
          <line className="zero" x1={0} y1={y(0)} x2={W} y2={y(0)} />
          {chans.map((c) => (
            <polyline
              key={c.id}
              className="trace"
              style={{ stroke: PROBES[c.id].color }}
              points={ts
                .map((tt, i) => (Number.isFinite(c.values[i]) ? `${x(tt).toFixed(1)},${y(c.values[i]).toFixed(1)}` : ""))
                .filter(Boolean)
                .join(" ")}
            />
          ))}
          {!chans.length && (
            <text x={W / 2} y={H / 2} textAnchor="middle" className="screen-hint">
              Coloque o canal 1 ou 2 num ponto do circuito
            </text>
          )}
        </svg>
        <div className="scope-side">
          {(["ch1", "ch2"] as const).map((id) => {
            const st = stats(chans.find((c) => c.id === id)?.values ?? []);
            return (
              <div key={id} className="channel">
                <ProbeButton id={id} />
                {st && (
                  <p className="mono muted">
                    agora {formatSI(st.now, "V")} · mín {formatSI(st.min, "V")} · máx {formatSI(st.max, "V")}
                  </p>
                )}
              </div>
            );
          })}
          <p className="muted">
            Tela de {formatSI(span, "s")}, ponto de 0 V na linha clara. O tempo aqui é o simulado: em câmera lenta, a tela anda
            mais devagar.
          </p>
        </div>
      </div>
    </section>
  );
}
