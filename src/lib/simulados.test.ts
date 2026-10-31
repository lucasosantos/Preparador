import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-sql", () => import("./test/sqlite-mock"));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => import("./test/arquivos-mock"));

import { arquivos } from "./test/arquivos-mock";
import { novoBanco } from "./test/sqlite-mock";
import { criarPerfilDemo, exportarPerfil, importarBackup } from "./backup";
import { QuestoesSchema } from "./esquemas";
import { carregarPlano, type Plano } from "./planos";
import { montarPrompt } from "./prompts";
import { listarQuestoes, previaQuestoes, responder } from "./questoes";
import {
  carregarSimulado,
  cotasIa,
  criarDaIa,
  disponiveis,
  distribuir,
  excluirSimulado,
  finalizarSimulado,
  iniciarSimulado,
  listarSimulados,
  marcarResposta,
  montarDoBanco,
  refazerSimulado,
  resultado,
  varsSimuladoIa,
} from "./simulados";

let pid: number;
let plano: Plano;
beforeEach(async () => {
  novoBanco();
  arquivos.clear();
  pid = await criarPerfilDemo();
  plano = (await carregarPlano(pid))!;
});

const todas = () => plano.materias.map((m) => m.id);

describe("distribuir", () => {
  it("divide pelo peso e fecha o total", () => {
    const d = distribuir([{ id: 1, peso: 3, disponiveis: 99 }, { id: 2, peso: 1, disponiveis: 99 }, { id: 3, peso: 1, disponiveis: 99 }], 10);
    expect([...d.values()]).toEqual([6, 2, 2]);
  });

  it("não passa do disponível e repassa a sobra", () => {
    const d = distribuir([{ id: 1, peso: 5, disponiveis: 2 }, { id: 2, peso: 1, disponiveis: 10 }, { id: 3, peso: 1, disponiveis: 0 }], 9);
    expect(Object.fromEntries(d)).toEqual({ 1: 2, 2: 7, 3: 0 });
  });

  it("para no total disponível", () => {
    const d = distribuir([{ id: 1, peso: 1, disponiveis: 2 }, { id: 2, peso: 1, disponiveis: 1 }], 50);
    expect([...d.values()].reduce((a, b) => a + b)).toBe(3);
  });
});

describe("montar do banco", () => {
  it("respeita matérias, total e situação, e cobre assuntos diferentes", async () => {
    const [m1, m2] = plano.materias;
    const id = (await montarDoBanco(pid, plano, { titulo: "T", materiaIds: [m1.id, m2.id], total: 6, situacao: "todas", tempoMin: 30, seed: "x" }))!;
    const r = (await carregarSimulado(id))!;
    expect(r.simulado).toMatchObject({ titulo: "T", origem: "banco", tempo_min: 30, finalizado_em: null });
    expect(r.itens.length).toBe(Math.min(6, (await disponiveis(pid, plano, "todas")).get(m1.id)! + (await disponiveis(pid, plano, "todas")).get(m2.id)!));
    expect(r.itens.every((i) => i.q.materia_id === m1.id || i.q.materia_id === m2.id)).toBe(true);
    // matérias agrupadas, na ordem do plano
    const ordem = r.itens.map((i) => i.q.materia_id);
    expect(ordem).toEqual([...ordem].sort((a, b) => plano.materia.get(a)!.ordem - plano.materia.get(b)!.ordem));
  });

  it("inéditas deixa de fora as respondidas; erradas pega só as erradas", async () => {
    const qs = await listarQuestoes(pid, plano.id);
    const certa = qs[0];
    const errada = qs[1];
    await responder(pid, certa, certa.gabarito, "2026-10-01");
    await responder(pid, errada, errada.gabarito === "C" ? "E" : "Z", "2026-10-01");
    const ined = (await carregarSimulado((await montarDoBanco(pid, plano, { titulo: "", materiaIds: todas(), total: 200, situacao: "ineditas", tempoMin: null }))!))!;
    expect(ined.itens.length).toBe(qs.length - 2);
    expect(ined.simulado.titulo).toBe("Simulado");
    const err = (await carregarSimulado((await montarDoBanco(pid, plano, { titulo: "E", materiaIds: todas(), total: 10, situacao: "erradas", tempoMin: 0 }))!))!;
    expect(err.itens.map((i) => i.q.id)).toEqual([errada.id]);
    expect(err.simulado.tempo_min).toBeNull();
    expect(await montarDoBanco(pid, plano, { titulo: "", materiaIds: [], total: 10, situacao: "todas", tempoMin: null })).toBeNull();
  });
});

