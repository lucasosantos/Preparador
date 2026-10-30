import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-sql", () => import("./test/sqlite-mock"));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => import("./test/arquivos-mock"));

import { arquivos } from "./test/arquivos-mock";
import { novoBanco } from "./test/sqlite-mock";
import { criarPerfilDemo, exportarPerfil, importarBackup } from "./backup";
import { ApostilaSchema, AulaTextoSchema, validar } from "./esquemas";
import { despachar } from "./mcp";
import { listarPerfis } from "./perfis";
import { carregarPlano, type Plano } from "./planos";
import { montarPrompt } from "./prompts";
import {
  blocos,
  lerTexto,
  listarTextos,
  marcarLida,
  previaApostila,
  previaTexto,
  removerTexto,
  desvincularTextosDoPerfil,
  todosTextos,
  salvarApostila,
  salvarTexto,
  varsApostila,
  varsAulaTexto,
} from "./textos";

const aula = (assuntoId: string) =>
  AulaTextoSchema.parse({
    schema: "preparador.aulaTexto/1",
    assuntoId,
    titulo: "Aula de teste",
    resumo: "Resumo.",
    secoes: [{ titulo: "Conceito", texto: "Primeiro parágrafo.\n\n- item **um**\n- item dois" }],
    fontes: [{ titulo: "CF/88, art. 5º", url: null }],
  });

let pid: number;
let plano: Plano;
beforeEach(async () => {
  novoBanco();
  arquivos.clear();
  pid = await criarPerfilDemo();
  plano = (await carregarPlano(pid))!;
});

describe("aulas em texto", () => {
  it("exige ao menos uma fonte", () => {
    const sem = { ...aula("port-01"), fontes: [] };
    const r = validar(AulaTextoSchema, JSON.stringify(sem));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.join()).toContain("fonte");
  });

  it("grava um arquivo por aula e um índice com os metadados", async () => {
    const p = previaTexto(plano, aula("port-01"));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const id1 = await salvarTexto(pid, p, aula("port-01"));
    const id2 = await salvarTexto(pid, p, { ...aula("port-01"), titulo: "Outra" });
    expect([...arquivos.keys()].sort()).toEqual(["aula-" + id1 + ".json", "aula-" + id2 + ".json", "biblioteca.json"].sort());
    const indice = JSON.parse(arquivos.get("biblioteca.json")!);
    expect(indice.aulas).toHaveLength(2);
    expect(indice.aulas[0]).not.toHaveProperty("secoes");

    expect((await lerTexto(id1))!.aula.secoes[0].titulo).toBe("Conceito");
    await marcarLida(id1, "2026-10-29");
    expect((await listarTextos(pid, plano)).find((t) => t.id === id1)!.lidaEm).toBe("2026-10-29");

    await removerTexto(id1);
    expect(arquivos.has(`aula-${id1}.json`)).toBe(false);
    expect(await listarTextos(pid, plano)).toHaveLength(1);
    // excluir o perfil tira a aula dele, mas ela fica no acervo com o tema
    await desvincularTextosDoPerfil(pid);
    expect(await listarTextos(pid, plano)).toHaveLength(0);
    expect(arquivos.has(`aula-${id2}.json`)).toBe(true);
    const [noAcervo] = await todosTextos();
    expect(noAcervo.perfilId).toBeNull();
    expect(noAcervo.tema).toMatchObject({ materia: "Língua Portuguesa", assunto: "Interpretação de textos" });
  });

  it("recusa assunto que não existe no plano", () => {
    expect(previaTexto(plano, aula("nao-existe")).ok).toBe(false);
  });

  it("monta o prompt com perfil, provas e posição do assunto, pedindo as fontes", async () => {
    const perfil = (await listarPerfis())[0];
    const a = [...plano.assunto.values()].find((x) => x.slug === "port-02")!;
    const t = await montarPrompt("aulas.texto", varsAulaTexto(perfil, plano, a.id, "quero mais exemplos"));
    expect(t).toContain(perfil.nome);
    expect(t).toContain(plano.provas[0].nome);
    expect(t).toContain(a.nome);
    expect(t).toContain('assuntoId "port-02"');
    expect(t).toContain("quero mais exemplos");
    expect(t).toMatch(/FONTES/);
    expect(t).not.toContain("{{");
  });

  it("quebra o texto em parágrafos, listas e negrito", () => {
    expect(blocos("Um\nparágrafo.\n\n- a **b**\n- c\nFim.")).toEqual([
      { tipo: "p", trechos: [{ t: "Um parágrafo.", negrito: false }] },
      { tipo: "ul", itens: [[{ t: "a ", negrito: false }, { t: "b", negrito: true }], [{ t: "c", negrito: false }]] },
      { tipo: "p", trechos: [{ t: "Fim.", negrito: false }] },
    ]);
  });

  it("vai junto no backup do perfil", async () => {
    const p = previaTexto(plano, aula("port-01"));
    if (!p.ok) throw new Error();
    const id = await salvarTexto(pid, p, aula("port-01"));
    await marcarLida(id, "2026-10-01");
    const novo = await importarBackup(await exportarPerfil(pid));
    const pl = (await carregarPlano(novo))!;
    const [t] = await listarTextos(novo, pl);
    expect(t.lidaEm).toBe("2026-10-01");
    expect(pl.assunto.get(t.assuntoId)!.slug).toBe("port-01");
    expect((await lerTexto(t.id))!.aula.titulo).toBe("Aula de teste");
  });

  it("é salva pela ferramenta MCP", async () => {
    const ctx = { perfilAtivo: () => pid, aoMudar: async () => {} };
    const r = (await despachar("tools/call", { name: "salvar_aula_texto", arguments: { aula: aula("port-01") } }, ctx)) as {
      resultado: { content: { text: string }[]; isError?: boolean };
    };
    expect(r.resultado.isError).toBeFalsy();
    expect(await listarTextos(pid, plano)).toHaveLength(1);
    const p = (await despachar("prompts/get", { name: "aulas.texto", arguments: { assunto: "port-01" } }, ctx)) as {
      resultado: { messages: { content: { text: string } }[] };
    };
    expect(p.resultado.messages[0].content.text).toContain("salvar_aula_texto");
  });
});

