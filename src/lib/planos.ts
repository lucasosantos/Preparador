import { execute, first, insertMany, select } from "./db";
import { DIAS_CURTOS } from "./datas";
import type { PlanoJson } from "./esquemas";

export type Prova = {
  id: number;
  nome: string;
  banca: string | null;
  data_prova: string | null;
  situacao: "publicado" | "previsto";
  previsao: string | null;
  edital_base: string | null;
};
export type Assunto = {
  id: number;
  materia_id: number;
  slug: string;
  nome: string;
  detalhe: string | null;
  prioridade: number;
  ordem: number;
  /** quantas provas do objetivo cobram o assunto */
  nProvas: number;
};
export type Materia = { id: number; slug: string; nome: string; peso: number; ordem: number; assuntos: Assunto[] };
export type Plano = {
  id: number;
  versao: number;
  objetivo: { id: number; tipo: "edital" | "constancia"; nome: string };
  provas: Prova[];
  revisoes: number[];
  observacoes: string | null;
  materias: Materia[];
  /** dia (0 = domingo) → ids de matéria, na ordem das sessões */
  semana: number[][];
  materia: Map<number, Materia>;
  assunto: Map<number, Assunto>;
};

export async function carregarPlano(perfilId: number): Promise<Plano | null> {
  const base = await first<{
    id: number;
    versao: number;
    revisoes: string;
    observacoes: string | null;
    objetivo_id: number;
    tipo: "edital" | "constancia";
    nome: string;
  }>(
    `SELECT p.id, p.versao, p.revisoes, p.observacoes, o.id AS objetivo_id, o.tipo, o.nome
       FROM planos p JOIN objetivos o ON o.id = p.objetivo_id
      WHERE o.perfil_id = $1 AND p.ativo = 1
      ORDER BY p.id DESC LIMIT 1`,
    [perfilId],
  );
  if (!base) return null;

  const [provas, mats, asss, sem] = await Promise.all([
    select<Prova>(
      "SELECT id, nome, banca, data_prova, situacao, previsao, edital_base FROM provas WHERE objetivo_id = $1 ORDER BY id", [base.objetivo_id]),
    select<Omit<Materia, "assuntos">>("SELECT id, slug, nome, peso, ordem FROM materias WHERE plano_id = $1 ORDER BY ordem", [
      base.id,
    ]),
    select<Omit<Assunto, "nProvas"> & { n: number }>(
      `SELECT a.id, a.materia_id, a.slug, a.nome, a.detalhe, a.prioridade, a.ordem,
              (SELECT COUNT(*) FROM assunto_provas ap WHERE ap.assunto_id = a.id) AS n
         FROM assuntos a JOIN materias m ON m.id = a.materia_id
        WHERE m.plano_id = $1 ORDER BY a.ordem`,
      [base.id],
    ),
    select<{ dia: number; materia_id: number }>("SELECT dia, materia_id FROM semana WHERE plano_id = $1 ORDER BY dia, ordem", [
      base.id,
    ]),
  ]);

  const materias: Materia[] = mats.map((m) => ({ ...m, assuntos: [] }));
  const materia = new Map(materias.map((m) => [m.id, m]));
  const assunto = new Map<number, Assunto>();
  for (const { n, ...a } of asss) {
    // sem vínculo explícito, o assunto vale para todas as provas do objetivo
    const x: Assunto = { ...a, nProvas: n || provas.length };
    materia.get(a.materia_id)?.assuntos.push(x);
    assunto.set(x.id, x);
  }
  const semana: number[][] = [[], [], [], [], [], [], []];
  for (const s of sem) semana[s.dia].push(s.materia_id);

  return {
    id: base.id,
    versao: base.versao,
    objetivo: { id: base.objetivo_id, tipo: base.tipo, nome: base.nome },
    provas,
    revisoes: parseRevisoes(base.revisoes),
    observacoes: base.observacoes,
    materias,
    semana,
    materia,
    assunto,
  };
}

function parseRevisoes(s: string): number[] {
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v.map(Number).filter((n) => n > 0);
  } catch {}
  return [1, 7, 30];
}

