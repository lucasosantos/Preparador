// Aulas em texto geradas pela IA, para assuntos sem vídeo bom. Ficam fora do
// banco: um índice leve (biblioteca.json) e um arquivo por aula, gravados pelo
// lado Rust (src-tauri/src/biblioteca.rs) na pasta de dados do app.
// O índice guarda também o tema pelo nome: aulas de perfis excluídos ficam com
// perfilId null e continuam no acervo para planos futuros.
import { invoke } from "@tauri-apps/api/core";
import { select } from "./db";
import { AulaTextoSchema, type ApostilaJson, type AulaTextoJson } from "./esquemas";
import { IDIOMAS, type Perfil } from "./perfis";
import { listaAssuntosPrompt, resolverRef, type Plano } from "./planos";

const INDICE = "biblioteca.json";

export type ItemBiblioteca = {
  id: string;
  arquivo: string;
  perfilId: number | null;
  materiaId: number;
  assuntoId: number;
  titulo: string;
  apostila?: string | null;
  tema?: TemaTexto;
  criadaEm: string;
  lidaEm: string | null;
};
export type TemaTexto = { materia: string; assunto: string; detalhe: string | null };
type Indice = { schema: "preparador.biblioteca/1"; aulas: ItemBiblioteca[] };

const ler = (nome: string) => invoke<string | null>("biblioteca_ler", { nome });
const gravar = (nome: string, conteudo: string) => invoke<void>("biblioteca_gravar", { nome, conteudo });
const remover = (nome: string) => invoke<void>("biblioteca_remover", { nome });

async function lerIndice(): Promise<Indice> {
  const t = await ler(INDICE);
  if (!t) return { schema: "preparador.biblioteca/1", aulas: [] };
  try {
    const j = JSON.parse(t) as Indice;
    return Array.isArray(j.aulas) ? j : { schema: "preparador.biblioteca/1", aulas: [] };
  } catch {
    return { schema: "preparador.biblioteca/1", aulas: [] };
  }
}

// Leitura, alteração e gravação do índice uma de cada vez, para duas mudanças
// seguidas (ex.: salvar duas aulas pelo MCP) não se sobrescreverem.
let fila: Promise<unknown> = Promise.resolve();
function mudarIndice<T>(fn: (i: Indice) => T | Promise<T>): Promise<T> {
  const r = fila.then(async () => {
    const i = await lerIndice();
    const out = await fn(i);
    await gravar(INDICE, JSON.stringify(i, null, 1));
    return out;
  });
  fila = r.catch(() => {});
  return r;
}

/** Aulas em texto do perfil cujos assuntos ainda existem no plano. */
export async function listarTextos(perfilId: number, plano: Plano): Promise<ItemBiblioteca[]> {
  return (await lerIndice()).aulas.filter((a) => a.perfilId === perfilId && plano.assunto.has(a.assuntoId));
}

/** Todas as aulas do índice, de qualquer perfil ou do acervo. */
export async function todosTextos(): Promise<ItemBiblioteca[]> {
  return (await lerIndice()).aulas;
}

async function temaDe(assuntoId: number): Promise<TemaTexto | undefined> {
  const [t] = await select<TemaTexto>(
    "SELECT m.nome AS materia, a.nome AS assunto, a.detalhe FROM assuntos a JOIN materias m ON m.id = a.materia_id WHERE a.id = $1",
    [assuntoId],
  );
  return t;
}

/** Aulas salvas antes do acervo não tinham o tema; preenche pelo assunto, enquanto ele existir. */
export async function completarTemas() {
  const faltam = (await lerIndice()).aulas.filter((a) => !a.tema);
  if (!faltam.length) return;
  const temas = new Map<number, TemaTexto | undefined>();
  for (const a of faltam) if (!temas.has(a.assuntoId)) temas.set(a.assuntoId, await temaDe(a.assuntoId));
  await mudarIndice((i) => {
    for (const a of i.aulas) if (!a.tema && temas.get(a.assuntoId)) a.tema = temas.get(a.assuntoId);
  });
}

export async function lerTexto(id: string): Promise<{ item: ItemBiblioteca; aula: AulaTextoJson } | null> {
  const item = (await lerIndice()).aulas.find((a) => a.id === id);
  const t = item && (await ler(item.arquivo));
  if (!item || !t) return null;
  const r = AulaTextoSchema.safeParse(JSON.parse(t));
  return r.success ? { item, aula: r.data } : null;
}

