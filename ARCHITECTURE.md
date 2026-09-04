# Architektura i decyzje — Otwarty Terapeuta

Jak to działa i dlaczego akurat tak. Każda sekcja trzyma razem mechanizm
i uzasadnienie — rozdzielone żyły osobno i się rozjeżdżały.

Czego tu nie ma: listy tabel (`migrations/*.sql`), listy testów (nazwy `it()`
w `test/` i `e2e/`), listy blokerów wydania (`DPIA_CHECKLIST.md` §11).

## 1. Widok z lotu ptaka

Jeden Worker Cloudflare obsługuje trzy powierzchnie:

```
                    ┌──────────────────────────────────────────┐
   przeglądarka ───▶│  /  /terapeuci  /admin  /oauth/*         │  HTML, ścisły CSP
                    │                                          │
   ChatGPT / MCP ──▶│  /mcp  (Streamable HTTP, bezstanowy)     │  JSON-RPC
                    │  /.well-known/oauth-*                    │  RFC 9728 / RFC 8414
                    └───────────────┬──────────────────────────┘
                                    │
             ┌──────────────────────┼───────────────────────┐
             ▼                      ▼                       ▼
        Cloudflare D1        Durable Object            Cloudflare R2
    (katalog, FAQ, terminy,  TherapistBookingCoordinator   (zdjęcia
     rezerwacje, OAuth,      — serializacja rezerwacji      profilowe)
     zgody, audyt, outbox)     per therapist_id
```

Dodatkowo: Turnstile (formularze publiczne), bindingi rate limit (`RL_PUBLIC`,
`RL_WRITE`, `RL_AUTH`) i cron co 5 minut (ponawianie powiadomień + czyszczenie
wygasłego stanu autoryzacji).

**Bezstanowość dotyczy transportu.** `createMcpHandler()` tworzy świeżą instancję
`McpServer` na każde żądanie HTTP. Stan biznesowy żyje wyłącznie w D1, a
współbieżność rezerwacji rozstrzyga Durable Object plus ograniczenie w bazie.

## 2. Przepływ danych: od rozmowy do rezerwacji

```
1. ChatGPT zbiera kryteria          (forma, miasto, język, budżet, dostępność,
                                     grupa wiekowa, obszary pracy ze słownika)
2. search_therapists(filtry)        ── serwer NIE dostaje transkryptu
        │
        ├── SQL: twarde wykluczenia (opublikowany, grupa wiekowa, język, tryb, dostępność)
        └── TS:  ranking deterministyczny + match_reasons z jawnych pól
3. get_therapist_profile / get_therapist_faq       (tylko treści zatwierdzone)
4. list_available_slots                            (+ fresh_until_utc)
5. preview_booking   -> pełne podsumowanie + podpisany confirmation_token (≤10 min)
6. UŻYTKOWNIK POTWIERDZA                            ← jedyny moment decyzji
7. create_booking    -> weryfikacja tokenu, właściciela, ceny i dostępności
        │
        ├── Durable Object (klucz: therapist_id) serializuje próby
        ├── D1 batch: slot → 'booked', INSERT bookings, INSERT idempotency
        ├── UNIQUE INDEX ... WHERE status='confirmed'   ← ostatnia linia obrony
        └── outbox: e-mail potwierdzający (poza transakcją)
8. autorytatywny status + link do zarządzania rezerwacją
```

## 3. Model danych (D1)

Lista tabel i kolumn: `migrations/*.sql`, czytane po kolei. Ten dokument jej nie
powtarza — duplikat rozjeżdżał się z każdą migracją. Poniżej tylko to, czego
z samego DDL nie widać.

| Zasada | Realizacja |
| --- | --- |
| Identyfikatory nieprzewidywalne | `th_`/`sl_`/`bk_`/`usr_` + 24 znaki hex z CSPRNG |
| Publiczne adresy czytelne | `therapists.slug`, `bookings.public_ref` (`OT-XXXXXX`) |
| Czas w UTC, strefa osobno | `starts_at_utc` + `timezone` (IANA) — patrz §3.1 |
| Ceny w najmniejszych jednostkach | `price_minor` (grosze) + `currency` |
| Jawne statusy | `therapists.status`, `faq_items.status`, `appointment_slots.status`, `bookings.status` |
| Jeden aktywny booking na slot | `CREATE UNIQUE INDEX idx_bookings_one_active_per_slot ON bookings(slot_id) WHERE status='confirmed'` |
| Soft delete tam, gdzie potrzebny audyt | `therapists.deleted_at`, `users.deleted_at` — filtrowane w każdym publicznym zapytaniu |
| Dane kontaktowe szyfrowane | AES-256-GCM (Web Crypto), klucz w sekrecie `PII_ENC_KEY` |
| Brak danych zdrowotnych | schemat nie ma miejsca na notatki z sesji, diagnozy ani transkrypty |

