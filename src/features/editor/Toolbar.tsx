import type { ReactNode } from "react";
import { flip, makeBlock, remove, rotate } from "./commands";
import { useDoc, useEditor, type Tool } from "./store";

const I = {
  select: <path d="M4 3l10 5-4.5 1.5L8 14z" />,
  wire: <path d="M3 13h4V5h6" fill="none" />,
  rotate: <path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v2.5h-2.5" fill="none" />,
  flip: <path d="M8 2v12M6 4L2 12h4zM10 4l4 8h-4z" fill="none" />,
  trash: <path d="M3 5h10M6 5V3h4v2M4.5 5l.7 8h5.6l.7-8" fill="none" />,
  undo: <path d="M5 7H10a3 3 0 0 1 0 6H8M5 7l2.5-2.5M5 7l2.5 2.5" fill="none" />,
  redo: <path d="M11 7H6a3 3 0 0 0 0 6h2M11 7L8.5 4.5M11 7L8.5 9.5" fill="none" />,
  block: <path d="M3 4h10v8H3zM1 6h2M1 10h2M13 6h2M13 10h2" fill="none" strokeDasharray="2 1.5" />,
};

function Btn({ title, onClick, active, disabled, icon }: { title: string; onClick: () => void; active?: boolean; disabled?: boolean; icon: ReactNode }) {
  return (
    <button className="tool" title={title} aria-label={title} aria-pressed={active} disabled={disabled} onClick={onClick}>
      <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="currentColor">
        {icon}
      </svg>
    </button>
  );
}

export function Toolbar() {
  const { tool, setTool, placing } = useEditor();
  const { selection, past, future, undo, redo } = useDoc();
  const canEdit = selection.length > 0 || !!placing;
  const pick = (t: Tool) => () => setTool(t);

  return (
    <div className="toolbar">
      <Btn title="Selecionar (V)" icon={I.select} active={tool === "select"} onClick={pick("select")} />
      <Btn title="Fio (W)" icon={I.wire} active={tool === "wire"} onClick={pick("wire")} />
      <span className="sep" />
      <Btn title="Girar 90° (R)" icon={I.rotate} disabled={!canEdit} onClick={rotate} />
      <Btn title="Espelhar (F)" icon={I.flip} disabled={!canEdit} onClick={flip} />
      <Btn title="Apagar (⌫)" icon={I.trash} disabled={!selection.length} onClick={remove} />
      <Btn
        title="Transformar a seleção num bloco (⌘G)"
        icon={I.block}
        disabled={!selection.length}
        onClick={() => {
          const err = makeBlock();
          if (err) window.alert(err);
        }}
      />
      <span className="sep" />
      <Btn title="Desfazer (⌘Z)" icon={I.undo} disabled={!past.length} onClick={undo} />
      <Btn title="Refazer (⇧⌘Z)" icon={I.redo} disabled={!future.length} onClick={redo} />
    </div>
  );
}
