//! Servidor MCP do Preparador.
//!
//! O app escuta em http://127.0.0.1:<porta>/mcp (transporte Streamable HTTP, só
//! respostas JSON) e exige um token. As ferramentas e os prompts ficam no
//! frontend (src/lib/mcp.ts): cada chamada vira o evento "mcp-chamada" e o
//! webview responde pelo comando `mcp_responder`. Assim a lógica é a mesma das
//! telas e a interface atualiza na hora.
//!
//! O Claude Desktop só inicia servidores por stdio; para ele, `preparador --mcp`
//! funciona como ponte stdio → HTTP e abre o app se ele estiver fechado.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

const IDENTIFICADOR: &str = "com.preparador.app";
const PORTA_PADRAO: u16 = 47321;
const VERSOES: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
const TEMPO_LIMITE: Duration = Duration::from_secs(120);

const INSTRUCOES: &str = "Preparador: organizador de estudos para concursos, ENEM e vestibulares. \
Os dados são do usuário e ficam no computador dele. Comece por listar_perfis ou ver_plano. \
Matérias e assuntos são identificados por ids curtos (ex.: \"penal\", \"penal-03\"). \
Para criar ou trocar o plano, use os prompts do servidor (ou obter_prompt) e depois importar_plano: \
primeiro com confirmar=false, mostre a prévia ao usuário e só confirme com a aprovação dele. \
Nunca invente links de aulas: use busca na web antes de importar_aulas.";

#[derive(Serialize, Deserialize, Clone)]
pub struct Config {
    pub ligado: bool,
    pub porta: u16,
    pub token: String,
}

fn caminho_config() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join(IDENTIFICADOR).join("mcp.json"))
}

fn novo_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

pub fn ler_config() -> Config {
    let lido = caminho_config()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Config>(&s).ok());
    match lido {
        Some(c) => c,
        None => {
            let c = Config { ligado: false, porta: PORTA_PADRAO, token: novo_token() };
            let _ = salvar_config(&c);
            c
        }
    }
}

fn salvar_config(c: &Config) -> std::io::Result<()> {
    let p = caminho_config().ok_or_else(|| std::io::Error::other("sem pasta de configuração"))?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(p, serde_json::to_string_pretty(c).unwrap_or_default())
}

#[derive(Default)]
pub struct Estado {
    pendentes: Mutex<HashMap<u64, mpsc::Sender<Value>>>,
    proximo: Mutex<u64>,
    servidor: Mutex<Option<Arc<tiny_http::Server>>>,
    erro: Mutex<Option<String>>,
}

/// Sobe o servidor na abertura do app, se estiver ligado.
pub fn iniciar(app: &AppHandle) {
    let cfg = ler_config();
    if cfg.ligado {
        subir(app, &cfg);
    }
}

fn subir(app: &AppHandle, cfg: &Config) {
    let estado = app.state::<Estado>();
    descer(&estado);
    match tiny_http::Server::http(("127.0.0.1", cfg.porta)) {
        Ok(s) => {
            let s = Arc::new(s);
            *estado.servidor.lock().unwrap() = Some(s.clone());
            *estado.erro.lock().unwrap() = None;
            let app = app.clone();
            let token = cfg.token.clone();
            thread::spawn(move || {
                for req in s.incoming_requests() {
                    let app = app.clone();
                    let token = token.clone();
                    thread::spawn(move || atender(&app, &token, req));
                }
            });
        }
        Err(e) => {
            *estado.erro.lock().unwrap() = Some(format!("Não foi possível usar a porta {}: {e}", cfg.porta));
        }
    }
}

fn descer(estado: &Estado) {
    if let Some(s) = estado.servidor.lock().unwrap().take() {
        s.unblock();
    }
}

fn cabecalho(nome: &str, valor: &str) -> tiny_http::Header {
    tiny_http::Header::from_bytes(nome.as_bytes(), valor.as_bytes()).unwrap()
}