Jedno wyzwanie e-mailowe obsługuje trzy powierzchnie: panel, zgodę OAuth
i rejestrację terapeuty (`login_challenges.purpose`, dane tymczasowe w `context`).
Cała logika w `src/auth/challenge.ts` — wcześniej były trzy kopie i osobna tabela.

### 3.1. Czas: terapeuta pracuje w zegarze ściennym, nie w UTC

Panel przyjmuje **lokalną datę i lokalną godzinę**, dopiero potem wyznacza chwilę
UTC, którą one oznaczają (`zonedTimeToUtc` w `src/lib/time.ts`). „10:00 w
Europe/Warsaw” zostaje 10:00 po obu stronach zmiany czasu, choć zapisany instant
UTC przesuwa się o godzinę.

Offset czytamy z bazy stref samego runtime'u przez `Intl.DateTimeFormat`
(`formatToParts`) — żadnej biblioteki dat ani własnej kopii reguł DST. Konwersja
robi dwa przebiegi: pierwszy używa offsetu w chwili naiwnej, drugi — offsetu
w chwili już wyznaczonej. Ten drugi przebieg sprawia, że godzina po drugiej
stronie przejścia trafia we właściwe miejsce.

Iteracja po dniach jest kalendarzowa, nie milisekundowa (`addCivilDays`), a dzień
tygodnia liczony lokalnie (`weekdayIn`) — inaczej „pomijamy weekendy” oznaczałoby
weekendy w UTC.

Przypadki brzegowe udokumentowane, nie ukryte: godzina z luki wiosennej (02:30
w dniu przeskoku 02:00→03:00) nie istnieje lokalnie i rozwiązuje się na chwilę
godzinę później; godzina niejednoznaczna jesienią rozwiązuje się na pierwsze
(przed przejściem) wystąpienie. Oba mają testy. Nieznana strefa jest **odrzucana**
(HTTP 400), nigdy podmieniana po cichu.

## 4. Katalog: projekcja publiczna i ranking

Cały odczyt publiczny przechodzi przez `src/db/catalog.ts`. `toPublicTherapist()`
jest jedynym miejscem, w którym wiersz bazy staje się obiektem widocznym na
zewnątrz, a jej typ zwracany (`PublicTherapist`) **nie zawiera** pól
`verification_notes` ani `contact_email_enc`. Dodanie prywatnej kolumny w
przyszłości nie wycieknie więc przez rozpakowanie wiersza.

### Ranking

`src/matching/rank.ts`, funkcja czysta i deterministyczna dla trójki
`(profile, filtry, dayKey)`.

1. **Wykluczenia** — w SQL: profil opublikowany, grupa wiekowa, język (wszystkie
   żądane), tryb, dostępność, przedział cen. Nic z dalszych kroków nie może
   przywrócić wykluczonego profilu.
2. **Zgodność obszarów pracy** — waga 1000 na trafienie (dominuje).
3. **Logistyka** — nurt, typ spotkania, język, miasto, tryb, przedział cen.
4. **Najbliższa dostępność** — bonus malejący liniowo do 21 dni, ograniczony do
   100 punktów, więc nigdy nie przebija realnego dopasowania obszarów.
5. **Tie-breaker** — FNV-1a z `("YYYY-MM-DD" + therapist_id)`, czyli dzienna
   rotacja. Zero czynników komercyjnych; nie ma pola „promowany”.

**Dlaczego wykluczenia w SQL, a punktacja w TS:** twarde wykluczenia muszą działać
w bazie, inaczej limit 200 kandydatów mógłby uciąć pasujący profil. Punktacja
działa na już odfiltrowanym zbiorze, w czystej, testowalnej funkcji. Gdyby katalog
urósł znacząco ponad kilkaset profili na zapytanie, pierwszym krokiem jest
przeniesienie punktacji do SQL — nie zmiana reguł.

`match_reasons` powstają wyłącznie z pól obecnych w tej samej odpowiedzi, więc
model może je zacytować, a użytkownik zweryfikować.

### 4.1. Strony terapeutek

