// Simulados em modo prova (tabelas da migração 0006). Montados com questões do
// banco, distribuídas pelo peso das matérias, ou com questões geradas pela IA
// (que entram no banco antes). As respostas são gravadas a cada clique; o
// gabarito só aparece depois de finalizar, quando elas vão também para respostas.
import { embaralhar, hoje } from "./datas";
import { execute, first, insertMany, select } from "./db";
import type { QuestoesJson } from "./esquemas";
import { IDIOMAS } from "./perfis";
import { listaAssuntosPrompt, resolverRef, type Plano } from "./planos";
import { importarQuestoes, listarQuestoes, questoesPorIds, type PreviaQuestoes, type Questao } from "./questoes";

export const MAX_QUESTOES = 200;

export type Simulado = {
  id: number;
  perfil_id: number;
  titulo: string;
  origem: "banco" | "ia";
  tempo_min: number | null;
  criado_em: string;
  iniciado_em: string | null;
  finalizado_em: string | null;
  duracao_seg: number | null;
};
export type ResumoSimulado = Simulado & { total: number; respondidas: number; acertos: number };
export type ItemSimulado = { q: Questao; ordem: number; resposta: string | null; acertou: boolean | null };
export type Situacao = "ineditas" | "erradas" | "todas";

/**
 * Divide o total entre as matérias pelo peso (maior resto), sem passar do que
 * cada uma tem disponível; a sobra vai para as que ainda têm questões.
 */
export function distribuir(materias: { id: number; peso: number; disponiveis: number }[], total: number): Map<number, number> {
  const out = new Map(materias.map((m) => [m.id, 0]));
  let resto = Math.min(total, materias.reduce((s, m) => s + m.disponiveis, 0));
  while (resto > 0) {
    const abertas = materias.filter((m) => out.get(m.id)! < m.disponiveis);
    const pesoTotal = abertas.reduce((s, m) => s + Math.max(m.peso, 0.01), 0);
    const cotas = abertas.map((m) => {
      const ideal = (resto * Math.max(m.peso, 0.01)) / pesoTotal;
      const livre = m.disponiveis - out.get(m.id)!;
      return { m, n: Math.min(Math.floor(ideal), livre), frac: ideal - Math.floor(ideal), livre };
    });
    let dados = 0;
    for (const c of cotas) {
      out.set(c.m.id, out.get(c.m.id)! + c.n);
      dados += c.n;
    }
    // o que sobrou do arredondamento vai, uma por vez, para os maiores restos
    for (const c of [...cotas].sort((a, b) => b.frac - a.frac || b.m.peso - a.m.peso)) {
      if (dados >= resto) break;
      if (out.get(c.m.id)! < c.m.disponiveis) {
        out.set(c.m.id, out.get(c.m.id)! + 1);
        dados++;
      }
    }
    if (!dados) break;
    resto -= dados;
  }
  return out;
}

const passa = (q: Questao, s: Situacao) => (s === "ineditas" ? !q.resposta : s === "erradas" ? !!q.resposta && !q.resposta.acertou : true);

/** Quantas questões cada matéria tem na situação pedida. */
export async function disponiveis(perfilId: number, plano: Plano, situacao: Situacao): Promise<Map<number, number>> {
  const out = new Map(plano.materias.map((m) => [m.id, 0]));
  for (const q of await listarQuestoes(perfilId, plano.id)) if (passa(q, situacao)) out.set(q.materia_id, (out.get(q.materia_id) ?? 0) + 1);
  return out;
}

async function criar(perfilId: number, titulo: string, origem: "banco" | "ia", tempoMin: number | null, questaoIds: number[]) {
  const r = await execute("INSERT INTO simulados (perfil_id, titulo, origem, tempo_min) VALUES ($1, $2, $3, $4)", [
    perfilId, titulo.trim() || "Simulado", origem, tempoMin && tempoMin > 0 ? Math.round(tempoMin) : null,
  ]);
  const id = r.lastInsertId as number;
  await insertMany("simulado_questoes", ["simulado_id", "questao_id", "ordem"], [...new Set(questaoIds)].map((q, i) => [id, q, i + 1]));
  return id;
}

export type OpcoesBanco = { titulo: string; materiaIds: number[]; total: number; situacao: Situacao; tempoMin: number | null; seed?: string };

