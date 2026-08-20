# Architektura — Otwarty Terapeuta

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

Migracje: `migrations/0001_catalog.sql`, `0002_auth.sql`, `0003_reference_data.sql`.

### Katalog
`therapists`, `therapist_locations`, `languages` + `therapist_languages`,
`specialties` + `therapist_specialties`, `modalities` + `therapist_modalities`,
`session_offers`, `faq_items`.

### Dostępność i rezerwacje
`availability_rules`, `appointment_slots`, `bookings`, `booking_idempotency`.

### Konta, zgody, audyt, powiadomienia
`users`, `consent_records`, `crisis_resources`, `audit_events`, `notification_outbox`.

### OAuth
`oauth_clients`, `oauth_auth_codes`, `oauth_tokens`, `login_challenges`, `admin_sessions`.

### Zasady, których przestrzega cały schemat

| Zasada | Realizacja |
| --- | --- |
| Identyfikatory nieprzewidywalne | `th_`/`sl_`/`bk_`/`usr_` + 24 znaki hex z CSPRNG |
| Publiczne adresy czytelne | `therapists.slug`, `bookings.public_ref` (`OT-XXXXXX`) |
| Czas w UTC, strefa osobno | `starts_at_utc` + `timezone` (IANA); terminy powstają z lokalnego zegara terapeuty przez `zonedTimeToUtc()`, więc godzina wizyty nie ucieka przy zmianie czasu |
| Ceny w najmniejszych jednostkach | `price_minor` (grosze) + `currency` |
| Jawne statusy | `therapists.status`, `faq_items.status`, `appointment_slots.status`, `bookings.status` |
| Jeden aktywny booking na slot | `CREATE UNIQUE INDEX idx_bookings_one_active_per_slot ON bookings(slot_id) WHERE status='confirmed'` |
| Soft delete tam, gdzie potrzebny audyt | `therapists.deleted_at`, `users.deleted_at` — filtrowane w każdym publicznym zapytaniu |
| Dane kontaktowe szyfrowane | AES-256-GCM (Web Crypto), klucz w sekrecie `PII_ENC_KEY` |
| Brak danych zdrowotnych | schemat nie ma miejsca na notatki z sesji, diagnozy ani transkrypty |

## 4. Bezpieczeństwo projekcji publicznych

Cały odczyt publiczny przechodzi przez `src/db/catalog.ts`. Funkcja
`toPublicTherapist()` jest jedynym miejscem, w którym wiersz bazy staje się
obiektem widocznym na zewnątrz, a jej typ zwracany (`PublicTherapist`)
**nie zawiera** pól `verification_notes` ani `contact_email_enc`. Dzięki temu
dodanie prywatnej kolumny w przyszłości nie wycieknie przez rozpakowanie wiersza.

Testy `test/catalog.test.ts` i `test/mcp.test.ts` sprawdzają to wprost.

## 5. Ranking

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
   rotacja. Brak jakiegokolwiek czynnika komercyjnego; nie ma pola „promowany”.

`match_reasons` powstają wyłącznie z pól obecnych w tej samej odpowiedzi, więc
model może je zacytować, a użytkownik zweryfikować.

## 6. Rezerwacja i odporność na błędy

| Sytuacja | Zachowanie |
| --- | --- |
| Dwóch użytkowników, ten sam slot | Durable Object serializuje; dokładnie jeden sukces, drugi dostaje `slot_unavailable` |
| Powtórzenie żądania z tym samym `idempotency_key` | ten sam `booking_id` i `public_ref`, `replayed: true`, zero nowych wierszy |
| Ten sam klucz, inne żądanie | `conflict` — klucz nie jest przechwytywany dla innej rezerwacji |
| Slot zajęty po pokazaniu podsumowania | `slot_unavailable` z komunikatem „odśwież listę terminów” |
| Zmiana ceny między preview a create | `price_changed` — wymagane nowe podsumowanie i nowe potwierdzenie |
| Token wygasły / zmodyfikowany / cudzy | `token_expired` / `token_invalid` / `forbidden` |
| Zła strefa czasowa | odrzucenie na poziomie schematu Zod (`Intl.DateTimeFormat` jako walidator); w panelu nieznana strefa daje HTTP 400, nigdy cichej podmiany |
| Nieudany e-mail | rezerwacja zostaje ważna; wiersz w `notification_outbox` z narastającym backoffem (60 s → 6 h, 6 prób) |
| Anulowanie | idempotentne, zwalnia slot, respektuje `cancellation_cutoff_h`, trafia do audytu |

