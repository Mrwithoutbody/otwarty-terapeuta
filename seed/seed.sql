-- Demo data for Otwarty Terapeuta.
-- EVERY profile below is fictional and flagged `is_demo = 1`. The UI labels
-- these profiles "dane demonstracyjne". No real person, photo or practice is
-- represented. Do not load this file into a production database that serves
-- real therapists.

DELETE FROM appointment_slots WHERE therapist_id IN (SELECT id FROM therapists WHERE is_demo = 1);
DELETE FROM faq_items        WHERE therapist_id IN (SELECT id FROM therapists WHERE is_demo = 1);
DELETE FROM session_offers   WHERE therapist_id IN (SELECT id FROM therapists WHERE is_demo = 1);
DELETE FROM therapist_languages   WHERE therapist_id IN (SELECT id FROM therapists WHERE is_demo = 1);
DELETE FROM therapist_specialties WHERE therapist_id IN (SELECT id FROM therapists WHERE is_demo = 1);
DELETE FROM therapist_modalities  WHERE therapist_id IN (SELECT id FROM therapists WHERE is_demo = 1);
DELETE FROM therapist_locations   WHERE therapist_id IN (SELECT id FROM therapists WHERE is_demo = 1);
-- A photo uploaded through the panel must survive a reseed: remember every
-- demo row's uploaded photo before the delete, put it back after the insert.
DROP TABLE IF EXISTS _seed_photos;
CREATE TABLE _seed_photos AS
  SELECT id, photo_url FROM therapists WHERE is_demo = 1 AND photo_url LIKE '/media/%';
DROP TABLE IF EXISTS _seed_media;
CREATE TABLE _seed_media AS
  SELECT m.* FROM therapist_media m JOIN therapists t ON t.id = m.therapist_id WHERE t.is_demo = 1;
DELETE FROM therapists WHERE is_demo = 1;

INSERT INTO therapists
 (id, slug, display_name, headline, bio, photo_url, offers_online, offers_in_person,
  accepting_new_clients, age_groups, session_types, credentials, verification_status,
  verified_at, verification_notes, status, is_demo, timezone, cancellation_policy,
  cancellation_cutoff_h, created_at, updated_at)
