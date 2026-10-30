<script lang="ts">
  import { goto } from "$app/navigation";
  import { app } from "$lib/app.svelte";
  import { criarPerfilDemo } from "$lib/backup";
  import { IDIOMAS, atualizarPerfil, criarPerfil, excluirPerfil, type Perfil } from "$lib/perfis";
  import { desvincularTextosDoPerfil } from "$lib/textos";

  type Rascunho = { id: number | null; nome: string; idioma: string; horas: number };
  const NOVO = (): Rascunho => ({ id: null, nome: "", idioma: "pt-BR", horas: 3 });

  let rascunho = $state<Rascunho>(NOVO());
  let erro = $state("");
  let excluirArmado = $state<number | null>(null);

  function editar(p: Perfil) {
    rascunho = { id: p.id, nome: p.nome, idioma: p.idioma, horas: p.horas_dia };
    erro = "";
  }

  async function salvar(e: SubmitEvent) {
    e.preventDefault();
    const nome = rascunho.nome.trim();
    if (!nome) return (erro = "Dê um nome ao perfil.");
    const horas = Math.min(16, Math.max(0.5, Number(rascunho.horas) || 3));
    if (rascunho.id == null) {
      const id = await criarPerfil(nome, rascunho.idioma, horas);
      await app.recarregarPerfis();
      await app.escolherPerfil(id);
      goto("/hoje");
    } else {
      await atualizarPerfil(rascunho.id, nome, rascunho.idioma, horas);
      await app.recarregarPerfis();
    }
    rascunho = NOVO();
    erro = "";
  }

  let criandoDemo = $state(false);
  async function exemplo() {
    criandoDemo = true;
    const id = await criarPerfilDemo();
    await app.recarregarPerfis();
    await app.escolherPerfil(id);
    criandoDemo = false;
    goto("/hoje");
  }

  async function excluir(id: number) {
    if (excluirArmado !== id) {
      excluirArmado = id;
      setTimeout(() => {
        if (excluirArmado === id) excluirArmado = null;
      }, 4000);
      return;
    }
    excluirArmado = null;
    await desvincularTextosDoPerfil(id);
    await excluirPerfil(id);
    if (rascunho.id === id) rascunho = NOVO();
    await app.recarregarPerfis();
  }
</script>

<div class="stack">
  <header>
    <div class="eyebrow">Perfis de estudo</div>
    <h1>Quem vai estudar?</h1>
  </header>

  {#if app.perfis.length}
    <section class="card">
      <h3>Seus perfis</h3>
      <ul class="lista">
        {#each app.perfis as p (p.id)}
          <li class:ativo={p.id === app.perfilId}>
            <div class="info">
              <strong>{p.nome}</strong>
              <span class="small muted">{IDIOMAS.find((i) => i.valor === p.idioma)?.nome ?? p.idioma} · {p.horas_dia} h/dia</span>
            </div>
            <div class="row">
              {#if p.id === app.perfilId}
                <span class="chip ok">ativo</span>
              {:else}
                <button type="button" onclick={() => app.escolherPerfil(p.id)}>Usar</button>
              {/if}
              <button type="button" onclick={() => editar(p)}>Editar</button>
              <button type="button" class="danger" onclick={() => excluir(p.id)}>
                {excluirArmado === p.id ? "Confirmar exclusão" : "Excluir"}
              </button>
            </div>
          </li>
        {/each}
      </ul>
      {#if excluirArmado != null}
        <p class="tip">Excluir apaga o plano, as aulas, as questões e todo o progresso deste perfil.</p>
      {/if}
    </section>
  {/if}

  <form class="card" onsubmit={salvar}>
    <h3>{rascunho.id == null ? "Novo perfil" : "Editar perfil"}</h3>
    <div class="grid">
      <label class="full">
        Nome
        <input type="text" bind:value={rascunho.nome} maxlength="80" placeholder="Ex.: Polícia Civil 2027, ENEM, Vestibulares" />
      </label>
      <label>
        Idioma das aulas e prompts
        <select bind:value={rascunho.idioma}>
          {#each IDIOMAS as i (i.valor)}
            <option value={i.valor}>{i.nome}</option>
          {/each}
        </select>
      </label>
      <label>
        Horas por dia
        <input type="number" min="0.5" max="16" step="0.5" bind:value={rascunho.horas} />
      </label>
    </div>
    {#if erro}<p class="err" role="alert">{erro}</p>{/if}
    <div class="row">
      <button type="submit" class="primary">{rascunho.id == null ? "Criar perfil" : "Salvar"}</button>
      {#if rascunho.id != null}
        <button type="button" onclick={() => (rascunho = NOVO())}>Cancelar</button>
      {/if}
    </div>
  </form>

  {#if app.perfis.length >= 2}
    <section class="card">
      <div class="card-head">
        <h3>Estudar para duas provas ao mesmo tempo</h3>
        <a class="btn" href="/perfis/unir">Unir dois perfis</a>
      </div>
      <p class="tip">Junta os planos de dois perfis num perfil novo, mantendo o progresso de cada um.</p>
    </section>
  {/if}

  <section class="card">
    <h3>Perfil de exemplo</h3>
    <p class="tip">Cria um perfil pronto para a Polícia Civil de Sergipe (Investigador, Cebraspe) com 14 matérias, 120 assuntos, 138 aulas do YouTube e 63 questões, para explorar o sistema.</p>
    <div><button type="button" onclick={exemplo} disabled={criandoDemo}>{criandoDemo ? "Criando…" : "Criar perfil de exemplo"}</button></div>
  </section>
</div>

<style>
  .lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .lista li {
    display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 10px 0; border-top: 1px solid var(--line);
  }
  .lista li:first-child { border-top: 0; }
  .info { display: flex; flex-direction: column; min-width: 0; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .grid label { display: flex; flex-direction: column; gap: 5px; font-size: 14px; font-weight: 600; min-width: 0; }
  .grid .full { grid-column: 1 / -1; }
  .grid input[type="text"], .grid select { width: 100%; }
  @media (max-width: 620px) { .grid { grid-template-columns: minmax(0, 1fr); } }
</style>
