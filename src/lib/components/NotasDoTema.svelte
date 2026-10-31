<script lang="ts">
  import { goto } from "$app/navigation";
  import { app } from "$lib/app.svelte";
  import { criarPagina, paginasDoTema, type Referencia } from "$lib/anotacoes";

  // anotações vinculadas a um assunto (ou à matéria) ou que o mencionam
  let {
    materiaId,
    assuntoId,
    todaMateria = false,
  }: { materiaId: number; assuntoId: number | null; todaMateria?: boolean } = $props();

  let paginas = $state.raw<Referencia[]>([]);
  $effect(() => {
    const pid = app.perfilId;
    if (pid == null) return;
    paginasDoTema(pid, materiaId, assuntoId, { todaMateria }).then((r) => (paginas = r));
  });

  async function nova() {
    const titulo = (assuntoId ? app.plano?.assunto.get(assuntoId)?.nome : app.plano?.materia.get(materiaId)?.nome) ?? "";
    const id = await criarPagina(app.perfilId!, { titulo, materiaId, assuntoId });
    goto(`/anotacoes?id=${id}`);
  }
</script>

<div class="notas">
  <span class="rot small">Anotações</span>
  {#each paginas as p (p.id)}
    <a class="chip" href={`/anotacoes?id=${p.id}`} title={p.trecho ?? undefined}>{p.icone ?? "📄"} {p.titulo.trim() || "Sem título"}</a>
  {/each}
  <button type="button" class="small" onclick={nova}>+ Nova anotação</button>
</div>

<style>
  .notas { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; }
  .rot { color: var(--muted); font-weight: 600; }
  a.chip { text-decoration: none; color: var(--fg); border: 1px solid var(--line); font-family: var(--body); font-size: 13px; }
  a.chip:hover { border-color: var(--accent); color: var(--accent); }
</style>
