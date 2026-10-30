// Acervo: aulas, questões e aulas em texto de todos os planos que já passaram
// pelo app (tabelas acervo_* da migração 0004 e o índice da biblioteca).
// Ao montar um plano novo, procura no acervo os temas parecidos com cada
// assunto e sugere o conteúdo para reaproveitar.
import { execute, first, insertMany, select } from "./db";
import type { Plano } from "./planos";
import { completarTemas, lerTexto, salvarTexto, todosTextos, type ItemBiblioteca } from "./textos";

type TemaDb = { id: number; materia: string; assunto: string; detalhe: string | null; objetivo: string | null; banca: string | null };
export type AulaAcervo = { id: number; tema_id: number; titulo: string; url: string; canal: string | null; duracao_min: number | null; status_link: string };
export type QuestaoAcervo = {
  id: number;
  tema_id: number;
  tipo: "CE" | "ME";
  enunciado: string;
  alternativas: string | null;
  gabarito: string;
  explicacao: string | null;
  fonte: string | null;
  gabarito_oficial: number;
};

export type Sugestao = {
  /** destino no plano atual; assuntoId null = matéria inteira */
  materiaId: number;
  assuntoId: number | null;
  destino: string;
  origem: { materia: string; assunto: string; objetivo: string | null; banca: string | null };
  /** 0 a 1: semelhança entre o tema do acervo e o assunto do plano */
  score: number;
  forte: boolean;
  aulas: AulaAcervo[];
  questoes: QuestaoAcervo[];
  textos: ItemBiblioteca[];
};

export const LIMITE_FORTE = 0.8;
const LIMITE_MINIMO = 0.55;

const VAZIAS = new Set(
  "a o as os e de da do das dos em no na nos nas ao aos para por pelo pela com sem sobre um uma seu sua suas seus que ou noc nocoes geral gerais basico basicos introducao".split(" "),
);

/** Radical simples: tira plural e vogal final e corta em 6 letras ("textos" = "texto", "orações" = "oração"). */
function radical(p: string) {
  if (p.length <= 3 || /\d/.test(p)) return p;
  let r = p.replace(/oes$|aes$/, "ao").replace(/s$/, "");
  if (r.length > 3) r = r.replace(/[aeo]$/, "");
  return r.slice(0, 6);
}

/** Palavras do nome sem acento e sem palavras vazias, reduzidas ao radical. */
export function radicais(texto: string | null | undefined): Set<string> {
  const palavras = (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p && !VAZIAS.has(p) && (p.length > 1 || /\d/.test(p)));
  return new Set(palavras.map(radical));
}

/** Peso de cada radical: palavras que aparecem em muitos temas ("crime", "direito") valem menos. */
export type Pesos = (radical: string) => number;
const semPeso: Pesos = () => 1;

export function pesosPorRaridade(nomes: string[]): Pesos {
  const df = new Map<string, number>();
  for (const n of nomes) for (const r of radicais(n)) df.set(r, (df.get(r) ?? 0) + 1);
  const total = nomes.length;
  return (r) => Math.log(1 + total / (df.get(r) ?? 1));
}

function soma(a: Set<string>, w: Pesos) {
  let t = 0;
  for (const x of a) t += w(x);
  return t;
}

function comum(a: Set<string>, b: Set<string>, w: Pesos) {
  let t = 0;
  for (const x of a) if (b.has(x)) t += w(x);
  return t;
}

function dice(a: Set<string>, b: Set<string>, w: Pesos = semPeso) {
  if (!a.size || !b.size) return 0;
  return (2 * comum(a, b, w)) / (soma(a, w) + soma(b, w));
}

/** Quanto do nome menor está dentro do maior ("Crase" em "Emprego da crase"). */
function contencao(a: Set<string>, b: Set<string>, w: Pesos = semPeso) {
  if (!a.size || !b.size) return 0;
  return comum(a, b, w) / Math.min(soma(a, w), soma(b, w));
}

/** "Português" ≈ "Língua Portuguesa", "Informática" ≈ "Noções de Informática". */
export function semelhancaMateria(a: string, b: string) {
  const ra = radicais(a),
    rb = radicais(b);
  return Math.max(dice(ra, rb), 0.9 * contencao(ra, rb));
}

