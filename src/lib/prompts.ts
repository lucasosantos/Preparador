import { execute, select } from "./db";

export type ChavePrompt =
  | "plano.edital"
  | "plano.preedital"
  | "plano.constancia"
  | "perfis.unir"
  | "questoes.extrair"
  | "aulas.youtube"
  | "aulas.substituto"
  | "aulas.texto"
  | "aulas.apostila"
  | "questoes.gerar";

type Definicao = { nome: string; descricao: string; variaveis: string[]; padrao: string };

const FORMATO_PLANO = `{
  "schema": "preparador.plano/1",
  "objetivo": {
    "tipo": "{{tipo}}",
    "nome": "nome curto do objetivo",
    "provas": [
      {
        "id": "slug-da-prova", "nome": "nome completo da prova/cargo", "banca": "banca ou null",
        "dataProva": "AAAA-MM-DD ou null", "situacao": "{{situacao}}",
        "previsao": "previsão em texto, ex.: 1º semestre de 2027, ou null",
        "editalBase": "edital usado como base, ex.: PC/SE 2021 – Agente, ou null"
      }
    ]
  },
  "materias": [
    {
      "id": "slug-curto",
      "nome": "Nome da matéria",
      "peso": 1,
      "assuntos": [
        { "id": "slug-curto-01", "nome": "Assunto", "detalhe": "subtópicos ou null", "prioridade": 2, "provas": ["slug-da-prova"] }
      ]
    }
  ],
  "semana": { "seg": ["slug-curto"], "ter": [], "qua": [], "qui": [], "sex": [], "sab": [], "dom": [] },
  "observacoes": "avisos importantes ou null"
}`;

const REGRAS_PLANO = `Regras do JSON:
- Responda APENAS com o JSON, sem texto antes ou depois e sem cercas de código.
- "id" de matéria: slug curto, minúsculo, sem acentos (ex.: "port", "const", "rl").
- "id" de assunto: único no plano inteiro, no formato "<id-da-matéria>-NN" (ex.: "port-01").
- "peso" de 1 a 5: reflete número de questões e peso na nota.
- "prioridade" de 1 (baixa) a 3 (alta): incidência histórica do assunto nas provas dessa banca.
- Divida o conteúdo em assuntos que caibam em 1 a 2 sessões de estudo; agrupe itens muito pequenos.
- Mantenha os assuntos na ordem didática (do básico ao avançado).
- "semana": distribua as matérias em {{dias}} com até 3 matérias por dia, repetindo mais as de maior peso. Deixe o domingo vazio (dia de simulado e revisão), a menos que eu estude todos os dias.
- "provas" no assunto: liste os ids das provas que cobram aquele assunto.
{{planoAtual}}`;

const LEITURA_PDF = (qual: string) => `Leitura do PDF:
- Leia o PDF ${qual} INTEIRO, não só o começo. O conteúdo programático costuma estar num anexo no final.
- Se o edital tiver vários cargos, use só o conteúdo do cargo indicado e as matérias comuns a todos os cargos.
- Use o quadro de provas (número de questões e peso por matéria) para definir o "peso" de cada matéria.
- Se o PDF trouxer banca e data da prova, use esses dados em vez dos que eu informei.
- Se o PDF não estiver anexado ou você não conseguir lê-lo, NÃO invente o conteúdo: responda apenas pedindo que eu envie o PDF de novo.`;