Profil i podstrony są stronami w usłudze `x402Landings`, a nie renderami tego
Workera. `ot-02` przekazuje tam dane jako bloki i dane ramy strony; usługa
przechowuje strony, edytor, hosting i motywy jako wgrywane pliki. Szczegóły,
endpointy oraz zachowanie podczas awarii opisuje `X402_LANDINGS_INTEGRATION.md`.

### 4.2. Jedyna statystyka, jaką prowadzimy

`profile_views`: agregat dobowy (profil, dzień, źródło) z licznikiem odsłon,
zapisywany przy renderowaniu profilu na stronie i przy `get_therapist_profile`
w MCP. Bez adresu IP, bez nagłówka przeglądarki, bez ciasteczka i bez
identyfikatora osoby — z tej tabeli nie da się odtworzyć, kto oglądał, tylko ile
razy oglądano. Terapeutka widzi liczbę dla własnego profilu w panelu, retencja
kasuje wiersze po 24 miesiącach.

Zapis idzie prosto do D1 jednym UPSERT-em na odsłonę i przy tej skali to
wystarcza. Gdyby ruch urósł do tysięcy odsłon na minutę, właściwym miejscem jest
Analytics Engine, a ta tabela zostaje jako agregat dobowy.

Czego świadomie nie ma: Cloudflare Web Analytics (to skrypt-beacon, a CSP ma
`script-src 'self'`), zewnętrznej analityki i ciasteczek analitycznych.

## 5. Rezerwacja: współbieżność i odporność na błędy

| Sytuacja | Zachowanie |
| --- | --- |
| Dwóch użytkowników, ten sam slot | Durable Object serializuje; dokładnie jeden sukces, drugi dostaje `slot_unavailable` |
| Powtórzenie żądania z tym samym `idempotency_key` | ten sam `booking_id` i `public_ref`, `replayed: true`, zero nowych wierszy |
| Ten sam klucz, inne żądanie | `conflict` — klucz nie jest przechwytywany dla innej rezerwacji |
| Slot zajęty po pokazaniu podsumowania | `slot_unavailable` z komunikatem „odśwież listę terminów” |
| Zmiana ceny między preview a create | `price_changed` — wymagane nowe podsumowanie i nowe potwierdzenie |
| Token wygasły / zmodyfikowany / cudzy | `token_expired` / `token_invalid` / `forbidden` |
| Zła strefa czasowa | odrzucenie na poziomie schematu Zod; w panelu HTTP 400, nigdy cicha podmiana |
| Nieudany e-mail | rezerwacja zostaje ważna; wiersz w `notification_outbox` z narastającym backoffem (60 s → 6 h, 6 prób) |
| Anulowanie | idempotentne, zwalnia slot, respektuje `cancellation_cutoff_h`, trafia do audytu |

**Durable Object *i* ograniczenie w bazie.** Sam DO wystarczyłby, gdyby każdy
zapis szedł przez niego. Sam unikalny indeks też by wystarczył. Mamy oba, bo to
dwie różne klasy błędów: DO chroni przed wyścigiem, indeks chroni przed
pominięciem DO. Test „dwa równoległe bookingi” sprawdza wynik, nie mechanizm.
Wewnątrz DO krytyczna sekcja jest serializowana łańcuchem obietnic, bo handler
`fetch` Durable Object może się przepleść na `await`.

`// ponytail: łańcuch obietnic per instancja DO; przy dużym ruchu jednego terapeuty rozważyć kolejkę z limitem`

**Token potwierdzenia podpisany, nie zapisany.** `preview_booking` nie tworzy
żadnego wiersza. Token to HMAC nad ładunkiem zawierającym wyłącznie identyfikatory
i warunki handlowe (bez PII), ważny maksymalnie 10 minut. Podgląd nie może więc
zablokować terminu ani zaśmiecić bazy, a `create_booking` i tak weryfikuje
wszystko ponownie w bazie — token jest dowodem, że użytkownikowi pokazano
konkretne warunki, a nie źródłem prawdy.

**Outbox zamiast wysyłki w transakcji.** Wymaganie „nieudany e-mail nie może
zepsuć rezerwacji ani spowodować podwójnej” prowadzi wprost do outboxu. Wiersz
zawiera adresata, więc jest szyfrowany. Ponawianie: 60 s, 5 min, 15 min, 1 h, 3 h,
6 h — sześć prób, potem status `failed`.

## 6. Autoryzacja

### Publicznie (bez tokenu)
`search_therapists`, `get_therapist_profile`, `get_therapist_faq`,
`list_available_slots`, `get_crisis_resources`, `render_otwarty_terapeuta_widget`.

