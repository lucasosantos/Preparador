<script lang="ts">
  import { app } from "$lib/app.svelte";
  import { horas } from "$lib/datas";

  const m = $derived(app.metricas);
  const liquida = $derived(m ? m.acertos - m.erros : 0);
</script>

{#if m}
  <div class="stats" aria-label="Resumo">
    <div class="stat"><b>{m.sequencia}</b><span>dias seguidos</span></div>
    <div class="stat"><b>{horas(m.minutosSemana)}</b><span>estudadas na semana</span></div>
    <div class="stat"><b>{m.concluidos}/{m.total}</b><span>assuntos concluídos</span></div>
    <div class="stat"><b>{liquida > 0 ? "+" : ""}{liquida}</b><span>nota líquida (C − E)</span></div>
  </div>
{/if}

<style>
  .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
  @media (max-width: 620px) { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .stat {
    background: var(--surface); border: 1px solid var(--line); border-radius: 10px;
    padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; min-width: 0;
  }
  .stat b { font: 500 20px var(--mono); font-variant-numeric: tabular-nums; }
  .stat span { font-size: 13px; color: var(--muted); }
</style>
