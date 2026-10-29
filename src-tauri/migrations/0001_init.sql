-- Modelo inicial. Reimportar um plano atualiza matérias/assuntos pelo slug,
-- mantendo os ids para que o progresso continue ligado a eles.

CREATE TABLE config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE perfis (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  idioma     TEXT NOT NULL DEFAULT 'pt-BR',
  horas_dia  REAL NOT NULL DEFAULT 3,
  criado_em  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- tipo 'edital': uma prova; 'constancia': várias provas com matérias mescladas
CREATE TABLE objetivos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  perfil_id  INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL CHECK (tipo IN ('edital', 'constancia')),
  nome       TEXT NOT NULL,
  criado_em  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE provas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  objetivo_id  INTEGER NOT NULL REFERENCES objetivos(id) ON DELETE CASCADE,
  nome         TEXT NOT NULL,
  banca        TEXT,
  data_prova   TEXT
);

CREATE TABLE importacoes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  perfil_id  INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL CHECK (tipo IN ('plano', 'aulas', 'questoes')),
  json_bruto TEXT NOT NULL,
  criado_em  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE planos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  objetivo_id    INTEGER NOT NULL REFERENCES objetivos(id) ON DELETE CASCADE,
  versao         INTEGER NOT NULL DEFAULT 1,
  ativo          INTEGER NOT NULL DEFAULT 1,
  revisoes       TEXT NOT NULL DEFAULT '[1,7,30]',
  observacoes    TEXT,
  importacao_id  INTEGER REFERENCES importacoes(id) ON DELETE SET NULL,
  criado_em      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE materias (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  plano_id  INTEGER NOT NULL REFERENCES planos(id) ON DELETE CASCADE,
  slug      TEXT NOT NULL,
  nome      TEXT NOT NULL,
  peso      REAL NOT NULL DEFAULT 1,
  ordem     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (plano_id, slug)
);

CREATE TABLE assuntos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  materia_id  INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  nome        TEXT NOT NULL,
  detalhe     TEXT,
  prioridade  INTEGER NOT NULL DEFAULT 2,
  ordem       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (materia_id, slug)
);

-- modo constância: quais provas cobram o assunto
CREATE TABLE assunto_provas (
  assunto_id  INTEGER NOT NULL REFERENCES assuntos(id) ON DELETE CASCADE,
  prova_id    INTEGER NOT NULL REFERENCES provas(id) ON DELETE CASCADE,
  PRIMARY KEY (assunto_id, prova_id)
);

-- dia: 0 = domingo (igual a Date.getDay)
CREATE TABLE semana (
  plano_id    INTEGER NOT NULL REFERENCES planos(id) ON DELETE CASCADE,
  dia         INTEGER NOT NULL CHECK (dia BETWEEN 0 AND 6),
  ordem       INTEGER NOT NULL,
  materia_id  INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
  PRIMARY KEY (plano_id, dia, ordem)
);

-- assunto_id NULL = vale para a matéria inteira
CREATE TABLE aulas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  perfil_id     INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  materia_id    INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
  assunto_id    INTEGER REFERENCES assuntos(id) ON DELETE CASCADE,
  titulo        TEXT NOT NULL,
  url           TEXT NOT NULL,
  canal         TEXT,
  duracao_min   INTEGER,
  status_link   TEXT NOT NULL DEFAULT 'nao_verificado'
                CHECK (status_link IN ('nao_verificado', 'ok', 'quebrado')),
  assistida_em  TEXT,
  criado_em     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX aulas_materia ON aulas (materia_id, assunto_id);

-- slot NULL = estudo fora do plano
CREATE TABLE sessoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  perfil_id   INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  data        TEXT NOT NULL,
  slot        INTEGER,
  materia_id  INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
  assunto_id  INTEGER REFERENCES assuntos(id) ON DELETE SET NULL,
  minutos     INTEGER NOT NULL DEFAULT 0,
  estudou     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sessoes_data ON sessoes (perfil_id, data);

CREATE TABLE conclusoes (
  perfil_id   INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  assunto_id  INTEGER NOT NULL REFERENCES assuntos(id) ON DELETE CASCADE,
  data        TEXT NOT NULL,
  PRIMARY KEY (perfil_id, assunto_id)
);

CREATE TABLE revisoes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  perfil_id      INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  assunto_id     INTEGER NOT NULL REFERENCES assuntos(id) ON DELETE CASCADE,
  intervalo      INTEGER NOT NULL,
  data_prevista  TEXT NOT NULL,
  feita_em       TEXT,
  UNIQUE (perfil_id, assunto_id, intervalo)
);
CREATE INDEX revisoes_data ON revisoes (perfil_id, data_prevista);

-- tipo 'CE': certo/errado (gabarito 'C'|'E'); 'ME': múltipla escolha (gabarito = letra)
CREATE TABLE questoes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  perfil_id    INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  materia_id   INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
  assunto_id   INTEGER REFERENCES assuntos(id) ON DELETE SET NULL,
  tipo         TEXT NOT NULL CHECK (tipo IN ('CE', 'ME')),
  enunciado    TEXT NOT NULL,
  alternativas TEXT,
  gabarito     TEXT NOT NULL,
  explicacao   TEXT,
  origem       TEXT NOT NULL DEFAULT 'importada' CHECK (origem IN ('banco', 'importada', 'manual')),
  criado_em    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX questoes_materia ON questoes (materia_id, assunto_id);

CREATE TABLE respostas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  perfil_id   INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  questao_id  INTEGER NOT NULL REFERENCES questoes(id) ON DELETE CASCADE,
  resposta    TEXT NOT NULL,
  acertou     INTEGER NOT NULL,
  data        TEXT NOT NULL
);
CREATE INDEX respostas_questao ON respostas (perfil_id, questao_id);

-- só guarda prompts editados pelo usuário; os padrões ficam no código
CREATE TABLE prompts (
  chave      TEXT PRIMARY KEY,
  template   TEXT NOT NULL,
  editado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