### Wymaga OAuth 2.1
`preview_booking`, `list_my_bookings` (`booking:read`),
`create_booking`, `cancel_booking` (`booking:write`).

Ponieważ endpoint obsługuje jednocześnie ruch anonimowy i uwierzytelniony,
narzędzia prywatne **zwracają** wynik z `isError: true` i `_meta["mcp/www_authenticate"]`
zamiast rzucać 401 na całe żądanie. Nieprawidłowy token przedstawiony jawnie
kończy się natomiast pełnym `401` z nagłówkiem `WWW-Authenticate` i wskazaniem
`resource_metadata` — czyli poprawnym wyzwaniem OAuth, nie ogólnym błędem.

### Serwer autoryzacji (`src/auth/oauth.ts`)

- `/.well-known/oauth-protected-resource[/mcp]` i `/.well-known/oauth-authorization-server`
  serwuje SDK (`oauthMetadataResponse`), więc kształt dokumentów zawsze zgadza się
  ze specyfikacją.
- `POST /oauth/register` — dynamiczna rejestracja klientów publicznych (bez sekretu).
- `GET/POST /oauth/authorize` — logowanie kodem jednorazowym + Turnstile + ekran zgody
  z opisem zakresów. Parametry autoryzacji są brane **z wiersza wyzwania**, nie z
  ukrytych pól formularza, więc podmiana `redirect_uri` w DOM nic nie daje.
- `POST /oauth/token` — `authorization_code` (PKCE S256, jedyna dozwolona metoda,
  wymuszona także `CHECK`-iem w schemacie) oraz `refresh_token` z rotacją. Ponowne
  użycie kodu unieważnia wszystkie tokeny tej pary klient–użytkownik.
- `resource` (RFC 8707) jest walidowany i zapisywany jako `aud` tokenu; weryfikator
  zwraca go w `AuthInfo.resource`.

**Własny serwer autoryzacji zamiast zewnętrznego IdP.** Rezerwacja wymaga konta,
ale konto ma sens tylko wewnątrz tego produktu. Zewnętrzny IdP oznaczałby
przekazywanie mu informacji o tym, kto szuka terapeuty — dokładnie ten sygnał,
którego nie chcemy nikomu udostępniać. Logowanie jest bezhasłowe: nie ma hasła do
wycieku ani do ponownego użycia gdzie indziej. **Konsekwencja:** dostępność
logowania zależy od dostawcy poczty; na produkcji Worker odmawia startu, jeśli
dostawca nie jest skonfigurowany (`createNotificationSender()`, dziś Brevo i Resend).

**Tokeny nieprzezroczyste zamiast JWT.** Weryfikacja offline jest niepotrzebna —
resource server i authorization server to ten sam Worker z tą samą bazą. Tokeny
nieprzezroczyste dają natychmiastowe unieważnienie (istotne przy `booking:write`)
i nie wymagają JWKS ani rotacji kluczy podpisu. W bazie leży wyłącznie HMAC.

### Panel administratora
Osobny mechanizm: ciasteczko `__Host-ot_admin` (HttpOnly, Secure, SameSite=Lax)
plus token CSRF **wyprowadzony** z sekretu sesji przez `HMAC(klucz, "csrf:" +
sekret_sesji)`. Nie trzeba go przechowywać, a atakujący, który nie odczyta
ciasteczka, nie wyliczy tokenu.

## 7. Widżet MCP Apps

- Zasób: `ui://otwarty-terapeuta/widget/v1.html`, MIME `text/html;profile=mcp-app`.
- Powiązany **wyłącznie** z `render_otwarty_terapeuta_widget` przez `_meta.ui.resourceUri`,
  z aliasem zgodności `_meta["openai/outputTemplate"]` dla ChatGPT. Ustawiamy oba,
  plus `_meta.ui.prefersBorder`, `_meta.ui.csp` i `_meta["openai/toolInvocation/*"]`.
- `_meta.ui.csp` deklaruje puste `connectDomains` i `resourceDomains`: dokument jest
  w pełni samowystarczalny. `scripts/build-widget.mjs` buduje Reacta esbuildem
  i wkleja JS oraz CSS do jednego pliku HTML — żadnego zewnętrznego fontu ani
  skryptu, a bundle jest tym samym artefaktem w testach i w produkcji.
- Dane trafiają do widżetu w `structuredContent`, nie w `_meta`: host dostarcza
  widżetowi **wynik narzędzia** (w ChatGPT `window.openai.toolOutput`). Koperta
  `{ view, title, data, generated_at, item_count }` jest więc zwracana jako
  `structuredContent` narzędzia renderującego.
