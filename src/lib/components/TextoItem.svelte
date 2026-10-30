<script lang="ts">
  import { app } from "$lib/app.svelte";
  import { hoje } from "$lib/datas";
  import { marcarLida, removerTexto, type ItemBiblioteca } from "$lib/textos";

  let {
    t,
    meta = true,
    removivel = false,
    onmudou,
  }: { t: ItemBiblioteca; meta?: boolean; removivel?: boolean; onmudou?: () => void } = $props();

  let armado = $state(false);
  const materia = $derived(app.plano?.materia.get(t.materiaId));
  const assunto = $derived(app.plano?.assunto.get(t.assuntoId));
  const sub = $derived(
    [t.apostila ? `Da apostila ${t.apostila}` : "Aula em texto", meta ? `${materia?.nome ?? ""} · ${assunto?.nome ?? ""}` : null, t.lidaEm ? "lida" : null].filter(Boolean).join(" · "),
  );

  async function alternar(e: Event) {
    await marcarLida(t.id, (e.currentTarget as HTMLInputElement).checked ? hoje() : null);
    onmudou?.();
  }

  async function remover() {
    if (!armado) {
      armado = true;
      setTimeout(() => (armado = false), 4000);
      return;
    }
    await removerTexto(t.id);
    onmudou?.();
  }
</script>

<div class="aula" class:seen={t.lidaEm}>
  <span class="doc" aria-hidden="true"></span>
  <div class="body">
    <a class="link" href={`/aulas/texto?id=${t.id}`}>{t.titulo}</a>
    <small>{sub}</small>
  </div>
  <div class="actions">
    <label><input type="checkbox" checked={!!t.lidaEm} onchange={alternar} /> Li</label>
    {#if removivel}
      <button type="button" class="small danger" onclick={remover}>{armado ? "Confirmar remoção" : "Remover"}</button>
    {/if}
  </div>
</div>

<style>
  .aula {
    display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; border: 1px solid var(--line);
    border-radius: 10px; padding: 10px 12px; background: var(--bg); min-width: 0;
  }
  .doc { flex: none; width: 34px; height: 24px; border-radius: 6px; background: var(--accent-soft); position: relative; }
  .doc::after {
    content: ""; position: absolute; left: 10px; right: 10px; top: 6px; height: 12px;
    background: repeating-linear-gradient(var(--accent) 0 2px, transparent 2px 5px);
  }
  .body { flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; }
  .link { color: var(--fg); font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
  .link:hover { text-decoration: underline; color: var(--accent); }
  .seen .link { color: var(--muted); }
  small { color: var(--muted); font-size: 13px; }
  .actions { display: flex; align-items: center; gap: 10px; flex: none; }
  .actions label { display: flex; align-items: center; gap: 6px; font-size: 14px; cursor: pointer; }
  .actions input { width: 17px; height: 17px; accent-color: var(--accent); }
</style>
