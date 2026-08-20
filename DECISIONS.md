# Decyzje projektowe

Data przeglądu dokumentacji źródłowej: **2026-08-19**.

## 1. Różnice względem założeń promptu (po sprawdzeniu aktualnej dokumentacji)

### 1.1. `createMcpHandler()` bierzemy z SDK, nie z pakietu `agents`

Prompt wskazywał `createMcpHandler()` z dokumentacji Cloudflare i zakazywał
przestarzałego `McpAgent`. Aktualna dokumentacja Cloudflare
(`/agents/model-context-protocol/protocol/transport/`) rzeczywiście mówi
„Use `createMcpHandler` for a new stateless server” i „Do not use [`McpAgent`] for
a new server”.

Sprawdzenie kodu: `agents@0.21.0` eksportuje `createMcpHandler` jako alias
`createStatelessMcpHandler` — cienką nakładkę na `createMcpHandler` z pakietu
`@modelcontextprotocol/server@2.0.0`, dodającą walidację `Host`/`Origin`, CORS
i dopasowanie ścieżki.

**Decyzja:** używamy `createMcpHandler` bezpośrednio z `@modelcontextprotocol/server`,
a walidację `Host`/`Origin` robimy jawnie eksportowanymi z tego samego pakietu
funkcjami `hostHeaderValidationResponse()` i `originValidationResponse()`.

**Dlaczego:** identyczne zachowanie transportu, o jedną dużą zależność mniej
(`agents` ciągnie za sobą warstwę Durable Objects i klienta MCP, z których nic
nie używamy), a walidacja hostów jest widoczna w `src/index.ts` zamiast schowana
w konfiguracji.

### 1.2. Nowy podział pakietów SDK (MCP TypeScript SDK v2)

`@modelcontextprotocol/sdk@1.x` został rozbity na `@modelcontextprotocol/core`,
`/server`, `/client`. Używamy `@modelcontextprotocol/server@2.0.0`, który daje nam
gotowe: `McpServer`, `createMcpHandler`, `verifyBearerToken`,
`bearerAuthChallengeResponse`, `oauthMetadataResponse`,
`getOAuthProtectedResourceMetadataUrl`, `hostHeaderValidationResponse`,
`originValidationResponse`. Dzięki temu nie piszemy własnych dokumentów RFC 9728 /
RFC 8414 ani własnego parsera nagłówka `Authorization`.

SDK v2 wymaga `zod@^4.2`; projekt jest przypięty do `zod@4.4.3`.

### 1.3. `_meta` widżetu: stała MIME i alias zgodności

Aktualna dokumentacja MCP Apps podaje `text/html;profile=mcp-app` jako typ zasobu UI
oraz `_meta.ui.resourceUri` jako właściwe powiązanie, z `_meta["openai/outputTemplate"]`
jako aliasem zgodności dla ChatGPT. Ustawiamy **oba**, a dodatkowo
`_meta.ui.prefersBorder`, `_meta.ui.csp` oraz
`_meta["openai/toolInvocation/invoking"|"invoked"]`.

### 1.4. Koperta danych widżetu jest w `structuredContent`, nie w `_meta`

Rozważaliśmy przekazanie danych do widżetu w `_meta`, aby nie duplikować ich w
kontekście modelu. Host dostarcza jednak widżetowi **wynik narzędzia**
(w ChatGPT: `window.openai.toolOutput` = `structuredContent`), więc koperta
`{ view, title, data, generated_at, item_count }` jest zwracana jako
`structuredContent` narzędzia renderującego. Sam widżet i tak traktuje ją jako
dane niezaufane.

### 1.5. PKCE tylko S256

Dokumentacja OpenAI mówi wprost: serwer, którego metadane nie zawierają `S256`
w `code_challenge_methods_supported`, nie jest obsługiwany. U nas S256 to nie tylko
deklaracja — `code_challenge_method` inny niż `S256` jest odrzucany (także przez
`CHECK` w schemacie `oauth_auth_codes`).

## 2. Decyzje architektoniczne

### 2.1. Własny serwer autoryzacji zamiast zewnętrznego dostawcy

