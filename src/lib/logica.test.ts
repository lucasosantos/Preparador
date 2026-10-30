import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-sql", () => import("./test/sqlite-mock"));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => import("./test/arquivos-mock"));

import { novoBanco } from "./test/sqlite-mock";
import { listarAulas } from "./aulas";
import { criarPerfilDemo, exportarPerfil, importarBackup, planoParaJson } from "./backup";
import { addDays } from "./datas";
import { PlanoSchema, QuestoesSchema, extrairJson, validar } from "./esquemas";
import { criarPerfil } from "./perfis";
import { carregarPlano, gerarSemana, importarPlano, listaAssuntosPrompt, planoAtualPrompt, previaPlano } from "./planos";
import { importarQuestoes, listarQuestoes, previaQuestoes, responder } from "./questoes";
import { concluirAssunto, conclusoes, historico, metricas, registrarSessao, revisoesDoDia, sessoesDoDia } from "./rotina";
import { planoUnidoAutomatico, resumoUniao, unirPerfis } from "./unir";
import { leituraPdfsConstancia, listaProvasAlvo, montarPrompt } from "./prompts";

// 2026-11-02 é uma segunda-feira
const SEG = "2026-11-02";

beforeEach(() => novoBanco());

describe("perfil de exemplo", () => {
  it("importa plano, aulas e questões do protótipo", async () => {
    const pid = await criarPerfilDemo();
    const p = (await carregarPlano(pid))!;
    expect(p.materias).toHaveLength(14);
    expect(p.assunto.size).toBe(120);
    expect(p.semana[1].map((id) => p.materia.get(id)!.slug)).toEqual(["port", "penal", "estat"]);
    expect(p.semana[0]).toEqual([]);
    expect(await listarAulas(pid, p.id)).toHaveLength(138);
    expect(await listarQuestoes(pid, p.id)).toHaveLength(63);
  });
});

describe("rotina", () => {
  it("avança o assunto ao concluir e agenda revisões", async () => {
    const pid = await criarPerfilDemo();
    const p = (await carregarPlano(pid))!;
    let s = await sessoesDoDia(pid, p, SEG, 3);
    expect(s.map((x) => x.assunto?.slug)).toEqual(["port-01", "penal-01", "estat-01"]);
    expect(s[0].planejado).toBe(60);

    await registrarSessao(pid, SEG, { slot: 0, materiaId: s[0].materiaId, assuntoId: s[0].assunto!.id }, true, 50);
    await concluirAssunto(pid, s[0].assunto!.id, SEG, p.revisoes);

    // o dia já registrado mantém o assunto; o dia seguinte com português pega o próximo
    s = await sessoesDoDia(pid, p, SEG, 3);
    expect(s[0].assunto?.slug).toBe("port-01");
    const qui = addDays(SEG, 3);
    expect((await sessoesDoDia(pid, p, qui, 3))[0].assunto?.slug).toBe("port-02");

    const rev = await revisoesDoDia(pid, addDays(SEG, 7));
    expect(rev.map((r) => r.intervalo)).toEqual([7]);
    expect(await revisoesDoDia(pid, addDays(SEG, 30))).toHaveLength(1);
  });

  it("não repete assunto quando a matéria aparece duas vezes no dia", async () => {
    const pid = await criarPerfil("x", "pt-BR", 2);
    const dados = PlanoSchema.parse({
      schema: "preparador.plano/1",
      objetivo: { tipo: "edital", nome: "T", provas: [{ id: "p", nome: "P" }] },
      materias: [{ id: "m", nome: "M", assuntos: [{ id: "m-1", nome: "A" }, { id: "m-2", nome: "B" }] }],
      semana: { seg: ["m", "m"] },
    });
    await importarPlano(pid, dados, "{}");
    const p = (await carregarPlano(pid))!;
    // a semana não guarda matéria duplicada no mesmo dia
    expect(p.semana[1]).toHaveLength(1);
  });

  it("calcula placar pela última resposta e a sequência de dias", async () => {
    const pid = await criarPerfilDemo();
    const p = (await carregarPlano(pid))!;
    const [q1, q2] = await listarQuestoes(pid, p.id);
    await responder(pid, q1, q1.gabarito === "C" ? "E" : "C", SEG);
    await responder(pid, q1, q1.gabarito, SEG);
    await responder(pid, q2, q2.gabarito === "C" ? "E" : "C", SEG);
    const m = await metricas(pid, p);
    expect(m.acertos).toBe(1);
    expect(m.erros).toBe(1);
  });
});

