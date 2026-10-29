<script lang="ts">
  import { app } from "$lib/app.svelte";
  import { hoje } from "$lib/datas";
  import { LETRAS, responder, rotuloGabarito, type Questao } from "$lib/questoes";

  let {
    q,
    data = hoje(),
    rotulo = "",
    refazer = false,
    onrespondida,
  }: { q: Questao; data?: string; rotulo?: string; refazer?: boolean; onrespondida?: () => void } = $props();

  let refazendo = $state(false);
  const mostrar = $derived(q.resposta && !refazendo);

  async function enviar(r: string) {
    await responder(app.perfilId!, q, r, data);
    refazendo = false;
    await app.recarregarMetricas();
    onrespondida?.();
  }
</script>

<div class="q">
  <span class="src">{rotulo || (q.fonte ? "Prova anterior" : q.origem === "banco" ? "Banco do exemplo" : q.origem === "importada" ? "Gerada pela IA · confira na fonte" : "Manual")}</span>
  {#if q.fonte}<span class="fonte">{q.fonte}</span>{/if}
  <p class="enunciado">{q.enunciado}</p>

  {#if q.tipo === "ME" && q.alternativas}
    <ol class="alts">
      {#each q.alternativas as alt, i (i)}
        {@const letra = LETRAS[i]}
        <li>
          {#if mostrar}
            <span class="alt" class:certa={letra === q.gabarito} class:marcada={letra === q.resposta?.resposta && letra !== q.gabarito}>
              <b>{letra}</b> {alt}
            </span>
          {:else}
            <button type="button" class="alt" onclick={() => enviar(letra)}><b>{letra}</b> {alt}</button>
          {/if}
        </li>
      {/each}
    </ol>
  {:else if !mostrar}
    <div class="btns">
      <button type="button" onclick={() => enviar("C")}>Certo</button>
      <button type="button" onclick={() => enviar("E")}>Errado</button>
    </div>
  {/if}

  {#if mostrar && q.resposta}
    <div class="verdict" class:ok={q.resposta.acertou} class:bad={!q.resposta.acertou}>
      <b>{q.resposta.acertou ? "Você acertou." : "Você errou."} Gabarito: {rotuloGabarito(q)}{q.gabarito_oficial ? "" : " (resolvido pela IA, não oficial)"}</b>
      {#if q.explicacao}{q.explicacao}{/if}
    </div>
    {#if refazer}
      <div><button type="button" class="small" onclick={() => (refazendo = true)}>Refazer</button></div>
    {/if}
  {/if}
</div>

<style>
  .q { border: 1px solid var(--line); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; background: var(--bg); }
  .fonte { font-size: 13px; color: var(--muted); margin-top: -8px; }
  .enunciado { margin: 0; white-space: pre-line; }
  .src { font: 500 11px var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
  .btns { display: flex; gap: 8px; }
  .btns button { min-width: 84px; }
  .alts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .alt {
    display: block; width: 100%; text-align: left; font: 15px var(--body); padding: 8px 10px;
    border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--fg);
  }
  .alt b { font-family: var(--mono); margin-right: 6px; }
  span.alt.certa { border-color: var(--ok); background: var(--ok-soft); }
  span.alt.marcada { border-color: var(--bad); background: var(--bad-soft); }
  .verdict { border-radius: 8px; padding: 10px 12px; font-size: 15px; }
  .verdict.ok { background: var(--ok-soft); }
  .verdict.bad { background: var(--bad-soft); }
  .verdict b { display: block; margin-bottom: 2px; }
  .verdict.ok b { color: var(--ok); }
  .verdict.bad b { color: var(--bad); }
</style>