Rezerwacja wymaga konta, ale konto ma sens tylko wewnątrz tego produktu.
Zewnętrzny IdP oznaczałby przekazywanie mu informacji o tym, kto szuka terapeuty —
czyli dokładnie ten sygnał, którego nie chcemy nikomu udostępniać.

Logowanie jest bezhasłowe (kod jednorazowy e-mail): nie ma hasła do wycieku ani
do ponownego użycia w innym serwisie. Interfejs dostawcy poczty jest wymienialny
(`NotificationProvider`).

**Konsekwencja:** dostępność logowania zależy od dostawcy poczty. Na produkcji
Worker odmawia startu, jeśli dostawca nie jest skonfigurowany.

### 2.2. Tokeny nieprzezroczyste zamiast JWT

Nie potrzebujemy weryfikacji offline — resource server i authorization server to
ten sam Worker z tą samą bazą. Tokeny nieprzezroczyste dają natychmiastowe
unieważnienie (ważne przy `booking:write`) i nie wymagają JWKS ani rotacji kluczy
podpisu. W bazie leży wyłącznie HMAC tokenu.

### 2.3. Ranking w TypeScript, wykluczenia w SQL

Twarde wykluczenia muszą działać w bazie — inaczej „limit 200 kandydatów” mógłby
uciąć pasujący profil. Punktacja działa na już odfiltrowanym zbiorze, w czystej,
testowalnej funkcji. Gdyby liczba profili urosła znacząco ponad kilkaset na zapytanie,
pierwszym krokiem jest przeniesienie punktacji do SQL — nie zmiana reguł.

`// ponytail: ranking na maks. 200 kandydatach; przy większym katalogu przenieść punktację do SQL`

### 2.4. Durable Object **i** ograniczenie w bazie

Sam Durable Object wystarczyłby, gdyby każdy zapis szedł przez niego. Sam unikalny
indeks też by wystarczył. Mamy oba, bo to dwie różne klasy błędów: DO chroni przed
wyścigiem, indeks chroni przed pominięciem DO. Test „dwa równoległe bookingi”
sprawdza wynik, nie mechanizm.

Wewnątrz DO krytyczna sekcja jest serializowana łańcuchem obietnic, bo handler
`fetch` Durable Object może się przepleść na `await`.

`// ponytail: łańcuch obietnic per instancja DO; przy dużym ruchu jednego terapeuty rozważyć kolejkę z limitem`

### 2.5. Outbox powiadomień zamiast wysyłki w transakcji

Wymaganie „nieudany e-mail nie może zepsuć rezerwacji ani spowodować podwójnej”
prowadzi wprost do outboxu. Wiersz zawiera adresata, więc jest szyfrowany.
Ponawianie: 60 s, 5 min, 15 min, 1 h, 3 h, 6 h — sześć prób, potem status `failed`.

### 2.6. Strona WWW bez JavaScriptu

Katalog, filtry i cały panel są renderowane po stronie serwera. Dzięki temu CSP nie
potrzebuje `unsafe-inline` ani nonce'ów, strona działa przy wyłączonym JS, a jedyny
zewnętrzny skrypt (Turnstile) pojawia się wyłącznie na stronach z formularzem.

Testuje to `e2e/site.spec.ts` (kontekst z `javaScriptEnabled: false`).

### 2.7. Widżet jako jeden samowystarczalny plik

`scripts/build-widget.mjs` buduje React esbuildem i wkleja JS oraz CSS do jednego
dokumentu HTML zapisanego jako `src/widget/generated.ts`. Powody: `connectDomains`
i `resourceDomains` mogą zostać puste, nie ma żadnego zewnętrznego fontu ani skryptu,
a bundle jest tym samym artefaktem w testach i w produkcji.

### 2.8. Token potwierdzenia podpisany, nie zapisany

`preview_booking` nie tworzy żadnego wiersza. Token to HMAC nad ładunkiem
zawierającym wyłącznie identyfikatory i warunki handlowe (bez PII), ważny maksymalnie
10 minut. Podgląd nie może więc zablokować terminu ani zaśmiecić bazy, a `create_booking`
i tak weryfikuje wszystko ponownie w bazie — token jest dowodem, że użytkownikowi
pokazano konkretne warunki, a nie źródłem prawdy.

