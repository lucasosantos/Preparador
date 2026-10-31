<script lang="ts">
  import { goto } from "$app/navigation";
  import { app } from "$lib/app.svelte";
  import ColarJson from "$lib/components/ColarJson.svelte";
  import CopiarPrompt from "$lib/components/CopiarPrompt.svelte";
  import { dataCurta, hoje, ymd } from "$lib/datas";
  import { QuestoesSchema, type QuestoesJson } from "$lib/esquemas";
  import { montarPrompt } from "$lib/prompts";
  import { previaQuestoes, type PreviaQuestoes } from "$lib/questoes";
  import {
    MAX_QUESTOES,
    cotasIa,
    criarDaIa,
    disponiveis,
    distribuir,
    excluirSimulado,
    listarSimulados,
    montarDoBanco,
    varsSimuladoIa,
    type ResumoSimulado,
    type Situacao,
  } from "$lib/simulados";

  const plano = $derived(app.plano);

  // ---------- histórico ----------
  let simulados = $state.raw<ResumoSimulado[]>([]);
  async function carregar() {
    if (app.perfilId == null) return;
    simulados = await listarSimulados(app.perfilId);
  }
  $effect(() => {
    void app.perfilId;
    carregar();
  });
  let armado = $state<number | null>(null);
  async function excluir(id: number) {
    if (armado !== id) {
      armado = id;
      setTimeout(() => armado === id && (armado = null), 4000);
      return;
    }
    await excluirSimulado(id);
    armado = null;
    await carregar();
  }
  const pct = (s: ResumoSimulado) => (s.total ? Math.round((s.acertos / s.total) * 100) : 0);
  // finalizado_em é ISO; criado_em vem do SQLite em UTC sem fuso
  const quando = (s: ResumoSimulado) => dataCurta(ymd(new Date(s.finalizado_em ?? `${s.criado_em.replace(" ", "T")}Z`)));

  // ---------- novo simulado ----------
  let fonte = $state<"banco" | "ia">("banco");
  let titulo = $state("");
  let selecionadas = $state<number[]>([]);
  let total = $state(30);
  let tempo = $state(0);
  let situacao = $state<Situacao>("ineditas");
  let tipo = $state<"CE" | "ME" | "misto">("CE");
  let erro = $state("");
  $effect(() => {
    if (plano) selecionadas = plano.materias.map((m) => m.id);
  });
  const tituloPadrao = `Simulado ${dataCurta(hoje())}`;
  const tempoMin = $derived(tempo > 0 ? tempo : null);
  const totalOk = $derived(Math.max(1, Math.min(MAX_QUESTOES, Math.round(total || 0))));

  // do banco: quanto há em cada matéria e como fica a divisão
  let disp = $state.raw<Map<number, number>>(new Map());
  $effect(() => {
    const p = plano;
    const s = situacao;
    if (p && app.perfilId != null) disponiveis(app.perfilId, p, s).then((d) => (disp = d));
  });
  const divisaoBanco = $derived(
    plano
      ? distribuir(
          plano.materias.filter((m) => selecionadas.includes(m.id)).map((m) => ({ id: m.id, peso: m.peso, disponiveis: disp.get(m.id) ?? 0 })),
          totalOk,
        )
      : new Map<number, number>(),
  );
  const somaBanco = $derived([...divisaoBanco.values()].reduce((a, b) => a + b, 0));

  async function montar() {
    erro = "";
    const id = await montarDoBanco(app.perfilId!, plano!, {
      titulo: titulo.trim() || tituloPadrao,
      materiaIds: selecionadas,
      total: totalOk,
      situacao,
      tempoMin,
    });
    if (id == null) return (erro = "Não há questões com esse filtro. Escolha outras matérias, outra situação, ou gere com a IA.");
    goto(`/simulados/fazer?id=${id}`);
  }

  // com a IA
  const divisaoIa = $derived(plano ? cotasIa(plano, selecionadas, totalOk) : new Map<number, number>());
  let prompt = $state("");
  $effect(() => {
    if (!plano || !selecionadas.length) return void (prompt = "");
    montarPrompt("simulados.gerar", varsSimuladoIa(plano, app.perfil?.idioma ?? "pt-BR", { materiaIds: selecionadas, total: totalOk, tipo })).then(
      (p) => (prompt = p),
    );
  });
  let previa = $state.raw<{ dados: QuestoesJson; p: PreviaQuestoes; bruto: string } | null>(null);
  async function validarIa(dados: QuestoesJson, bruto: string) {
    erro = "";
    previa = { dados, p: await previaQuestoes(app.perfilId!, plano!, dados), bruto };
  }
  const prontas = $derived(previa ? previa.p.validas.length + previa.p.duplicadas : 0);
  async function criarIa() {
    if (!previa) return;
    const id = await criarDaIa(app.perfilId!, plano!, previa.dados, previa.p, previa.bruto, { titulo: titulo.trim() || tituloPadrao, tempoMin });
    if (id == null) return (erro = "Nenhuma questão da resposta serve para o plano. Confira os ids de matéria e assunto.");
    await app.recarregarMetricas();
    goto(`/simulados/fazer?id=${id}`);
  }

  function alternarMateria(id: number, marcada: boolean) {
    selecionadas = marcada ? [...selecionadas, id] : selecionadas.filter((x) => x !== id);
  }
