import { z } from "zod";
import { importarAulas, listarAulas, previaAulas } from "./aulas";
import { execute, insertMany, select } from "./db";
import { AulasSchema, PlanoSchema, QuestoesSchema, type PlanoJson } from "./esquemas";
import { criarPerfil } from "./perfis";
import { carregarPlano, importarPlano, salvarRevisoes, type Plano } from "./planos";
import { importarQuestoes, listarQuestoes, previaQuestoes } from "./questoes";
import demo from "./demo/pcse.json";

const DIA = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;

/** Reconstrói o JSON de plano a partir do banco (mesmo formato que a IA devolve). */
export function planoParaJson(plano: Plano): PlanoJson {
  const provaSlug = new Map(plano.provas.map((p, i) => [p.id, `prova-${i + 1}`]));
  return {
    schema: "preparador.plano/1",
    objetivo: {
      tipo: plano.objetivo.tipo,
      nome: plano.objetivo.nome,
      provas: plano.provas.map((p) => ({
        id: provaSlug.get(p.id)!,
        nome: p.nome,
        banca: p.banca,
        dataProva: p.data_prova,
        situacao: p.situacao,
        previsao: p.previsao,
        editalBase: p.edital_base,
      })),
    },
    materias: plano.materias.map((m) => ({
      id: m.slug,
      nome: m.nome,
      peso: m.peso,
      assuntos: m.assuntos.map((a) => ({ id: a.slug, nome: a.nome, detalhe: a.detalhe, prioridade: a.prioridade })),
    })),
    semana: Object.fromEntries(DIA.map((k, i) => [k, plano.semana[i].map((id) => plano.materia.get(id)!.slug)])),
    observacoes: plano.observacoes,
  };
}

const BackupSchema = z.object({
  schema: z.literal("preparador.backup/1"),
  perfil: z.object({ nome: z.string().min(1), idioma: z.string(), horas_dia: z.number() }),
  plano: z.unknown().nullable(),
  revisoes: z.array(z.number()).optional(),
  provasAssuntos: z.array(z.tuple([z.string(), z.number()])).optional(),
  aulas: z.array(z.object({ materia: z.string(), assunto: z.string().nullable(), titulo: z.string(), url: z.string(),
    canal: z.string().nullable(), duracao_min: z.number().nullable(), status_link: z.string(), assistida_em: z.string().nullable() })),
  questoes: z.array(z.object({ materia: z.string(), assunto: z.string().nullable(), tipo: z.enum(["CE", "ME"]), enunciado: z.string(),
    alternativas: z.array(z.string()).nullable(), gabarito: z.string(), explicacao: z.string().nullable(), origem: z.string(),
    fonte: z.string().nullish(), gabarito_oficial: z.number().default(1),
    respostas: z.array(z.object({ resposta: z.string(), acertou: z.number(), data: z.string() })) })),
  sessoes: z.array(z.object({ data: z.string(), slot: z.number().nullable(), materia: z.string(), assunto: z.string().nullable(),
    minutos: z.number(), estudou: z.number() })),
  conclusoes: z.array(z.object({ assunto: z.string(), data: z.string() })),
  revisoesAgendadas: z.array(z.object({ assunto: z.string(), intervalo: z.number(), data_prevista: z.string(), feita_em: z.string().nullable() })),
});

export async function exportarPerfil(perfilId: number): Promise<string> {
  const [perfil] = await select<{ nome: string; idioma: string; horas_dia: number }>(
    "SELECT nome, idioma, horas_dia FROM perfis WHERE id = $1",
    [perfilId],
  );
  const plano = await carregarPlano(perfilId);
  const ms = (id: number) => plano!.materia.get(id)?.slug ?? "";
  const as = (id: number | null) => (id == null ? null : (plano!.assunto.get(id)?.slug ?? null));
  const out: z.infer<typeof BackupSchema> = {
    schema: "preparador.backup/1",
    perfil,
    plano: plano ? planoParaJson(plano) : null,
    revisoes: plano?.revisoes,
    aulas: [],
    questoes: [],
    sessoes: [],
    conclusoes: [],
    revisoesAgendadas: [],
  };
  if (plano) {
    const provaIdx = new Map(plano.provas.map((p, i) => [p.id, i]));
    out.provasAssuntos = (
      await select<{ assunto_id: number; prova_id: number }>(
        `SELECT ap.assunto_id, ap.prova_id FROM assunto_provas ap JOIN provas p ON p.id = ap.prova_id WHERE p.objetivo_id = $1`,
        [plano.objetivo.id],
      )
    ).map((r) => [as(r.assunto_id)!, provaIdx.get(r.prova_id)!]);
    out.aulas = (await listarAulas(perfilId, plano.id)).map((a) => ({
      materia: ms(a.materia_id), assunto: as(a.assunto_id), titulo: a.titulo, url: a.url, canal: a.canal,
      duracao_min: a.duracao_min, status_link: a.status_link, assistida_em: a.assistida_em,
    }));
    const resp = await select<{ questao_id: number; resposta: string; acertou: number; data: string }>(
      "SELECT questao_id, resposta, acertou, data FROM respostas WHERE perfil_id = $1 ORDER BY id",
      [perfilId],
    );
    out.questoes = (await listarQuestoes(perfilId, plano.id)).map((q) => ({
      materia: ms(q.materia_id), assunto: as(q.assunto_id), tipo: q.tipo, enunciado: q.enunciado, alternativas: q.alternativas,
      gabarito: q.gabarito, explicacao: q.explicacao, origem: q.origem, fonte: q.fonte, gabarito_oficial: q.gabarito_oficial,
      respostas: resp.filter((r) => r.questao_id === q.id).map(({ resposta, acertou, data }) => ({ resposta, acertou, data })),
    }));
    out.sessoes = (
      await select<{ data: string; slot: number | null; materia_id: number; assunto_id: number | null; minutos: number; estudou: number }>(
        "SELECT data, slot, materia_id, assunto_id, minutos, estudou FROM sessoes WHERE perfil_id = $1 ORDER BY id",
        [perfilId],
      )
    ).map((s) => ({ data: s.data, slot: s.slot, materia: ms(s.materia_id), assunto: as(s.assunto_id), minutos: s.minutos, estudou: s.estudou }));
    out.conclusoes = (
      await select<{ assunto_id: number; data: string }>("SELECT assunto_id, data FROM conclusoes WHERE perfil_id = $1", [perfilId])
    ).map((c) => ({ assunto: as(c.assunto_id)!, data: c.data }));
    out.revisoesAgendadas = (
      await select<{ assunto_id: number; intervalo: number; data_prevista: string; feita_em: string | null }>(
        "SELECT assunto_id, intervalo, data_prevista, feita_em FROM revisoes WHERE perfil_id = $1",
        [perfilId],
      )
    ).map((r) => ({ assunto: as(r.assunto_id)!, intervalo: r.intervalo, data_prevista: r.data_prevista, feita_em: r.feita_em }));
  }
  return JSON.stringify(out);
}

