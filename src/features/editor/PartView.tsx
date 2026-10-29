import { memo } from "react";
import { A, V } from "../../sim/rules";
import type { PartSim } from "../../sim/simulate";
import { useTooltip } from "../../ui/tooltipStore";
import { PARTS } from "../library/parts";
import { partBounds, partTransform, type Part } from "./doc";

interface Props {
  part: Part;
  selected?: boolean;
  ghost?: boolean;
  /** Estado da simulação (energia ligada). */
  live?: PartSim;
  pressed?: boolean;
}

/** Desenha uma peça: corpo, área de clique, pinos e o designador (R1, D1…). */
export const PartView = memo(function PartView({ part, selected, ghost, live, pressed }: Props) {
  const def = PARTS[part.kind];
  const pins = def.pins(part.props);
  const mk = def.markings(part.props);
  const b = def.bounds;
  const wb = partBounds(part);
  const { show, hide } = useTooltip();
  const burned = !!part.damage;
  const innerBurned = Object.keys(part.inner ?? {}).length;
  const hot = !burned && (live?.heat ?? 0) > 1;
  const cls = ["part", ghost && "ghost", burned && "burned", hot && "hot"].filter(Boolean).join(" ");

  return (
    <g className={cls} data-part={ghost ? undefined : part.id}>
      <g transform={partTransform(part)}>
        <rect x={b.x - 4} y={b.y - 4} width={b.w + 8} height={b.h + 8} fill="transparent" />
        <def.Body p={part.props} mk={mk} live={live && { ...live, damaged: part.damage }} pressed={pressed} />
        {!ghost &&
          pins.map((pin) => {
            const r = live?.reading?.pins[pin.name];
            const now = r ? `\nAgora: ${V(r.v)} · ${A(Math.abs(r.i))} ${r.i >= 0 ? "entrando" : "saindo"}` : "";
            return (
              <g
                key={pin.name}
                className="pin"
                data-pin={`${part.id}:${pin.name}`}
                onPointerEnter={(e) => show(e, `${part.ref} · ${pin.title}`, pin.explain + now)}
                onPointerLeave={hide}
              >
                <circle cx={pin.x} cy={pin.y} r={7} fill="transparent" />
                <circle className="pin-dot" cx={pin.x} cy={pin.y} r={2.6} />
              </g>
            );
          })}
      </g>
      {burned && (
        <g className="smoke" transform={`translate(${wb.x + wb.w / 2} ${wb.y})`}>
          <circle cx={-6} cy={0} r={5} />
          <circle cx={4} cy={-2} r={6} />
          <circle cx={0} cy={2} r={4} />
        </g>
      )}
      {selected && (
        <rect className="selection-box" x={wb.x - 6} y={wb.y - 6} width={wb.w + 12} height={wb.h + 12} rx={6} />
      )}
      {!ghost && (
        <text className="designator" x={wb.x} y={wb.y - 8}>
          <tspan className="ref">{part.ref}</tspan>
          {def.value && <tspan dx={5}>{def.value(part.props)}</tspan>}
          {(burned || innerBurned > 0) && (
            <tspan dx={5} className="burned-label">
              {burned ? "queimado" : `${innerBurned} queimada(s) dentro`}
            </tspan>
          )}
        </text>
      )}
    </g>
  );
});
