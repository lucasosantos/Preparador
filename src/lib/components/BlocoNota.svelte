<script lang="ts" module>
  import type { Mencao } from "$lib/anotacoes";
  import type { Resolver } from "$lib/editorNotas";

  export type OpcaoMencao = { mencao: Mencao; nome: string; sub: string } | { criar: string };
  /** O que o editor da página oferece a cada bloco. */
  export type CtxEditor = {
    resolver: Resolver;
    opcoesMencao: (consulta: string) => OpcaoMencao[];
    criarPaginaMencao: (titulo: string) => Promise<Mencao>;
    abrirMencao: (m: Mencao) => void;
  };
  export type AcaoBloco = "adicionar" | "duplicar" | "excluir" | "cima" | "baixo";
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { NOME_TIPO, TIPOS, type Bloco, type DadosBloco, type TipoBloco } from "$lib/anotacoes";
  import {
    alternarCodigo,
    chipHtml,
    colocarCursor,
    cortarDepoisDoCursor,
    htmlDe,
    htmlParaNo,
    inserirNoCursor,
    naBorda,
    posicaoCursor,
    selecaoVazia,
    textoDoDom,
  } from "$lib/editorNotas";

  let {
    bloco,
    numero = 1,
    ctx,
    versao = 0,
    onref,
    ontexto,
    onenter,
    onjuntar,
    onjuntarproximo,
    onseta,
    onmudar,
    onacao,
  }: {
    bloco: Bloco;
    numero?: number;
    ctx: CtxEditor;
    /** muda quando nomes de páginas ou do plano mudam, para refazer os chips */
    versao?: number;
    onref: (el: HTMLElement | null) => void;
    ontexto: (texto: string) => void;
    /** Enter: o texto que fica e o que vai para o bloco novo */
    onenter: (antes: string, depois: string) => void;
    /** Backspace no começo de um parágrafo: junta com o bloco de cima */
    onjuntar: () => void;
    /** Delete no fim: puxa o bloco de baixo */
    onjuntarproximo: () => void;
    onseta: (dir: -1 | 1) => void;
    onmudar: (dados: DadosBloco) => void;
    onacao: (a: AcaoBloco) => void;
  } = $props();

  let el = $state<HTMLElement | null>(null);
  /** último texto lido do DOM; se o bloco mudar por fora, o HTML é refeito */
  let ultimo: string | null = null;
  let menu = $state(false);
  let menuEl = $state<HTMLElement | null>(null);

  $effect(() => {
    onref(el);
    return () => onref(null);
  });

  // refaz o HTML quando o texto muda por fora, quando os nomes mudam ou quando o elemento é recriado (troca de tipo).
  // Só os nomes mudaram e o bloco está em edição? Espera o blur, para não perder o cursor.
  let feito: { el: HTMLElement; versao: number } | null = null;
  function desenhar() {
    const t = bloco.texto;
    if (!el || bloco.tipo === "divisor" || (t === ultimo && feito?.el === el && feito.versao === versao)) return;
    if (t === ultimo && feito?.el === el && document.activeElement === el) return;
    el.innerHTML = htmlDe(t, ctx.resolver);
    ultimo = t;
    feito = { el, versao };
  }
  $effect(() => {
    void bloco.texto;
    void versao;
    void el;
    untrack(() => desenhar());
  });

  function ler() {
    const t = textoDoDom(el!);
    ultimo = t;
    return t;
  }

  // ---------- menções ----------
  let busca = $state<{ no: Text; inicio: number; x: number; y: number } | null>(null);
  let consulta = $state("");
  let ativo = $state(0);
  const opcoes = $derived(busca ? ctx.opcoesMencao(consulta) : []);

  function atualizarBusca() {
    const sel = getSelection();
    if (!sel?.rangeCount || !el) return (busca = null);
    const r = sel.getRangeAt(0);
    const no = r.startContainer;
    if (busca) {
      if (no !== busca.no || r.startOffset < busca.inicio) return (busca = null);
      consulta = busca.no.data.slice(busca.inicio, r.startOffset);
      if (consulta.length > 60 || /\]\]/.test(consulta)) busca = null;
      return;
    }
    if (no.nodeType !== Node.TEXT_NODE || !r.collapsed) return;
    const antes = (no as Text).data.slice(0, r.startOffset);
    const m = antes.match(/(?:^|\s)(@|\[\[)$/);
    if (!m) return;
    const ret = r.getBoundingClientRect();
    const caixa = el.getBoundingClientRect();
    busca = { no: no as Text, inicio: r.startOffset, x: ret.left - caixa.left, y: ret.bottom - caixa.top + 4 };
    consulta = "";
    ativo = 0;
  }

  async function escolher(o: OpcaoMencao) {
    if (!busca || !el) return;
    const { no, inicio } = busca;
    busca = null;
    const gatilho = no.data.slice(0, inicio).endsWith("[[") ? 2 : 1;
    const fim = Math.min(no.data.length, inicio + consulta.length);
    const mencao = "criar" in o ? await ctx.criarPaginaMencao(o.criar) : o.mencao;
    const r = document.createRange();
    r.setStart(no, inicio - gatilho);
    r.setEnd(no, fim);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    inserirNoCursor(htmlParaNo(chipHtml(mencao, ctx.resolver(mencao)) + " "));
    ontexto(ler());
  }

  // ---------- teclado ----------
  const vazio = () => !el?.textContent;

  function teclas(e: KeyboardEvent) {
    if (!el) return;
    if (busca && opcoes.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        ativo = (ativo + (e.key === "ArrowDown" ? 1 : -1) + opcoes.length) % opcoes.length;
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        escolher(opcoes[Math.min(ativo, opcoes.length - 1)]);
        return;
      }
    }
    if (busca && e.key === "Escape") {
      e.preventDefault();
      busca = null;
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "b" || k === "i") {
        e.preventDefault();
        document.execCommand(k === "b" ? "bold" : "italic");
        ontexto(ler());
        return;
      }
      if (k === "e") {
        e.preventDefault();
        alternarCodigo(el);
        ontexto(ler());
        return;
      }
    }
    if (e.key === "Enter" && !e.isComposing) {
      if (e.shiftKey || bloco.tipo === "codigo") {
        e.preventDefault();
        document.execCommand("insertText", false, "\n");
        return;
      }
      e.preventDefault();
      const lista = bloco.tipo === "lista" || bloco.tipo === "numerada" || bloco.tipo === "tarefa";
      if (lista && vazio()) {
        // Enter num item vazio sai da lista (ou volta um nível)
        onmudar(bloco.nivel > 0 ? { nivel: bloco.nivel - 1 } : { tipo: "paragrafo" });
        return;
      }
      const depois = cortarDepoisDoCursor(el);
      onenter(ler(), depois);
      return;
    }
    if (e.key === "Backspace" && selecaoVazia() && posicaoCursor(el) === 0) {
      e.preventDefault();
      if (bloco.tipo !== "paragrafo" && bloco.tipo !== "codigo") onmudar({ tipo: "paragrafo" });
      else if (bloco.nivel > 0) onmudar({ nivel: bloco.nivel - 1 });
      else onjuntar();
      return;
    }
    if (e.key === "Delete" && selecaoVazia() && posicaoCursor(el) === (el.textContent ?? "").length) {
      e.preventDefault();
      onjuntarproximo();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const nivel = Math.max(0, Math.min(4, bloco.nivel + (e.shiftKey ? -1 : 1)));
      if (nivel !== bloco.nivel) onmudar({ nivel });
      return;
    }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && naBorda(el, e.key === "ArrowUp" ? "cima" : "baixo")) {
      e.preventDefault();
      onseta(e.key === "ArrowUp" ? -1 : 1);
    }
  }

  function digitou() {
    ontexto(ler());
    atualizarBusca();
  }

  // colar só texto; um link sozinho vira link (sobre a seleção, se houver)
  function colar(e: ClipboardEvent) {
    e.preventDefault();
    const t = (e.clipboardData?.getData("text/plain") ?? "").replace(/\r\n?/g, "\n");
    if (!t) return;
    const url = /^https?:\/\/\S+$/.test(t.trim()) ? t.trim() : null;
    if (url) {
      const sel = getSelection();
      const rotulo = sel?.rangeCount && !sel.getRangeAt(0).collapsed ? sel.toString() : url;
      const a = document.createElement("a");
      a.href = url;
      a.textContent = rotulo;
      inserirNoCursor(a);
    } else document.execCommand("insertText", false, bloco.tipo === "codigo" ? t : t.replace(/\n+/g, " "));
    ontexto(ler());
  }

  function clique(e: MouseEvent) {
    const alvo = e.target as HTMLElement;
    const chip = alvo.closest<HTMLElement>(".mencao");
    if (chip?.dataset.tipo && chip.dataset.ref) {
      e.preventDefault();
      ctx.abrirMencao({ tipo: chip.dataset.tipo as Mencao["tipo"], ref: chip.dataset.ref, rotulo: chip.dataset.rotulo ?? "" });
      return;
    }
    const link = alvo.closest("a");
    if (link && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      openUrl(link.href);
    }
  }

  // ---------- menu do bloco ----------
  function fecharMenu(e: MouseEvent) {
    if (menu && menuEl && !menuEl.contains(e.target as Node)) menu = false;
  }
  function tipo(t: TipoBloco) {
    menu = false;
    onmudar({ tipo: t });
    queueMicrotask(() => el && colocarCursor(el, Infinity));
  }
  function acao(a: AcaoBloco) {
    menu = false;
    onacao(a);
  }

  const marcador = $derived(
    bloco.tipo === "lista" ? ["•", "◦", "▪"][bloco.nivel % 3] : bloco.tipo === "numerada" ? `${numero}.` : null,
  );
  const dica = $derived(
    bloco.tipo === "paragrafo" ? "Escreva, ou use @ para mencionar" : bloco.tipo === "divisor" ? "" : NOME_TIPO[bloco.tipo],
  );