/** Distribui as matérias em seg–sáb proporcionalmente ao peso, sem repetir matéria no mesmo dia. */
export function gerarSemana(materias: { id: string; peso: number }[]): Record<string, string[]> {
  const dias = 6;
  const porDia = Math.max(3, Math.ceil(materias.length / dias));
  const total = dias * porDia;
  const somaPeso = materias.reduce((a, m) => a + m.peso, 0) || 1;
  const vagas = materias.map((m) => ({ id: m.id, n: Math.max(1, Math.round((m.peso / somaPeso) * total)) }));
  // ajusta o total para caber nos slots, cortando das matérias com mais vagas
  let soma = vagas.reduce((a, v) => a + v.n, 0);
  while (soma > total) {
    const maior = vagas.reduce((a, b) => (b.n > a.n ? b : a));
    if (maior.n <= 1) break;
    maior.n--;
    soma--;
  }
  const fila: string[] = [];
  const restantes = vagas.map((v) => ({ ...v }));
  while (restantes.some((v) => v.n > 0))
    for (const v of restantes.sort((a, b) => b.n - a.n))
      if (v.n > 0) {
        fila.push(v.id);
        v.n--;
      }
  const semana: string[][] = Array.from({ length: dias }, () => []);
  let d = 0;
  for (const id of fila) {
    for (let t = 0; t < dias; t++) {
      const dia = (d + t) % dias;
      if (semana[dia].length < porDia && !semana[dia].includes(id)) {
        semana[dia].push(id);
        d = dia + 1;
        break;
      }
    }
  }
  const out: Record<string, string[]> = { dom: [] };
  DIAS_CURTOS.slice(1).forEach((k, i) => (out[k] = semana[i]));
  return out;
}

function semanaVazia(s: PlanoJson["semana"]) {
  return !s || Object.values(s).every((l) => !l || l.length === 0);
}

export type Previa = {
  versaoNova: boolean;
  materiasNovas: string[];
  materiasRemovidas: string[];
  assuntosNovos: number;
  /** assuntos do plano atual reaproveitados pelo novo (mantêm o progresso) */
  assuntosMantidos: number;
  assuntosRemovidos: string[];
  assuntosRenomeados: { de: string; para: string }[];
  totalMaterias: number;
  totalAssuntos: number;
  progressoPerdido: { conclusoes: number; aulas: number; questoes: number };
  semanaGerada: boolean;
};

export async function previaPlano(perfilId: number, dados: PlanoJson): Promise<Previa> {
  const atual = await carregarPlano(perfilId);
  const novasM = new Map(dados.materias.map((m) => [m.id, m]));
  const novosA = new Map(dados.materias.flatMap((m) => m.assuntos.map((a) => [a.id, a] as const)));
  const totalAssuntos = novosA.size;
  const base: Previa = {
    versaoNova: !!atual,
    materiasNovas: [],
    materiasRemovidas: [],
    assuntosNovos: 0,
    assuntosMantidos: 0,
    assuntosRemovidos: [],
    assuntosRenomeados: [],
    totalMaterias: dados.materias.length,
    totalAssuntos,
    progressoPerdido: { conclusoes: 0, aulas: 0, questoes: 0 },
    semanaGerada: semanaVazia(dados.semana),
  };
  if (!atual) return { ...base, materiasNovas: dados.materias.map((m) => m.nome), assuntosNovos: totalAssuntos };

  const slugsM = new Set(atual.materias.map((m) => m.slug));
  const atuaisA = new Map([...atual.assunto.values()].map((a) => [a.slug, a]));
  base.materiasNovas = dados.materias.filter((m) => !slugsM.has(m.id)).map((m) => m.nome);
  base.materiasRemovidas = atual.materias.filter((m) => !novasM.has(m.slug)).map((m) => m.nome);
  base.assuntosNovos = [...novosA.keys()].filter((k) => !atuaisA.has(k)).length;
  base.assuntosMantidos = novosA.size - base.assuntosNovos;
  const removidos = [...atuaisA.values()].filter((a) => !novosA.has(a.slug));
  base.assuntosRemovidos = removidos.map((a) => a.nome);
  base.assuntosRenomeados = [...atuaisA.values()]
    .filter((a) => novosA.has(a.slug) && novosA.get(a.slug)!.nome !== a.nome)
    .map((a) => ({ de: a.nome, para: novosA.get(a.slug)!.nome }));

  const idsRemovidos = removidos.map((a) => a.id);
  const matsRemovidas = atual.materias.filter((m) => !novasM.has(m.slug)).map((m) => m.id);
  if (idsRemovidos.length || matsRemovidas.length) {
    const inA = idsRemovidos.length ? idsRemovidos.join(",") : "NULL";
    const inM = matsRemovidas.length ? matsRemovidas.join(",") : "NULL";
    const c = await first<{ c: number; a: number; q: number }>(
      `SELECT (SELECT COUNT(*) FROM conclusoes WHERE perfil_id = $1 AND assunto_id IN (${inA})) AS c,
              (SELECT COUNT(*) FROM aulas WHERE perfil_id = $1 AND (assunto_id IN (${inA}) OR materia_id IN (${inM}))) AS a,
              (SELECT COUNT(*) FROM questoes WHERE perfil_id = $1 AND materia_id IN (${inM})) AS q`,
      [perfilId],
    );
    base.progressoPerdido = { conclusoes: c?.c ?? 0, aulas: c?.a ?? 0, questoes: c?.q ?? 0 };
  }
  return base;
}

