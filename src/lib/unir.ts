import { execute, insertMany, select } from "./db";
import type { PlanoJson } from "./esquemas";
import { criarPerfil } from "./perfis";
import { carregarPlano, importarPlano, type Plano } from "./planos";

/**
 * União de dois perfis num perfil novo, em modo constância. Os perfis originais
 * não são alterados. O plano unido diz, em "origens", de quais matérias e
 * assuntos de A e de B cada item veio ("A:slug", "B:slug"); é assim que o
 * progresso é transportado.
 */

export type Lado = "A" | "B";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const slugify = (s: string) => norm(s).replace(/ /g, "-").slice(0, 40) || "x";

/** Provas que cobram cada assunto (por slug); vazio = todas as provas do plano. */
async function provasPorAssunto(plano: Plano) {
  const r = await select<{ assunto_id: number; prova_id: number }>(
    "SELECT ap.assunto_id, ap.prova_id FROM assunto_provas ap JOIN provas p ON p.id = ap.prova_id WHERE p.objetivo_id = $1",
    [plano.objetivo.id],
  );
  const m = new Map<number, number[]>();
  for (const x of r) m.set(x.assunto_id, [...(m.get(x.assunto_id) ?? []), x.prova_id]);
  return m;
}

/** Junta matérias e assuntos de mesmo nome (ignorando acentos e maiúsculas). */
export async function planoUnidoAutomatico(pa: Plano, pb: Plano, nome: string): Promise<PlanoJson> {
  const lados: [Lado, Plano][] = [
    ["A", pa],
    ["B", pb],
  ];
  const provas: PlanoJson["objetivo"]["provas"] = [];
  const provaSlug = new Map<string, string>(); // "A:<id db>" → slug no plano novo
  for (const [lado, p] of lados)
    p.provas.forEach((x, i) => {
      const id = `${lado.toLowerCase()}${i + 1}-${slugify(x.nome).slice(0, 20)}`;
      provaSlug.set(`${lado}:${x.id}`, id);
      provas.push({
        id,
        nome: x.nome,
        banca: x.banca,
        dataProva: x.data_prova,
        situacao: x.situacao,
        previsao: x.previsao,
        editalBase: x.edital_base,
      });
    });

  type MatTmp = { id: string; nome: string; peso: number; origens: string[]; assuntos: Map<string, PlanoJson["materias"][0]["assuntos"][0]> };
  const mats = new Map<string, MatTmp>();
  const idsMat = new Set<string>();
  const idsAss = new Set<string>();
  const unico = (base: string, usados: Set<string>) => {
    let id = base;
    for (let n = 2; usados.has(id); n++) id = `${base}-${n}`;
    usados.add(id);
    return id;
  };

  for (const [lado, p] of lados) {
    const vinculos = await provasPorAssunto(p);
    const todas = p.provas.map((x) => provaSlug.get(`${lado}:${x.id}`)!);
    for (const m of p.materias) {
      const k = norm(m.nome);
      let mt = mats.get(k);
      if (!mt) {
        mt = { id: unico(m.slug, idsMat), nome: m.nome, peso: m.peso, origens: [], assuntos: new Map() };
        mats.set(k, mt);
      }
      mt.peso = Math.max(mt.peso, m.peso);
      mt.origens.push(`${lado}:${m.slug}`);
      for (const a of m.assuntos) {
        const provasA = vinculos.get(a.id)?.map((pid) => provaSlug.get(`${lado}:${pid}`)!) ?? todas;
        const ka = norm(a.nome);
        const ex = mt.assuntos.get(ka);
        if (ex) {
          ex.origens!.push(`${lado}:${a.slug}`);
          ex.provas = [...new Set([...(ex.provas ?? []), ...provasA])];
          ex.prioridade = Math.max(ex.prioridade, a.prioridade);
        } else
          mt.assuntos.set(ka, {
            id: unico(a.slug, idsAss),
            nome: a.nome,
            detalhe: a.detalhe,
            prioridade: a.prioridade,
            provas: provasA,
            origens: [`${lado}:${a.slug}`],
          });
      }
    }
  }

  return {
    schema: "preparador.plano/1",
    objetivo: { tipo: "constancia", nome, provas },
    materias: [...mats.values()].map((m) => ({ id: m.id, nome: m.nome, peso: m.peso, origens: m.origens, assuntos: [...m.assuntos.values()] })),
    semana: null,
    observacoes: `União de "${pa.objetivo.nome}" e "${pb.objetivo.nome}".`,
  };
}