</script>

<div class="stack">
  <header>
    <div class="eyebrow">Simulados</div>
    <h1>Simulados</h1>
  </header>

  {#if !plano}
    <section class="card"><p class="empty">Crie o plano primeiro em <a href="/importar">Importar da IA</a>.</p></section>
  {:else}
    <section class="card">
      <h3>Novo simulado</h3>
      <p class="tip">Modo prova: você responde tudo, pode voltar e mudar, e só no fim vê o gabarito, a nota e o desempenho por matéria.</p>
      <fieldset class="fonte">
        <legend class="small muted">Questões</legend>
        <label><input type="radio" bind:group={fonte} value="banco" /> <span><b>Do meu banco</b><small>Sorteia entre as questões que você já tem</small></span></label>
        <label><input type="radio" bind:group={fonte} value="ia" /> <span><b>Gerar com IA</b><small>A IA cria um simulado no estilo da banca; as questões entram no banco</small></span></label>
      </fieldset>

      <div class="grid">
        <label class="full">Título <input type="text" bind:value={titulo} placeholder={tituloPadrao} maxlength="120" /></label>
        <label>Questões <input type="number" min="1" max={MAX_QUESTOES} bind:value={total} /></label>
        <label>Cronômetro (min) <input type="number" min="0" max="600" step="5" bind:value={tempo} /><small class="muted">0 = sem tempo</small></label>
        {#if fonte === "banco"}
          <label>Situação
            <select bind:value={situacao}>
              <option value="ineditas">Só as que não respondi</option>
              <option value="erradas">Só as que errei</option>
              <option value="todas">Todas</option>
            </select>
          </label>
        {:else}
          <label>Tipo
            <select bind:value={tipo}>
              <option value="CE">Certo ou errado</option>
              <option value="ME">Múltipla escolha</option>
              <option value="misto">Misturado</option>
            </select>
          </label>
        {/if}
      </div>

      <fieldset class="materias">
        <legend class="small">
          <span class="muted">Matérias · questões divididas pelo peso no plano</span>
          <button type="button" class="link" onclick={() => (selecionadas = plano.materias.map((m) => m.id))}>todas</button>
          <button type="button" class="link" onclick={() => (selecionadas = [])}>nenhuma</button>
        </legend>
        {#each plano.materias as m (m.id)}
          {@const n = (fonte === "banco" ? divisaoBanco : divisaoIa).get(m.id) ?? 0}
          <label class="mat" class:off={!selecionadas.includes(m.id)}>
            <input type="checkbox" checked={selecionadas.includes(m.id)} onchange={(e) => alternarMateria(m.id, e.currentTarget.checked)} />
            <span class="nome">{m.nome}</span>
            {#if selecionadas.includes(m.id)}
              <span class="chip" class:ok={n > 0}>{n}{fonte === "banco" ? ` de ${disp.get(m.id) ?? 0}` : ""}</span>
            {/if}
          </label>
        {/each}
      </fieldset>

      {#if fonte === "banco"}
        {#if somaBanco < totalOk}
          <p class="tip">Só há {somaBanco} questão(ões) com esse filtro. Para ter mais, gere com a IA ou importe em <a href="/importar?aba=questoes">Importar da IA</a>.</p>
        {/if}
        {#if erro}<p class="err" role="alert">{erro}</p>{/if}
        <div><button type="button" class="primary" disabled={!somaBanco} onclick={montar}>Começar simulado com {somaBanco} questões</button></div>
      {:else if !selecionadas.length}
        <p class="empty">Escolha ao menos uma matéria.</p>
      {:else}
        <h3 class="passo">1. Copie o prompt e cole na IA</h3>
        <CopiarPrompt texto={prompt} />
        <h3 class="passo">2. Cole a resposta da IA</h3>
        <ColarJson schema={QuestoesSchema} onvalido={validarIa} rotulo="Conferir simulado" />
        {#if previa}
          {@const p = previa.p}
          <ul class="resumo">
            <li>{prontas} questão(ões) para o simulado{p.duplicadas ? ` (${p.duplicadas} já estavam no banco)` : ""}</li>
            {#if p.semAssunto.length}<li class="bad">{p.semAssunto.length} com matéria ou assunto desconhecido (ficam de fora)</li>{/if}
            {#if prontas < totalOk}<li class="bad">Vieram menos questões que as {totalOk} pedidas. Se a IA respondeu em partes, peça "continue" e junte antes, ou siga assim.</li>{/if}
          </ul>
          <p class="tip">Questões geradas por IA podem conter erros; a explicação de cada uma ajuda a conferir.</p>
          {#if erro}<p class="err" role="alert">{erro}</p>{/if}
          <div class="row">
            <button type="button" class="primary" disabled={!prontas} onclick={criarIa}>Adicionar ao banco e começar</button>
            <button type="button" onclick={() => (previa = null)}>Descartar</button>
          </div>
        {/if}
      {/if}
    </section>

    <section class="card">
      <div class="card-head">
        <h3>Seus simulados</h3>
        {#if simulados.length}<span class="chip">{simulados.length}</span>{/if}
      </div>
      {#if !simulados.length}
        <p class="empty">Nenhum simulado ainda.</p>
      {:else}
        <ul class="hist">
          {#each simulados as s (s.id)}
            <li>
              <a class="info" href={`/simulados/fazer?id=${s.id}`}>
                <strong>{s.titulo}</strong>
                <small>
                  {quando(s)} · {s.total} questões{s.origem === "ia" ? " · gerado pela IA" : ""}{s.tempo_min ? ` · ${s.tempo_min} min` : ""}
                </small>
              </a>
              {#if s.finalizado_em}
                <span class="chip" class:ok={pct(s) >= 70}>{s.acertos}/{s.total} · {pct(s)}%</span>
              {:else}
                <span class="chip">{s.iniciado_em ? `em andamento · ${s.respondidas}/${s.total}` : "não iniciado"}</span>
              {/if}
              <button type="button" class="small danger" onclick={() => excluir(s.id)}>{armado === s.id ? "Confirmar" : "Excluir"}</button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .fonte { border: 0; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .fonte legend { margin-bottom: 6px; }
  .fonte label {
    display: flex; gap: 10px; align-items: flex-start; border: 1px solid var(--line); border-radius: 10px;
    padding: 10px 12px; cursor: pointer; background: var(--bg);
  }
  .fonte label:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
  .fonte input { margin-top: 4px; accent-color: var(--accent); }
  .fonte span { display: flex; flex-direction: column; }
  .fonte small { color: var(--muted); font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .grid label { display: flex; flex-direction: column; gap: 5px; font-size: 14px; font-weight: 600; min-width: 0; }
  .grid .full { grid-column: 1 / -1; }
  .grid input, .grid select { width: 100%; }
  .grid small { font-weight: 400; font-size: 12px; }
  .materias { border: 0; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 16px; }
  .materias legend { display: flex; gap: 10px; align-items: baseline; margin-bottom: 6px; padding: 0; }
  .link { border: 0; background: none; padding: 0; color: var(--accent); font-size: 13px; text-decoration: underline; }
  .mat { display: flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; min-width: 0; font-size: 15px; }
  .mat input { width: 16px; height: 16px; accent-color: var(--accent); flex: none; }
  .mat .nome { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mat.off .nome { color: var(--muted); }
  .passo { margin-top: 6px; }
  .resumo { margin: 0; padding-left: 18px; font-size: 15px; }
  .resumo .bad { color: var(--bad); }
  .hist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .hist li { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 0; border-top: 1px solid var(--line); }
  .hist li:first-child { border-top: 0; }
  .info { flex: 1 1 240px; min-width: 0; display: flex; flex-direction: column; color: var(--fg); text-decoration: none; }
  .info:hover strong { color: var(--accent); text-decoration: underline; }
  .info small { color: var(--muted); font-size: 13px; }
  @media (max-width: 680px) {
    .fonte, .materias { grid-template-columns: minmax(0, 1fr); }
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
</style>
