<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import { ancestrais, excluirPagina, montarArvore, moverPagina, reordenarPagina, type NoPagina, type Pagina } from "$lib/anotacoes";

  let {
    paginas,
    atual,
    perfilId,
    onnova,
    onmudou,
    onexcluida,
  }: {
    paginas: Pagina[];
    atual: number | null;
    perfilId: number;
    onnova: (paiId: number | null) => void;
    onmudou: () => Promise<void> | void;
    onexcluida: (ids: Set<number>) => void;
  } = $props();

  const arvore = $derived(montarArvore(paginas));
  const nome = (p: Pagina) => p.titulo.trim() || "Sem título";

  // abertas ficam salvas por perfil neste computador
  const chave = $derived(`anotacoes_abertas_${perfilId}`);
  const abertas = new SvelteSet<number>();
  $effect(() => {
    abertas.clear();
    try {
      for (const id of JSON.parse(localStorage.getItem(chave) ?? "[]")) abertas.add(id);
    } catch {}
  });
  function alternar(id: number) {
    if (abertas.has(id)) abertas.delete(id);
    else abertas.add(id);
    try {
      localStorage.setItem(chave, JSON.stringify([...abertas]));
    } catch {}
  }
  // a página aberta sempre aparece: os pais dela ficam abertos
  $effect(() => {
    if (atual != null) for (const p of ancestrais(paginas, atual)) abertas.add(p.id);
  });

  let menu = $state<number | null>(null);
  let movendo = $state(false);
  let armado = $state(false);
  let erro = $state("");

  function abrirMenu(id: number) {
    menu = menu === id ? null : id;
    movendo = false;
    armado = false;
    erro = "";
  }

  function descendentes(id: number): Set<number> {
    const out = new Set([id]);
    for (let mudou = true; mudou; ) {
      mudou = false;
      for (const p of paginas)
        if (p.pai_id != null && out.has(p.pai_id) && !out.has(p.id)) {
          out.add(p.id);
          mudou = true;
        }
    }
    return out;
  }

  async function mover(id: number, destino: string) {
    try {
      const pai = destino === "raiz" ? null : Number(destino);
      await moverPagina(id, pai);
      if (pai != null) abertas.add(pai);
      menu = null;
      await onmudou();
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
    }
  }

  async function reordenar(id: number, delta: -1 | 1) {
    await reordenarPagina(id, delta);
    await onmudou();
  }

  async function excluir(id: number) {
    if (!armado) {
      armado = true;
      setTimeout(() => (armado = false), 4000);
      return;
    }
    const ids = descendentes(id);
    await excluirPagina(id);
    menu = null;
    await onmudou();
    onexcluida(ids);
  }
</script>

