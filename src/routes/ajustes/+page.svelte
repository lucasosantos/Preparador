<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import { CORES, app, type Tema } from "$lib/app.svelte";
  import { exportarPerfil, importarBackup } from "$lib/backup";
  import { DIAS } from "$lib/datas";
  import { execute } from "$lib/db";
  import { salvarDataProva, salvarRevisoes, salvarSemana } from "$lib/planos";
  import { PROMPTS, copiar, salvarTemplate, templates, type ChavePrompt } from "$lib/prompts";

  const plano = $derived(app.plano);
  let msg = $state<Record<string, string>>({});
  function aviso(k: string, t: string) {
    msg[k] = t;
    setTimeout(() => (msg[k] = ""), 4000);
  }

  // ---------- plano ----------
  let revisoesTxt = $state("");
  let semana = $state<number[][]>([[], [], [], [], [], [], []]);
  let adicionar = $state<number[]>([0, 0, 0, 0, 0, 0, 0]);
  $effect(() => {
    if (!plano) return;
    revisoesTxt = plano.revisoes.join(", ");
    semana = plano.semana.map((d) => [...d]);
  });

  async function salvarIntervalos() {
    const v = [...new Set(revisoesTxt.split(/[,;\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 365))].sort((a, b) => a - b);
    if (!v.length) return aviso("rev", "Informe ao menos um intervalo, ex.: 1, 7, 30.");
    await salvarRevisoes(plano!.id, v);
    await app.recarregarPlano();
    aviso("rev", "Intervalos salvos. Valem para os próximos assuntos concluídos.");
  }

  async function mudarData(provaId: number, valor: string) {
    await salvarDataProva(provaId, valor || null);
    await app.recarregarPlano();
  }

  function mover(dia: number, i: number, delta: number) {
    const l = semana[dia];
    const j = i + delta;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
  }

  async function gravarSemana() {
    await salvarSemana(plano!.id, semana);
    await app.recarregarPlano();
    aviso("sem", "Semana salva.");
  }

  // ---------- prompts ----------
  let chave = $state<ChavePrompt>("plano.edital");
  let texto = $state("");
  let editado = $state(false);
  async function carregarPrompt() {
    const t = (await templates())[chave];
    texto = t.texto;
    editado = t.editado;
  }
  $effect(() => {
    void chave;
    carregarPrompt();
  });
  async function salvarPrompt() {
    await salvarTemplate(chave, texto);
    await carregarPrompt();
    aviso("prompt", "Prompt salvo.");
  }
  async function restaurarPrompt() {
    await salvarTemplate(chave, null);
    await carregarPrompt();
    aviso("prompt", "Prompt padrão restaurado.");
  }

  // ---------- backup ----------
  let backupOut = $state("");
  let backupIn = $state("");
  async function exportar() {
    backupOut = await exportarPerfil(app.perfilId!);
    aviso("bk", (await copiar(backupOut)) ? "Backup copiado. Guarde em um arquivo .json." : "Selecione o texto e copie.");
  }
  async function restaurar() {
    try {
      const id = await importarBackup(backupIn);
      await app.recarregarPerfis();
      await app.escolherPerfil(id);
      backupIn = "";
      aviso("bk", "Backup restaurado como um novo perfil.");
    } catch (e) {
      aviso("bk", `Backup inválido: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    }
  }

  // ---------- MCP ----------
  type StatusMcp = { ligado: boolean; porta: number; token: string; rodando: boolean; erro: string | null; executavel: string | null };
  let mcp = $state<StatusMcp | null>(null);
  let mostrarToken = $state(false);
  onMount(async () => {
    try {
      mcp = await invoke<StatusMcp>("mcp_status");
    } catch {
      mcp = null;
    }
  });
  async function configurarMcp(ligado: boolean, novoToken = false) {
    mcp = await invoke<StatusMcp>("mcp_configurar", { ligado, trocarToken: novoToken });
    if (novoToken) aviso("mcp", "Token novo gerado. Atualize a configuração no Claude Code; no Claude Desktop não muda nada.");
  }
  const urlMcp = $derived(mcp ? `http://127.0.0.1:${mcp.porta}/mcp` : "");
  const cfgDesktop = $derived(
    mcp ? JSON.stringify({ mcpServers: { preparador: { command: mcp.executavel ?? "caminho/do/preparador", args: ["--mcp"] } } }, null, 2) : "",
  );
  const cmdCode = $derived(mcp ? `claude mcp add --transport http preparador ${urlMcp} --header "Authorization: Bearer ${mcp.token}"` : "");
  async function copiarCfg(t: string) {
    aviso("mcp", (await copiar(t)) ? "Copiado." : "Selecione e copie manualmente.");
  }

  // ---------- zerar ----------
  let zerarArmado = $state(false);
  async function zerar() {
    if (!zerarArmado) {
      zerarArmado = true;
      setTimeout(() => (zerarArmado = false), 4000);
      return;
    }
    zerarArmado = false;
    const p = app.perfilId;
    for (const t of ["sessoes", "conclusoes", "revisoes", "respostas"]) await execute(`DELETE FROM ${t} WHERE perfil_id = $1`, [p]);
    await execute("UPDATE aulas SET assistida_em = NULL WHERE perfil_id = $1", [p]);
    await app.recarregarPlano();
    aviso("zerar", "Progresso apagado.");
  }
</script>

<div class="stack">
  <header>
    <div class="eyebrow">Ajustes</div>
    <h1>{app.perfil?.nome}</h1>
  </header>

  <section class="card">
    <h3>Aparência</h3>
    <fieldset class="cores">
      <legend class="small muted">Cor da interface</legend>
      {#each CORES as c (c.valor)}
        <label class="cor" title={c.nome}>
          <input type="radio" name="cor" value={c.valor} checked={app.cor === c.valor} onchange={() => app.mudarCor(c.valor)} />
          <span class="amostra" style:background={c.amostra}></span>
          <span class="small">{c.nome}</span>
        </label>
      {/each}
    </fieldset>
    <label class="campo">
      <span>Tema</span>
      <select value={app.tema} onchange={(e) => app.mudarTema(e.currentTarget.value as Tema)}>
        <option value="sistema">Do sistema</option>
        <option value="claro">Claro</option>
        <option value="escuro">Escuro</option>
      </select>
    </label>
  </section>

  <section class="card">
    <h3>Perfil</h3>
    <p class="tip">{app.perfil?.horas_dia} horas por dia, divididas entre as matérias do dia. Para mudar nome, idioma ou horas, vá em <a href="/perfis">Perfis</a>.</p>
  </section>

  {#if plano}
    <section class="card">
      <div class="card-head">
        <h3>Plano</h3>
        <span class="chip">versão {plano.versao} · {plano.objetivo.tipo === "edital" ? "edital" : "constância"}</span>
      </div>
      <p class="tip">Para atualizar matérias e assuntos (ex.: saiu o edital novo), gere o plano de novo em <a href="/importar">Importar da IA</a>. Assuntos com o mesmo id mantêm o progresso.</p>
      {#each plano.provas as p (p.id)}
        <label class="campo">
          <span>{p.nome}{p.banca ? ` · ${p.banca}` : ""}{p.situacao === "previsto" ? ` · edital previsto${p.previsao ? ` (${p.previsao})` : ""}` : ""}: data da prova</span>
          <input type="date" value={p.data_prova ?? ""} onchange={(e) => mudarData(p.id, e.currentTarget.value)} />
        </label>
      {/each}
      <label class="campo">
        <span>Revisões após concluir um assunto (em dias)</span>
        <div class="row"><input type="text" bind:value={revisoesTxt} placeholder="1, 7, 30" /><button type="button" onclick={salvarIntervalos}>Salvar</button></div>
      </label>
      {#if msg.rev}<p class="tip" role="status">{msg.rev}</p>{/if}
    </section>

    <section class="card">
      <h3>Semana-modelo</h3>
      <p class="tip">Cada matéria vira uma sessão no dia. Dia sem matérias vira dia de simulado e revisão.</p>
      {#each DIAS as nome, d (d)}
        <div class="dia">
          <b>{nome}</b>
          <div class="chips">
            {#each semana[d] as mid, i (`${d}-${i}`)}
              <span class="pill">
                {plano.materia.get(mid)?.nome}
                <button type="button" aria-label="Mover para cima" onclick={() => mover(d, i, -1)} disabled={i === 0}>↑</button>
                <button type="button" aria-label="Remover" onclick={() => semana[d].splice(i, 1)}>×</button>
              </span>
            {:else}
              <span class="muted small">simulado e revisão</span>
            {/each}
          </div>
          <div class="row">
            <select bind:value={adicionar[d]} aria-label={`Adicionar matéria em ${nome}`}>
              <option value={0}>+ matéria</option>
              {#each plano.materias.filter((m) => !semana[d].includes(m.id)) as m (m.id)}<option value={m.id}>{m.nome}</option>{/each}
            </select>
            <button type="button" class="small" disabled={!adicionar[d]} onclick={() => { semana[d].push(adicionar[d]); adicionar[d] = 0; }}>Adicionar</button>
          </div>
        </div>
      {/each}
      <div class="row">
        <button type="button" class="primary" onclick={gravarSemana}>Salvar semana</button>
        {#if msg.sem}<span class="small muted" role="status">{msg.sem}</span>{/if}
      </div>
    </section>
  {/if}

  <section class="card">
    <div class="card-head">
      <h3>Conectar com agentes de IA (MCP)</h3>
      {#if mcp}<span class="chip" class:ok={mcp.rodando}>{mcp.rodando ? `ligado · porta ${mcp.porta}` : "desligado"}</span>{/if}
    </div>
    <p class="tip">
      Para quem tem assinatura do Claude (ou outro agente compatível com MCP): o agente lê seu plano, registra estudos, faz
      questões com você e importa planos, aulas e questões direto, sem copiar e colar. Os prompts continuam disponíveis no
      agente e na tela Importar. O Preparador precisa estar aberto; o servidor só aceita conexões deste computador.
    </p>
    {#if !mcp}
      <p class="err">Não foi possível consultar o servidor MCP.</p>
    {:else}
      <label class="row"><input type="checkbox" checked={mcp.ligado} onchange={(e) => configurarMcp(e.currentTarget.checked)} /> Servidor MCP ligado</label>
      {#if mcp.erro}<p class="err">{mcp.erro}</p>{/if}
      {#if mcp.ligado}
        <div class="campo">
          <span>Claude Desktop: em Configurações → Desenvolvedor → Editar configuração, junte isto ao arquivo e reinicie o Claude</span>
          <textarea rows="8" readonly value={cfgDesktop}></textarea>
          <div><button type="button" class="small" onclick={() => copiarCfg(cfgDesktop)}>Copiar</button></div>
        </div>
        <div class="campo">
          <span>Claude Code: rode no terminal</span>
          <textarea rows="2" readonly value={mostrarToken ? cmdCode : cmdCode.replace(mcp.token, "••••••••")}></textarea>
          <div class="row">
            <button type="button" class="small" onclick={() => copiarCfg(cmdCode)}>Copiar</button>
            <button type="button" class="small" onclick={() => (mostrarToken = !mostrarToken)}>{mostrarToken ? "Ocultar token" : "Mostrar token"}</button>
            <button type="button" class="small" onclick={() => configurarMcp(true, true)}>Gerar novo token</button>
          </div>
        </div>
        <p class="tip">Experimente pedir ao Claude: "O que tenho para estudar hoje no Preparador?" ou "Me faça 5 questões de Direito Penal que eu ainda não respondi".</p>
      {/if}
      {#if msg.mcp}<p class="tip" role="status">{msg.mcp}</p>{/if}
    {/if}
  </section>

  <section class="card">
    <h3>Prompts</h3>
    <select bind:value={chave} aria-label="Prompt">
      {#each Object.entries(PROMPTS) as [k, p] (k)}<option value={k}>{p.nome}</option>{/each}
    </select>
    <p class="tip">{PROMPTS[chave].descricao} Variáveis: {PROMPTS[chave].variaveis.map((v) => `{{${v}}}`).join(", ")}. O formato JSON pedido no fim precisa continuar igual.</p>
    <textarea rows="16" bind:value={texto}></textarea>
    <div class="row">
      <button type="button" class="primary" onclick={salvarPrompt}>Salvar prompt</button>
      <button type="button" onclick={restaurarPrompt} disabled={!editado}>Restaurar padrão</button>
      {#if editado}<span class="chip">editado</span>{/if}
      {#if msg.prompt}<span class="small muted" role="status">{msg.prompt}</span>{/if}
    </div>
  </section>

  <section class="card">
    <h3>Backup</h3>
    <p class="tip">Exporta este perfil inteiro (plano, aulas, questões e progresso) como JSON. Restaurar cria um perfil novo.</p>
    <div class="row"><button type="button" onclick={exportar}>Exportar e copiar</button></div>
    {#if backupOut}<textarea rows="4" readonly value={backupOut}></textarea>{/if}
    <textarea rows="4" bind:value={backupIn} placeholder="Cole aqui um backup para restaurar"></textarea>
    <div class="row">
      <button type="button" onclick={restaurar} disabled={!backupIn.trim()}>Restaurar backup</button>
      {#if msg.bk}<span class="small muted" role="status">{msg.bk}</span>{/if}
    </div>
  </section>

  <section class="card">
    <h3>Apagar progresso</h3>
    <p class="tip">Apaga sessões, conclusões, revisões e respostas deste perfil. Mantém o plano, as aulas e as questões.</p>
    <div class="row">
      <button type="button" class="danger" onclick={zerar}>{zerarArmado ? "Clique de novo para apagar" : "Apagar progresso"}</button>
      {#if msg.zerar}<span class="small muted" role="status">{msg.zerar}</span>{/if}
    </div>
  </section>
</div>

<style>
  .cores { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px; }
  .cores legend { padding: 0; margin-bottom: 6px; }
  .cor {
    display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 12px 6px 8px;
    border: 1px solid var(--line); border-radius: 99px; background: var(--bg);
  }
  .cor:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
  .cor:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  .cor input { position: absolute; opacity: 0; pointer-events: none; }
  .amostra { width: 18px; height: 18px; border-radius: 50%; flex: none; }
  .campo select { width: fit-content; }
  .campo { display: flex; flex-direction: column; gap: 5px; font-size: 14px; font-weight: 600; }
  input[type="date"] { font: 15px var(--mono); color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; width: fit-content; }
  .dia { display: grid; grid-template-columns: 90px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 0; border-top: 1px solid var(--line); }
  @media (max-width: 680px) { .dia { grid-template-columns: minmax(0, 1fr); } }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .pill { display: inline-flex; align-items: center; gap: 4px; background: var(--accent-soft); border-radius: 99px; padding: 2px 4px 2px 10px; font-size: 14px; }
  .pill button { border: 0; background: none; padding: 0 5px; font-size: 14px; color: var(--muted); }
  .pill button:hover { color: var(--fg); }
</style>
