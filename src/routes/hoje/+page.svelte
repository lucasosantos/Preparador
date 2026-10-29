<script lang="ts">
  import { app } from "$lib/app.svelte";
  import { listarAulas, type Aula } from "$lib/aulas";
  import AulaItem from "$lib/components/AulaItem.svelte";
  import QuestaoCard from "$lib/components/QuestaoCard.svelte";
  import Stats from "$lib/components/Stats.svelte";
  import { DIAS, addDays, dataCurta, diffDays, embaralhar, hoje, parse } from "$lib/datas";
  import { escolherQuestoes, listarQuestoes, type Questao } from "$lib/questoes";
  import {
    concluirAssunto,
    conclusoes,
    desfazerConclusao,
    extrasDoDia,
    marcarRevisao,
    registrarExtra,
    registrarSessao,
    removerSessao,
    revisoesDoDia,
    sessoesDoDia,
    type Revisao,
    type Sessao,
    type SessaoDb,
  } from "$lib/rotina";

  const HOJE = hoje();
  let cur = $state(HOJE);
  let sessoes = $state.raw<Sessao[]>([]);
  let revisoes = $state.raw<Revisao[]>([]);
  let aulas = $state.raw<Aula[]>([]);
  let questoes = $state.raw<Questao[]>([]);
  let extras = $state.raw<SessaoDb[]>([]);
  let feitos = $state.raw<Map<number, string>>(new Map());
  let minutos = $state<Record<number, number>>({});

  const plano = $derived(app.plano);
  const dt = $derived(parse(cur));
  const rotuloDia = $derived(
    cur === HOJE ? "Hoje" : cur === addDays(HOJE, -1) ? "Ontem" : cur === addDays(HOJE, 1) ? "Amanhã" : DIAS[dt.getDay()],
  );

  async function carregar() {
    const p = plano;
    const pid = app.perfilId;
    if (!p || pid == null) return;
    const [s, r, a, q, e, f] = await Promise.all([
      sessoesDoDia(pid, p, cur, app.perfil?.horas_dia ?? 3),
      revisoesDoDia(pid, cur),
      listarAulas(pid, p.id),
      listarQuestoes(pid, p.id),
      extrasDoDia(pid, cur),
      conclusoes(pid),
    ]);
    sessoes = s;
    revisoes = r;
    aulas = a;
    questoes = q;
    extras = e;
    feitos = f;
    minutos = Object.fromEntries(s.map((x) => [x.slot, x.registro?.minutos || x.planejado]));
  }

  $effect(() => {
    void cur;
    void plano;
    void app.perfil?.horas_dia;
    carregar();
  });

  async function depois() {
    await carregar();
    await app.recarregarMetricas();
  }

  async function marcarEstudo(s: Sessao, estudou: boolean) {
    await registrarSessao(app.perfilId!, cur, { slot: s.slot, materiaId: s.materiaId, assuntoId: s.assunto?.id ?? null }, estudou, Math.max(0, minutos[s.slot] || 0));
    await depois();
  }

  async function mudarMinutos(s: Sessao) {
    if (s.registro?.estudou) await marcarEstudo(s, true);
  }

  async function terminar(s: Sessao, fim: boolean) {
    if (!s.assunto) return;
    if (fim) {
      await registrarSessao(app.perfilId!, cur, { slot: s.slot, materiaId: s.materiaId, assuntoId: s.assunto.id }, true, Math.max(0, minutos[s.slot] || 0));
      await concluirAssunto(app.perfilId!, s.assunto.id, cur, plano!.revisoes);
    } else await desfazerConclusao(app.perfilId!, s.assunto.id);
    await depois();
  }

  async function alternarRevisao(r: Revisao, feita: boolean) {
    await marcarRevisao(r.id, feita ? cur : null);
    await depois();
  }

  const aulasDe = (s: Sessao) =>
    aulas.filter((a) => a.materia_id === s.materiaId && (a.assunto_id == null || a.assunto_id === s.assunto?.id));

  const simulado = $derived(
    (() => {
      const doDia = questoes.filter((q) => q.resposta?.data === cur);
      const resto = embaralhar(questoes.filter((q) => q.resposta?.data !== cur), "sim" + cur);
      return [...doDia, ...resto].slice(0, Math.max(10, doDia.length));
    })(),
  );
  const simFeito = $derived(simulado.length > 0 && simulado.every((q) => q.resposta?.data === cur));
  const simAcertos = $derived(simulado.filter((q) => q.resposta?.acertou).length);

  // estudo extra
  let exMateria = $state(0);
  let exAssunto = $state(0);
  let exMin = $state(30);
  let exFim = $state(false);
  $effect(() => {
    if (plano && !plano.materia.has(exMateria)) exMateria = plano.materias[0]?.id ?? 0;
  });
  async function salvarExtra() {
    await registrarExtra(app.perfilId!, cur, exMateria, exAssunto || null, Math.max(0, exMin || 0));
    if (exFim && exAssunto) await concluirAssunto(app.perfilId!, exAssunto, cur, plano!.revisoes);
    exFim = false;
    await depois();
  }