export function semelhancaAssunto(
  a: { materia: string; nome: string; detalhe?: string | null },
  b: { materia: string; nome: string; detalhe?: string | null },
  w: Pesos = semPeso,
) {
  const ra = radicais(a.nome),
    rb = radicais(b.nome);
  const nome = Math.max(dice(ra, rb, w), 0.85 * contencao(ra, rb, w));
  const comDetalhe = 0.85 * dice(radicais(`${a.nome} ${a.detalhe ?? ""}`), radicais(`${b.nome} ${b.detalhe ?? ""}`), w);
  const mesmaMateria = semelhancaMateria(a.materia, b.materia) >= 0.6;
  return Math.max(nome, comDetalhe) * (mesmaMateria ? 1 : 0.6);
}

export async function resumoAcervo() {
  const r = await first<{ temas: number; aulas: number; questoes: number }>(
    `SELECT (SELECT COUNT(*) FROM acervo_temas) AS temas,
            (SELECT COUNT(*) FROM acervo_aulas) AS aulas,
            (SELECT COUNT(*) FROM acervo_questoes) AS questoes`,
  );
  const textos = (await todosTextos()).length;
  return { temas: r?.temas ?? 0, aulas: r?.aulas ?? 0, questoes: r?.questoes ?? 0, textos };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Conteúdo do acervo que serve para o plano do perfil e ainda não está nele.
 * Cada tema do acervo vai para o assunto (ou matéria) mais parecido do plano.
 */
export async function sugestoesAcervo(perfilId: number, plano: Plano): Promise<Sugestao[]> {
  await completarTemas();
  const [temas, aulas, questoes, textos, jaAulas, jaQuestoes] = await Promise.all([
    select<TemaDb>("SELECT id, materia, assunto, detalhe, objetivo, banca FROM acervo_temas"),
    select<AulaAcervo>("SELECT id, tema_id, titulo, url, canal, duracao_min, status_link FROM acervo_aulas WHERE status_link != 'quebrado' ORDER BY id"),
    select<QuestaoAcervo>(
      "SELECT id, tema_id, tipo, enunciado, alternativas, gabarito, explicacao, fonte, gabarito_oficial FROM acervo_questoes ORDER BY id",
    ),
    todosTextos(),
    select<{ url: string }>("SELECT url FROM aulas WHERE perfil_id = $1", [perfilId]),
    select<{ enunciado: string }>("SELECT enunciado FROM questoes WHERE perfil_id = $1", [perfilId]),
  ]);

  const temaPorChave = new Map(temas.map((t) => [`${t.materia}\u0000${t.assunto}`, t]));
  const porTema = new Map<number, { aulas: AulaAcervo[]; questoes: QuestaoAcervo[]; textos: ItemBiblioteca[] }>();
  const doTema = (id: number) => porTema.get(id) ?? porTema.set(id, { aulas: [], questoes: [], textos: [] }).get(id)!;
  for (const a of aulas) doTema(a.tema_id).aulas.push(a);
  for (const q of questoes) doTema(q.tema_id).questoes.push(q);
  for (const t of textos) {
    const tema = t.tema && temaPorChave.get(`${t.tema.materia}\u0000${t.tema.assunto}`);
    if (tema && t.perfilId !== perfilId) doTema(tema.id).textos.push(t);
  }

  const urls = new Set(jaAulas.map((a) => a.url));
  const enunciados = new Set(jaQuestoes.map((q) => norm(q.enunciado)));
  const titulosTexto = new Set(textos.filter((t) => t.perfilId === perfilId).map((t) => `${t.assuntoId}|${norm(t.titulo)}`));

  const pesos = pesosPorRaridade([...temas.filter((t) => t.assunto).map((t) => t.assunto), ...[...plano.assunto.values()].map((a) => a.nome)]);
  const out: Sugestao[] = [];
  for (const tema of temas) {
    const c = porTema.get(tema.id);
    if (!c) continue;
    // melhor destino no plano para este tema
    let melhor: { materiaId: number; assuntoId: number | null; score: number; destino: string } | null = null;
    for (const m of plano.materias) {
      if (!tema.assunto) {
        const s = semelhancaMateria(tema.materia, m.nome);
        if (s >= 0.6 && (!melhor || s > melhor.score)) melhor = { materiaId: m.id, assuntoId: null, score: s, destino: `${m.nome} (matéria inteira)` };
        continue;
      }
      for (const a of m.assuntos) {
        const s = semelhancaAssunto(
          { materia: tema.materia, nome: tema.assunto, detalhe: tema.detalhe },
          { materia: m.nome, nome: a.nome, detalhe: a.detalhe },
          pesos,
        );
        if (s > (melhor?.score ?? 0)) melhor = { materiaId: m.id, assuntoId: a.id, score: s, destino: `${m.nome}: ${a.nome}` };
      }
    }
    if (!melhor || melhor.score < LIMITE_MINIMO) continue;

    const novasAulas = c.aulas.filter((a) => !urls.has(a.url));
    const novasQuestoes = c.questoes.filter((q) => !enunciados.has(norm(q.enunciado)));
    const novosTextos = melhor.assuntoId == null ? [] : c.textos.filter((t) => !titulosTexto.has(`${melhor.assuntoId}|${norm(t.titulo)}`));
    if (!novasAulas.length && !novasQuestoes.length && !novosTextos.length) continue;
    out.push({
      ...melhor,
      score: Math.round(melhor.score * 100) / 100,
      forte: melhor.score >= LIMITE_FORTE,
      origem: { materia: tema.materia, assunto: tema.assunto, objetivo: tema.objetivo, banca: tema.banca },
      aulas: novasAulas,
      questoes: novasQuestoes,
      textos: novosTextos,
    });
  }

  // na ordem do plano; a matéria inteira antes dos assuntos dela
  const ordem = (s: Sugestao) => {
    const m = plano.materia.get(s.materiaId)!;
    return m.ordem * 1e6 + (s.assuntoId == null ? -1 : plano.assunto.get(s.assuntoId)!.ordem) * 10 + (1 - s.score);
  };
  return out.sort((a, b) => ordem(a) - ordem(b));
}

/** Copia para o perfil o conteúdo das sugestões escolhidas, sem repetir o que um tema já trouxe. */
export async function reaproveitar(perfilId: number, sugestoes: Sugestao[]) {
  const total = { aulas: 0, questoes: 0, textos: 0 };
  const urls = new Set<string>();
  const enunciados = new Set<string>();
  const linhasAulas: unknown[][] = [];
  for (const s of sugestoes)
    for (const a of s.aulas) {
      const k = `${s.assuntoId}|${a.url}`;
      if (urls.has(k)) continue;
      urls.add(k);
      linhasAulas.push([perfilId, s.materiaId, s.assuntoId, a.titulo, a.url, a.canal, a.duracao_min, a.status_link]);
    }
  if (linhasAulas.length)
    await insertMany("aulas", ["perfil_id", "materia_id", "assunto_id", "titulo", "url", "canal", "duracao_min", "status_link"], linhasAulas);
  total.aulas = linhasAulas.length;

  const linhasQ: unknown[][] = [];
  for (const s of sugestoes)
    for (const q of s.questoes) {
      if (enunciados.has(norm(q.enunciado))) continue;
      enunciados.add(norm(q.enunciado));
      linhasQ.push([perfilId, s.materiaId, s.assuntoId, q.tipo, q.enunciado, q.alternativas, q.gabarito, q.explicacao, "banco", q.fonte, q.gabarito_oficial]);
    }
  if (linhasQ.length)
    await insertMany(
      "questoes",
      ["perfil_id", "materia_id", "assunto_id", "tipo", "enunciado", "alternativas", "gabarito", "explicacao", "origem", "fonte", "gabarito_oficial"],
      linhasQ,
    );
  total.questoes = linhasQ.length;

  for (const s of sugestoes) {
    if (s.assuntoId == null) continue;
    for (const t of s.textos) {
      const r = await lerTexto(t.id);
      if (!r) continue;
      await salvarTexto(perfilId, { materiaId: s.materiaId, assuntoId: s.assuntoId }, r.aula, { criadaEm: t.criadaEm });
      total.textos++;
    }
  }
  if (total.aulas + total.questoes + total.textos)
    await execute("INSERT INTO importacoes (perfil_id, tipo, json_bruto) VALUES ($1, 'aulas', $2)", [
      perfilId,
      JSON.stringify({ acervo: sugestoes.map((s) => ({ destino: s.destino, origem: s.origem, score: s.score })) }),
    ]);
  return total;
}
