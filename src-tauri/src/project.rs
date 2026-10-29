//! Leitura e gravação de projetos `.abp` (JSON). O conteúdo é montado no
//! frontend; aqui só conferimos o cabeçalho e cuidamos do disco.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

const FORMAT: &str = "autoblue";
const VERSION: u64 = 1;
const EXTENSION: &str = "abp";

fn check_extension(path: &Path) -> Result<(), String> {
    match path.extension().and_then(|e| e.to_str()) {
        Some(EXTENSION) => Ok(()),
        _ => Err(format!("O arquivo precisa terminar em .{EXTENSION}.")),
    }
}

fn check_header(contents: &str) -> Result<(), String> {
    let v: Value = serde_json::from_str(contents).map_err(|e| format!("Arquivo corrompido: {e}"))?;
    if v.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return Err("Este arquivo não é um projeto AutoBlue.".into());
    }
    match v.get("version").and_then(Value::as_u64) {
        Some(n) if n <= VERSION => Ok(()),
        Some(n) => Err(format!(
            "Este projeto foi feito numa versão mais nova do AutoBlue (formato {n}). Atualize o app para abrir."
        )),
        None => Err("Projeto sem número de versão.".into()),
    }
}

#[tauri::command]
pub fn read_project(path: PathBuf) -> Result<String, String> {
    check_extension(&path)?;
    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Não foi possível abrir {}: {e}", path.display()))?;
    check_header(&contents)?;
    Ok(contents)
}

/// Grava num arquivo temporário e renomeia, para nunca deixar um projeto pela metade.
#[tauri::command]
pub fn write_project(path: PathBuf, contents: String) -> Result<(), String> {
    check_extension(&path)?;
    check_header(&contents)?;
    let tmp = path.with_extension(format!("{EXTENSION}.tmp"));
    fs::write(&tmp, &contents)
        .and_then(|_| fs::rename(&tmp, &path))
        .map_err(|e| format!("Não foi possível salvar {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_current_version() {
        assert!(check_header(r#"{"format":"autoblue","version":1,"parts":[],"wires":[]}"#).is_ok());
    }

    #[test]
    fn rejects_other_formats_and_newer_versions() {
        assert!(check_header(r#"{"format":"kicad","version":1}"#).is_err());
        assert!(check_header(r#"{"format":"autoblue","version":99}"#).is_err());
        assert!(check_header(r#"{"format":"autoblue"}"#).is_err());
        assert!(check_header("não é json").is_err());
    }

    #[test]
    fn requires_abp_extension() {
        assert!(check_extension(Path::new("/tmp/a.abp")).is_ok());
        assert!(check_extension(Path::new("/tmp/a.json")).is_err());
        assert!(check_extension(Path::new("/tmp/a")).is_err());
    }

    #[test]
    fn round_trip_on_disk() {
        let dir = std::env::temp_dir().join(format!("autoblue-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("projeto.abp");
        let contents = r#"{"format":"autoblue","version":1,"parts":[],"wires":[]}"#.to_string();
        write_project(path.clone(), contents.clone()).unwrap();
        assert_eq!(read_project(path.clone()).unwrap(), contents);
        assert!(!path.with_extension("abp.tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