describe("aulas a partir de apostila", () => {
  const { schema: _s, ...base } = aula("port-01");
  const lote = (assuntos: string[]) =>
    ApostilaSchema.parse({
      schema: "preparador.apostila/1",
      apostila: "Apostila de Português",
      aulas: assuntos.map((assuntoId) => ({ ...base, assuntoId, titulo: `Aula ${assuntoId}`, fontes: [{ titulo: "Apostila de Português, p. 3–9", url: null }] })),
      foraDoPlano: ["Redação oficial"],
    });

  it("monta o prompt com os assuntos do plano e a apostila como fonte", async () => {
    const perfil = (await listarPerfis())[0];
    const port = plano.materias.find((m) => m.slug === "port")!;
    const t = await montarPrompt("aulas.apostila", varsApostila(perfil, plano, "Apostila de Português", port.id));
    expect(t).toContain("ANEXEI A ESTA MENSAGEM O PDF DA MINHA APOSTILA: Apostila de Português.");
    expect(t).toContain("port | port-01 |");
    expect(t).not.toContain("penal-01");
    expect(t).toContain("a PRIMEIRA fonte é sempre a apostila");
    expect(t).not.toContain("{{");
  });

  it("encaixa cada aula no assunto, ignora ids desconhecidos e não duplica", async () => {
    const p = await previaApostila(pid, plano, lote(["port-01", "port-02", "nao-existe"]));
    expect(p.validas.map((v) => plano.assunto.get(v.ref.assuntoId)!.slug)).toEqual(["port-01", "port-02"]);
    expect(p.semAssunto).toHaveLength(1);
    expect(p.foraDoPlano).toEqual(["Redação oficial"]);
    await salvarApostila(pid, p);

    const lista = await listarTextos(pid, plano);
    expect(lista).toHaveLength(2);
    expect(lista.every((t) => t.apostila === "Apostila de Português")).toBe(true);
    expect((await lerTexto(lista[0].id))!.aula.apostila).toBe("Apostila de Português");
    expect(arquivos.size).toBe(3);

    const de_novo = await previaApostila(pid, plano, lote(["port-01", "port-03"]));
    expect(de_novo.repetidas).toBe(1);
    expect(de_novo.validas).toHaveLength(1);
  });

  it("é importada pela ferramenta MCP", async () => {
    const ctx = { perfilAtivo: () => pid, aoMudar: async () => {} };
    const r = (await despachar("tools/call", { name: "importar_apostila", arguments: { apostila: lote(["port-01"]) } }, ctx)) as {
      resultado: { content: { text: string }[]; isError?: boolean };
    };
    expect(r.resultado.isError).toBeFalsy();
    expect(JSON.parse(r.resultado.content[0].text).salvas).toHaveLength(1);
  });
});