- Komunikacja: standardowy most `ui/*` przez `postMessage`, z użyciem `window.openai`,
  gdy host go udostępnia.
- Widżet traktuje `structuredContent` jako **dane niezaufane**: wszystko renderuje się
  jako tekst (React), a każdy link przechodzi przez `safeHref()` (tylko `https:` i `mailto:`).
- Dostępność: pełna obsługa klawiatury, widoczny focus, `role="status"` z `aria-live`
  dla zmian widoku, kontrasty WCAG 2.2 AA w schemacie jasnym i ciemnym.
- Daty formatowane w strefie użytkownika, ale strefa samej wizyty jest zachowana
  i pokazywana (`local_timezone_label`).

Widżet nigdy nie jest warunkiem działania: każde narzędzie zwraca użyteczne
`content` i `structuredContent`.

## 8. Prywatność i treści niezaufane

Katalog danych i podstawy prawne: `PRIVACY_DATA_MAP.md`. Tu tylko to, co wynika
z architektury:

- Serwer nie ma **żadnego** pola przyjmującego transkrypt, opis objawów czy
  historię leczenia. Filtry to enumy i słowniki, i nie są zapisywane ani wiązane
  z kontem.
- Logger (`src/lib/log.ts`) przyjmuje tylko listę dozwolonych pól o niskiej
  kardynalności i redaguje e-maile, telefony oraz tokeny. Audyt (`src/lib/audit.ts`)
  ma własną listę dozwolonych kluczy `meta`; wolny tekst użytkownika nigdy tam nie trafia.
- Eksport i usunięcie danych użytkownika są wbudowane w panel.

**Sanityzacja przy zapisie *i* ucieczka przy renderowaniu.** Treści terapeutów
przechodzą przez `sanitizeRichText()` przy zapisie (usunięcie znaków niewidocznych,
neutralizacja markerów prompt injection) i przez `escapeHtml()` przy każdym
renderowaniu. Sanityzacja przy zapisie sama w sobie **nie jest** zabezpieczeniem
XSS — jest nim ucieczka. Sanityzacja chroni przed treścią, którą recenzent-człowiek
mógłby przeoczyć.

Neutralizacja prompt injection jest ograniczeniem ryzyka, **nie gwarancją**.
Właściwym zabezpieczeniem jest to, że treść terapeuty nigdy nie ma uprawnień: nie
może wywołać narzędzia, nie może zmienić zakresu tokenu i nie może zapisać niczego
w bazie. Analiza wektorów: `SECURITY.md`.

**Kryzys realizowany instrukcjami, nie klasyfikacją.** Serwer nie dostaje
transkryptu, więc nie może i nie powinien wykrywać kryzysu. Zamiast tego
`instructions` serwera MCP nakazują modelowi wywołać `get_crisis_resources`,
opis tego narzędzia powtarza warunek, każda odpowiedź `search_therapists` niesie
`disclaimer`, a każdy widok widżetu — stałą informację o granicach usługi i numery
112 / 116 123. Świadoma konsekwencja: skuteczność zależy od modelu klienta.
Ryzyko wymagające konsultacji klinicznej przed publikacją — `DPIA_CHECKLIST.md` §11.

**Brak ścieżki dla osób poniżej 18 lat.** MVP jest dla osób pełnoletnich. Dla
`audience: "minor"` zwracamy osobne zasoby (116 111) i jawnie informujemy, że
rezerwacja nie jest dostępna. Zaprojektowanie ścieżki opiekuna wymaga oceny
prawnej — nie zgadujemy jej w kodzie.

## 9. Wybory technologiczne

| Wybór | Alternatywa | Dlaczego tak |
| --- | --- | --- |
| Hono | własny router | routing + parsowanie formularzy w kilku kB, bez runtime'u Node |
| Zod 4 | walidacja ręczna | SDK MCP przyjmuje Standard Schema wprost i sam generuje JSON Schema dla `tools/list` |
| esbuild | Vite | potrzebny jest jeden bundle IIFE bez dev-servera |
| TypeScript 6.0 | TypeScript 7 | 7.0 nie jest jeszcze wspierany przez `typescript-eslint@8` |
| Vitest + `@cloudflare/vitest-pool-workers` | Node + mocki | testy działają na prawdziwym D1 i prawdziwym Durable Object; test wyścigu bookingów nie miałby sensu na mockach |
| Playwright z `channel: 'chrome'` | pobierana przeglądarka Playwright | używa lokalnie zainstalowanego Chrome, bez 300 MB pobierania w CI dewelopera |
| Jeden SVG jako avatar demo | zdjęcia stockowe | żadne zdjęcie nie może sugerować realnej osoby ani przedstawiać cierpienia |
| Natywne bindingi `ratelimits` | licznik w D1 lub DO | zero kodu, zero stanu do utrzymania |
| Natywne API platformy | własne implementacje | `Uint8Array.toBase64/fromBase64/toHex`, `crypto.subtle.timingSafeEqual`, `Intl.DateTimeFormat` zamiast biblioteki dat |

