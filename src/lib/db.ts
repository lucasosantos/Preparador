import Database from "@tauri-apps/plugin-sql";

// As migrações rodam no lado Rust (src-tauri/src/lib.rs) ao carregar este caminho.
const DB_URL = "sqlite:preparador.db";

let conexao: Promise<Database> | null = null;

export function db(): Promise<Database> {
  return (conexao ??= Database.load(DB_URL));
}

export async function select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db()).select<T[]>(sql, params);
}

export async function first<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await select<T>(sql, params))[0] ?? null;
}

export async function execute(sql: string, params: unknown[] = []) {
  return (await db()).execute(sql, params);
}

/** INSERT de várias linhas por comando, em blocos, para evitar uma chamada IPC por linha. */
export async function insertMany(tabela: string, colunas: string[], linhas: unknown[][], { ignorar = false } = {}) {
  const porBloco = Math.max(1, Math.floor(900 / colunas.length));
  for (let i = 0; i < linhas.length; i += porBloco) {
    const bloco = linhas.slice(i, i + porBloco);
    const params: unknown[] = [];
    const valores = bloco.map((l) => {
      const ph = l.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(", ")})`;
    });
    await execute(`INSERT ${ignorar ? "OR IGNORE " : ""}INTO ${tabela} (${colunas.join(", ")}) VALUES ${valores.join(", ")}`, params);
  }
}

export async function getConfig(chave: string): Promise<string | null> {
  const r = await first<{ valor: string }>("SELECT valor FROM config WHERE chave = $1", [chave]);
  return r?.valor ?? null;
}

export async function setConfig(chave: string, valor: string | null) {
  if (valor == null) await execute("DELETE FROM config WHERE chave = $1", [chave]);
  else
    await execute(
      "INSERT INTO config (chave, valor) VALUES ($1, $2) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
      [chave, valor],
    );
}
