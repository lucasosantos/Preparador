<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import { app } from "$lib/app.svelte";
  import { reaproveitar, resumoAcervo, sugestoesAcervo, type Sugestao } from "$lib/acervo";

  const plano = $derived(app.plano);
  let resumo = $state<Awaited<ReturnType<typeof resumoAcervo>> | null>(null);
  let sugestoes = $state.raw<Sugestao[]>([]);
  let buscando = $state(true);
  let salvando = $state(false);
  let ok = $state("");
  const marcadas = new SvelteSet<number>();

  async function carregar() {
    buscando = true;
    resumo = await resumoAcervo();
    sugestoes = plano && app.perfilId != null ? await sugestoesAcervo(app.perfilId, plano) : [];
    marcadas.clear();
    sugestoes.forEach((s, i) => s.forte && marcadas.add(i));
    buscando = false;
  }
  $effect(() => {
    void plano;
    carregar();
  });

  const escolhidas = $derived(sugestoes.filter((_, i) => marcadas.has(i)));
  const conta = (lista: Sugestao[]) => ({
    aulas: lista.reduce((n, s) => n + s.aulas.length, 0),
    questoes: lista.reduce((n, s) => n + s.questoes.length, 0),
    textos: lista.reduce((n, s) => n + s.textos.length, 0),
  });
  const totalEscolhido = $derived(conta(escolhidas));

  function partes(c: { aulas: number; questoes: number; textos: number }) {
    return [
      c.aulas && `${c.aulas} vídeo${c.aulas > 1 ? "s" : ""}`,
      c.questoes && `${c.questoes} questã${c.questoes > 1 ? "ões" : "o"}`,
      c.textos && `${c.textos} aula${c.textos > 1 ? "s" : ""} em texto`,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function todas(sim: boolean) {
    marcadas.clear();
    if (sim) sugestoes.forEach((_, i) => marcadas.add(i));
  }

  async function aplicar() {
    salvando = true;
    const r = await reaproveitar(app.perfilId!, escolhidas);
    ok = `Reaproveitado: ${partes(r) || "nada novo"}.`;
    salvando = false;
    await carregar();
    await app.recarregarMetricas();
  }
</script>

<div class="stack">
  <header>
    <div class="eyebrow">Acervo</div>
    <h1>O que você já reuniu</h1>
  </header>

  <section class="card">
    <p class="tip">
      Todo plano, aula, questão e aula em texto cadastrado fica guardado aqui, mesmo depois de trocar de plano ou excluir o perfil.
      Ao montar um plano novo, o app procura no acervo os assuntos parecidos e sugere o conteúdo para reaproveitar.
    </p>
    {#if resumo}
      <div class="nums">
        <div><b>{resumo.temas}</b><span>temas</span></div>
        <div><b>{resumo.aulas}</b><span>vídeos</span></div>
        <div><b>{resumo.questoes}</b><span>questões</span></div>
        <div><b>{resumo.textos}</b><span>aulas em texto</span></div>
      </div>
    {/if}
  </section>

  {#if !plano}
    <section class="card"><p class="empty">Crie um plano em <a href="/importar">Importar da IA</a> para ver o que dá para reaproveitar.</p></section>
  {:else}
    <section class="card">
      <div class="card-head">
        <h3>Reaproveitar no plano "{plano.objetivo.nome}"</h3>
        {#if sugestoes.length}<span class="chip">{sugestoes.length} tema(s) encontrados</span>{/if}
      </div>
      {#if ok}<p class="ok" role="status">{ok}</p>{/if}
      {#if buscando}
        <p class="empty">Procurando no acervo…</p>
      {:else if !sugestoes.length}
        <p class="empty">Nada novo no acervo para este plano. Tudo o que se encaixa já está nele.</p>
      {:else}
        <p class="tip">
          Os temas muito parecidos já vêm marcados. Confira os demais: o nome é parecido, mas pode ser outro conteúdo.
        </p>
        <div class="row">
          <button type="button" class="small" onclick={() => todas(true)}>Marcar todos</button>
          <button type="button" class="small" onclick={() => todas(false)}>Desmarcar todos</button>
        </div>
        <ul class="lista">
          {#each sugestoes as s, i (i)}
            <li class:fraca={!s.forte}>
              <label>
                <input type="checkbox" checked={marcadas.has(i)} onchange={(e) => (e.currentTarget.checked ? marcadas.add(i) : marcadas.delete(i))} />
                <span class="txt">
                  <b>{s.destino}</b>
                  <small>
                    ← {s.origem.materia}{s.origem.assunto ? `: ${s.origem.assunto}` : " (matéria inteira)"}{s.origem.objetivo ? ` · do plano ${s.origem.objetivo}` : ""}
                  </small>
                  <small>{partes(conta([s]))}</small>
                </span>
                <span class="chip" class:ok={s.forte} title="Semelhança entre os nomes">{Math.round(s.score * 100)}%</span>
              </label>
              <details>
                <summary>Ver conteúdo</summary>
                <ul class="itens">
                  {#each s.aulas as a (a.id)}<li>Vídeo: {a.titulo}{a.canal ? ` (${a.canal})` : ""}</li>{/each}
                  {#each s.textos as t (t.id)}<li>Aula em texto: {t.titulo}{t.apostila ? ` (apostila ${t.apostila})` : ""}</li>{/each}
                  {#each s.questoes.slice(0, 5) as q (q.id)}<li>Questão {q.tipo}: {q.enunciado.slice(0, 140)}{q.enunciado.length > 140 ? "…" : ""}</li>{/each}
                  {#if s.questoes.length > 5}<li>… e mais {s.questoes.length - 5} questões</li>{/if}
                </ul>
              </details>
            </li>
          {/each}
        </ul>
        <div class="row">
          <button type="button" class="primary" disabled={!escolhidas.length || salvando} onclick={aplicar}>
            {salvando ? "Copiando…" : `Reaproveitar ${partes(totalEscolhido) || "selecionados"}`}
          </button>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .nums { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
  .nums div { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
  .nums b { font-size: 22px; }
  .nums span { color: var(--muted); font-size: 13px; }
  @media (max-width: 620px) { .nums { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .lista > li { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
  .lista > li.fraca { border-style: dashed; }
  .lista label { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; }
  .lista input { margin-top: 4px; width: 17px; height: 17px; accent-color: var(--accent); flex: none; }
  .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .txt small { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
  details summary { cursor: pointer; color: var(--muted); font-size: 13px; padding-left: 27px; }
  .itens { margin: 4px 0 0; padding-left: 44px; font-size: 13.5px; display: flex; flex-direction: column; gap: 2px; }
  .ok { color: var(--ok); margin: 0; font-size: 14px; }
</style>