fn atender(app: &AppHandle, token: &str, mut req: tiny_http::Request) {
    let resp = |codigo: u16, corpo: String| {
        tiny_http::Response::from_string(corpo)
            .with_status_code(codigo)
            .with_header(cabecalho("Content-Type", "application/json"))
    };
    let caminho = req.url().split('?').next().unwrap_or("").to_string();
    let header = |nome: &str| {
        req.headers()
            .iter()
            .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(nome))
            .map(|h| h.value.as_str().to_string())
    };
    let origem = header("Origin");
    let autorizacao = header("Authorization");
    if caminho != "/mcp" {
        let _ = req.respond(resp(404, r#"{"erro":"use /mcp"}"#.into()));
        return;
    }
    // páginas web abertas no navegador não podem falar com o servidor
    if origem.is_some_and(|o| o != "null") {
        let _ = req.respond(resp(403, r#"{"erro":"origem não permitida"}"#.into()));
        return;
    }
    if autorizacao.as_deref() != Some(&format!("Bearer {token}")) {
        let _ = req.respond(resp(401, r#"{"erro":"token inválido"}"#.into()));
        return;
    }
    if *req.method() != tiny_http::Method::Post {
        let _ = req.respond(resp(405, String::new()).with_header(cabecalho("Allow", "POST")));
        return;
    }
    let mut corpo = String::new();
    if req.as_reader().read_to_string(&mut corpo).is_err() {
        let _ = req.respond(resp(400, String::new()));
        return;
    }
    let resposta = match serde_json::from_str::<Value>(&corpo) {
        Ok(msg) if msg.is_object() => processar(app, msg),
        _ => Some(json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": "JSON inválido"}})),
    };
    let _ = match resposta {
        Some(v) => req.respond(resp(200, v.to_string())),
        None => req.respond(tiny_http::Response::empty(202)),
    };
}

fn processar(app: &AppHandle, msg: Value) -> Option<Value> {
    let id = msg.get("id").cloned()?; // notificação: não responde
    let metodo = msg.get("method").and_then(Value::as_str)?; // resposta do cliente: ignora
    let params = msg.get("params").cloned().unwrap_or(json!({}));
    let r: Result<Value, (i64, String)> = match metodo {
        "initialize" => {
            let pedida = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("");
            let versao = VERSOES.iter().find(|v| **v == pedida).unwrap_or(&VERSOES[0]);
            Ok(json!({
                "protocolVersion": versao,
                "capabilities": { "tools": {}, "prompts": {} },
                "serverInfo": { "name": "preparador", "title": "Preparador", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCOES
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" | "tools/call" | "prompts/list" | "prompts/get" => chamar_webview(app, metodo, params),
        _ => Err((-32601, format!("Método não suportado: {metodo}"))),
    };
    Some(match r {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err((code, message)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
    })
}

fn chamar_webview(app: &AppHandle, metodo: &str, params: Value) -> Result<Value, (i64, String)> {
    let estado = app.state::<Estado>();
    let id = {
        let mut n = estado.proximo.lock().unwrap();
        *n += 1;
        *n
    };
    let (tx, rx) = mpsc::channel();
    estado.pendentes.lock().unwrap().insert(id, tx);
    if let Err(e) = app.emit("mcp-chamada", json!({ "id": id, "metodo": metodo, "params": params })) {
        estado.pendentes.lock().unwrap().remove(&id);
        return Err((-32603, format!("Falha ao falar com a interface: {e}")));
    }
    let r = rx.recv_timeout(TEMPO_LIMITE);
    estado.pendentes.lock().unwrap().remove(&id);
    match r {
        Ok(v) => match v.get("erro") {
            Some(e) => Err((
                e.get("code").and_then(Value::as_i64).unwrap_or(-32603),
                e.get("message").and_then(Value::as_str).unwrap_or("erro").to_string(),
            )),
            None => Ok(v.get("resultado").cloned().unwrap_or(Value::Null)),
        },
        Err(_) => Err((-32603, "O Preparador não respondeu a tempo. A janela do app está aberta?".into())),
    }
}

#[tauri::command]
pub fn mcp_responder(estado: State<Estado>, id: u64, resposta: Value) {
    if let Some(tx) = estado.pendentes.lock().unwrap().remove(&id) {
        let _ = tx.send(resposta);
    }
}

#[tauri::command]
pub fn mcp_status(estado: State<Estado>) -> Value {
    let cfg = ler_config();
    json!({
        "ligado": cfg.ligado,
        "porta": cfg.porta,
        "token": cfg.token,
        "rodando": estado.servidor.lock().unwrap().is_some(),
        "erro": *estado.erro.lock().unwrap(),
        "executavel": std::env::current_exe().ok().map(|p| p.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub fn mcp_configurar(app: AppHandle, estado: State<Estado>, ligado: bool, trocar_token: Option<bool>) -> Result<Value, String> {
    let mut cfg = ler_config();
    cfg.ligado = ligado;
    if trocar_token.unwrap_or(false) {
        cfg.token = novo_token();
    }
    salvar_config(&cfg).map_err(|e| e.to_string())?;
    if ligado {
        subir(&app, &cfg);
    } else {
        descer(&estado);
        *estado.erro.lock().unwrap() = None;
    }
    Ok(mcp_status(estado))
}

// ---------- ponte stdio (Claude Desktop) ----------

enum Falha {
    SemConexao,
    Outra(String),
}

fn enviar(linha: &str) -> Result<Option<String>, Falha> {
    let cfg = ler_config();
    let r = ureq::post(&format!("http://127.0.0.1:{}/mcp", cfg.porta))
        .set("Authorization", &format!("Bearer {}", cfg.token))
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .timeout(TEMPO_LIMITE + Duration::from_secs(5))
        .send_string(linha);
    match r {
        Ok(resp) if resp.status() == 202 => Ok(None),
        Ok(resp) => resp.into_string().map(Some).map_err(|e| Falha::Outra(e.to_string())),
        Err(ureq::Error::Status(codigo, _)) => Err(Falha::Outra(format!("o Preparador recusou a conexão (HTTP {codigo})"))),
        Err(ureq::Error::Transport(_)) => Err(Falha::SemConexao),
    }
}

/// `preparador --mcp`: lê JSON-RPC do stdin, repassa ao app e escreve as respostas no stdout.
pub fn ponte_stdio() {
    let mut app_aberto_por_nos = false;
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for linha in stdin.lock().lines() {
        let Ok(linha) = linha else { break };
        let Ok(msg) = serde_json::from_str::<Value>(&linha) else { continue };
        let espera_resposta = msg.get("id").is_some() && msg.get("method").is_some();

        let mut r = enviar(&linha);
        if matches!(r, Err(Falha::SemConexao)) && espera_resposta {
            // app fechado: abre e espera o servidor subir
            if !app_aberto_por_nos {
                app_aberto_por_nos = true;
                if let Ok(exe) = std::env::current_exe() {
                    let _ = std::process::Command::new(exe)
                        .stdin(std::process::Stdio::null())
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .spawn();
                }
            }
            let inicio = Instant::now();
            while matches!(r, Err(Falha::SemConexao)) && inicio.elapsed() < Duration::from_secs(25) {
                thread::sleep(Duration::from_millis(500));
                r = enviar(&linha);
            }
        }

        let saida = match r {
            Ok(Some(corpo)) => Some(corpo),
            Ok(None) => None,
            Err(f) if espera_resposta => {
                let motivo = match f {
                    Falha::SemConexao => "Não consegui falar com o Preparador. Abra o app e ligue o servidor MCP em Ajustes.".to_string(),
                    Falha::Outra(m) => m,
                };
                Some(json!({ "jsonrpc": "2.0", "id": msg["id"], "error": { "code": -32603, "message": motivo } }).to_string())
            }
            Err(_) => None,
        };
        if let Some(s) = saida {
            // uma mensagem por linha
            let _ = writeln!(stdout, "{}", s.replace('\n', " "));
            let _ = stdout.flush();
        }
    }
}
