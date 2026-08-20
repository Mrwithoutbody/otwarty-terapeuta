-- Reference data: controlled vocabularies + the initial crisis-resource set.
-- This is NOT demo data; it ships to every environment.

INSERT INTO languages (code, name_pl) VALUES
  ('pl','polski'), ('en','angielski'), ('uk','ukraiński'), ('ru','rosyjski'),
  ('de','niemiecki'), ('fr','francuski'), ('es','hiszpański'), ('be','białoruski');

INSERT INTO specialties (slug, name_pl, category) VALUES
  ('lek','lęk i niepokój','emotions'),
  ('depresja','obniżony nastrój','emotions'),
  ('stres-zawodowy','stres zawodowy i wypalenie','work'),
  ('relacje','trudności w relacjach','relations'),
  ('zwiazki','kryzys w związku','relations'),
  ('rodzicielstwo','rodzicielstwo','relations'),
  ('zaloba','żałoba i strata','life'),
  ('trauma','doświadczenia traumatyczne','life'),
  ('samoocena','poczucie własnej wartości','self'),
  ('zmiana-zyciowa','zmiana życiowa','life'),
  ('sen','trudności ze snem','health'),
  ('uzaleznienia','uzależnienia i nawyki','health'),
  ('zaburzenia-odzywiania','relacja z jedzeniem','health'),
  ('lgbtq','wsparcie osób LGBTQ+','identity'),
  ('migracja','migracja i adaptacja','identity'),
  ('neuroroznorodnosc','neuroróżnorodność','identity');

INSERT INTO modalities (slug, name_pl) VALUES
  ('poznawczo-behawioralna','terapia poznawczo-behawioralna (CBT)'),
  ('psychodynamiczna','terapia psychodynamiczna'),
  ('humanistyczna','terapia humanistyczna'),
  ('systemowa','terapia systemowa'),
  ('schematu','terapia schematu'),
  ('act','terapia akceptacji i zaangażowania (ACT)'),
  ('emdr','EMDR'),
  ('integracyjna','podejście integracyjne'),
  ('gestalt','terapia Gestalt'),
  ('dbt','terapia dialektyczno-behawioralna (DBT)');

-- Crisis resources for Poland. Verified against the official sources listed in
-- `source_url`. Re-verify at least every 90 days from the admin panel.
INSERT INTO crisis_resources
  (id, country, audience, title, description, phone, url, hours, priority, source_url, verified_at, version, active)
VALUES
  ('cr_pl_112', 'PL', 'all',
   'Bezpośrednie zagrożenie życia lub zdrowia — 112',
   'Jeżeli Ty lub ktoś w Twoim otoczeniu jest w bezpośrednim niebezpieczeństwie, zadzwoń natychmiast pod numer alarmowy 112 (lub 999 — pogotowie ratunkowe). To jest pomoc pilna, dostępna całą dobę.',
   '112', NULL, 'całodobowo', 10,
   'https://pacjent.gov.pl/pomoc-psychiatryczna-i-leczenie-uzaleznien', '2026-08-01', '2026-08-01', 1),

  ('cr_pl_116123', 'PL', 'adult',
   'Kryzysowy Telefon Zaufania dla dorosłych — 116 123',
   'Bezpłatna, całodobowa pierwsza pomoc psychologiczna dla osób dorosłych w kryzysie emocjonalnym. Rozmowa jest anonimowa.',
   '116 123', 'https://116sos.pl', 'całodobowo, 7 dni w tygodniu', 20,
   'https://www.gov.pl/web/cyfryzacja/infolinia-116-123--pierwsza-pomoc-psychologiczna-w-zasiegu-telefonu-i-internetu2',
   '2026-08-01', '2026-08-01', 1),

  ('cr_pl_116111', 'PL', 'minor',
   'Telefon Zaufania dla Dzieci i Młodzieży — 116 111',
   'Bezpłatny, całodobowy telefon zaufania dla osób poniżej 18 roku życia. Rozmowa jest anonimowa. Dostępny też czat na stronie 116111.pl.',
   '116 111', 'https://116111.pl', 'całodobowo, 7 dni w tygodniu', 21,
   'https://pacjent.gov.pl/pomoc-psychiatryczna-i-leczenie-uzaleznien', '2026-08-01', '2026-08-01', 1),

  ('cr_pl_800702222', 'PL', 'adult',
   'Centrum Wsparcia dla osób w kryzysie psychicznym — 800 70 2222',
   'Bezpłatna, całodobowa linia wsparcia prowadzona przez Fundację ITAKA. Dostępny również kontakt mailowy i czat.',
   '800 70 2222', 'https://liniawsparcia.pl', 'całodobowo', 30,
   'https://pacjent.gov.pl/pomoc-psychiatryczna-i-leczenie-uzaleznien', '2026-08-01', '2026-08-01', 1),

  ('cr_pl_cziik', 'PL', 'all',
   'Centra Zdrowia Psychicznego — pomoc doraźna bez skierowania',
   'W punkcie zgłoszeniowo-koordynacyjnym Centrum Zdrowia Psychicznego można zgłosić się osobiście, bez skierowania i bez wcześniejszej rejestracji, w dni robocze. Pomoc jest bezpłatna w ramach NFZ.',
   NULL, 'https://pacjent.gov.pl/pomoc-psychiatryczna-i-leczenie-uzaleznien', 'dni robocze, zwykle 8:00-18:00', 40,
   'https://pacjent.gov.pl/pomoc-psychiatryczna-i-leczenie-uzaleznien', '2026-08-01', '2026-08-01', 1),

  ('cr_pl_minor_note', 'PL', 'minor',
   'Osoby poniżej 18 roku życia — osobna ścieżka',
   'Otwarty Terapeuta w obecnej wersji obsługuje rezerwacje wyłącznie dla osób pełnoletnich. Jeżeli masz mniej niż 18 lat, skorzystaj z telefonu 116 111 lub porozmawiaj z osobą dorosłą, której ufasz — rodzicem, opiekunem, pedagogiem szkolnym.',
   '116 111', 'https://116111.pl', 'całodobowo', 22,
   'https://pacjent.gov.pl/pomoc-psychiatryczna-i-leczenie-uzaleznien', '2026-08-01', '2026-08-01', 1);