describe("biblioteca pelo MCP", () => {
  const ctx = { perfilAtivo: () => pid, aoMudar: async () => {} };
  async function ferramenta(name: string, args: Record<string, unknown> = {}) {
    const r = (await despachar("tools/call", { name, arguments: args }, ctx)) as {
      resultado: { content: { text: string }[]; isError?: boolean };
    };
    return { erro: !!r.resultado.isError, texto: r.resultado.content[0].text, dados: r.resultado.isError ? null : JSON.parse(r.resultado.content[0].text) };
  }

  it("lista, lê e marca como lida; aparece no plano do dia e em assuntos_sem_aula", async () => {
    await ferramenta("salvar_aula_texto", { aula: aula("port-01") });
    await ferramenta("salvar_aula_texto", { aula: aula("penal-01") });

    expect((await ferramenta("listar_aulas_texto")).dados).toHaveLength(2);
    const [t] = (await ferramenta("listar_aulas_texto", { assunto: "port-01" })).dados;
    expect(t).toMatchObject({ assunto: "port-01", lidaEm: null });

    const lida = await ferramenta("ler_aula_texto", { id: t.id });
    expect(lida.dados.secoes[0].titulo).toBe("Conceito");
    expect(lida.dados.fontes[0].titulo).toBe("CF/88, art. 5º");
    expect(lida.dados).not.toHaveProperty("schema");
    expect((await ferramenta("ler_aula_texto", { id: "nao-existe" })).erro).toBe(true);

    await ferramenta("marcar_aula_texto_lida", { id: t.id, data: "2026-11-02" });
    expect((await ferramenta("listar_aulas_texto", { assunto: "port-01" })).dados[0].lidaEm).toBe("2026-11-02");
    await ferramenta("marcar_aula_texto_lida", { id: t.id, lida: false });
    expect((await ferramenta("listar_aulas_texto", { assunto: "port-01" })).dados[0].lidaEm).toBeNull();

    // 2026-11-02 é segunda: a 1ª sessão é port-01
    const dia = (await ferramenta("plano_do_dia", { data: "2026-11-02" })).dados;
    expect(dia.sessoes[0].aulasTexto).toEqual([{ id: t.id, titulo: "Aula de teste", apostila: null, lida: false }]);

    const sem = (await ferramenta("assuntos_sem_aula")).dados.assuntos as { assunto: string; temAulaTexto: boolean }[];
    expect(sem.every((x) => x.temAulaTexto === (x.assunto === "port-01" || x.assunto === "penal-01"))).toBe(true);
  });

  it("não lê aula de outro perfil", async () => {
    const id = (await ferramenta("salvar_aula_texto", { aula: aula("port-01") })).dados.id;
    const outro = await criarPerfilDemo();
    expect((await ferramenta("ler_aula_texto", { id, perfil: outro })).erro).toBe(true);
  });
});