/**
 * Sorteia as questões do banco e cria o simulado. Dentro de cada matéria, alterna
 * entre os assuntos para cobrir o máximo deles. Ordem da prova: matérias na ordem do plano.
 * Devolve null se não houver nenhuma questão.
 */
export async function montarDoBanco(perfilId: number, plano: Plano, o: OpcoesBanco): Promise<number | null> {
  const seed = o.seed ?? String(Date.now());
  const sel = new Set(o.materiaIds);
  const porMateria = new Map<number, Questao[]>();
  for (const q of await listarQuestoes(perfilId, plano.id))
    if (sel.has(q.materia_id) && passa(q, o.situacao)) porMateria.set(q.materia_id, [...(porMateria.get(q.materia_id) ?? []), q]);
  const materias = plano.materias.filter((m) => sel.has(m.id));
  const cotas = distribuir(
    materias.map((m) => ({ id: m.id, peso: m.peso, disponiveis: porMateria.get(m.id)?.length ?? 0 })),
    Math.min(o.total, MAX_QUESTOES),
  );
  const ids: number[] = [];
  for (const m of materias) {
    const n = cotas.get(m.id) ?? 0;
    if (!n) continue;
    // rodízio entre assuntos: uma questão de cada assunto por vez
    const grupos = new Map<number | null, Questao[]>();
    for (const q of embaralhar(porMateria.get(m.id)!, `${seed}-${m.id}`)) grupos.set(q.assunto_id, [...(grupos.get(q.assunto_id) ?? []), q]);
    const filas = embaralhar([...grupos.values()], `${seed}-g${m.id}`);
    const escolhidas: Questao[] = [];
    for (let k = 0; escolhidas.length < n; k++) for (const f of filas) if (f[k] && escolhidas.length < n) escolhidas.push(f[k]);
    ids.push(...escolhidas.map((q) => q.id));
  }
  if (!ids.length) return null;
  return criar(perfilId, o.titulo, "banco", o.tempoMin, ids);
}

/** Quantas questões a IA deve fazer de cada matéria (pelo peso, sem limite de disponíveis). */
export function cotasIa(plano: Plano, materiaIds: number[], total: number): Map<number, number> {
  const sel = new Set(materiaIds);
  const n = Math.min(total, MAX_QUESTOES);
  return distribuir(plano.materias.filter((m) => sel.has(m.id)).map((m) => ({ id: m.id, peso: m.peso, disponiveis: n })), n);
}

/** Variáveis do prompt "simulados.gerar". */
export function varsSimuladoIa(plano: Plano, idioma: string, o: { materiaIds: number[]; total: number; tipo: "CE" | "ME" | "misto" }) {
  const cotas = cotasIa(plano, o.materiaIds, o.total);
  const materias = plano.materias.filter((m) => cotas.get(m.id));
  const assuntos = materias.map((m) => listaAssuntosPrompt(plano, { materiaId: m.id })).filter(Boolean).join("\n");
  return {
    quantidade: [...cotas.values()].reduce((a, b) => a + b, 0),
    tipo: o.tipo === "misto" ? '"CE" e "ME" misturadas' : `"${o.tipo}"`,
    banca: plano.provas.find((p) => p.banca)?.banca || "da prova",
    objetivo: plano.objetivo.nome,
    idioma: IDIOMAS.find((i) => i.valor === idioma)?.nome ?? idioma,
    distribuicao: materias.map((m) => `- ${m.nome} (materiaId ${m.slug}): ${cotas.get(m.id)} questões`).join("\n"),
    assuntos,
  };
}

/**
 * Simulado com as questões que a IA gerou: as novas entram no banco e as que já
 * existiam (mesmo enunciado) são reaproveitadas. Ordem: a da resposta da IA.
 */
export async function criarDaIa(
  perfilId: number,
  plano: Plano,
  dados: QuestoesJson,
  previa: PreviaQuestoes,
  bruto: string,
  o: { titulo: string; tempoMin: number | null },
): Promise<number | null> {
  await importarQuestoes(perfilId, previa, bruto);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const existentes = await select<{ id: number; enunciado: string }>(
    "SELECT q.id, q.enunciado FROM questoes q JOIN materias m ON m.id = q.materia_id WHERE q.perfil_id = $1 AND m.plano_id = $2",
    [perfilId, plano.id],
  );
  const porEnunciado = new Map(existentes.map((e) => [norm(e.enunciado), e.id]));
  const ids = dados.questoes
    .filter((q) => resolverRef(plano, q.materiaId, q.assuntoId))
    .map((q) => porEnunciado.get(norm(q.enunciado)))
    .filter((id): id is number => id != null);
  if (!ids.length) return null;
  return criar(perfilId, o.titulo, "ia", o.tempoMin, ids);
}

