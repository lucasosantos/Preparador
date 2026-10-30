// Ferramentas e prompts do servidor MCP. O lado Rust (src-tauri/src/mcp.rs) só
// transporta: cada chamada chega aqui como evento e volta por `mcp_responder`.
import { reaproveitar, resumoAcervo, sugestoesAcervo, type Sugestao } from "./acervo";
import { importarAulas, listarAulas, previaAulas } from "./aulas";
import { hoje, DIAS } from "./datas";
import { ApostilaSchema, AulaTextoSchema, AulasSchema, PlanoSchema, QuestoesSchema, validar } from "./esquemas";
import { IDIOMAS, criarPerfil, listarPerfis, type Perfil } from "./perfis";
import { carregarPlano, importarPlano, listaAssuntosPrompt, planoAtualPrompt, previaPlano, resolverRef, type Plano } from "./planos";
import { PROMPTS, leituraPdfsConstancia, listaProvasAlvo, montarPrompt, type ChavePrompt } from "./prompts";
import { importarQuestoes, listarQuestoes, previaQuestoes, responder, rotuloGabarito } from "./questoes";
import {
  concluirAssunto,
  conclusoes,
  extrasDoDia,
  historico,
  marcarRevisao,
  metricas,
  placarQuestoes,
  registrarExtra,
  registrarSessao,
  revisoesDoDia,
  sessoesDoDia,
} from "./rotina";
import {
  lerTexto,
  listarTextos,
  marcarLida,
  previaApostila,
  previaTexto,
  salvarApostila,
  salvarTexto,
  varsApostila,
  varsAulaTexto,
} from "./textos";
import { planoParaPrompt } from "./unir";

/** O que o despachante precisa saber do app (o perfil ativo) e como avisá-lo de mudanças. */
export type ContextoMcp = {
  perfilAtivo: () => number | null;
  aoMudar: (perfilId: number) => Promise<void>;
};

class ErroFerramenta extends Error {}
const falha = (msg: string): never => {
  throw new ErroFerramenta(msg);
};

type Args = Record<string, unknown>;
const texto = (a: Args, k: string) => (typeof a[k] === "string" && (a[k] as string).trim() ? (a[k] as string).trim() : undefined);
const numero = (a: Args, k: string) => (typeof a[k] === "number" ? (a[k] as number) : undefined);
const idioma = (p: Perfil) => IDIOMAS.find((i) => i.valor === p.idioma)?.nome ?? p.idioma;

async function perfilDe(a: Args, ctx: ContextoMcp): Promise<Perfil> {
  const perfis = await listarPerfis();
  const ref = a.perfil;
  if (ref == null || ref === "") {
    const ativo = perfis.find((p) => p.id === ctx.perfilAtivo());
    return ativo ?? perfis[0] ?? falha("Nenhum perfil cadastrado. Use criar_perfil.");
  }
  const p =
    perfis.find((x) => x.id === Number(ref)) ??
    perfis.find((x) => x.nome.toLowerCase() === String(ref).toLowerCase()) ??
    perfis.find((x) => x.nome.toLowerCase().includes(String(ref).toLowerCase()));
  return p ?? falha(`Perfil "${ref}" não encontrado. Perfis: ${perfis.map((x) => `${x.id} = ${x.nome}`).join("; ")}`);
}

async function planoDe(p: Perfil): Promise<Plano> {
  return (await carregarPlano(p.id)) ?? falha(`O perfil "${p.nome}" ainda não tem plano. Use importar_plano.`);
}

function refOuFalha(plano: Plano, materiaId?: string, assuntoId?: string) {
  return resolverRef(plano, materiaId, assuntoId) ?? falha(`Matéria/assunto não encontrado no plano: ${assuntoId ?? materiaId}. Veja os ids em ver_plano.`);
}

const dataArg = (a: Args) => {
  const d = texto(a, "data");
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) falha('Use a data no formato "AAAA-MM-DD".');
  return d ?? hoje();
};

/** Texto do JSON passado como objeto ou como string, validado pelo mesmo esquema da tela. */
function jsonArg<T>(a: Args, k: string, schema: Parameters<typeof validar<T>>[0]) {
  const v = a[k];
  if (v == null) falha(`Informe "${k}".`);
  const r = validar(schema, typeof v === "string" ? v : JSON.stringify(v));
  if (!r.ok) falha(`O JSON não passou na validação:\n${r.erros.map((e) => `- ${e}`).join("\n")}`);
  return r as { ok: true; dados: T; bruto: string };
}

function resumoSugestao(s: Sugestao, indice: number) {
  return {
    indice,
    destino: s.destino,
    origem: `${s.origem.materia}${s.origem.assunto ? `: ${s.origem.assunto}` : " (matéria inteira)"}`,
    planoDeOrigem: s.origem.objetivo,
    semelhanca: s.score,
    forte: s.forte,
    videos: s.aulas.map((x) => x.titulo),
    aulasTexto: s.textos.map((x) => x.titulo),
    questoes: s.questoes.length,
  };
}

const perfilProp = {
  perfil: { type: ["string", "number"], description: "Id ou nome do perfil. Omita para usar o perfil ativo no app." },
};

type Ferramenta = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  run: (a: Args, ctx: ContextoMcp) => Promise<unknown>;
};

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: { ...perfilProp, ...props },
  ...(required.length ? { required } : {}),
});

