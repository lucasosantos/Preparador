<script lang="ts">
  import "$lib/theme.css";
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { app } from "$lib/app.svelte";
  import { escutarMcp } from "$lib/mcp";

  let { children } = $props();

  const NAV = [
    { href: "/hoje", nome: "Plano do dia" },
    { href: "/aulas", nome: "Aulas" },
    { href: "/questoes", nome: "Questões" },
    { href: "/simulados", nome: "Simulados" },
    { href: "/anotacoes", nome: "Anotações" },
    { href: "/progresso", nome: "Progresso" },
    { href: "/acervo", nome: "Acervo" },
    { href: "/importar", nome: "Importar da IA" },
    { href: "/ajustes", nome: "Ajustes" },
  ];

  onMount(() => {
    app.iniciar();
    // atende o servidor MCP; quando um agente grava algo, a tela recarrega
    const parar = escutarMcp({
      perfilAtivo: () => app.perfilId,
      aoMudar: async (id) => {
        await app.recarregarPerfis();
        if (id === app.perfilId) await app.recarregarPlano();
      },
    });
    return () => void parar.then((f) => f());
  });

  // sem perfil, só a tela de perfis faz sentido
  $effect(() => {
    if (app.pronto && !app.perfil && !page.url.pathname.startsWith("/perfis")) goto("/perfis");
  });

  async function trocarPerfil(e: Event) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    if (v === "gerenciar") return goto("/perfis");
    await app.escolherPerfil(Number(v));
  }
</script>

<svelte:head><title>Preparador</title></svelte:head>

{#if app.erro}
  <main class="center">
    <div class="card">
      <h2>Não foi possível abrir o banco de dados</h2>
      <p class="err">{app.erro}</p>
    </div>
  </main>
{:else if !app.pronto}
  <main class="center"><p class="muted">Carregando…</p></main>
{:else}
  <div class="shell">
    <aside>
      <div class="brand">
        <span class="eyebrow">Preparador</span>
      </div>

      {#if app.perfis.length}
        <label class="perfil">
          <span class="small muted">Perfil</span>
          <select value={app.perfilId ?? ""} onchange={trocarPerfil}>
            {#each app.perfis as p (p.id)}
              <option value={p.id}>{p.nome}</option>
            {/each}
            <option value="gerenciar">Gerenciar perfis…</option>
          </select>
        </label>
      {/if}

      <nav>
        {#each NAV as item (item.href)}
          <a
            href={item.href}
            aria-current={page.url.pathname.startsWith(item.href) ? "page" : undefined}
            class:disabled={!app.perfil}>{item.nome}</a
          >
        {/each}
      </nav>
    </aside>

    <main class="content" class:largo={page.url.pathname.startsWith("/anotacoes")}>
      {@render children()}
    </main>
  </div>
{/if}

<style>
  .center { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 100vh; }
  aside {
    position: sticky; top: 0; height: 100vh; overflow-y: auto;
    border-right: 1px solid var(--line); background: var(--surface);
    padding: 20px 14px; display: flex; flex-direction: column; gap: 18px;
  }
  .brand { padding: 0 6px; }
  .perfil { display: flex; flex-direction: column; gap: 4px; }
  .perfil select { width: 100%; }
  nav { display: flex; flex-direction: column; gap: 2px; }
  nav a {
    color: var(--muted); text-decoration: none; font-weight: 600;
    padding: 7px 10px; border-radius: 8px; border-left: 3px solid transparent;
  }
  nav a:hover { color: var(--fg); background: var(--bg); }
  nav a[aria-current="page"] { color: var(--fg); background: var(--accent-soft); border-left-color: var(--accent); }
  nav a.disabled { pointer-events: none; opacity: .5; }
  .content { max-width: 860px; width: 100%; margin: 0 auto; padding: 28px 24px 64px; }
  .content.largo { max-width: 1200px; }
  @media (max-width: 760px) {
    .shell { grid-template-columns: minmax(0, 1fr); }
    aside { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
    nav { flex-direction: row; flex-wrap: wrap; }
    .content { padding: 20px 16px 48px; }
  }
</style>
