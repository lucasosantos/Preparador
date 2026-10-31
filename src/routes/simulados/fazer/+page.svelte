<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { app } from "$lib/app.svelte";
  import { pad } from "$lib/datas";
  import { LETRAS, rotuloGabarito } from "$lib/questoes";
  import {
    carregarSimulado,
    finalizarSimulado,
    iniciarSimulado,
    marcarResposta,
    refazerSimulado,
    resultado,
    type ItemSimulado,
    type Simulado,
  } from "$lib/simulados";

  const id = $derived(Number(page.url.searchParams.get("id")) || 0);
  let simulado = $state.raw<Simulado | null>(null);
  let itens = $state<ItemSimulado[]>([]);
  let carregado = $state(false);
  let atual = $state(0);

  async function carregar(alvo: number) {
    carregado = false;
    const r = await carregarSimulado(alvo);
    if (alvo !== id) return;
    if (r && !r.simulado.finalizado_em && r.itens.length) r.simulado.iniciado_em = await iniciarSimulado(alvo);
    simulado = r?.simulado ?? null;
    itens = r?.itens ?? [];
    atual = r?.simulado.finalizado_em ? 0 : Math.max(0, itens.findIndex((i) => i.resposta == null));
    carregado = true;
  }
  $effect(() => {
    carregar(id);
  });

  const finalizado = $derived(!!simulado?.finalizado_em);
  const item = $derived(itens[atual]);
  const respondidas = $derived(itens.filter((i) => i.resposta != null).length);
  const nomeMateria = (i: ItemSimulado) => app.plano?.materia.get(i.q.materia_id)?.nome ?? "Matéria fora do plano";
  const nomeAssunto = (i: ItemSimulado) => (i.q.assunto_id ? app.plano?.assunto.get(i.q.assunto_id)?.nome : null);

  // ---------- cronômetro ----------
  let agora = $state(Date.now());
  $effect(() => {
    if (finalizado || !simulado?.iniciado_em) return;
    const t = setInterval(() => (agora = Date.now()), 1000);
    return () => clearInterval(t);
  });
  const decorrido = $derived(simulado?.iniciado_em ? Math.max(0, Math.floor((agora - new Date(simulado.iniciado_em).getTime()) / 1000)) : 0);
  const restante = $derived(simulado?.tempo_min ? simulado.tempo_min * 60 - decorrido : null);
  const relogio = (seg: number) => {
    const s = Math.max(0, seg);
    const h = Math.floor(s / 3600);
    return `${h ? `${h}:` : ""}${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  };
  // acabou o tempo: entrega como está
  $effect(() => {
    if (restante != null && restante <= 0 && !finalizado && carregado) finalizar(true);
  });

  // ---------- responder ----------
  async function marcar(r: string | null) {
    if (finalizado || !item) return;
    const i = item;
    i.resposta = i.resposta === r ? null : r;
    await marcarResposta(id, i.q.id, i.resposta);
  }
  function ir(n: number) {
    atual = Math.max(0, Math.min(itens.length - 1, n));
  }

  let armado = $state(false);
  let finalizando = false;
  async function finalizar(forcar = false) {
    if (finalizando) return;
    if (!forcar && !armado) {
      armado = true;
      setTimeout(() => (armado = false), 5000);
      return;
    }
    finalizando = true;
    armado = false;
    await finalizarSimulado(id);
    await app.recarregarMetricas();
    await carregar(id);
    finalizando = false;
    scrollTo({ top: 0 });
  }

  async function refazer() {
    const novo = await refazerSimulado(id);
    if (novo) goto(`/simulados/fazer?id=${novo}`);
  }

  function teclas(e: KeyboardEvent) {
    const alvo = e.target as HTMLElement;
    if (!item || e.ctrlKey || e.metaKey || e.altKey || alvo.closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === "ArrowRight") ir(atual + 1);
    else if (e.key === "ArrowLeft") ir(atual - 1);
    else if (!finalizado) {
      const k = e.key.toUpperCase();
      if (item.q.tipo === "CE" && (k === "C" || k === "E")) marcar(k);
      else if (item.q.tipo === "ME" && item.q.alternativas && LETRAS.slice(0, item.q.alternativas.length).includes(k) && k.length === 1) marcar(k);
      else return;
    } else return;
    e.preventDefault();
  }

  // ---------- resultado ----------
  const res = $derived(finalizado ? resultado(itens) : null);
  const pct = (a: number, t: number) => (t ? Math.round((a / t) * 100) : 0);
  let filtro = $state<"todas" | "erradas" | "brancos">("todas");
  const visiveis = $derived(
    itens.map((i, k) => ({ i, k })).filter(({ i }) => (filtro === "erradas" ? i.acertou === false : filtro === "brancos" ? i.resposta == null : true)),
  );
  $effect(() => {
    if (finalizado && visiveis.length && !visiveis.some((v) => v.k === atual)) atual = visiveis[0].k;
  });
  const estado = (i: ItemSimulado) => (!finalizado ? (i.resposta != null ? "feita" : "") : i.resposta == null ? "branco" : i.acertou ? "certa" : "errada");
</script>

<svelte:window onkeydown={teclas} />

<div class="stack">
  <a class="voltar" href="/simulados">← Simulados</a>
  {#if !carregado}
    <p class="empty">Carregando…</p>
  {:else if !simulado || !itens.length}
    <section class="card"><p class="empty">Simulado não encontrado, ou as questões dele foram excluídas do banco.</p></section>
  {:else}
    <header class="topo">
      <div>
        <div class="eyebrow">{finalizado ? "Resultado" : "Simulado em andamento"}</div>
        <h1>{simulado.titulo}</h1>
      </div>
      {#if !finalizado}
        <div class="status">
          <span class="chip">{respondidas}/{itens.length} respondidas</span>
          {#if restante != null}
            <span class="chip relogio" class:pouco={restante < 300} role="timer" aria-label="Tempo restante">{relogio(restante)}</span>
          {:else}
            <span class="chip relogio" role="timer" aria-label="Tempo decorrido">{relogio(decorrido)}</span>
          {/if}
        </div>
      {/if}
    </header>

    {#if res}
      {@const g = res.geral}
      <section class="card">
        <div class="placar">
          <div class="grande"><span class="num">{pct(g.acertos, g.total)}%</span><small>de acerto</small></div>
          <div><span class="num ok">{g.acertos}</span><small>certas</small></div>
          <div><span class="num bad">{g.erros}</span><small>erradas</small></div>
          <div><span class="num">{g.brancos}</span><small>em branco</small></div>
          {#if g.ce.acertos + g.ce.erros}
            <div><span class="num">{g.ce.acertos - g.ce.erros}</span><small>nota líquida C/E</small></div>
          {/if}
          {#if simulado.duracao_seg != null}
            <div><span class="num">{relogio(simulado.duracao_seg)}</span><small>tempo{simulado.tempo_min ? ` de ${simulado.tempo_min} min` : ""}</small></div>
          {/if}
        </div>
        {#if g.ce.acertos + g.ce.erros}
          <p class="tip">Nota líquida: no certo/errado cada erro anula um acerto, como no Cebraspe. Em branco não conta.</p>
        {/if}
        <table class="materias">
          <thead><tr><th>Matéria</th><th>Certas</th><th>Erradas</th><th>Branco</th><th class="barra-col">Acerto</th></tr></thead>
          <tbody>
            {#each [...res.porMateria] as [mid, p] (mid)}
              <tr>
                <td>{app.plano?.materia.get(mid)?.nome ?? "Fora do plano"}</td>
                <td class="num">{p.acertos}</td>
                <td class="num">{p.erros}</td>
                <td class="num">{p.brancos}</td>
                <td class="barra-col">
                  <span class="barra"><span style:width="{pct(p.acertos, p.total)}%" class:fraco={pct(p.acertos, p.total) < 50}></span></span>
                  <span class="num small">{pct(p.acertos, p.total)}%</span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <div class="row">
          <button type="button" class="primary" onclick={refazer}>Refazer este simulado</button>
          <a class="btn" href="/simulados">Novo simulado</a>
        </div>
      </section>

      <div class="row">
        <h2 class="rev">Revisão</h2>
        <select bind:value={filtro} aria-label="Mostrar">
          <option value="todas">Todas</option>
          <option value="erradas">Só as erradas ({g.erros})</option>
          <option value="brancos">Só as em branco ({g.brancos})</option>
        </select>
      </div>
    {/if}

    <nav class="mapa" aria-label="Questões">
      {#each itens as i, k (i.q.id)}
        {#if !finalizado || visiveis.some((v) => v.k === k)}
          <button
            type="button"
            class="n {estado(i)}"
            class:atual={k === atual}
            aria-current={k === atual ? "true" : undefined}
            aria-label="Questão {k + 1}{i.resposta != null ? ', respondida' : ''}"
            onclick={() => ir(k)}>{k + 1}</button
          >
        {/if}
      {/each}
    </nav>

    {#if item && (!finalizado || visiveis.length)}
      {@const q = item.q}
      <section class="card questao">
        <div class="meta">
          <span class="eyebrow">Questão {atual + 1} de {itens.length}</span>
          <span class="small muted">{nomeMateria(item)}{nomeAssunto(item) ? ` · ${nomeAssunto(item)}` : ""}</span>
          {#if q.fonte}<span class="small muted">{q.fonte}</span>{/if}
        </div>
        <p class="enunciado">{q.enunciado}</p>

        {#if q.tipo === "ME" && q.alternativas}
          <ol class="alts">
            {#each q.alternativas as alt, k (k)}
              {@const letra = LETRAS[k]}
              <li>
                <button
                  type="button"
                  class="alt"
                  class:marcada={item.resposta === letra}
                  class:certa={finalizado && letra === q.gabarito}
                  class:errada={finalizado && item.resposta === letra && letra !== q.gabarito}
                  aria-pressed={item.resposta === letra}
                  disabled={finalizado}
                  onclick={() => marcar(letra)}><b>{letra}</b> {alt}</button
                >
              </li>
            {/each}
          </ol>
        {:else}
          <div class="ce">
            {#each [["C", "Certo"], ["E", "Errado"]] as [v, nome] (v)}
              <button
                type="button"
                class:marcada={item.resposta === v}
                class:certa={finalizado && v === q.gabarito}
                class:errada={finalizado && item.resposta === v && v !== q.gabarito}
                aria-pressed={item.resposta === v}
                disabled={finalizado}
                onclick={() => marcar(v)}>{nome}</button
              >
            {/each}
          </div>
        {/if}

        {#if finalizado}
          <div class="verdict" class:ok={item.acertou} class:bad={item.acertou === false}>
            <b>
              {item.resposta == null ? "Em branco." : item.acertou ? "Você acertou." : "Você errou."}
              Gabarito: {rotuloGabarito(q)}{q.gabarito_oficial ? "" : " (resolvido pela IA, não oficial)"}
            </b>
            {#if q.explicacao}{q.explicacao}{/if}
          </div>
        {/if}

        <div class="nav">
          <button type="button" onclick={() => ir(atual - 1)} disabled={atual === 0}>← Anterior</button>
          {#if !finalizado && item.resposta != null}
            <button type="button" class="small" onclick={() => marcar(null)}>Apagar resposta</button>
          {/if}
          <button type="button" class:primary={!finalizado && item.resposta != null} onclick={() => ir(atual + 1)} disabled={atual === itens.length - 1}>Próxima →</button>
        </div>
      </section>
    {:else if finalizado}
      <p class="empty">Nenhuma questão neste filtro.</p>
    {/if}

    {#if !finalizado}
      <section class="card fim">
        <p class="tip">
          Atalhos: ← e → mudam de questão; {itens.some((i) => i.q.tipo === "CE") ? "C e E marcam certo e errado" : ""}{itens.some((i) => i.q.tipo === "CE") && itens.some((i) => i.q.tipo === "ME") ? "; " : ""}{itens.some((i) => i.q.tipo === "ME") ? "A a E marcam a alternativa" : ""}.
          As respostas ficam salvas: dá para fechar e continuar depois{simulado.tempo_min ? ", mas o cronômetro continua correndo" : ""}.
        </p>
        <div class="row">
          <button type="button" class="primary" onclick={() => finalizar()}>
            {armado ? `Confirmar entrega${itens.length - respondidas ? ` (${itens.length - respondidas} em branco)` : ""}` : "Finalizar e ver resultado"}
          </button>
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .voltar { color: var(--muted); text-decoration: none; font-size: 14px; }
  .voltar:hover { color: var(--accent); }
  .topo { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
  .status { display: flex; gap: 8px; align-items: center; }
  .relogio { font-size: 15px; padding: 4px 12px; }
  .relogio.pouco { background: var(--bad-soft); color: var(--bad); }
  .mapa { display: flex; flex-wrap: wrap; gap: 6px; }
  .n {
    width: 38px; height: 34px; padding: 0; font: 500 13px var(--mono); border-radius: 7px;
    background: var(--surface); color: var(--muted);
  }
  .n.feita { background: var(--accent-soft); color: var(--fg); border-color: var(--accent-soft); }
  .n.certa { background: var(--ok-soft); color: var(--ok); border-color: var(--ok); }
  .n.errada { background: var(--bad-soft); color: var(--bad); border-color: var(--bad); }
  .n.branco { color: var(--muted); border-style: dashed; }
  .n.atual { outline: 2px solid var(--fg); outline-offset: 1px; }
  .questao { gap: 14px; }
  .meta { display: flex; flex-direction: column; gap: 2px; }
  .enunciado { margin: 0; white-space: pre-line; font-size: 17px; line-height: 1.6; }
  .alts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .alt {
    display: block; width: 100%; text-align: left; font: 16px var(--body); padding: 10px 12px;
    border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--fg);
  }
  .alt b { font-family: var(--mono); margin-right: 8px; }
  .ce { display: flex; gap: 10px; }
  .ce button { min-width: 110px; padding: 10px 16px; font-size: 15px; background: var(--bg); }
  .alt:disabled, .ce button:disabled { opacity: 1; cursor: default; }
  .marcada { border-color: var(--accent) !important; background: var(--accent-soft) !important; }
  .certa { border-color: var(--ok) !important; background: var(--ok-soft) !important; }
  .errada { border-color: var(--bad) !important; background: var(--bad-soft) !important; }
  .verdict { border-radius: 8px; padding: 10px 12px; font-size: 15px; background: var(--bg); }
  .verdict.ok { background: var(--ok-soft); }
  .verdict.bad { background: var(--bad-soft); }
  .verdict b { display: block; margin-bottom: 2px; }
  .verdict.ok b { color: var(--ok); }
  .verdict.bad b { color: var(--bad); }
  .nav { display: flex; justify-content: space-between; align-items: center; gap: 8px; border-top: 1px solid var(--line); padding-top: 12px; }
  .placar { display: flex; flex-wrap: wrap; gap: 12px 28px; align-items: flex-end; }
  .placar div { display: flex; flex-direction: column; }
  .placar .num { font: 700 24px var(--mono); }
  .placar .grande .num { font-size: 40px; color: var(--accent); }
  .placar .ok { color: var(--ok); }
  .placar .bad { color: var(--bad); }
  .placar small { color: var(--muted); font-size: 13px; }
  .materias { width: 100%; border-collapse: collapse; font-size: 14px; }
  .materias th { text-align: left; font: 500 11px var(--mono); text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 6px 8px 6px 0; }
  .materias td { padding: 7px 8px 7px 0; border-top: 1px solid var(--line); }
  .materias td.num { font-family: var(--mono); }
  .barra-col { width: 34%; }
  td.barra-col { display: flex; align-items: center; gap: 8px; }
  .barra { flex: 1; height: 8px; border-radius: 99px; background: var(--bg); overflow: hidden; }
  .barra span { display: block; height: 100%; background: var(--ok); border-radius: 99px; }
  .barra span.fraco { background: var(--gold); }
  .rev { flex: 1; }
  @media (max-width: 620px) {
    .barra-col { width: auto; }
    .materias th:nth-child(4), .materias td:nth-child(4) { display: none; }
  }
</style>
