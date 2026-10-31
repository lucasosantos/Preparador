<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { app } from "$lib/app.svelte";
  import { criarPagina, listarPaginas, type Pagina } from "$lib/anotacoes";
  import ArvorePaginas from "$lib/components/ArvorePaginas.svelte";
  import EditorPagina from "$lib/components/EditorPagina.svelte";

  const id = $derived(Number(page.url.searchParams.get("id")) || null);
  let paginas = $state.raw<Pagina[]>([]);
  let carregado = $state(false);

  async function recarregar() {
    const pid = app.perfilId;
    if (pid == null) return;
    const ps = await listarPaginas(pid);
    if (pid === app.perfilId) paginas = ps;
    carregado = true;
  }
  $effect(() => {
    void app.perfilId;
    recarregar();
  });

  const atual = $derived(paginas.find((p) => p.id === id) ?? null);
  const recentes = $derived([...paginas].sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em) || b.id - a.id).slice(0, 8));
  const nome = (p: Pagina) => p.titulo.trim() || "Sem título";

  async function nova(paiId: number | null) {
    const nid = await criarPagina(app.perfilId!, { paiId });
    await recarregar();
    goto(`/anotacoes?id=${nid}`);
  }

  function titulo(t: string) {
    paginas = paginas.map((p) => (p.id === id ? { ...p, titulo: t } : p));
  }
</script>

<div class="area">
  <aside class="lado">
    <div class="eyebrow">Anotações</div>
    {#if app.perfilId != null}
      <ArvorePaginas
        {paginas}
        atual={id}
        perfilId={app.perfilId}
        onnova={nova}
        onmudou={recarregar}
        onexcluida={(ids) => id != null && ids.has(id) && goto("/anotacoes")}
      />
    {/if}
  </aside>

  <section class="principal">
    {#if !carregado}
      <p class="empty">Carregando…</p>
    {:else if atual}
      <EditorPagina pagina={atual} {paginas} ontitulo={titulo} onmudou={recarregar} />
    {:else if id != null}
      <div class="card"><p class="empty">Página não encontrada. Ela pode ter sido excluída ou ser de outro perfil.</p></div>
    {:else}
      <header class="stack inicio">
        <h1>Suas anotações</h1>
        <p class="tip">
          Páginas para resumos, mapas e listas, organizadas em subpáginas. Digite @ para mencionar outra página ou um assunto do
          plano; uma página vinculada a um assunto aparece junto dele no Plano do dia e nas Aulas.
        </p>
        <div><button type="button" class="primary" onclick={() => nova(null)}>Nova página</button></div>
      </header>
      {#if recentes.length}
        <div class="card">
          <h3>Editadas por último</h3>
          <ul class="recentes">
            {#each recentes as p (p.id)}
              {@const tema = p.assunto_id ? app.plano?.assunto.get(p.assunto_id)?.nome : p.materia_id ? app.plano?.materia.get(p.materia_id)?.nome : null}
              <li>
                <a href={`/anotacoes?id=${p.id}`}>{p.icone ?? "📄"} {nome(p)}</a>
                {#if tema}<span class="chip">{tema}</span>{/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}
  </section>
</div>

<style>
  .area { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 28px; align-items: start; }
  .lado {
    position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow-y: auto;
    display: flex; flex-direction: column; gap: 10px; padding-right: 10px; border-right: 1px solid var(--line);
  }
  .principal { min-width: 0; }
  .inicio { margin-bottom: 16px; }
  .recentes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .recentes li { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .recentes a { color: var(--fg); font-weight: 600; text-decoration: none; }
  .recentes a:hover { color: var(--accent); text-decoration: underline; }
  @media (max-width: 900px) {
    .area { grid-template-columns: minmax(0, 1fr); }
    .lado { position: static; max-height: none; border-right: 0; border-bottom: 1px solid var(--line); padding: 0 0 12px; }
  }
</style>