/** Lista "id = nome" de um plano, para o prompt de união com IA. */
export function planoParaPrompt(lado: Lado, p: Plano) {
  const provas = p.provas
    .map((x) => `  ${x.nome}${x.banca ? ` (${x.banca})` : ""}${x.situacao === "previsto" ? `, edital previsto${x.previsao ? ` ${x.previsao}` : ""}` : ""}`)
    .join("\n");
  const mats = p.materias
    .map((m) => `  ${lado}:${m.slug} = ${m.nome} (peso ${m.peso})\n${m.assuntos.map((a) => `    ${lado}:${a.slug} = ${a.nome}`).join("\n")}`)
    .join("\n");
  return `Plano ${lado}: ${p.objetivo.nome}\nProvas:\n${provas}\nMatérias e assuntos:\n${mats}`;
}

export type ResumoUniao = {
  materias: number;
  assuntos: number;
  /** assuntos do plano novo que juntam mais de um original */
  juntados: number;
  /** assuntos originais que não aparecem em nenhuma origem (perdem o progresso) */
  semDestino: string[];
  origensDesconhecidas: string[];
};

export function resumoUniao(pa: Plano, pb: Plano, dados: PlanoJson): ResumoUniao {
  const usados = new Set(dados.materias.flatMap((m) => m.assuntos.flatMap((a) => a.origens ?? [])));
  const existentes = new Map<string, string>();
  for (const [lado, p] of [["A", pa], ["B", pb]] as const)
    for (const a of p.assunto.values()) existentes.set(`${lado}:${a.slug}`, a.nome);
  const assuntos = dados.materias.flatMap((m) => m.assuntos);
  return {
    materias: dados.materias.length,
    assuntos: assuntos.length,
    juntados: assuntos.filter((a) => (a.origens?.length ?? 0) > 1).length,
    semDestino: [...existentes].filter(([k]) => !usados.has(k)).map(([k, n]) => `${k} (${n})`),
    origensDesconhecidas: [...usados].filter((k) => !existentes.has(k)),
  };
}