VALUES
 ('th_4f1a9c72e5b83d016a7c2e40','anna-kowalczyk-demo','Anna Kowalczyk (DEMO)',
  'Psychoterapeutka poznawczo-behawioralna, Warszawa i online',
  'Pracuję z osobami dorosłymi, które mierzą się z lękiem, obniżonym nastrojem i przeciążeniem pracą. W pracy opieram się na terapii poznawczo-behawioralnej: wspólnie nazywamy problem, ustalamy cele i sprawdzamy, co realnie pomaga między sesjami. Prowadzę spotkania po polsku i po angielsku.',
  '/avatar-placeholder.webp',1,1,1,'["adults"]','["individual"]',
  '[{"title":"Certyfikat psychoterapeuty poznawczo-behawioralnego","issuer":"PTTPB","year":2019,"verified":true},{"title":"Magister psychologii","issuer":"Uniwersytet Warszawski","year":2014,"verified":true}]',
  'verified','2026-06-14T09:00:00Z','DEMO — dokumenty niezweryfikowane, profil fikcyjny.','published',1,'Europe/Warsaw',
  'Bezpłatne odwołanie do 24 godzin przed sesją. Później sesja jest płatna w całości.',24,
  '2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),

 ('th_8b2d6e10f4a97c53d1e08b26','marek-zielinski-demo','Marek Zieliński (DEMO)',
  'Psychoterapeuta psychodynamiczny, Kraków',
  'Prowadzę psychoterapię indywidualną i terapię par w nurcie psychodynamicznym. Interesuje mnie to, co powtarza się w relacjach i skąd biorą się wzorce, które utrudniają życie. Pracuję w gabinecie na krakowskim Kazimierzu.',
  '/avatar-placeholder.webp',0,1,1,'["adults"]','["individual","couples"]',
  '[{"title":"Certyfikat psychoterapeuty","issuer":"Polskie Towarzystwo Psychoterapii Psychodynamicznej","year":2017,"verified":true}]',
  'verified','2026-05-30T09:00:00Z','DEMO — profil fikcyjny.','published',1,'Europe/Warsaw',
  'Odwołanie bezpłatne do 48 godzin przed sesją.',48,
  '2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),

 ('th_c93e5a4187b6f20d94a1c3f5','julia-nowak-demo','Julia Nowak (DEMO)',
  'Terapia par i rodzin, wyłącznie online',
  'Pracuję systemowo z parami i rodzinami. Spotkania prowadzę wyłącznie online, co ułatwia udział osobom mieszkającym w różnych miastach. Prowadzę sesje po polsku, angielsku i ukraińsku.',
  '/avatar-placeholder.webp',1,0,1,'["adults","teens"]','["couples","family"]',
  '[{"title":"Certyfikat terapeuty systemowego","issuer":"Wielkopolskie Towarzystwo Terapii Systemowej","year":2020,"verified":true}]',
  'verified','2026-07-02T09:00:00Z','DEMO — profil fikcyjny.','published',1,'Europe/Warsaw',
  'Odwołanie bezpłatne do 24 godzin przed sesją.',24,
  '2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),

 ('th_1e07b8d3629af45c0d2e7a91','piotr-adamski-demo','Piotr Adamski (DEMO)',
  'ACT i CBT, Gdańsk oraz online',
  'Pracuję z osobami dorosłymi nad nawykami, uzależnieniami behawioralnymi i trudnościami ze snem. Łączę terapię akceptacji i zaangażowania z klasycznymi narzędziami poznawczo-behawioralnymi.',
  '/avatar-placeholder.webp',1,1,0,'["adults"]','["individual"]',
  '[{"title":"Certyfikat ACT","issuer":"ACBS Polska","year":2021,"verified":false}]',
  'unverified',NULL,'DEMO — profil fikcyjny, kwalifikacje zgłoszone, jeszcze niesprawdzone.','published',1,'Europe/Warsaw',
  'Odwołanie bezpłatne do 24 godzin przed sesją.',24,
  '2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),

 ('th_7a4c2f9051d3e86b4f0a5c18','katarzyna-wrona-demo','Katarzyna Wrona (DEMO)',
  'Terapia schematu i EMDR, Wrocław oraz online',
  'Towarzyszę osobom dorosłym po trudnych doświadczeniach — stracie bliskiej osoby, wypadku, przemocy. Najczęściej trafiają do mnie osoby, które od dawna radzą sobie dzielnie, tylko coraz większym kosztem: sen, koncentracja i bliskie relacje zaczynają się sypać.

Pracuję terapią schematu oraz EMDR. Terapia schematu pomaga zrozumieć, skąd biorą się nawracające wzorce — dlaczego wybieramy podobnych ludzi i wpadamy w te same koleiny. EMDR pozwala przepracować wspomnienia, które nie chcą zblednąć: wracają w obrazach, snach i napięciu ciała.

Zaczynamy zawsze od stabilizacji — bezpieczeństwo idzie przed każdą techniką. Tempo wyznaczasz Ty: bywają sesje, na których tylko rozmawiamy, i takie, na których pracujemy głęboko.

Prowadzę sesje po polsku i po niemiecku, w gabinecie we Wrocławiu i online.',
  '/avatar-placeholder.webp',1,1,1,'["adults"]','["individual"]',
  '[{"title":"Certyfikat terapeuty schematu","issuer":"ISST","year":2018,"verified":true},{"title":"EMDR — poziom II","issuer":"EMDR Europe","year":2022,"verified":true}]',
  'verified','2026-07-20T09:00:00Z','DEMO — profil fikcyjny.','published',1,'Europe/Warsaw',
  'Odwołanie bezpłatne do 48 godzin przed sesją.',48,
  '2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),

 ('th_5d8f3b6270e91a4c8b3d0f27','tomasz-lis-demo','Tomasz Lis (DEMO)',
  'Terapia Gestalt, Poznań',
  'Pracuję z osobami dorosłymi i seniorami w nurcie Gestalt. Najczęściej zgłaszają się do mnie osoby w momencie zmiany życiowej: po przejściu na emeryturę, po rozstaniu, przy zmianie zawodu.',
  '/avatar-placeholder.webp',0,1,1,'["adults","seniors"]','["individual"]',
  '[{"title":"Certyfikat psychoterapeuty Gestalt","issuer":"Instytut Terapii Gestalt","year":2016,"verified":true}]',
  'verified','2026-06-01T09:00:00Z','DEMO — profil fikcyjny.','published',1,'Europe/Warsaw',
  'Odwołanie bezpłatne do 24 godzin przed sesją.',24,
  '2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),

 ('th_2c6a9e50b8f14d73a0c5e829','olga-sawicka-demo','Olga Sawicka (DEMO)',
  'Wsparcie w adaptacji i lęku, online',
  'Pracuję online z osobami dorosłymi, które mieszkają poza krajem pochodzenia lub niedawno się przeprowadziły. Prowadzę sesje po polsku, ukraińsku i rosyjsku. Podejście integracyjne.',
  '/avatar-placeholder.webp',1,0,1,'["adults"]','["individual"]',
  '[{"title":"Magister psychologii","issuer":"Uniwersytet Jagielloński","year":2015,"verified":true},{"title":"Szkolenie w podejściu integracyjnym (w trakcie certyfikacji)","issuer":"SWPS","year":2023,"verified":false}]',
  'verified','2026-07-11T09:00:00Z','DEMO — profil fikcyjny.','published',1,'Europe/Warsaw',
  'Odwołanie bezpłatne do 12 godzin przed sesją.',12,
  '2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),

 ('th_9f0b4d7382e6a15c7d2b8e34','rafal-bak-demo','Rafał Bąk (DEMO)',
  'DBT, neuroróżnorodność, Łódź oraz online',
  'Pracuję z osobami dorosłymi i nastolatkami. Blisko mi do perspektywy neuroafirmatywnej; prowadzę też grupę treningu umiejętności DBT. Przyjmuję osoby LGBTQ+.',
  '/avatar-placeholder.webp',1,1,1,'["adults","teens"]','["individual","couples"]',
  '[{"title":"Certyfikat terapeuty DBT","issuer":"Polskie Towarzystwo DBT","year":2021,"verified":true}]',
  'verified','2026-08-05T09:00:00Z','DEMO — profil fikcyjny.','published',1,'Europe/Warsaw',
  'Odwołanie bezpłatne do 24 godzin przed sesją.',24,
  '2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),

 -- Deliberately unpublished: must never appear in search, profile or slot results.
 ('th_0a1b2c3d4e5f60718293a4b5','hanna-testowa-demo','Hanna Testowa (DEMO, nieopublikowany)',
  'Profil roboczy — nie powinien być widoczny publicznie',
  'Ten profil istnieje wyłącznie po to, aby testy potwierdzały, że niepublikowane profile nie wyciekają przez API, MCP ani stronę WWW.',
  NULL,1,0,1,'["adults"]','["individual"]','[]',
  'unverified',NULL,'DEMO — profil roboczy do testów.','draft',1,'Europe/Warsaw','',24,
  '2026-05-01T10:00:00Z','2026-08-01T10:00:00Z');

INSERT INTO therapist_locations (id, therapist_id, city, city_norm, region, country, address_line, is_primary) VALUES
 ('loc_01','th_4f1a9c72e5b83d016a7c2e40','Warszawa','warszawa','mazowieckie','PL','ul. Przykładowa 1/2',1),
 ('loc_02','th_8b2d6e10f4a97c53d1e08b26','Kraków','krakow','małopolskie','PL','ul. Demonstracyjna 8',1),
 ('loc_04','th_1e07b8d3629af45c0d2e7a91','Gdańsk','gdansk','pomorskie','PL','al. Testowa 14',1),
 ('loc_05','th_7a4c2f9051d3e86b4f0a5c18','Wrocław','wroclaw','dolnośląskie','PL','ul. Fikcyjna 3',1),
 ('loc_06','th_5d8f3b6270e91a4c8b3d0f27','Poznań','poznan','wielkopolskie','PL','ul. Wzorcowa 21',1),
 ('loc_08','th_9f0b4d7382e6a15c7d2b8e34','Łódź','lodz','łódzkie','PL','ul. Próbna 5',1);

INSERT INTO therapist_languages (therapist_id, language_code) VALUES
 ('th_4f1a9c72e5b83d016a7c2e40','pl'),('th_4f1a9c72e5b83d016a7c2e40','en'),
 ('th_8b2d6e10f4a97c53d1e08b26','pl'),
 ('th_c93e5a4187b6f20d94a1c3f5','pl'),('th_c93e5a4187b6f20d94a1c3f5','en'),('th_c93e5a4187b6f20d94a1c3f5','uk'),
 ('th_1e07b8d3629af45c0d2e7a91','pl'),
 ('th_7a4c2f9051d3e86b4f0a5c18','pl'),('th_7a4c2f9051d3e86b4f0a5c18','de'),
 ('th_5d8f3b6270e91a4c8b3d0f27','pl'),
 ('th_2c6a9e50b8f14d73a0c5e829','pl'),('th_2c6a9e50b8f14d73a0c5e829','uk'),('th_2c6a9e50b8f14d73a0c5e829','ru'),
 ('th_9f0b4d7382e6a15c7d2b8e34','pl'),('th_9f0b4d7382e6a15c7d2b8e34','en'),
 ('th_0a1b2c3d4e5f60718293a4b5','pl');

INSERT INTO therapist_specialties (therapist_id, specialty_slug) VALUES
 ('th_4f1a9c72e5b83d016a7c2e40','lek'),('th_4f1a9c72e5b83d016a7c2e40','depresja'),('th_4f1a9c72e5b83d016a7c2e40','stres-zawodowy'),
 ('th_8b2d6e10f4a97c53d1e08b26','relacje'),('th_8b2d6e10f4a97c53d1e08b26','samoocena'),('th_8b2d6e10f4a97c53d1e08b26','zwiazki'),
 ('th_c93e5a4187b6f20d94a1c3f5','zwiazki'),('th_c93e5a4187b6f20d94a1c3f5','rodzicielstwo'),('th_c93e5a4187b6f20d94a1c3f5','relacje'),
 ('th_1e07b8d3629af45c0d2e7a91','uzaleznienia'),('th_1e07b8d3629af45c0d2e7a91','sen'),('th_1e07b8d3629af45c0d2e7a91','stres-zawodowy'),
 ('th_7a4c2f9051d3e86b4f0a5c18','trauma'),('th_7a4c2f9051d3e86b4f0a5c18','zaloba'),('th_7a4c2f9051d3e86b4f0a5c18','lek'),
 ('th_5d8f3b6270e91a4c8b3d0f27','zmiana-zyciowa'),('th_5d8f3b6270e91a4c8b3d0f27','samoocena'),('th_5d8f3b6270e91a4c8b3d0f27','zaloba'),
 ('th_2c6a9e50b8f14d73a0c5e829','migracja'),('th_2c6a9e50b8f14d73a0c5e829','lek'),('th_2c6a9e50b8f14d73a0c5e829','zmiana-zyciowa'),
 ('th_9f0b4d7382e6a15c7d2b8e34','neuroroznorodnosc'),('th_9f0b4d7382e6a15c7d2b8e34','lgbtq'),('th_9f0b4d7382e6a15c7d2b8e34','samoocena'),
 ('th_0a1b2c3d4e5f60718293a4b5','lek');

INSERT INTO therapist_modalities (therapist_id, modality_slug) VALUES
 ('th_4f1a9c72e5b83d016a7c2e40','poznawczo-behawioralna'),
 ('th_8b2d6e10f4a97c53d1e08b26','psychodynamiczna'),
 ('th_c93e5a4187b6f20d94a1c3f5','systemowa'),
 ('th_1e07b8d3629af45c0d2e7a91','act'),('th_1e07b8d3629af45c0d2e7a91','poznawczo-behawioralna'),
 ('th_7a4c2f9051d3e86b4f0a5c18','schematu'),('th_7a4c2f9051d3e86b4f0a5c18','emdr'),
 ('th_5d8f3b6270e91a4c8b3d0f27','gestalt'),
 ('th_2c6a9e50b8f14d73a0c5e829','integracyjna'),
 ('th_9f0b4d7382e6a15c7d2b8e34','dbt'),('th_9f0b4d7382e6a15c7d2b8e34','poznawczo-behawioralna'),
 ('th_0a1b2c3d4e5f60718293a4b5','integracyjna');

INSERT INTO session_offers (id, therapist_id, title, session_type, mode, duration_minutes, price_minor, currency, active, created_at, updated_at) VALUES
 ('of_01','th_4f1a9c72e5b83d016a7c2e40','Sesja indywidualna online','individual','online',50,22000,'PLN',1,'2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('of_02','th_4f1a9c72e5b83d016a7c2e40','Sesja indywidualna w gabinecie','individual','in_person',50,25000,'PLN',1,'2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('of_03','th_8b2d6e10f4a97c53d1e08b26','Sesja indywidualna w gabinecie','individual','in_person',50,20000,'PLN',1,'2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('of_04','th_8b2d6e10f4a97c53d1e08b26','Terapia pary w gabinecie','couples','in_person',80,32000,'PLN',1,'2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('of_05','th_c93e5a4187b6f20d94a1c3f5','Terapia pary online','couples','online',80,30000,'PLN',1,'2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('of_06','th_c93e5a4187b6f20d94a1c3f5','Konsultacja rodzinna online','family','online',80,34000,'PLN',1,'2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('of_07','th_1e07b8d3629af45c0d2e7a91','Sesja indywidualna online','individual','online',50,18000,'PLN',1,'2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('of_08','th_7a4c2f9051d3e86b4f0a5c18','Sesja indywidualna online','individual','online',50,24000,'PLN',1,'2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('of_09','th_7a4c2f9051d3e86b4f0a5c18','Sesja EMDR w gabinecie','individual','in_person',80,32000,'PLN',1,'2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('of_10','th_5d8f3b6270e91a4c8b3d0f27','Sesja indywidualna w gabinecie','individual','in_person',50,17000,'PLN',1,'2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('of_11','th_2c6a9e50b8f14d73a0c5e829','Sesja indywidualna online','individual','online',50,15000,'PLN',1,'2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('of_12','th_9f0b4d7382e6a15c7d2b8e34','Sesja indywidualna online','individual','online',50,21000,'PLN',1,'2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('of_13','th_9f0b4d7382e6a15c7d2b8e34','Sesja indywidualna w gabinecie','individual','in_person',50,23000,'PLN',1,'2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('of_14','th_0a1b2c3d4e5f60718293a4b5','Sesja indywidualna online','individual','online',50,19000,'PLN',1,'2026-05-01T10:00:00Z','2026-08-01T10:00:00Z');

INSERT INTO faq_items (id, therapist_id, question, answer, category, position, status, approved_by, approved_at, created_at, updated_at) VALUES
 ('faq_01','th_4f1a9c72e5b83d016a7c2e40','Jak wygląda pierwsze spotkanie?','Pierwsza sesja trwa 50 minut i służy poznaniu się. Pytam, z czym przychodzisz i czego oczekujesz, opowiadam jak pracuję. Na koniec ustalamy, czy chcemy kontynuować. Nie stawiam diagnozy na pierwszym spotkaniu.','first_session',1,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_02','th_4f1a9c72e5b83d016a7c2e40','W jakim nurcie pracujesz?','Pracuję w nurcie poznawczo-behawioralnym (CBT). Oznacza to konkretne cele, praca między sesjami i regularne sprawdzanie, czy terapia przynosi efekt.','modality',2,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_03','th_4f1a9c72e5b83d016a7c2e40','Jakie są zasady odwoływania wizyt?','Sesję można odwołać bezpłatnie do 24 godzin przed terminem. Odwołanie później albo nieobecność bez uprzedzenia oznacza pełną opłatę.','cancellation',3,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_04','th_4f1a9c72e5b83d016a7c2e40','Jak przygotować się do sesji online?','Potrzebne jest ciche miejsce, słuchawki i stabilne łącze. Link do spotkania wysyłam mailem dzień wcześniej. Jeśli połączenie zawiedzie, dzwonię telefonicznie.','online',4,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_05','th_4f1a9c72e5b83d016a7c2e40','Jakie formy płatności przyjmujesz?','Przelew na konto po sesji, w terminie 7 dni. Wystawiam rachunek na życzenie.','payment',5,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_06','th_4f1a9c72e5b83d016a7c2e40','Jak wygląda poufność i jakie ma granice?','Wszystko, co mówisz na sesji, jest objęte tajemnicą zawodową. Granice wyznacza prawo: obowiązek reakcji przy bezpośrednim zagrożeniu życia lub zdrowia oraz przy podejrzeniu krzywdzenia osoby małoletniej. O tym rozmawiamy na pierwszym spotkaniu.','confidentiality',6,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_07','th_4f1a9c72e5b83d016a7c2e40','Czy pracujesz z parami?','Nie. Prowadzę wyłącznie terapię indywidualną osób dorosłych.','scope',7,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_08','th_4f1a9c72e5b83d016a7c2e40','Czy prowadzisz terapię dzieci?','ROBOCZA ODPOWIEDŹ — NIE ZATWIERDZONA. Ten wpis ma status draft i nie może być zwrócony przez API ani MCP.','scope',8,'draft',NULL,NULL,'2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_09','th_8b2d6e10f4a97c53d1e08b26','Jak wygląda pierwsze spotkanie?','Pierwsze dwa lub trzy spotkania to konsultacje. Rozmawiamy o tym, co Cię sprowadza i o Twojej historii. Dopiero potem proponuję formę i częstotliwość pracy.','first_session',1,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_10','th_8b2d6e10f4a97c53d1e08b26','W jakim nurcie pracujesz?','W nurcie psychodynamicznym. Pracujemy nad tym, co powtarza się w Twoich relacjach i jakie znaczenie mają wcześniejsze doświadczenia.','modality',2,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_11','th_8b2d6e10f4a97c53d1e08b26','Jakie są zasady odwoływania wizyt?','Termin jest zarezerwowany na stałe. Odwołanie później niż 48 godzin przed sesją oznacza opłatę.','cancellation',3,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_12','th_8b2d6e10f4a97c53d1e08b26','Czy gabinet jest dostępny dla osób z niepełnosprawnością ruchową?','Gabinet znajduje się na parterze, bez progów. W budynku nie ma windy, ale wejście jest z poziomu ulicy.','accessibility',4,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_13','th_c93e5a4187b6f20d94a1c3f5','Jak wygląda pierwsze spotkanie pary?','Pierwsze spotkanie trwa 80 minut i uczestniczą w nim obie osoby. Pytam każdą z osobna, jak widzi sytuację, i ustalamy wspólny cel pracy.','first_session',1,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_14','th_c93e5a4187b6f20d94a1c3f5','Czy pracujesz z rodzinami?','Tak. Prowadzę konsultacje rodzinne online, także z udziałem nastolatków od 13 roku życia, zawsze za zgodą opiekunów.','scope',2,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_15','th_c93e5a4187b6f20d94a1c3f5','Jak przygotować się do sesji online?','Potrzebne są dwa osobne urządzenia albo jedno wspólne — ustalamy to przed pierwszą sesją. Ważne, żeby obie osoby miały prywatność w trakcie rozmowy.','online',3,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_16','th_1e07b8d3629af45c0d2e7a91','Jak wygląda pierwsze spotkanie?','Pierwsza sesja to konsultacja: sprawdzamy, czy moja forma pracy odpowiada temu, czego szukasz. Jeśli nie, polecam kogoś innego.','first_session',1,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_17','th_1e07b8d3629af45c0d2e7a91','Czy przyjmujesz nowe osoby?','W tej chwili nie mam wolnych miejsc na stałą współpracę. Terminy widoczne w kalendarzu dotyczą wyłącznie konsultacji jednorazowych.','availability',2,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_18','th_7a4c2f9051d3e86b4f0a5c18','Jak wygląda pierwsze spotkanie?','Pierwsze spotkanie służy zebraniu informacji i zbudowaniu poczucia bezpieczeństwa. Nie proszę o opowiadanie trudnych doświadczeń w szczegółach na starcie.','first_session',1,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_19','th_7a4c2f9051d3e86b4f0a5c18','Czym jest EMDR?','EMDR to metoda pracy z trudnymi wspomnieniami wykorzystująca stymulację bilateralną. Stosuję ją dopiero wtedy, gdy mamy wypracowane sposoby radzenia sobie z napięciem.','modality',2,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_20','th_7a4c2f9051d3e86b4f0a5c18','Jakie są zasady odwoływania wizyt?','Bezpłatne odwołanie do 48 godzin przed sesją.','cancellation',3,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_21','th_5d8f3b6270e91a4c8b3d0f27','Jak wygląda pierwsze spotkanie?','Rozmawiamy o tym, co dzieje się teraz w Twoim życiu. W Gestalt pracujemy dużo z tym, co pojawia się tu i teraz, w kontakcie.','first_session',1,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_22','th_5d8f3b6270e91a4c8b3d0f27','Jakie formy płatności przyjmujesz?','Gotówka lub przelew, płatność po każdej sesji.','payment',2,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_23','th_2c6a9e50b8f14d73a0c5e829','W jakich językach prowadzisz sesje?','Po polsku, ukraińsku i rosyjsku. Możesz zmieniać język w trakcie rozmowy, jeśli tak jest Ci łatwiej.','language',1,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_24','th_2c6a9e50b8f14d73a0c5e829','Jak wygląda pierwsze spotkanie?','Pierwsza sesja trwa 50 minut. Pytam o Twoją obecną sytuację i o to, czego potrzebujesz. Nie musisz opowiadać wszystkiego od razu.','first_session',2,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_25','th_9f0b4d7382e6a15c7d2b8e34','Jak wygląda pierwsze spotkanie?','Pierwsze spotkanie to rozmowa o tym, co Cię sprowadza, i o tym, jak wygląda Twój dzień. Pytam też, jakie dostosowania są dla Ciebie pomocne — na przykład kamera wyłączona, przerwy, notatki na piśmie.','first_session',1,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_26','th_9f0b4d7382e6a15c7d2b8e34','Czy pracujesz z osobami LGBTQ+?','Tak. Przyjmuję osoby LGBTQ+ i nie traktuję orientacji ani tożsamości płciowej jako problemu do leczenia.','scope',2,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z'),
 ('faq_27','th_9f0b4d7382e6a15c7d2b8e34','Jak wygląda poufność i jakie ma granice?','Obowiązuje mnie tajemnica zawodowa. Wyjątki wynikają z prawa: bezpośrednie zagrożenie życia lub zdrowia oraz podejrzenie krzywdzenia osoby małoletniej.','confidentiality',3,'published','seed','2026-08-01T10:00:00Z','2026-05-01T10:00:00Z','2026-08-01T10:00:00Z');

-- Open slots for the next three weeks, weekdays only. Generated relative to
-- `now` so the demo data never goes stale. Each offer of the same therapist
-- gets its own hour lane, which keeps UNIQUE(therapist_id, starts_at_utc) safe.
--
-- These hours are UTC: SQLite has no IANA database, so the seed cannot do the
-- local-wall-clock conversion the admin panel does. The displayed local hour of
-- demo slots therefore shifts by one across a DST change. That is acceptable for
-- fictional data; real availability is created through the panel, which builds
-- slots from the therapist's local wall clock (see `zonedTimeToUtc`).
INSERT INTO appointment_slots
  (id, therapist_id, offer_id, starts_at_utc, ends_at_utc, timezone, status, created_at, updated_at)
WITH RECURSIVE
  days(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM days WHERE n < 21),
  hours(h) AS (VALUES (8),(10),(12),(14),(16)),
  lanes AS (
    SELECT o.id AS offer_id, o.therapist_id, o.duration_minutes,
           ROW_NUMBER() OVER (PARTITION BY o.therapist_id ORDER BY o.id) - 1 AS lane
    FROM session_offers o
    JOIN therapists t ON t.id = o.therapist_id
    WHERE o.active = 1 AND t.is_demo = 1 AND t.status = 'published'
  )
SELECT
  'sl_' || lower(hex(randomblob(12))),
  l.therapist_id,
  l.offer_id,
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+' || d.n || ' days', '+' || (h.h + l.lane) || ' hours'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now', 'start of day', '+' || d.n || ' days', '+' || (h.h + l.lane) || ' hours', '+' || l.duration_minutes || ' minutes'),
  'Europe/Warsaw',
  'open',
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM lanes l, days d, hours h
WHERE CAST(strftime('%w', 'now', 'start of day', '+' || d.n || ' days') AS INTEGER) BETWEEN 1 AND 5
  -- leave realistic gaps in the demo calendar
  AND ((d.n * 7 + h.h + l.lane) % 5) <> 0;

UPDATE therapists SET photo_url = (
  SELECT p.photo_url FROM _seed_photos p WHERE p.id = therapists.id
) WHERE id IN (SELECT id FROM _seed_photos);
DROP TABLE _seed_photos;
INSERT INTO therapist_media SELECT * FROM _seed_media;
DROP TABLE _seed_media;

-- Układ i treść stron demo mieszkają w usłudze stron (x402landings.space),
-- nie w tej bazie; scripts/pages-migrate.mjs przeniósł je tam 2026-09-03.