Powiadomienia są **poza** transakcją rezerwacji z premedytacją: awaria dostawcy
poczty nie może cofnąć poprawnej rezerwacji ani spowodować podwójnej.

## 7. Autoryzacja

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
- `POST /oauth/token` — `authorization_code` (PKCE S256, jedyna dozwolona metoda) oraz
  `refresh_token` z rotacją. Ponowne użycie kodu unieważnia wszystkie tokeny tej pary
  klient–użytkownik.
- `resource` (RFC 8707) jest walidowany i zapisywany jako `aud` tokenu; weryfikator
  zwraca go w `AuthInfo.resource`.

Tokeny są nieprzezroczyste i losowe; w bazie leży wyłącznie HMAC.

### Panel administratora
Osobny mechanizm: ciasteczko `__Host-ot_admin` (HttpOnly, Secure, SameSite=Lax) plus
token CSRF **wyprowadzony** z sekretu sesji przez HMAC — nie trzeba go przechowywać,
a atakujący, który nie może odczytać ciasteczka, nie może go wyliczyć.

## 8. Widżet MCP Apps

- Zasób: `ui://otwarty-terapeuta/widget/v1.html`, MIME `text/html;profile=mcp-app`.
- Powiązany **wyłącznie** z `render_otwarty_terapeuta_widget` przez `_meta.ui.resourceUri`,
  z aliasem zgodności `_meta["openai/outputTemplate"]`.
