# Otwarty Terapeuta

Katalog psychoterapeutów i system rezerwacji wizyt dla domeny `otwartyterapeuta.pl`,
działający jako strona WWW **oraz** jako serwer MCP dla pluginów ChatGPT.

**To nie jest usługa terapeutyczna.** Produkt nie prowadzi terapii, nie stawia diagnoz,
nie kwalifikuje do leczenia i nie zastępuje pomocy w nagłym zagrożeniu życia lub zdrowia.

---

## Spis treści

1. [Co zawiera projekt](#co-zawiera-projekt)
2. [Wymagania](#wymagania)
3. [Uruchomienie lokalne od zera](#uruchomienie-lokalne-od-zera)
4. [Testy](#testy)
5. [Od pustego konta Cloudflare do działającego preview](#od-pustego-konta-cloudflare-do-działającego-preview)
6. [Wdrożenie produkcyjne](#wdrożenie-produkcyjne)
7. [Sekrety](#sekrety)
8. [Narzędzia MCP](#narzędzia-mcp)
9. [Panel administratora](#panel-administratora)
10. [Struktura repozytorium](#struktura-repozytorium)
11. [Pozostałe dokumenty](#pozostałe-dokumenty)

---

## Co zawiera projekt

| Element | Gdzie |
| --- | --- |
| Publiczna strona WWW (PL, bez JS, ścisły CSP) | `src/web/pages.ts` |
| Samodzielne zgłoszenie terapeuty (kod e-mail, szkic) | `src/web/therapist-signup.ts` |
| Panel administratora (role: admin / therapist / support) | `src/web/admin.ts` |
| Serwer MCP (Streamable HTTP, stateless) pod `/mcp` | `src/mcp/server.ts` |
| Widżet MCP Apps (React, samowystarczalny HTML) | `src/widget/` |
| Serwer autoryzacji OAuth 2.1 (PKCE S256, DCR, RFC 8707) | `src/auth/oauth.ts` |
| Durable Object serializujący rezerwacje | `src/booking/coordinator.ts` |
| Migracje i dane referencyjne D1 | `migrations/` |
| Dane demonstracyjne (8 fikcyjnych profili + 1 nieopublikowany) | `seed/seed.sql` |
| Testy w runtime Workers (Vitest) | `test/` |
| Testy przeglądarkowe (Playwright) | `e2e/` |

---

## Wymagania

- Node.js **22+** (projekt testowany na 22.x)
- npm 10+
- Konto Cloudflare z dostępem do Workers, D1, R2, Durable Objects i Turnstile
- Google Chrome zainstalowany lokalnie (tylko dla testów Playwright — używamy
  `channel: 'chrome'`, więc Playwright nie pobiera własnej przeglądarki)

---

## Uruchomienie lokalne od zera

```bash
# 1. Zależności
npm install

# 2. Sekrety lokalne
cp .dev.vars.example .dev.vars

#    Wygeneruj dwa klucze po 32 bajty i wklej je do .dev.vars:
openssl rand -base64 32   # -> PII_ENC_KEY
openssl rand -base64 32   # -> TOKEN_SIGNING_KEY
#    TURNSTILE_SECRET_KEY zostaw na testowej wartości "1x0000...AA".
#    EMAIL_PROVIDER=console — wiadomości trafiają do logu, nie są wysyłane.
#    ADMIN_BOOTSTRAP_EMAILS=twoj@email.pl — to konto dostanie rolę admin.

# 3. Baza lokalna: migracje + dane demonstracyjne
npm run db:migrate:local
npm run db:seed:local
#    (albo jednym poleceniem, kasując poprzedni stan)
npm run db:reset:local

# 4. Build widżetu + serwer deweloperski
npm run dev
```

Po starcie dostępne są:

| Adres | Co to jest |
| --- | --- |
| <http://localhost:8787/> | strona główna |
| <http://localhost:8787/terapeuci> | katalog z filtrami |
| <http://localhost:8787/admin> | panel administratora |
| <http://localhost:8787/dla-terapeutow> | zgłoszenie nowego terapeuty |
| <http://localhost:8787/mcp> | endpoint MCP (Streamable HTTP) |
| <http://localhost:8787/.well-known/oauth-protected-resource/mcp> | metadane RFC 9728 |
| <http://localhost:8787/.well-known/oauth-authorization-server> | metadane RFC 8414 |

### Szybki test endpointu MCP

```bash
curl -s -X POST http://localhost:8787/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP
# URL:       http://localhost:8787/mcp
```

Sprawdź kolejno: `initialize`, `tools/list`, `resources/list`,
`tools/call → search_therapists`, `tools/call → preview_booking` (musi zwrócić
wyzwanie OAuth, dopóki nie połączysz konta).

### Logowanie do panelu lokalnie

Panel wysyła jednorazowy kod e-mailem. Lokalnie `EMAIL_PROVIDER=console`, więc
kod pojawia się **w logu `wrangler dev`**:

```
[ConsoleNotificationProvider] WIADOMOSC NIE ZOSTALA WYSLANA (tryb lokalny)
  do: twoj@email.pl
  temat: Kod logowania do panelu — Otwarty Terapeuta
```

---

## Testy

```bash
npm test          # 108 testów: Vitest w runtime Workers, na prawdziwym D1 i DO
npm run test:e2e  # 18 testów przeglądarkowych (Playwright + lokalny Chrome)
npm run typecheck # TypeScript strict, zero błędów
npm run lint      # ESLint, zero błędów
npm run build     # build widżetu + `wrangler deploy --dry-run`
```

`npm run test:e2e` sam podnosi `wrangler dev` na porcie 8788. Baza musi być
wcześniej zmigrowana i zaseedowana (`npm run db:reset:local`).

Zakres testów opisuje [`ARCHITECTURE.md`](./ARCHITECTURE.md#testy).

---

## Od pustego konta Cloudflare do działającego preview

Wszystkie polecenia uruchamiaj z katalogu projektu.

```bash
# 0. Logowanie
npx wrangler login

# 1. Baza D1 dla środowiska preview
npx wrangler d1 create otwarty-terapeuta-preview
#    -> skopiuj wypisane `database_id`
#    -> wklej je w wrangler.jsonc w env.preview.d1_databases[0].database_id
#       w miejsce REPLACE_ME_D1_PREVIEW_DATABASE_ID

# 2. Bucket R2 na zdjęcia profilowe
npx wrangler r2 bucket create otwarty-terapeuta-media-preview

# 3. Turnstile: w panelu Cloudflare (Turnstile -> Add site) utwórz widget dla
#    domeny preview. Skopiuj Site Key do wrangler.jsonc
#    (env.preview.vars.TURNSTILE_SITE_KEY), a Secret Key ustaw w kroku 4.

# 4. Sekrety środowiska preview
openssl rand -base64 32 | npx wrangler secret put PII_ENC_KEY --env preview
openssl rand -base64 32 | npx wrangler secret put TOKEN_SIGNING_KEY --env preview
npx wrangler secret put TURNSTILE_SECRET_KEY --env preview
npx wrangler secret put EMAIL_PROVIDER --env preview      # "console", "brevo" lub "resend"
npx wrangler secret put EMAIL_FROM --env preview
npx wrangler secret put EMAIL_API_KEY --env preview       # jeśli EMAIL_PROVIDER=brevo/resend
npx wrangler secret put ADMIN_BOOTSTRAP_EMAILS --env preview

# 5. Migracje i dane demonstracyjne
npm run db:migrate:preview
npm run db:seed:preview     # POMIŃ, jeżeli preview ma zawierać dane realne

# 6. Wdrożenie
npm run build:widget
npx wrangler deploy --env preview
#    -> wrangler wypisze adres *.workers.dev
#    -> wpisz go w wrangler.jsonc: env.preview.vars.PUBLIC_BASE_URL
#       oraz PUBLIC_MCP_URL (= <adres>/mcp) i wdroż ponownie
```

Po drugim wdrożeniu preview jest gotowe:
`https://<twoj-worker>.workers.dev/mcp`.

> **Uwaga:** `PUBLIC_BASE_URL` i `PUBLIC_MCP_URL` muszą wskazywać rzeczywisty
> adres wdrożenia, bo z nich wynikają: `issuer` OAuth, `resource` (RFC 8707)
> i dozwolone nagłówki `Host`/`Origin` endpointu MCP.

---

## Wdrożenie produkcyjne

Dodatkowo względem preview:

1. Dodaj domenę `otwartyterapeuta.pl` do Cloudflare. Custom Domains opisane w
   `wrangler.jsonc` (`env.production.routes`) automatycznie utworzą rekordy DNS
   i certyfikaty dla domeny głównej, `www` oraz `mcp` podczas wdrożenia.
2. Utwórz osobną bazę i bucket:
   ```bash
   npx wrangler d1 create otwarty-terapeuta-prod
   npx wrangler r2 bucket create otwarty-terapeuta-media-prod
   ```
   Wklej `database_id` w `env.production.d1_databases[0].database_id`.
3. Ustaw wszystkie sekrety z `--env production`.
   **Produkcja nie wystartuje** (HTTP 503 z czytelnym komunikatem), jeżeli
   brakuje `PII_ENC_KEY`, `TOKEN_SIGNING_KEY`, `TURNSTILE_SECRET_KEY`,
   `EMAIL_FROM` albo gdy `EMAIL_PROVIDER` to `console`. To zamierzone:
   nie udajemy wysłanego potwierdzenia rezerwacji.
4. Migracje: `npm run db:migrate:prod`. **Nie ładuj `seed/seed.sql` na produkcję.**
5. `npm run build:widget && npx wrangler deploy --env production`.

---

## Sekrety

| Nazwa | Do czego | Jak wygenerować |
| --- | --- | --- |
| `PII_ENC_KEY` | AES-GCM dla danych kontaktowych | `openssl rand -base64 32` |
| `TOKEN_SIGNING_KEY` | HMAC: tokeny potwierdzeń, tokeny OAuth, kody logowania, linki zarządzania rezerwacją, CSRF | `openssl rand -base64 32` |
| `TURNSTILE_SECRET_KEY` | weryfikacja formularzy publicznych | panel Cloudflare → Turnstile |
| `EMAIL_PROVIDER` | `console` (lokalnie), `brevo` albo `resend` | — |
| `EMAIL_API_KEY` | klucz API Brevo/Resend | panel dostawcy |
| `EMAIL_FROM` | adres nadawcy | — |
| `ADMIN_BOOTSTRAP_EMAILS` | lista e-maili dostających rolę `admin` przy pierwszym logowaniu | — |

Rotacja i reakcja na incydent: [`SECURITY.md`](./SECURITY.md).

> `TOKEN_SIGNING_KEY` jest kluczem wyszukiwania kont (HMAC adresu e-mail).
> Jego rotacja wymaga migracji kolumny `users.email_hash` — procedura jest
> opisana w `SECURITY.md`.

---

## Narzędzia MCP

| Narzędzie | Autoryzacja | Zapis? |
| --- | --- | --- |
| `search_therapists` | publiczne | nie |
| `get_therapist_profile` | publiczne | nie |
| `get_therapist_faq` | publiczne | nie |
| `list_available_slots` | publiczne | nie |
| `get_crisis_resources` | publiczne | nie |
| `render_otwarty_terapeuta_widget` | publiczne | nie |
| `preview_booking` | `booking:read` | nie |
| `list_my_bookings` | `booking:read` | nie |
| `create_booking` | `booking:write` | **tak** |
| `cancel_booking` | `booking:write` | **tak** |

Każde narzędzie zwraca zarówno `content` (tekst), jak i `structuredContent`,
więc cały przepływ działa również w kliencie bez interfejsu graficznego.

Szczegóły i uzasadnienie adnotacji: [`PLUGIN_SUBMISSION_CHECKLIST.md`](./PLUGIN_SUBMISSION_CHECKLIST.md).

---

## Panel administratora

`/admin`, logowanie jednorazowym kodem e-mail + Turnstile.

| Rola | Zakres |
| --- | --- |
| `admin` | wszystko: profile, publikacja, weryfikacja, FAQ, oferta, dostępność, rezerwacje, zasoby kryzysowe, eksport/usunięcie danych użytkownika, audyt |
| `therapist` | wyłącznie własny profil, własne FAQ, własna oferta i dostępność, własne rezerwacje |
| `support` | podgląd minimalnych danych rezerwacji i ich odwołanie z powodem audytowym; bez notatek weryfikacyjnych i bez danych kontaktowych |

Pierwszy administrator: wpisz swój adres w `ADMIN_BOOTSTRAP_EMAILS` i zaloguj się.
Kolejne role nadaje się w bazie (`users.role`, `users.therapist_id`).

Nowy terapeuta może zgłosić się przez `/dla-terapeutow`. Po potwierdzeniu adresu
e-mail powstaje konto z rolą `therapist` i przypisany profil o statusie `draft` /
`unverified`. Profil nie jest widoczny publicznie, dopóki administrator nie zmieni
statusu na `published`; weryfikacja kwalifikacji pozostaje osobną decyzją administratora.

---

## Struktura repozytorium

```
.
├── migrations/            # wersjonowane migracje D1 (schemat + dane referencyjne)
├── seed/seed.sql          # dane demonstracyjne, wszystkie oznaczone is_demo = 1
├── scripts/
│   └── build-widget.mjs   # esbuild -> jeden samowystarczalny HTML widżetu
├── src/
│   ├── index.ts           # Worker: routing, MCP, discovery OAuth, cron
│   ├── env.ts             # bindingi, sekrety, stałe, walidacja konfiguracji
│   ├── auth/              # serwer autoryzacji OAuth 2.1, weryfikator tokenów, sesje panelu
│   ├── booking/           # Durable Object + logika preview/create/cancel
│   ├── db/                # projekcje publiczne, zapytania katalogu, użytkownicy
│   ├── lib/               # crypto, czas, sanityzacja, błędy, logi, audyt, Turnstile
│   ├── matching/rank.ts   # deterministyczny, wyjaśnialny ranking
│   ├── mcp/               # schematy Zod + rejestracja narzędzi i zasobów
│   ├── notify/            # NotificationProvider + outbox z ponawianiem
│   ├── web/               # strona publiczna, panel, layout z CSP, style
│   └── widget/            # widżet React + most MCP Apps (+ wygenerowany bundle)
├── test/                  # testy w runtime Workers (Vitest)
├── e2e/                   # testy przeglądarkowe (Playwright)
├── wrangler.jsonc         # local / preview / production
└── .dev.vars.example      # szablon sekretów, bez wartości
```

---

## Pozostałe dokumenty

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — jak to działa i dlaczego tak
- [`DECISIONS.md`](./DECISIONS.md) — decyzje projektowe i różnice względem założeń
- [`SECURITY.md`](./SECURITY.md) — zgłaszanie incydentów, rotacja sekretów
- [`THREAT_MODEL.md`](./THREAT_MODEL.md) — model zagrożeń
- [`PRIVACY_DATA_MAP.md`](./PRIVACY_DATA_MAP.md) — mapa danych osobowych
- [`RETENTION_POLICY.md`](./RETENTION_POLICY.md) — polityka retencji
- [`DPIA_CHECKLIST.md`](./DPIA_CHECKLIST.md) — checklista przed oceną prawną
- [`PLUGIN_SUBMISSION_CHECKLIST.md`](./PLUGIN_SUBMISSION_CHECKLIST.md) — zgłoszenie pluginu w OpenAI