describe("reimportação do plano", () => {
  it("mantém progresso de assuntos com o mesmo id e avisa o que será perdido", async () => {
    const pid = await criarPerfilDemo();
    const p = (await carregarPlano(pid))!;
    const port01 = [...p.assunto.values()].find((a) => a.slug === "port-01")!;
    const penal01 = [...p.assunto.values()].find((a) => a.slug === "penal-01")!;
    await concluirAssunto(pid, port01.id, SEG, [1]);
    await concluirAssunto(pid, penal01.id, SEG, [1]);

    const novo = planoParaJson(p);
    novo.materias[0].assuntos[0].nome = "Interpretação de textos (novo nome)";
    novo.materias = novo.materias.filter((m) => m.id !== "penal");
    const semana = novo.semana as Record<string, string[]>;
    for (const k of Object.keys(semana)) semana[k] = semana[k].filter((id) => id !== "penal");

    const previa = await previaPlano(pid, PlanoSchema.parse(novo));
    expect(previa.materiasRemovidas).toEqual(["Direito Penal"]);
    expect(previa.assuntosRenomeados).toHaveLength(1);
    expect(previa.progressoPerdido.conclusoes).toBe(1);

    await importarPlano(pid, PlanoSchema.parse(novo), "{}");
    const p2 = (await carregarPlano(pid))!;
    expect(p2.versao).toBe(2);
    expect(p2.materias).toHaveLength(13);
    expect(p2.assunto.get(port01.id)?.nome).toBe("Interpretação de textos (novo nome)");
    expect((await metricas(pid, p2)).concluidos).toBe(1);
  });
});

describe("semana automática", () => {
  it("coloca toda matéria ao menos uma vez e não repete no mesmo dia", () => {
    const mats = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, peso: i < 3 ? 3 : 1 }));
    const s = gerarSemana(mats);
    expect(s.dom).toEqual([]);
    const todos = Object.values(s).flat();
    for (const m of mats) expect(todos).toContain(m.id);
    for (const dia of Object.values(s)) expect(new Set(dia).size).toBe(dia.length);
    expect(todos.filter((x) => x === "m0").length).toBeGreaterThan(todos.filter((x) => x === "m8").length);
  });
});

describe("modo constância", () => {
  it("prioriza assuntos cobrados por mais provas", async () => {
    const pid = await criarPerfil("c", "pt-BR", 2);
    await importarPlano(
      pid,
      PlanoSchema.parse({
        schema: "preparador.plano/1",
        objetivo: { tipo: "constancia", nome: "Várias", provas: [{ id: "a", nome: "A" }, { id: "b", nome: "B" }] },
        materias: [{ id: "port", nome: "Português", assuntos: [
          { id: "port-01", nome: "Só A", provas: ["a"] },
          { id: "port-02", nome: "A e B", provas: ["a", "b"] },
        ] }],
        semana: { seg: ["port"] },
      }),
      "{}",
    );
    const p = (await carregarPlano(pid))!;
    expect((await sessoesDoDia(pid, p, SEG, 2))[0].assunto?.slug).toBe("port-02");
  });
});

