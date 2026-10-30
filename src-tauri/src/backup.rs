// Backup completo em arquivo. O caminho vem sempre do diálogo do sistema,
// nunca do webview: ele só manda o conteúdo e recebe o que foi lido.
use std::fs;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Abre "Salvar como" e grava o backup. Devolve o caminho, ou None se cancelou.
/// async para o diálogo bloqueante não rodar na thread principal.
#[tauri::command]
pub async fn backup_salvar(app: AppHandle, conteudo: String, nome: String) -> Result<Option<String>, String> {
    let Some(arquivo) = app
        .dialog()
        .file()
        .add_filter("Backup do Preparador", &["json"])
        .set_file_name(&nome)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let destino = arquivo.into_path().map_err(|e| e.to_string())?;
    let tmp = destino.with_extension("tmp");
    fs::write(&tmp, conteudo).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &destino).map_err(|e| e.to_string())?;
    Ok(Some(destino.display().to_string()))
}

/// Abre o seletor de arquivo e devolve o conteúdo, ou None se cancelou.
#[tauri::command]
pub async fn backup_abrir(app: AppHandle) -> Result<Option<String>, String> {
    let Some(arquivo) = app.dialog().file().add_filter("Backup do Preparador", &["json"]).blocking_pick_file() else {
        return Ok(None);
    };
    let caminho = arquivo.into_path().map_err(|e| e.to_string())?;
    fs::read_to_string(caminho).map(Some).map_err(|e| e.to_string())
}
