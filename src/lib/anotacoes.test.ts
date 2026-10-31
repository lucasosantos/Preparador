import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-sql", () => import("./test/sqlite-mock"));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => import("./test/arquivos-mock"));

import { arquivos } from "./test/arquivos-mock";
import { novoBanco } from "./test/sqlite-mock";
import {
  ancestrais,
  blocosDaPagina,
  criarPagina,
  excluirBloco,
  excluirPagina,
  extrairMencoes,
  inserirBloco,
  lerPagina,
  listarPaginas,
  mencionadaEm,
  montarArvore,
  moverBloco,
  moverPagina,
  paginasDoTema,
  reordenarPagina,
  salvarBloco,
  textoDeTrechos,
  textoPlano,
  trechos,
  trocarMencoes,
  vincularPagina,
} from "./anotacoes";
import { criarPerfilDemo, exportarPerfil, importarBackup } from "./backup";
import { execute } from "./db";
import { carregarPlano, type Plano } from "./planos";

let pid: number;
let plano: Plano;
beforeEach(async () => {
  novoBanco();
  arquivos.clear();
  pid = await criarPerfilDemo();
  plano = (await carregarPlano(pid))!;
});

describe("formato inline", () => {
  it("lê negrito, itálico, código, link e menções", () => {
    expect(trechos("a **b** _c_ `d*` [e](https://x.y) [[p:12|Pág\\]ina]]")).toEqual([
      { t: "a " },
      { t: "b", b: true },
      { t: " " },
      { t: "c", i: true },
      { t: " " },
      { t: "d*", code: true },
      { t: " " },
      { t: "e", href: "https://x.y" },
      { t: " " },
      { mencao: { tipo: "p", ref: "12", rotulo: "Pág]ina" } },
    ]);
  });

  it("ida e volta preserva o texto, inclusive caracteres especiais e formatos colados", () => {
    const casos = [
      [{ t: "snake_case com * e [colchetes] e \\" }],
      [{ t: "it", i: true }, { t: "bold", b: true }, { t: "ambos", b: true, i: true }, { t: " fim" }],
      [{ t: "link (x)", href: "https://a.b/c d)", b: true }],
      [{ mencao: { tipo: "a" as const, ref: "7", rotulo: "Crase | uso" } }, { t: "`cod`", code: true }],
    ];
    for (const ts of casos) {
      const volta = trechos(textoDeTrechos(ts));
      expect(textoPlano(textoDeTrechos(volta))).toBe(textoPlano(textoDeTrechos(ts)));
      expect(textoDeTrechos(volta)).toBe(textoDeTrechos(ts));
    }
    expect(trechos(textoDeTrechos([{ t: "it", i: true }, { t: "bold", b: true }]))).toEqual([
      { t: "it", i: true },
      { t: "bold", b: true },
    ]);
    expect(trechos(textoDeTrechos([{ t: "x", href: "https://a.b/c d)" }]))).toEqual([{ t: "x", href: "https://a.b/c%20d%29" }]);
  });

  it("extrai menções sem repetir e troca referências", () => {
    const t = "ver [[p:1|A]] e [[a:5|B]] e [[p:1|A de novo]]";
    expect(extrairMencoes(t)).toEqual([
      { alvo: "pagina", id: 1 },
      { alvo: "assunto", id: 5 },
    ]);
    expect(trocarMencoes(t, (m) => (m.tipo === "p" ? "9" : null))).toBe("ver [[p:9|A]] e B e [[p:9|A de novo]]");
  });
});