const FERRAMENTAS: Ferramenta[] = [
  {
    name: "listar_perfis",
    title: "Listar perfis",
    description: "Lista os perfis de estudo (cada um com seu objetivo e provas) e indica qual está ativo no app.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async (_a, ctx) => {
      const ativo = ctx.perfilAtivo();
      return Promise.all(
        (await listarPerfis()).map(async (p) => {
          const pl = await carregarPlano(p.id);
          return {
            id: p.id,
            nome: p.nome,
            ativo: p.id === ativo,
            idioma: p.idioma,
            horasPorDia: p.horas_dia,
            objetivo: pl ? { nome: pl.objetivo.nome, tipo: pl.objetivo.tipo } : null,
            provas: pl?.provas.map((x) => ({ nome: x.nome, banca: x.banca, situacao: x.situacao, previsao: x.previsao, dataProva: x.data_prova })) ?? [],
          };
        }),
      );
    },
  },
  {
    name: "criar_perfil",
    title: "Criar perfil",
    description: "Cria um perfil de estudo vazio. Depois, gere o plano com um dos prompts e use importar_plano.",
    inputSchema: {
      type: "object",
      properties: {
        nome: { type: "string" },
        idioma: { type: "string", enum: IDIOMAS.map((i) => i.valor), default: "pt-BR" },
        horasPorDia: { type: "number", minimum: 0.5, maximum: 16, default: 3 },
      },
      required: ["nome"],
    },
    run: async (a, ctx) => {
      const nome = texto(a, "nome") ?? falha("Informe o nome.");
      const id = await criarPerfil(nome, texto(a, "idioma") ?? "pt-BR", Math.min(16, Math.max(0.5, numero(a, "horasPorDia") ?? 3)));
      await ctx.aoMudar(id);
      return { id, nome };
    },
  },
  {
    name: "ver_plano",
    title: "Ver plano",
    description:
      "Mostra o plano do perfil: provas, matérias e assuntos (com ids e se já foram concluídos), semana-modelo e intervalos de revisão.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const plano = await planoDe(p);
      const feitos = await conclusoes(p.id);
      return {
        perfil: { id: p.id, nome: p.nome },
        objetivo: plano.objetivo,
        versao: plano.versao,
        provas: plano.provas,
        observacoes: plano.observacoes,
        revisoesEmDias: plano.revisoes,
        semana: Object.fromEntries(DIAS.map((d, i) => [d, plano.semana[i].map((id) => plano.materia.get(id)!.slug)])),
        materias: plano.materias.map((m) => ({
          id: m.slug,
          nome: m.nome,
          peso: m.peso,
          assuntos: m.assuntos.map((x) => ({
            id: x.slug,
            nome: x.nome,
            detalhe: x.detalhe,
            prioridade: x.prioridade,
            concluidoEm: feitos.get(x.id) ?? null,
          })),
        })),
      };
    },
  },
  {
    name: "importar_plano",
    title: "Importar plano",
    description:
      'Salva um plano no formato "preparador.plano/1" (o mesmo JSON que os prompts de plano pedem). Chame primeiro com confirmar=false: a resposta traz a prévia do que muda, inclusive progresso que seria apagado. Mostre ao usuário e só chame com confirmar=true depois que ele aprovar. Reaproveite os ids do plano atual (ver_plano) para manter o progresso.',
    inputSchema: obj(
      {
        plano: { type: ["object", "string"], description: 'JSON no formato "preparador.plano/1".' },
        confirmar: { type: "boolean", default: false },
      },
      ["plano"],
    ),
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const { dados, bruto } = jsonArg(a, "plano", PlanoSchema);
      if (a.confirmar !== true)
        return {
          confirmado: false,
          previa: await previaPlano(p.id, dados),
          proximoPasso: "Mostre esta prévia ao usuário. Se ele aprovar, chame importar_plano de novo com confirmar=true.",
        };
      await importarPlano(p.id, dados, bruto);
      await ctx.aoMudar(p.id);
      const doAcervo = await sugestoesAcervo(p.id, await planoDe(p));
      return {
        confirmado: true,
        mensagem: `Plano salvo no perfil "${p.nome}".`,
        acervo: doAcervo.length
          ? `O acervo tem conteúdo de planos anteriores para ${doAcervo.length} tema(s) deste plano. Use buscar_no_acervo para mostrar ao usuário e reaproveitar_do_acervo para copiar.`
          : null,
      };
    },
  },
  {
    name: "importar_aulas",
    title: "Importar aulas",
    description:
      'Adiciona aulas do YouTube no formato "preparador.aulas/1", ligadas aos assuntos do plano pelos ids. Ignora repetidas, links que não são do YouTube e ids desconhecidos. Só use links encontrados em busca real.',
    inputSchema: obj({ aulas: { type: ["object", "string"], description: 'JSON no formato "preparador.aulas/1".' } }, ["aulas"]),
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const plano = await planoDe(p);
      const { dados, bruto } = jsonArg(a, "aulas", AulasSchema);
      const previa = await previaAulas(p.id, plano, dados);
      await importarAulas(p.id, previa, bruto);
      await ctx.aoMudar(p.id);
      return { adicionadas: previa.validas.length, repetidas: previa.duplicadas, idsDesconhecidos: previa.semAssunto, naoYoutube: previa.naoYoutube };
    },
  },
  {
    name: "salvar_aula_texto",
    title: "Salvar aula em texto",
    description:
      'Salva na biblioteca uma aula em texto no formato "preparador.aulaTexto/1", ligada a um assunto do plano. Use para assuntos sem videoaula boa. Exige ao menos uma fonte em "fontes".',
    inputSchema: obj({ aula: { type: ["object", "string"], description: 'JSON no formato "preparador.aulaTexto/1".' } }, ["aula"]),
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const plano = await planoDe(p);
      const { dados } = jsonArg(a, "aula", AulaTextoSchema);
      const r = previaTexto(plano, dados);
      if (!r.ok) return falha(`${r.erro} Veja os ids em ver_plano.`);
      const id = await salvarTexto(p.id, { materiaId: r.materiaId, assuntoId: r.assuntoId }, dados);
      await ctx.aoMudar(p.id);
      return { id, titulo: dados.titulo, assunto: r.assunto };
    },
  },
  {
    name: "importar_apostila",
    title: "Importar aulas de apostila",
    description:
      'Salva na biblioteca as aulas em texto tiradas de uma apostila em PDF, no formato "preparador.apostila/1": uma aula por assunto do plano, com a apostila como primeira fonte. Ignora ids desconhecidos e aulas já salvas da mesma apostila.',
    inputSchema: obj({ apostila: { type: ["object", "string"], description: 'JSON no formato "preparador.apostila/1".' } }, ["apostila"]),
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const plano = await planoDe(p);
      const { dados } = jsonArg(a, "apostila", ApostilaSchema);
      const previa = await previaApostila(p.id, plano, dados);
      await salvarApostila(p.id, previa);
      await ctx.aoMudar(p.id);
      return {
        salvas: previa.validas.map((v) => ({ titulo: v.aula.titulo, assunto: v.assunto })),
        repetidas: previa.repetidas,
        idsDesconhecidos: previa.semAssunto,
        foraDoPlano: previa.foraDoPlano,
      };
    },
  },
  {
    name: "listar_aulas_texto",
    title: "Listar aulas em texto",
    description:
      "Lista as aulas em texto da biblioteca (geradas pela IA ou tiradas de apostilas), com id, assunto, apostila de origem e se já foram lidas. Use ler_aula_texto para abrir o conteúdo.",
    inputSchema: obj({ materia: { type: "string", description: "Id da matéria" }, assunto: { type: "string", description: "Id do assunto" } }),
    annotations: { readOnlyHint: true },
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const plano = await planoDe(p);
      const r = texto(a, "materia") || texto(a, "assunto") ? refOuFalha(plano, texto(a, "materia"), texto(a, "assunto")) : null;
      return (await listarTextos(p.id, plano))
        .filter((t) => !r || (r.assuntoId ? t.assuntoId === r.assuntoId : t.materiaId === r.materiaId))
        .map((t) => ({
          id: t.id,
          titulo: t.titulo,
          materia: plano.materia.get(t.materiaId)!.slug,
          assunto: plano.assunto.get(t.assuntoId)!.slug,
          assuntoNome: plano.assunto.get(t.assuntoId)!.nome,
          apostila: t.apostila ?? null,
          criadaEm: t.criadaEm,
          lidaEm: t.lidaEm,
        }));
    },
  },
  {
    name: "ler_aula_texto",
    title: "Ler aula em texto",
    description: "Devolve o conteúdo completo de uma aula em texto da biblioteca: resumo, seções, pontos de prova e fontes.",
    inputSchema: obj({ id: { type: "string", description: "Id da aula (de listar_aulas_texto ou plano_do_dia)" } }, ["id"]),
    annotations: { readOnlyHint: true },
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const r = await lerTexto(texto(a, "id") ?? falha("Informe o id."));
      if (!r || r.item.perfilId !== p.id) return falha(`Aula "${texto(a, "id")}" não encontrada no perfil "${p.nome}". Veja os ids em listar_aulas_texto.`);
      const { schema: _s, ...aula } = r.aula;
      return { id: r.item.id, criadaEm: r.item.criadaEm, lidaEm: r.item.lidaEm, ...aula };
    },
  },
  {
    name: "marcar_aula_texto_lida",
    title: "Marcar aula em texto como lida",
    description: "Marca (ou desmarca, com lida=false) uma aula em texto como lida.",
    inputSchema: obj(
      { id: { type: "string" }, lida: { type: "boolean", default: true }, data: { type: "string", description: "AAAA-MM-DD; padrão: hoje." } },
      ["id"],
    ),
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const id = texto(a, "id") ?? falha("Informe o id.");
      const r = await lerTexto(id);
      if (!r || r.item.perfilId !== p.id) return falha(`Aula "${id}" não encontrada no perfil "${p.nome}".`);
      const lidaEm = a.lida === false ? null : dataArg(a);
      await marcarLida(id, lidaEm);
      await ctx.aoMudar(p.id);
      return { id, titulo: r.item.titulo, lidaEm };
    },
  },
  {
    name: "buscar_no_acervo",
    title: "Buscar no acervo",
    description:
      'Procura no acervo (aulas, questões e aulas em texto de todos os planos que já passaram pelo app, inclusive de perfis excluídos) o que serve para o plano do perfil e ainda não está nele. Cada sugestão liga um tema antigo a um assunto do plano, com a semelhança de 0 a 1; "forte" = muito parecido. Devolve o índice de cada sugestão para usar em reaproveitar_do_acervo.',
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const plano = await planoDe(p);
      const sug = await sugestoesAcervo(p.id, plano);
      return {
        acervo: await resumoAcervo(),
        sugestoes: sug.map((s, indice) => resumoSugestao(s, indice)),
      };
    },
  },
  {
    name: "reaproveitar_do_acervo",
    title: "Reaproveitar do acervo",
    description:
      'Copia para o plano do perfil o conteúdo do acervo sugerido por buscar_no_acervo. Sem "indices", copia só as sugestões fortes. Mostre as sugestões fracas ao usuário antes de incluí-las.',
    inputSchema: obj({
      indices: { type: "array", items: { type: "integer" }, description: "Índices das sugestões de buscar_no_acervo" },
    }),
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const plano = await planoDe(p);
      const sug = await sugestoesAcervo(p.id, plano);
      const indices = Array.isArray(a.indices) ? (a.indices as unknown[]).map(Number) : null;
      const fora = indices?.filter((i) => !sug[i]) ?? [];
      if (fora.length) falha(`Índices inexistentes: ${fora.join(", ")}. Chame buscar_no_acervo de novo; a lista muda depois de cada cópia.`);
      const escolhidas = indices ? indices.map((i) => sug[i]) : sug.filter((s) => s.forte);
      const r = await reaproveitar(p.id, escolhidas);
      await ctx.aoMudar(p.id);
      return { copiado: r, temas: escolhidas.map((s) => s.destino) };
    },
  },
  {
    name: "importar_questoes",
    title: "Importar questões",
    description:
      'Adiciona questões no formato "preparador.questoes/1" (geradas ou extraídas de provas anteriores, com "fonte"). Ignora repetidas e ids desconhecidos.',
    inputSchema: obj({ questoes: { type: ["object", "string"], description: 'JSON no formato "preparador.questoes/1".' } }, ["questoes"]),
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const plano = await planoDe(p);
      const { dados, bruto } = jsonArg(a, "questoes", QuestoesSchema);
      const previa = await previaQuestoes(p.id, plano, dados);
      await importarQuestoes(p.id, previa, bruto);
      await ctx.aoMudar(p.id);
      return { adicionadas: previa.validas.length, repetidas: previa.duplicadas, idsDesconhecidos: previa.semAssunto.length };
    },
  },
  {
    name: "plano_do_dia",
    title: "Plano do dia",
    description:
      "Sessões de estudo do dia (matéria, assunto, minutos planejados, se já estudou), revisões programadas e aulas de cada sessão: vídeos e aulas em texto (abra com ler_aula_texto).",
    inputSchema: obj({ data: { type: "string", description: "AAAA-MM-DD; padrão: hoje." } }),
    annotations: { readOnlyHint: true },
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const plano = await planoDe(p);
      const data = dataArg(a);
      const [sess, revs, aulas, extras, feitos, textos] = await Promise.all([
        sessoesDoDia(p.id, plano, data, p.horas_dia),
        revisoesDoDia(p.id, data),
        listarAulas(p.id, plano.id),
        extrasDoDia(p.id, data),
        conclusoes(p.id),
        listarTextos(p.id, plano),
      ]);
      const slug = (id: number | null) => (id == null ? null : (plano.assunto.get(id)?.slug ?? null));
      return {
        data,
        diaDaSemana: DIAS[new Date(`${data}T12:00`).getDay()],
        sessoes: sess.map((s) => ({
          materia: plano.materia.get(s.materiaId)!.slug,
          materiaNome: plano.materia.get(s.materiaId)!.nome,
          assunto: s.assunto?.slug ?? null,
          assuntoNome: s.assunto?.nome ?? "todos concluídos: revisão geral",
          minutosPlanejados: s.planejado,
          estudou: !!s.registro?.estudou,
          minutos: s.registro?.minutos ?? 0,
          concluido: !!(s.assunto && feitos.has(s.assunto.id)),
          aulas: aulas
            .filter((x) => x.materia_id === s.materiaId && (x.assunto_id == null || x.assunto_id === s.assunto?.id))
            .map((x) => ({ titulo: x.titulo, url: x.url, assistida: !!x.assistida_em, linkQuebrado: x.status_link === "quebrado" })),
          aulasTexto: textos
            .filter((t) => t.assuntoId === s.assunto?.id)
            .map((t) => ({ id: t.id, titulo: t.titulo, apostila: t.apostila ?? null, lida: !!t.lidaEm })),
        })),
        diaDeSimulado: sess.length === 0,
        revisoes: revs.map((r) => ({
          assunto: slug(r.assunto_id),
          assuntoNome: plano.assunto.get(r.assunto_id)?.nome,
          intervaloDias: r.intervalo,
          prevista: r.data_prevista,
          feita: !!r.feita_em,
        })),
        estudoForaDoPlano: extras.map((e) => ({ materia: plano.materia.get(e.materia_id)?.slug, assunto: slug(e.assunto_id), minutos: e.minutos })),
      };
    },
  },
  {
    name: "registrar_estudo",
    title: "Registrar estudo",
    description:
      "Registra minutos estudados numa matéria/assunto. Se a matéria está no plano do dia, marca a sessão; senão, conta como estudo fora do plano. Com concluiu=true marca o assunto como concluído e agenda as revisões.",
    inputSchema: obj(
      {
        materia: { type: "string", description: "Id da matéria (ex.: penal)." },
        assunto: { type: "string", description: "Id do assunto (ex.: penal-03)." },
        minutos: { type: "number", minimum: 0, maximum: 600 },
        concluiu: { type: "boolean", default: false },
        data: { type: "string", description: "AAAA-MM-DD; padrão: hoje." },
      },
      ["minutos"],
    ),
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const plano = await planoDe(p);
      const ref = refOuFalha(plano, texto(a, "materia"), texto(a, "assunto"));
      const data = dataArg(a);
      const minutos = Math.max(0, Math.round(numero(a, "minutos") ?? 0));
      const sess = await sessoesDoDia(p.id, plano, data, p.horas_dia);
      const slot = sess.find((s) => s.materiaId === ref.materiaId && (!ref.assuntoId || !s.assunto || s.assunto.id === ref.assuntoId));
      if (slot) await registrarSessao(p.id, data, { slot: slot.slot, materiaId: ref.materiaId, assuntoId: ref.assuntoId ?? slot.assunto?.id ?? null }, true, minutos);
      else await registrarExtra(p.id, data, ref.materiaId, ref.assuntoId, minutos);
      const assunto = ref.assuntoId ?? slot?.assunto?.id ?? null;
      if (a.concluiu === true) {
        if (!assunto) falha("Para concluir, informe o assunto.");
        await concluirAssunto(p.id, assunto!, data, plano.revisoes);
      }
      await ctx.aoMudar(p.id);
      return {
        registrado: slot ? "sessão do plano" : "estudo fora do plano",
        minutos,
        concluido: a.concluiu === true ? plano.assunto.get(assunto!)?.nome : null,
        revisoesAgendadas: a.concluiu === true ? plano.revisoes.map((n) => `${n} dia(s)`) : [],
      };
    },
  },
  {
    name: "marcar_revisao",
    title: "Marcar revisão feita",
    description: "Marca como feitas as revisões pendentes de um assunto até a data.",
    inputSchema: obj({ assunto: { type: "string" }, data: { type: "string", description: "AAAA-MM-DD; padrão: hoje." } }, ["assunto"]),
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const plano = await planoDe(p);
      const ref = refOuFalha(plano, undefined, texto(a, "assunto"));
      const data = dataArg(a);
      const pend = (await revisoesDoDia(p.id, data)).filter((r) => r.assunto_id === ref.assuntoId && !r.feita_em);
      for (const r of pend) await marcarRevisao(r.id, data);
      await ctx.aoMudar(p.id);
      return { marcadas: pend.length };
    },
  },
  {
    name: "ver_progresso",
    title: "Ver progresso",
    description: "Métricas do perfil: sequência de dias, horas na semana, assuntos concluídos por matéria, acertos nas questões e histórico recente.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const plano = await planoDe(p);
      const feitos = await conclusoes(p.id);
      return {
        geral: await metricas(p.id, plano),
        porMateria: await Promise.all(
          plano.materias.map(async (m) => {
            const q = await placarQuestoes(p.id, m.id);
            return {
              materia: m.slug,
              nome: m.nome,
              concluidos: m.assuntos.filter((x) => feitos.has(x.id)).length,
              total: m.assuntos.length,
              acertos: q.acertos,
              erros: q.erros,
            };
          }),
        ),
        ultimosDias: await historico(p.id),
      };
    },
  },
  {
    name: "listar_questoes",
    title: "Listar questões",
    description:
      "Questões do banco do perfil para praticar, SEM o gabarito. Faça a pergunta ao usuário e use responder_questao com a resposta dele.",
    inputSchema: obj({
      materia: { type: "string" },
      assunto: { type: "string" },
      situacao: { type: "string", enum: ["novas", "erradas", "todas"], default: "novas" },
      limite: { type: "number", minimum: 1, maximum: 50, default: 5 },
    }),
    annotations: { readOnlyHint: true },
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const plano = await planoDe(p);
      const m = texto(a, "materia") || texto(a, "assunto") ? refOuFalha(plano, texto(a, "materia"), texto(a, "assunto")) : null;
      const sit = texto(a, "situacao") ?? "novas";
      const todas = await listarQuestoes(p.id, plano.id, { materiaId: m?.materiaId, assuntoId: m?.assuntoId });
      return todas
        .filter((q) => (sit === "novas" ? !q.resposta : sit === "erradas" ? q.resposta && !q.resposta.acertou : true))
        .slice(0, Math.min(50, numero(a, "limite") ?? 5))
        .map((q) => ({
          id: q.id,
          tipo: q.tipo === "CE" ? "certo ou errado (responda C ou E)" : "múltipla escolha (responda a letra)",
          materia: plano.materia.get(q.materia_id)?.nome,
          assunto: q.assunto_id ? plano.assunto.get(q.assunto_id)?.nome : null,
          fonte: q.fonte,
          enunciado: q.enunciado,
          alternativas: q.alternativas?.map((x, i) => `${"ABCDEF"[i]}) ${x}`) ?? null,
        }));
    },
  },
  {
    name: "responder_questao",
    title: "Responder questão",
    description: "Registra a resposta do usuário a uma questão e devolve se acertou, o gabarito e a explicação.",
    inputSchema: obj({ questaoId: { type: "number" }, resposta: { type: "string", description: '"C"/"E" ou a letra da alternativa.' } }, ["questaoId", "resposta"]),
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const plano = await planoDe(p);
      const q = (await listarQuestoes(p.id, plano.id)).find((x) => x.id === numero(a, "questaoId")) ?? falha("Questão não encontrada neste perfil.");
      const resposta = (texto(a, "resposta") ?? falha("Informe a resposta.")).toUpperCase().slice(0, 1);
      const acertou = await responder(p.id, q, resposta, hoje());
      await ctx.aoMudar(p.id);
      return { acertou, gabarito: rotuloGabarito(q), gabaritoOficial: !!q.gabarito_oficial, explicacao: q.explicacao };
    },
  },
  {
    name: "assuntos_sem_aula",
    title: "Assuntos sem aula",
    description:
      'Lista os assuntos que ainda não têm videoaula cadastrada, com ids, para buscar aulas no YouTube e depois usar importar_aulas. "temAulaTexto" indica os que já têm aula em texto na biblioteca; para os demais sem vídeo bom, use o prompt aulas.texto.',
    inputSchema: obj({ materia: { type: "string" } }),
    annotations: { readOnlyHint: true },
    run: async (a, ctx) => {
      const p = await perfilDe(a, ctx);
      const plano = await planoDe(p);
      const com = new Set((await listarAulas(p.id, plano.id)).map((x) => x.assunto_id));
      const comTexto = new Set((await listarTextos(p.id, plano)).map((t) => t.assuntoId));
      const m = texto(a, "materia") ? refOuFalha(plano, texto(a, "materia")) : null;
      return {
        idioma: idioma(p),
        assuntos: [...plano.assunto.values()]
          .filter((x) => !com.has(x.id) && (!m || x.materia_id === m.materiaId))
          .map((x) => ({
            materia: plano.materia.get(x.materia_id)!.slug,
            assunto: x.slug,
            nome: `${plano.materia.get(x.materia_id)!.nome}: ${x.nome}`,
            temAulaTexto: comTexto.has(x.id),
          })),
      };
    },
  },
  {
    name: "obter_prompt",
    title: "Obter prompt",
    description:
      "Devolve um dos prompts do Preparador já preenchido com os dados do perfil (o mesmo da tela Importar). Útil em clientes sem suporte a prompts MCP.",
    inputSchema: obj(
      {
        chave: { type: "string", enum: Object.keys(PROMPTS) },
        argumentos: { type: "object", description: "Argumentos do prompt (veja prompts/list)." },
      },
      ["chave"],
    ),
    annotations: { readOnlyHint: true },
    run: async (a, ctx) => {
      const chave = (texto(a, "chave") ?? falha("Informe a chave.")) as ChavePrompt;
      if (!(chave in PROMPTS)) falha(`Prompt desconhecido. Opções: ${Object.keys(PROMPTS).join(", ")}`);
      return { prompt: await promptMcp(chave, { ...((a.argumentos as Args) ?? {}), perfil: a.perfil }, ctx) };
    },
  },
];

