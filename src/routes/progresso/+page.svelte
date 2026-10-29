<script lang="ts">
  import { app } from "$lib/app.svelte";
  import Stats from "$lib/components/Stats.svelte";
  import { DIAS, dataCurta, diffDays, hoje, horas, parse, pad } from "$lib/datas";
  import { select } from "$lib/db";
  import { historico } from "$lib/rotina";

  type Linha = { id: number; concluidos: number; c: number; e: number; aulas: number; vistas: number };
  const plano = $derived(app.plano);
  let linhas = $state.raw<Map<number, Linha>>(new Map());
  let dias = $state.raw<{ data: string; minutos: number }[]>([]);

  async function carregar() {
    if (!plano || app.perfilId == null) return;
    const pid = app.perfilId;
    const r = await select<Linha>(
      `SELECT m.id,
              (SELECT COUNT(*) FROM conclusoes c JOIN assuntos a ON a.id = c.assunto_id WHERE a.materia_id = m.id AND c.perfil_id = $1) AS concluidos,
              (SELECT COALESCE(SUM(r.acertou), 0) FROM respostas r JOIN questoes q ON q.id = r.questao_id
                WHERE q.materia_id = m.id AND r.perfil_id = $1
                  AND r.id = (SELECT MAX(id) FROM respostas WHERE questao_id = q.id AND perfil_id = $1)) AS c,
              (SELECT COALESCE(SUM(1 - r.acertou), 0) FROM respostas r JOIN questoes q ON q.id = r.questao_id
                WHERE q.materia_id = m.id AND r.perfil_id = $1
                  AND r.id = (SELECT MAX(id) FROM respostas WHERE questao_id = q.id AND perfil_id = $1)) AS e,
              (SELECT COUNT(*) FROM aulas WHERE materia_id = m.id AND perfil_id = $1) AS aulas,
              (SELECT COUNT(*) FROM aulas WHERE materia_id = m.id AND perfil_id = $1 AND assistida_em IS NOT NULL) AS vistas
         FROM materias m WHERE m.plano_id = $2`,
      [pid, plano.id],
    );
    linhas = new Map(r.map((x) => [x.id, x]));
    dias = await historico(pid);
  }
  $effect(() => {
    void plano;
    void app.metricas;
    carregar();
  });

  const provasComData = $derived((plano?.provas ?? []).filter((p) => p.data_prova || p.previsao));
</script>

<div class="stack">
  <header>
    <div class="eyebrow">Progresso</div>
    <h1>Como você está indo</h1>
  </header>

  <Stats />

  {#if plano}
    {#if provasComData.length}
      <section class="card">
        <h3>Contagem regressiva</h3>
        <ul class="log-list">
          {#each provasComData as p (p.id)}
            {#if p.data_prova}
              {@const falta = diffDays(p.data_prova, hoje())}
              <li><b class="num">{falta >= 0 ? `${falta} dias` : "realizada"}</b> · {p.nome} ({dataCurta(p.data_prova)})</li>
            {:else}
              <li><b>Edital previsto</b> · {p.nome} · {p.previsao}</li>
            {/if}
          {/each}
        </ul>
      </section>
    {/if}

    <section class="card">
      <h3>Por matéria</h3>
      <p class="tip">Barra: assuntos concluídos. Abaixo: aproveitamento nas questões (última resposta de cada uma). Em provas certo/errado, cada erro anula um acerto.</p>
      {#each plano.materias as m (m.id)}
        {@const l = linhas.get(m.id)}
        {@const d = l?.concluidos ?? 0}
        {@const n = (l?.c ?? 0) + (l?.e ?? 0)}
        <div class="subj-row">
          <strong>{m.nome}</strong>
          <span class="num small">{d}/{m.assuntos.length}</span>
          <div class="bar"><i style:width={`${(d / Math.max(1, m.assuntos.length)) * 100}%`}></i></div>
          <div class="meta">
            {n ? `${n} questões · ${Math.round(((l?.c ?? 0) / n) * 100)}% de acerto · nota líquida ${(l?.c ?? 0) - (l?.e ?? 0)}` : "Nenhuma questão respondida ainda"}
            {#if l?.aulas} · aulas: {l.vistas}/{l.aulas} assistidas{/if}
          </div>
        </div>
      {/each}
    </section>

    <section class="card">
      <h3>Últimos dias estudados</h3>
      {#if !dias.length}
        <p class="empty">Quando você marcar “Estudei” em uma sessão, o dia aparece aqui.</p>
      {:else}
        <ul class="log-list">
          {#each dias as d (d.data)}
            {@const dt = parse(d.data)}
            <li><span class="num">{pad(dt.getDate())}/{pad(dt.getMonth() + 1)}</span> {DIAS[dt.getDay()]} · {horas(d.minutos)}</li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .log-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 15px; }
  .subj-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; padding: 10px 0; border-top: 1px solid var(--line); }
  .subj-row:first-of-type { border-top: 0; }
  .bar { grid-column: 1 / -1; height: 7px; background: var(--line); border-radius: 99px; overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--accent); }
  .meta { grid-column: 1 / -1; font-size: 13px; color: var(--muted); }
</style>