/**
 * Salva o plano. Se o perfil já tem um, atualiza no lugar: matérias e assuntos
 * com o mesmo id (slug) mantêm o registro e, portanto, o progresso.
 */
export async function importarPlano(perfilId: number, dados: PlanoJson, bruto: string) {
  const imp = await execute("INSERT INTO importacoes (perfil_id, tipo, json_bruto) VALUES ($1, 'plano', $2)", [perfilId, bruto]);
  const importacaoId = imp.lastInsertId as number;
  const atual = await carregarPlano(perfilId);
  const o = dados.objetivo;

  let objetivoId: number;
  let planoId: number;
  if (atual) {
    objetivoId = atual.objetivo.id;
    planoId = atual.id;
    await execute("UPDATE objetivos SET tipo = $1, nome = $2 WHERE id = $3", [o.tipo, o.nome, objetivoId]);
    await execute("UPDATE planos SET versao = versao + 1, observacoes = $1, importacao_id = $2 WHERE id = $3", [
      dados.observacoes ?? null,
      importacaoId,
      planoId,
    ]);
    await execute("DELETE FROM provas WHERE objetivo_id = $1", [objetivoId]);
  } else {
    objetivoId = (
      await execute("INSERT INTO objetivos (perfil_id, tipo, nome) VALUES ($1, $2, $3)", [perfilId, o.tipo, o.nome])
    ).lastInsertId as number;
    planoId = (
      await execute("INSERT INTO planos (objetivo_id, observacoes, importacao_id) VALUES ($1, $2, $3)", [
        objetivoId,
        dados.observacoes ?? null,
        importacaoId,
      ])
    ).lastInsertId as number;
  }

  await insertMany(
    "provas",
    ["objetivo_id", "nome", "banca", "data_prova", "situacao", "previsao", "edital_base"],
    o.provas.map((p) => [
      objetivoId,
      p.nome,
      p.banca ?? null,
      p.dataProva ?? null,
      p.situacao,
      p.previsao ?? null,
      p.editalBase ?? null,
    ]),
  );
  const provasDb = await select<{ id: number }>("SELECT id FROM provas WHERE objetivo_id = $1 ORDER BY id", [objetivoId]);
  const provaId = new Map(o.provas.map((p, i) => [p.id, provasDb[i].id]));

  // matérias
  const mExist = new Map(atual?.materias.map((m) => [m.slug, m.id]) ?? []);
  const novasM = new Set(dados.materias.map((m) => m.id));
  for (const m of atual?.materias ?? []) if (!novasM.has(m.slug)) await execute("DELETE FROM materias WHERE id = $1", [m.id]);
  const inserirM: unknown[][] = [];
  for (const [i, m] of dados.materias.entries()) {
    const id = mExist.get(m.id);
    if (id) await execute("UPDATE materias SET nome = $1, peso = $2, ordem = $3 WHERE id = $4", [m.nome, m.peso, i, id]);
    else inserirM.push([planoId, m.id, m.nome, m.peso, i]);
  }
  if (inserirM.length) await insertMany("materias", ["plano_id", "slug", "nome", "peso", "ordem"], inserirM);
  const mDb = new Map(
    (await select<{ id: number; slug: string }>("SELECT id, slug FROM materias WHERE plano_id = $1", [planoId])).map((r) => [
      r.slug,
      r.id,
    ]),
  );

  // assuntos (slug único no plano; pode mudar de matéria)
  const aExist = new Map([...(atual?.assunto.values() ?? [])].map((a) => [a.slug, a]));
  const novosA = new Set(dados.materias.flatMap((m) => m.assuntos.map((a) => a.id)));
  for (const a of aExist.values()) if (!novosA.has(a.slug) && mDb.has(atual!.materia.get(a.materia_id)!.slug))
    await execute("DELETE FROM assuntos WHERE id = $1", [a.id]);
  const inserirA: unknown[][] = [];
  let ordem = 0;
  for (const m of dados.materias)
    for (const a of m.assuntos) {
      const mid = mDb.get(m.id)!;
      const ex = aExist.get(a.id);
      if (ex && mDb.has(atual!.materia.get(ex.materia_id)!.slug))
        await execute(
          "UPDATE assuntos SET materia_id = $1, nome = $2, detalhe = $3, prioridade = $4, ordem = $5 WHERE id = $6",
          [mid, a.nome, a.detalhe ?? null, a.prioridade, ordem, ex.id],
        );
      else inserirA.push([mid, a.id, a.nome, a.detalhe ?? null, a.prioridade, ordem]);
      ordem++;
    }
  if (inserirA.length)
    await insertMany("assuntos", ["materia_id", "slug", "nome", "detalhe", "prioridade", "ordem"], inserirA);
  const aDb = new Map(
    (
      await select<{ id: number; slug: string }>(
        "SELECT a.id, a.slug FROM assuntos a JOIN materias m ON m.id = a.materia_id WHERE m.plano_id = $1",
        [planoId],
      )
    ).map((r) => [r.slug, r.id]),
  );

  const vinculos = dados.materias.flatMap((m) =>
    m.assuntos.flatMap((a) => (a.provas ?? []).map((p) => [aDb.get(a.id), provaId.get(p)])),
  );
  if (vinculos.length) await insertMany("assunto_provas", ["assunto_id", "prova_id"], vinculos);

  // semana
  const semana = semanaVazia(dados.semana) ? gerarSemana(dados.materias) : dados.semana!;
  await execute("DELETE FROM semana WHERE plano_id = $1", [planoId]);
  const linhasSemana = DIAS_CURTOS.flatMap((k, dia) =>
    [...new Set(semana[k] ?? [])].map((slug, ordem) => [planoId, dia, ordem, mDb.get(slug)]),
  ).filter((l) => l[3] != null);
  if (linhasSemana.length) await insertMany("semana", ["plano_id", "dia", "ordem", "materia_id"], linhasSemana);

  return planoId;
}