describe("fazer a prova", () => {
  it("grava respostas, corrige ao finalizar e registra no histórico das questões", async () => {
    const id = (await montarDoBanco(pid, plano, { titulo: "P", materiaIds: todas(), total: 4, situacao: "todas", tempoMin: null, seed: "s" }))!;
    const { itens } = (await carregarSimulado(id))!;
    const [a, b, c] = itens;
    const errar = (g: string) => (g === "C" ? "E" : g === "E" ? "C" : g === "A" ? "B" : "A");
    expect(await iniciarSimulado(id)).toBe(await iniciarSimulado(id));
    await marcarResposta(id, a.q.id, a.q.gabarito);
    await marcarResposta(id, b.q.id, errar(b.q.gabarito));
    await marcarResposta(id, c.q.id, a.q.gabarito);
    await marcarResposta(id, c.q.id, null); // apagou: fica em branco

    let r = (await carregarSimulado(id))!;
    expect(r.itens.map((i) => [i.resposta, i.acertou])).toEqual([[a.q.gabarito, null], [errar(b.q.gabarito), null], [null, null], [null, null]]);

    await finalizarSimulado(id, "2026-10-31");
    r = (await carregarSimulado(id))!;
    expect(r.simulado.finalizado_em).not.toBeNull();
    expect(r.simulado.duracao_seg).toBeGreaterThanOrEqual(0);
    expect(r.itens.map((i) => i.acertou)).toEqual([true, false, null, null]);
    const { geral } = resultado(r.itens);
    expect(geral).toMatchObject({ total: 4, acertos: 1, erros: 1, brancos: 2 });

    // finalizado não muda
    await marcarResposta(id, c.q.id, c.q.gabarito);
    await finalizarSimulado(id);
    expect((await carregarSimulado(id))!.itens[2].resposta).toBeNull();

    const banco = new Map((await listarQuestoes(pid, plano.id)).map((q) => [q.id, q]));
    expect(banco.get(a.q.id)!.resposta).toMatchObject({ acertou: true, data: "2026-10-31" });
    expect(banco.get(b.q.id)!.resposta).toMatchObject({ acertou: false });
    expect(banco.get(c.q.id)!.resposta).toBeNull();

    const [resumo] = await listarSimulados(pid);
    expect(resumo).toMatchObject({ id, total: 4, respondidas: 2, acertos: 1 });
  });

  it("refazer copia as questões em branco; excluir apaga", async () => {
    const id = (await montarDoBanco(pid, plano, { titulo: "R", materiaIds: todas(), total: 5, situacao: "todas", tempoMin: 60, seed: "r" }))!;
    const orig = (await carregarSimulado(id))!;
    await marcarResposta(id, orig.itens[0].q.id, "C");
    await finalizarSimulado(id);
    const novo = (await refazerSimulado(id))!;
    const r = (await carregarSimulado(novo))!;
    expect(r.simulado).toMatchObject({ titulo: "R (refeito)", tempo_min: 60, finalizado_em: null, iniciado_em: null });
    expect(r.itens.map((i) => i.q.id)).toEqual(orig.itens.map((i) => i.q.id));
    expect(r.itens.every((i) => i.resposta == null)).toBe(true);
    expect((await carregarSimulado((await refazerSimulado(novo))!))!.simulado.titulo).toBe("R (refeito)");
    await excluirSimulado(id);
    expect(await carregarSimulado(id)).toBeNull();
  });
});

