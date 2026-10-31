-- Anotações: páginas em blocos, por perfil, em árvore (pai_id), que podem ser
-- vinculadas a uma matéria ou assunto do plano e mencionar outras páginas.

CREATE TABLE paginas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  perfil_id      INTEGER NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  pai_id         INTEGER REFERENCES paginas(id) ON DELETE CASCADE,
  titulo         TEXT NOT NULL DEFAULT '',
  icone          TEXT,
  ordem          REAL NOT NULL DEFAULT 0,
  materia_id     INTEGER REFERENCES materias(id) ON DELETE SET NULL,
  assunto_id     INTEGER REFERENCES assuntos(id) ON DELETE SET NULL,
  criado_em      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX paginas_arvore ON paginas (perfil_id, pai_id, ordem);
CREATE INDEX paginas_assunto ON paginas (assunto_id);

-- texto no formato inline de src/lib/anotacoes.ts (**negrito**, *itálico*, `código`, [link](url), [[p:12|Título]])
CREATE TABLE blocos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pagina_id  INTEGER NOT NULL REFERENCES paginas(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL DEFAULT 'paragrafo'
             CHECK (tipo IN ('paragrafo', 'h1', 'h2', 'h3', 'lista', 'numerada', 'tarefa', 'citacao', 'divisor', 'codigo')),
  texto      TEXT NOT NULL DEFAULT '',
  nivel      INTEGER NOT NULL DEFAULT 0,
  marcado    INTEGER NOT NULL DEFAULT 0,
  ordem      REAL NOT NULL DEFAULT 0
);
CREATE INDEX blocos_pagina ON blocos (pagina_id, ordem);

-- derivada do texto dos blocos, regravada a cada salvamento; alimenta "Mencionada em"
CREATE TABLE mencoes (
  bloco_id   INTEGER NOT NULL REFERENCES blocos(id) ON DELETE CASCADE,
  alvo_tipo  TEXT NOT NULL CHECK (alvo_tipo IN ('pagina', 'materia', 'assunto')),
  alvo_id    INTEGER NOT NULL,
  PRIMARY KEY (bloco_id, alvo_tipo, alvo_id)
);
CREATE INDEX mencoes_alvo ON mencoes (alvo_tipo, alvo_id);
