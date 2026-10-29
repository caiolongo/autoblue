import { useMemo, useRef, useState, type ReactNode } from "react";
import type { View } from "../../app/mode";
import { resistorBands } from "../../lib/colorcode";
import { useDoc } from "../editor/store";
import { PARTS } from "../library/parts";
import { LED_COLORS } from "../library/parts/semis";
import { holeKey, layoutBreadboard, type Hole, type Row } from "./breadboard";
import { layoutPcb } from "./pcb";

const P = 20;
const ROW_Y: Record<Row, number> = { "T+": 0, "T-": 20, a: 60, b: 80, c: 100, d: 120, e: 140, f: 180, g: 200, h: 220, i: 240, j: 260, "B-": 300, "B+": 320 };
const hx = (h: Hole) => 40 + h.col * P;
const hy = (h: Hole) => ROW_Y[h.row];
const NET_COLORS = ["#2f6bff", "#2fd15a", "#f07f13", "#7d3ac1", "#e8b100", "#0fb5ae", "#d6336c"];
const colorOf = (net: string, kind: string) =>
  kind === "power" ? "#e5322d" : kind === "gnd" ? "#2a2a2e" : NET_COLORS[[...net].reduce((h, c) => h + c.charCodeAt(0), 0) % NET_COLORS.length];

/** Área com zoom (roda/pinça) e arraste, enquadrando o conteúdo. */
function Zoomable({ box, children }: { box: { x: number; y: number; w: number; h: number }; children: ReactNode }) {
  const [t, setT] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  return (
    <svg
      className="board-svg"
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      onWheel={(e) => {
        const k = Math.min(8, Math.max(0.3, t.k * Math.exp(-e.deltaY * 0.002)));
        setT({ ...t, k });
      }}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const scale = box.w / e.currentTarget.clientWidth / t.k;
        setT({ ...t, x: t.x + (e.clientX - drag.current.x) * scale, y: t.y + (e.clientY - drag.current.y) * scale });
        drag.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => (drag.current = null)}
    >
      <g transform={`translate(${box.x + box.w / 2} ${box.y + box.h / 2}) scale(${t.k}) translate(${-box.x - box.w / 2 + t.x} ${-box.y - box.h / 2 + t.y})`}>
        {children}
      </g>
    </svg>
  );
}

/** Corpo da peça entre os furos: resistor com faixas, LED colorido ou caixinha com o nome. */
function LeadPart({ kind, props, refName, holes }: { kind: string; props: Record<string, string | number>; refName: string; holes: Hole[] }) {
  const pts = holes.map((h) => ({ x: hx(h), y: hy(h) }));
  const cx = pts.reduce((t, p) => t + p.x, 0) / pts.length;
  const cy = Math.min(...pts.map((p) => p.y)) - (pts.length > 2 ? 26 : 14);
  let body: ReactNode;
  if (kind === "resistor") {
    const bands = resistorBands(Number(props.resistance)).bands;
    body = (
      <g>
        <rect x={cx - 16} y={cy - 5} width={32} height={10} rx={4} fill="#dcc49a" />
        {bands.map((b, i) => (
          <rect key={i} x={cx - 11 + i * 6 + (i === 3 ? 3 : 0)} y={cy - 5} width={3} height={10} fill={b.hex} />
        ))}
      </g>
    );
  } else if (kind === "led") {
    body = <circle cx={cx} cy={cy} r={8} fill={LED_COLORS[String(props.color)]?.hex ?? "#f33"} stroke="#0003" />;
  } else {
    body = <rect x={cx - 14} y={cy - 8} width={28} height={16} rx={3} fill="#1d1d1f" />;
  }
  return (
    <g className="bb-part">
      <title>{`${refName} — ${PARTS[kind]?.name ?? kind}`}</title>
      {pts.map((p, i) => (
        <path key={i} d={`M${p.x} ${p.y} Q${p.x} ${cy} ${cx + (p.x - cx) * 0.3} ${cy}`} stroke="#a3a3ab" strokeWidth={1.6} fill="none" />
      ))}
      {body}
      <text x={cx} y={cy - 12} className="bb-ref" textAnchor="middle">
        {refName}
      </text>
    </g>
  );
}

