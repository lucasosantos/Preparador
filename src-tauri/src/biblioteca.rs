// Arquivos da biblioteca de aulas em texto: um índice (biblioteca.json) e um
// arquivo por aula, na pasta "biblioteca" dentro dos dados do app. O webview só
// passa nomes simples; nada fora dessa pasta pode ser lido ou gravado.
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn caminho(app: &AppHandle, nome: &str) -> Result<PathBuf, String> {
    let valido = !nome.is_empty()
        && nome.len() <= 100
        && !nome.starts_with('.')
        && nome.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if !valido {
        return Err(format!("nome de arquivo inválido: {nome}"));
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("biblioteca");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(nome))
}

#[tauri::command]
pub fn biblioteca_ler(app: AppHandle, nome: String) -> Result<Option<String>, String> {
    match fs::read_to_string(caminho(&app, &nome)?) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Grava num temporário e renomeia, para o índice nunca ficar pela metade.
#[tauri::command]
pub fn biblioteca_gravar(app: AppHandle, nome: String, conteudo: String) -> Result<(), String> {
    let destino = caminho(&app, &nome)?;
    let tmp = destino.with_extension("tmp");
    fs::write(&tmp, conteudo).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &destino).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn biblioteca_remover(app: AppHandle, nome: String) -> Result<(), String> {
    match fs::remove_file(caminho(&app, &nome)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}