// ---------- prompts ----------

type ArgPrompt = { name: string; description: string; required?: boolean };

/** Argumentos que o usuário informa; o resto (plano atual, assuntos, idioma, horas) sai do perfil. */
const ARGS_PROMPT: Partial<Record<ChavePrompt, ArgPrompt[]>> = {
  "plano.edital": [
    { name: "cargo", description: "Prova e cargo", required: true },
    { name: "banca", description: "Banca" },
    { name: "dataProva", description: "Data da prova (AAAA-MM-DD)" },
    { name: "observacoes", description: "Observações para a IA" },
  ],
  "plano.preedital": [
    { name: "cargo", description: "Prova e cargo pretendidos", required: true },
    { name: "banca", description: "Banca provável" },
    { name: "previsao", description: "Previsão do edital, ex.: 1º semestre de 2027" },
    { name: "editalBase", description: "Edital usado como base, ex.: PC/SE 2021 – Agente" },
    { name: "parecido", description: '"sim" se o edital-base é de um cargo parecido' },
    { name: "observacoes", description: "Observações para a IA" },
  ],
  "plano.constancia": [
    { name: "provas", description: 'Uma prova por linha; para indicar o PDF anexado: "Prova | edital do PDF"', required: true },
    { name: "observacoes", description: "Observações para a IA" },
  ],
  "perfis.unir": [
    { name: "perfilA", description: "Id ou nome do primeiro perfil", required: true },
    { name: "perfilB", description: "Id ou nome do segundo perfil", required: true },
    { name: "observacoes", description: "Observações para a IA" },
  ],
  "aulas.youtube": [
    { name: "materia", description: "Id da matéria (vazio = todas sem aula)" },
    { name: "porAssunto", description: "Aulas por assunto (1 a 3)" },
  ],
  "aulas.texto": [
    { name: "assunto", description: "Id do assunto da aula", required: true },
    { name: "observacoes", description: "Observações para a IA" },
  ],
  "aulas.apostila": [
    { name: "apostila", description: "Nome da apostila do PDF anexado", required: true },
    { name: "materia", description: "Id da matéria (vazio = todas)" },
    { name: "observacoes", description: "Observações para a IA" },
  ],
  "questoes.gerar": [
    { name: "materia", description: "Id da matéria" },
    { name: "assunto", description: "Id do assunto" },
    { name: "quantidade", description: "Quantidade (padrão 10)" },
    { name: "tipo", description: "CE, ME ou misto" },
  ],
  "questoes.extrair": [
    { name: "prova", description: "Prova do PDF anexado, ex.: Cebraspe 2021 – PC/SE Agente", required: true },
    { name: "semGabarito", description: '"sim" se não houver gabarito oficial anexado' },
    { name: "materia", description: "Id da matéria (vazio = todas)" },
  ],
};

