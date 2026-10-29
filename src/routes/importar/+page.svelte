<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { app } from "$lib/app.svelte";
  import { importarAulas, previaAulas, type PreviaAulas } from "$lib/aulas";
  import ColarJson from "$lib/components/ColarJson.svelte";
  import CopiarPrompt from "$lib/components/CopiarPrompt.svelte";
  import { DIAS } from "$lib/datas";
  import { AulasSchema, PlanoSchema, QuestoesSchema, type PlanoJson } from "$lib/esquemas";
  import { IDIOMAS } from "$lib/perfis";
  import { importarPlano, listaAssuntosPrompt, planoAtualPrompt, previaPlano, type Previa } from "$lib/planos";
  import { leituraPdfsConstancia, listaProvasAlvo, montarPrompt, type ProvaAlvo } from "$lib/prompts";
  import { importarQuestoes, previaQuestoes, type PreviaQuestoes } from "$lib/questoes";
  import { select } from "$lib/db";

  type Aba = "plano" | "aulas" | "questoes";
  let aba = $state<Aba>((page.url.searchParams.get("aba") as Aba) ?? "plano");
  const plano = $derived(app.plano);
  const idiomaNome = $derived(IDIOMAS.find((i) => i.valor === app.perfil?.idioma)?.nome ?? app.perfil?.idioma);
  const provaPrincipal = $derived(plano?.provas[0]);

  // ---------- plano ----------
  type Modo = "edital" | "preedital" | "constancia";
  const MODOS: { valor: Modo; nome: string; desc: string }[] = [
    { valor: "edital", nome: "Edital publicado", desc: "A prova já tem edital" },
    { valor: "preedital", nome: "Edital previsto", desc: "Ainda sem edital; uso o anterior ou de cargo parecido" },
    { valor: "constancia", nome: "Constância", desc: "Várias provas ao mesmo tempo" },
  ];
  let modo = $state<Modo>(app.plano?.provas[0]?.situacao === "previsto" ? "preedital" : "edital");
  let cargo = $state("");
  let banca = $state("");
  let dataProva = $state("");
  let previsao = $state("");
  let tipoBase = $state<"anterior" | "parecido">("anterior");
  let editalBase = $state("");
  let notas = $state("");
  let provasAlvo = $state<ProvaAlvo[]>([{ nome: "", pdf: "" }, { nome: "", pdf: "" }]);
  let dias = $state([false, true, true, true, true, true, true]);
  let manterIds = $state(true);
  const nPdfs = $derived(provasAlvo.filter((p) => p.nome.trim() && p.pdf.trim()).length);
  let promptPlano = $state("");
  let previa = $state<{ dados: PlanoJson; bruto: string; resumo: Previa } | null>(null);
  let salvando = $state(false);

  $effect(() => {
    const vars = {
      tipo: modo === "constancia" ? "constancia" : "edital",
      situacao: modo === "edital" ? "publicado" : modo === "preedital" ? "previsto" : "publicado ou previsto",
      cargo,
      banca,
      dataProva,
      previsao,
      editalBase,
      tipoBase: tipoBase === "anterior" ? "edital anterior do mesmo cargo" : "edital de um cargo parecido",
      horas: app.perfil?.horas_dia,
      dias: DIAS.filter((_, i) => dias[i]).join(", "),
      idioma: idiomaNome,
      complemento: notas.trim() ? `\nObservações minhas (leve em conta):\n${notas.trim()}\n` : "",
      provas: listaProvasAlvo(provasAlvo),
      leituraPdfs: leituraPdfsConstancia(provasAlvo),
      planoAtual: manterIds ? planoAtualPrompt(plano) : "",
    };
    montarPrompt(`plano.${modo}`, vars).then((p) => (promptPlano = p));
  });

  async function validarPlano(dados: PlanoJson, bruto: string) {
    previa = { dados, bruto, resumo: await previaPlano(app.perfilId!, dados) };
  }

  async function salvarPlano() {
    if (!previa) return;
    salvando = true;
    await importarPlano(app.perfilId!, previa.dados, previa.bruto);
    await app.recarregarPlano();
    salvando = false;
    previa = null;
    goto("/hoje");
  }

  // ---------- aulas ----------
  let aulasMateria = $state<number>(Number(page.url.searchParams.get("materia")) || 0);
  let porAssunto = $state(2);
  let soSemAula = $state(true);
  let promptAulas = $state("");
  let previaA = $state<{ p: PreviaAulas; bruto: string } | null>(null);
  let okAulas = $state("");

  $effect(() => {
    if (!plano) return;
    const m = aulasMateria,
      apenas = soSemAula,
      n = porAssunto;
    (async () => {
      let ids: number[] | undefined;
      if (apenas) {
        const com = new Set(
          (await select<{ assunto_id: number }>("SELECT DISTINCT assunto_id FROM aulas WHERE perfil_id = $1 AND assunto_id IS NOT NULL", [
            app.perfilId,
          ])).map((r) => r.assunto_id),
        );
        ids = [...plano.assunto.keys()].filter((id) => !com.has(id));
      }
      const lista = listaAssuntosPrompt(plano, { materiaId: m || undefined, assuntoIds: ids });
      promptAulas = lista
        ? await montarPrompt("aulas.youtube", {
            idioma: idiomaNome,
            objetivo: plano.objetivo.nome,
            banca: provaPrincipal?.banca,
            porAssunto: n,
            assuntos: lista,
          })
        : "";
    })();
  });

  async function validarAulas(dados: import("$lib/esquemas").AulasJson, bruto: string) {
    okAulas = "";
    previaA = { p: await previaAulas(app.perfilId!, plano!, dados), bruto };
  }
  async function salvarAulas() {
    if (!previaA) return;
    await importarAulas(app.perfilId!, previaA.p, previaA.bruto);
    okAulas = `${previaA.p.validas.length} aula(s) adicionada(s). Verifique os links na tela Aulas.`;
    previaA = null;
  }

  // ---------- questões ----------
  let qMateria = $state<number>(Number(page.url.searchParams.get("materia")) || 0);
  let qAssunto = $state<number>(Number(page.url.searchParams.get("assunto")) || 0);
  let qModo = $state<"gerar" | "extrair">(page.url.searchParams.get("modo") === "extrair" ? "extrair" : "gerar");
  let qProva = $state("");
  let qComGabarito = $state(true);
  let qNotas = $state("");
  let qTipo = $state("CE");
  let qQtd = $state(10);
  let promptQ = $state("");
  let previaQ = $state<{ p: PreviaQuestoes; bruto: string } | null>(null);
  let okQ = $state("");

  $effect(() => {
    if (!plano) return;
    const filtro = qAssunto ? { assuntoIds: [qAssunto] } : qMateria ? { materiaId: qMateria } : undefined;
    const lista = listaAssuntosPrompt(plano, filtro);
    if (qModo === "extrair") {
      const m = plano.materia.get(qMateria);
      montarPrompt("questoes.extrair", {
        prova: qProva.trim() || "(prova anterior; identifique banca, ano e cargo pelo PDF)",
        gabarito: qComGabarito
          ? "Anexei também o GABARITO OFICIAL (se houver preliminar e definitivo, use o definitivo)."
          : 'NÃO tenho o gabarito oficial: resolva cada questão você mesmo, com cuidado, e marque "gabaritoOficial": false.',
        materias: m ? `de ${m.nome} (ignore as outras matérias)` : "de todas as matérias",
        assuntos: listaAssuntosPrompt(plano, m ? { materiaId: m.id } : undefined),
        complemento: qNotas.trim() ? `\nObservações minhas (leve em conta):\n${qNotas.trim()}\n` : "",
      }).then((p) => (promptQ = p));
      return;
    }
    const vars = {
      quantidade: qQtd,
      tipo: qTipo === "misto" ? '"CE" e "ME" misturadas' : `"${qTipo}"`,
      banca: provaPrincipal?.banca || "da prova",
      objetivo: plano.objetivo.nome,
      assuntos: lista,
      idioma: idiomaNome,
    };
    montarPrompt("questoes.gerar", vars).then((p) => (promptQ = p));
  });

  async function validarQuestoes(dados: import("$lib/esquemas").QuestoesJson, bruto: string) {
    okQ = "";
    previaQ = { p: await previaQuestoes(app.perfilId!, plano!, dados), bruto };
  }
  async function salvarQuestoes() {
    if (!previaQ) return;
    await importarQuestoes(app.perfilId!, previaQ.p, previaQ.bruto);
    okQ = `${previaQ.p.validas.length} questão(ões) adicionada(s).${qModo === "extrair" ? ' Se a IA respondeu em partes, peça "continue" e cole a próxima parte aqui.' : ""}`;
    previaQ = null;
  }
