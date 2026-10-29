import { useDoc } from "../features/editor/store";
import { fileName, newProject, openProject, saveProject } from "../features/project/file";
import { MODES, useMode, VIEWS } from "./mode";
import { useTheme } from "./theme";

const THEME_LABEL = { system: "Sistema", light: "Claro", dark: "Escuro" } as const;

export function TopBar() {
  const { mode, setMode, view, setView } = useMode();
  const { pref, cycle } = useTheme();
  const filePath = useDoc((s) => s.filePath);
  const dirty = useDoc((s) => s.dirty);

  return (
    <header className="panel topbar">
      <div className="brand">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <rect x="1" y="1" width="16" height="16" rx="4" fill="var(--brand)" />
          <path d="M5 9h3l1.5-3 1.5 6 1-3h1" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>AutoBlue</span>
        <span className="project mono" title={filePath ?? undefined}>
          {fileName(filePath)}
          {dirty && <i className="dirty" title="Alterações não salvas" />}
        </span>
      </div>

      <div className="topbar-center">
        <nav className="segmented" aria-label="Vista">
          {VIEWS.map((v) => (
            <button key={v.id} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </nav>
        {view === "esquema" && (
          <nav className="segmented" aria-label="Modo">
            {MODES.map((m) => (
              <button key={m.id} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
                {m.label}
              </button>
            ))}
          </nav>
        )}
      </div>

      <div className="topbar-right">
        <button className="btn" onClick={() => newProject()} title="Novo (⌘N)">
          Novo
        </button>
        <button className="btn" onClick={() => openProject()} title="Abrir (⌘O)">
          Abrir
        </button>
        <button className="btn" onClick={() => saveProject()} title="Salvar (⌘S) · Salvar como (⇧⌘S)">
          Salvar
        </button>
        <button className="btn" onClick={cycle} title="Alternar tema">
          Tema: {THEME_LABEL[pref]}
        </button>
      </div>
    </header>
  );
}