export const PROMPTS: Record<ChavePrompt, Definicao> = {
  "plano.edital": {
    nome: "Analisar edital",
    descricao: "Gera o plano de estudos a partir do PDF do edital, enviado em anexo junto com o prompt.",
    variaveis: ["cargo", "banca", "dataProva", "horas", "dias", "idioma", "complemento", "tipo", "situacao", "planoAtual"],
    padrao: `Você é um especialista em preparação para concursos e provas no Brasil. ANEXEI A ESTA MENSAGEM O PDF DO EDITAL. Leia o edital e monte meu plano de estudos.

Dados:
- Prova/cargo: {{cargo}}
- Banca: {{banca}}
- Data prevista da prova: {{dataProva}}
- Tempo disponível: {{horas}} horas por dia, nos dias: {{dias}}
- Idioma: {{idioma}}

${LEITURA_PDF("do edital")}
{{complemento}}
Tarefa:
1. Extraia do conteúdo programático do PDF TODAS as matérias e assuntos cobrados para esse cargo, sem resumir nem pular itens.
2. Se houver lei ou tema recente que provavelmente será cobrado, inclua como assunto e explique em "observacoes".
3. Monte a semana-modelo conforme as regras.

${REGRAS_PLANO}

Formato exato:
${FORMATO_PLANO}`,
  },
  "plano.preedital": {
    nome: "Edital previsto",
    descricao: "Plano para uma prova que ainda não tem edital, a partir do PDF do edital anterior ou de um cargo parecido, enviado em anexo.",
    variaveis: ["cargo", "banca", "previsao", "editalBase", "tipoBase", "horas", "dias", "idioma", "complemento", "tipo", "situacao", "planoAtual"],
    padrao: `Você é um especialista em preparação para concursos no Brasil. Vou estudar para uma prova que AINDA NÃO TEM EDITAL publicado e preciso de um plano de estudos para começar agora. ANEXEI A ESTA MENSAGEM O PDF DO EDITAL-BASE.

Dados:
- Prova/cargo pretendido: {{cargo}}
- Banca provável: {{banca}}
- Previsão do edital/prova: {{previsao}}
- Edital-base (o PDF anexado): {{editalBase}} ({{tipoBase}})
- Tempo disponível: {{horas}} horas por dia, nos dias: {{dias}}
- Idioma: {{idioma}}

${LEITURA_PDF("do edital-base")}
{{complemento}}
Tarefa:
1. Use o conteúdo programático do PDF como referência principal. Se ele for de outro cargo, adapte ao cargo pretendido: retire o que é específico daquele cargo e acrescente o que costuma ser cobrado para o cargo pretendido.
2. Considere o que mudou desde o edital-base: leis novas ou alteradas e temas recorrentes da banca provável em concursos semelhantes. Inclua esses assuntos e explique em "observacoes" o que é mais provável de mudar.
3. Dê "prioridade" 3 ao núcleo que quase certamente se repete e "prioridade" 1 ao que é incerto.
4. Na prova, use "situacao": "previsto", preencha "previsao" e "editalBase", e deixe "dataProva" null se não houver data.
5. Monte a semana-modelo conforme as regras.

${REGRAS_PLANO}

Formato exato:
${FORMATO_PLANO}`,
  },
  "plano.constancia": {
    nome: "Plano de constância",
    descricao: "Plano para estudar com constância visando várias provas ao mesmo tempo, com um ou mais PDFs de editais anexados como exemplo.",
    variaveis: ["provas", "leituraPdfs", "horas", "dias", "idioma", "complemento", "tipo", "situacao", "planoAtual"],
    padrao: `Você é um especialista em preparação para concursos, ENEM e vestibulares no Brasil. Quero manter constância de estudos me preparando para várias provas ao mesmo tempo, ainda sem edital publicado.

Provas-alvo (e o edital de exemplo de cada uma):
{{provas}}

Tempo disponível: {{horas}} horas por dia, nos dias: {{dias}}
Idioma: {{idioma}}

{{leituraPdfs}}
{{complemento}}
Tarefa:
1. Monte o conteúdo de cada prova a partir do edital de exemplo dela (PDF anexado ou, sem PDF, o último edital ou a matriz de referência que você conhece). Se o exemplo for de um cargo parecido, adapte ao cargo pretendido.
2. Junte as matérias comuns em uma só (ex.: Português aparece uma vez), listando em "provas" de cada assunto quais provas o cobram. Assuntos equivalentes com nomes diferentes em editais diferentes viram um assunto só.
3. Priorize ("prioridade" 3) os assuntos cobrados por mais provas e de maior incidência.
4. Em cada prova do JSON, preencha "editalBase" com o edital usado (ex.: "PC/AL 2023 – Agente (PDF anexado)") e use "situacao": "previsto" quando a prova ainda não tem edital publicado.
5. Monte a semana-modelo conforme as regras.

${REGRAS_PLANO}

Formato exato:
${FORMATO_PLANO}`,
  },
  "perfis.unir": {
    nome: "Unir dois perfis",
    descricao: "Junta os planos de dois perfis num plano só, para estudar para as provas dos dois ao mesmo tempo.",
    variaveis: ["planoA", "planoB", "horas", "dias", "idioma", "complemento", "tipo", "situacao"],
    padrao: `Você é um especialista em preparação para concursos, ENEM e vestibulares no Brasil. Tenho dois planos de estudo, cada um para uma prova diferente, e quero estudar para as duas ao mesmo tempo com um plano único.

{{planoA}}

{{planoB}}

Tempo disponível: {{horas}} horas por dia, nos dias: {{dias}}
Idioma: {{idioma}}
{{complemento}}
Tarefa:
1. Junte os dois planos num só. Matérias equivalentes viram uma matéria (ex.: "Língua Portuguesa" e "Português"). Assuntos equivalentes viram um assunto, mesmo com nomes diferentes.
2. Em cada matéria, preencha "origens" com os ids originais que ela junta (ex.: ["A:port", "B:portugues"]).
3. Em cada assunto, preencha "origens" com os ids originais que ele junta (ex.: ["A:port-01", "B:portugues-03"]). TODO assunto original de A e de B deve aparecer em exatamente um "origens"; é assim que meu progresso é mantido. Não descarte assuntos.
4. Inclua em "objetivo.provas" todas as provas dos dois planos, com os mesmos dados (situação, previsão, edital-base). Em cada assunto, "provas" lista quais provas o cobram.
5. Priorize ("prioridade" 3) os assuntos cobrados pelas duas provas.
6. Monte a semana-modelo conforme as regras, equilibrando as duas provas e dando mais espaço às matérias comuns.

${REGRAS_PLANO}
- Reaproveite como "id" do assunto unido o id original de A (sem o prefixo "A:"), quando houver; senão o de B.

Formato exato (igual ao abaixo, com "origens" em cada matéria e em cada assunto):
${FORMATO_PLANO}`,
  },
  "aulas.youtube": {
    nome: "Buscar aulas no YouTube",
    descricao: "Pesquisa aulas no YouTube para os assuntos do plano, no idioma do perfil.",
    variaveis: ["idioma", "objetivo", "banca", "porAssunto", "assuntos"],
    padrao: `Pesquise no YouTube aulas gratuitas em {{idioma}} para os assuntos abaixo. O objetivo é a prova: {{objetivo}} (banca: {{banca}}).

IMPORTANTE:
- Use busca na web de verdade. NÃO invente links nem IDs de vídeo. Se não encontrar uma aula boa para um assunto, simplesmente não inclua esse assunto.
- Até {{porAssunto}} aula(s) por assunto. Prefira aulas focadas em concursos/provas, recentes, de canais conhecidos e com boa avaliação.
- Uma playlist ou curso que cobre a matéria inteira pode ser incluída com "assuntoId": null e o "materiaId" da matéria.
- Use exatamente os ids fornecidos abaixo.

Assuntos (materiaId | assuntoId | nome):
{{assuntos}}

Responda APENAS com este JSON, sem texto antes ou depois:
{
  "schema": "preparador.aulas/1",
  "idioma": "{{idioma}}",
  "aulas": [
    { "materiaId": "id", "assuntoId": "id ou null", "titulo": "título do vídeo", "url": "https://www.youtube.com/watch?v=...", "canal": "nome do canal", "duracaoMin": 45 }
  ]
}`,
  },
  "aulas.substituto": {
    nome: "Substituir aula quebrada",
    descricao: "Pede uma nova aula para um assunto cujo link não funciona.",
    variaveis: ["idioma", "materiaId", "assuntoId", "assunto", "objetivo", "urlQuebrada"],
    padrao: `O link {{urlQuebrada}} não existe mais. Pesquise no YouTube (busca real, sem inventar IDs) 1 ou 2 aulas gratuitas em {{idioma}} sobre "{{assunto}}" para a prova {{objetivo}}.

Responda APENAS com este JSON:
{
  "schema": "preparador.aulas/1",
  "idioma": "{{idioma}}",
  "aulas": [
    { "materiaId": "{{materiaId}}", "assuntoId": "{{assuntoId}}", "titulo": "título do vídeo", "url": "https://www.youtube.com/watch?v=...", "canal": "nome do canal", "duracaoMin": 30 }
  ]
}`,
  },
  "aulas.texto": {
    nome: "Gerar aula em texto",
    descricao: "Escreve uma aula em texto sobre um assunto do plano, para quando não há vídeo bom. Sempre termina com as fontes.",
    variaveis: ["idioma", "perfil", "horas", "objetivo", "provas", "materiaId", "assuntoId", "materia", "assunto", "detalhe", "relevancia", "vizinhos", "complemento"],
    padrao: `Você é um professor experiente em preparação para concursos, ENEM e vestibulares no Brasil. Não encontrei videoaula boa para um assunto do meu plano de estudos e quero uma AULA EM TEXTO, completa e didática, escrita para mim.

Quem sou eu:
- Aluno: {{perfil}}, estudo {{horas}} horas por dia
- Idioma da aula: {{idioma}}
- Objetivo: {{objetivo}}
- Provas-alvo:
{{provas}}

Assunto da aula:
- Matéria: {{materia}}
- Assunto: {{assunto}}
- Subtópicos que o edital cita: {{detalhe}}
- Relevância no meu plano: {{relevancia}}
- Onde ele fica no plano: {{vizinhos}}
{{complemento}}
Como escrever:
1. Foque no que essas provas e essas bancas cobram. Cubra todos os subtópicos citados, na ordem didática, sem fugir do assunto.
2. Explique como um bom professor: conceito, por que importa, exemplos concretos e, quando houver, casos de prova. Use linguagem clara; defina termos técnicos na primeira vez.
3. Quando o assunto tiver base legal, cite os artigos e transcreva os trechos-chave. Use a legislação vigente e avise se houve mudança recente.
4. Em "pontosDeProva", liste como a banca costuma cobrar o tema: pegadinhas, exceções e palavras que mudam o gabarito.
5. Tamanho: o suficiente para estudar o assunto numa sessão de estudo, sem enrolação.
6. No campo "texto" de cada seção, separe parágrafos com uma linha em branco e use linhas começando com "- " para listas. Pode usar **negrito** para termos-chave. Não use outros recursos de markdown nem HTML.
7. FONTES: em "fontes", liste SEMPRE as fontes em que a aula se baseia (lei com número e artigos, súmulas, doutrina com autor e obra, documentos e sites oficiais). Inclua "url" só quando tiver certeza de que o endereço existe (ex.: planalto.gov.br); senão use null. Não invente obras, autores nem links.

Ids do assunto (use exatamente): materiaId "{{materiaId}}", assuntoId "{{assuntoId}}".

Responda APENAS com este JSON, sem texto antes ou depois e sem cercas de código:
{
  "schema": "preparador.aulaTexto/1",
  "materiaId": "{{materiaId}}",
  "assuntoId": "{{assuntoId}}",
  "titulo": "título da aula",
  "idioma": "{{idioma}}",
  "resumo": "em 2 a 4 frases, o que a aula ensina",
  "secoes": [
    { "titulo": "título da seção", "texto": "parágrafo\\n\\n- item de lista\\n- outro item" }
  ],
  "pontosDeProva": ["como a banca cobra e as pegadinhas"],
  "fontes": [
    { "titulo": "Constituição Federal de 1988, arts. 5º a 17", "url": "https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm" }
  ]
}`,
  },
  "aulas.apostila": {
    nome: "Aulas a partir de apostila",
    descricao: "Lê a apostila em PDF (anexada), encaixa cada parte num assunto do plano e escreve uma aula em texto por assunto, com base na apostila.",
    variaveis: ["apostila", "idioma", "perfil", "horas", "objetivo", "provas", "assuntos", "complemento"],
    padrao: `Você é um professor experiente em preparação para concursos, ENEM e vestibulares no Brasil. ANEXEI A ESTA MENSAGEM O PDF DA MINHA APOSTILA: {{apostila}}.

Quero transformar o conteúdo dela em aulas em texto, organizadas pelos assuntos do meu plano de estudos.

Quem sou eu:
- Aluno: {{perfil}}, estudo {{horas}} horas por dia
- Idioma das aulas: {{idioma}}
- Objetivo: {{objetivo}}
- Provas-alvo:
{{provas}}
{{complemento}}
Tarefa:
1. Leia o PDF INTEIRO, não só o começo. Se o PDF não estiver anexado ou não puder ser lido, NÃO invente nada: responda apenas pedindo o PDF de novo.
2. Para cada capítulo ou trecho da apostila, decida em qual assunto da lista abaixo ele se encaixa. Use exatamente os ids da lista. Vários trechos do mesmo assunto viram UMA aula só.
3. Escreva uma aula por assunto coberto pela apostila. A aula deve se BASEAR NA APOSTILA: siga a explicação, os exemplos e a ordem dela, reorganizando para ficar didática. Não copie páginas inteiras; resuma e explique.
4. Se a apostila estiver desatualizada (ex.: lei alterada) ou tiver um erro, corrija e avise no próprio texto, dizendo o que mudou.
5. Foque no que essas provas e essas bancas cobram. Em "pontosDeProva", liste como a banca costuma cobrar o tema: pegadinhas, exceções e palavras que mudam o gabarito.
6. Assuntos do plano que a apostila não cobre: não crie aula para eles. Trechos da apostila que não se encaixam em nenhum assunto: liste o título deles em "foraDoPlano".
7. No campo "texto" de cada seção, separe parágrafos com uma linha em branco e use linhas começando com "- " para listas. Pode usar **negrito** para termos-chave. Não use outros recursos de markdown nem HTML.
8. FONTES: em cada aula, a PRIMEIRA fonte é sempre a apostila, com as páginas usadas (ex.: "{{apostila}}, p. 12–18", "url": null). Depois, liste as leis com artigos, súmulas e demais fontes que a apostila cita ou que você usou para corrigi-la. Inclua "url" só quando tiver certeza de que o endereço existe; senão use null. Não invente obras, autores nem links.
9. Em cada aula, preencha "apostila" com "{{apostila}}".
10. Se a apostila cobrir muitos assuntos, responda em partes de até 8 aulas por resposta, cada parte como um JSON completo. Eu peço "continue" para a próxima parte.

Assuntos do meu plano (materiaId | assuntoId | nome):
{{assuntos}}

Responda APENAS com este JSON, sem texto antes ou depois e sem cercas de código:
{
  "schema": "preparador.apostila/1",
  "apostila": "{{apostila}}",
  "aulas": [
    {
      "materiaId": "id",
      "assuntoId": "id",
      "titulo": "título da aula",
      "idioma": "{{idioma}}",
      "apostila": "{{apostila}}",
      "resumo": "em 2 a 4 frases, o que a aula ensina",
      "secoes": [
        { "titulo": "título da seção", "texto": "parágrafo\\n\\n- item de lista\\n- outro item" }
      ],
      "pontosDeProva": ["como a banca cobra e as pegadinhas"],
      "fontes": [
        { "titulo": "{{apostila}}, p. 12–18", "url": null }
      ]
    }
  ],
  "foraDoPlano": ["título de trecho da apostila sem assunto correspondente"]
}`,
  },
  "questoes.extrair": {
    nome: "Extrair questões de prova anterior",
    descricao: "Transcreve as questões de uma prova anterior (PDF anexado) e classifica cada uma num assunto do plano.",
    variaveis: ["prova", "gabarito", "materias", "assuntos", "complemento"],
    padrao: `ANEXEI A ESTA MENSAGEM O PDF DA PROVA: {{prova}}.
{{gabarito}}

Quero colocar as questões dessa prova no meu banco de questões, classificadas nos assuntos do meu plano de estudos.

Tarefa:
1. Leia o PDF INTEIRO e transcreva FIELMENTE cada questão {{materias}}. Não resuma nem reescreva enunciados ou alternativas.
2. Quando vários itens dependem de um texto ou situação comum (comum no Cebraspe: "Julgue os itens a seguir..."), repita no começo do "enunciado" de cada item o texto-base ou um resumo fiel dele, seguido do item. Cada item certo/errado é uma questão separada.
3. Tipo: "CE" para itens de julgar certo/errado (gabarito "C" ou "E"); "ME" para múltipla escolha, com as alternativas em "alternativas" SEM as letras no texto (gabarito = letra da correta).
4. Classifique cada questão no assunto mais adequado da lista abaixo, usando exatamente os ids. Se nenhum assunto servir, use só o "materiaId" com "assuntoId": null. Se nem a matéria existir no plano, pule a questão.
5. Pule questões ANULADAS e questões que dependem de imagem, gráfico ou tabela que não dá para transcrever. Não inclua essas questões no JSON.
6. "fonte": banca, ano, órgão/cargo e o número da questão (ex.: "Cebraspe 2021 – PC/SE Agente, q. 23").
7. "explicacao": explicação curta do gabarito, citando a base legal ou o conceito.
8. "gabaritoOficial": true se o gabarito veio do gabarito oficial anexado; false se você mesmo resolveu.
9. Se a prova tiver muitas questões, responda em partes de até 40 questões por resposta, cada parte como um JSON completo. Eu peço "continue" para a próxima parte.
10. Se o PDF não estiver anexado ou não puder ser lido, NÃO invente questões: peça o PDF de novo.
{{complemento}}
Assuntos do meu plano (materiaId | assuntoId | nome):
{{assuntos}}

Responda APENAS com o JSON, sem texto antes ou depois:
{
  "schema": "preparador.questoes/1",
  "questoes": [
    { "materiaId": "id", "assuntoId": "id ou null", "tipo": "CE", "enunciado": "texto-base + item", "alternativas": null, "gabarito": "E", "explicacao": "explicação curta", "fonte": "Banca ano – órgão/cargo, q. N", "gabaritoOficial": true }
  ]
}`,
  },
  "questoes.gerar": {
    nome: "Gerar questões",
    descricao: "Cria questões inéditas no estilo da banca para um assunto.",
    variaveis: ["quantidade", "tipo", "banca", "objetivo", "assuntos", "idioma"],
    padrao: `Você é examinador da banca {{banca}}. Crie {{quantidade}} questões inéditas do tipo {{tipo}} para a prova {{objetivo}}, em {{idioma}}, sobre os assuntos abaixo. Use a legislação e o conhecimento vigentes; nas explicações, cite a base legal ou o conceito.

Tipos:
- "CE": item para julgar CERTO ou ERRADO. "gabarito": "C" ou "E". Misture certos e errados, com pegadinhas típicas da banca nos errados.
- "ME": múltipla escolha com 4 ou 5 alternativas em "alternativas" (sem letras no texto). "gabarito": letra da correta ("A", "B"...).

Assuntos (materiaId | assuntoId | nome):
{{assuntos}}

Responda APENAS com este JSON, sem texto antes ou depois:
{
  "schema": "preparador.questoes/1",
  "questoes": [
    { "materiaId": "id", "assuntoId": "id", "tipo": "CE", "enunciado": "texto", "alternativas": null, "gabarito": "C", "explicacao": "explicação curta" }
  ]
}`,
  },
};