export type PreviaTexto = { ok: true; materiaId: number; assuntoId: number; assunto: string } | { ok: false; erro: string };

export function previaTexto(plano: Plano, dados: AulaTextoJson): PreviaTexto {
  const ref = resolverRef(plano, null, dados.assuntoId);
  if (!ref?.assuntoId) return { ok: false, erro: `O assunto "${dados.assuntoId}" não existe no plano.` };
  const a = plano.assunto.get(ref.assuntoId)!;
  return { ok: true, materiaId: ref.materiaId, assuntoId: ref.assuntoId, assunto: `${plano.materia.get(a.materia_id)!.nome}: ${a.nome}` };
}

/** Grava a aula num arquivo próprio e registra no índice. Devolve o id. */
export async function salvarTexto(
  perfilId: number,
  ref: { materiaId: number; assuntoId: number },
  aula: AulaTextoJson,
  extra?: { criadaEm?: string; lidaEm?: string | null },
): Promise<string> {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const arquivo = `aula-${id}.json`;
  const tema = await temaDe(ref.assuntoId);
  await gravar(arquivo, JSON.stringify(aula, null, 1));
  await mudarIndice((i) => {
    i.aulas.push({
      id,
      arquivo,
      perfilId,
      ...ref,
      titulo: aula.titulo,
      apostila: aula.apostila ?? null,
      tema,
      criadaEm: extra?.criadaEm ?? new Date().toISOString().slice(0, 10),
      lidaEm: extra?.lidaEm ?? null,
    });
  });
  return id;
}

/** Grava uma aula só no acervo (sem perfil), vinculada pelo nome do tema. Ids 0 não casam com nenhum assunto. */
export async function salvarTextoAcervo(tema: TemaTexto, aula: AulaTextoJson, extra?: { criadaEm?: string; lidaEm?: string | null }) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const arquivo = `aula-${id}.json`;
  await gravar(arquivo, JSON.stringify(aula, null, 1));
  await mudarIndice((i) => {
    i.aulas.push({
      id,
      arquivo,
      perfilId: null,
      materiaId: 0,
      assuntoId: 0,
      titulo: aula.titulo,
      apostila: aula.apostila ?? null,
      tema,
      criadaEm: extra?.criadaEm ?? new Date().toISOString().slice(0, 10),
      lidaEm: extra?.lidaEm ?? null,
    });
  });
  return id;
}

export type PreviaApostila = {
  validas: { ref: { materiaId: number; assuntoId: number }; assunto: string; aula: AulaTextoJson }[];
  semAssunto: string[];
  /** já salvas antes a partir da mesma apostila e com o mesmo título */
  repetidas: number;
  foraDoPlano: string[];
};

export async function previaApostila(perfilId: number, plano: Plano, dados: ApostilaJson): Promise<PreviaApostila> {
  const chave = (assuntoId: number, titulo: string) => `${assuntoId}|${titulo.toLowerCase()}`;
  const vistos = new Set(
    (await listarTextos(perfilId, plano)).filter((t) => t.apostila === dados.apostila).map((t) => chave(t.assuntoId, t.titulo)),
  );
  const out: PreviaApostila = { validas: [], semAssunto: [], repetidas: 0, foraDoPlano: dados.foraDoPlano };
  for (const a of dados.aulas) {
    const aula: AulaTextoJson = { ...a, schema: "preparador.aulaTexto/1", apostila: dados.apostila };
    const p = previaTexto(plano, aula);
    if (!p.ok) {
      out.semAssunto.push(`${a.titulo} (${a.assuntoId})`);
      continue;
    }
    const k = chave(p.assuntoId, a.titulo);
    if (vistos.has(k)) {
      out.repetidas++;
      continue;
    }
    vistos.add(k);
    out.validas.push({ ref: { materiaId: p.materiaId, assuntoId: p.assuntoId }, assunto: p.assunto, aula });
  }
  return out;
}

export async function salvarApostila(perfilId: number, previa: PreviaApostila) {
  for (const v of previa.validas) await salvarTexto(perfilId, v.ref, v.aula);
}

export async function marcarLida(id: string, data: string | null) {
  await mudarIndice((i) => {
    const a = i.aulas.find((x) => x.id === id);
    if (a) a.lidaEm = data;
  });
}

export async function removerTexto(id: string) {
  const item = await mudarIndice((i) => {
    const k = i.aulas.findIndex((x) => x.id === id);
    return k < 0 ? null : i.aulas.splice(k, 1)[0];
  });
  if (item) await remover(item.arquivo);
}