function Breadboard() {
  const doc = useDoc((s) => s.doc);
  const bb = useMemo(() => layoutBreadboard(doc), [doc]);
  const width = 40 + (bb.cols + 1) * P;
  const mods = bb.modules.length;
  const box = { x: -200 - (mods ? 40 : 0), y: -60, w: width + 260, h: Math.max(420, mods * 90 + 60) };
  const cols = Array.from({ length: bb.cols }, (_, i) => i + 1);
  const rows: Row[] = ["T+", "T-", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "B-", "B+"];
  return (
    <Zoomable box={box}>
      <rect x={20} y={-20} width={width} height={360} rx={10} className="bb-board" />
      <rect x={20} y={152} width={width} height={16} className="bb-gap" />
      {(["T+", "B+"] as Row[]).map((r) => (
        <line key={r} x1={30} x2={width + 10} y1={ROW_Y[r] + (r === "T+" ? -10 : 10)} y2={ROW_Y[r] + (r === "T+" ? -10 : 10)} stroke="#e5322d" strokeWidth={1.5} />
      ))}
      {(["T-", "B-"] as Row[]).map((r) => (
        <line key={r} x1={30} x2={width + 10} y1={ROW_Y[r] + (r === "T-" ? 10 : -10)} y2={ROW_Y[r] + (r === "T-" ? 10 : -10)} stroke="#2f6bff" strokeWidth={1.5} />
      ))}
      {rows.flatMap((r) =>
        cols.map((c) => {
          const net = bb.holeNet.get(holeKey({ col: c, row: r }));
          return (
            <rect key={`${c}${r}`} x={hx({ col: c, row: r }) - 3} y={ROW_Y[r] - 3} width={6} height={6} rx={1} className={net ? "bb-hole used" : "bb-hole"}>
              {net && <title>{net}</title>}
            </rect>
          );
        }),
      )}
      {cols.filter((c) => c % 5 === 0).map((c) => (
        <text key={c} x={hx({ col: c, row: "a" })} y={44} className="bb-ref" textAnchor="middle">
          {c}
        </text>
      ))}
      {bb.chips.map((c) => (
        <g key={c.partId}>
          <rect x={hx({ col: c.col, row: "e" }) - 9} y={ROW_Y.e + 4} width={(c.width - 1) * P + 18} height={ROW_Y.f - ROW_Y.e - 8} rx={2} fill="#1d1d1f" />
          <text x={hx({ col: c.col, row: "e" }) + ((c.width - 1) * P) / 2} y={(ROW_Y.e + ROW_Y.f) / 2 + 3} className="bb-chip" textAnchor="middle">
            {doc.parts[c.partId].ref} {c.label}
          </text>
        </g>
      ))}
      {bb.jumpers.map((j, i) => {
        const [a, b] = [j.a, j.b].map((h) => ({ x: hx(h), y: hy(h) }));
        const lift = 14 + Math.abs(a.x - b.x) * 0.15;
        return (
          <path key={i} d={`M${a.x} ${a.y} C${a.x} ${a.y - lift} ${b.x} ${b.y - lift} ${b.x} ${b.y}`} stroke={colorOf(j.net, j.kind)} strokeWidth={2.6} fill="none" strokeLinecap="round">
            <title>{j.net}</title>
          </path>
        );
      })}
      {bb.leads.map((l) => (
        <LeadPart key={l.partId} kind={l.kind} props={doc.parts[l.partId].props} refName={l.ref} holes={l.holes} />
      ))}
      {bb.modules.map((m) => {
        const y0 = m.slot * 90;
        return (
          <g key={m.partId}>
            <rect x={-200} y={y0} width={120} height={70} rx={8} className="bb-module" />
            <text x={-140} y={y0 + 16} className="bb-chip" textAnchor="middle">
              {m.ref} {m.name}
            </text>
            {m.pins.map((p, i) => {
              const px = -88;
              const py = y0 + 28 + i * (36 / Math.max(1, m.pins.length - 1 || 1));
              return (
                <g key={p.name}>
                  <path d={`M${px} ${py} C${px + 60} ${py} ${hx(p.to)} ${hy(p.to) - 30} ${hx(p.to)} ${hy(p.to)}`} stroke={colorOf(p.net, p.kind)} strokeWidth={2.4} fill="none">
                    <title>{p.net}</title>
                  </path>
                  <text x={px - 4} y={py + 3} className="bb-ref" textAnchor="end">
                    {p.name}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </Zoomable>
  );
}

function Pcb() {
  const doc = useDoc((s) => s.doc);
  const pcb = useMemo(() => layoutPcb(doc), [doc]);
  const b = pcb.board;
  const box = { x: b.x - 30, y: b.y - 30, w: b.w + 60, h: b.h + 60 };
  return (
    <>
      <Zoomable box={box}>
        <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} className="pcb-board" />
        {pcb.traces
          .filter((t) => t.layer === "bottom")
          .map((t, i) => (
            <polyline key={`b${i}`} points={t.points.map((p) => `${p.x},${p.y}`).join(" ")} className="pcb-trace bottom" />
          ))}
        {pcb.traces
          .filter((t) => t.layer === "top")
          .map((t, i) => (
            <polyline key={`t${i}`} points={t.points.map((p) => `${p.x},${p.y}`).join(" ")} className="pcb-trace top" />
          ))}
        {pcb.silk.map((s) => (
          <g key={s.partId} className="pcb-silk">
            <rect x={s.outline.x} y={s.outline.y} width={s.outline.w} height={s.outline.h} rx={3} fill="none" />
            <text x={s.outline.x} y={s.outline.y - 4}>
              {s.ref} {s.value}
            </text>
            {s.mark && (
              <text x={s.mark.x} y={s.mark.y} textAnchor="middle" className="pcb-mark">
                {s.mark.text}
              </text>
            )}
          </g>
        ))}
        {pcb.pads.map((p, i) =>
          p.square ? (
            <rect key={i} x={p.x - 6} y={p.y - 6} width={12} height={12} className="pcb-pad">
              <title>{p.net}</title>
            </rect>
          ) : (
            <circle key={i} cx={p.x} cy={p.y} r={6} className="pcb-pad">
              <title>{p.net}</title>
            </circle>
          ),
        )}
        {pcb.pads.map((p, i) => (
          <circle key={`d${i}`} cx={p.x} cy={p.y} r={2.4} className="pcb-drill" />
        ))}
        {pcb.unrouted.map((u, i) => (
          <line key={`u${i}`} x1={u.a.x} y1={u.a.y} x2={u.b.x} y2={u.b.y} className="pcb-air" />
        ))}
      </Zoomable>
      <div className="legend">
        <span className="swatch top" /> face de cima
        <span className="swatch bottom" /> face de baixo
        {pcb.unrouted.length > 0 ? (
          <span>· {pcb.unrouted.length} ligação(ões) sem rota (tracejado): afaste as peças no esquema</span>
        ) : (
          <span>· todas as ligações roteadas</span>
        )}
      </div>
    </>
  );
}

/** Vistas geradas a partir do esquema (só leitura). */
export function BoardView({ view }: { view: Exclude<View, "esquema"> }) {
  const empty = useDoc((s) => Object.keys(s.doc.parts).length === 0);
  return (
    <div className="board-view">
      <p className="board-note">
        {view === "protoboard"
          ? "Gerada a partir do esquema: cada nó numa tira de 5 furos, alimentação e GND nos trilhos, chips sobre o canal do meio. Para mudar, edite no Esquema."
          : "Gerada a partir do esquema: as peças ficam onde estão no esquema, e as trilhas são roteadas sozinhas. Para mudar, edite no Esquema."}
      </p>
      {empty ? <div className="canvas-empty">Monte um circuito no Esquema para ver aqui.</div> : view === "protoboard" ? <Breadboard /> : <Pcb />}
    </div>
  );
}
