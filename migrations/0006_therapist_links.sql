-- Linki do wizytówek terapeuty (Facebook, Instagram, wizytówka Google, własna
-- strona). Kolumna JSON, tak jak `credentials` — lista jest krótka, nigdy nie
-- filtrujemy po niej i nie łączymy jej z innymi tabelami, więc osobna tabela
-- dołożyłaby tylko JOIN-a.
ALTER TABLE therapists ADD COLUMN links TEXT NOT NULL DEFAULT '[]';