- `_meta.ui.csp` deklaruje puste `connectDomains` i `resourceDomains`: dokument jest
  w pełni samowystarczalny (CSS i JS zainline'owane przez `scripts/build-widget.mjs`),
  więc żadna zewnętrzna domena nie jest potrzebna.
- Komunikacja: standardowy most `ui/*` przez `postMessage`, z użyciem `window.openai`,
  gdy host go udostępnia.
- Widoki: lista terapeutów, profil, FAQ, terminy, podsumowanie, potwierdzenie,
  moje rezerwacje. Stany: loading, empty, auth required, stale slot, error, success.
- Widżet traktuje `structuredContent` jako **dane niezaufane**: wszystko renderuje się
  jako tekst (React), a każdy link przechodzi przez `safeHref()` (tylko `https:` i `mailto:`).
- Dostępność: pełna obsługa klawiatury, widoczny focus, `role="status"` z `aria-live`
  dla zmian widoku, kontrasty WCAG 2.2 AA w schemacie jasnym i ciemnym.
- Daty formatowane w strefie użytkownika, ale strefa samej wizyty jest zachowana
  i pokazywana (`local_timezone_label`).

Widżet nigdy nie jest warunkiem działania: każde narzędzie zwraca użyteczne
`content` i `structuredContent`.

## 9. Prywatność w architekturze

- Serwer nie ma **żadnego** pola przyjmującego transkrypt, opis objawów czy historię
  leczenia. Filtry to enumy i słowniki.
- Filtry wyszukiwania nie są zapisywane ani wiązane z kontem.
- Logger (`src/lib/log.ts`) przyjmuje tylko listę dozwolonych pól o niskiej
  kardynalności i redaguje e-maile, telefony oraz tokeny.
- Audyt (`src/lib/audit.ts`) ma własną listę dozwolonych kluczy `meta`; wolny tekst
  użytkownika nigdy tam nie trafia.
- Eksport i usunięcie danych użytkownika są wbudowane w panel.

## 10. Testy

| Plik | Co pokrywa |
| --- | --- |
| `test/unit.test.ts` | sanityzacja (XSS, prompt injection, znaki niewidoczne, URL-e), tokeny potwierdzeń (podpis, wygaśnięcie, podmiana), ranking (determinizm, rotacja, kolejność kryteriów), redakcja logów, kryptografia, strefy czasowe |
| `test/catalog.test.ts` | filtry (puste, poprawne, sprzeczne, nieznane), brak wycieku pól prywatnych, niewidoczność profili nieopublikowanych, FAQ tylko zatwierdzone, sloty, zasoby kryzysowe (dorośli vs. małoletni) |
| `test/booking.test.ts` | preview bez zapisu, komplet danych w podsumowaniu, szyfrowanie danych kontaktowych, idempotencja, **dwa równoległe bookingi → dokładnie jeden sukces**, slot zajęty po preview, cudzy token, token wygasły, zmiana ceny, niezgodna wersja regulaminu, zgody, outbox, anulowanie (własne / cudze / powtórzone) |
| `test/admin.test.ts` | generowanie terminów w strefie terapeuty (lokalna godzina zachowana, strefa spoza Polski, odrzucenie nieznanej strefy, pomijanie weekendów lokalnie), CSRF, brak sesji, izolacja ról (`therapist` nie tknie cudzego profilu, `support` nie generuje dostępności) |
| `test/therapist-signup.test.ts` | formularz zgłoszenia, potwierdzenie kodem, utworzenie wyłącznie roboczego i niezweryfikowanego profilu, odrzucenie błędnego kodu |
| `test/mcp.test.ts` | `initialize` + instrukcje bezpieczeństwa, lista narzędzi, adnotacje zgodne z faktami, schematy wejścia i wyjścia, powiązanie zasobu UI tylko z narzędziem renderującym, samowystarczalność widżetu, walidacja wejść (SQL-i, obie/żadna opcja, strefa, zakres dat, sprzeczne ceny, sfałszowany kursor), brak wycieków, „brak zatwierdzonej odpowiedzi”, wyzwania OAuth i egzekwowanie zakresów, pełny przepływ rezerwacji przez MCP, XSS w danych terapeuty na stronie WWW, nagłówki CSP |
| `e2e/site.spec.ts` | strona bez JS, skip link, filtry katalogu, oznaczenia „zweryfikowany / deklarowane / demo”, strona kryzysowa, niedostępność panelu bez sesji, nagłówki bezpieczeństwa, CTA pluginu bez wymyślonego linku |
| `e2e/widget.spec.ts` | stan ładowania, render listy z `match_reasons`, brak wykonania wstrzykniętego HTML i brak niebezpiecznych linków, ogłaszanie zmian przez `aria-live`, obsługa wyłącznie klawiaturą i widoczny focus, ostrzeżenie o nieświeżych terminach, „brak zatwierdzonej odpowiedzi”, komplet danych przed przyciskiem potwierdzenia, stała informacja o granicach usługi |

Łącznie: 108 testów Vitest + 18 testów Playwright.

## 11. Świadome ograniczenia MVP

- Dane demonstracyjne w `seed/seed.sql` są generowane przez SQLite, które nie ma
  bazy stref IANA, więc godziny slotów DEMO przesuwają się o godzinę po zmianie
  czasu. Realna dostępność powstaje w panelu i tego problemu nie ma.
- Brak płatności: rozliczenie jest bezpośrednio między pacjentem a terapeutą.
- Brak ścieżki opiekuna dla osób poniżej 18 lat — celowo, do czasu weryfikacji prawnej.
- Zasoby kryzysowe są utrzymywane ręcznie i wymagają cyklicznej weryfikacji (90 dni).
