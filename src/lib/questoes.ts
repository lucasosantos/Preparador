import { embaralhar } from "./datas";
import { execute, insertMany, select } from "./db";
import type { QuestoesJson } from "./esquemas";
import { resolverRef, type Plano } from "./planos";

export type Questao = {
  id: number;
  materia_id: number;
  assunto_id: number | null;
  tipo: "CE" | "ME";
  enunciado: string;
  alternativas: string[] | null;
  gabarito: string;
  explicacao: string | null;
  origem: "banco" | "importada" | "manual";
  /** prova de onde a questão foi extraída, ex.: "Cebraspe 2021 – PC/SE Agente, q. 23" */
  fonte: string | null;
  /** 0 quando o gabarito foi resolvido pela IA, sem gabarito oficial */
  gabarito_oficial: number;
  /** última resposta do perfil, se houver */
  resposta: { resposta: string; acertou: boolean; data: string } | null;
};

type Linha = Omit<Questao, "alternativas" | "resposta"> & {
  alternativas: string | null;
  r_resposta: string | null;
  r_acertou: number | null;
  r_data: string | null;
};

function montar(l: Linha): Questao {
  let alternativas: string[] | null = null;
  if (l.alternativas)
    try {
      alternativas = JSON.parse(l.alternativas);
    } catch {}
  const { r_resposta, r_acertou, r_data, ...q } = l;
  return {
    ...q,
    alternativas,
    resposta: r_resposta != null ? { resposta: r_resposta, acertou: !!r_acertou, data: r_data! } : null,
  };
}

const SELECT_QUESTOES = `
  SELECT q.id, q.materia_id, q.assunto_id, q.tipo, q.enunciado, q.alternativas, q.gabarito, q.explicacao, q.origem,
         q.fonte, q.gabarito_oficial,
         r.resposta AS r_resposta, r.acertou AS r_acertou, r.data AS r_data
    FROM questoes q
    JOIN materias m ON m.id = q.materia_id
    LEFT JOIN respostas r ON r.id = (SELECT MAX(id) FROM respostas WHERE questao_id = q.id AND perfil_id = q.perfil_id)
   WHERE q.perfil_id = $1 AND m.plano_id = $2`;

export async function listarQuestoes(perfilId: number, planoId: number, filtro: { materiaId?: number | null; assuntoId?: number | null } = {}) {
  const params: unknown[] = [perfilId, planoId];
  let sql = SELECT_QUESTOES;
  if (filtro.materiaId) {
    params.push(filtro.materiaId);
    sql += ` AND q.materia_id = $${params.length}`;
  }
  if (filtro.assuntoId) {
    params.push(filtro.assuntoId);
    sql += ` AND q.assunto_id = $${params.length}`;
  }
  return (await select<Linha>(sql + " ORDER BY q.id", params)).map(montar);
}

/**
 * Questões para uma sessão: as já respondidas nesta data primeiro (para a tela
 * não mudar depois de responder), depois as inéditas, depois as antigas.
 * Prefere questões do assunto; completa com as da matéria.
 */
export function escolherQuestoes(todas: Questao[], data: string, n: number, seed: string, assuntoId: number | null) {
  const doDia = todas.filter((q) => q.resposta?.data === data);
  const resto = todas.filter((q) => q.resposta?.data !== data);
  const rank = (q: Questao) => (assuntoId && q.assunto_id === assuntoId ? 0 : 1) * 2 + (q.resposta ? 1 : 0);
  const ordenadas = embaralhar(resto, seed).sort((a, b) => rank(a) - rank(b));
  return [...doDia, ...ordenadas].slice(0, Math.max(n, doDia.length));
}

export async function responder(perfilId: number, q: Questao, resposta: string, data: string) {
  const acertou = resposta === q.gabarito;
  await execute("INSERT INTO respostas (perfil_id, questao_id, resposta, acertou, data) VALUES ($1, $2, $3, $4, $5)", [
    perfilId,
    q.id,
    resposta,
    acertou ? 1 : 0,
    data,
  ]);
  return acertou;
}

export async function removerQuestao(id: number) {
  await execute("DELETE FROM questoes WHERE id = $1", [id]);
}

export type PreviaQuestoes = {
  validas: {
    materiaId: number;
    assuntoId: number | null;
    tipo: "CE" | "ME";
    enunciado: string;
    alternativas: string[] | null;
    gabarito: string;
    explicacao: string | null;
    fonte: string | null;
    gabaritoOficial: boolean;
  }[];
  semAssunto: string[];
  duplicadas: number;
};

export async function previaQuestoes(perfilId: number, plano: Plano, dados: QuestoesJson): Promise<PreviaQuestoes> {
  const existentes = await select<{ enunciado: string }>(
    "SELECT q.enunciado FROM questoes q JOIN materias m ON m.id = q.materia_id WHERE q.perfil_id = $1 AND m.plano_id = $2",
    [perfilId, plano.id],
  );
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const vistos = new Set(existentes.map((e) => norm(e.enunciado)));
  const out: PreviaQuestoes = { validas: [], semAssunto: [], duplicadas: 0 };
  for (const q of dados.questoes) {
    const ref = resolverRef(plano, q.materiaId, q.assuntoId);
    if (!ref) {
      out.semAssunto.push(q.enunciado.slice(0, 80));
      continue;
    }
    const k = norm(q.enunciado);
    if (vistos.has(k)) {
      out.duplicadas++;
      continue;
    }
    vistos.add(k);
    out.validas.push({
      ...ref,
      tipo: q.tipo,
      enunciado: q.enunciado,
      alternativas: q.tipo === "ME" ? (q.alternativas ?? null) : null,
      gabarito: q.gabarito,
      explicacao: q.explicacao ?? null,
      fonte: q.fonte ?? null,
      gabaritoOficial: q.gabaritoOficial,
    });
  }
  return out;
}

export async function importarQuestoes(perfilId: number, previa: PreviaQuestoes, bruto: string, origem: "importada" | "banco" = "importada") {
  await execute("INSERT INTO importacoes (perfil_id, tipo, json_bruto) VALUES ($1, 'questoes', $2)", [perfilId, bruto]);
  if (!previa.validas.length) return;
  await insertMany(
    "questoes",
    ["perfil_id", "materia_id", "assunto_id", "tipo", "enunciado", "alternativas", "gabarito", "explicacao", "origem", "fonte", "gabarito_oficial"],
    previa.validas.map((q) => [
      perfilId,
      q.materiaId,
      q.assuntoId,
      q.tipo,
      q.enunciado,
      q.alternativas ? JSON.stringify(q.alternativas) : null,
      q.gabarito,
      q.explicacao,
      origem,
      q.fonte,
      q.gabaritoOficial ? 1 : 0,
    ]),
  );
}

export const LETRAS = "ABCDEF";
export function rotuloGabarito(q: Pick<Questao, "tipo" | "gabarito">) {
  return q.tipo === "CE" ? (q.gabarito === "C" ? "Certo" : "Errado") : q.gabarito;
}
