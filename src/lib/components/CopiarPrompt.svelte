<script lang="ts">
  import { copiar } from "$lib/prompts";

  let { texto, linhas = 10 }: { texto: string; linhas?: number } = $props();
  let msg = $state("");

  async function copiarTexto() {
    msg = (await copiar(texto)) ? "Copiado. Cole na IA de sua preferência." : "Não foi possível copiar; selecione o texto e copie manualmente.";
    setTimeout(() => (msg = ""), 4000);
  }
</script>

<div class="stack-s">
  <textarea readonly rows={linhas} value={texto} aria-label="Prompt"></textarea>
  <div class="row">
    <button type="button" class="primary" onclick={copiarTexto}>Copiar prompt</button>
    {#if msg}<span class="small muted" role="status">{msg}</span>{/if}
  </div>
</div>

<style>
  .stack-s { display: flex; flex-direction: column; gap: 8px; }
</style>
