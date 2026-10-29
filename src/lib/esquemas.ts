import { z } from "zod";

const id = z.string().trim().min(1).max(80);
const texto = (max: number) => z.string().trim().min(1).max(max);
const dataOuNula = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use o formato AAAA-MM-DD")
  .nullish();
const listaDia = z.array(id).default([]);

export const PlanoSchema = z
  .object({
    schema: z.literal("preparador.plano/1"),
    objetivo: z.object({
      tipo: z.enum(["edital", "constancia"]),
      nome: texto(120),
      provas: z
        .array(
          z.object({
            id,
            nome: texto(160),
            banca: z.string().trim().max(80).nullish(),
            dataProva: dataOuNula,
            situacao: z.enum(["publicado", "previsto"]).default("publicado"),
            previsao: z.string().trim().max(80).nullish(),
            editalBase: z.string().trim().max(200).nullish(),
          }),
        )
        .min(1),
    }),
    materias: z
      .array(
        z.object({
          id,
          nome: texto(120),
          peso: z.number().positive().max(10).default(1),
          origens: z.array(id).optional(),
          assuntos: z
            .array(
              z.object({
                id,
                nome: texto(200),
                detalhe: z.string().trim().max(400).nullish(),
                prioridade: z.number().int().min(1).max(3).default(2),
                provas: z.array(id).optional(),
                // só na união de perfis: "A:slug" / "B:slug" dos assuntos originais
                origens: z.array(id).optional(),
              }),
            )
            .min(1),
        }),
      )
      .min(1),
    semana: z
      .object({ dom: listaDia, seg: listaDia, ter: listaDia, qua: listaDia, qui: listaDia, sex: listaDia, sab: listaDia })
      .partial()
      .nullish(),
    observacoes: z.string().trim().max(2000).nullish(),
  })
  .superRefine((p, ctx) => {
    const materias = new Set<string>();
    const assuntos = new Set<string>();
    const provas = new Set(p.objetivo.provas.map((x) => x.id));
    p.materias.forEach((m, mi) => {
      if (materias.has(m.id))
        ctx.addIssue({ code: "custom", path: ["materias", mi, "id"], message: `id de matéria repetido: "${m.id}"` });
      materias.add(m.id);
      m.assuntos.forEach((a, ai) => {
        if (assuntos.has(a.id))
          ctx.addIssue({
            code: "custom",
            path: ["materias", mi, "assuntos", ai, "id"],
            message: `id de assunto repetido: "${a.id}" (precisa ser único no plano todo)`,
          });
        assuntos.add(a.id);
        a.provas?.forEach((pr, pi) => {
          if (!provas.has(pr))
            ctx.addIssue({
              code: "custom",
              path: ["materias", mi, "assuntos", ai, "provas", pi],
              message: `prova "${pr}" não existe em objetivo.provas`,
            });
        });
      });
    });
    for (const [dia, lista] of Object.entries(p.semana ?? {}))
      lista?.forEach((m, i) => {
        if (!materias.has(m))
          ctx.addIssue({ code: "custom", path: ["semana", dia, i], message: `matéria "${m}" não existe em materias` });
      });
  });
export type PlanoJson = z.infer<typeof PlanoSchema>;

const refAssunto = {
  materiaId: id.nullish(),
  assuntoId: id.nullish(),
};
const exigeReferencia = (x: { materiaId?: string | null; assuntoId?: string | null }) => !!(x.materiaId || x.assuntoId);

export const AulasSchema = z.object({
  schema: z.literal("preparador.aulas/1"),
  idioma: z.string().trim().max(20).nullish(),
  aulas: z
    .array(
      z
        .object({
          ...refAssunto,
          titulo: texto(200),
          url: z.string().trim().url("link inválido"),
          canal: z.string().trim().max(120).nullish(),
          duracaoMin: z.number().int().positive().max(2000).nullish(),
        })
        .refine(exigeReferencia, "informe materiaId ou assuntoId"),
    )
    .min(1),
});
export type AulasJson = z.infer<typeof AulasSchema>;

export const QuestoesSchema = z.object({
  schema: z.literal("preparador.questoes/1"),
  questoes: z
    .array(
      z
        .object({
          ...refAssunto,
          tipo: z.enum(["CE", "ME"]),
          enunciado: texto(4000),
          alternativas: z.array(texto(1000)).min(2).max(6).nullish(),
          gabarito: z.string().trim().toUpperCase(),
          explicacao: z.string().trim().max(3000).nullish(),
          // questões de provas anteriores
          fonte: z.string().trim().max(200).nullish(),
          gabaritoOficial: z.boolean().default(true),
        })
        .refine(exigeReferencia, "informe materiaId ou assuntoId")
        .superRefine((q, ctx) => {
          if (q.tipo === "CE" && q.gabarito !== "C" && q.gabarito !== "E")
            ctx.addIssue({ code: "custom", path: ["gabarito"], message: 'em CE o gabarito é "C" ou "E"' });
          if (q.tipo === "ME") {
            const n = q.alternativas?.length ?? 0;
            if (!n) ctx.addIssue({ code: "custom", path: ["alternativas"], message: "ME precisa de alternativas" });
            const idx = q.gabarito.charCodeAt(0) - 65;
            if (q.gabarito.length !== 1 || idx < 0 || idx >= n)
              ctx.addIssue({ code: "custom", path: ["gabarito"], message: `em ME o gabarito é uma letra de A a ${String.fromCharCode(64 + Math.max(n, 1))}` });
          }
        }),
    )
    .min(1),
});
export type QuestoesJson = z.infer<typeof QuestoesSchema>;

export type Resultado<T> = { ok: true; dados: T; bruto: string } | { ok: false; erros: string[] };

/** Tira cercas de código e texto ao redor do JSON, que as IAs costumam incluir. */
export function extrairJson(texto: string): string {
  const t = texto.trim();
  const cerca = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const corpo = cerca ? cerca[1].trim() : t;
  const ini = corpo.search(/[{[]/);
  if (ini < 0) return corpo;
  const fecha = corpo[ini] === "{" ? "}" : "]";
  const fim = corpo.lastIndexOf(fecha);
  return fim > ini ? corpo.slice(ini, fim + 1) : corpo.slice(ini);
}

export function validar<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, texto: string): Resultado<T> {
  if (!texto.trim()) return { ok: false, erros: ["Cole a resposta da IA no campo acima."] };
  const bruto = extrairJson(texto);
  let obj: unknown;
  try {
    obj = JSON.parse(bruto);
  } catch (e) {
    return { ok: false, erros: [`O texto não é um JSON válido: ${(e as Error).message}`] };
  }
  const r = schema.safeParse(obj);
  if (r.success) return { ok: true, dados: r.data, bruto };
  const erros = r.error.issues.slice(0, 25).map((i) => `${i.path.length ? i.path.join(".") : "(raiz)"}: ${i.message}`);
  if (r.error.issues.length > 25) erros.push(`… e mais ${r.error.issues.length - 25} erros`);
  return { ok: false, erros };
}

export function promptCorrecao(erros: string[]): string {
  return `O JSON que você me enviou não passou na validação. Erros encontrados (caminho: problema):

${erros.map((e) => `- ${e}`).join("\n")}

Corrija esses pontos e responda novamente com o JSON COMPLETO, sem nenhum texto antes ou depois e sem cercas de código.`;
}