</script>

<div class="stack">
  <header>
    <div class="eyebrow">Importar da IA</div>
    <h1>Copie o prompt, cole a resposta</h1>
  </header>

  <div class="tabs" role="tablist">
    {#each [["plano", "Plano de estudos"], ["aulas", "Aulas do YouTube"], ["questoes", "Questões"]] as [k, nome] (k)}
      <button class="tab" role="tab" aria-selected={aba === k} onclick={() => (aba = k as Aba)} disabled={k !== "plano" && !plano}>{nome}</button>
    {/each}
  </div>

  {#if aba === "plano"}
    <section class="card">
      <h3>1. Monte o prompt</h3>
      <fieldset class="tipo">
        {#each MODOS as m (m.valor)}
          <label><input type="radio" bind:group={modo} value={m.valor} /> <span><b>{m.nome}</b><small>{m.desc}</small></span></label>
        {/each}
      </fieldset>
      <div class="grid">
        {#if modo === "edital"}
          <label class="full">Prova e cargo <input type="text" bind:value={cargo} placeholder="Ex.: Polícia Civil de Sergipe – Oficial Investigador" /></label>
          <label>Banca <input type="text" bind:value={banca} placeholder="Ex.: Cebraspe" /></label>
          <label>Data da prova <input type="text" bind:value={dataProva} placeholder="AAAA-MM-DD (opcional)" /></label>
        {:else if modo === "preedital"}
          <label class="full">Prova e cargo pretendidos <input type="text" bind:value={cargo} placeholder="Ex.: Polícia Civil de Sergipe – Oficial Investigador" /></label>
          <label>Banca provável <input type="text" bind:value={banca} placeholder="Ex.: Cebraspe (ou deixe vazio)" /></label>
          <label>Previsão <input type="text" bind:value={previsao} placeholder="Ex.: edital no 1º semestre de 2027" /></label>
          <fieldset class="full base">
            <legend>O edital-base é</legend>
            <label><input type="radio" bind:group={tipoBase} value="anterior" /> o edital anterior deste cargo</label>
            <label><input type="radio" bind:group={tipoBase} value="parecido" /> o edital de um cargo parecido</label>
          </fieldset>
          <label class="full">Qual edital-base <input type="text" bind:value={editalBase} placeholder={tipoBase === "anterior" ? "Ex.: PC/SE 2021 – Agente e Escrivão (Cebraspe)" : "Ex.: PC/AL 2023 – Agente de Polícia (Cebraspe)"} /></label>
        {:else}
          <div class="full alvos">
            <span class="rot">Provas-alvo</span>
            <span class="tip">Para cada prova, diga qual PDF de edital você vai anexar como exemplo (o anterior da mesma prova ou de um cargo parecido). Deixe vazio se não tiver PDF.</span>
            {#each provasAlvo as p, i (i)}
              <div class="alvo">
                <input type="text" bind:value={p.nome} placeholder={["Ex.: Polícia Civil de Sergipe – Investigador", "Ex.: Polícia Militar de Sergipe – Soldado", "Ex.: ENEM"][i] ?? "Prova ou cargo"} aria-label={`Prova ${i + 1}`} />
                <input type="text" bind:value={p.pdf} placeholder={["Ex.: PC/SE 2021 – Agente (Cebraspe)", "Ex.: PM/SE 2018 – Soldado", "Ex.: matriz de referência do ENEM"][i] ?? "Edital do PDF anexado (opcional)"} aria-label={`PDF da prova ${i + 1}`} />
                <button type="button" class="small" aria-label="Remover prova" disabled={provasAlvo.length === 1} onclick={() => provasAlvo.splice(i, 1)}>×</button>
              </div>
            {/each}
            <div><button type="button" class="small" onclick={() => provasAlvo.push({ nome: "", pdf: "" })}>+ Adicionar prova</button></div>
          </div>
        {/if}
        {#if plano}
          <label class="full chk">
            <input type="checkbox" bind:checked={manterIds} />
            Enviar os ids do plano atual para a IA reaproveitar (mantém o progresso ao trocar de edital)
          </label>
        {/if}
      </div>
      {#if modo !== "constancia"}
        <div class="anexo">
          <b>Anexe o PDF {modo === "edital" ? "do edital" : "do edital-base"} na conversa com a IA, junto com o prompt.</b>
          <span>O prompt manda a IA ler o PDF inteiro, achar o conteúdo programático do cargo e usar o quadro de provas para definir o peso das matérias. Use uma IA que aceite PDF (ChatGPT, Claude, Gemini).</span>
        </div>
      {:else if nPdfs}
        <div class="anexo">
          <b>Anexe {nPdfs === 1 ? "o PDF" : `os ${nPdfs} PDFs`} na conversa com a IA, junto com o prompt, na ordem da lista.</b>
          <span>O prompt diz qual PDF é de cada prova e manda a IA ler cada um por inteiro e juntar as matérias em comum.</span>
        </div>
      {/if}
      <label class="obs">
        Observações para a IA (opcional)
        <textarea rows="3" bind:value={notas} placeholder="Ex.: já domino Informática; quero mais peso em Direito Penal; o PDF tem dois anexos, use o II"></textarea>
      </label>
      <div class="dias">
        <span class="small muted">Dias de estudo ({app.perfil?.horas_dia} h/dia, ajuste no perfil):</span>
        {#each DIAS as d, i (i)}
          <label><input type="checkbox" bind:checked={dias[i]} /> {d.slice(0, 3)}</label>
        {/each}
      </div>
      <CopiarPrompt texto={promptPlano} />
    </section>

    <section class="card">
      <h3>2. Cole a resposta da IA</h3>
      <ColarJson schema={PlanoSchema} onvalido={validarPlano} />
    </section>

    {#if previa}
      {@const r = previa.resumo}
      <section class="card previa">
        <div class="card-head">
          <h3>3. Confira antes de salvar</h3>
          <span class="chip">{r.versaoNova ? "atualiza o plano atual" : "plano novo"}</span>
        </div>
        <p><b>{previa.dados.objetivo.nome}</b> · {previa.dados.objetivo.tipo === "constancia" ? "constância" : previa.dados.objetivo.provas[0].situacao === "previsto" ? "edital previsto" : "edital publicado"} · {r.totalMaterias} matérias · {r.totalAssuntos} assuntos</p>
        <ul class="resumo">
          {#if r.materiasNovas.length}<li>Matérias novas: {r.materiasNovas.join(", ")}</li>{/if}
          {#if r.versaoNova}<li>{r.assuntosMantidos} assunto(s) reaproveitados, com o progresso mantido</li>{/if}
          {#if r.versaoNova && r.assuntosNovos}<li>{r.assuntosNovos} assunto(s) novo(s)</li>{/if}
          {#if r.versaoNova && r.assuntosMantidos === 0}<li class="bad">A IA não reaproveitou nenhum id do plano atual. Todo o progresso seria perdido: gere de novo com a opção "Enviar os ids do plano atual" marcada.</li>{/if}
          {#if r.assuntosRenomeados.length}<li>{r.assuntosRenomeados.length} assunto(s) renomeado(s), progresso mantido</li>{/if}
          {#if r.materiasRemovidas.length}<li class="bad">Matérias removidas: {r.materiasRemovidas.join(", ")}</li>{/if}
          {#if r.assuntosRemovidos.length}<li class="bad">{r.assuntosRemovidos.length} assunto(s) removido(s): {r.assuntosRemovidos.slice(0, 6).join("; ")}{r.assuntosRemovidos.length > 6 ? "…" : ""}</li>{/if}
          {#if r.progressoPerdido.conclusoes + r.progressoPerdido.aulas + r.progressoPerdido.questoes > 0}
            <li class="bad">Será apagado: {r.progressoPerdido.conclusoes} conclusão(ões), {r.progressoPerdido.aulas} aula(s) e {r.progressoPerdido.questoes} questão(ões) ligadas ao que foi removido.</li>
          {/if}
          {#if r.semanaGerada}<li>A IA não enviou a semana; ela será montada automaticamente pelo peso das matérias.</li>{/if}
        </ul>
        {#if previa.dados.observacoes}<p class="tip">Observações da IA: {previa.dados.observacoes}</p>{/if}
        <details>
          <summary class="small">Ver matérias e assuntos</summary>
          <ul class="arvore">
            {#each previa.dados.materias as m (m.id)}
              <li><b>{m.nome}</b> <span class="muted small">peso {m.peso}</span>
                <ol>{#each m.assuntos as a (a.id)}<li>{a.nome}</li>{/each}</ol>
              </li>
            {/each}
          </ul>
        </details>
        <div class="row">
          <button type="button" class="primary" disabled={salvando} onclick={salvarPlano}>{salvando ? "Salvando…" : "Salvar plano"}</button>
          <button type="button" onclick={() => (previa = null)}>Descartar</button>
        </div>
      </section>
    {/if}
  {:else if aba === "aulas" && plano}
    <section class="card">
      <h3>1. Monte o prompt</h3>
      <div class="grid">
        <label>Matéria
          <select bind:value={aulasMateria}>
            <option value={0}>Todas</option>
            {#each plano.materias as m (m.id)}<option value={m.id}>{m.nome}</option>{/each}
          </select>
        </label>
        <label>Aulas por assunto
          <select bind:value={porAssunto}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select>
        </label>
        <label class="full chk"><input type="checkbox" bind:checked={soSemAula} /> Só assuntos que ainda não têm aula</label>
      </div>
      <p class="tip">Idioma do perfil: {idiomaNome}. Use uma IA com busca na web (ex.: ChatGPT com busca, Claude com pesquisa, Gemini) para evitar links inventados.</p>
      {#if promptAulas}
        <CopiarPrompt texto={promptAulas} />
      {:else}
        <p class="empty">Todos os assuntos dessa seleção já têm aula.</p>
      {/if}
    </section>
    <section class="card">
      <h3>2. Cole a resposta da IA</h3>
      <ColarJson schema={AulasSchema} onvalido={validarAulas} />
      {#if okAulas}<p class="ok" role="status">{okAulas}</p>{/if}
    </section>
    {#if previaA}
      {@const p = previaA.p}
      <section class="card">
        <h3>3. Confira</h3>
        <ul class="resumo">
          <li>{p.validas.length} aula(s) prontas para adicionar</li>
          {#if p.duplicadas}<li>{p.duplicadas} já estavam cadastradas (ignoradas)</li>{/if}
          {#if p.semAssunto.length}<li class="bad">{p.semAssunto.length} com id de assunto desconhecido (ignoradas): {p.semAssunto.slice(0, 4).join("; ")}</li>{/if}
          {#if p.naoYoutube.length}<li class="bad">{p.naoYoutube.length} com link que não é do YouTube (ignoradas)</li>{/if}
        </ul>
        <div class="row">
          <button type="button" class="primary" disabled={!p.validas.length} onclick={salvarAulas}>Adicionar aulas</button>
          <button type="button" onclick={() => (previaA = null)}>Descartar</button>
        </div>
      </section>
    {/if}
  {:else if aba === "questoes" && plano}
    <section class="card">
      <h3>1. Monte o prompt</h3>
      <fieldset class="tipo dois">
        <label><input type="radio" bind:group={qModo} value="gerar" /> <span><b>Gerar questões inéditas</b><small>A IA cria questões no estilo da banca</small></span></label>
        <label><input type="radio" bind:group={qModo} value="extrair" /> <span><b>Extrair de prova anterior</b><small>Você anexa o PDF da prova; a IA transcreve e classifica</small></span></label>
      </fieldset>
      {#if qModo === "extrair"}
        <div class="grid">
          <label class="full">Prova <input type="text" bind:value={qProva} placeholder="Ex.: Cebraspe 2021 – PC/SE Agente de Polícia" /></label>
          <label>Só questões de
            <select bind:value={qMateria}>
              <option value={0}>Todas as matérias</option>
              {#each plano.materias as m (m.id)}<option value={m.id}>{m.nome}</option>{/each}
            </select>
          </label>
          <label class="full chk"><input type="checkbox" bind:checked={qComGabarito} /> Vou anexar também o gabarito oficial</label>
        </div>
        <div class="anexo">
          <b>Anexe o PDF da prova{qComGabarito ? " e o do gabarito" : ""} na conversa com a IA, junto com o prompt.</b>
          <span>A IA transcreve cada questão sem reescrever, separa os itens certo/errado, pula as anuladas e as que dependem de imagem, e classifica cada uma num assunto do seu plano. Provas grandes vêm em partes de até 40 questões: peça "continue" e cole cada parte.</span>
        </div>
        <label class="obs">
          Observações para a IA (opcional)
          <textarea rows="2" bind:value={qNotas} placeholder="Ex.: é o caderno tipo A; ignore a prova discursiva"></textarea>
        </label>
      {:else}
      <div class="grid">
        <label>Matéria
          <select bind:value={qMateria} onchange={() => (qAssunto = 0)}>
            <option value={0}>Todas</option>
            {#each plano.materias as m (m.id)}<option value={m.id}>{m.nome}</option>{/each}
          </select>
        </label>
        <label>Assunto
          <select bind:value={qAssunto} disabled={!qMateria}>
            <option value={0}>Todos da matéria</option>
            {#each plano.materia.get(qMateria)?.assuntos ?? [] as a (a.id)}<option value={a.id}>{a.nome}</option>{/each}
          </select>
        </label>
        <label>Tipo
          <select bind:value={qTipo}>
            <option value="CE">Certo ou errado</option>
            <option value="ME">Múltipla escolha</option>
            <option value="misto">Misturado</option>
          </select>
        </label>
        <label>Quantidade <input type="number" min="1" max="50" bind:value={qQtd} /></label>
      </div>
      {/if}
      <CopiarPrompt texto={promptQ} />
    </section>
    <section class="card">
      <h3>2. Cole a resposta da IA</h3>
      <ColarJson schema={QuestoesSchema} onvalido={validarQuestoes} />
      {#if okQ}<p class="ok" role="status">{okQ}</p>{/if}
    </section>
    {#if previaQ}
      {@const p = previaQ.p}
      <section class="card">
        <h3>3. Confira</h3>
        <ul class="resumo">
          <li>{p.validas.length} questão(ões) prontas para adicionar</li>
          {#if p.duplicadas}<li>{p.duplicadas} repetidas (ignoradas)</li>{/if}
          {#if p.validas.some((q) => q.fonte)}<li>Fonte: {[...new Set(p.validas.map((q) => q.fonte?.replace(/,?\s*q\.?\s*\d+.*$/i, "")).filter(Boolean))].slice(0, 3).join("; ")}</li>{/if}
          {#if p.validas.some((q) => !q.gabaritoOficial)}<li class="bad">{p.validas.filter((q) => !q.gabaritoOficial).length} com gabarito resolvido pela IA, não oficial</li>{/if}
          {#if p.semAssunto.length}<li class="bad">{p.semAssunto.length} com assunto desconhecido (ignoradas)</li>{/if}
        </ul>
        <p class="tip">Questões geradas por IA podem conter erros. A explicação ajuda a conferir na lei ou no material.</p>
        <div class="row">
          <button type="button" class="primary" disabled={!p.validas.length} onclick={salvarQuestoes}>Adicionar questões</button>
          <button type="button" onclick={() => (previaQ = null)}>Descartar</button>
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); }
  .tab { font: 600 15px var(--body); background: none; border: 0; border-bottom: 3px solid transparent; color: var(--muted); padding: 8px 12px; border-radius: 0; }
  .tab[aria-selected="true"] { color: var(--fg); border-bottom-color: var(--accent); }
  .tipo { border: 0; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .tipo.dois { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .base { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 14px; }
  .base legend { font-weight: 600; padding: 0; margin-bottom: 4px; }
  .base label { display: flex; gap: 6px; align-items: center; cursor: pointer; }
  .base input { accent-color: var(--accent); }
  .tipo label { display: flex; gap: 10px; align-items: flex-start; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; cursor: pointer; }
  .tipo label:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
  .tipo span { display: flex; flex-direction: column; }
  .tipo small { color: var(--muted); font-size: 13px; }
  .tipo input { margin-top: 4px; accent-color: var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .grid label { display: flex; flex-direction: column; gap: 5px; font-size: 14px; font-weight: 600; min-width: 0; }
  .grid .full { grid-column: 1 / -1; }
  .grid label.chk { flex-direction: row; align-items: center; font-weight: 400; }
  .grid input[type="text"], .grid select { width: 100%; }
  @media (max-width: 620px) { .grid, .tipo { grid-template-columns: minmax(0, 1fr); } }
  .alvos { display: flex; flex-direction: column; gap: 6px; }
  .alvos .rot { font-size: 14px; font-weight: 600; }
  .alvo { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 6px; }
  .alvo input { width: 100%; }
  @media (max-width: 620px) { .alvo { grid-template-columns: minmax(0, 1fr) auto; } .alvo input:nth-child(2) { grid-column: 1; } }
  .anexo { display: flex; flex-direction: column; gap: 2px; background: var(--gold-soft); border: 1px solid var(--gold); border-radius: 10px; padding: 10px 12px; font-size: 14px; }
  .obs { display: flex; flex-direction: column; gap: 5px; font-size: 14px; font-weight: 600; }
  .obs textarea { font: 14px/1.45 var(--body); }
  .dias { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
  .dias label { display: flex; gap: 5px; align-items: center; font-size: 14px; cursor: pointer; }
  .dias input { accent-color: var(--accent); }
  .resumo { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; }
  .resumo .bad { color: var(--bad); }
  .ok { color: var(--ok); margin: 0; font-size: 14px; }
  .arvore { font-size: 14px; padding-left: 18px; }
  .arvore ol { margin: 2px 0 8px; color: var(--muted); }
  p { margin: 0; }
</style>
