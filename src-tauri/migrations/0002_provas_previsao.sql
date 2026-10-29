-- Prova ainda sem edital: o plano se baseia no edital anterior ou de cargo parecido.
ALTER TABLE provas ADD COLUMN situacao TEXT NOT NULL DEFAULT 'publicado'
  CHECK (situacao IN ('publicado', 'previsto'));
-- texto livre, ex.: "1º semestre de 2027"
ALTER TABLE provas ADD COLUMN previsao TEXT;
-- edital usado como base quando a prova está prevista
ALTER TABLE provas ADD COLUMN edital_base TEXT;