export type ProvaAlvo = { nome: string; pdf: string };

/** Linhas da lista de provas-alvo do prompt de constância, dizendo qual PDF anexado é de cada prova. */
export function listaProvasAlvo(provas: ProvaAlvo[]) {
  let n = 0;
  return provas
    .filter((p) => p.nome.trim())
    .map((p) => {
      const pdf = p.pdf.trim();
      return pdf ? `- ${p.nome.trim()} → PDF anexado nº ${++n}: ${pdf}` : `- ${p.nome.trim()} → sem PDF (use o último edital ou a matriz que você conhece)`;
    })
    .join("\n");
}

/** Instruções de leitura conforme a quantidade de PDFs anexados no modo constância. */
export function leituraPdfsConstancia(provas: ProvaAlvo[]) {
  const n = provas.filter((p) => p.nome.trim() && p.pdf.trim()).length;
  if (!n) return "Não anexei editais: para cada prova, use o último edital ou a matriz de referência que você conhece.";
  return `ANEXEI A ESTA MENSAGEM ${n} PDF${n > 1 ? "S DE EDITAIS" : " DE EDITAL"} DE EXEMPLO, numerados na lista de provas acima.
Leitura dos PDFs:
- Leia ${n > 1 ? "CADA PDF" : "o PDF"} INTEIRO, não só o começo. O conteúdo programático costuma estar num anexo no final.${n > 1 ? "\n- Associe cada PDF à prova indicada na lista. Se a ordem dos anexos não bater com a numeração, identifique pelo conteúdo (órgão, cargo e ano)." : ""}
- Se um edital tiver vários cargos, use só o cargo que corresponde à prova-alvo e as matérias comuns a todos os cargos.
- Use o quadro de provas de cada edital (número de questões e peso por matéria) para definir o "peso" das matérias.
- O conteúdo dos PDFs tem prioridade sobre o que você já sabe dessas provas.
- Se algum PDF listado não estiver anexado ou não puder ser lido, NÃO invente o conteúdo dele: responda apenas dizendo qual PDF faltou e pedindo que eu envie de novo.`;
}

