// Parte do editor de anotações que mexe no DOM: converte o texto do bloco
// (formato inline de anotacoes.ts) em HTML do contenteditable e de volta, e
// lê/posiciona o cursor contando caracteres visíveis.
import { textoDeTrechos, trechos, type Mencao, type Trecho } from "./anotacoes";

/** Nome atual do alvo de uma menção; null = não existe mais. */
export type Resolver = (m: Mencao) => string | null;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function chipHtml(m: Mencao, nome: string | null) {
  const classe = `mencao mencao-${m.tipo}${nome == null ? " removida" : ""}`;
  return `<span class="${classe}" contenteditable="false" data-tipo="${m.tipo}" data-ref="${esc(m.ref)}" data-rotulo="${esc(nome ?? m.rotulo)}">${esc(nome ?? m.rotulo) || "?"}</span>`;
}

export function htmlDe(texto: string, resolver: Resolver): string {
  return trechos(texto)
    .map((x) => {
      if ("mencao" in x) return chipHtml(x.mencao, resolver(x.mencao));
      let h = esc(x.t);
      if (x.code) h = `<code>${h}</code>`;
      if (x.href) h = `<a href="${esc(x.href)}">${h}</a>`;
      if (x.i) h = `<em>${h}</em>`;
      if (x.b) h = `<strong>${h}</strong>`;
      return h;
    })
    .join("");
}

type Fmt = { b?: boolean; i?: boolean; code?: boolean; href?: string };

/** Lê o conteúdo editado (o próprio elemento ou um fragmento) de volta para o formato inline. */
export function textoDoDom(raiz: Node): string {
  const out: Trecho[] = [];
  const andar = (n: Node, f: Fmt) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = (n.textContent ?? "").replace(/ /g, " ").replace(/​/g, "");
      if (t) out.push({ t, ...f });
      return;
    }
    if (!(n instanceof HTMLElement)) {
      n.childNodes.forEach((c) => andar(c, f));
      return;
    }
    if (n.classList.contains("mencao") && n.dataset.tipo && n.dataset.ref) {
      out.push({ mencao: { tipo: n.dataset.tipo as Mencao["tipo"], ref: n.dataset.ref, rotulo: n.dataset.rotulo ?? n.textContent ?? "" } });
      return;
    }
    const tag = n.tagName;
    if (tag === "BR") {
      out.push({ t: "\n", ...f });
      return;
    }
    const g: Fmt = { ...f };
    const peso = n.style.fontWeight;
    if (tag === "B" || tag === "STRONG" || peso === "bold" || Number(peso) >= 600) g.b = true;
    if (tag === "I" || tag === "EM" || n.style.fontStyle === "italic") g.i = true;
    if (tag === "CODE") g.code = true;
    if (tag === "A" && n.getAttribute("href")) g.href = n.getAttribute("href")!;
    // blocos que o navegador às vezes cria dentro do contenteditable viram quebra de linha
    if ((tag === "DIV" || tag === "P") && out.length) out.push({ t: "\n", ...f });
    n.childNodes.forEach((c) => andar(c, g));
  };
  raiz.childNodes.forEach((c) => andar(c, {}));
  return textoDeTrechos(out);
}

// ---------- cursor ----------

/** Comprimento visível de um nó (o chip de menção conta pelo texto dele). */
const comprimento = (n: Node) => (n.textContent ?? "").length;

/** Posição do cursor em caracteres desde o começo do elemento; null se a seleção não está nele. */
export function posicaoCursor(el: HTMLElement): number | null {
  const sel = getSelection();
  if (!sel?.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer)) return null;
  const antes = document.createRange();
  antes.selectNodeContents(el);
  antes.setEnd(r.startContainer, r.startOffset);
  return antes.toString().length;
}

export function selecaoVazia() {
  const sel = getSelection();
  return !sel?.rangeCount || sel.getRangeAt(0).collapsed;
}

/** Põe o cursor na posição (Infinity = no fim). Dentro de um chip, vai para depois dele. */
export function colocarCursor(el: HTMLElement, pos: number) {
  el.focus();
  const sel = getSelection();
  if (!sel) return;
  const r = document.createRange();
  let resto = pos;
  const andar = (n: Node): boolean => {
    if (n instanceof HTMLElement && n.isContentEditable === false && n !== el) {
      const len = comprimento(n);
      if (resto <= len) {
        if (resto === 0) r.setStartBefore(n);
        else r.setStartAfter(n);
        return true;
      }
      resto -= len;
      return false;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      const len = comprimento(n);
      if (resto <= len) {
        r.setStart(n, resto);
        return true;
      }
      resto -= len;
      return false;
    }
    for (const c of Array.from(n.childNodes)) if (andar(c)) return true;
    return false;
  };
  if (!andar(el)) {
    r.selectNodeContents(el);
    r.collapse(false);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Separa o conteúdo no cursor: o que vem depois sai do elemento e volta como texto. */
export function cortarDepoisDoCursor(el: HTMLElement): string {
  const sel = getSelection();
  if (!sel?.rangeCount) return "";
  const r = sel.getRangeAt(0).cloneRange();
  r.deleteContents();
  r.setEnd(el, el.childNodes.length);
  return textoDoDom(r.extractContents());
}

/** O cursor está na primeira (ou última) linha visual do elemento? Serve para ↑/↓ passarem de bloco. */
export function naBorda(el: HTMLElement, lado: "cima" | "baixo"): boolean {
  const sel = getSelection();
  if (!sel?.rangeCount) return true;
  const r = sel.getRangeAt(0);
  const pos = posicaoCursor(el);
  if (lado === "cima" && pos === 0) return true;
  if (lado === "baixo" && pos === comprimento(el)) return true;
  const ret = r.getClientRects()[0] ?? r.getBoundingClientRect();
  if (!ret || (ret.top === 0 && ret.bottom === 0)) return true;
  const caixa = el.getBoundingClientRect();
  const linha = parseFloat(getComputedStyle(el).lineHeight) || 24;
  return lado === "cima" ? ret.top - caixa.top < linha * 0.8 : caixa.bottom - ret.bottom < linha * 0.8;
}

/** Envolve a seleção em <code>, ou tira o <code> se o cursor já está num. */
export function alternarCodigo(el: HTMLElement) {
  const sel = getSelection();
  if (!sel?.rangeCount) return;
  const r = sel.getRangeAt(0);
  const dentro = (r.startContainer instanceof Element ? r.startContainer : r.startContainer.parentElement)?.closest("code");
  if (dentro && el.contains(dentro)) {
    dentro.replaceWith(...Array.from(dentro.childNodes));
    return;
  }
  if (r.collapsed) return;
  const code = document.createElement("code");
  code.textContent = r.toString();
  r.deleteContents();
  r.insertNode(code);
  r.setStartAfter(code);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Insere um nó no cursor e põe o cursor depois dele. */
export function inserirNoCursor(no: Node) {
  const sel = getSelection();
  if (!sel?.rangeCount) return;
  const r = sel.getRangeAt(0);
  const ultimo = no instanceof DocumentFragment ? no.lastChild : no;
  r.deleteContents();
  r.insertNode(no);
  if (ultimo) r.setStartAfter(ultimo);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

export function htmlParaNo(html: string): Node {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content;
}
