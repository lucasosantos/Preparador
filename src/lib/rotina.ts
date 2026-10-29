import { execute, first, select } from "./db";
import { addDays, hoje, parse } from "./datas";
import type { Assunto, Plano } from "./planos";

export type SessaoDb = {
  id: number;
  data: string;
  slot: number | null;
  materia_id: number;
  assunto_id: number | null;
  minutos: number;
  estudou: number;
};

export type Sessao = {
  slot: number;
  materiaId: number;
  assunto: Assunto | null;
  planejado: number;
  registro: SessaoDb | null;
};

export async function conclusoes(perfilId: number): Promise<Map<number, string>> {
  const r = await select<{ assunto_id: number; data: string }>("SELECT assunto_id, data FROM conclusoes WHERE perfil_id = $1", [
    perfilId,
  ]);
  return new Map(r.map((x) => [x.assunto_id, x.data]));
}

/**
 * Próximo assunto pendente da matéria. No modo constância, assuntos cobrados
 * por mais provas vêm primeiro; no modo edital, segue a ordem didática.
 */
export function proximoAssunto(plano: Plano, materiaId: number, feitos: Map<number, string>, evitar: Set<number>) {
  const m = plano.materia.get(materiaId);
  if (!m) return null;
  let pend = m.assuntos.filter((a) => !feitos.has(a.id) && !evitar.has(a.id));
  if (plano.objetivo.tipo === "constancia")
    pend = [...pend].sort((a, b) => b.nProvas - a.nProvas || b.prioridade - a.prioridade || a.ordem - b.ordem);
  return pend[0] ?? null;
}

export async function sessoesDoDia(perfilId: number, plano: Plano, data: string, horasDia: number): Promise<Sessao[]> {
  const mats = plano.semana[parse(data).getDay()];
  const regs = await select<SessaoDb>("SELECT * FROM sessoes WHERE perfil_id = $1 AND data = $2 AND slot IS NOT NULL", [
    perfilId,
    data,
  ]);
  const feitos = await conclusoes(perfilId);
  const porSlot = new Map(regs.map((r) => [r.slot!, r]));
  const planejado = Math.max(20, Math.round((horasDia * 60) / Math.max(1, mats.length) / 5) * 5);
  const usados = new Set<number>();
  // primeiro os slots que já têm assunto gravado, para não repetir assunto no mesmo dia
  for (const r of regs) if (r.assunto_id) usados.add(r.assunto_id);
  return mats.map((materiaId, slot) => {
    const reg = porSlot.get(slot) ?? null;
    let assunto: Assunto | null = null;
    if (reg && reg.materia_id === materiaId) assunto = reg.assunto_id ? (plano.assunto.get(reg.assunto_id) ?? null) : null;
    else {
      assunto = proximoAssunto(plano, materiaId, feitos, usados);
      if (assunto) usados.add(assunto.id);
    }
    return { slot, materiaId, assunto, planejado, registro: reg && reg.materia_id === materiaId ? reg : null };
  });
}

export async function registrarSessao(
  perfilId: number,
  data: string,
  s: { slot: number; materiaId: number; assuntoId: number | null },
  estudou: boolean,
  minutos: number,
) {
  const ex = await first<{ id: number }>("SELECT id FROM sessoes WHERE perfil_id = $1 AND data = $2 AND slot = $3", [
    perfilId,
    data,
    s.slot,
  ]);
  if (ex)
    await execute("UPDATE sessoes SET materia_id = $1, assunto_id = $2, minutos = $3, estudou = $4 WHERE id = $5", [
      s.materiaId,
      s.assuntoId,
      minutos,
      estudou ? 1 : 0,
      ex.id,
    ]);
  else
    await execute(
      "INSERT INTO sessoes (perfil_id, data, slot, materia_id, assunto_id, minutos, estudou) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [perfilId, data, s.slot, s.materiaId, s.assuntoId, minutos, estudou ? 1 : 0],
    );
}

export async function registrarExtra(perfilId: number, data: string, materiaId: number, assuntoId: number | null, minutos: number) {
  await execute(
    "INSERT INTO sessoes (perfil_id, data, slot, materia_id, assunto_id, minutos, estudou) VALUES ($1, $2, NULL, $3, $4, $5, 1)",
    [perfilId, data, materiaId, assuntoId, minutos],
  );
}

export function extrasDoDia(perfilId: number, data: string) {
  return select<SessaoDb>("SELECT * FROM sessoes WHERE perfil_id = $1 AND data = $2 AND slot IS NULL ORDER BY id", [perfilId, data]);
}

export async function removerSessao(id: number) {
  await execute("DELETE FROM sessoes WHERE id = $1", [id]);
}