/** O que fazer com o resultado quando o prompt é usado por um agente conectado. */
const MODO_AGENTE: Partial<Record<ChavePrompt, string>> = {
  "plano.edital": "importar_plano (primeiro com confirmar=false; mostre a prévia e só confirme com a minha aprovação)",
  "plano.preedital": "importar_plano (primeiro com confirmar=false; mostre a prévia e só confirme com a minha aprovação)",
  "plano.constancia": "importar_plano (primeiro com confirmar=false; mostre a prévia e só confirme com a minha aprovação)",
  "aulas.youtube": "importar_aulas",
  "aulas.texto": "salvar_aula_texto",
  "aulas.apostila": "importar_apostila (uma chamada por parte de até 8 aulas)",
  "questoes.gerar": "importar_questoes",
  "questoes.extrair": "importar_questoes (uma chamada por parte de até 40 questões)",
};

const complemento = (a: Args) => (texto(a, "observacoes") ? `\nObservações minhas (leve em conta):\n${texto(a, "observacoes")}\n` : "");

async function promptMcp(chave: ChavePrompt, a: Args, ctx: ContextoMcp): Promise<string> {
  const temPerfil = (await listarPerfis()).length > 0;
  const p = temPerfil && chave !== "perfis.unir" ? await perfilDe(a, ctx) : null;
  const plano = p ? await carregarPlano(p.id) : null;
  const base = {
    horas: p?.horas_dia ?? 3,
    dias: DIAS.slice(1).join(", "),
    idioma: p ? idioma(p) : "Português (Brasil)",
    complemento: complemento(a),
    planoAtual: planoAtualPrompt(plano),
  };
  let vars: Record<string, string | number | null | undefined>;
  switch (chave) {
    case "plano.edital":
      vars = { ...base, tipo: "edital", situacao: "publicado", cargo: texto(a, "cargo"), banca: texto(a, "banca"), dataProva: texto(a, "dataProva") };
      break;
    case "plano.preedital":
      vars = {
        ...base,
        tipo: "edital",
        situacao: "previsto",
        cargo: texto(a, "cargo"),
        banca: texto(a, "banca"),
        previsao: texto(a, "previsao"),
        editalBase: texto(a, "editalBase"),
        tipoBase: /^s/i.test(texto(a, "parecido") ?? "") ? "edital de um cargo parecido" : "edital anterior do mesmo cargo",
      };
      break;
    case "plano.constancia": {
      const provas = (texto(a, "provas") ?? "").split("\n").map((l) => {
        const [nome, pdf] = l.split("|");
        return { nome: nome?.trim() ?? "", pdf: pdf?.trim() ?? "" };
      });
      vars = { ...base, tipo: "constancia", situacao: "publicado ou previsto", provas: listaProvasAlvo(provas), leituraPdfs: leituraPdfsConstancia(provas) };
      break;
    }
    case "perfis.unir": {
      const pa = await perfilDe({ perfil: a.perfilA ?? falha("Informe perfilA.") }, ctx);
      const pb = await perfilDe({ perfil: a.perfilB ?? falha("Informe perfilB.") }, ctx);
      vars = {
        ...base,
        idioma: idioma(pa),
        horas: pa.horas_dia,
        tipo: "constancia",
        situacao: "publicado ou previsto",
        planoA: planoParaPrompt("A", await planoDe(pa)),
        planoB: planoParaPrompt("B", await planoDe(pb)),
      };
      break;
    }
    case "aulas.youtube": {
      const pl = plano ?? falha("O perfil ainda não tem plano.");
      const com = new Set((await listarAulas(p!.id, pl.id)).map((x) => x.assunto_id));
      const m = texto(a, "materia") ? refOuFalha(pl, texto(a, "materia")) : null;
      vars = {
        ...base,
        objetivo: pl.objetivo.nome,
        banca: pl.provas[0]?.banca,
        porAssunto: Math.min(3, Math.max(1, Number(texto(a, "porAssunto") ?? 2) || 2)),
        assuntos: listaAssuntosPrompt(pl, { materiaId: m?.materiaId, assuntoIds: [...pl.assunto.keys()].filter((id) => !com.has(id)) }),
      };
      break;
    }
    case "aulas.texto": {
      const pl = plano ?? falha("O perfil ainda não tem plano.");
      const r = refOuFalha(pl, undefined, texto(a, "assunto") ?? falha("Informe o assunto."));
      vars = varsAulaTexto(p!, pl, r.assuntoId ?? falha("Informe o id de um assunto, não de uma matéria."), texto(a, "observacoes"));
      break;
    }
    case "aulas.apostila": {
      const pl = plano ?? falha("O perfil ainda não tem plano.");
      const r = texto(a, "materia") ? refOuFalha(pl, texto(a, "materia")) : null;
      vars = varsApostila(p!, pl, texto(a, "apostila") ?? falha("Informe o nome da apostila."), r?.materiaId, texto(a, "observacoes"));
      break;
    }
    case "aulas.substituto":
      falha("Use aulas.youtube; o substituto é pedido pela tela Aulas.");
      return "";
    case "questoes.gerar": {
      const pl = plano ?? falha("O perfil ainda não tem plano.");
      const r = texto(a, "materia") || texto(a, "assunto") ? refOuFalha(pl, texto(a, "materia"), texto(a, "assunto")) : null;
      const tipo = (texto(a, "tipo") ?? "CE").toUpperCase();
      vars = {
        ...base,
        quantidade: Number(texto(a, "quantidade") ?? 10) || 10,
        tipo: tipo === "MISTO" ? '"CE" e "ME" misturadas' : `"${tipo === "ME" ? "ME" : "CE"}"`,
        banca: pl.provas[0]?.banca || "da prova",
        objetivo: pl.objetivo.nome,
        assuntos: listaAssuntosPrompt(pl, r?.assuntoId ? { assuntoIds: [r.assuntoId] } : r ? { materiaId: r.materiaId } : undefined),
      };
      break;
    }
    case "questoes.extrair": {
      const pl = plano ?? falha("O perfil ainda não tem plano.");
      const r = texto(a, "materia") ? refOuFalha(pl, texto(a, "materia")) : null;
      vars = {
        ...base,
        prova: texto(a, "prova"),
        gabarito: /^s/i.test(texto(a, "semGabarito") ?? "")
          ? 'NÃO tenho o gabarito oficial: resolva cada questão você mesmo, com cuidado, e marque "gabaritoOficial": false.'
          : "Anexei também o GABARITO OFICIAL (se houver preliminar e definitivo, use o definitivo).",
        materias: r ? `de ${pl.materia.get(r.materiaId)!.nome} (ignore as outras matérias)` : "de todas as matérias",
        assuntos: listaAssuntosPrompt(pl, r ? { materiaId: r.materiaId } : undefined),
      };
      break;
    }
  }
  let t = await montarPrompt(chave, vars);
  const destino = MODO_AGENTE[chave];
  if (destino)
    t += `\n\n---\nVocê está conectado ao Preparador por MCP${p ? ` (perfil "${p.nome}")` : ""}. Em vez de me devolver o JSON, envie-o direto pela ferramenta ${destino}. Se alguma validação falhar, corrija e envie de novo.`;
  else if (chave === "perfis.unir")
    t +=
      "\n\n---\nVocê está conectado ao Preparador por MCP. A união de perfis é concluída na tela Perfis → Unir dois perfis: me devolva o JSON para eu colar lá.";
  return t;
}