{#snippet ramo(nos: NoPagina[], nivel: number)}
  <ul role={nivel ? "group" : "tree"} aria-label={nivel ? undefined : "Páginas"}>
    {#each nos as n (n.id)}
      {@const aberta = abertas.has(n.id)}
      <li role="treeitem" aria-expanded={n.filhos.length ? aberta : undefined} aria-selected={n.id === atual}>
        <div class="linha" class:atual={n.id === atual} style:--nivel={nivel}>
          <button
            type="button"
            class="seta"
            class:vazia={!n.filhos.length}
            aria-label={aberta ? "Recolher" : "Expandir"}
            tabindex={n.filhos.length ? 0 : -1}
            onclick={() => alternar(n.id)}><span class:aberta aria-hidden="true"></span></button
          >
          <a href={`/anotacoes?id=${n.id}`} title={nome(n)}>
            <span class="ic" aria-hidden="true">{n.icone ?? "📄"}</span>
            <span class="nome">{nome(n)}</span>
          </a>
          <div class="acoes">
            <button type="button" class="mini" title="Nova subpágina" aria-label="Nova subpágina em {nome(n)}" onclick={() => { abertas.add(n.id); onnova(n.id); }}>+</button>
            <button type="button" class="mini" title="Mais opções" aria-label="Opções de {nome(n)}" aria-expanded={menu === n.id} onclick={() => abrirMenu(n.id)}>⋯</button>
          </div>
        </div>
        {#if menu === n.id}
          <div class="menu" style:--nivel={nivel}>
            {#if movendo}
              {@const proibidas = descendentes(n.id)}
              <label class="small">Mover para
                <select onchange={(e) => mover(n.id, e.currentTarget.value)}>
                  <option value="" disabled selected>Escolha…</option>
                  {#if n.pai_id != null}<option value="raiz">Raiz (sem página-mãe)</option>{/if}
                  {#each paginas.filter((p) => !proibidas.has(p.id) && p.id !== n.pai_id) as p (p.id)}
                    <option value={p.id}>{nome(p)}</option>
                  {/each}
                </select>
              </label>
            {:else}
              <div class="row">
                <button type="button" class="small" onclick={() => reordenar(n.id, -1)}>Subir</button>
                <button type="button" class="small" onclick={() => reordenar(n.id, 1)}>Descer</button>
                <button type="button" class="small" onclick={() => (movendo = true)}>Mover para…</button>
                <button type="button" class="small danger" onclick={() => excluir(n.id)}>
                  {armado ? `Confirmar${n.filhos.length ? " (leva as subpáginas)" : ""}` : "Excluir"}
                </button>
              </div>
            {/if}
            {#if erro}<p class="err">{erro}</p>{/if}
          </div>
        {/if}
        {#if aberta && n.filhos.length}{@render ramo(n.filhos, nivel + 1)}{/if}
      </li>
    {/each}
  </ul>
{/snippet}

<div class="arvore">
  {#if arvore.length}
    {@render ramo(arvore, 0)}
  {:else}
    <p class="empty small">Nenhuma página ainda.</p>
  {/if}
  <button type="button" class="nova" onclick={() => onnova(null)}>+ Nova página</button>
</div>

<style>
  .arvore { display: flex; flex-direction: column; gap: 6px; }
  ul { list-style: none; margin: 0; padding: 0; }
  .linha {
    display: flex; align-items: center; gap: 2px; border-radius: 7px;
    padding: 1px 2px 1px calc(var(--nivel) * 14px);
  }
  .linha:hover { background: var(--bg); }
  .linha.atual { background: var(--accent-soft); }
  .linha a {
    flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 4px 2px;
    color: var(--fg); text-decoration: none; font-size: 14px;
  }
  .linha.atual a { font-weight: 700; }
  .nome { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ic { flex: none; font-size: 14px; }
  .seta { border: 0; background: transparent; padding: 4px; width: 20px; height: 22px; display: grid; place-items: center; flex: none; }
  .seta.vazia { visibility: hidden; }
  .seta span {
    width: 6px; height: 6px; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted);
    transform: rotate(-45deg); transition: transform .15s;
  }
  .seta span.aberta { transform: rotate(45deg); }
  .acoes { display: flex; opacity: 0; flex: none; }
  .linha:hover .acoes, .linha:focus-within .acoes, .acoes:has([aria-expanded="true"]) { opacity: 1; }
  .mini { border: 0; background: transparent; color: var(--muted); padding: 2px 6px; font-size: 15px; line-height: 1; }
  .mini:hover { color: var(--fg); background: var(--surface); }
  .menu { margin: 4px 0 6px calc(var(--nivel) * 14px + 20px); padding: 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); display: flex; flex-direction: column; gap: 6px; }
  .menu label { display: flex; flex-direction: column; gap: 4px; }
  .menu select { width: 100%; }
  .nova { align-self: flex-start; border-color: transparent; background: transparent; color: var(--muted); padding-left: 6px; }
  .nova:hover { color: var(--fg); }
  @media (hover: none) { .acoes { opacity: 1; } }
</style>