/** Cria um perfil novo a partir de um backup. Devolve o id do perfil. */
export async function importarBackup(texto: string): Promise<number> {
  const b = BackupSchema.parse(JSON.parse(texto));
  const perfilId = await criarPerfil(b.perfil.nome, b.perfil.idioma, b.perfil.horas_dia);
  if (!b.plano) return perfilId;
  const planoJson = PlanoSchema.parse(b.plano);
  // reconstrói os vínculos assunto ↔ prova no formato do plano
  const provasPorAssunto = new Map<string, string[]>();
  for (const [a, i] of b.provasAssuntos ?? []) provasPorAssunto.set(a, [...(provasPorAssunto.get(a) ?? []), planoJson.objetivo.provas[i].id]);
  for (const m of planoJson.materias) for (const a of m.assuntos) if (provasPorAssunto.has(a.id)) a.provas = provasPorAssunto.get(a.id);
  await importarPlano(perfilId, planoJson, JSON.stringify(b.plano));
  const plano = (await carregarPlano(perfilId))!;
  if (b.revisoes) await salvarRevisoes(plano.id, b.revisoes);
  const mid = new Map(plano.materias.map((m) => [m.slug, m.id]));
  const aid = new Map([...plano.assunto.values()].map((a) => [a.slug, a.id]));
  const A = (s: string | null) => (s == null ? null : (aid.get(s) ?? null));

  const aulas = b.aulas.filter((a) => mid.has(a.materia));
  if (aulas.length)
    await insertMany(
      "aulas",
      ["perfil_id", "materia_id", "assunto_id", "titulo", "url", "canal", "duracao_min", "status_link", "assistida_em"],
      aulas.map((a) => [perfilId, mid.get(a.materia), A(a.assunto), a.titulo, a.url, a.canal, a.duracao_min, a.status_link, a.assistida_em]),
    );
  for (const q of b.questoes.filter((q) => mid.has(q.materia))) {
    const r = await execute(
      `INSERT INTO questoes (perfil_id, materia_id, assunto_id, tipo, enunciado, alternativas, gabarito, explicacao, origem, fonte, gabarito_oficial)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [perfilId, mid.get(q.materia), A(q.assunto), q.tipo, q.enunciado, q.alternativas ? JSON.stringify(q.alternativas) : null,
        q.gabarito, q.explicacao, q.origem, q.fonte ?? null, q.gabarito_oficial],
    );
    if (q.respostas.length)
      await insertMany("respostas", ["perfil_id", "questao_id", "resposta", "acertou", "data"],
        q.respostas.map((x) => [perfilId, r.lastInsertId, x.resposta, x.acertou, x.data]));
  }
  const sess = b.sessoes.filter((s) => mid.has(s.materia));
  if (sess.length)
    await insertMany("sessoes", ["perfil_id", "data", "slot", "materia_id", "assunto_id", "minutos", "estudou"],
      sess.map((s) => [perfilId, s.data, s.slot, mid.get(s.materia), A(s.assunto), s.minutos, s.estudou]));
  const conc = b.conclusoes.filter((c) => aid.has(c.assunto));
  if (conc.length) await insertMany("conclusoes", ["perfil_id", "assunto_id", "data"], conc.map((c) => [perfilId, aid.get(c.assunto), c.data]));
  const rev = b.revisoesAgendadas.filter((r) => aid.has(r.assunto));
  if (rev.length)
    await insertMany("revisoes", ["perfil_id", "assunto_id", "intervalo", "data_prevista", "feita_em"],
      rev.map((r) => [perfilId, aid.get(r.assunto), r.intervalo, r.data_prevista, r.feita_em]));
  return perfilId;
}

/** Perfil de exemplo com o plano da PC/SE (dados do protótipo original). */
export async function criarPerfilDemo(): Promise<number> {
  const perfilId = await criarPerfil("PC/SE Investigador (exemplo)", "pt-BR", 3);
  const plano = PlanoSchema.parse(demo.plano);
  await importarPlano(perfilId, plano, JSON.stringify(demo.plano));
  const p = (await carregarPlano(perfilId))!;
  await importarAulas(perfilId, await previaAulas(perfilId, p, AulasSchema.parse(demo.aulas)), JSON.stringify(demo.aulas));
  await importarQuestoes(perfilId, await previaQuestoes(perfilId, p, QuestoesSchema.parse(demo.questoes)), JSON.stringify(demo.questoes), "banco");
  return perfilId;
}
