<script lang="ts" generics="T">
  import type { z } from "zod";
  import { copiar } from "$lib/prompts";
  import { promptCorrecao, validar } from "$lib/esquemas";

  let {
    schema,
    onvalido,
    rotulo = "Validar",
  }: {
    schema: z.ZodType<T, z.ZodTypeDef, unknown>;
    onvalido: (dados: T, bruto: string) => void | Promise<void>;
    rotulo?: string;
  } = $props();

  let texto = $state("");
  let erros = $state<string[]>([]);
  let msg = $state("");

  async function verificar() {
    const r = validar(schema, texto);
    if (r.ok) {
      erros = [];
      await onvalido(r.dados, r.bruto);
    } else erros = r.erros;
  }

  async function copiarCorrecao() {
    msg = (await copiar(promptCorrecao(erros))) ? "Copiado. Cole na mesma conversa com a IA." : "Não foi possível copiar.";
    setTimeout(() => (msg = ""), 4000);
  }

  export function limpar() {
    texto = "";
    erros = [];
  }
</script>

<div class="colar">
  <textarea rows="10" bind:value={texto} placeholder="Cole aqui o JSON que a IA respondeu" aria-label="Resposta da IA"></textarea>
  <div class="row">
    <button type="button" class="primary" onclick={verificar}>{rotulo}</button>
  </div>
  {#if erros.length}
    <div class="erros" role="alert">
      <b>A resposta tem problemas:</b>
      <ul>
        {#each erros as e, i (i)}<li>{e}</li>{/each}
      </ul>
      <div class="row">
        <button type="button" onclick={copiarCorrecao}>Copiar prompt de correção</button>
        {#if msg}<span class="small muted">{msg}</span>{/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .colar { display: flex; flex-direction: column; gap: 8px; }
  .erros { background: var(--bad-soft); border-radius: 8px; padding: 10px 12px; font-size: 14px; display: flex; flex-direction: column; gap: 6px; }
  .erros b { color: var(--bad); }
  .erros ul { margin: 0; padding-left: 18px; font-family: var(--mono); font-size: 12.5px; }
</style>