### 2.9. CSRF wyprowadzany z sekretu sesji

Zamiast przechowywać token CSRF, liczymy `HMAC(klucz, "csrf:" + sekret_sesji)`.
Atakujący, który nie odczyta ciasteczka `HttpOnly`, nie wyliczy tokenu. Kolumna
`admin_sessions.csrf_hash` pozostaje w schemacie (pusta) i zostanie usunięta przy
najbliższej migracji porządkowej.

### 2.10. Sanityzacja przy zapisie **i** ucieczka przy renderowaniu

Treści terapeutów przechodzą przez `sanitizeRichText()` przy zapisie (usunięcie
znaków niewidocznych, neutralizacja markerów prompt injection) i przez `escapeHtml()`
przy każdym renderowaniu. Sanityzacja przy zapisie sama w sobie nie jest zabezpieczeniem
XSS — jest nim ucieczka. Sanityzacja chroni przed treścią, którą recenzent-człowiek
mógłby przeoczyć.

Neutralizacja prompt injection jest ograniczeniem ryzyka, **nie gwarancją**.
Właściwym zabezpieczeniem jest to, że treść terapeuty nigdy nie ma uprawnień:
nie może wywołać narzędzia, nie może zmienić zakresu tokenu i nie może zapisać
niczego w bazie.

### 2.11. Generowanie terminów w strefie terapeuty

Terapeuta pracuje w zegarze ściennym, nie w UTC. Panel przyjmuje **lokalną datę
i lokalną godzinę**, a dopiero potem wyznacza chwilę UTC, którą one oznaczają
(`zonedTimeToUtc` w `src/lib/time.ts`). „10:00 w Europe/Warsaw” zostaje 10:00 po
obu stronach zmiany czasu, choć zapisany instant UTC przesuwa się o godzinę.

Offset czytamy z bazy stref samego runtime'u przez `Intl.DateTimeFormat`
(`formatToParts`), więc nie wozimy ze sobą żadnej biblioteki dat ani własnej
kopii reguł DST. Konwersja robi dwa przebiegi: pierwszy używa offsetu w chwili
naiwnej, drugi — offsetu w chwili już wyznaczonej. To ten drugi przebieg sprawia,
że godzina po drugiej stronie przejścia trafia we właściwe miejsce.

Iteracja po dniach też jest kalendarzowa, nie milisekundowa (`addCivilDays`),
a dzień tygodnia liczony jest lokalnie (`weekdayIn`) — inaczej „pomijamy weekendy”
oznaczałoby weekendy w UTC.

Przypadki brzegowe są udokumentowane, nie ukryte: godzina z „luki wiosennej”
(np. 02:30 w dniu przeskoku 02:00→03:00) nie istnieje lokalnie i rozwiązuje się
na chwilę godzinę później; godzina niejednoznaczna jesienią rozwiązuje się na
pierwsze (przed przejściem) wystąpienie. Oba zachowania mają testy.

Nieznana strefa jest **odrzucana** (HTTP 400), nie podmieniana po cichu na
domyślną. Domyślną wartością formularza jest strefa z profilu terapeuty.

### 2.12. Rate limiting z natywnego bindingu Cloudflare

Zamiast własnego licznika w D1 lub Durable Object używamy bindingów `ratelimits`
z `wrangler.jsonc`: `RL_PUBLIC` (120/min per IP dla `/mcp`), `RL_WRITE` (10/min per
użytkownik dla `create_booking` i `cancel_booking`), `RL_AUTH` (8/min per IP dla
logowania i rejestracji klientów). Zero kodu, zero stanu do utrzymania.

### 2.13. Zachowanie w kryzysie realizowane instrukcjami serwera, nie klasyfikacją

Serwer **nie dostaje** transkryptu, więc nie może i nie powinien wykrywać kryzysu.
Zamiast tego:

- `instructions` serwera MCP nakazują modelowi wywołać `get_crisis_resources`
  zamiast zwykłego dopasowania, gdy rozmowa wskazuje na zagrożenie;