describe("simulado gerado pela IA", () => {
  it("prompt leva a distribuição pelo peso e os assuntos só das matérias escolhidas", async () => {
    const [m1, m2, m3] = plano.materias;
    const cotas = cotasIa(plano, [m1.id, m2.id], 20);
    expect(cotas.get(m1.id)! + cotas.get(m2.id)!).toBe(20);
    const p = await montarPrompt("simulados.gerar", varsSimuladoIa(plano, "pt-BR", { materiaIds: [m1.id, m2.id], total: 20, tipo: "CE" }));
    expect(p).toContain(`${m1.nome} (materiaId ${m1.slug}): ${cotas.get(m1.id)} questões`);
    expect(p).toContain(`${m2.slug} | ${m2.assuntos[0].slug}`);
    expect(p).not.toContain(`${m3.slug} | `);
    expect(p).toContain("Português (Brasil)");
    expect(p).not.toMatch(/\{\{\w+\}\}/);
  });

  it("novas entram no banco, repetidas são reaproveitadas, na ordem da IA", async () => {
    const existente = (await listarQuestoes(pid, plano.id))[0];
    const a = plano.materias[0].assuntos[0];
    const json = {
      schema: "preparador.questoes/1",
      questoes: [
        { materiaId: plano.materias[0].slug, assuntoId: a.slug, tipo: "CE", enunciado: "Questão nova um.", gabarito: "C", explicacao: "x" },
        { materiaId: plano.materia.get(existente.materia_id)!.slug, assuntoId: null, tipo: existente.tipo, enunciado: existente.enunciado,
          alternativas: existente.alternativas, gabarito: existente.gabarito },
        { materiaId: "nao-existe", assuntoId: null, tipo: "CE", enunciado: "Sem matéria.", gabarito: "E" },
        { materiaId: plano.materias[0].slug, assuntoId: a.slug, tipo: "ME", enunciado: "Questão nova dois.", alternativas: ["a", "b", "c", "d"], gabarito: "B" },
      ],
    };
    const dados = QuestoesSchema.parse(json);
    const antes = (await listarQuestoes(pid, plano.id)).length;
    const previa = await previaQuestoes(pid, plano, dados);
    const id = (await criarDaIa(pid, plano, dados, previa, JSON.stringify(json), { titulo: "IA", tempoMin: 20 }))!;
    expect((await listarQuestoes(pid, plano.id)).length).toBe(antes + 2);
    const r = (await carregarSimulado(id))!;
    expect(r.simulado).toMatchObject({ origem: "ia", tempo_min: 20 });
    expect(r.itens.map((i) => i.q.enunciado)).toEqual(["Questão nova um.", existente.enunciado, "Questão nova dois."]);
  });
});

describe("backup", () => {
  it("leva os simulados com respostas para o perfil restaurado", async () => {
    const id = (await montarDoBanco(pid, plano, { titulo: "B", materiaIds: todas(), total: 3, situacao: "todas", tempoMin: 45, seed: "b" }))!;
    const { itens } = (await carregarSimulado(id))!;
    await iniciarSimulado(id);
    await marcarResposta(id, itens[0].q.id, itens[0].q.gabarito);
    await finalizarSimulado(id);
    await montarDoBanco(pid, plano, { titulo: "Aberto", materiaIds: todas(), total: 2, situacao: "todas", tempoMin: null, seed: "c" });

    const novo = await importarBackup(await exportarPerfil(pid));
    const lista = await listarSimulados(novo);
    expect(lista.map((s) => [s.titulo, s.total, s.respondidas, s.acertos, !!s.finalizado_em])).toEqual([
      ["Aberto", 2, 0, 0, false],
      ["B", 3, 1, 1, true],
    ]);
    const r = (await carregarSimulado(lista[1].id))!;
    expect(r.simulado.tempo_min).toBe(45);
    expect(r.itens.map((i) => i.q.enunciado)).toEqual(itens.map((i) => i.q.enunciado));
  });
});
