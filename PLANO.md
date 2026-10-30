# Preparador — plano

App desktop (Tauri 2 + Svelte + TypeScript + SQLite) que organiza estudos para concursos, ENEM,
vestibulares e processos seletivos. Origem: protótipo em artifact "Plano PC/SE Investigador".

## Decisões
- Frontend: **Svelte + TypeScript** (Vite). Sem sidecar Node; lógica em TS, persistência via `tauri-plugin-sql`.
- **Questões entram no MVP.**
- Primeira execução cria o **perfil-demo PC/SE Investigador** com os dados do protótipo.

## Domínio
```
Perfil
 └─ Objetivo: "edital" (1 prova) | "constancia" (várias provas, matérias mescladas)
 └─ Plano (versionado a cada importação)
     ├─ Matérias (peso) └─ Assuntos (id estável, prioridade)
     ├─ Semana-modelo (dia → matérias)
     └─ Regras (horas/dia, revisões 1/7/30)
 └─ Aulas (assunto ou matéria inteira, assistida em, status do link)
 └─ Questões (C/E ou múltipla escolha) e respostas
 └─ Registros (sessões, conclusões, revisões)
```

## Fluxo de prompts
Sistema gera prompt preenchido → usuário cola na IA → cola o JSON de volta → Zod valida → prévia/diff → salva.

Prompts: `plano.edital`, `plano.constancia`, `aulas.youtube` (recebe os IDs dos assuntos), `questoes.gerar`.
Templates editáveis em Ajustes, com placeholders `{{...}}`.

Importação robusta: remove cercas ```json e texto extra; erros com caminho exato + "prompt de correção";
reimportar preserva progresso de assuntos com mesmo id; JSON bruto guardado em `importacoes`.

Links do YouTube são verificados via oEmbed (`https://www.youtube.com/oembed?url=...`): 404 → link quebrado.

## Contratos JSON
- `preparador.plano/1`: `{ schema, objetivo{tipo,nome,provas[{id,nome,banca,dataProva}]}, materias[{id,nome,peso,assuntos[{id,nome,detalhe,prioridade,provas?}]}], semana{seg..dom}?, observacoes }` (semana ausente → gerada pelo peso)
- `preparador.aulas/1`: `{ schema, idioma, aulas[{materiaId?, assuntoId?|null, titulo, url, canal, duracaoMin}] }` (assuntoId é único no plano; materiaId sozinho = matéria inteira)
- `preparador.aulaTexto/1`: `{ schema, materiaId?, assuntoId, titulo, idioma?, resumo, secoes[{titulo, texto}], pontosDeProva[], fontes[{titulo, url?}] (mín. 1) }`
- `preparador.apostila/1`: `{ schema, apostila, aulas[campos da aulaTexto sem "schema"], foraDoPlano[] }` (cada aula vira um arquivo da biblioteca)
- `preparador.questoes/1`: `{ schema, questoes[{assuntoId, tipo:"CE"|"ME", enunciado, alternativas?, gabarito, explicacao}] }`

## Fases
0. Base: Tauri 2 + Svelte/TS, SQLite com migrações, roteamento, tema claro/escuro.
1. Perfis e plano: CRUD de perfil, prompt de edital, importação Zod, prévia, versionamento, perfil-demo.
2. Rotina: plano do dia, sessões, conclusão, revisões, métricas, questões por sessão, simulado.
3. Aulas: prompt de busca, importação, verificação oEmbed, cadastro manual.
4. Constância: múltiplas provas, mescla de matérias, priorização.
5. Extras: backup JSON, edição de prompts, instaladores.

## Estado (2026-10-29)
Fases 0–5 implementadas. Pendentes: instaladores (`npm run tauri build`) e ícone próprio.

- Lógica em `src/lib/` (planos, rotina, aulas, questoes, prompts, esquemas, backup); telas em `src/routes/`.
- `npm test` roda a lógica contra `node:sqlite` com a mesma migração (`src/lib/logica.test.ts`).
- Perfil-demo: `src/lib/demo/pcse.json`, gerado a partir do artifact; criado na 1ª execução ou pelo botão em Perfis.