- opis `get_crisis_resources` powtarza ten warunek;
- każda odpowiedź `search_therapists` niesie `disclaimer`, a każdy widok widżetu —
  stałą informację o granicach usługi i numerach 112 / 116 123.

Świadoma konsekwencja: skuteczność tej ścieżki zależy od modelu klienta.
Jest to ryzyko wymagające konsultacji klinicznej i testów akceptacyjnych przed
publikacją — patrz `DPIA_CHECKLIST.md`.

### 2.14. Brak ścieżki dla osób poniżej 18 lat

MVP jest dla osób pełnoletnich. Dla `audience: "minor"` zwracamy osobne zasoby
(116 111) i jawnie informujemy, że rezerwacja nie jest dostępna. Zaprojektowanie
ścieżki opiekuna wymaga oceny prawnej — nie zgadujemy jej w kodzie.

### 2.15. Brak płatności

Rozliczenie jest bezpośrednio między pacjentem a terapeutą. Wprowadzenie płatności
oznaczałoby nowego procesora danych, obowiązki rozliczeniowe i zwrotowe — poza
zakresem MVP.

## 3. Wybory technologiczne

| Wybór | Alternatywa | Dlaczego tak |
| --- | --- | --- |
| Hono | własny router | routing + parsowanie formularzy w kilku kB, bez runtime'u Node |
| Zod 4 | walidacja ręczna | SDK MCP przyjmuje Standard Schema wprost i sam generuje JSON Schema dla `tools/list` |
| esbuild | Vite | potrzebny jest jeden bundle IIFE bez dev-servera |
| TypeScript 6.0 | TypeScript 7 | 7.0 nie jest jeszcze wspierany przez `typescript-eslint@8` |
| Vitest + `@cloudflare/vitest-pool-workers` | Node + mocki | testy działają na prawdziwym D1 i prawdziwym Durable Object; test wyścigu bookingów nie miałby sensu na mockach |
| Playwright z `channel: 'chrome'` | pobierana przeglądarka Playwright | używa lokalnie zainstalowanego Chrome, bez 300 MB pobierania w CI dewelopera |
| SVG generowane w kodzie jako avatary demo | zdjęcia stockowe | żadne zdjęcie nie może sugerować realnej osoby ani przedstawiać cierpienia |

## 4. Znane długi techniczne

| Miejsce | Ograniczenie | Kiedy naprawić |
| --- | --- | --- |
| `src/matching/rank.ts` | punktacja na maks. 200 kandydatach z SQL | gdy katalog przekroczy kilkaset profili na zapytanie |
| `migrations/0002_auth.sql` | kolumna `admin_sessions.csrf_hash` nieużywana (token CSRF jest wyprowadzany) | przy najbliższej migracji porządkowej |
| `src/web/admin.ts` — pola JSON | `session_types`, `age_groups`, `credentials` edytowane jako surowy JSON | gdy z panelu zaczną korzystać terapeuci, a nie tylko zespół |
| `seed/seed.sql` | pojedyncze `;` na końcu linii są kontraktem dla `test/setup.ts` | przy przejściu na parser SQL zamiast dzielenia po `;\n` |
| `seed/seed.sql` — godziny slotów | SQLite nie ma bazy IANA, więc dane demonstracyjne są liczone w UTC i przesuwają się o godzinę po zmianie czasu | tylko jeśli seed miałby kiedykolwiek trafić poza demo |

## 5. Czego świadomie NIE zrobiliśmy

- **Nie ma płatnego rankingu ani promowanych profili** — w schemacie nie ma pola,
  które mogłoby to wyrazić.
- **Nie ma trackerów, analityki zewnętrznej ani fontów z CDN.**
- **Nie ma automatycznej kwalifikacji klinicznej** — żadne narzędzie nie przyjmuje
  ani nie zwraca oceny stanu zdrowia.
- **Nie twierdzimy, że rozwiązanie jest „zgodne z RODO”.** Kod realizuje szereg
  wymagań technicznych; ocena zgodności należy do prawnika i wymaga DPIA
  (`DPIA_CHECKLIST.md`).
