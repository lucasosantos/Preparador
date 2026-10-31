mod backup;
mod biblioteca;
mod mcp;

use tauri_plugin_sql::{Migration, MigrationKind};

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "init",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "provas_previsao",
            sql: include_str!("../migrations/0002_provas_previsao.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "questoes_fonte",
            sql: include_str!("../migrations/0003_questoes_fonte.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "acervo",
            sql: include_str!("../migrations/0004_acervo.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "anotacoes",
            sql: include_str!("../migrations/0005_anotacoes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "simulados",
            sql: include_str!("../migrations/0006_simulados.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

/// `preparador --mcp` vira a ponte stdio do servidor MCP, sem abrir janela.
pub fn ponte_mcp() {
    mcp::ponte_stdio();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:preparador.db", migrations())
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .manage(mcp::Estado::default())
        .invoke_handler(tauri::generate_handler![
            mcp::mcp_responder,
            mcp::mcp_status,
            mcp::mcp_configurar,
            biblioteca::biblioteca_ler,
            biblioteca::biblioteca_gravar,
            biblioteca::biblioteca_remover,
            backup::backup_salvar,
            backup::backup_abrir
        ])
        .setup(|app| {
            mcp::iniciar(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
