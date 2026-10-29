<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { app } from "$lib/app.svelte";
  import { marcarAssistida, removerAula, ytInfo, type Aula } from "$lib/aulas";
  import { hoje } from "$lib/datas";
  import { copiar, montarPrompt } from "$lib/prompts";

  let {
    a,
    meta = true,
    removivel = false,
    onmudou,
  }: { a: Aula; meta?: boolean; removivel?: boolean; onmudou?: () => void } = $props();

  let armado = $state(false);
  let aviso = $state("");
  const info = $derived(ytInfo(a.url));
  const materia = $derived(app.plano?.materia.get(a.materia_id));
  const assunto = $derived(a.assunto_id ? app.plano?.assunto.get(a.assunto_id) : null);

  const sub = $derived(
    [
      info?.tipo ?? "Link",
      a.canal,
      a.duracao_min ? `${a.duracao_min} min` : null,
      meta ? `${materia?.nome ?? ""} · ${assunto?.nome ?? "Matéria inteira"}` : a.assunto_id == null ? "Vale para toda a matéria" : null,
      a.assistida_em ? "assistida" : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  async function alternar(e: Event) {
    await marcarAssistida(a.id, (e.currentTarget as HTMLInputElement).checked ? hoje() : null);
    onmudou?.();
  }

  async function remover() {
    if (!armado) {
      armado = true;
      setTimeout(() => (armado = false), 4000);
      return;
    }
    await removerAula(a.id);
    onmudou?.();
  }

  async function pedirSubstituto() {
    const p = await montarPrompt("aulas.substituto", {
      idioma: app.perfil?.idioma,
      materiaId: materia?.slug,
      assuntoId: assunto?.slug ?? "null",
      assunto: assunto ? `${materia?.nome}: ${assunto.nome}` : materia?.nome,
      objetivo: app.plano?.objetivo.nome,
      urlQuebrada: a.url,
    });
    aviso = (await copiar(p)) ? "Prompt copiado. Cole a resposta em Importar da IA → Aulas." : "Não foi possível copiar.";
    setTimeout(() => (aviso = ""), 5000);
  }
</script>

<div class="aula" class:seen={a.assistida_em}>
  <span class="play" aria-hidden="true"></span>
  <div class="body">
    <button type="button" class="link" onclick={() => openUrl(a.url)} title={a.url}>{a.titulo}</button>
    <small>
      {sub}
      {#if a.status_link === "quebrado"}<span class="bad"> · link quebrado</span>{/if}
      {#if a.status_link === "ok"}<span class="okk"> · verificado</span>{/if}
    </small>
    {#if aviso}<small class="okk">{aviso}</small>{/if}
  </div>
  <div class="actions">
    {#if a.status_link === "quebrado"}
      <button type="button" class="small" onclick={pedirSubstituto}>Pedir substituto</button>
    {/if}
    <label><input type="checkbox" checked={!!a.assistida_em} onchange={alternar} /> Assisti</label>
    {#if removivel}
      <button type="button" class="small danger" onclick={remover}>{armado ? "Confirmar remoção" : "Remover"}</button>
    {/if}
  </div>
</div>

<style>
  .aula {
    display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; border: 1px solid var(--line);
    border-radius: 10px; padding: 10px 12px; background: var(--bg); min-width: 0;
  }
  .play { flex: none; width: 34px; height: 24px; border-radius: 6px; background: var(--play); display: grid; place-items: center; }
  .play::after {
    content: ""; border-left: 9px solid var(--play-fg); border-top: 6px solid transparent;
    border-bottom: 6px solid transparent; margin-left: 2px;
  }
  .body { flex: 1 1 200px; min-width: 0; display: flex; flex-direction: column; }
  .link {
    all: unset; cursor: pointer; color: var(--fg); font-weight: 600; overflow-wrap: anywhere;
  }
  .link:hover { text-decoration: underline; color: var(--accent); }
  .link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .seen .link { color: var(--muted); }
  small { color: var(--muted); font-size: 13px; }
  .bad { color: var(--bad); }
  .okk { color: var(--ok); }
  .actions { display: flex; align-items: center; gap: 10px; flex: none; }
  .actions label { display: flex; align-items: center; gap: 6px; font-size: 14px; cursor: pointer; }
  .actions input { width: 17px; height: 17px; accent-color: var(--accent); }
</style>