</script>

<div class="stack">
  <header>
    <div class="eyebrow">
      {plano?.provas
        .map((p) => [p.nome, p.banca, p.situacao === "previsto" ? `edital previsto${p.previsao ? `: ${p.previsao}` : ""}` : null].filter(Boolean).join(" · "))
        .join(" + ") ?? "Sem plano"}
    </div>
    {#if plano?.provas.some((p) => p.situacao === "previsto" && p.edital_base)}
      <p class="tip">Plano baseado em: {plano.provas.map((p) => p.edital_base).filter(Boolean).join("; ")}. Quando o edital sair, gere o plano de novo em <a href="/importar">Importar da IA</a> → Edital publicado; o progresso dos assuntos equivalentes é mantido.</p>
    {/if}
    <h1>{plano?.objetivo.nome ?? app.perfil?.nome}</h1>
  </header>

  <Stats />

  {#if !plano}
    <section class="card">
      <h3>Este perfil ainda não tem plano</h3>
      <p class="tip">Gere o plano a partir de um edital (ou de várias provas, no modo constância) usando o prompt pronto.</p>
      <div><a class="btn primary" href="/importar">Criar plano com a IA</a></div>
    </section>
  {:else}
    <div class="daynav">
      <button type="button" aria-label="Dia anterior" onclick={() => (cur = addDays(cur, -1))}>← Anterior</button>
      <div class="title">
        <h2>{rotuloDia}</h2>
        <small>{DIAS[dt.getDay()]} · {dataCurta(cur)}</small>
      </div>
      <button type="button" aria-label="Próximo dia" onclick={() => (cur = addDays(cur, 1))}>Próximo →</button>
    </div>
    {#if cur !== HOJE}<div><button type="button" onclick={() => (cur = HOJE)}>Voltar para hoje</button></div>{/if}

    {#if revisoes.length}
      <section class="card review">
        <div class="card-head"><h3>Revisões programadas</h3><span class="chip">15 min cada</span></div>
        <p class="tip">Releia o resumo e refaça as questões que errou desse assunto.</p>
        <ul class="review-list">
          {#each revisoes as r (r.id)}
            {@const a = plano.assunto.get(r.assunto_id)}
            {#if a}
              <li>
                <label>
                  <input type="checkbox" checked={!!r.feita_em} onchange={(e) => alternarRevisao(r, e.currentTarget.checked)} />
                  <span>{a.nome}<small>{plano.materia.get(a.materia_id)?.nome} · revisão de {r.intervalo} {r.intervalo === 1 ? "dia" : "dias"}{r.data_prevista < cur && !r.feita_em ? ` · atrasada ${diffDays(cur, r.data_prevista)}d` : ""}</small></span>
                </label>
              </li>
            {/if}
          {/each}
        </ul>
      </section>
    {/if}

    {#if !sessoes.length}
      <section class="card">
        <div class="card-head"><h3>{DIAS[dt.getDay()]}: simulado e descanso</h3><span class="chip">{simulado.length} itens</span></div>
        <p class="tip">Sem matéria nova. Faça as revisões acima e resolva o simulado misto.</p>
      </section>
      <section class="card">
        <h3>Simulado misto</h3>
        {#if !simulado.length}<p class="empty">Nenhuma questão cadastrada. Gere questões em Importar da IA → Questões.</p>{/if}
        {#each simulado as q (q.id)}
          <QuestaoCard {q} data={cur} rotulo={plano.materia.get(q.materia_id)?.nome} onrespondida={carregar} />
        {/each}
        {#if simFeito}
          <p class="tip">Resultado: {simAcertos} certos, {simulado.length - simAcertos} errados. Nota no padrão certo/errado: {simAcertos - (simulado.length - simAcertos)}.</p>
        {/if}
      </section>
    {/if}

    {#each sessoes as s (s.slot)}
      {@const m = plano.materia.get(s.materiaId)}
      {@const fim = !!(s.assunto && feitos.has(s.assunto.id))}
      {@const al = aulasDe(s)}
      {@const qs = escolherQuestoes(questoes.filter((q) => q.materia_id === s.materiaId), cur, 3, `${cur}-${s.slot}`, s.assunto?.id ?? null)}
      <section class="card" class:done={s.registro?.estudou}>
        <div class="card-head">
          <h3>{m?.nome}</h3>
          <span class="chip" class:ok={s.registro?.estudou}>{s.registro?.estudou ? `feito · ${s.registro.minutos} min` : `${s.planejado} min planejados`}</span>
        </div>
        <div class="topic">
          <strong>{s.assunto?.nome ?? "Todos os assuntos concluídos: faça revisão geral e questões"}</strong>
          {#if s.assunto?.detalhe}<span class="small muted">{s.assunto.detalhe}</span>{/if}
          {#if plano.objetivo.tipo === "constancia" && s.assunto}<span class="small muted">Cobrado em {s.assunto.nProvas} de {plano.provas.length} provas</span>{/if}
        </div>

        <div class="aulas">
          <div class="aulas-head">
            <h3>Aulas</h3>
            <a class="btn small" href={`/aulas?materia=${s.materiaId}&assunto=${s.assunto?.id ?? ""}`}>{al.length ? "Adicionar outra" : "Cadastrar aula"}</a>
          </div>
          {#each al as a (a.id)}<AulaItem {a} meta={false} onmudou={carregar} />{:else}<p class="empty small">Nenhuma aula para este assunto.</p>{/each}
        </div>

        <div class="controls">
          <label><input type="checkbox" checked={!!s.registro?.estudou} onchange={(e) => marcarEstudo(s, e.currentTarget.checked)} /> Estudei</label>
          <label><input type="number" min="0" max="600" step="5" bind:value={minutos[s.slot]} onchange={() => mudarMinutos(s)} aria-label="Minutos estudados" /> min</label>
          <label><input type="checkbox" checked={fim} disabled={!s.assunto} onchange={(e) => terminar(s, e.currentTarget.checked)} /> Terminei este assunto</label>
        </div>

        <div class="qs">
          <div class="qs-head">
            <h3>Questões da sessão</h3>
            <a class="btn small" href={`/importar?aba=questoes&materia=${s.materiaId}&assunto=${s.assunto?.id ?? ""}`}>Gerar mais com IA</a>
          </div>
          {#each qs as q (q.id)}<QuestaoCard {q} data={cur} onrespondida={carregar} />{:else}<p class="empty small">Sem questões para esta matéria ainda.</p>{/each}
        </div>
      </section>
    {/each}

    <section class="card">
      <h3>Registrar estudo fora do plano</h3>
      <p class="tip">Estudou outra coisa? Registre aqui para contar nas horas e no progresso.</p>
      <div class="row">
        <select bind:value={exMateria} onchange={() => (exAssunto = 0)} aria-label="Matéria">
          {#each plano.materias as m (m.id)}<option value={m.id}>{m.nome}</option>{/each}
        </select>
        <select bind:value={exAssunto} aria-label="Assunto" class="grow">
          <option value={0}>Assunto não específico</option>
          {#each plano.materia.get(exMateria)?.assuntos ?? [] as a (a.id)}<option value={a.id}>{a.nome}</option>{/each}
        </select>
      </div>
      <div class="row">
        <label class="small"><input type="number" min="5" max="600" step="5" bind:value={exMin} /> min</label>
        <label class="small"><input type="checkbox" bind:checked={exFim} disabled={!exAssunto} /> Terminei este assunto</label>
        <button type="button" class="primary" onclick={salvarExtra}>Registrar</button>
      </div>
      {#if extras.length}
        <ul class="log-list">
          {#each extras as e (e.id)}
            <li>
              {plano.materia.get(e.materia_id)?.nome}{e.assunto_id ? `: ${plano.assunto.get(e.assunto_id)?.nome}` : ""} · {e.minutos} min
              <button type="button" class="small" onclick={async () => { await removerSessao(e.id); await depois(); }}>Remover</button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .daynav { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .daynav .title { display: flex; flex-direction: column; align-items: center; text-align: center; min-width: 0; }
  .daynav small { font: 500 12px var(--mono); color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
  .card.done { border-color: var(--accent); }
  .card.review { background: var(--gold-soft); border-color: var(--gold); }
  .topic { display: flex; flex-direction: column; gap: 2px; }
  .topic strong { font-size: 17px; }
  .controls { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; padding-top: 10px; border-top: 1px solid var(--line); }
  .controls label { display: flex; align-items: center; gap: 7px; cursor: pointer; font-size: 15px; }
  .controls input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--accent); }
  .aulas, .qs { display: flex; flex-direction: column; gap: 8px; }
  .aulas-head, .qs-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
  .review-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .review-list label { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; }
  .review-list input { margin-top: 4px; width: 17px; height: 17px; accent-color: var(--gold); flex: none; }
  .review-list small { display: block; color: var(--muted); }
  .log-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 15px; }
  .grow { flex: 1 1 220px; min-width: 0; }
  .row label { display: flex; align-items: center; gap: 6px; }
</style>