**`createMcpHandler` z `@modelcontextprotocol/server`, nie z pakietu `agents`.**
`agents@0.21.0` eksportuje `createMcpHandler` jako alias `createStatelessMcpHandler`
— cienką nakładkę na to samo z `@modelcontextprotocol/server@2.0.0`, dodającą
walidację `Host`/`Origin`, CORS i dopasowanie ścieżki. Bierzemy źródło wprost,
a walidację hostów robimy jawnie (`hostHeaderValidationResponse()`,
`originValidationResponse()` z tego samego pakietu). Identyczne zachowanie
transportu, o jedną dużą zależność mniej (`agents` ciągnie warstwę Durable Objects
i klienta MCP, z których nic nie używamy), a walidacja jest widoczna w
`src/index.ts` zamiast schowana w konfiguracji.

SDK v2 dało nam gotowe `McpServer`, `createMcpHandler`, `verifyBearerToken`,
`bearerAuthChallengeResponse`, `oauthMetadataResponse`,
`getOAuthProtectedResourceMetadataUrl` — nie piszemy własnych dokumentów
RFC 9728 / RFC 8414 ani własnego parsera nagłówka `Authorization`.

**Strona WWW bez JavaScriptu.** Katalog, filtry i cały panel są renderowane po
stronie serwera. Dzięki temu CSP nie potrzebuje `unsafe-inline` ani nonce'ów,
strona działa przy wyłączonym JS, a jedyny zewnętrzny skrypt (Turnstile) pojawia
się wyłącznie na stronach z formularzem. Pilnuje tego `e2e/site.spec.ts`
(kontekst z `javaScriptEnabled: false`).

## 10. Znane długi techniczne

Dług, który **nie** blokuje wydania. Co blokuje — wyłącznie `DPIA_CHECKLIST.md` §11.

| Miejsce | Ograniczenie | Kiedy naprawić |
| --- | --- | --- |
| `src/matching/rank.ts` | punktacja na maks. 200 kandydatach z SQL | gdy katalog przekroczy kilkaset profili na zapytanie |
| `src/web/admin-ui.ts` | skrypt panelu w idiomach ES5 (`var`, `function ()`) | przy najbliższej realnej zmianie w tym pliku |
| `seed/seed.sql` | pojedyncze `;` na końcu linii są kontraktem dla `test/setup.ts` | przy przejściu na parser SQL zamiast dzielenia po `;\n` |
| `seed/seed.sql` — godziny slotów | SQLite nie ma bazy IANA, więc dane demonstracyjne są liczone w UTC i przesuwają się o godzinę po zmianie czasu | tylko jeśli seed miałby kiedykolwiek trafić poza demo |

## 11. Świadome ograniczenia i czego NIE zrobiliśmy

- **Brak płatności** — rozliczenie bezpośrednio między pacjentem a terapeutą.
  Procesor płatności oznaczałby nowego procesora danych oraz obowiązki
  rozliczeniowe i zwrotowe.
- **Brak ścieżki opiekuna dla osób poniżej 18 lat** — celowo, do czasu weryfikacji
  prawnej.
- **Zasoby kryzysowe utrzymywane ręcznie**, wymagają weryfikacji co 90 dni
  z przypisanym właścicielem.
- **Nie ma płatnego rankingu ani promowanych profili** — w schemacie nie ma pola,
  które mogłoby to wyrazić.
- **Nie ma trackerów, analityki zewnętrznej ani fontów z CDN.**
- **Nie ma automatycznej kwalifikacji klinicznej** — żadne narzędzie nie przyjmuje
  ani nie zwraca oceny stanu zdrowia.
- **Nie twierdzimy, że rozwiązanie jest „zgodne z RODO”.** Kod realizuje szereg
  wymagań technicznych; ocena zgodności należy do prawnika i wymaga DPIA
  (`DPIA_CHECKLIST.md`).