export async function salvarSemana(planoId: number, semana: number[][]) {
  await execute("DELETE FROM semana WHERE plano_id = $1", [planoId]);
  const linhas = semana.flatMap((ids, dia) => ids.map((mid, ordem) => [planoId, dia, ordem, mid]));
  if (linhas.length) await insertMany("semana", ["plano_id", "dia", "ordem", "materia_id"], linhas);
}

export async function salvarRevisoes(planoId: number, intervalos: number[]) {
  await execute("UPDATE planos SET revisoes = $1 WHERE id = $2", [JSON.stringify(intervalos), planoId]);
}

export async function salvarDataProva(provaId: number, data: string | null) {
  await execute("UPDATE provas SET data_prova = $1 WHERE id = $2", [data, provaId]);
}

/** Linhas "materiaId | assuntoId | nome" usadas nos prompts de aulas e questões. */
export function listaAssuntosPrompt(plano: Plano, filtro?: { materiaId?: number; assuntoIds?: number[] }) {
  const linhas: string[] = [];
  for (const m of plano.materias) {
    if (filtro?.materiaId && m.id !== filtro.materiaId) continue;
    for (const a of m.assuntos) {
      if (filtro?.assuntoIds && !filtro.assuntoIds.includes(a.id)) continue;
      linhas.push(`${m.slug} | ${a.slug} | ${m.nome}: ${a.nome}${a.detalhe ? ` (${a.detalhe})` : ""}`);
    }
  }
  return linhas.join("\n");
}

/**
 * Lista de matérias e assuntos atuais para o prompt de plano, pedindo à IA que
 * reaproveite os ids. Sem isso, um plano novo perderia o progresso.
 */
export function planoAtualPrompt(plano: Plano | null) {
  if (!plano) return "";
  const linhas = plano.materias.map(
    (m) => `${m.slug} = ${m.nome}\n${m.assuntos.map((a) => `  ${a.slug} = ${a.nome}`).join("\n")}`,
  );
  return `
Já tenho um plano em andamento. Para não perder meu progresso, REAPROVEITE os ids abaixo sempre que a matéria ou o assunto for equivalente (mesmo que o nome mude um pouco). Use ids novos só para o que realmente for novo; o que não existir mais pode ser omitido.

Plano atual (id = nome):
${linhas.join("\n")}
`;
}

/** Resolve referências vindas da IA (slugs) para ids do banco. */
export function resolverRef(plano: Plano, materiaSlug?: string | null, assuntoSlug?: string | null) {
  if (assuntoSlug) {
    for (const a of plano.assunto.values()) if (a.slug === assuntoSlug) return { materiaId: a.materia_id, assuntoId: a.id };
  }
  if (materiaSlug) {
    const m = plano.materias.find((x) => x.slug === materiaSlug);
    if (m) return { materiaId: m.id, assuntoId: null };
  }
  return null;
}