/** Ao excluir o perfil, as aulas saem dele mas ficam no acervo. Antes, garante o tema delas. */
export async function desvincularTextosDoPerfil(perfilId: number) {
  await completarTemas();
  await mudarIndice((i) => {
    for (const a of i.aulas) if (a.perfilId === perfilId) a.perfilId = null;
  });
}

const PRIORIDADE = ["", "baixa", "média", "alta"];

const complemento = (observacoes: string) => (observacoes.trim() ? `\nObservações minhas (leve em conta):\n${observacoes.trim()}\n` : "");

/** Quem estuda e para quê: a parte comum dos prompts de aula em texto. */
function contextoPerfil(perfil: Perfil, plano: Plano) {
  const provas = plano.provas
    .map((p) => {
      const info = [p.banca && `banca ${p.banca}`, p.data_prova ? `prova em ${p.data_prova}` : p.situacao === "previsto" ? `edital previsto${p.previsao ? ` (${p.previsao})` : ""}` : null]
        .filter(Boolean)
        .join(", ");
      return `  - ${p.nome}${info ? ` (${info})` : ""}`;
    })
    .join("\n");
  return {
    idioma: IDIOMAS.find((x) => x.valor === perfil.idioma)?.nome ?? perfil.idioma,
    perfil: perfil.nome,
    horas: perfil.horas_dia,
    objetivo: plano.objetivo.nome,
    provas,
  };
}

/** Variáveis do prompt "aulas.texto": perfil, provas do plano e posição do assunto. */
export function varsAulaTexto(perfil: Perfil, plano: Plano, assuntoId: number, observacoes = "") {
  const a = plano.assunto.get(assuntoId)!;
  const m = plano.materia.get(a.materia_id)!;
  const i = m.assuntos.findIndex((x) => x.id === a.id);
  const ant = m.assuntos[i - 1],
    prox = m.assuntos[i + 1];
  return {
    ...contextoPerfil(perfil, plano),
    materiaId: m.slug,
    assuntoId: a.slug,
    materia: m.nome,
    assunto: a.nome,
    detalhe: a.detalhe,
    relevancia: `prioridade ${PRIORIDADE[a.prioridade]}, matéria de peso ${m.peso}${plano.provas.length > 1 ? `, cobrado em ${a.nProvas} de ${plano.provas.length} provas` : ""}`,
    vizinhos: [
      `assunto ${i + 1} de ${m.assuntos.length} da matéria`,
      ant && `vem depois de "${ant.nome}"`,
      prox && `antes de "${prox.nome}"`,
    ]
      .filter(Boolean)
      .join("; "),
    complemento: complemento(observacoes),
  };
}

/** Variáveis do prompt "aulas.apostila": perfil, provas e os assuntos em que a apostila pode se encaixar. */
export function varsApostila(perfil: Perfil, plano: Plano, apostila: string, materiaId?: number, observacoes = "") {
  return {
    ...contextoPerfil(perfil, plano),
    apostila: apostila.trim() || "apostila em PDF",
    assuntos: listaAssuntosPrompt(plano, materiaId ? { materiaId } : undefined),
    complemento: complemento(observacoes),
  };
}

/** Quebra o texto de uma seção em blocos: parágrafos e listas ("- item"), com trechos em **negrito**. */
export type Trecho = { t: string; negrito: boolean };
export type Bloco = { tipo: "p"; trechos: Trecho[] } | { tipo: "ul"; itens: Trecho[][] };

export function trechos(linha: string): Trecho[] {
  return linha
    .split(/\*\*(.+?)\*\*/g)
    .map((t, i) => ({ t, negrito: i % 2 === 1 }))
    .filter((x) => x.t);
}

export function blocos(texto: string): Bloco[] {
  const out: Bloco[] = [];
  for (const parte of texto.replace(/\r/g, "").split(/\n\s*\n/)) {
    const linhas = parte.split("\n").map((l) => l.trim()).filter(Boolean);
    let para: string[] = [];
    const fechar = () => {
      if (para.length) out.push({ tipo: "p", trechos: trechos(para.join(" ")) });
      para = [];
    };
    for (const l of linhas) {
      const item = l.match(/^[-*•]\s+(.*)$/);
      if (!item) {
        para.push(l);
        continue;
      }
      fechar();
      const ult = out[out.length - 1];
      if (ult?.tipo === "ul") ult.itens.push(trechos(item[1]));
      else out.push({ tipo: "ul", itens: [trechos(item[1])] });
    }
    fechar();
  }
  return out;
}
