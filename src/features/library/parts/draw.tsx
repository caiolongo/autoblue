import { useContext, type ReactNode } from "react";
import { HintsEnabled, useTooltip } from "../../../ui/tooltipStore";
import type { Marking } from "./types";

/** Cores físicas das peças; iguais nos dois temas, como na vida real. */
export const C = {
  lead: "#a3a3ab",
  metal: "#c4c6cc",
  black: "#1d1d1f",
  ink: "#f4f4f5",
  inkDark: "#18181b",
  pcb: "#1b2a6b",
  copper: "#b87333",
  gold: "#d4a93a",
};

/** Agrupa elementos que mostram uma explicação ao passar o mouse. */
export function Hint({ title, explain, children }: { title: string; explain: string; children: ReactNode }) {
  const enabled = useContext(HintsEnabled);
  const { show, hide } = useTooltip();
  if (!enabled) return <>{children}</>;
  return (
    <g
      className="hint"
      onPointerEnter={(e) => show(e, title, explain)}
      onPointerMove={(e) => show(e, title, explain)}
      onPointerLeave={hide}
    >
      {children}
    </g>
  );
}

interface PrintProps {
  m: Marking;
  x: number;
  y: number;
  size?: number;
  fill?: string;
  anchor?: "start" | "middle" | "end";
  weight?: number;
}

/** Texto impresso na peça (serigrafia, código do chip, valor). */
export function Print({ m, x, y, size = 7, fill = C.ink, anchor = "middle", weight = 500 }: PrintProps) {
  return (
    <Hint title={m.text} explain={m.explain}>
      <text
        x={x}
        y={y}
        fontSize={size}
        fill={fill}
        textAnchor={anchor}
        dominantBaseline="central"
        fontFamily="var(--font-mono)"
        fontWeight={weight}
        className="print"
      >
        {m.text}
      </text>
    </Hint>
  );
}

/** Perna/terminal metálico. */
export function Lead({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.lead} strokeWidth={2} strokeLinecap="round" />;
}