describe("validação do JSON colado", () => {
  it("extrai o JSON de dentro de texto e cercas", () => {
    expect(extrairJson('Aqui está:\n```json\n{"a":1}\n```\nBons estudos!')).toBe('{"a":1}');
    expect(extrairJson('Claro! {"a":{"b":2}} espero ter ajudado')).toBe('{"a":{"b":2}}');
  });

  it("aponta o caminho dos erros", () => {
    const r = validar(PlanoSchema, JSON.stringify({
      schema: "preparador.plano/1",
      objetivo: { tipo: "edital", nome: "X", provas: [{ id: "p", nome: "P" }] },
      materias: [{ id: "m", nome: "M", assuntos: [{ id: "a", nome: "A" }, { id: "a", nome: "B" }] }],
      semana: { seg: ["inexistente"] },
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erros.some((e) => e.startsWith("materias.0.assuntos.1.id"))).toBe(true);
      expect(r.erros.some((e) => e.startsWith("semana.seg.0"))).toBe(true);
    }
  });
});

describe("prompts", () => {
  it("preenche as variáveis do template", async () => {
    const t = await montarPrompt("aulas.youtube", { idioma: "Português (Brasil)", objetivo: "PC/SE", porAssunto: 2, assuntos: "x | y | z" });
    expect(t).toContain("aulas gratuitas em Português (Brasil)");
    expect(t).toContain("(banca: não informado)");
    expect(t).not.toMatch(/\{\{\w+\}\}/);
  });
});

describe("backup", () => {
  it("restaura perfil com plano, aulas, questões e progresso", async () => {
    const pid = await criarPerfilDemo();
    const p = (await carregarPlano(pid))!;
    const a = [...p.assunto.values()][0];
    await concluirAssunto(pid, a.id, SEG, [1, 7]);
    const [q] = await listarQuestoes(pid, p.id);
    await responder(pid, q, q.gabarito, SEG);

    const novo = await importarBackup(await exportarPerfil(pid));
    const p2 = (await carregarPlano(novo))!;
    expect(p2.assunto.size).toBe(p.assunto.size);
    expect(p2.semana).toEqual(p.semana.map((d) => d.map((id) => p2.materias.find((m) => m.slug === p.materia.get(id)!.slug)!.id)));
    expect(await listarAulas(novo, p2.id)).toHaveLength(138);
    const m = await metricas(novo, p2);
    expect(m.concluidos).toBe(1);
    expect(m.acertos).toBe(1);
  });
});

describe("edital previsto", () => {
  it("guarda a previsão e o edital-base da prova", async () => {
    const pid = await criarPerfilDemo();
    const p = (await carregarPlano(pid))!;
    expect(p.provas[0]).toMatchObject({ situacao: "previsto", previsao: "1º semestre de 2027" });
    expect(p.provas[0].edital_base).toContain("2021");
  });

  it("o prompt leva os ids atuais e o edital publicado mantém o progresso", async () => {
    const pid = await criarPerfilDemo();
    const p = (await carregarPlano(pid))!;
    const t = await montarPrompt("plano.edital", { situacao: "publicado", planoAtual: planoAtualPrompt(p) });
    expect(t).toContain("port-01 = Interpretação de textos");
    expect(t).toContain('"situacao": "publicado"');
    // sem plano, a variável some (não vira "não informado")
    expect(await montarPrompt("plano.preedital", { planoAtual: "" })).not.toContain("Plano atual (id = nome)");

    const a = [...p.assunto.values()].find((x) => x.slug === "penal-03")!;
    await concluirAssunto(pid, a.id, SEG, [1]);

    // edital publicado: IA reaproveitou ids, renomeou um assunto e incluiu um novo
    const novo = planoParaJson(p);
    novo.objetivo.provas[0] = { ...novo.objetivo.provas[0], situacao: "publicado", previsao: null, dataProva: "2027-05-16" };
    novo.materias.find((m) => m.id === "penal")!.assuntos[2].nome = "Fato típico e teoria do crime";
    novo.materias[0].assuntos.push({ id: "port-12", nome: "Semântica", prioridade: 2 });
    const dados = PlanoSchema.parse(novo);
    const previa = await previaPlano(pid, dados);
    expect(previa.assuntosMantidos).toBe(120);
    expect(previa.assuntosNovos).toBe(1);

    await importarPlano(pid, dados, "{}");
    const p2 = (await carregarPlano(pid))!;
    expect(p2.provas[0]).toMatchObject({ situacao: "publicado", data_prova: "2027-05-16" });
    expect((await metricas(pid, p2)).concluidos).toBe(1);
    expect(p2.assunto.get(a.id)?.nome).toBe("Fato típico e teoria do crime");
  });
});

describe("prompts de edital com PDF anexado", () => {
  it("mandam ler o PDF anexo e não inventar se ele faltar", async () => {
    for (const k of ["plano.edital", "plano.preedital"] as const) {
      const t = await montarPrompt(k, { complemento: "" });
      expect(t).toMatch(/ANEXEI A ESTA MENSAGEM O PDF/);
      expect(t).toContain("Leia o PDF");
      expect(t).toContain("NÃO invente o conteúdo");
      expect(t).not.toContain("não informado\nTarefa");
      expect(t).not.toMatch(/\{\{\w+\}\}/);
    }
    const comNotas = await montarPrompt("plano.edital", { complemento: "\nObservações minhas (leve em conta):\nuse o anexo II\n" });
    expect(comNotas).toContain("use o anexo II");
  });
});

describe("constância com vários PDFs", () => {
  it("numera os PDFs por prova e manda ler cada um", async () => {
    const provas = [
      { nome: "PC/SE Investigador", pdf: "PC/SE 2021 – Agente" },
      { nome: "PM/SE Soldado", pdf: "" },
      { nome: "PC/AL Agente", pdf: "PC/AL 2023 – Agente" },
      { nome: "  ", pdf: "ignorado" },
    ];
    const t = await montarPrompt("plano.constancia", {
      provas: listaProvasAlvo(provas),
      leituraPdfs: leituraPdfsConstancia(provas),
      complemento: "",
    });
    expect(t).toContain("- PC/SE Investigador → PDF anexado nº 1: PC/SE 2021 – Agente");
    expect(t).toContain("- PM/SE Soldado → sem PDF");
    expect(t).toContain("- PC/AL Agente → PDF anexado nº 2: PC/AL 2023 – Agente");
    expect(t).not.toContain("ignorado");
    expect(t).toContain("ANEXEI A ESTA MENSAGEM 2 PDFS DE EDITAIS");
    expect(t).toContain("Associe cada PDF à prova");
    expect(t).not.toMatch(/\{\{\w+\}\}/);

    const sem = leituraPdfsConstancia([{ nome: "ENEM", pdf: "" }]);
    expect(sem).toContain("Não anexei editais");
  });
});

describe("unir perfis", () => {
  async function perfilPm() {
    const pid = await criarPerfil("PM/SE", "pt-BR", 2);
    await importarPlano(
      pid,
      PlanoSchema.parse({
        schema: "preparador.plano/1",
        objetivo: { tipo: "edital", nome: "PM/SE Soldado", provas: [{ id: "pm", nome: "PM/SE – Soldado", banca: "IBFC", situacao: "previsto" }] },
        materias: [
          { id: "portugues", nome: "LÍNGUA PORTUGUESA", assuntos: [{ id: "portugues-01", nome: "Interpretação de Textos" }, { id: "portugues-02", nome: "Semântica" }] },
          { id: "hist", nome: "História de Sergipe", assuntos: [{ id: "hist-01", nome: "Sergipe colonial" }] },
        ],
      }),
      "{}",
    );
    return pid;
  }

  it("automático junta nomes iguais e leva o progresso dos dois perfis", async () => {
    const pa = await criarPerfilDemo();
    const pb = await perfilPm();
    const planoA = (await carregarPlano(pa))!;
    const planoB = (await carregarPlano(pb))!;
    const interpA = [...planoA.assunto.values()].find((x) => x.slug === "port-01")!;
    const interpB = [...planoB.assunto.values()].find((x) => x.slug === "portugues-01")!;
    const histB = [...planoB.assunto.values()].find((x) => x.slug === "hist-01")!;
    await concluirAssunto(pa, interpA.id, "2026-10-20", [7]);
    await concluirAssunto(pb, interpB.id, "2026-10-10", [7]);
    await concluirAssunto(pb, histB.id, SEG, [1]);
    await registrarSessao(pb, SEG, { slot: 0, materiaId: histB.materia_id, assuntoId: histB.id }, true, 40);

    const dados = PlanoSchema.parse(await planoUnidoAutomatico(planoA, planoB, "Polícias SE"));
    const r = resumoUniao(planoA, planoB, dados);
    expect(r.semDestino).toEqual([]);
    expect(r.juntados).toBe(1); // "Interpretação de textos" = "Interpretação de Textos"
    expect(dados.materias).toHaveLength(15); // 14 da PC + História de Sergipe

    const novo = await unirPerfis({ perfilId: pa, plano: planoA }, { perfilId: pb, plano: planoB }, dados, "{}", { nome: "Polícias SE", idioma: "pt-BR", horas: 3 });
    const pn = (await carregarPlano(novo))!;
    expect(pn.objetivo.tipo).toBe("constancia");
    expect(pn.provas.map((p) => p.nome)).toEqual(["Polícia Civil de Sergipe – Oficial Investigador", "PM/SE – Soldado"]);
    const m = await metricas(novo, pn);
    expect(m.concluidos).toBe(2); // interpretação (juntada) + história
    expect(await historico(novo)).toEqual([{ data: SEG, minutos: 40 }]);
    const interp = [...pn.assunto.values()].find((x) => x.slug === "port-01")!;
    expect(interp.nProvas).toBe(2);
    expect(await listarAulas(novo, pn.id)).toHaveLength(138);
    expect(await listarQuestoes(novo, pn.id)).toHaveLength(63);
    // originais intactos
    expect((await carregarPlano(pb))!.materias).toHaveLength(2);
  });

  it("aceita a junção feita pela IA e aponta assuntos esquecidos", async () => {
    const pa = await criarPerfilDemo();
    const pb = await perfilPm();
    const planoA = (await carregarPlano(pa))!;
    const planoB = (await carregarPlano(pb))!;
    const semB = [...planoB.assunto.values()].find((x) => x.slug === "portugues-02")!;
    await concluirAssunto(pb, semB.id, SEG, [1]);

    // a IA juntou "LÍNGUA PORTUGUESA" com "Língua Portuguesa" e Semântica foi para dentro de port
    const ia = planoParaJson(planoA);
    ia.objetivo.tipo = "constancia";
    for (const mt of ia.materias) {
      mt.origens = [`A:${mt.id}`];
      for (const a of mt.assuntos) a.origens = [`A:${a.id}`];
    }
    const port = ia.materias.find((x) => x.id === "port")!;
    port.origens!.push("B:portugues");
    port.assuntos[0].origens!.push("B:portugues-01");
    port.assuntos.push({ id: "port-12", nome: "Semântica", prioridade: 2, origens: ["B:portugues-02"] });
    // esqueceu B:hist-01
    const dados = PlanoSchema.parse(ia);
    const r = resumoUniao(planoA, planoB, dados);
    expect(r.semDestino).toEqual(["B:hist-01 (Sergipe colonial)"]);
    expect(r.juntados).toBe(1);

    const novo = await unirPerfis({ perfilId: pa, plano: planoA }, { perfilId: pb, plano: planoB }, dados, "{}", { nome: "X", idioma: "pt-BR", horas: 3 });
    const pn = (await carregarPlano(novo))!;
    const sem = [...pn.assunto.values()].find((x) => x.slug === "port-12")!;
    expect((await conclusoes(novo)).has(sem.id)).toBe(true);
  });
});

describe("questões de provas anteriores", () => {
  it("o prompt pede o PDF, classificação nos assuntos e partes de 40", async () => {
    const pid = await criarPerfilDemo();
    const p = (await carregarPlano(pid))!;
    const t = await montarPrompt("questoes.extrair", {
      prova: "Cebraspe 2021 – PC/SE Agente",
      gabarito: "",
      materias: "de todas as matérias",
      assuntos: listaAssuntosPrompt(p),
      complemento: "",
    });
    expect(t).toContain("ANEXEI A ESTA MENSAGEM O PDF DA PROVA: Cebraspe 2021 – PC/SE Agente");
    expect(t).toContain("penal | penal-02 | Direito Penal: Lei penal no tempo e no espaço");
    expect(t).toContain("até 40 questões");
    expect(t).not.toMatch(/\{\{\w+\}\}/);
  });

  it("importa com fonte e gabarito não oficial, sem duplicar ao colar a mesma parte", async () => {
    const pid = await criarPerfilDemo();
    const p = (await carregarPlano(pid))!;
    const json = {
      schema: "preparador.questoes/1",
      questoes: [
        { materiaId: "penal", assuntoId: "penal-02", tipo: "CE", enunciado: "Item extraído 1", gabarito: "c", fonte: "Cebraspe 2021 – PC/SE, q. 41", gabaritoOficial: false },
        { materiaId: "port", assuntoId: null, tipo: "ME", enunciado: "Item extraído 2", alternativas: ["a", "b", "c", "d"], gabarito: "B", fonte: "Cebraspe 2021 – PC/SE, q. 2" },
        { materiaId: "quimica", tipo: "CE", enunciado: "Fora do plano", gabarito: "E" },
      ],
    };
    const dados = QuestoesSchema.parse(json);
    const previa = await previaQuestoes(pid, p, dados);
    expect(previa.validas).toHaveLength(2);
    expect(previa.semAssunto).toHaveLength(1);
    await importarQuestoes(pid, previa, JSON.stringify(json));
    expect((await previaQuestoes(pid, p, dados)).duplicadas).toBe(2);

    const qs = (await listarQuestoes(pid, p.id)).filter((q) => q.fonte);
    expect(qs).toHaveLength(2);
    const q41 = qs.find((q) => q.fonte!.endsWith("q. 41"))!;
    expect(q41).toMatchObject({ gabarito: "C", gabarito_oficial: 0 });
    expect(qs.find((q) => q.tipo === "ME")!.gabarito_oficial).toBe(1);

    // o backup preserva fonte e gabarito
    const novo = await importarBackup(await exportarPerfil(pid));
    const p2 = (await carregarPlano(novo))!;
    expect((await listarQuestoes(novo, p2.id)).filter((q) => q.fonte)).toHaveLength(2);
  });
});
