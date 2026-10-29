import { useEffect, useMemo, useRef, useState } from "react";
import { useMode } from "../../app/mode";
import { A, V } from "../../sim/rules";
import { useSim } from "../../sim/store";
import { FLOW_SPACING, flowSpeed, voltColor, wireCurrents } from "../../sim/view";
import { useTooltip } from "../../ui/tooltipStore";
import { PROBES, useInstruments, type ProbeId } from "../instruments/store";
import { onSegment, pointInRect, rectFromPoints, rectsIntersect, samePoint, type Point } from "../../lib/geometry";
import { defaultProps, PARTS } from "../library/parts";
import { produce } from "immer";
import { addPart, moveSelection, partBounds, pinsOf, type Doc } from "./doc";
import { finishDraft } from "./commands";
import { getNetlist, pinKey } from "./netlist";
import { PartView } from "./PartView";
import { useDoc, useEditor } from "./store";
import { GRID, snap, useViewport } from "./viewport";
import { route } from "./wires";

export const PART_MIME = "application/x-autoblue-part";

/** Distância (unidades do mundo) em que um clique conta como clique no pino. */
const PIN_GRAB = 8;

type Drag =
  | { type: "pan" }
  | { type: "move"; start: Point; orig: Doc; ids: string[]; moved: boolean }
  | { type: "marquee"; start: Point; base: string[] }
  | { type: "draft"; start: Point }
  | { type: "press"; id: string }
  | { type: "probe"; id: ProbeId };

/** Existe pino ou fio neste ponto? Usado para saber se um fio deve terminar aqui. */
function isConnectable(doc: Doc, p: Point): boolean {
  for (const part of Object.values(doc.parts)) {
    if (pinsOf(part).some(({ pos }) => samePoint(pos, p))) return true;
  }
  for (const w of Object.values(doc.wires)) {
    for (let i = 0; i < w.points.length - 1; i++) if (onSegment(p, w.points[i], w.points[i + 1])) return true;
  }
  return false;
}

function pinPosition(doc: Doc, ref: string): Point | null {
  const [partId, pin] = ref.split(":");
  const part = doc.parts[partId];
  return part ? (pinsOf(part).find((x) => x.pin.name === pin)?.pos ?? null) : null;
}

const pts = (list: Point[]) => list.map((p) => `${p.x},${p.y}`).join(" ");

/** Meio do trecho mais longo de um nó: onde a etiqueta de tensão fica. */
function tagPoint(wires: Point[][]): Point {
  let best = { len: -1, at: wires[0][0] };
  for (const w of wires)
    for (let i = 0; i < w.length - 1; i++) {
      const len = Math.abs(w[i + 1].x - w[i].x) + Math.abs(w[i + 1].y - w[i].y);
      if (len > best.len) best = { len, at: { x: (w[i].x + w[i + 1].x) / 2, y: (w[i].y + w[i + 1].y) / 2 } };
    }
  return best.at;
}

/**
 * Canvas em SVG próprio. O mundo é desenhado dentro de um <g> com escala e
 * translação do viewport; tudo em coordenadas de mundo (GRID = 0,1").
 *
 * Navegação: rolar = mover, Ctrl/pinça = zoom, botão do meio ou Espaço+arrastar = mover.
 */
