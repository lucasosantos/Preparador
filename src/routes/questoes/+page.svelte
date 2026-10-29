<script lang="ts">
  import { app } from "$lib/app.svelte";
  import QuestaoCard from "$lib/components/QuestaoCard.svelte";
  import { listarQuestoes, removerQuestao, type Questao } from "$lib/questoes";

  const plano = $derived(app.plano);
  let todas = $state.raw<Questao[]>([]);
  let materiaId = $state(0);
  let assuntoId = $state(0);
  let status = $state<"todas" | "novas" | "erradas" | "certas">("novas");
  let limite = $state(20);
  let armado = $state<number | null>(null);

  async function carregar() {
    if (!plano || app.perfilId == null) return;
    todas = await listarQuestoes(app.perfilId, plano.id, { materiaId, assuntoId });
  }
  $effect(() => {
    void plano;
    void materiaId;
    void assuntoId;
    limite = 20;
    carregar();
  });

  const filtradas = $derived(
    todas.filter((q) =>
      status === "novas" ? !q.resposta : status === "erradas" ? q.resposta && !q.resposta.acertou : status === "certas" ? q.resposta?.acertou : true,
    ),
  );
  const respondidas = $derived(todas.filter((q) => q.resposta));
  const acertos = $derived(respondidas.filter((q) => q.resposta!.acertou).length);

  async function remover(id: number) {
    if (armado !== id) {
      armado = id;
      setTimeout(() => armado === id && (armado = null), 4000);
      return;
    }
    await removerQuestao(id);
    armado = null;
    await carregar();
    await app.recarregarMetricas();
  }
</script>

<div class="stack">
  <header>
    <div class="eyebrow">Questões</div>
    <h1>Banco de questões</h1>
  </header>

  {#if !plano}
    <section class="card"><p class="empty">Crie o plano primeiro em <a href="/importar">Importar da IA</a>.</p></section>
  {:else}
    <section class="card">
      <div class="row">
        <select bind:value={materiaId} onchange={() => (assuntoId = 0)} aria-label="Matéria">
          <option value={0}>Todas as matérias</option>
          {#each plano.materias as m (m.id)}<option value={m.id}>{m.nome}</option>{/each}
        </select>
        <select bind:value={assuntoId} disabled={!materiaId} aria-label="Assunto" class="grow">
          <option value={0}>Todos os assuntos</option>
          {#each plano.materia.get(materiaId)?.assuntos ?? [] as a (a.id)}<option value={a.id}>{a.nome}</option>{/each}
        </select>
        <select bind:value={status} aria-label="Situação">
          <option value="novas">Não respondidas</option>
          <option value="erradas">Que errei</option>
          <option value="certas">Que acertei</option>
          <option value="todas">Todas</option>
        </select>
      </div>
      <p class="tip">
        {todas.length} questões nesta seleção · {respondidas.length} respondidas
        {#if respondidas.length}· {Math.round((acertos / respondidas.length) * 100)}% de acerto · nota líquida {acertos - (respondidas.length - acertos)}{/if}
      </p>
      <div class="row">
        <a class="btn" href={`/importar?aba=questoes${materiaId ? `&materia=${materiaId}` : ""}${assuntoId ? `&assunto=${assuntoId}` : ""}`}>Gerar questões com IA</a>
        <a class="btn" href={`/importar?aba=questoes&modo=extrair${materiaId ? `&materia=${materiaId}` : ""}`}>Extrair de prova anterior</a>
      </div>
    </section>

    {#each filtradas.slice(0, limite) as q (q.id)}
      {@const a = q.assunto_id ? plano.assunto.get(q.assunto_id) : null}
      <div class="item">
        <QuestaoCard {q} refazer rotulo={`${plano.materia.get(q.materia_id)?.nome}${a ? ` · ${a.nome}` : ""}`} onrespondida={carregar} />
        <button type="button" class="small danger rm" onclick={() => remover(q.id)}>{armado === q.id ? "Confirmar" : "Excluir"}</button>
      </div>
    {:else}
      <p class="empty">Nenhuma questão com esse filtro.</p>
    {/each}
    {#if filtradas.length > limite}
      <div><button type="button" onclick={() => (limite += 20)}>Mostrar mais ({filtradas.length - limite} restantes)</button></div>
    {/if}
  {/if}
</div>

<style>
  .grow { flex: 1 1 220px; min-width: 0; }
  .item { position: relative; }
  .rm { position: absolute; top: 8px; right: 8px; }
</style>