describe("páginas", () => {
  it("monta a árvore na ordem de criação e acha os ancestrais", async () => {
    const a = await criarPagina(pid, { titulo: "A" });
    const b = await criarPagina(pid, { titulo: "B" });
    const a1 = await criarPagina(pid, { paiId: a, titulo: "A1" });
    const a1x = await criarPagina(pid, { paiId: a1, titulo: "A1x" });
    const ps = await listarPaginas(pid);
    const arv = montarArvore(ps);
    expect(arv.map((p) => p.titulo)).toEqual(["A", "B"]);
    expect(arv[0].filhos.map((p) => p.titulo)).toEqual(["A1"]);
    expect(ancestrais(ps, a1x).map((p) => p.id)).toEqual([a, a1]);
    expect(await blocosDaPagina(b)).toHaveLength(1);
  });

  it("move entre pais, recusa ciclo e reordena irmãs", async () => {
    const a = await criarPagina(pid, { titulo: "A" });
    const b = await criarPagina(pid, { titulo: "B" });
    const a1 = await criarPagina(pid, { paiId: a, titulo: "A1" });
    await expect(moverPagina(a, a1)).rejects.toThrow();
    await expect(moverPagina(a, a)).rejects.toThrow();
    await moverPagina(b, a);
    let arv = montarArvore(await listarPaginas(pid));
    expect(arv[0].filhos.map((p) => p.titulo)).toEqual(["A1", "B"]);
    await reordenarPagina(b, -1);
    arv = montarArvore(await listarPaginas(pid));
    expect(arv[0].filhos.map((p) => p.titulo)).toEqual(["B", "A1"]);
    await moverPagina(b, null);
    expect(montarArvore(await listarPaginas(pid)).map((p) => p.titulo)).toEqual(["A", "B"]);
  });

  it("excluir leva subpáginas, blocos e menções feitas por eles", async () => {
    const a = await criarPagina(pid, { titulo: "A" });
    const a1 = await criarPagina(pid, { paiId: a, titulo: "A1" });
    const outra = await criarPagina(pid, { titulo: "Outra" });
    const [b] = await blocosDaPagina(a1);
    await salvarBloco(b.id, { texto: `[[p:${outra}|Outra]]` });
    expect(await mencionadaEm(pid, "pagina", outra)).toHaveLength(1);
    await excluirPagina(a);
    expect((await listarPaginas(pid)).map((p) => p.titulo)).toEqual(["Outra"]);
    expect(await mencionadaEm(pid, "pagina", outra)).toEqual([]);
  });

  it("perde o vínculo quando o assunto sai do plano", async () => {
    const assunto = plano.materias[0].assuntos[0];
    const p = await criarPagina(pid, { titulo: "Resumo" });
    await vincularPagina(p, null, assunto.id);
    expect(await lerPagina(p)).toMatchObject({ materia_id: assunto.materia_id, assunto_id: assunto.id });
    await execute("DELETE FROM assuntos WHERE id = $1", [assunto.id]);
    expect(await lerPagina(p)).toMatchObject({ materia_id: assunto.materia_id, assunto_id: null });
  });
});

describe("blocos", () => {
  it("insere entre blocos, renumera quando falta espaço e move", async () => {
    const p = await criarPagina(pid);
    const [primeiro] = await blocosDaPagina(p);
    const fim = await inserirBloco(p, primeiro.id, { texto: "fim" });
    // muitas inserções no mesmo ponto esgotam o intervalo e forçam a renumeração
    for (let k = 0; k < 60; k++) await inserirBloco(p, primeiro.id, { texto: `m${k}` });
    const bs = await blocosDaPagina(p);
    expect(bs[0].id).toBe(primeiro.id);
    expect(bs[1].texto).toBe("m59");
    expect(bs.at(-1)!.id).toBe(fim.id);
    expect(new Set(bs.map((b) => b.ordem)).size).toBe(bs.length);
    const inicio = await inserirBloco(p, null, { texto: "início" });
    expect((await blocosDaPagina(p))[0].id).toBe(inicio.id);
    await moverBloco(inicio.id, 1);
    expect((await blocosDaPagina(p)).slice(0, 2).map((b) => b.id)).toEqual([primeiro.id, inicio.id]);
  });

  it("salva campos e a página nunca fica sem bloco", async () => {
    const p = await criarPagina(pid);
    const [b] = await blocosDaPagina(p);
    await salvarBloco(b.id, { tipo: "tarefa", marcado: 1, nivel: 2 });
    expect((await blocosDaPagina(p))[0]).toMatchObject({ tipo: "tarefa", marcado: 1, nivel: 2, texto: "" });
    await excluirBloco(b.id);
    const resto = await blocosDaPagina(p);
    expect(resto).toHaveLength(1);
    expect(resto[0]).toMatchObject({ tipo: "paragrafo", texto: "" });
  });
});

