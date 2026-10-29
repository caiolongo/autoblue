import { useTooltip } from "./tooltipStore";

const WIDTH = 280;

export function Tooltip() {
  const tip = useTooltip((s) => s.tip);
  if (!tip) return null;
  const left = Math.min(tip.x + 14, window.innerWidth - WIDTH - 8);
  const top = Math.min(tip.y + 16, window.innerHeight - 120);
  return (
    <div className="tooltip" style={{ left, top, maxWidth: WIDTH }} role="tooltip">
      <div className="tooltip-title mono">{tip.title}</div>
      {tip.body && <div className="tooltip-body">{tip.body}</div>}
    </div>
  );
}
