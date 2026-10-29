import { criarPerfilDemo } from "./backup";
import { getConfig, setConfig } from "./db";
import { listarPerfis, type Perfil } from "./perfis";
import { carregarPlano, type Plano } from "./planos";
import { metricas, type Metricas } from "./rotina";

export type Tema = "sistema" | "claro" | "escuro";
export const CORES = [
  { valor: "verde", nome: "Verde", amostra: "#1f7a4d" },
  { valor: "azul", nome: "Azul", amostra: "#1d5fa8" },
  { valor: "roxo", nome: "Roxo", amostra: "#6b3fa0" },
  { valor: "laranja", nome: "Laranja", amostra: "#b4501a" },
  { valor: "rosa", nome: "Rosa", amostra: "#b0306a" },
  { valor: "grafite", nome: "Grafite", amostra: "#3d4a55" },
] as const;
export type Cor = (typeof CORES)[number]["valor"];

class AppState {
  pronto = $state(false);
  erro = $state<string | null>(null);
  perfis = $state<Perfil[]>([]);
  perfilId = $state<number | null>(null);
  tema = $state<Tema>("sistema");
  cor = $state<Cor>("verde");
  // raw: o plano tem Maps e é sempre trocado inteiro
  plano = $state.raw<Plano | null>(null);
  metricas = $state.raw<Metricas | null>(null);

  perfil = $derived(this.perfis.find((p) => p.id === this.perfilId) ?? null);

  async iniciar() {
    try {
      this.tema = ((await getConfig("tema")) as Tema) ?? "sistema";
      aplicarTema(this.tema);
      this.cor = ((await getConfig("cor")) as Cor) ?? "verde";
      aplicarCor(this.cor);
      await this.recarregarPerfis();
      if (!this.perfis.length && !(await getConfig("demo_criado"))) {
        await setConfig("demo_criado", "1");
        await criarPerfilDemo();
        await this.recarregarPerfis();
      }
      const salvo = Number(await getConfig("perfil_ativo"));
      this.perfilId = this.perfis.some((p) => p.id === salvo) ? salvo : (this.perfis[0]?.id ?? null);
      await this.recarregarPlano();
      this.pronto = true;
    } catch (e) {
      this.erro = String(e);
    }
  }

  async recarregarPerfis() {
    this.perfis = await listarPerfis();
    if (this.perfilId != null && !this.perfis.some((p) => p.id === this.perfilId)) {
      await this.escolherPerfil(this.perfis[0]?.id ?? null);
    }
  }

  async escolherPerfil(id: number | null) {
    this.perfilId = id;
    await setConfig("perfil_ativo", id == null ? null : String(id));
    await this.recarregarPlano();
  }

  async recarregarPlano() {
    this.plano = this.perfilId == null ? null : await carregarPlano(this.perfilId);
    await this.recarregarMetricas();
  }

  async recarregarMetricas() {
    this.metricas = this.perfilId == null ? null : await metricas(this.perfilId, this.plano);
  }

  async mudarCor(c: Cor) {
    this.cor = c;
    aplicarCor(c);
    await setConfig("cor", c);
  }

  async mudarTema(t: Tema) {
    this.tema = t;
    aplicarTema(t);
    await setConfig("tema", t);
  }
}

function aplicarTema(t: Tema) {
  const el = document.documentElement;
  if (t === "sistema") el.removeAttribute("data-theme");
  else el.dataset.theme = t === "claro" ? "light" : "dark";
}

function aplicarCor(c: Cor) {
  const el = document.documentElement;
  if (c === "verde") el.removeAttribute("data-cor");
  else el.dataset.cor = c;
}

export const app = new AppState();
