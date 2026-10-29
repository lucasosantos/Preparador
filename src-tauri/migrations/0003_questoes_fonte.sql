-- Questões extraídas de provas anteriores: de onde vieram e se o gabarito é o oficial.
ALTER TABLE questoes ADD COLUMN fonte TEXT;
-- 0 = gabarito resolvido pela IA (a prova veio sem gabarito)
ALTER TABLE questoes ADD COLUMN gabarito_oficial INTEGER NOT NULL DEFAULT 1;
