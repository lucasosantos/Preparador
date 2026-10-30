<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { app } from "$lib/app.svelte";
  import { hoje } from "$lib/datas";
  import type { AulaTextoJson } from "$lib/esquemas";
  import { blocos, lerTexto, marcarLida, removerTexto, trechos, type ItemBiblioteca } from "$lib/textos";

  const id = $derived(page.url.searchParams.get("id") ?? "");
  let dados = $state.raw<{ item: ItemBiblioteca; aula: AulaTextoJson } | null>(null);
  let carregado = $state(false);
  let armado = $state(false);

  $effect(() => {
    const atual = id;
    carregado = false;
    lerTexto(atual).then((r) => {
      dados = r;
      carregado = true;
    });
  });

  const materia = $derived(dados ? app.plano?.materia.get(dados.item.materiaId) : null);
  const assunto = $derived(dados ? app.plano?.assunto.get(dados.item.assuntoId) : null);

  async function alternar(e: Event) {
    const lida = (e.currentTarget as HTMLInputElement).checked ? hoje() : null;
    await marcarLida(id, lida);
    dados = dados && { ...dados, item: { ...dados.item, lidaEm: lida } };
  }

  async function remover() {
    if (!armado) {
      armado = true;
      setTimeout(() => (armado = false), 4000);
      return;
    }
    await removerTexto(id);
    goto("/aulas");
  }
</script>

{#snippet rico(ts: { t: string; negrito: boolean }[])}
  {#each ts as x, i (i)}{#if x.negrito}<strong>{x.t}</strong>{:else}{x.t}{/if}{/each}
{/snippet}

<div class="stack">
  <a class="voltar" href="/aulas">← Biblioteca de aulas</a>
  {#if !carregado}
    <p class="empty">Carregando…</p>
  {:else if !dados}
    <section class="card"><p class="empty">Aula não encontrada. Ela pode ter sido removida.</p></section>
  {:else}
    {@const a = dados.aula}
    <header>
      <div class="eyebrow">{materia?.nome ?? "Aula em texto"}{assunto ? ` · ${assunto.nome}` : ""}</div>
      <h1>{a.titulo}</h1>
    </header>

    <article class="card aula">
      <p class="resumo">{a.resumo}</p>
      {#each a.secoes as s, i (i)}
        <section>
          <h2>{s.titulo}</h2>
          {#each blocos(s.texto) as b, j (j)}
            {#if b.tipo === "p"}
              <p>{@render rico(b.trechos)}</p>
            {:else}
              <ul>{#each b.itens as it, k (k)}<li>{@render rico(it)}</li>{/each}</ul>
            {/if}
          {/each}
        </section>
      {/each}
      {#if a.pontosDeProva.length}
        <section class="prova">
          <h2>Na hora da prova</h2>
          <ul>{#each a.pontosDeProva as p, i (i)}<li>{@render rico(trechos(p))}</li>{/each}</ul>
        </section>
      {/if}
      <section class="fontes">
        <h2>Fontes</h2>
        <ol>
          {#each a.fontes as f, i (i)}
            <li>
              {f.titulo}
              {#if f.url}<button type="button" class="link" onclick={() => openUrl(f.url!)} title={f.url}>abrir</button>{/if}
            </li>
          {/each}
        </ol>
        <p class="tip">
          Aula gerada por IA{a.apostila ? ` a partir da apostila "${a.apostila}"` : ""} em {dados.item.criadaEm.split("-").reverse().join("/")}. Confira os pontos importantes nas fontes acima.
        </p>
      </section>
    </article>

    <div class="row">
      <label class="lida"><input type="checkbox" checked={!!dados.item.lidaEm} onchange={alternar} /> Li esta aula</label>
      <button type="button" class="small danger" onclick={remover}>{armado ? "Confirmar remoção" : "Remover aula"}</button>
    </div>
  {/if}
</div>

<style>
  .voltar { color: var(--muted); font-size: 14px; text-decoration: none; }
  .voltar:hover { color: var(--accent); }
  .aula { max-width: 72ch; line-height: 1.6; font-size: 16px; }
  .aula section { display: flex; flex-direction: column; gap: 8px; }
  .aula h2 { font-size: 19px; margin: 14px 0 0; }
  .aula p, .aula ul, .aula ol { margin: 0; }
  .aula ul, .aula ol { padding-left: 22px; display: flex; flex-direction: column; gap: 4px; }
  .resumo { font-size: 17px; color: var(--muted); }
  .prova { background: var(--gold-soft); border: 1px solid var(--gold); border-radius: 10px; padding: 4px 14px 12px; margin-top: 10px; }
  .fontes { border-top: 1px solid var(--line); margin-top: 14px; font-size: 15px; }
  .link { all: unset; cursor: pointer; color: var(--accent); margin-left: 6px; font-size: 14px; }
  .link:hover { text-decoration: underline; }
  .link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .lida { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .lida input { width: 17px; height: 17px; accent-color: var(--accent); }
</style>
