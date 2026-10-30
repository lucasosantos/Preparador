import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-sql", () => import("./test/sqlite-mock"));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => import("./test/arquivos-mock"));

import { arquivos } from "./test/arquivos-mock";
import { novoBanco } from "./test/sqlite-mock";
import { pesosPorRaridade, reaproveitar, resumoAcervo, semelhancaAssunto, semelhancaMateria, sugestoesAcervo } from "./acervo";
import { listarAulas } from "./aulas";
import { criarPerfilDemo } from "./backup";
import { select } from "./db";
import { AulaTextoSchema, PlanoSchema } from "./esquemas";
import { despachar } from "./mcp";
import { criarPerfil, excluirPerfil } from "./perfis";
import { carregarPlano, importarPlano } from "./planos";
import { listarQuestoes } from "./questoes";
import { desvincularTextosDoPerfil, listarTextos, previaTexto, salvarTexto } from "./textos";

/** Plano de outro concurso, com nomes parecidos (e alguns diferentes) dos do perfil de exemplo. */
const PLANO_NOVO = PlanoSchema.parse({
  schema: "preparador.plano/1",
  objetivo: { tipo: "edital", nome: "PF Agente", provas: [{ id: "pf", nome: "Polícia Federal – Agente", banca: "Cebraspe" }] },
  materias: [
    {
      id: "portugues",
      nome: "Português",
      assuntos: [
        { id: "pt-01", nome: "Interpretação de texto" },
        { id: "pt-02", nome: "Emprego do sinal indicativo de crase" },
        { id: "pt-03", nome: "Redação oficial" },
      ],
    },
    { id: "fisica", nome: "Física", assuntos: [{ id: "fis-01", nome: "Cinemática" }] },
  ],
});

let demo: number;
beforeEach(async () => {
  novoBanco();
  arquivos.clear();
  demo = await criarPerfilDemo();
});

async function perfilNovo() {
  const pid = await criarPerfil("PF", "pt-BR", 3);
  await importarPlano(pid, PLANO_NOVO, "{}");
  return { pid, plano: (await carregarPlano(pid))! };
}

describe("semelhança de nomes", () => {
  it("reconhece matérias e assuntos equivalentes", () => {
    expect(semelhancaMateria("Português", "Língua Portuguesa")).toBeGreaterThanOrEqual(0.6);
    expect(semelhancaMateria("Informática", "Noções de Informática")).toBeGreaterThanOrEqual(0.6);
    expect(semelhancaMateria("Física", "Língua Portuguesa")).toBe(0);
    const pt = (nome: string) => ({ materia: "Português", nome });
    expect(semelhancaAssunto(pt("Interpretação de texto"), { materia: "Língua Portuguesa", nome: "Interpretação de textos" })).toBe(1);
    // um nome contido no outro conta como forte
    expect(semelhancaAssunto(pt("Crase"), pt("Emprego do sinal indicativo de crase"))).toBeGreaterThanOrEqual(0.8);
    // palavras comuns a muitos temas pesam menos que as específicas
    const w = pesosPorRaridade(["Crimes contra a pessoa", "Crimes contra o patrimônio", "Crimes contra a fé pública", "Teoria do crime"]);
    const penal = (nome: string) => ({ materia: "Direito Penal", nome });
    expect(semelhancaAssunto(penal("Crimes contra a fé pública"), penal("Crimes contra a administração pública"), w)).toBeLessThan(0.8);
    expect(semelhancaAssunto(pt("Redação oficial"), pt("Crase"))).toBe(0);
  });
});

