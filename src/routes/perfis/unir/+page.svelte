<script lang="ts">
  import { goto } from "$app/navigation";
  import { app } from "$lib/app.svelte";
  import ColarJson from "$lib/components/ColarJson.svelte";
  import CopiarPrompt from "$lib/components/CopiarPrompt.svelte";
  import { DIAS } from "$lib/datas";
  import { PlanoSchema, type PlanoJson } from "$lib/esquemas";
  import { IDIOMAS } from "$lib/perfis";
  import { carregarPlano, type Plano } from "$lib/planos";
  import { montarPrompt } from "$lib/prompts";
  import { planoParaPrompt, planoUnidoAutomatico, resumoUniao, unirPerfis, type ResumoUniao } from "$lib/unir";

  let idA = $state(app.perfilId ?? 0);
  let idB = $state(0);
  let planoA = $state.raw<Plano | null>(null);
  let planoB = $state.raw<Plano | null>(null);
  let nome = $state("");
  let horas = $state(app.perfil?.horas_dia ?? 3);
  let metodo = $state<"auto" | "ia">("auto");
  let notas = $state("");
  let prompt = $state("");
  let previa = $state<{ dados: PlanoJson; bruto: string; resumo: ResumoUniao } | null>(null);
  let salvando = $state(false);
  let erro = $state("");

  const perfilA = $derived(app.perfis.find((p) => p.id === idA));
  const perfilB = $derived(app.perfis.find((p) => p.id === idB));

  $effect(() => {
    const a = idA,
      b = idB;
    previa = null;
    Promise.all([a ? carregarPlano(a) : null, b ? carregarPlano(b) : null]).then(([pa, pb]) => {
      planoA = pa;
      planoB = pb;
    });
  });

  $effect(() => {
    if (perfilA && perfilB && !nome) nome = `${perfilA.nome} + ${perfilB.nome}`;
  });

  $effect(() => {
    if (!planoA || !planoB) return;
    const nomeIdioma = IDIOMAS.find((i) => i.valor === perfilA?.idioma)?.nome ?? perfilA?.idioma;
    montarPrompt("perfis.unir", {
      planoA: planoParaPrompt("A", planoA),
      planoB: planoParaPrompt("B", planoB),
      horas,
      dias: DIAS.slice(1).join(", "),
      idioma: nomeIdioma,
      complemento: notas.trim() ? `\nObservações minhas (leve em conta):\n${notas.trim()}\n` : "",
      tipo: "constancia",
      situacao: "publicado ou previsto",
    }).then((p) => (prompt = p));
  });

  const problema = $derived(
    !idA || !idB
      ? "Escolha os dois perfis."
      : idA === idB
        ? "Escolha perfis diferentes."
        : !planoA || !planoB
          ? `O perfil ${!planoA ? perfilA?.nome : perfilB?.nome} ainda não tem plano.`
          : "",
  );

  async function previaAuto() {
    const dados = PlanoSchema.parse(await planoUnidoAutomatico(planoA!, planoB!, nome.trim() || "Plano unido"));
    previa = { dados, bruto: JSON.stringify(dados), resumo: resumoUniao(planoA!, planoB!, dados) };
  }

  async function previaIa(dados: PlanoJson, bruto: string) {
    dados.objetivo.tipo = "constancia";
    previa = { dados, bruto, resumo: resumoUniao(planoA!, planoB!, dados) };
  }

  async function confirmar() {
    if (!previa || !perfilA) return;
    salvando = true;
    erro = "";
    try {
      const id = await unirPerfis(
        { perfilId: idA, plano: planoA! },
        { perfilId: idB, plano: planoB! },
        previa.dados,
        previa.bruto,
        { nome: nome.trim() || "Plano unido", idioma: perfilA.idioma, horas: Math.min(16, Math.max(0.5, Number(horas) || 3)) },
      );
      await app.recarregarPerfis();
      await app.escolherPerfil(id);
      goto("/hoje");
    } catch (e) {
      erro = String(e);
    } finally {
      salvando = false;
    }
  }
</script>