## Aulas em texto
Para assuntos sem vídeo bom, o prompt `aulas.texto` pede à IA uma aula escrita para o perfil (nome, horas/dia, idioma)
e o plano (provas, banca, prioridade e posição do assunto), sempre com fontes no fim.
Ficam fora do SQLite, na pasta `biblioteca/` dos dados do app: `biblioteca.json` (índice: perfil, matéria, assunto,
título, criada/lida em) e um `aula-<id>.json` por aula. Lidos e gravados por comandos Rust (`src-tauri/src/biblioteca.rs`),
que só aceitam nomes simples dentro dessa pasta. Lógica em `src/lib/textos.ts`; leitura em `/aulas/texto?id=`.
Apostilas: o prompt `aulas.apostila` vai com o PDF anexado; a IA encaixa cada trecho num assunto do plano e escreve
uma aula por assunto com base na apostila (ela é sempre a 1ª fonte, com páginas), em partes de até 8 aulas.
Reimportar a mesma apostila ignora aulas com mesmo assunto e título.
Entram no backup do perfil; ao excluir o perfil, ficam no acervo. MCP: `salvar_aula_texto`, `importar_apostila`, `listar_aulas_texto`, `ler_aula_texto` e `marcar_aula_texto_lida`;
`plano_do_dia` traz as aulas em texto de cada sessão e `assuntos_sem_aula` indica `temAulaTexto`.

## Acervo
Tudo o que passa pelo app fica guardado para concursos futuros, mesmo após trocar de plano ou excluir o perfil.
- Migração `0004_acervo.sql`: `acervo_temas` (matéria + assunto por nome, com objetivo e banca de origem; assunto '' = matéria
  inteira), `acervo_aulas` e `acervo_questoes`. Gatilhos copiam cada matéria, assunto, aula e questão inseridos (qualquer
  caminho: tela, MCP, backup, demo) e propagam a verificação de links; a migração copia o que já existia.
- Aulas em texto: o índice guarda o tema pelo nome; excluir o perfil só desvincula (`perfilId: null`).
- `src/lib/acervo.ts`: compara cada tema do acervo com os assuntos do plano (nomes sem acento e palavras vazias, radical simples,
  peso pela raridade da palavra, nome contido no outro) e sugere o conteúdo que ainda não está no perfil. ≥ 0,8 = forte
  (vem marcado), 0,55–0,8 = fraco (o usuário confere). Cada tema vai só para o assunto mais parecido.
- Tela `/acervo`; ao salvar um plano com sugestões, o app abre essa tela. MCP: `buscar_no_acervo` e `reaproveitar_do_acervo`;
  `importar_plano` avisa quando há sugestões.

## Servidor MCP
- Rust (`src-tauri/src/mcp.rs`): HTTP em `127.0.0.1:47321/mcp` com token (`~/.config/com.preparador.app/mcp.json`), rejeita `Origin` de navegador. Repassa `tools/*` e `prompts/*` ao webview (evento `mcp-chamada` → comando `mcp_responder`). O app precisa estar aberto.
- `preparador --mcp`: ponte stdio → HTTP para o Claude Desktop; abre o app se estiver fechado.
- Ferramentas e prompts em `src/lib/mcp.ts` (mesma lógica das telas). Os prompts da tela também são prompts MCP, com instrução para enviar o JSON pela ferramenta de importação.
- Ligar e copiar a configuração: Ajustes → Conectar com agentes de IA.

## Versões e instaladores
- Gerados localmente com `scripts/release.sh` (AppImage + Windows NSIS por compilação cruzada com cargo-xwin; sem .msi).
- `scripts/release.sh --versao X.Y.Z` troca a versão; depois do commit, `scripts/release.sh --publicar` cria a tag, faz push e sobe os instaladores numa release em rascunho via `gh`.
- Instaladores não vão para o git (`release/` no .gitignore); ficam anexados às Releases.
- GitHub Actions: só `testes.yml`. Página: GitHub Pages servindo `docs/` direto da branch (Settings → Pages → Deploy from a branch → main /docs).
