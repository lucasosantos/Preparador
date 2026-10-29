// Substitui @tauri-apps/plugin-sql nos testes por node:sqlite, rodando a mesma migração do app.
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

let banco: DatabaseSync | null = null;

export function novoBanco() {
  banco = new DatabaseSync(":memory:");
  banco.exec("PRAGMA foreign_keys = ON");
  const dir = new URL("../../../src-tauri/migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort())
    banco.exec(readFileSync(new URL(f, dir), "utf8"));
}

function params(lista: unknown[]) {
  return Object.fromEntries(
    lista.map((v, i) => [`$${i + 1}`, v === undefined ? null : typeof v === "boolean" ? Number(v) : v]),
  ) as Record<string, null | number | string>;
}

export default class Database {
  static async load() {
    if (!banco) novoBanco();
    return new Database();
  }
  async select<T>(sql: string, p: unknown[] = []): Promise<T> {
    return banco!.prepare(sql).all(params(p)) as T;
  }
  async execute(sql: string, p: unknown[] = []) {
    const r = banco!.prepare(sql).run(params(p));
    return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
  }
}
