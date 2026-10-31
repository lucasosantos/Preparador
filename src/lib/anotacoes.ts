// Anotações: páginas em blocos, por perfil, em árvore (tabelas da migração 0005).
// Cada bloco guarda o texto num formato inline simples, legível e fácil de levar
// no backup: **negrito**, _itálico_, `código`, [texto](url) e menções
// [[p:12|Título]] (página), [[m:3|Matéria]] e [[a:45|Assunto]]. O rótulo da
// menção é só um cache; na tela vale o nome atual do alvo.
import { execute, first, insertMany, select } from "./db";
import type { Plano } from "./planos";

export const TIPOS = ["paragrafo", "h1", "h2", "h3", "lista", "numerada", "tarefa", "citacao", "codigo", "divisor"] as const;
export type TipoBloco = (typeof TIPOS)[number];
export const NOME_TIPO: Record<TipoBloco, string> = {
  paragrafo: "Texto",
  h1: "Título 1",
  h2: "Título 2",
  h3: "Título 3",
  lista: "Lista",
  numerada: "Lista numerada",
  tarefa: "Tarefa",
  citacao: "Citação",
  codigo: "Código",
  divisor: "Divisor",
};

export type Pagina = {
  id: number;
  perfil_id: number;
  pai_id: number | null;
  titulo: string;
  icone: string | null;
  ordem: number;
  materia_id: number | null;
  assunto_id: number | null;
  criado_em: string;
  atualizado_em: string;
};
export type NoPagina = Pagina & { filhos: NoPagina[] };
export type Bloco = { id: number; pagina_id: number; tipo: TipoBloco; texto: string; nivel: number; marcado: number; ordem: number };
export type DadosBloco = Partial<Pick<Bloco, "tipo" | "texto" | "nivel" | "marcado">>;

// ---------- formato inline ----------

export type TipoMencao = "p" | "m" | "a";
/** ref é o id do alvo (no backup, o slug ou a referência da página) */
export type Mencao = { tipo: TipoMencao; ref: string; rotulo: string };
export type Trecho = { t: string; b?: boolean; i?: boolean; code?: boolean; href?: string } | { mencao: Mencao };

const ALVO = { p: "pagina", m: "materia", a: "assunto" } as const;
export type Alvo = (typeof ALVO)[TipoMencao];

const RE_MENCAO = /^\[\[([pma]):([^|\]\\]+)(?:\|((?:\\.|[^\]\\])*))?\]\]/;
const RE_LINK = /^\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)\)/;
const desescapar = (s: string) => s.replace(/\\(.)/g, "$1");

/** Lê o texto de um bloco em trechos com formatação. */
export function trechos(texto: string): Trecho[] {
  const out: Trecho[] = [];
  let buf = "",
    b = false,
    it = false;
  const fmt = () => ({ ...(b && { b: true }), ...(it && { i: true }) });
  const flush = () => {
    if (buf) out.push({ t: buf, ...fmt() });
    buf = "";
  };
  for (let i = 0; i < texto.length; ) {
    const c = texto[i];
    const resto = texto.slice(i);
    let m: RegExpMatchArray | null;
    if (c === "\\" && i + 1 < texto.length) {
      buf += texto[i + 1];
      i += 2;
    } else if (resto.startsWith("[[") && (m = resto.match(RE_MENCAO))) {
      flush();
      out.push({ mencao: { tipo: m[1] as TipoMencao, ref: m[2], rotulo: desescapar(m[3] ?? "") } });
      i += m[0].length;
    } else if (c === "[" && (m = resto.match(RE_LINK))) {
      flush();
      out.push({ t: desescapar(m[1]), href: m[2], ...fmt() });
      i += m[0].length;
    } else if (c === "`" && (m = resto.match(/^`((?:\\.|[^`\\])*)`/))) {
      flush();
      out.push({ t: desescapar(m[1]), code: true, ...fmt() });
      i += m[0].length;
    } else if (resto.startsWith("**")) {
      flush();
      b = !b;
      i += 2;
    } else if (c === "_") {
      flush();
      it = !it;
      i++;
    } else {
      buf += c;
      i++;
    }
  }
  flush();
  return out;
}

const escapar = (s: string) => s.replace(/[\\*_`[\]]/g, "\\$&");

