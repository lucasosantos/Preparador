<script lang="ts">
  import { page } from "$app/state";
  import { SvelteSet } from "svelte/reactivity";
  import { app } from "$lib/app.svelte";
  import { adicionarAula, existeAula, listarAulas, verificarAula, ytInfo, type Aula } from "$lib/aulas";
  import AulaItem from "$lib/components/AulaItem.svelte";
  import NotasDoTema from "$lib/components/NotasDoTema.svelte";
  import TextoItem from "$lib/components/TextoItem.svelte";
  import { listarTextos, type ItemBiblioteca } from "$lib/textos";

  const plano = $derived(app.plano);
  let aulas = $state.raw<Aula[]>([]);
  let textos = $state.raw<ItemBiblioteca[]>([]);

  const materiaInicial = Number(page.url.searchParams.get("materia")) || 0;
  let materiaId = $state(materiaInicial);
  let assuntoId = $state(Number(page.url.searchParams.get("assunto")) || 0);
  let titulo = $state("");
  let url = $state("");
  let erro = $state("");
  const abertos = new SvelteSet<number>(materiaInicial ? [materiaInicial] : []);
  let filtro = $state<"todas" | "pendentes" | "quebradas">("todas");
  let verificando = $state<{ feito: number; total: number } | null>(null);

  async function carregar() {
    if (!plano || app.perfilId == null) return;
    [aulas, textos] = await Promise.all([listarAulas(app.perfilId, plano.id), listarTextos(app.perfilId, plano)]);
  }
  $effect(() => {
    void plano;
    carregar();
  });
  $effect(() => {
    if (plano && !plano.materia.has(materiaId)) materiaId = plano.materias[0]?.id ?? 0;
  });

  async function adicionar(e: SubmitEvent) {
    e.preventDefault();
    const info = ytInfo(url);
    if (!info) return (erro = "Cole um link do YouTube (vídeo, short ou playlist).");
    const aid = assuntoId || null;
    if (await existeAula(app.perfilId!, materiaId, aid, info.url)) return (erro = "Essa aula já está cadastrada neste assunto.");
    const nomeAssunto = aid ? plano!.assunto.get(aid)?.nome : plano!.materia.get(materiaId)?.nome;
    await adicionarAula(app.perfilId!, { materiaId, assuntoId: aid, titulo: titulo.trim() || `Aula: ${nomeAssunto}`, url: info.url });
    titulo = "";
    url = "";
    erro = "";
    abertos.add(materiaId);
    await carregar();
  }

  async function verificarTodas() {
    const alvo = aulas.filter((a) => a.status_link !== "ok");
    verificando = { feito: 0, total: alvo.length };
    // poucas por vez para não sobrecarregar o oEmbed
    for (let i = 0; i < alvo.length; i += 4) {
      await Promise.all(alvo.slice(i, i + 4).map((a) => verificarAula(a)));
      verificando = { feito: Math.min(i + 4, alvo.length), total: alvo.length };
    }
    verificando = null;
    await carregar();
  }

  const visiveis = $derived(
    aulas.filter((a) => (filtro === "pendentes" ? !a.assistida_em : filtro === "quebradas" ? a.status_link === "quebrado" : true)),
  );
  const textosVisiveis = $derived(textos.filter((t) => (filtro === "pendentes" ? !t.lidaEm : filtro !== "quebradas")));
  const assistidas = $derived(aulas.filter((a) => a.assistida_em).length + textos.filter((t) => t.lidaEm).length);
  const total = $derived(aulas.length + textos.length);
  const quebradas = $derived(aulas.filter((a) => a.status_link === "quebrado").length);
  const naoVerificadas = $derived(aulas.filter((a) => a.status_link === "nao_verificado").length);

  function grupo(mid: number) {
    const ordem = (a: Aula) => (a.assunto_id == null ? -1 : (plano!.assunto.get(a.assunto_id)?.ordem ?? 0));
    return visiveis.filter((a) => a.materia_id === mid).sort((a, b) => ordem(a) - ordem(b));
  }

  function textosDe(mid: number) {
    return textosVisiveis.filter((t) => t.materiaId === mid).sort((a, b) => plano!.assunto.get(a.assuntoId)!.ordem - plano!.assunto.get(b.assuntoId)!.ordem);
  }

  function alternar(mid: number, aberto: boolean) {
    if (aberto) abertos.add(mid);
    else abertos.delete(mid);
  }
</script>

