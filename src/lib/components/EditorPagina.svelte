<script lang="ts">
  import { tick, untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { app } from "$lib/app.svelte";
  import {
    ancestrais,
    atualizarPagina,
    blocosDaPagina,
    criarPagina,
    excluirBloco,
    inserirBloco,
    mencionadaEm,
    moverBloco,
    salvarBloco,
    textoDeTrechos,
    trechos,
    vincularPagina,
    type Bloco,
    type DadosBloco,
    type Mencao,
    type Pagina,
    type Referencia,
  } from "$lib/anotacoes";
  import { colocarCursor } from "$lib/editorNotas";
  import BlocoNota, { type AcaoBloco, type CtxEditor, type OpcaoMencao } from "./BlocoNota.svelte";

  let {
    pagina,
    paginas,
    ontitulo,
    onmudou,
  }: {
    pagina: Pagina;
    /** todas as páginas do perfil: nomes das menções e caminho */
    paginas: Pagina[];
    /** título digitado, para a árvore acompanhar sem recarregar */
    ontitulo: (titulo: string) => void;
    /** algo que a árvore mostra mudou (página criada, ícone, vínculo) */
    onmudou: () => Promise<void> | void;
  } = $props();

  const ICONES = ["📘", "📗", "📕", "📙", "📓", "📝", "✏️", "📌", "⭐", "🔥", "💡", "✅", "❓", "⚖️", "🧠", "🧮", "🌎", "🏛️", "📊", "🗂️", "🎯", "⏳", "🔍", "📎"];

  let blocos = $state<Bloco[]>([]);
  let carregado = $state(false);
  let citacoes = $state.raw<Referencia[]>([]);
  let titulo = $state("");
  let escolhendoIcone = $state(false);
  const refs = new Map<number, HTMLElement>();
  let tituloEl = $state<HTMLInputElement | null>(null);

  // ---------- gravação: tudo passa por uma fila, na ordem em que aconteceu ----------
  let fila: Promise<unknown> = Promise.resolve();
  function enfileirar<T>(fn: () => Promise<T>): Promise<T> {
    const r = fila.then(fn);
    fila = r.catch((e) => console.error("anotações:", e));
    return r;
  }
  const pendentes = new Map<number, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tituloPendente: { id: number; titulo: string } | null = null;

  function gravarPendentes() {
    clearTimeout(timer);
    const textos = [...pendentes];
    pendentes.clear();
    const t = tituloPendente;
    tituloPendente = null;
    if (!textos.length && !t) return fila;
    return enfileirar(async () => {
      for (const [id, texto] of textos) await salvarBloco(id, { texto });
      if (t) await atualizarPagina(t.id, { titulo: t.titulo });
    });
  }
  function agendar() {
    clearTimeout(timer);
    timer = setTimeout(gravarPendentes, 500);
  }

  // ---------- carregar a página ----------
  const paginaId = $derived(pagina.id);
  $effect(() => {
    const id = paginaId;
    // o resto da página (título, ícone) muda sem recarregar os blocos
    const perfil = untrack(() => {
      carregado = false;
      titulo = pagina.titulo;
      escolhendoIcone = false;
      refs.clear();
      return pagina.perfil_id;
    });
    Promise.all([enfileirar(() => blocosDaPagina(id)), mencionadaEm(perfil, "pagina", id)]).then(async ([bs, cs]) => {
      if (id !== paginaId) return;
      blocos = bs;
      citacoes = cs;
      carregado = true;
      await tick();
      if (!titulo) tituloEl?.focus();
    });
    return () => void gravarPendentes();
  });

  // nomes de páginas e do plano entram nos chips de menção
  let versao = $state(0);
  const nomes = $derived(paginas.map((p) => `${p.id} ${p.icone ?? ""} ${p.titulo}`).join("\n"));
  $effect(() => {
    void nomes;
    void app.plano;
    untrack(() => versao++);
  });

  const caminho = $derived(ancestrais(paginas, pagina.id));

  // numeração das listas numeradas: conta os itens seguidos do mesmo nível
  const numeros = $derived.by(() => {
    const out: number[] = [];
    for (const [i, b] of blocos.entries()) {
      let n = 1;
      for (let j = i - 1; j >= 0; j--) {
        if (blocos[j].nivel > b.nivel) continue;
        if (blocos[j].nivel === b.nivel && blocos[j].tipo === "numerada") n = out[j] + 1;
        break;
      }
      out.push(n);
    }
    return out;
  });

  // ---------- foco ----------
  async function focar(id: number, pos: number) {
    await tick();
    const el = refs.get(id);
    if (!el) return;
    if (el.isContentEditable) colocarCursor(el, pos);
    else el.focus();
  }
  const indice = (id: number) => blocos.findIndex((b) => b.id === id);

  // ---------- operações nos blocos ----------
  function texto(b: Bloco, t: string) {
    b.texto = t;
    pendentes.set(b.id, t);
    agendar();
  }

  async function enter(b: Bloco, antes: string, depois: string) {
    texto(b, antes);
    gravarPendentes();
    const continua = b.tipo === "lista" || b.tipo === "numerada" || b.tipo === "tarefa";
    const novo = await enfileirar(() => inserirBloco(pagina.id, b.id, { tipo: continua ? b.tipo : "paragrafo", texto: depois, nivel: b.nivel }));
    blocos.splice(indice(b.id) + 1, 0, novo);
    focar(novo.id, 0);
  }

  /** Junta o bloco de baixo no de cima; o cursor fica na emenda. */
  async function juntar(de: Bloco, em: Bloco) {
    gravarPendentes();
    if (em.tipo === "divisor") {
      blocos.splice(indice(em.id), 1);
      enfileirar(() => excluirBloco(em.id));
      return focar(de.id, 0);
    }
    const pos = (refs.get(em.id)?.textContent ?? "").length;
    const t = textoDeTrechos(trechos(em.texto + de.texto));
    em.texto = t;
    blocos.splice(indice(de.id), 1);
    enfileirar(async () => {
      await salvarBloco(em.id, { texto: t });
      await excluirBloco(de.id);
    });
    focar(em.id, pos);
  }

  function mudar(b: Bloco, dados: DadosBloco) {
    gravarPendentes();
    Object.assign(b, dados);
    enfileirar(() => salvarBloco(b.id, dados));
  }

  async function acao(b: Bloco, a: AcaoBloco) {
    gravarPendentes();
    const i = indice(b.id);
    if (a === "adicionar" || a === "duplicar") {
      const dados = a === "duplicar" ? { tipo: b.tipo, texto: b.texto, nivel: b.nivel, marcado: b.marcado } : { nivel: b.nivel };
      const novo = await enfileirar(() => inserirBloco(pagina.id, b.id, dados));
      blocos.splice(indice(b.id) + 1, 0, novo);
      focar(novo.id, Infinity);
    } else if (a === "excluir") {
      blocos.splice(i, 1);
      await enfileirar(() => excluirBloco(b.id));
      if (!blocos.length) blocos = await enfileirar(() => blocosDaPagina(pagina.id));
      const vizinho = blocos[Math.max(0, i - 1)];
      if (vizinho) focar(vizinho.id, Infinity);
    } else {
      const j = i + (a === "cima" ? -1 : 1);
      if (j < 0 || j >= blocos.length) return;
      const [x] = blocos.splice(i, 1);
      blocos.splice(j, 0, x);
      enfileirar(() => moverBloco(b.id, a === "cima" ? -1 : 1));
      focar(b.id, Infinity);
    }
  }

  function seta(i: number, dir: -1 | 1) {
    const alvo = blocos[i + dir];
    if (alvo) focar(alvo.id, dir < 0 ? Infinity : 0);
    else if (dir < 0) tituloEl?.focus();
  }

  /** Clique no espaço abaixo dos blocos: continua no último parágrafo vazio ou cria um. */
  async function cliqueFim() {
    const ultimo = blocos.at(-1);
    if (ultimo && ultimo.tipo === "paragrafo" && !ultimo.texto) return focar(ultimo.id, 0);
    if (ultimo) await acao(ultimo, "adicionar");
  }

  // ---------- cabeçalho ----------
  function digitarTitulo() {
    tituloPendente = { id: pagina.id, titulo };
    ontitulo(titulo);
    agendar();
  }

  async function icone(i: string | null) {
    escolhendoIcone = false;
    await enfileirar(() => atualizarPagina(pagina.id, { icone: i }));
    await onmudou();
  }

  const vinculo = $derived(pagina.assunto_id ? `a:${pagina.assunto_id}` : pagina.materia_id ? `m:${pagina.materia_id}` : "");
  async function vincular(v: string) {
    const [tipo, id] = v.split(":");
    await enfileirar(() => vincularPagina(pagina.id, tipo === "m" ? Number(id) : null, tipo === "a" ? Number(id) : null));
    await onmudou();
  }
  const vinculoQuebrado = $derived(
    (pagina.assunto_id != null && !app.plano?.assunto.has(pagina.assunto_id)) ||
      (pagina.assunto_id == null && pagina.materia_id != null && !app.plano?.materia.has(pagina.materia_id)),
  );

  // ---------- menções ----------
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const nomePagina = (p: Pagina) => p.titulo.trim() || "Sem título";

  const ctx: CtxEditor = {
    resolver(m) {
      const id = Number(m.ref);
      if (m.tipo === "p") {
        const p = paginas.find((x) => x.id === id);
        return p ? `${p.icone ? `${p.icone} ` : ""}${nomePagina(p)}` : null;
      }
      if (m.tipo === "m") return app.plano?.materia.get(id)?.nome ?? null;
      return app.plano?.assunto.get(id)?.nome ?? null;
    },
    opcoesMencao(consulta) {
      const q = norm(consulta.trim());
      const ok = (s: string) => !q || norm(s).includes(q);
      const out: OpcaoMencao[] = [];
      for (const p of paginas)
        if (ok(nomePagina(p)) && out.length < 5)
          out.push({ mencao: { tipo: "p", ref: String(p.id), rotulo: nomePagina(p) }, nome: `${p.icone ? `${p.icone} ` : ""}${nomePagina(p)}`, sub: "Página" });
      const plano = app.plano;
      if (plano)
        for (const m of plano.materias) {
          if (out.length >= 8) break;
          if (ok(m.nome)) out.push({ mencao: { tipo: "m", ref: String(m.id), rotulo: m.nome }, nome: m.nome, sub: "Matéria" });
          for (const a of m.assuntos)
            if (out.length < 8 && q && ok(a.nome)) out.push({ mencao: { tipo: "a", ref: String(a.id), rotulo: a.nome }, nome: a.nome, sub: `Assunto · ${m.nome}` });
        }
      if (consulta.trim() && !paginas.some((p) => norm(p.titulo.trim()) === q)) out.push({ criar: consulta.trim() });
      return out;
    },
    async criarPaginaMencao(t) {
      const id = await enfileirar(() => criarPagina(pagina.perfil_id, { paiId: pagina.id, titulo: t }));
      await onmudou();
      return { tipo: "p", ref: String(id), rotulo: t };
    },
    abrirMencao(m: Mencao) {
      const id = Number(m.ref);
      if (m.tipo === "p") {
        if (paginas.some((p) => p.id === id)) goto(`/anotacoes?id=${id}`);
        return;
      }
      const a = m.tipo === "a" ? app.plano?.assunto.get(id) : null;
      const materia = a ? a.materia_id : m.tipo === "m" && app.plano?.materia.has(id) ? id : null;
      if (materia) goto(`/aulas?materia=${materia}${a ? `&assunto=${a.id}` : ""}`);
    },
  };
</script>

<article class="pagina">
  {#if caminho.length}
    <nav class="caminho" aria-label="Caminho">
      {#each caminho as p (p.id)}
        <a href={`/anotacoes?id=${p.id}`}>{p.icone ?? ""} {nomePagina(p)}</a><span aria-hidden="true">/</span>
      {/each}
    </nav>
  {/if}

  <header>
    <div class="icone-area">
      {#if pagina.icone}
        <button type="button" class="icone" aria-label="Trocar ícone" onclick={() => (escolhendoIcone = !escolhendoIcone)}>{pagina.icone}</button>
      {:else}
        <button type="button" class="small sutil" onclick={() => (escolhendoIcone = !escolhendoIcone)}>+ Ícone</button>
      {/if}
      {#if escolhendoIcone}
        <div class="icones">
          {#each ICONES as i (i)}<button type="button" onclick={() => icone(i)}>{i}</button>{/each}
          {#if pagina.icone}<button type="button" class="tirar" onclick={() => icone(null)}>Remover</button>{/if}
        </div>
      {/if}
    </div>
    <input
      class="titulo"
      type="text"
      bind:this={tituloEl}
      bind:value={titulo}
      oninput={digitarTitulo}
      onkeydown={(e) => {
        if ((e.key === "Enter" || e.key === "ArrowDown") && blocos[0]) {
          e.preventDefault();
          focar(blocos[0].id, 0);
        }
      }}
      placeholder="Sem título"
      aria-label="Título da página"
      maxlength="200"
    />
    {#if app.plano}
      <label class="vinculo small">
        <span class="muted">Vinculada a</span>
        <select value={vinculo} onchange={(e) => vincular(e.currentTarget.value)}>
          <option value="">Nada (página livre)</option>
          {#if vinculoQuebrado}<option value={vinculo}>Assunto que saiu do plano</option>{/if}
          {#each app.plano.materias as m (m.id)}
            <optgroup label={m.nome}>
              <option value={`m:${m.id}`}>{m.nome} (matéria inteira)</option>
              {#each m.assuntos as a (a.id)}<option value={`a:${a.id}`}>{a.nome}</option>{/each}
            </optgroup>
          {/each}
        </select>
      </label>
    {/if}
  </header>

  {#if carregado}
    <div class="blocos">
      {#each blocos as b, i (b.id)}
        <BlocoNota
          bloco={b}
          numero={numeros[i]}
          {ctx}
          {versao}
          onref={(el) => (el ? refs.set(b.id, el) : refs.delete(b.id))}
          ontexto={(t) => texto(b, t)}
          onenter={(antes, depois) => enter(b, antes, depois)}
          onjuntar={() => (i > 0 ? juntar(b, blocos[i - 1]) : undefined)}
          onjuntarproximo={() => (blocos[i + 1] ? juntar(blocos[i + 1], b) : undefined)}
          onseta={(dir) => seta(i, dir)}
          onmudar={(d) => mudar(b, d)}
          onacao={(a) => acao(b, a)}
        />
      {/each}
    </div>
    <button type="button" class="fim" aria-label="Continuar escrevendo" onclick={cliqueFim}></button>

    <footer>
      <h3 class="small">Mencionada em</h3>
      {#if citacoes.length}
        <ul>
          {#each citacoes as c (c.id)}
            <li>
              <a href={`/anotacoes?id=${c.id}`}>{c.icone ?? ""} {c.titulo.trim() || "Sem título"}</a>
              {#if c.trecho}<small>{c.trecho}</small>{/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="tip">Nenhuma página menciona esta ainda. Em outra página, digite @ e o título desta.</p>
      {/if}
    </footer>
  {:else}
    <p class="empty">Carregando…</p>
  {/if}
</article>

<style>
  .pagina { display: flex; flex-direction: column; gap: 10px; padding-left: 54px; min-width: 0; }
  .caminho { display: flex; flex-wrap: wrap; gap: 6px; font-size: 13px; color: var(--muted); }
  .caminho a { color: var(--muted); text-decoration: none; }
  .caminho a:hover { color: var(--accent); text-decoration: underline; }
  header { display: flex; flex-direction: column; gap: 6px; padding-bottom: 8px; }
  .icone-area { position: relative; }
  .icone { font-size: 40px; line-height: 1; border: 0; background: transparent; padding: 4px; }
  .sutil { border-color: transparent; background: transparent; color: var(--muted); padding-left: 0; }
  .sutil:hover { color: var(--fg); }
  .icones {
    position: absolute; z-index: 20; top: 100%; left: 0; display: grid; grid-template-columns: repeat(8, 36px); gap: 2px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 6px; box-shadow: 0 8px 24px rgb(0 0 0 / .14);
  }
  .icones button { border: 0; background: transparent; font-size: 20px; padding: 4px; }
  .icones button:hover { background: var(--accent-soft); }
  .icones .tirar { grid-column: 1 / -1; font-size: 13px; color: var(--bad); }
  .titulo {
    font: 800 clamp(28px, 4vw, 38px)/1.15 var(--display); color: var(--fg);
    border: 0; background: transparent; padding: 0; width: 100%; outline: none;
  }
  .titulo::placeholder { color: var(--muted); opacity: .5; }
  .vinculo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .vinculo select { font-size: 14px; padding: 4px 8px; max-width: 100%; }
  .blocos { display: flex; flex-direction: column; }
  .fim { min-height: 80px; border: 0; background: transparent; cursor: text; width: 100%; }
  .fim:hover { border: 0; }
  footer { border-top: 1px solid var(--line); padding-top: 14px; display: flex; flex-direction: column; gap: 8px; }
  footer h3 { font: 500 12px var(--mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  footer ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  footer li { display: flex; flex-direction: column; }
  footer a { color: var(--fg); font-weight: 600; text-decoration: none; }
  footer a:hover { color: var(--accent); text-decoration: underline; }
  footer small { color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 760px) { .pagina { padding-left: 0; } }
</style>