/** Cria o perfil unido e copia o progresso dos dois perfis. Devolve o id do perfil novo. */
export async function unirPerfis(
  a: { perfilId: number; plano: Plano },
  b: { perfilId: number; plano: Plano },
  dados: PlanoJson,
  bruto: string,
  perfil: { nome: string; idioma: string; horas: number },
): Promise<number> {
  const novo = await criarPerfil(perfil.nome, perfil.idioma, perfil.horas);
  await importarPlano(novo, dados, bruto);
  const pn = (await carregarPlano(novo))!;

  const assuntoNovo = new Map<string, number>(); // "A:slug" → id novo
  const materiaNova = new Map<string, number>();
  const slugParaId = new Map([...pn.assunto.values()].map((x) => [x.slug, x.id]));
  const matParaId = new Map(pn.materias.map((m) => [m.slug, m.id]));
  for (const m of dados.materias) {
    for (const o of m.origens ?? []) materiaNova.set(o, matParaId.get(m.id)!);
    for (const x of m.assuntos) for (const o of x.origens ?? []) assuntoNovo.set(o, slugParaId.get(x.id)!);
  }

  for (const [lado, { perfilId, plano }] of [["A", a], ["B", b]] as const) {
    const A = (id: number | null) => (id == null ? null : (assuntoNovo.get(`${lado}:${plano.assunto.get(id)?.slug}`) ?? null));
    // matéria: a declarada nas origens; senão, a do primeiro assunto dela que foi mapeado
    const M = (id: number) => {
      const m = plano.materia.get(id);
      if (!m) return null;
      const direto = materiaNova.get(`${lado}:${m.slug}`);
      if (direto) return direto;
      for (const x of m.assuntos) {
        const n = A(x.id);
        if (n) return pn.assunto.get(n)!.materia_id;
      }
      return null;
    };
    const destino = (materiaId: number, assuntoId: number | null) => {
      const na = A(assuntoId);
      if (na) return { m: pn.assunto.get(na)!.materia_id, a: na };
      const nm = M(materiaId);
      return nm ? { m: nm, a: null } : null;
    };

    // aulas (sem repetir o mesmo link no mesmo destino)
    const aulas = await select<{ materia_id: number; assunto_id: number | null; titulo: string; url: string; canal: string | null; duracao_min: number | null; status_link: string; assistida_em: string | null }>(
      "SELECT materia_id, assunto_id, titulo, url, canal, duracao_min, status_link, assistida_em FROM aulas WHERE perfil_id = $1",
      [perfilId],
    );
    const jaTem = new Set(
      (await select<{ k: string }>("SELECT materia_id || '|' || IFNULL(assunto_id, '') || '|' || url AS k FROM aulas WHERE perfil_id = $1", [novo])).map((r) => r.k),
    );
    const linhasAulas: unknown[][] = [];
    for (const x of aulas) {
      const d = destino(x.materia_id, x.assunto_id);
      if (!d) continue;
      const k = `${d.m}|${d.a ?? ""}|${x.url}`;
      if (jaTem.has(k)) continue;
      jaTem.add(k);
      linhasAulas.push([novo, d.m, d.a, x.titulo, x.url, x.canal, x.duracao_min, x.status_link, x.assistida_em]);
    }
    if (linhasAulas.length)
      await insertMany("aulas", ["perfil_id", "materia_id", "assunto_id", "titulo", "url", "canal", "duracao_min", "status_link", "assistida_em"], linhasAulas);

    // questões e respostas
    const qs = await select<{ id: number; materia_id: number; assunto_id: number | null; tipo: string; enunciado: string; alternativas: string | null; gabarito: string; explicacao: string | null; origem: string; fonte: string | null; gabarito_oficial: number }>(
      "SELECT id, materia_id, assunto_id, tipo, enunciado, alternativas, gabarito, explicacao, origem, fonte, gabarito_oficial FROM questoes WHERE perfil_id = $1",
      [perfilId],
    );
    const resp = await select<{ questao_id: number; resposta: string; acertou: number; data: string }>(
      "SELECT questao_id, resposta, acertou, data FROM respostas WHERE perfil_id = $1 ORDER BY id",
      [perfilId],
    );
    for (const q of qs) {
      const d = destino(q.materia_id, q.assunto_id);
      if (!d) continue;
      const r = await execute(
        `INSERT INTO questoes (perfil_id, materia_id, assunto_id, tipo, enunciado, alternativas, gabarito, explicacao, origem, fonte, gabarito_oficial)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [novo, d.m, d.a, q.tipo, q.enunciado, q.alternativas, q.gabarito, q.explicacao, q.origem, q.fonte, q.gabarito_oficial],
      );
      const rs = resp.filter((x) => x.questao_id === q.id);
      if (rs.length)
        await insertMany("respostas", ["perfil_id", "questao_id", "resposta", "acertou", "data"], rs.map((x) => [novo, r.lastInsertId, x.resposta, x.acertou, x.data]));
    }

    // sessões viram estudo registrado (sem slot), para não brigar com a semana nova
    const sess = await select<{ data: string; materia_id: number; assunto_id: number | null; minutos: number; estudou: number }>(
      "SELECT data, materia_id, assunto_id, minutos, estudou FROM sessoes WHERE perfil_id = $1 AND estudou = 1",
      [perfilId],
    );
    const linhasSess = sess.flatMap((s) => {
      const d = destino(s.materia_id, s.assunto_id);
      return d ? [[novo, s.data, null, d.m, d.a, s.minutos, 1]] : [];
    });
    if (linhasSess.length) await insertMany("sessoes", ["perfil_id", "data", "slot", "materia_id", "assunto_id", "minutos", "estudou"], linhasSess);

    // conclusões: quando dois assuntos se juntam, vale a data mais antiga
    for (const c of await select<{ assunto_id: number; data: string }>("SELECT assunto_id, data FROM conclusoes WHERE perfil_id = $1", [perfilId])) {
      const na = A(c.assunto_id);
      if (na)
        await execute(
          `INSERT INTO conclusoes (perfil_id, assunto_id, data) VALUES ($1, $2, $3)
           ON CONFLICT(perfil_id, assunto_id) DO UPDATE SET data = MIN(data, excluded.data)`,
          [novo, na, c.data],
        );
    }
    for (const r of await select<{ assunto_id: number; intervalo: number; data_prevista: string; feita_em: string | null }>(
      "SELECT assunto_id, intervalo, data_prevista, feita_em FROM revisoes WHERE perfil_id = $1",
      [perfilId],
    )) {
      const na = A(r.assunto_id);
      if (na)
        await execute(
          `INSERT INTO revisoes (perfil_id, assunto_id, intervalo, data_prevista, feita_em) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT(perfil_id, assunto_id, intervalo) DO NOTHING`,
          [novo, na, r.intervalo, r.data_prevista, r.feita_em],
        );
    }
  }
  return novo;
}