<div class="stack">
  <header>
    <div class="eyebrow">Aulas</div>
    <h1>Biblioteca de aulas</h1>
  </header>

  {#if !plano}
    <section class="card"><p class="empty">Crie o plano primeiro em <a href="/importar">Importar da IA</a>.</p></section>
  {:else}
    <section class="card">
      <div class="card-head">
        <h3>Buscar aulas com a IA</h3>
        <a class="btn primary" href={`/importar?aba=aulas${materiaId ? `&materia=${materiaId}` : ""}`}>Abrir prompt de busca</a>
      </div>
      <p class="tip">O prompt já leva a lista de assuntos com os ids do seu plano e o idioma do perfil. A resposta vai direto para o assunto certo.</p>
    </section>

    <section class="card">
      <div class="card-head">
        <h3>Sem vídeo bom? Gere uma aula em texto</h3>
        <div class="row">
          <a class="btn" href={`/importar?aba=aulas&modo=apostila${materiaId ? `&materia=${materiaId}` : ""}`}>Usar minha apostila</a>
          <a class="btn" href={`/importar?aba=aulas&modo=texto${materiaId ? `&materia=${materiaId}` : ""}${assuntoId ? `&assunto=${assuntoId}` : ""}`}>Gerar aula em texto</a>
        </div>
      </div>
      <p class="tip">A IA escreve uma aula sobre o assunto, pensada para o seu perfil e para as provas do plano, e lista as fontes no final. Tem apostila em PDF? A IA separa o conteúdo pelos assuntos do plano e gera as aulas com base nela.</p>
    </section>

    <form class="card" onsubmit={adicionar}>
      <h3>Cadastrar aula manualmente</h3>
      <div class="grid">
        <label>Matéria
          <select bind:value={materiaId} onchange={() => (assuntoId = 0)}>
            {#each plano.materias as m (m.id)}<option value={m.id}>{m.nome}</option>{/each}
          </select>
        </label>
        <label>Assunto
          <select bind:value={assuntoId}>
            <option value={0}>Matéria inteira (aparece em todos os assuntos)</option>
            {#each plano.materia.get(materiaId)?.assuntos ?? [] as a (a.id)}<option value={a.id}>{a.nome}</option>{/each}
          </select>
        </label>
        <label class="full">Título da aula <input type="text" bind:value={titulo} maxlength="200" placeholder="Opcional" /></label>
        <label class="full">Link do YouTube <input type="url" bind:value={url} placeholder="https://www.youtube.com/watch?v=…" /></label>
      </div>
      {#if erro}<p class="err" role="alert">{erro}</p>{/if}
      <div><button type="submit" class="primary">Adicionar aula</button></div>
    </form>

    <section class="card">
      <div class="card-head">
        <h3>Suas aulas</h3>
        <span class="chip" class:ok={total > 0 && assistidas === total}>{assistidas}/{total} vistas</span>
      </div>
      <div class="row">
        <select bind:value={filtro} aria-label="Filtro">
          <option value="todas">Todas</option>
          <option value="pendentes">Não assistidas</option>
          <option value="quebradas">Links quebrados ({quebradas})</option>
        </select>
        <button type="button" onclick={verificarTodas} disabled={!!verificando || !aulas.length}>
          {verificando ? `Verificando ${verificando.feito}/${verificando.total}…` : `Verificar links${naoVerificadas ? ` (${naoVerificadas} pendentes)` : ""}`}
        </button>
      </div>
      <p class="tip">A verificação consulta o YouTube e marca vídeos removidos ou privados. Para esses, use "Pedir substituto".</p>
      {#if !visiveis.length && !textosVisiveis.length}<p class="empty">Nenhuma aula aqui.</p>{/if}
      {#each plano.materias as m (m.id)}
        {@const lista = grupo(m.id)}
        {@const txt = textosDe(m.id)}
        {#if lista.length || txt.length}
          {@const vistos = lista.filter((a) => a.assistida_em).length + txt.filter((t) => t.lidaEm).length}
          <details class="group" open={abertos.has(m.id)} ontoggle={(e) => alternar(m.id, e.currentTarget.open)}>
            <summary>
              <span class="chev" aria-hidden="true"></span>
              <strong class="gname">{m.nome}</strong>
              <span class="chip" class:ok={vistos === lista.length + txt.length}>{vistos}/{lista.length + txt.length}</span>
            </summary>
            <div class="lista">
              {#each lista as a (a.id)}<AulaItem {a} removivel onmudou={carregar} />{/each}
              {#each txt as t (t.id)}<TextoItem {t} removivel onmudou={carregar} />{/each}
              <NotasDoTema materiaId={m.id} assuntoId={null} todaMateria />
            </div>
          </details>
        {/if}
      {/each}
    </section>
  {/if}
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .grid label { display: flex; flex-direction: column; gap: 5px; font-size: 14px; font-weight: 600; min-width: 0; }
  .grid .full { grid-column: 1 / -1; }
  .grid input, .grid select { width: 100%; }
  @media (max-width: 620px) { .grid { grid-template-columns: minmax(0, 1fr); } }
  .group { border-top: 1px solid var(--line); }
  .group summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 12px 2px; }
  .group summary::-webkit-details-marker { display: none; }
  .gname { flex: 1; min-width: 0; }
  .chev { width: 9px; height: 9px; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); transform: rotate(-45deg); transition: transform .2s; flex: none; }
  .group[open] .chev { transform: rotate(45deg); }
  .lista { display: flex; flex-direction: column; gap: 8px; padding-bottom: 14px; }
</style>
