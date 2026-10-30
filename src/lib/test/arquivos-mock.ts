// Substitui @tauri-apps/api/core nos testes: os comandos da biblioteca gravam num Map.
export const arquivos = new Map<string, string>();

export async function invoke<T>(cmd: string, args: { nome: string; conteudo?: string }): Promise<T> {
  if (cmd === "biblioteca_ler") return (arquivos.get(args.nome) ?? null) as T;
  if (cmd === "biblioteca_gravar") arquivos.set(args.nome, args.conteudo!);
  else if (cmd === "biblioteca_remover") arquivos.delete(args.nome);
  else throw new Error(`comando não simulado: ${cmd}`);
  return undefined as T;
}