describe("acervo", () => {
  it("guarda tudo o que é cadastrado, mesmo depois de excluir o perfil", async () => {
    const antes = await resumoAcervo();
    expect(antes.temas).toBeGreaterThan(120);
    expect(antes.aulas).toBe(138);
    expect(antes.questoes).toBe(63);
    await excluirPerfil(demo);
    expect(await resumoAcervo()).toEqual(antes);
    expect(await select("SELECT id FROM aulas")).toHaveLength(0);
  });

  it("acompanha a verificação do link", async () => {
    const p = (await carregarPlano(demo))!;
    const [a] = await listarAulas(demo, p.id);
    const { execute } = await import("./db");
    await execute("UPDATE aulas SET status_link = 'quebrado' WHERE id = $1", [a.id]);
    const [x] = await select<{ status_link: string }>("SELECT status_link FROM acervo_aulas WHERE url = $1", [a.url]);
    expect(x.status_link).toBe("quebrado");
  });

  it("sugere conteúdo de planos antigos para o plano novo e copia o escolhido", async () => {
    const assunto = [...(await carregarPlano(demo))!.assunto.values()].find((a) => a.slug === "port-01")!;
    const pd = (await carregarPlano(demo))!;
    const ref = previaTexto(pd, AulaTextoSchema.parse({
      schema: "preparador.aulaTexto/1", assuntoId: assunto.slug, titulo: "Interpretação na prática", resumo: "r",
      secoes: [{ titulo: "s", texto: "t" }], fontes: [{ titulo: "f" }],
    }));
    if (!ref.ok) throw new Error();
    await salvarTexto(demo, ref, AulaTextoSchema.parse({
      schema: "preparador.aulaTexto/1", assuntoId: assunto.slug, titulo: "Interpretação na prática", resumo: "r",
      secoes: [{ titulo: "s", texto: "t" }], fontes: [{ titulo: "f" }],
    }));
    await desvincularTextosDoPerfil(demo);
    await excluirPerfil(demo);

    const { pid, plano } = await perfilNovo();
    const sug = await sugestoesAcervo(pid, plano);
    const interp = sug.find((s) => s.destino === "Português: Interpretação de texto")!;
    expect(interp.forte).toBe(true);
    expect(interp.origem).toMatchObject({ materia: "Língua Portuguesa", assunto: "Interpretação de textos", objetivo: "PC/SE Oficial Investigador" });
    expect(interp.aulas.length).toBeGreaterThan(0);
    expect(interp.textos.map((t) => t.titulo)).toEqual(["Interpretação na prática"]);
    // conteúdo da matéria inteira (questões sem assunto) vai para a matéria equivalente
    expect(sug.some((s) => s.destino === "Português (matéria inteira)" && s.questoes.length > 0)).toBe(true);
    // nada de Física nem de Redação oficial no acervo
    expect(sug.some((s) => s.destino.startsWith("Física") || s.destino.endsWith("Redação oficial"))).toBe(false);

    const r = await reaproveitar(pid, sug.filter((s) => s.forte));
    expect(r.aulas).toBeGreaterThan(0);
    expect(r.textos).toBe(1);
    expect((await listarAulas(pid, plano.id)).length).toBe(r.aulas);
    expect((await listarQuestoes(pid, plano.id)).length).toBe(r.questoes);
    expect(await listarTextos(pid, plano)).toHaveLength(1);

    // o que já foi copiado não é sugerido de novo
    const depois = await sugestoesAcervo(pid, plano);
    expect(depois.filter((s) => s.forte)).toHaveLength(0);
  });

  it("é usado pelo MCP depois de importar um plano", async () => {
    const pid = await criarPerfil("PF", "pt-BR", 3);
    const ctx = { perfilAtivo: () => pid, aoMudar: async () => {} };
    const chamar = async (name: string, args: Record<string, unknown>) => {
      const r = (await despachar("tools/call", { name, arguments: args }, ctx)) as { resultado: { content: { text: string }[]; isError?: boolean } };
      if (r.resultado.isError) throw new Error(r.resultado.content[0].text);
      return JSON.parse(r.resultado.content[0].text);
    };
    const imp = await chamar("importar_plano", { plano: PLANO_NOVO, confirmar: true });
    expect(imp.acervo).toContain("buscar_no_acervo");
    const busca = await chamar("buscar_no_acervo", {});
    expect(busca.sugestoes.length).toBeGreaterThan(0);
    const fraca = busca.sugestoes.find((s: { forte: boolean }) => !s.forte);
    const r = await chamar("reaproveitar_do_acervo", {});
    expect(r.temas).not.toContain(fraca?.destino);
    expect(r.copiado.aulas).toBeGreaterThan(0);
    await expect(chamar("reaproveitar_do_acervo", { indices: [999] })).rejects.toThrow("Índices inexistentes");
  });
});
