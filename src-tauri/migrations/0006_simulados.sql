-- Simulados em modo prova: as questões (do banco ou geradas pela IA, que entram
-- no banco) ficam numa lista ordenada; as respostas são gravadas a cada clique e,
-- ao finalizar, vão também para respostas, como qualquer questão respondida.

CREATE TABLE simulados (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  perfil_id      INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  titulo         TEXT NOT NULL,
  origem         TEXT NOT NULL DEFAULT 'banco' CHECK (origem IN ('banco', 'ia')),
  tempo_min      INTEGER,          -- NULL = sem cronômetro
  criado_em      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  iniciado_em    TEXT,             -- ISO, do primeiro acesso à prova
  finalizado_em  TEXT,
  duracao_seg    INTEGER
);
CREATE INDEX simulados_perfil ON simulados (perfil_id, criado_em);

CREATE TABLE simulado_questoes (
  simulado_id  INTEGER NOT NULL REFERENCES simulados(id) ON DELETE CASCADE,
  questao_id   INTEGER NOT NULL REFERENCES questoes(id) ON DELETE CASCADE,
  ordem        INTEGER NOT NULL,
  resposta     TEXT,               -- NULL = em branco
  acertou      INTEGER,            -- preenchido ao finalizar
  PRIMARY KEY (simulado_id, questao_id)
);