// ---------- despacho JSON-RPC ----------

export type RespostaMcp = { resultado: unknown } | { erro: { code: number; message: string } };

export async function despachar(metodo: string, params: Args, ctx: ContextoMcp): Promise<RespostaMcp> {
  try {
    switch (metodo) {
      case "tools/list":
        return {
          resultado: {
            tools: FERRAMENTAS.map(({ run: _r, ...t }) => t),
          },
        };
      case "tools/call": {
        const f = FERRAMENTAS.find((x) => x.name === params.name);
        if (!f) return { erro: { code: -32602, message: `Ferramenta desconhecida: ${params.name}` } };
        try {
          const r = await f.run((params.arguments as Args) ?? {}, ctx);
          return { resultado: { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] } };
        } catch (e) {
          return { resultado: { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true } };
        }
      }
      case "prompts/list":
        return {
          resultado: {
            prompts: (Object.keys(ARGS_PROMPT) as ChavePrompt[]).map((k) => ({
              name: k,
              title: PROMPTS[k].nome,
              description: PROMPTS[k].descricao,
              arguments: [...ARGS_PROMPT[k]!, ...(k === "perfis.unir" ? [] : [{ name: "perfil", description: "Id ou nome do perfil (padrão: o ativo)" }])],
            })),
          },
        };
      case "prompts/get": {
        const k = params.name as ChavePrompt;
        if (!ARGS_PROMPT[k]) return { erro: { code: -32602, message: `Prompt desconhecido: ${k}` } };
        const t = await promptMcp(k, (params.arguments as Args) ?? {}, ctx);
        return { resultado: { description: PROMPTS[k].nome, messages: [{ role: "user", content: { type: "text", text: t } }] } };
      }
    }
    return { erro: { code: -32601, message: `Método não suportado: ${metodo}` } };
  } catch (e) {
    return { erro: { code: -32603, message: e instanceof Error ? e.message : String(e) } };
  }
}

/** Liga o webview ao servidor Rust: atende cada chamada recebida. */
export async function escutarMcp(ctx: ContextoMcp) {
  const [{ listen }, { invoke }] = await Promise.all([import("@tauri-apps/api/event"), import("@tauri-apps/api/core")]);
  return listen<{ id: number; metodo: string; params: Args }>("mcp-chamada", async (e) => {
    const resposta = await despachar(e.payload.metodo, e.payload.params ?? {}, ctx);
    await invoke("mcp_responder", { id: e.payload.id, resposta });
  });
}
