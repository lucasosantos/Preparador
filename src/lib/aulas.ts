import { fetch } from "@tauri-apps/plugin-http";
import { execute, insertMany, select } from "./db";
import type { AulasJson } from "./esquemas";
import { resolverRef, type Plano } from "./planos";

export type Aula = {
  id: number;
  materia_id: number;
  assunto_id: number | null;
  titulo: string;
  url: string;
  canal: string | null;
  duracao_min: number | null;
  status_link: "nao_verificado" | "ok" | "quebrado";
  assistida_em: string | null;
};

/** Normaliza links do YouTube (vídeo, short, live, embed, playlist). Devolve null se não for YouTube. */
export function ytInfo(raw: string): { url: string; tipo: "Vídeo" | "Playlist" } | null {
  let u: URL;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m)\./, "");
  let id: string | null = null;
  const list = u.searchParams.get("list");
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(shorts|live|embed)\/([^/?#]+)/);
      if (m) id = m[2];
    }
  } else return null;
  if (id && !/^[\w-]{6,20}$/.test(id)) id = null;
  if (!id && !list) return null;
  const t = u.searchParams.get("t");
  let url = id
    ? `https://www.youtube.com/watch?v=${id}`
    : `https://www.youtube.com/playlist?list=${encodeURIComponent(list!)}`;
  if (id && list) url += `&list=${encodeURIComponent(list)}`;
  if (id && t) url += `&t=${encodeURIComponent(t)}`;
  return { url, tipo: id ? "Vídeo" : "Playlist" };
}

export function listarAulas(perfilId: number, planoId: number) {
  return select<Aula>(
    `SELECT a.* FROM aulas a JOIN materias m ON m.id = a.materia_id
      WHERE a.perfil_id = $1 AND m.plano_id = $2 ORDER BY a.id`,
    [perfilId, planoId],
  );
}

export async function existeAula(perfilId: number, materiaId: number, assuntoId: number | null, url: string) {
  const r = await select<{ id: number }>(
    "SELECT id FROM aulas WHERE perfil_id = $1 AND materia_id = $2 AND assunto_id IS $3 AND url = $4",
    [perfilId, materiaId, assuntoId, url],
  );
  return r.length > 0;
}

export async function adicionarAula(
  perfilId: number,
  a: { materiaId: number; assuntoId: number | null; titulo: string; url: string; canal?: string | null; duracaoMin?: number | null },
) {
  await execute(
    "INSERT INTO aulas (perfil_id, materia_id, assunto_id, titulo, url, canal, duracao_min) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [perfilId, a.materiaId, a.assuntoId, a.titulo, a.url, a.canal ?? null, a.duracaoMin ?? null],
  );
}

export type PreviaAulas = {
  validas: { materiaId: number; assuntoId: number | null; titulo: string; url: string; canal: string | null; duracaoMin: number | null }[];
  semAssunto: string[];
  naoYoutube: string[];
  duplicadas: number;
};

export async function previaAulas(perfilId: number, plano: Plano, dados: AulasJson): Promise<PreviaAulas> {
  const existentes = await listarAulas(perfilId, plano.id);
  const chave = (m: number, a: number | null, u: string) => `${m}|${a ?? ""}|${u}`;
  const vistos = new Set(existentes.map((e) => chave(e.materia_id, e.assunto_id, e.url)));
  const out: PreviaAulas = { validas: [], semAssunto: [], naoYoutube: [], duplicadas: 0 };
  for (const a of dados.aulas) {
    const ref = resolverRef(plano, a.materiaId, a.assuntoId);
    if (!ref) {
      out.semAssunto.push(`${a.titulo} (${a.assuntoId ?? a.materiaId})`);
      continue;
    }
    const yt = ytInfo(a.url);
    if (!yt) {
      out.naoYoutube.push(`${a.titulo}: ${a.url}`);
      continue;
    }
    const k = chave(ref.materiaId, ref.assuntoId, yt.url);
    if (vistos.has(k)) {
      out.duplicadas++;
      continue;
    }
    vistos.add(k);
    out.validas.push({ ...ref, titulo: a.titulo, url: yt.url, canal: a.canal ?? null, duracaoMin: a.duracaoMin ?? null });
  }
  return out;
}

export async function importarAulas(perfilId: number, previa: PreviaAulas, bruto: string) {
  await execute("INSERT INTO importacoes (perfil_id, tipo, json_bruto) VALUES ($1, 'aulas', $2)", [perfilId, bruto]);
  if (!previa.validas.length) return;
  await insertMany(
    "aulas",
    ["perfil_id", "materia_id", "assunto_id", "titulo", "url", "canal", "duracao_min"],
    previa.validas.map((a) => [perfilId, a.materiaId, a.assuntoId, a.titulo, a.url, a.canal, a.duracaoMin]),
  );
}

export async function marcarAssistida(id: number, data: string | null) {
  await execute("UPDATE aulas SET assistida_em = $1 WHERE id = $2", [data, id]);
}

export async function removerAula(id: number) {
  await execute("DELETE FROM aulas WHERE id = $1", [id]);
}

/**
 * Consulta o oEmbed do YouTube, que não precisa de chave de API.
 * 404/400 = vídeo inexistente ou privado. 401/403 = existe, mas não permite incorporar.
 */
export async function verificarAula(a: Aula): Promise<Aula["status_link"]> {
  let status: Aula["status_link"] = "nao_verificado";
  let titulo: string | null = null;
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(a.url)}`, { method: "GET" });
    if (r.ok) {
      status = "ok";
      const j = (await r.json()) as { title?: string };
      titulo = j.title?.trim() || null;
    } else if (r.status === 404 || r.status === 400) status = "quebrado";
    else if (r.status === 401 || r.status === 403) status = "ok";
  } catch {
    return "nao_verificado";
  }
  await execute("UPDATE aulas SET status_link = $1, titulo = COALESCE($2, titulo) WHERE id = $3", [status, titulo, a.id]);
  return status;
}