</script>

<svelte:window onmousedown={fecharMenu} />

<div class="bloco t-{bloco.tipo}" class:feito={bloco.tipo === "tarefa" && bloco.marcado} style:--nivel={bloco.nivel}>
  <div class="alca" bind:this={menuEl}>
    <button type="button" class="mini" title="Adicionar bloco abaixo" aria-label="Adicionar bloco abaixo" onclick={() => onacao("adicionar")}>+</button>
    <button type="button" class="mini" title="Opções do bloco" aria-label="Opções do bloco" aria-expanded={menu} onclick={() => (menu = !menu)}>⋮⋮</button>
    {#if menu}
      <div class="menu" role="menu">
        <div class="menu-titulo">Transformar em</div>
        {#each TIPOS as t (t)}
          <button type="button" role="menuitem" class:atual={t === bloco.tipo} onclick={() => tipo(t)}>{NOME_TIPO[t]}</button>
        {/each}
        <hr />
        <button type="button" role="menuitem" onclick={() => acao("cima")}>Mover para cima</button>
        <button type="button" role="menuitem" onclick={() => acao("baixo")}>Mover para baixo</button>
        <button type="button" role="menuitem" onclick={() => acao("duplicar")}>Duplicar</button>
        <button type="button" role="menuitem" class="danger" onclick={() => acao("excluir")}>Excluir</button>
      </div>
    {/if}
  </div>

  {#if bloco.tipo === "divisor"}
    <!-- o divisor não tem texto; o foco fica num elemento vazio para as setas e o Backspace funcionarem -->
    <button type="button" class="divisor" aria-label="Divisor (Backspace apaga, Enter cria um bloco abaixo)" bind:this={el} onkeydown={(e) => {
      if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); onacao("excluir"); }
      else if (e.key === "Enter") { e.preventDefault(); onacao("adicionar"); }
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); onseta(e.key === "ArrowUp" ? -1 : 1); }
    }}><span class="linha"></span></button>
  {:else}
    {#if bloco.tipo === "tarefa"}
      <input type="checkbox" class="check" checked={!!bloco.marcado} aria-label="Concluída" onchange={(e) => onmudar({ marcado: e.currentTarget.checked ? 1 : 0 })} />
    {:else if marcador}
      <span class="marca" aria-hidden="true">{marcador}</span>
    {/if}
    <div class="corpo">
      <div
        class="texto"
        bind:this={el}
        contenteditable="true"
        role="textbox"
        tabindex="0"
        aria-multiline={bloco.tipo === "codigo"}
        aria-label={NOME_TIPO[bloco.tipo]}
        data-dica={dica}
        spellcheck={bloco.tipo !== "codigo"}
        onkeydown={teclas}
        oninput={digitou}
        onkeyup={() => busca && atualizarBusca()}
        onblur={() => {
          setTimeout(() => (busca = null), 150);
          desenhar();
        }}
        onpaste={colar}
        onclick={clique}
      ></div>
      {#if busca && opcoes.length}
        <ul class="busca" style:left="{busca.x}px" style:top="{busca.y}px" role="listbox" aria-label="Mencionar">
          {#each opcoes as o, i (i)}
            <li role="option" aria-selected={i === ativo}>
              <button type="button" class:ativo={i === ativo} onmousedown={(e) => { e.preventDefault(); escolher(o); }}>
                {#if "criar" in o}
                  <span>Criar página “{o.criar}”</span><small>subpágina desta</small>
                {:else}
                  <span class="mencao-tipo-{o.mencao.tipo}">{o.nome}</span><small>{o.sub}</small>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .bloco {
    position: relative; display: flex; align-items: flex-start; gap: 6px;
    margin-left: -54px; padding: 1px 0 1px calc(54px + var(--nivel) * 26px);
  }
  .alca {
    position: absolute; left: calc(var(--nivel) * 26px); top: 2px; display: flex; gap: 1px;
    opacity: 0; transition: opacity .12s;
  }
  .bloco:hover .alca, .bloco:focus-within .alca, .alca:has([aria-expanded="true"]) { opacity: 1; }
  .mini {
    border: 0; background: transparent; color: var(--muted); padding: 2px 5px; border-radius: 5px;
    font: 600 14px/1 var(--body); letter-spacing: -2px;
  }
  .mini:hover { background: var(--bg); color: var(--fg); }
  .menu {
    position: absolute; top: 26px; left: 0; z-index: 20; min-width: 190px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 10px;
    box-shadow: 0 8px 24px rgb(0 0 0 / .14); padding: 6px; display: flex; flex-direction: column;
  }
  .menu-titulo { font: 500 11px var(--mono); text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 4px 8px; }
  .menu button { border: 0; background: transparent; text-align: left; padding: 6px 8px; border-radius: 6px; font-weight: 500; }
  .menu button:hover, .menu button.atual { background: var(--accent-soft); }
  .menu hr { border: 0; border-top: 1px solid var(--line); margin: 4px 0; width: 100%; }

  .corpo { position: relative; flex: 1; min-width: 0; }
  .texto {
    outline: none; white-space: pre-wrap; overflow-wrap: anywhere; min-height: 1.5em; padding: 2px 0;
    font-size: 16px; line-height: 1.6;
  }
  .texto:empty::before { content: attr(data-dica); color: var(--muted); opacity: 0; pointer-events: none; }
  .texto:focus:empty::before, .t-h1 .texto:empty::before, .t-h2 .texto:empty::before, .t-h3 .texto:empty::before { opacity: .6; }
  .t-h1 { margin-top: 18px; } .t-h1 .texto { font: 800 28px/1.25 var(--display); }
  .t-h2 { margin-top: 14px; } .t-h2 .texto { font: 800 22px/1.3 var(--display); }
  .t-h3 { margin-top: 10px; } .t-h3 .texto { font: 700 18px/1.35 var(--display); }
  .t-citacao .corpo { border-left: 3px solid var(--accent); padding-left: 14px; }
  .t-citacao .texto { color: var(--muted); font-style: italic; }
  .t-codigo .corpo { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
  .t-codigo .texto { font: 14px/1.55 var(--mono); }
  .marca { flex: none; width: 22px; text-align: right; padding-top: 3px; color: var(--muted); font: 600 15px/1.6 var(--body); }
  .t-numerada .marca { font-family: var(--mono); font-size: 14px; }
  .check { flex: none; width: 17px; height: 17px; margin: 6px 3px 0; accent-color: var(--accent); cursor: pointer; }
  .feito .texto { color: var(--muted); text-decoration: line-through; }
  .divisor { flex: 1; padding: 10px 0; border: 0; border-radius: 4px; background: transparent; cursor: default; }
  .divisor:hover { border: 0; }
  .divisor:focus { background: var(--accent-soft); }
  .divisor .linha { display: block; border-top: 1px solid var(--line); }

  .texto :global(code) { font: 0.88em var(--mono); background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
  .texto :global(a) { color: var(--accent); }
  .texto :global(.mencao) {
    color: var(--accent); background: var(--accent-soft); border-radius: 5px; padding: 0 5px;
    font-weight: 600; cursor: pointer; white-space: nowrap;
  }
  .texto :global(.mencao-p)::before { content: "↗ "; }
  .texto :global(.mencao-a)::before, .texto :global(.mencao-m)::before { content: "# "; }
  .texto :global(.mencao.removida) { color: var(--muted); background: var(--bg); text-decoration: line-through; }

  .busca {
    position: absolute; z-index: 30; list-style: none; margin: 0; padding: 6px; width: min(340px, 80vw);
    background: var(--surface); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 8px 24px rgb(0 0 0 / .14);
  }
  .busca button {
    width: 100%; border: 0; background: transparent; text-align: left; padding: 6px 8px; border-radius: 6px;
    display: flex; flex-direction: column; font-weight: 600;
  }
  .busca button.ativo { background: var(--accent-soft); }
  .busca small { color: var(--muted); font-weight: 400; font-size: 12px; }
  @media (max-width: 760px) {
    .bloco { margin-left: 0; padding-left: calc(var(--nivel) * 20px); }
    .alca { position: static; opacity: 1; }
  }
</style>
