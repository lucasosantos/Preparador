-- Acervo: tudo o que já foi cadastrado em qualquer perfil fica guardado aqui,
-- sem depender de perfil nem de plano, para ser reaproveitado em planos futuros.
-- O vínculo é pelo nome do tema (matéria + assunto), não por id.

-- assunto '' = a matéria inteira
CREATE TABLE acervo_temas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  materia        TEXT NOT NULL,
  assunto        TEXT NOT NULL DEFAULT '',
  detalhe        TEXT,
  objetivo       TEXT,
  banca          TEXT,
  atualizado_em  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (materia, assunto)
);

CREATE TABLE acervo_aulas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tema_id      INTEGER NOT NULL REFERENCES acervo_temas(id) ON DELETE CASCADE,
  titulo       TEXT NOT NULL,
  url          TEXT NOT NULL,
  canal        TEXT,
  duracao_min  INTEGER,
  status_link  TEXT NOT NULL DEFAULT 'nao_verificado',
  criado_em    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tema_id, url)
);

CREATE TABLE acervo_questoes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tema_id           INTEGER NOT NULL REFERENCES acervo_temas(id) ON DELETE CASCADE,
  tipo              TEXT NOT NULL,
  enunciado         TEXT NOT NULL UNIQUE,
  alternativas      TEXT,
  gabarito          TEXT NOT NULL,
  explicacao        TEXT,
  fonte             TEXT,
  gabarito_oficial  INTEGER NOT NULL DEFAULT 1,
  criado_em         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX acervo_questoes_tema ON acervo_questoes (tema_id);

-- tema de cada matéria (assunto_id NULL) e de cada assunto, com o objetivo e a banca do plano
CREATE VIEW acervo_origem AS
  SELECT m.id AS materia_id, NULL AS assunto_id, m.nome AS materia, '' AS assunto, NULL AS detalhe, o.nome AS objetivo,
         (SELECT banca FROM provas WHERE objetivo_id = o.id AND banca IS NOT NULL ORDER BY id LIMIT 1) AS banca
    FROM materias m JOIN planos p ON p.id = m.plano_id JOIN objetivos o ON o.id = p.objetivo_id
  UNION ALL
  SELECT m.id, a.id, m.nome, a.nome, a.detalhe, o.nome,
         (SELECT banca FROM provas WHERE objetivo_id = o.id AND banca IS NOT NULL ORDER BY id LIMIT 1)
    FROM assuntos a JOIN materias m ON m.id = a.materia_id JOIN planos p ON p.id = m.plano_id JOIN objetivos o ON o.id = p.objetivo_id;

CREATE TRIGGER acervo_materia AFTER INSERT ON materias BEGIN
  INSERT INTO acervo_temas (materia, assunto, objetivo, banca)
    SELECT materia, assunto, objetivo, banca FROM acervo_origem WHERE materia_id = NEW.id AND assunto_id IS NULL
    ON CONFLICT (materia, assunto) DO UPDATE SET objetivo = excluded.objetivo, banca = COALESCE(excluded.banca, banca),
      atualizado_em = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER acervo_materia_nome AFTER UPDATE OF nome ON materias BEGIN
  INSERT OR IGNORE INTO acervo_temas (materia, assunto, objetivo, banca)
    SELECT materia, assunto, objetivo, banca FROM acervo_origem WHERE materia_id = NEW.id AND assunto_id IS NULL;
END;