// ---------- fazer a prova ----------

const COLS = "s.id, s.perfil_id, s.titulo, s.origem, s.tempo_min, s.criado_em, s.iniciado_em, s.finalizado_em, s.duracao_seg";

export async function listarSimulados(perfilId: number): Promise<ResumoSimulado[]> {
  return select<ResumoSimulado>(
    `SELECT ${COLS}, COUNT(x.questao_id) AS total, COUNT(x.resposta) AS respondidas, COALESCE(SUM(x.acertou), 0) AS acertos
       FROM simulados s LEFT JOIN simulado_questoes x ON x.simulado_id = s.id
      WHERE s.perfil_id = $1 GROUP BY s.id ORDER BY s.criado_em DESC, s.id DESC`,
    [perfilId],
  );
}

export async function carregarSimulado(id: number): Promise<{ simulado: Simulado; itens: ItemSimulado[] } | null> {
  const simulado = await first<Simulado>(`SELECT ${COLS} FROM simulados s WHERE s.id = $1`, [id]);
  if (!simulado) return null;
  const linhas = await select<{ questao_id: number; ordem: number; resposta: string | null; acertou: number | null }>(
    "SELECT questao_id, ordem, resposta, acertou FROM simulado_questoes WHERE simulado_id = $1 ORDER BY ordem",
    [id],
  );
  const qs = new Map((await questoesPorIds(simulado.perfil_id, linhas.map((l) => l.questao_id))).map((q) => [q.id, q]));
  const itens = linhas
    .filter((l) => qs.has(l.questao_id))
    .map((l) => ({ q: qs.get(l.questao_id)!, ordem: l.ordem, resposta: l.resposta, acertou: l.acertou == null ? null : !!l.acertou }));
  return { simulado, itens };
}

/** Marca o começo da prova (para o cronômetro) no primeiro acesso. Devolve o horário de início. */
export async function iniciarSimulado(id: number): Promise<string> {
  await execute("UPDATE simulados SET iniciado_em = $1 WHERE id = $2 AND iniciado_em IS NULL", [new Date().toISOString(), id]);
  return (await first<{ iniciado_em: string }>("SELECT iniciado_em FROM simulados WHERE id = $1", [id]))!.iniciado_em;
}

/** Grava (ou apaga, com null) a resposta de uma questão. Simulado finalizado não muda. */
export async function marcarResposta(simuladoId: number, questaoId: number, resposta: string | null) {
  await execute(
    `UPDATE simulado_questoes SET resposta = $1 WHERE simulado_id = $2 AND questao_id = $3
        AND (SELECT finalizado_em FROM simulados WHERE id = $2) IS NULL`,
    [resposta, simuladoId, questaoId],
  );
}

/** Corrige, fecha o simulado e registra as respostas dadas no histórico de cada questão. */
export async function finalizarSimulado(id: number, data = hoje()) {
  const s = await first<Simulado>(`SELECT ${COLS} FROM simulados s WHERE s.id = $1`, [id]);
  if (!s || s.finalizado_em) return;
  await execute(
    `UPDATE simulado_questoes SET acertou = CASE WHEN resposta IS NULL THEN NULL
        ELSE resposta = (SELECT gabarito FROM questoes WHERE id = questao_id) END
      WHERE simulado_id = $1`,
    [id],
  );
  const fim = new Date();
  const duracao = s.iniciado_em ? Math.max(0, Math.round((fim.getTime() - new Date(s.iniciado_em).getTime()) / 1000)) : null;
  await execute("UPDATE simulados SET finalizado_em = $1, duracao_seg = $2 WHERE id = $3", [fim.toISOString(), duracao, id]);
  const dadas = await select<{ questao_id: number; resposta: string; acertou: number }>(
    "SELECT questao_id, resposta, acertou FROM simulado_questoes WHERE simulado_id = $1 AND resposta IS NOT NULL ORDER BY ordem",
    [id],
  );
  if (dadas.length)
    await insertMany("respostas", ["perfil_id", "questao_id", "resposta", "acertou", "data"], dadas.map((d) => [s.perfil_id, d.questao_id, d.resposta, d.acertou, data]));
}