export async function templates(): Promise<Record<ChavePrompt, { texto: string; editado: boolean }>> {
  const salvos = await select<{ chave: ChavePrompt; template: string }>("SELECT chave, template FROM prompts");
  const mapa = Object.fromEntries(salvos.map((s) => [s.chave, s.template]));
  return Object.fromEntries(
    (Object.keys(PROMPTS) as ChavePrompt[]).map((k) => [k, { texto: mapa[k] ?? PROMPTS[k].padrao, editado: k in mapa }]),
  ) as Record<ChavePrompt, { texto: string; editado: boolean }>;
}

export async function salvarTemplate(chave: ChavePrompt, texto: string | null) {
  if (texto == null || texto === PROMPTS[chave].padrao) await execute("DELETE FROM prompts WHERE chave = $1", [chave]);
  else
    await execute(
      "INSERT INTO prompts (chave, template) VALUES ($1, $2) ON CONFLICT(chave) DO UPDATE SET template = excluded.template, editado_em = CURRENT_TIMESTAMP",
      [chave, texto],
    );
}

export async function montarPrompt(chave: ChavePrompt, vars: Record<string, string | number | null | undefined>) {
  const t = (await templates())[chave].texto;
  return t.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k];
    if (k === "planoAtual" || k === "complemento" || k === "leituraPdfs" || k === "gabarito") return v ? String(v) : "";
    return v == null || v === "" ? "não informado" : String(v);
  });
}

export async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}
