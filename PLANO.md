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

## Servidor MCP
- Rust (`src-tauri/src/mcp.rs`): HTTP em `127.0.0.1:47321/mcp` com token (`~/.config/com.preparador.app/mcp.json`), rejeita `Origin` de navegador. Repassa `tools/*` e `prompts/*` ao webview (evento `mcp-chamada` → comando `mcp_responder`). O app precisa estar aberto.
- `preparador --mcp`: ponte stdio → HTTP para o Claude Desktop; abre o app se estiver fechado.
- Ferramentas e prompts em `src/lib/mcp.ts` (mesma lógica das telas). Os prompts da tela também são prompts MCP, com instrução para enviar o JSON pela ferramenta de importação.
- Ligar e copiar a configuração: Ajustes → Conectar com agentes de IA.