/** Simulado novo com as mesmas questões, na mesma ordem, em branco. */
export async function refazerSimulado(id: number): Promise<number | null> {
  const r = await carregarSimulado(id);
  if (!r?.itens.length) return null;
  const titulo = r.simulado.titulo.replace(/ \(refeito( \d+)?\)$/, "") + " (refeito)";
  return criar(r.simulado.perfil_id, titulo, r.simulado.origem, r.simulado.tempo_min, r.itens.map((i) => i.q.id));
}

export async function excluirSimulado(id: number) {
  await execute("DELETE FROM simulados WHERE id = $1", [id]);
}

// ---------- resultado ----------

export type Placar = { total: number; acertos: number; erros: number; brancos: number; ce: { acertos: number; erros: number } };
const placarVazio = (): Placar => ({ total: 0, acertos: 0, erros: 0, brancos: 0, ce: { acertos: 0, erros: 0 } });

/** Placar geral e por matéria. Em certo/errado vale a nota líquida (cada erro anula um acerto). */
export function resultado(itens: ItemSimulado[]): { geral: Placar; porMateria: Map<number, Placar> } {
  const geral = placarVazio();
  const porMateria = new Map<number, Placar>();
  for (const i of itens) {
    const m = porMateria.get(i.q.materia_id) ?? porMateria.set(i.q.materia_id, placarVazio()).get(i.q.materia_id)!;
    const acertou = i.resposta == null ? null : (i.acertou ?? i.resposta === i.q.gabarito);
    for (const p of [geral, m]) {
      p.total++;
      if (acertou == null) p.brancos++;
      else if (acertou) p.acertos++;
      else p.erros++;
      if (i.q.tipo === "CE" && acertou != null) p.ce[acertou ? "acertos" : "erros"]++;
    }
  }
  return { geral, porMateria };
}

// ---------- backup ----------

export type SimuladoBackup = {
  titulo: string;
  origem: "banco" | "ia";
  tempo_min: number | null;
  criado_em: string;
  iniciado_em: string | null;
  finalizado_em: string | null;
  duracao_seg: number | null;
  /** questões pelo enunciado (a importação não deixa repetir enunciado no plano) */
  itens: { enunciado: string; resposta: string | null; acertou: number | null }[];
};

export async function exportarSimulados(perfilId: number): Promise<SimuladoBackup[]> {
  const ss = await select<Simulado>(`SELECT ${COLS} FROM simulados s WHERE s.perfil_id = $1 ORDER BY s.id`, [perfilId]);
  const out: SimuladoBackup[] = [];
  for (const s of ss) {
    const itens = await select<{ enunciado: string; resposta: string | null; acertou: number | null }>(
      "SELECT q.enunciado, x.resposta, x.acertou FROM simulado_questoes x JOIN questoes q ON q.id = x.questao_id WHERE x.simulado_id = $1 ORDER BY x.ordem",
      [s.id],
    );
    const { id: _, perfil_id: __, ...resto } = s;
    out.push({ ...resto, itens });
  }
  return out;
}

/** Recria os simulados ligando cada item à questão de mesmo enunciado no perfil; itens sem questão ficam de fora. */
export async function importarSimulados(perfilId: number, simulados: SimuladoBackup[]) {
  if (!simulados.length) return;
  const qs = await select<{ id: number; enunciado: string }>("SELECT id, enunciado FROM questoes WHERE perfil_id = $1", [perfilId]);
  const porEnunciado = new Map(qs.map((q) => [q.enunciado, q.id]));
  for (const s of simulados) {
    const itens = s.itens.filter((i) => porEnunciado.has(i.enunciado));
    if (!itens.length) continue;
    const r = await execute(
      `INSERT INTO simulados (perfil_id, titulo, origem, tempo_min, criado_em, iniciado_em, finalizado_em, duracao_seg)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [perfilId, s.titulo, s.origem, s.tempo_min, s.criado_em, s.iniciado_em, s.finalizado_em, s.duracao_seg],
    );
    await insertMany(
      "simulado_questoes",
      ["simulado_id", "questao_id", "ordem", "resposta", "acertou"],
      itens.map((i, k) => [r.lastInsertId, porEnunciado.get(i.enunciado), k + 1, i.resposta, i.acertou]),
      { ignorar: true },
    );
  }
}
