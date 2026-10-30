import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-sql", () => import("./test/sqlite-mock"));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => import("./test/arquivos-mock"));

import { arquivos } from "./test/arquivos-mock";
import { novoBanco } from "./test/sqlite-mock";
import { resumoAcervo } from "./acervo";
import { criarPerfilDemo, exportarTudo, importarTudo } from "./backup";
import { execute, getConfig, select, setConfig } from "./db";
import { AulaTextoSchema } from "./esquemas";
import { excluirPerfil, listarPerfis } from "./perfis";
import { carregarPlano } from "./planos";
import { salvarTemplate, templates } from "./prompts";
import { desvincularTextosDoPerfil, previaTexto, salvarTexto, todosTextos } from "./textos";

const aula = (assuntoId: string, titulo = "Aula de teste") =>
  AulaTextoSchema.parse({
    schema: "preparador.aulaTexto/1",
    assuntoId,
    titulo,
    resumo: "Resumo.",
    secoes: [{ titulo: "Conceito", texto: "Texto." }],
    fontes: [{ titulo: "CF/88", url: null }],
  });

async function comTexto(titulo: string) {
  const pid = await criarPerfilDemo();
  const p = (await carregarPlano(pid))!;
  const r = previaTexto(p, aula("port-01", titulo));
  if (!r.ok) throw new Error(r.erro);
  await salvarTexto(pid, r, aula("port-01", titulo));
  return pid;
}

let backup: string;
beforeEach(async () => {
  novoBanco();
  arquivos.clear();
  await comTexto("Do perfil");
  await criarPerfilDemo();
  // perfil excluído: o conteúdo dele fica só no acervo
  const excluido = await comTexto("Do excluído");
  const m = (await carregarPlano(excluido))!.materias[0];
  await execute("INSERT INTO aulas (perfil_id, materia_id, titulo, url) VALUES ($1, $2, 'Só no acervo', 'https://youtu.be/acervo')", [excluido, m.id]);
  await desvincularTextosDoPerfil(excluido);
  await excluirPerfil(excluido);
  await salvarTemplate("plano.edital", "meu prompt {{situacao}}");
  await setConfig("cor", "azul");
  backup = await exportarTudo();
});

describe("backup completo", () => {
  it("leva perfis, acervo, prompts e aparência para outro computador", async () => {
    const acervo = await resumoAcervo();
    const perfis = (await listarPerfis()).map((p) => p.nome);

    novoBanco();
    arquivos.clear();
    const r = await importarTudo(backup);
    expect(r.perfis).toBe(2);
    expect((await listarPerfis()).map((p) => p.nome)).toEqual(perfis);
    expect(await resumoAcervo()).toEqual(acervo);
    expect(await select("SELECT titulo FROM acervo_aulas WHERE url = 'https://youtu.be/acervo'")).toEqual([{ titulo: "Só no acervo" }]);
    const textos = await todosTextos();
    expect(textos.find((t) => t.titulo === "Do excluído")).toMatchObject({ perfilId: null, tema: { assunto: "Interpretação de textos" } });
    expect(textos.find((t) => t.titulo === "Do perfil")!.perfilId).not.toBeNull();
    expect((await templates())["plano.edital"]).toEqual({ texto: "meu prompt {{situacao}}", editado: true });
    expect(await getConfig("cor")).toBe("azul");
  });

  it("importar de novo duplica os perfis mas não o acervo", async () => {
    const acervo = await resumoAcervo();
    const r = await importarTudo(backup);
    expect(r).toMatchObject({ perfis: 2, acervo: 0, textos: 0 });
    expect(await listarPerfis()).toHaveLength(4);
    expect({ ...(await resumoAcervo()), textos: 0 }).toEqual({ ...acervo, textos: 0 });
  });

  it("recusa arquivo inválido sem criar nada", async () => {
    const j = JSON.parse(backup);
    j.acervo.questoes[0].tipo = "XX";
    await expect(importarTudo(JSON.stringify(j))).rejects.toThrow();
    await expect(importarTudo('{"schema":"preparador.backup/1"}')).rejects.toThrow();
    expect(await listarPerfis()).toHaveLength(2);
  });
});
