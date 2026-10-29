import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-sql", () => import("./test/sqlite-mock"));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));

import { novoBanco } from "./test/sqlite-mock";
import { criarPerfilDemo, planoParaJson } from "./backup";
import { hoje } from "./datas";
import { despachar, type ContextoMcp } from "./mcp";
import { carregarPlano } from "./planos";

let ativo: number | null = null;
const mudou: number[] = [];
const ctx: ContextoMcp = { perfilAtivo: () => ativo, aoMudar: async (id) => void mudou.push(id) };

async function ferramenta(name: string, args: Record<string, unknown> = {}) {
  const r = (await despachar("tools/call", { name, arguments: args }, ctx)) as {
    resultado: { content: { text: string }[]; isError?: boolean };
  };
  const t = r.resultado.content[0].text;
  return { erro: !!r.resultado.isError, texto: t, dados: r.resultado.isError ? null : JSON.parse(t) };
}

beforeEach(async () => {
  novoBanco();
  mudou.length = 0;
  ativo = await criarPerfilDemo();
});

describe("servidor MCP", () => {
  it("lista ferramentas com esquema e prompts com argumentos", async () => {
    const t = (await despachar("tools/list", {}, ctx)) as { resultado: { tools: { name: string; inputSchema: unknown }[] } };
    const nomes = t.resultado.tools.map((x) => x.name);
    expect(nomes).toContain("plano_do_dia");
    expect(nomes).toContain("importar_plano");
    expect(t.resultado.tools.every((x) => x.inputSchema)).toBe(true);
    expect(JSON.stringify(t.resultado.tools)).not.toContain('"run"');

    const p = (await despachar("prompts/list", {}, ctx)) as { resultado: { prompts: { name: string; arguments: { name: string }[] }[] } };
    const pre = p.resultado.prompts.find((x) => x.name === "plano.preedital")!;
    expect(pre.arguments.map((a) => a.name)).toContain("previsao");
  });

  it("prompt do edital previsto traz os ids atuais e manda usar importar_plano", async () => {
    const r = (await despachar("prompts/get", { name: "plano.preedital", arguments: { cargo: "PC/SE Investigador", previsao: "1º sem. 2027" } }, ctx)) as {
      resultado: { messages: { content: { text: string } }[] };
    };
    const t = r.resultado.messages[0].content.text;
    expect(t).toContain("Previsão do edital/prova: 1º sem. 2027");
    expect(t).toContain("port-01 = Interpretação de textos");
    expect(t).toContain("ferramenta importar_plano (primeiro com confirmar=false");
    expect(t).not.toMatch(/\{\{\w+\}\}/);
  });

  it("plano do dia, registro de estudo e conclusão", async () => {
    // segunda-feira com português, penal e estatística
    const dia = "2026-11-02";
    const d = (await ferramenta("plano_do_dia", { data: dia })).dados;
    expect(d.sessoes.map((s: { materia: string }) => s.materia)).toEqual(["port", "penal", "estat"]);
    expect(d.sessoes[1].aulas.length).toBeGreaterThan(0);

    const r = await ferramenta("registrar_estudo", { materia: "penal", assunto: "penal-01", minutos: 50, concluiu: true, data: dia });
    expect(r.dados).toMatchObject({ registrado: "sessão do plano", minutos: 50 });
    expect(mudou).toContain(ativo);
    const plano = (await ferramenta("ver_plano")).dados;
    expect(plano.materias.find((m: { id: string }) => m.id === "penal").assuntos[0].concluidoEm).toBe(dia);

    // matéria fora do dia vira estudo extra
    expect((await ferramenta("registrar_estudo", { materia: "info", minutos: 20, data: dia })).dados.registrado).toBe("estudo fora do plano");
  });

  it("questões: lista sem gabarito e corrige a resposta", async () => {
    const lista = (await ferramenta("listar_questoes", { materia: "rl", limite: 2 })).dados;
    expect(lista).toHaveLength(2);
    expect(JSON.stringify(lista)).not.toContain("gabarito");
    const r = (await ferramenta("responder_questao", { questaoId: lista[0].id, resposta: "c" })).dados;
    expect(typeof r.acertou).toBe("boolean");
    expect(["Certo", "Errado"]).toContain(r.gabarito);
    const prog = (await ferramenta("ver_progresso")).dados;
    expect(prog.geral.acertos + prog.geral.erros).toBe(1);
  });

  it("importar_plano mostra a prévia e só salva com confirmar", async () => {
    const plano = planoParaJson((await carregarPlano(ativo!))!);
    plano.materias[0].assuntos.push({ id: "port-12", nome: "Semântica", prioridade: 2 });
    const previa = (await ferramenta("importar_plano", { plano })).dados;
    expect(previa.confirmado).toBe(false);
    expect(previa.previa.assuntosNovos).toBe(1);
    expect((await carregarPlano(ativo!))!.versao).toBe(1);

    const ok = (await ferramenta("importar_plano", { plano: JSON.stringify(plano), confirmar: true })).dados;
    expect(ok.confirmado).toBe(true);
    expect((await carregarPlano(ativo!))!.versao).toBe(2);
  });

  it("devolve erros de validação e de referência como isError", async () => {
    const r = await ferramenta("importar_aulas", { aulas: { schema: "preparador.aulas/1", aulas: [{ titulo: "x", url: "nao-e-url" }] } });
    expect(r.erro).toBe(true);
    expect(r.texto).toContain("aulas.0");
    const s = await ferramenta("registrar_estudo", { materia: "quimica", minutos: 10 });
    expect(s.erro).toBe(true);
    expect(s.texto).toContain("ver_plano");
    const p = await ferramenta("ver_plano", { perfil: "inexistente" });
    expect(p.texto).toContain("não encontrado");
    const desconhecida = await despachar("tools/call", { name: "nao_existe" }, ctx);
    expect(desconhecida).toMatchObject({ erro: { code: -32602 } });
  });

  it("importa aulas de assuntos sem aula pelo agente", async () => {
    const sem = (await ferramenta("assuntos_sem_aula")).dados;
    expect(sem.assuntos.length).toBeGreaterThan(0);
    const alvo = sem.assuntos[0];
    const r = (
      await ferramenta("importar_aulas", {
        aulas: { schema: "preparador.aulas/1", aulas: [{ assuntoId: alvo.assunto, titulo: "Aula nova", url: "https://youtu.be/abcdefghijk" }] },
      })
    ).dados;
    expect(r.adicionadas).toBe(1);
    expect((await ferramenta("assuntos_sem_aula")).dados.assuntos.length).toBe(sem.assuntos.length - 1);
  });
});

it("data padrão é hoje", async () => {
  novoBanco();
  ativo = await criarPerfilDemo();
  expect((await ferramenta("plano_do_dia")).dados.data).toBe(hoje());
});