CREATE TRIGGER acervo_assunto AFTER INSERT ON assuntos BEGIN
  INSERT INTO acervo_temas (materia, assunto, detalhe, objetivo, banca)
    SELECT materia, assunto, detalhe, objetivo, banca FROM acervo_origem WHERE assunto_id = NEW.id
    ON CONFLICT (materia, assunto) DO UPDATE SET detalhe = COALESCE(excluded.detalhe, detalhe), objetivo = excluded.objetivo,
      banca = COALESCE(excluded.banca, banca), atualizado_em = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER acervo_assunto_nome AFTER UPDATE OF nome, detalhe, materia_id ON assuntos BEGIN
  INSERT INTO acervo_temas (materia, assunto, detalhe, objetivo, banca)
    SELECT materia, assunto, detalhe, objetivo, banca FROM acervo_origem WHERE assunto_id = NEW.id
    ON CONFLICT (materia, assunto) DO UPDATE SET detalhe = COALESCE(excluded.detalhe, detalhe), atualizado_em = CURRENT_TIMESTAMP;
END;

CREATE TRIGGER acervo_aula AFTER INSERT ON aulas BEGIN
  INSERT OR IGNORE INTO acervo_temas (materia, assunto, detalhe, objetivo, banca)
    SELECT materia, assunto, detalhe, objetivo, banca FROM acervo_origem WHERE materia_id = NEW.materia_id AND assunto_id IS NEW.assunto_id;
  INSERT OR IGNORE INTO acervo_aulas (tema_id, titulo, url, canal, duracao_min, status_link)
    SELECT t.id, NEW.titulo, NEW.url, NEW.canal, NEW.duracao_min, NEW.status_link
      FROM acervo_origem v JOIN acervo_temas t ON t.materia = v.materia AND t.assunto = v.assunto
     WHERE v.materia_id = NEW.materia_id AND v.assunto_id IS NEW.assunto_id;
END;

-- a verificação do link vale para todas as cópias do vídeo no acervo
CREATE TRIGGER acervo_aula_status AFTER UPDATE OF status_link, titulo ON aulas BEGIN
  UPDATE acervo_aulas SET status_link = NEW.status_link, titulo = NEW.titulo WHERE url = NEW.url;
END;

CREATE TRIGGER acervo_questao AFTER INSERT ON questoes BEGIN
  INSERT OR IGNORE INTO acervo_temas (materia, assunto, detalhe, objetivo, banca)
    SELECT materia, assunto, detalhe, objetivo, banca FROM acervo_origem WHERE materia_id = NEW.materia_id AND assunto_id IS NEW.assunto_id;
  INSERT OR IGNORE INTO acervo_questoes (tema_id, tipo, enunciado, alternativas, gabarito, explicacao, fonte, gabarito_oficial)
    SELECT t.id, NEW.tipo, NEW.enunciado, NEW.alternativas, NEW.gabarito, NEW.explicacao, NEW.fonte, NEW.gabarito_oficial
      FROM acervo_origem v JOIN acervo_temas t ON t.materia = v.materia AND t.assunto = v.assunto
     WHERE v.materia_id = NEW.materia_id AND v.assunto_id IS NEW.assunto_id;
END;

-- o que já existe antes desta versão entra no acervo
INSERT OR IGNORE INTO acervo_temas (materia, assunto, detalhe, objetivo, banca)
  SELECT materia, assunto, detalhe, objetivo, banca FROM acervo_origem;
INSERT OR IGNORE INTO acervo_aulas (tema_id, titulo, url, canal, duracao_min, status_link)
  SELECT t.id, x.titulo, x.url, x.canal, x.duracao_min, x.status_link
    FROM aulas x JOIN acervo_origem v ON v.materia_id = x.materia_id AND v.assunto_id IS x.assunto_id
    JOIN acervo_temas t ON t.materia = v.materia AND t.assunto = v.assunto;
INSERT OR IGNORE INTO acervo_questoes (tema_id, tipo, enunciado, alternativas, gabarito, explicacao, fonte, gabarito_oficial)
  SELECT t.id, x.tipo, x.enunciado, x.alternativas, x.gabarito, x.explicacao, x.fonte, x.gabarito_oficial
    FROM questoes x JOIN acervo_origem v ON v.materia_id = x.materia_id AND v.assunto_id IS x.assunto_id
    JOIN acervo_temas t ON t.materia = v.materia AND t.assunto = v.assunto;