describe("menções e tema", () => {
  it("lista quem menciona e as páginas do assunto (vinculadas primeiro)", async () => {
    const assunto = plano.materias[0].assuntos[0];
    const alvo = await criarPagina(pid, { titulo: "Alvo" });
    const vinc = await criarPagina(pid, { titulo: "Vinculada", assuntoId: assunto.id, materiaId: assunto.materia_id });
    const cita = await criarPagina(pid, { titulo: "Cita" });
    const [b] = await blocosDaPagina(cita);
    await salvarBloco(b.id, { texto: `sobre [[a:${assunto.id}|x]] e [[p:${alvo}|Alvo]]` });
    // a própria página mencionando a si mesma não conta
    const [ba] = await blocosDaPagina(alvo);
    await salvarBloco(ba.id, { texto: `[[p:${alvo}|eu]]` });

    expect((await mencionadaEm(pid, "pagina", alvo)).map((r) => [r.id, r.trecho])).toEqual([[cita, "sobre x e Alvo"]]);
    expect((await paginasDoTema(pid, assunto.materia_id, assunto.id)).map((r) => r.id)).toEqual([vinc, cita]);
    expect(await paginasDoTema(pid, assunto.materia_id, null)).toEqual([]);
    expect((await paginasDoTema(pid, assunto.materia_id, null, { todaMateria: true })).map((r) => r.id)).toEqual([vinc, cita]);
    expect(await paginasDoTema(pid, plano.materias[1].id, null, { todaMateria: true })).toEqual([]);
  });
});

describe("backup", () => {
  it("leva árvore, vínculos e menções para o perfil restaurado", async () => {
    const assunto = plano.materias[1].assuntos[2];
    const raiz = await criarPagina(pid, { titulo: "Raiz" });
    const filha = await criarPagina(pid, { paiId: raiz, titulo: "Filha" });
    await vincularPagina(filha, null, assunto.id);
    const [b] = await blocosDaPagina(raiz);
    await salvarBloco(b.id, { tipo: "h2", texto: `**ver** [[p:${filha}|Filha]] e [[a:${assunto.id}|${assunto.nome}]] e [[p:99999|Sumiu]]` });
    await inserirBloco(raiz, b.id, { tipo: "tarefa", texto: "estudar", marcado: 1 });

    const novo = await importarBackup(await exportarPerfil(pid));
    const novoPlano = (await carregarPlano(novo))!;
    const ps = await listarPaginas(novo);
    const arv = montarArvore(ps);
    expect(arv.map((p) => p.titulo)).toEqual(["Raiz"]);
    const nf = arv[0].filhos[0];
    expect(nf.titulo).toBe("Filha");
    const novoAssunto = [...novoPlano.assunto.values()].find((a) => a.slug === assunto.slug)!;
    expect(nf.assunto_id).toBe(novoAssunto.id);
    expect(nf.id).not.toBe(filha);

    const bs = await blocosDaPagina(arv[0].id);
    expect(bs.map((x) => x.tipo)).toEqual(["h2", "tarefa"]);
    expect(bs[0].texto).toBe(`**ver** [[p:${nf.id}|Filha]] e [[a:${novoAssunto.id}|${assunto.nome}]] e Sumiu`);
    expect(bs[1]).toMatchObject({ texto: "estudar", marcado: 1 });
    expect((await mencionadaEm(novo, "pagina", nf.id)).map((r) => r.id)).toEqual([arv[0].id]);
  });
});
