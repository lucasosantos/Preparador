import { execute, select } from "./db";

export type Perfil = {
  id: number;
  nome: string;
  idioma: string;
  horas_dia: number;
  criado_em: string;
};

export const IDIOMAS = [
  { valor: "pt-BR", nome: "Português (Brasil)" },
  { valor: "pt-PT", nome: "Português (Portugal)" },
  { valor: "es", nome: "Español" },
  { valor: "en", nome: "English" },
];

export function listarPerfis() {
  return select<Perfil>("SELECT * FROM perfis ORDER BY nome COLLATE NOCASE");
}

export async function criarPerfil(nome: string, idioma: string, horasDia: number): Promise<number> {
  const r = await execute("INSERT INTO perfis (nome, idioma, horas_dia) VALUES ($1, $2, $3)", [
    nome,
    idioma,
    horasDia,
  ]);
  return r.lastInsertId as number;
}

export async function atualizarPerfil(id: number, nome: string, idioma: string, horasDia: number) {
  await execute("UPDATE perfis SET nome = $1, idioma = $2, horas_dia = $3 WHERE id = $4", [
    nome,
    idioma,
    horasDia,
    id,
  ]);
}

export async function excluirPerfil(id: number) {
  await execute("DELETE FROM perfis WHERE id = $1", [id]);
}