export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const { x, y, zoom, cursor, panBy, zoomAt, setCursor } = useViewport();
  const doc = useDoc((s) => s.doc);
  const selection = useDoc((s) => s.selection);
  const { tool, placing, draft, marquee, hoverNet } = useEditor();
  const netlist = getNetlist(doc);
  const mode = useMode((s) => s.mode);
  const sim = useSim((s) => s.result);
  const pressed = useSim((s) => s.pressed);
  const probes = useInstruments((s) => s.probes);
  const placingProbe = useInstruments((s) => s.placing);
  const tooltip = useTooltip();
  const currents = useMemo(() => (sim ? wireCurrents(sim.flows) : null), [sim]);
  const pinPoints = useMemo(() => Object.values(doc.parts).flatMap((p) => pinsOf(p).map((x) => x.pos)), [doc]);
  /** Fios novos desviam de pinos e pontas de fio (para não ligar nada sem querer) e dos corpos das peças. */
  const obstacles = useMemo(
    () => ({
      blocked: [...pinPoints, ...Object.values(doc.wires).flatMap((w) => [w.points[0], w.points[w.points.length - 1]])],
      bodies: Object.values(doc.parts).map(partBounds),
      wires: Object.values(doc.wires).map((w) => w.points),
    }),
    [doc, pinPoints],
  );
  const routeTo = (a: Point, b: Point) => route(a, b, GRID, obstacles.blocked, obstacles.bodies, obstacles.wires);
  /** Fora do modo Criar, com energia, os fios mostram a tensão. */
  const voltView = sim?.ok && mode !== "criar";

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    // Listener nativo: o onWheel do React é passivo e não permite preventDefault.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else {
        panBy(-e.deltaX, -e.deltaY);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [panBy, zoomAt]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const toWorld = (clientX: number, clientY: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: x + (clientX - r.left) / zoom, y: y + (clientY - r.top) / zoom };
  };
  const toGrid = (clientX: number, clientY: number): Point => {
    const w = toWorld(clientX, clientY);
    return { x: snap(w.x), y: snap(w.y) };
  };

  /** Clique durante o desenho de um fio: dobra aqui, ou termina se cair num pino/fio. */
  const draftPoint = (p: Point) => {
    const ed = useEditor.getState();
    const current = ed.draft!;
    const last = current[current.length - 1];
    if (samePoint(last, p)) return finishDraft();
    ed.setDraft([...current, ...routeTo(last, p).slice(1)]);
    if (isConnectable(useDoc.getState().doc, p)) finishDraft();
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      svg.setPointerCapture(e.pointerId);
      drag.current = { type: "pan" };
      return;
    }
    if (e.button !== 0) return;

    const s = toGrid(e.clientX, e.clientY);
    const target = e.target as Element;
    const ed = useEditor.getState();
    const { doc, selection, commit, select } = useDoc.getState();

    if (ed.placing) {
      const [next, id] = addPart(doc, ed.placing.kind, s, ed.placing.rot, ed.placing.flip);
      commit(next, [id]);
      if (!e.shiftKey) ed.setPlacing(null);
      return;
    }

    if (ed.draft) {
      draftPoint(s);
      return;
    }

    // Pontas de prova: posicionar ou arrastar.
    const instr = useInstruments.getState();
    if (instr.placing) {
      instr.setProbe(instr.placing, s);
      instr.setPlacing(null);
      return;
    }
    const probeEl = target.closest("[data-probe]");
    if (probeEl) {
      svg.setPointerCapture(e.pointerId);
      drag.current = { type: "probe", id: probeEl.getAttribute("data-probe") as ProbeId };
      return;
    }

    // Botões e chaves: apertar/mudar com o mouse, sem selecionar.
    const actuatorPart = target.closest("[data-actuator]") && target.closest("[data-part]")?.getAttribute("data-part");
    if (actuatorPart) {
      const part = doc.parts[actuatorPart];
      if (part.kind === "pushButton") {
        useSim.getState().press(part.id, true);
        svg.setPointerCapture(e.pointerId);
        drag.current = { type: "press", id: part.id };
        return;
      }
      if (part.kind === "slideSwitch") {
        commit(
          produce(doc, (d) => {
            d.parts[part.id].props.position = part.props.position === "1" ? "2" : "1";
          }),
        );
        return;
      }
    }

    // Pinos têm prioridade sobre fios: um pino que já tem fio continua aceitando outro.
    const raw = toWorld(e.clientX, e.clientY);
    const pinEl = target.closest("[data-pin]");
    const nearPin = pinPoints.find((p) => Math.hypot(p.x - raw.x, p.y - raw.y) <= PIN_GRAB);
    if (pinEl || nearPin || ed.tool === "wire") {
      const start = (pinEl && pinPosition(doc, pinEl.getAttribute("data-pin")!)) || nearPin || s;
      ed.setDraft([start]);
      svg.setPointerCapture(e.pointerId);
      drag.current = { type: "draft", start };
      return;
    }

    const id = target.closest("[data-part]")?.getAttribute("data-part") ?? target.closest("[data-wire]")?.getAttribute("data-wire");
    if (id) {
      let sel = selection;
      if (e.shiftKey) {
        sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
        select(sel);
        if (!sel.includes(id)) return;
      } else if (!sel.includes(id)) {
        sel = [id];
        select(sel);
      }
      svg.setPointerCapture(e.pointerId);
      drag.current = { type: "move", start: s, orig: doc, ids: sel, moved: false };
      return;
    }

    svg.setPointerCapture(e.pointerId);
    drag.current = { type: "marquee", start: toWorld(e.clientX, e.clientY), base: e.shiftKey ? selection : [] };
    if (!e.shiftKey) select([]);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    const s = toGrid(e.clientX, e.clientY);
    if (!cursor || !samePoint(cursor, s)) setCursor(s);

    if (d?.type === "pan") {
      panBy(e.movementX, e.movementY);
    } else if (d?.type === "probe") {
      useInstruments.getState().setProbe(d.id, s);
    } else if (d?.type === "move") {
      const dx = s.x - d.start.x;
      const dy = s.y - d.start.y;
      const store = useDoc.getState();
      if (!d.moved && (dx || dy)) {
        store.checkpoint(d.orig);
        d.moved = true;
      }
      if (d.moved) store.replace(moveSelection(d.orig, d.ids, dx, dy));
    } else if (d?.type === "marquee") {
      const r = rectFromPoints(d.start, toWorld(e.clientX, e.clientY));
      useEditor.getState().setMarquee(r);
      const { doc, select } = useDoc.getState();
      const hit = [
        ...Object.values(doc.parts)
          .filter((p) => rectsIntersect(partBounds(p), r))
          .map((p) => p.id),
        ...Object.values(doc.wires)
          .filter((w) => w.points.some((p, i) => pointInRect(p, r) || (i > 0 && rectsIntersect(rectFromPoints(w.points[i - 1], p), r))))
          .map((w) => w.id),
      ];
      select([...new Set([...d.base, ...hit])]);
    } else if (!d) {
      const target = e.target as Element;
      const wireId = target.closest("[data-wire]")?.getAttribute("data-wire");
      const pin = target.closest("[data-pin]")?.getAttribute("data-pin");
      const [pid, pname] = pin?.split(":") ?? [];
      const net = wireId ? netlist.byWire.get(wireId) : pin ? netlist.byPin.get(pinKey(pid, pname)) : undefined;
      const ed = useEditor.getState();
      if ((net?.id ?? null) !== ed.hoverNet) ed.setHoverNet(net?.id ?? null);
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d?.type === "marquee") useEditor.getState().setMarquee(null);
    if (d?.type === "press") useSim.getState().press(d.id, false);
    // Arrastar de um pino e soltar em outro ponto também liga um fio.
    if (d?.type === "draft") {
      const s = toGrid(e.clientX, e.clientY);
      if (!samePoint(s, d.start) && useEditor.getState().draft?.length === 1) draftPoint(s);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(PART_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setCursor(toGrid(e.clientX, e.clientY));
  };

  const onDrop = (e: React.DragEvent) => {
    const kind = e.dataTransfer.getData(PART_MIME);
    if (!PARTS[kind]) return;
    e.preventDefault();
    const { doc, commit } = useDoc.getState();
    const [next, id] = addPart(doc, kind, toGrid(e.clientX, e.clientY));
    commit(next, [id]);
  };

  const showMinor = zoom >= 0.5;
  const dot = 1.1 / zoom;
  const major = GRID * 10;
  // A grade é desenhada no espaço da tela; o padrão recebe a transformação do mundo.
  const world = `scale(${zoom}) translate(${-x} ${-y})`;
  const selected = new Set(selection);
  const draftPreview = draft && cursor ? [...draft, ...routeTo(draft[draft.length - 1], cursor).slice(1)] : draft;

  const cursorMode =
    drag.current?.type === "pan"
      ? "grabbing"
      : spaceHeld
        ? "grab"
        : placing || draft || placingProbe || tool === "wire"
          ? "crosshair"
          : "default";

  return (
    <svg
      ref={svgRef}
      className="canvas"
      data-cursor={cursorMode}
      data-tool={tool}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        setCursor(null);
        useEditor.getState().setHoverNet(null);
      }}
      onDoubleClick={() => useEditor.getState().draft && finishDraft()}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <defs>
        <pattern id="grid-minor" width={GRID} height={GRID} patternUnits="userSpaceOnUse" patternTransform={world}>
          <circle cx={0} cy={0} r={dot} fill="var(--grid-dot)" />
          <circle cx={GRID} cy={0} r={dot} fill="var(--grid-dot)" />
          <circle cx={0} cy={GRID} r={dot} fill="var(--grid-dot)" />
          <circle cx={GRID} cy={GRID} r={dot} fill="var(--grid-dot)" />
        </pattern>
        <pattern id="grid-major" width={major} height={major} patternUnits="userSpaceOnUse" patternTransform={world}>
          <circle cx={0} cy={0} r={dot * 1.6} fill="var(--grid-dot-major)" />
          <circle cx={major} cy={0} r={dot * 1.6} fill="var(--grid-dot-major)" />
          <circle cx={0} cy={major} r={dot * 1.6} fill="var(--grid-dot-major)" />
          <circle cx={major} cy={major} r={dot * 1.6} fill="var(--grid-dot-major)" />
        </pattern>
      </defs>

      {showMinor && <rect width="100%" height="100%" fill="url(#grid-minor)" />}
      <rect width="100%" height="100%" fill="url(#grid-major)" />

      <g transform={world}>
        {Object.values(doc.parts).map((p) => (
          <PartView key={p.id} part={p} selected={selected.has(p.id)} live={sim?.parts[p.id]} pressed={pressed.has(p.id)} />
        ))}

        {Object.values(doc.wires).map((w) => {
          const net = netlist.byWire.get(w.id);
          const cls = [
            "wire",
            `k-${net?.kind ?? "signal"}`,
            selected.has(w.id) && "selected",
            hoverNet && net?.id === hoverNet && "hot",
          ]
            .filter(Boolean)
            .join(" ");
          const v = net && sim?.nets[net.id];
          const explain = (e: React.PointerEvent) =>
            net &&
            sim &&
            tooltip.show(e, `${net.name} · ${V(v ?? 0)}`, `Corrente neste fio: ${A(currents?.get(w.id) ?? 0)}`);
          return (
            <g key={w.id} data-wire={w.id} onPointerEnter={explain} onPointerMove={explain} onPointerLeave={tooltip.hide}>
              <polyline className="wire-hit" points={pts(w.points)} />
              {selected.has(w.id) && <polyline className="wire-halo" points={pts(w.points)} />}
              <polyline
                className={cls}
                points={pts(w.points)}
                style={voltView && net?.kind !== "short" ? { stroke: voltColor(v ?? 0, sim!.vmax) } : undefined}
              />
            </g>
          );
        })}

        {mode === "energia" &&
          sim?.flows
            .filter((f) => Math.abs(f.i) > 1e-6)
            .map((f, i) => {
              const [a, b] = f.i > 0 ? [f.a, f.b] : [f.b, f.a];
              return (
                <line
                  key={i}
                  className="flow"
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  style={{ animationDuration: `${FLOW_SPACING / flowSpeed(f.i)}s` }}
                />
              );
            })}

        {netlist.junctions.map((p) => (
          <circle key={`j${p.x},${p.y}`} className="junction" cx={p.x} cy={p.y} r={4} />
        ))}
        {netlist.loose.map((p) => (
          <circle key={`l${p.x},${p.y}`} className="loose-end" cx={p.x} cy={p.y} r={3.5} />
        ))}

        {mode === "testar" &&
          sim?.ok &&
          netlist.nets
            .filter((n) => n.wires.length)
            .map((n) => {
              const at = tagPoint(n.wires.map((id) => doc.wires[id].points));
              const text = V(sim.nets[n.id] ?? 0);
              const w = text.length * 5.6 + 10;
              return (
                <g key={n.id} className="vtag" transform={`translate(${at.x} ${at.y - 14})`}>
                  <rect x={-w / 2} y={-8} width={w} height={16} rx={5} style={{ fill: voltColor(sim.nets[n.id] ?? 0, sim.vmax) }} />
                  <text textAnchor="middle" dominantBaseline="central">
                    {text}
                  </text>
                </g>
              );
            })}

        {draftPreview && <polyline className="wire-draft" points={pts(draftPreview)} />}

        {placing && cursor && (
          <PartView
            ghost
            part={{
              id: "ghost",
              kind: placing.kind,
              ref: "",
              x: cursor.x,
              y: cursor.y,
              rot: placing.rot,
              flip: placing.flip,
              props: defaultProps(PARTS[placing.kind]),
            }}
          />
        )}

        {mode === "testar" &&
          (Object.entries(probes) as [ProbeId, Point][]).map(([id, p]) => (
            <g key={id} className="probe" data-probe={id} transform={`translate(${p.x} ${p.y})`} style={{ color: PROBES[id].color }}>
              <line x1={0} y1={0} x2={16} y2={-24} />
              <circle className="probe-tip" cx={0} cy={0} r={4} />
              <circle className="probe-head" cx={16} cy={-24} r={9} />
              <text x={16} y={-24} textAnchor="middle" dominantBaseline="central">
                {PROBES[id].label}
              </text>
            </g>
          ))}

        {marquee && <rect className="marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} />}

        {cursor && !placing && drag.current?.type !== "pan" && (
          <circle cx={cursor.x} cy={cursor.y} r={3 / zoom} className="cursor-dot" strokeWidth={1.2 / zoom} />
        )}
      </g>
    </svg>
  );
}