/** Inverso de trechos(): monta o texto do bloco. */
export function textoDeTrechos(ts: Trecho[]): string {
  let out = "",
    b = false,
    it = false;
  const marcar = (nb: boolean, ni: boolean) => {
    // fecha antes de abrir, para "**" e "_" nunca se cruzarem
    if (b && !nb) out += "**";
    if (it && !ni) out += "_";
    if (!it && ni) out += "_";
    if (!b && nb) out += "**";
    b = nb;
    it = ni;
  };
  for (const x of ts) {
    if ("mencao" in x) {
      const { tipo, ref, rotulo } = x.mencao;
      out += `[[${tipo}:${ref}${rotulo ? `|${rotulo.replace(/[\\\]|]/g, "\\$&")}` : ""}]]`;
      continue;
    }
    if (!x.t) continue;
    marcar(!!x.b, !!x.i);
    if (x.code) out += "`" + x.t.replace(/[\\`]/g, "\\$&") + "`";
    else if (x.href) out += `[${escapar(x.t)}](${x.href.replace(/[)\s]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"))})`;
    else out += escapar(x.t);
  }
  marcar(false, false);
  return out;
}

/** Texto sem formatação, para prévias e para o título de páginas. */
export function textoPlano(texto: string): string {
  return trechos(texto)
    .map((x) => ("mencao" in x ? x.mencao.rotulo : x.t))
    .join("");
}

/** Alvos mencionados no texto, sem repetir. */
export function extrairMencoes(texto: string): { alvo: Alvo; id: number }[] {
  const vistos = new Map<string, { alvo: Alvo; id: number }>();
  for (const x of trechos(texto))
    if ("mencao" in x && /^\d+$/.test(x.mencao.ref))
      vistos.set(`${x.mencao.tipo}${x.mencao.ref}`, { alvo: ALVO[x.mencao.tipo], id: Number(x.mencao.ref) });
  return [...vistos.values()];
}

/** Troca a referência de cada menção; null tira a menção e deixa só o rótulo. */
export function trocarMencoes(texto: string, fn: (m: Mencao) => string | null): string {
  return textoDeTrechos(
    trechos(texto).map((x) => {
      if (!("mencao" in x)) return x;
      const ref = fn(x.mencao);
      return ref == null ? { t: x.mencao.rotulo } : { mencao: { ...x.mencao, ref } };
    }),
  );
}

// ---------- páginas ----------

const COLS_PAGINA = "id, perfil_id, pai_id, titulo, icone, ordem, materia_id, assunto_id, criado_em, atualizado_em";

export async function listarPaginas(perfilId: number): Promise<Pagina[]> {
  return select<Pagina>(`SELECT ${COLS_PAGINA} FROM paginas WHERE perfil_id = $1 ORDER BY ordem, id`, [perfilId]);
}

export async function lerPagina(id: number): Promise<Pagina | null> {
  return first<Pagina>(`SELECT ${COLS_PAGINA} FROM paginas WHERE id = $1`, [id]);
}

export function montarArvore(paginas: Pagina[]): NoPagina[] {
  const nos = new Map(paginas.map((p) => [p.id, { ...p, filhos: [] as NoPagina[] }]));
  const raiz: NoPagina[] = [];
  for (const n of nos.values()) (n.pai_id != null && nos.get(n.pai_id)?.filhos || raiz).push(n);
  const ordenar = (l: NoPagina[]) => {
    l.sort((a, b) => a.ordem - b.ordem || a.id - b.id);
    for (const n of l) ordenar(n.filhos);
  };
  ordenar(raiz);
  return raiz;
}

/** Pais da página, da raiz até o pai direto. */
export function ancestrais(paginas: Pagina[], id: number): Pagina[] {
  const porId = new Map(paginas.map((p) => [p.id, p]));
  const out: Pagina[] = [];
  for (let p = porId.get(porId.get(id)?.pai_id ?? -1); p && out.length < paginas.length; p = porId.get(p.pai_id ?? -1)) out.unshift(p);
  return out;
}

async function proximaOrdem(perfilId: number, paiId: number | null) {
  const r = await first<{ m: number | null }>("SELECT MAX(ordem) AS m FROM paginas WHERE perfil_id = $1 AND pai_id IS $2", [perfilId, paiId]);
  return (r?.m ?? 0) + 1;
}

/** Cria a página (no fim dos irmãos) já com um parágrafo vazio. Devolve o id. */
export async function criarPagina(
  perfilId: number,
  { paiId = null, titulo = "", materiaId = null, assuntoId = null }: { paiId?: number | null; titulo?: string; materiaId?: number | null; assuntoId?: number | null } = {},
): Promise<number> {
  const r = await execute(
    "INSERT INTO paginas (perfil_id, pai_id, titulo, ordem, materia_id, assunto_id) VALUES ($1, $2, $3, $4, $5, $6)",
    [perfilId, paiId, titulo, await proximaOrdem(perfilId, paiId), materiaId, assuntoId],
  );
  const id = r.lastInsertId as number;
  await execute("INSERT INTO blocos (pagina_id, tipo, ordem) VALUES ($1, 'paragrafo', 1)", [id]);
  return id;
}

export async function atualizarPagina(id: number, { titulo, icone }: { titulo?: string; icone?: string | null }) {
  if (titulo !== undefined) await execute("UPDATE paginas SET titulo = $1, atualizado_em = CURRENT_TIMESTAMP WHERE id = $2", [titulo, id]);
  if (icone !== undefined) await execute("UPDATE paginas SET icone = $1 WHERE id = $2", [icone || null, id]);
}

/** Vincula a página a uma matéria ou a um assunto (a matéria vem do assunto). null, null desfaz. */
export async function vincularPagina(id: number, materiaId: number | null, assuntoId: number | null) {
  if (assuntoId != null) {
    const a = await first<{ materia_id: number }>("SELECT materia_id FROM assuntos WHERE id = $1", [assuntoId]);
    materiaId = a?.materia_id ?? materiaId;
  }
  await execute("UPDATE paginas SET materia_id = $1, assunto_id = $2 WHERE id = $3", [materiaId, assuntoId, id]);
}

/** Move a página para baixo de outra (ou para a raiz), no fim dos irmãos. Recusa mover para dentro dela mesma. */
export async function moverPagina(id: number, novoPaiId: number | null) {
  const p = await lerPagina(id);
  if (!p) return;
  for (let atual = novoPaiId; atual != null; ) {
    if (atual === id) throw new Error("Uma página não pode ir para dentro dela mesma ou de uma subpágina sua.");
    atual = (await first<{ pai_id: number | null }>("SELECT pai_id FROM paginas WHERE id = $1", [atual]))?.pai_id ?? null;
  }
  await execute("UPDATE paginas SET pai_id = $1, ordem = $2 WHERE id = $3", [novoPaiId, await proximaOrdem(p.perfil_id, novoPaiId), id]);
}

/** Troca a página de lugar com a irmã de cima (-1) ou de baixo (1). */
export async function reordenarPagina(id: number, delta: -1 | 1) {
  const p = await lerPagina(id);
  if (!p) return;
  const irmas = (await listarPaginas(p.perfil_id)).filter((x) => x.pai_id === p.pai_id).sort((a, b) => a.ordem - b.ordem || a.id - b.id);
  const i = irmas.findIndex((x) => x.id === id);
  const outra = irmas[i + delta];
  if (!outra) return;
  // renumera para não depender de ordens iguais
  irmas[i] = outra;
  irmas[i + delta] = p;
  for (const [k, x] of irmas.entries()) await execute("UPDATE paginas SET ordem = $1 WHERE id = $2", [k + 1, x.id]);
}

/** Apaga a página com as subpáginas e os blocos. */
export async function excluirPagina(id: number) {
  await execute("DELETE FROM paginas WHERE id = $1", [id]);
}

// ---------- blocos ----------

const COLS_BLOCO = "id, pagina_id, tipo, texto, nivel, marcado, ordem";

export async function blocosDaPagina(paginaId: number): Promise<Bloco[]> {
  return select<Bloco>(`SELECT ${COLS_BLOCO} FROM blocos WHERE pagina_id = $1 ORDER BY ordem, id`, [paginaId]);
}

async function tocar(paginaId: number) {
  await execute("UPDATE paginas SET atualizado_em = CURRENT_TIMESTAMP WHERE id = $1", [paginaId]);
}

async function regravarMencoes(blocoId: number, texto: string) {
  await execute("DELETE FROM mencoes WHERE bloco_id = $1", [blocoId]);
  const ms = extrairMencoes(texto);
  if (ms.length) await insertMany("mencoes", ["bloco_id", "alvo_tipo", "alvo_id"], ms.map((m) => [blocoId, m.alvo, m.id]), { ignorar: true });
}

async function renumerar(paginaId: number) {
  for (const [k, b] of (await blocosDaPagina(paginaId)).entries()) await execute("UPDATE blocos SET ordem = $1 WHERE id = $2", [k + 1, b.id]);
}

/** Insere um bloco logo depois de outro (null = no começo da página). */
export async function inserirBloco(paginaId: number, depoisDe: number | null, dados: DadosBloco = {}): Promise<Bloco> {
  const posicao = async () => {
    const bs = await blocosDaPagina(paginaId);
    const i = depoisDe == null ? -1 : bs.findIndex((b) => b.id === depoisDe);
    const a = bs[i]?.ordem ?? (bs[0] ? bs[0].ordem - 1 : 0);
    const b = bs[i + 1]?.ordem;
    return { a, b };
  };
  let { a, b } = await posicao();
  if (b != null && b - a < 1e-6) {
    await renumerar(paginaId);
    ({ a, b } = await posicao());
  }
  const ordem = b == null ? a + 1 : (a + b) / 2;
  const { tipo = "paragrafo", texto = "", nivel = 0, marcado = 0 } = dados;
  const r = await execute("INSERT INTO blocos (pagina_id, tipo, texto, nivel, marcado, ordem) VALUES ($1, $2, $3, $4, $5, $6)", [
    paginaId, tipo, texto, nivel, marcado, ordem,
  ]);
  const id = r.lastInsertId as number;
  if (texto) await regravarMencoes(id, texto);
  await tocar(paginaId);
  return { id, pagina_id: paginaId, tipo, texto, nivel, marcado, ordem };
}

export async function salvarBloco(id: number, dados: DadosBloco) {
  const campos = (["tipo", "texto", "nivel", "marcado"] as const).filter((c) => dados[c] !== undefined);
  if (!campos.length) return;
  await execute(`UPDATE blocos SET ${campos.map((c, i) => `${c} = $${i + 1}`).join(", ")} WHERE id = $${campos.length + 1}`, [
    ...campos.map((c) => dados[c]),
    id,
  ]);
  if (dados.texto !== undefined) await regravarMencoes(id, dados.texto);
  const b = await first<{ pagina_id: number }>("SELECT pagina_id FROM blocos WHERE id = $1", [id]);
  if (b) await tocar(b.pagina_id);
}

/** Apaga o bloco; a página nunca fica sem nenhum (ganha um parágrafo vazio). */
export async function excluirBloco(id: number) {
  const b = await first<{ pagina_id: number }>("SELECT pagina_id FROM blocos WHERE id = $1", [id]);
  if (!b) return;
  await execute("DELETE FROM blocos WHERE id = $1", [id]);
  if (!(await first("SELECT 1 FROM blocos WHERE pagina_id = $1", [b.pagina_id]))) await inserirBloco(b.pagina_id, null);
  else await tocar(b.pagina_id);
}

/** Troca o bloco de lugar com o de cima (-1) ou o de baixo (1). */
export async function moverBloco(id: number, delta: -1 | 1) {
  const b = await first<{ pagina_id: number }>("SELECT pagina_id FROM blocos WHERE id = $1", [id]);
  if (!b) return;
  const bs = await blocosDaPagina(b.pagina_id);
  const i = bs.findIndex((x) => x.id === id);
  const outro = bs[i + delta];
  if (!outro) return;
  // renumerado, a posição k vale ordem k + 1
  await renumerar(b.pagina_id);
  await execute("UPDATE blocos SET ordem = $1 WHERE id = $2", [i + 1 + delta, id]);
  await execute("UPDATE blocos SET ordem = $1 WHERE id = $2", [i + 1, outro.id]);
}

// ---------- menções e vínculos ----------

export type Referencia = { id: number; titulo: string; icone: string | null; trecho: string | null };

async function referencias(perfilId: number, cond: string, params: unknown[]): Promise<Referencia[]> {
  const rs = await select<{ id: number; titulo: string; icone: string | null; texto: string }>(
    `SELECT p.id, p.titulo, p.icone, b.texto
       FROM mencoes x JOIN blocos b ON b.id = x.bloco_id JOIN paginas p ON p.id = b.pagina_id
      WHERE p.perfil_id = $1 AND (${cond})
      ORDER BY p.atualizado_em DESC, p.id, b.ordem`,
    [perfilId, ...params],
  );
  const vistos = new Map<number, Referencia>();
  for (const r of rs) if (!vistos.has(r.id)) vistos.set(r.id, { id: r.id, titulo: r.titulo, icone: r.icone, trecho: textoPlano(r.texto) });
  return [...vistos.values()];
}

/** Páginas do perfil que mencionam o alvo (sem contar a própria página), com o texto do primeiro bloco que menciona. */
export async function mencionadaEm(perfilId: number, alvo: Alvo, alvoId: number): Promise<Referencia[]> {
  return referencias(perfilId, "x.alvo_tipo = $2 AND x.alvo_id = $3 AND NOT (x.alvo_tipo = 'pagina' AND p.id = x.alvo_id)", [alvo, alvoId]);
}

/**
 * Páginas ligadas a um assunto (ou à matéria, com assuntoId null): as vinculadas
 * a ele e as que o mencionam, vinculadas primeiro. Com todaMateria, entram também
 * as de qualquer assunto da matéria.
 */
export async function paginasDoTema(
  perfilId: number,
  materiaId: number,
  assuntoId: number | null,
  { todaMateria = false } = {},
): Promise<Referencia[]> {
  const vinculadas = await select<Pagina>(
    todaMateria
      ? `SELECT ${COLS_PAGINA} FROM paginas WHERE perfil_id = $1 AND materia_id = $2 ORDER BY atualizado_em DESC`
      : assuntoId == null
        ? `SELECT ${COLS_PAGINA} FROM paginas WHERE perfil_id = $1 AND materia_id = $2 AND assunto_id IS NULL ORDER BY atualizado_em DESC`
        : `SELECT ${COLS_PAGINA} FROM paginas WHERE perfil_id = $1 AND assunto_id = $2 ORDER BY atualizado_em DESC`,
    [perfilId, assuntoId != null && !todaMateria ? assuntoId : materiaId],
  );
  const out = new Map<number, Referencia>(vinculadas.map((p) => [p.id, { id: p.id, titulo: p.titulo, icone: p.icone, trecho: null }]));
  const citam = todaMateria
    ? await referencias(
        perfilId,
        "(x.alvo_tipo = 'materia' AND x.alvo_id = $2) OR (x.alvo_tipo = 'assunto' AND x.alvo_id IN (SELECT id FROM assuntos WHERE materia_id = $2))",
        [materiaId],
      )
    : await mencionadaEm(perfilId, assuntoId == null ? "materia" : "assunto", assuntoId ?? materiaId);
  for (const r of citam) if (!out.has(r.id)) out.set(r.id, r);
  return [...out.values()];
}

// ---------- backup ----------

export type PaginaBackup = {
  ref: number;
  pai: number | null;
  titulo: string;
  icone: string | null;
  materia: string | null;
  assunto: string | null;
  criado_em: string;
  atualizado_em: string;
  blocos: { tipo: TipoBloco; texto: string; nivel: number; marcado: number }[];
};

/**
 * Páginas do perfil para o backup, pais antes dos filhos. Matérias e assuntos
 * (vínculo e menções) vão pelo slug, que sobrevive à restauração; menção a
 * algo que não existe mais vira texto.
 */
export async function exportarPaginas(perfilId: number, plano: Plano | null): Promise<PaginaBackup[]> {
  const ms = (id: number | null) => (id == null ? null : (plano?.materia.get(id)?.slug ?? null));
  const as = (id: number | null) => (id == null ? null : (plano?.assunto.get(id)?.slug ?? null));
  const paginas = await listarPaginas(perfilId);
  const existe = new Set(paginas.map((p) => p.id));
  const ref = (m: Mencao) =>
    m.tipo === "p" ? (existe.has(Number(m.ref)) ? m.ref : null) : (m.tipo === "m" ? ms : as)(Number(m.ref));
  const out: PaginaBackup[] = [];
  const visitar = async (nos: NoPagina[]) => {
    for (const p of nos) {
      out.push({
        ref: p.id,
        pai: p.pai_id,
        titulo: p.titulo,
        icone: p.icone,
        materia: ms(p.materia_id),
        assunto: as(p.assunto_id),
        criado_em: p.criado_em,
        atualizado_em: p.atualizado_em,
        blocos: (await blocosDaPagina(p.id)).map((b) => ({ tipo: b.tipo, texto: trocarMencoes(b.texto, ref), nivel: b.nivel, marcado: b.marcado })),
      });
      await visitar(p.filhos);
    }
  };
  await visitar(montarArvore(paginas));
  return out;
}

/** Recria as páginas do backup no perfil, com os vínculos e as menções ligados aos ids novos. */
export async function importarPaginas(perfilId: number, paginas: PaginaBackup[], plano: Plano | null) {
  const mid = new Map(plano?.materias.map((m) => [m.slug, m.id]));
  const aid = new Map([...(plano?.assunto.values() ?? [])].map((a) => [a.slug, a.id]));
  const pid = new Map<number, number>();
  for (const [k, p] of paginas.entries()) {
    const assunto = p.assunto == null ? null : (aid.get(p.assunto) ?? null);
    const r = await execute(
      `INSERT INTO paginas (perfil_id, pai_id, titulo, icone, ordem, materia_id, assunto_id, criado_em, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [perfilId, p.pai == null ? null : (pid.get(p.pai) ?? null), p.titulo, p.icone, k + 1,
        p.materia == null ? null : (mid.get(p.materia) ?? null), assunto, p.criado_em, p.atualizado_em],
    );
    pid.set(p.ref, r.lastInsertId as number);
  }
  const ref = (m: Mencao) => {
    const id = m.tipo === "p" ? pid.get(Number(m.ref)) : (m.tipo === "m" ? mid : aid).get(m.ref);
    return id == null ? null : String(id);
  };
  for (const p of paginas) {
    const paginaId = pid.get(p.ref)!;
    const blocos = p.blocos.length ? p.blocos : [{ tipo: "paragrafo" as const, texto: "", nivel: 0, marcado: 0 }];
    for (const [k, b] of blocos.entries()) {
      const texto = trocarMencoes(b.texto, ref);
      const r = await execute("INSERT INTO blocos (pagina_id, tipo, texto, nivel, marcado, ordem) VALUES ($1, $2, $3, $4, $5, $6)", [
        paginaId, b.tipo, texto, b.nivel, b.marcado, k + 1,
      ]);
      await regravarMencoes(r.lastInsertId as number, texto);
    }
  }
}