<div class="stack">
  <header>
    <div class="eyebrow">Perfis</div>
    <h1>Unir dois perfis</h1>
  </header>

  <section class="card">
    <p class="tip">
      Cria um perfil novo, no modo constância, com as provas, matérias e assuntos dos dois. O progresso vem junto: assuntos
      concluídos, revisões, horas estudadas, aulas e questões. Os perfis originais não são alterados; apague-os depois, se quiser.
    </p>
    <div class="grid">
      <label>Perfil A
        <select bind:value={idA}>
          <option value={0}>Escolha…</option>
          {#each app.perfis as p (p.id)}<option value={p.id}>{p.nome}</option>{/each}
        </select>
      </label>
      <label>Perfil B
        <select bind:value={idB}>
          <option value={0}>Escolha…</option>
          {#each app.perfis as p (p.id)}<option value={p.id} disabled={p.id === idA}>{p.nome}</option>{/each}
        </select>
      </label>
      <label class="full">Nome do perfil novo <input type="text" bind:value={nome} maxlength="80" /></label>
      <label>Horas por dia <input type="number" min="0.5" max="16" step="0.5" bind:value={horas} /></label>
    </div>
    {#if problema}<p class="err">{problema}</p>{/if}
  </section>

  {#if !problema}
    <section class="card">
      <h3>Como juntar as matérias</h3>
      <fieldset class="metodo">
        <label><input type="radio" bind:group={metodo} value="auto" /> <span><b>Automático</b><small>Junta matérias e assuntos com o mesmo nome. Rápido, sem IA.</small></span></label>
        <label><input type="radio" bind:group={metodo} value="ia" /> <span><b>Com IA</b><small>Junta também os equivalentes com nomes diferentes e monta uma semana equilibrada.</small></span></label>
      </fieldset>
      {#if metodo === "auto"}
        <div><button type="button" class="primary" onclick={previaAuto}>Ver prévia</button></div>
      {:else}
        <label class="obs">
          Observações para a IA (opcional)
          <textarea rows="2" bind:value={notas} placeholder="Ex.: a prova A é prioridade; a B é só em 2028"></textarea>
        </label>
        <CopiarPrompt texto={prompt} />
        <h3>Cole a resposta da IA</h3>
        <ColarJson schema={PlanoSchema} onvalido={previaIa} />
      {/if}
    </section>
  {/if}

  {#if previa}
    {@const r = previa.resumo}
    <section class="card">
      <h3>Confira antes de criar</h3>
      <ul class="resumo">
        <li>{previa.dados.objetivo.provas.length} provas: {previa.dados.objetivo.provas.map((p) => p.nome).join("; ")}</li>
        <li>{r.materias} matérias e {r.assuntos} assuntos, sendo {r.juntados} assunto(s) em comum entre os dois perfis</li>
        {#if r.semDestino.length}
          <li class="bad">{r.semDestino.length} assunto(s) original(is) ficaram de fora e perdem o progresso: {r.semDestino.slice(0, 5).join("; ")}{r.semDestino.length > 5 ? "…" : ""}</li>
        {/if}
        {#if r.origensDesconhecidas.length}
          <li class="bad">A IA citou ids que não existem (ignorados): {r.origensDesconhecidas.slice(0, 5).join(", ")}</li>
        {/if}
      </ul>
      <details>
        <summary class="small">Ver matérias e de onde vêm</summary>
        <ul class="arvore">
          {#each previa.dados.materias as m (m.id)}
            <li>
              <b>{m.nome}</b> <span class="muted small">{(m.origens ?? []).join(" + ")}</span>
              <ol>
                {#each m.assuntos as a (a.id)}
                  <li>{a.nome}{#if (a.origens?.length ?? 0) > 1} <span class="chip ok">A + B</span>{/if}</li>
                {/each}
              </ol>
            </li>
          {/each}
        </ul>
      </details>
      {#if erro}<p class="err" role="alert">{erro}</p>{/if}
      <div class="row">
        <button type="button" class="primary" disabled={salvando} onclick={confirmar}>{salvando ? "Criando…" : "Criar perfil unido"}</button>
        <button type="button" onclick={() => (previa = null)}>Descartar</button>
      </div>
    </section>
  {/if}
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .grid label { display: flex; flex-direction: column; gap: 5px; font-size: 14px; font-weight: 600; min-width: 0; }
  .grid .full { grid-column: 1 / -1; }
  .grid input[type="text"], .grid select { width: 100%; }
  .metodo { border: 0; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .metodo label { display: flex; gap: 10px; align-items: flex-start; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; cursor: pointer; }
  .metodo label:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
  .metodo span { display: flex; flex-direction: column; }
  .metodo small { color: var(--muted); font-size: 13px; }
  .metodo input { margin-top: 4px; accent-color: var(--accent); }
  @media (max-width: 620px) { .grid, .metodo { grid-template-columns: minmax(0, 1fr); } }
  .obs { display: flex; flex-direction: column; gap: 5px; font-size: 14px; font-weight: 600; }
  .obs textarea { font: 14px/1.45 var(--body); }
  .resumo { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; }
  .resumo .bad { color: var(--bad); }
  .arvore { font-size: 14px; padding-left: 18px; }
  .arvore ol { margin: 2px 0 8px; color: var(--muted); }
</style>