/** Marca o assunto como concluído e agenda as revisões espaçadas. */
export async function concluirAssunto(perfilId: number, assuntoId: number, data: string, intervalos: number[]) {
  await execute(
    "INSERT INTO conclusoes (perfil_id, assunto_id, data) VALUES ($1, $2, $3) ON CONFLICT(perfil_id, assunto_id) DO UPDATE SET data = excluded.data",
    [perfilId, assuntoId, data],
  );
  await execute("DELETE FROM revisoes WHERE perfil_id = $1 AND assunto_id = $2 AND feita_em IS NULL", [perfilId, assuntoId]);
  for (const n of intervalos)
    await execute(
      `INSERT INTO revisoes (perfil_id, assunto_id, intervalo, data_prevista) VALUES ($1, $2, $3, $4)
       ON CONFLICT(perfil_id, assunto_id, intervalo) DO UPDATE SET data_prevista = excluded.data_prevista, feita_em = NULL`,
      [perfilId, assuntoId, n, addDays(data, n)],
    );
}

export async function desfazerConclusao(perfilId: number, assuntoId: number) {
  await execute("DELETE FROM conclusoes WHERE perfil_id = $1 AND assunto_id = $2", [perfilId, assuntoId]);
  await execute("DELETE FROM revisoes WHERE perfil_id = $1 AND assunto_id = $2 AND feita_em IS NULL", [perfilId, assuntoId]);
}

export type Revisao = { id: number; assunto_id: number; intervalo: number; data_prevista: string; feita_em: string | null };

/** Revisões previstas para a data; em "hoje" inclui as atrasadas ainda não feitas. */
export function revisoesDoDia(perfilId: number, data: string) {
  const hj = hoje();
  return select<Revisao>(
    `SELECT id, assunto_id, intervalo, data_prevista, feita_em FROM revisoes
      WHERE perfil_id = $1 AND (data_prevista = $2 OR feita_em = $2 OR ($2 = $3 AND data_prevista < $3 AND feita_em IS NULL))
      ORDER BY data_prevista, id`,
    [perfilId, data, hj],
  );
}

export async function marcarRevisao(id: number, feita: string | null) {
  await execute("UPDATE revisoes SET feita_em = $1 WHERE id = $2", [feita, id]);
}

export type Metricas = { sequencia: number; minutosSemana: number; concluidos: number; total: number; acertos: number; erros: number };

export async function metricas(perfilId: number, plano: Plano | null): Promise<Metricas> {
  const dias = new Set(
    (
      await select<{ data: string }>(
        `SELECT data FROM sessoes WHERE perfil_id = $1 AND estudou = 1 AND minutos > 0
         UNION SELECT feita_em FROM revisoes WHERE perfil_id = $1 AND feita_em IS NOT NULL
         UNION SELECT data FROM respostas WHERE perfil_id = $1`,
        [perfilId],
      )
    ).map((r) => r.data),
  );
  const hj = hoje();
  let seq = 0;
  let d = dias.has(hj) ? hj : addDays(hj, -1);
  while (dias.has(d)) {
    seq++;
    d = addDays(d, -1);
  }
  const segunda = addDays(hj, -((parse(hj).getDay() + 6) % 7));
  const sem = await first<{ m: number }>(
    "SELECT COALESCE(SUM(minutos), 0) AS m FROM sessoes WHERE perfil_id = $1 AND estudou = 1 AND data >= $2 AND data <= $3",
    [perfilId, segunda, hj],
  );
  const conc = await first<{ n: number }>(
    plano
      ? `SELECT COUNT(*) AS n FROM conclusoes c JOIN assuntos a ON a.id = c.assunto_id JOIN materias m ON m.id = a.materia_id
          WHERE c.perfil_id = $1 AND m.plano_id = $2`
      : "SELECT 0 AS n WHERE $1 = $2",
    [perfilId, plano?.id ?? 0],
  );
  const q = await placarQuestoes(perfilId);
  return {
    sequencia: seq,
    minutosSemana: sem?.m ?? 0,
    concluidos: conc?.n ?? 0,
    total: plano?.assunto.size ?? 0,
    acertos: q.acertos,
    erros: q.erros,
  };
}

/** Considera só a última resposta de cada questão. */
export async function placarQuestoes(perfilId: number, materiaId?: number) {
  const r = await first<{ c: number; e: number }>(
    `SELECT COALESCE(SUM(r.acertou), 0) AS c, COALESCE(SUM(1 - r.acertou), 0) AS e
       FROM respostas r JOIN questoes q ON q.id = r.questao_id
      WHERE r.perfil_id = $1 AND ($2 IS NULL OR q.materia_id = $2)
        AND r.id = (SELECT MAX(id) FROM respostas r2 WHERE r2.questao_id = r.questao_id AND r2.perfil_id = r.perfil_id)`,
    [perfilId, materiaId ?? null],
  );
  return { acertos: r?.c ?? 0, erros: r?.e ?? 0 };
}

export function historico(perfilId: number, limite = 14) {
  return select<{ data: string; minutos: number }>(
    `SELECT data, SUM(minutos) AS minutos FROM sessoes WHERE perfil_id = $1 AND estudou = 1
      GROUP BY data HAVING SUM(minutos) > 0 ORDER BY data DESC LIMIT $2`,
    [perfilId, limite],
  );
}
