# MCP i wtyczka ChatGPT — reguły obszaru

## Zakres i komendy

`apps/mcp/` trzyma: `/mcp` i `/public/mcp` (`index.ts`), OAuth 2.1 (`auth/oauth.ts`,
`auth/verifier.ts`), dokumenty `/.well-known/*`, `/.well-known/openai-apps-challenge`,
`/rezerwacja/:ref` (`booking/receipt.ts`), rezerwacje z Durable Objectem
(`booking/service.ts`, `booking/coordinator.ts`), schematy (`schemas.ts`), serwer narzędzi
(`server.ts`), deklaracje autoryzacji (`security.ts`), widżet (`widget/`) oraz
`PLUGIN_SUBMISSION_CHECKLIST.md`. Materiały zgłoszeniowe zostają w
`plugins/otwarty-terapeuta/` w korzeniu — to konwencja pakowania, nie nasz wybór.

- `npm test -- apps/mcp` (`test/mcp.test.ts`, `test/booking.test.ts`, `test/oauth.test.ts`)
- `npm run typecheck`, `npm run lint` — całe repo; npm uruchamia skrypty z korzenia,
  więc te komendy działają też z `apps/mcp`
- `npm run dev:mcp` → `http://localhost:8793`
- `E2E_PORT=8893 npm run test:e2e -- e2e/widget.spec.ts`
- po każdej zmianie w `server.ts`, `schemas.ts` albo `security.ts` sprawdź, co serwer
  naprawdę zwraca:

```bash
curl -s -X POST http://localhost:8793/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' -H 'mcp-protocol-version: 2025-06-18' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 2000
```

Ten sam Worker obsługuje `otwartyterapeuta.pl` i `mcp.otwartyterapeuta.pl`. Reguła w
`mcpFetch` (`index.ts`) odpowiada 404 pod `mcp.*` na każdej ścieżce poza `/`, tym, co
`mcpFetch` obsłużył wcześniej (dokumenty discovery, `/mcp`, `/public/mcp`), oraz
`/.well-known/openai-apps-challenge` — ten portal OpenAI sprawdza pod hostem, który sam
wybierze, więc §11 checklisty wymaga go pod obiema domenami. Reguła biegnie przed Hono,
więc nowa trasa Hono nie odpowiada pod `mcp.*`, dopóki nie dopiszesz jej tutaj. Stan
faktyczny przypina `test/mcp.test.ts`, opis „the mcp.* subdomain"; zanim oprzesz się na
tym, że coś odpowiada pod `mcp.*`, sprawdź `curl`-em.

## Droga do publikacji

Kolejność: naprawa konfiguracji → testy §7 checklisty w trybie programisty → zgłoszenie do
publicznego katalogu aplikacji → dopiero wtedy `PUBLIC_PLUGIN_URL` i CTA na stronie.

**Dlaczego:** tryb programisty i przestrzeń robocza Business to etap testowy, nigdy
dostarczenie (root `CLAUDE.md`, „Odbiorca").

**Jak to stosować:** postęp mierz odległością od katalogu OpenAI, nie od działającego dema.
`PUBLIC_PLUGIN_URL` ustawia ten obszar w `wrangler.jsonc`; portal tylko czyta
(`apps/portal/web/labels.ts`) i bez wartości renderuje link „Zobacz, jak działa w ChatGPT"
do `/jak-to-dziala`. Adresu karty nie zgaduj — sprawdza to `e2e/site.spec.ts`.

## Autoryzacja narzędzi

Sześć narzędzi katalogowych ma `securitySchemes: noauth`, cztery rezerwacyjne `oauth2`
z zakresem (`security.ts`). Prywatne wywołane bez tokenu zwracają wynik z
`_meta["mcp/www_authenticate"]`, więc klient odpala OAuth leniwie — dopiero przy realnej
potrzebie. `/public/mcp` ignoruje nagłówek `Authorization` i odrzuca narzędzia OAuth
błędem `-32601`.

Łącznik w ChatGPT rejestruje się z uwierzytelnianiem **`Mieszana`**, nigdy `OAuth`:
`OAuth` przechodzi pełny `/oauth/authorize` przed pierwszym wywołaniem czegokolwiek, czyli
wymusza logowanie na wejściu (root `CLAUDE.md`, „Logowanie"). `POST /oauth/authorize/anonymous`
schodzi z zakresami do `catalog:read`; przycisk na naszym ekranie zgody to
„Korzystaj bez konta" (`auth/oauth.ts`).

**Jak to stosować:** po każdej zmianie w `security.ts`, `auth/oauth.ts` albo `index.ts`
przejdź ścieżkę anonimową end-to-end: `tools/list` → `search_therapists` →
`get_therapist_profile`, bez żadnego tokenu.

## Cache ChatGPT

- **Nie zmieniaj `WIDGET_URI`** (`shared/env.ts`). Klient trzyma stary adres; podbicie
  wersji daje „Błąd podczas ładowania aplikacji — Failed to fetch template". Nowy kod
  widżetu wchodzi zwykłym deployem.
- Zmiana czegokolwiek w `_meta.ui` (najczęściej `csp.resourceDomains`) **wymaga**
  w ustawieniach wtyczki: `…` → **Odłącz** → **Połącz** → „Kontynuuj bez konta".
  Sam deploy nie wystarczy i objawia się jako „poprawka nie działa".
- Zanim uznasz poprawkę za nieskuteczną, sprawdź `curl`-em `tools/list` i `resources/read`.
  Trzy razy serwer był już dobry, a problem siedział w cache klienta.
- Tabela „co się kiedy odświeża": skill `chatgpt-plugin` §3.

## Schematy

Dozwolone wartości wpisuj w `z.enum` w `schemas.ts`. **Nigdy nie odsyłaj modelu do zasobu
po listę wartości** — model go nie otworzy, wyśle angielskie slugi i dostaniesz ciche zero
wyników. Kwoty są w groszach i wymagają przykładu liczbowego w `.describe()`
(„300 zł = 30000"); sam opis „w groszach" nie wystarczył.

Enumy `topics`, `modalities` i `age_group` to słowniki z migracji — nowa wartość to zmiana
`z.enum` w tym samym commicie co migracja.

Reguła pełnoletności stoi w opisach **wszystkich** narzędzi katalogowych, bo `instructions`
z `initialize` model ignoruje. `search_therapists` z `age_group` `teens`/`children` zwraca
`isError` z telefonem 116 111 — twarda bramka, pilnowana testem.

## Rezerwacja

- `preview_booking` wystawia token HMAC ważny `CONFIRMATION_TOKEN_TTL_SECONDS` = 600 s
  (`shared/env.ts`). Token to nie zgoda: `create_booking` wymaga `confirm === true`, tego
  samego użytkownika i tych samych wersji regulaminu i polityki (`booking/service.ts`).
  Model potrafi zdobyć token i wywołać zapis, nie pytając nikogo.
- `TherapistBookingCoordinator` (`booking/coordinator.ts`) serializuje próby per terapeutka
  i tuż przed zapisem sprawdza od nowa status terminu, cenę, godziny i strefę. Unikalny
  indeks `idx_bookings_one_active_per_slot` jest ostatnią zaporą, `idempotency_key` daje ten
  sam wynik przy powtórzeniu.
- Maile nie wychodzą z żądania: `enqueueNotification` pisze do outboxu
  (`shared/notify/outbox.ts`), opróżnia go cron `*/5` z `worker.ts`. Lokalnie mail zobaczysz
  dopiero po przebiegu crona.
- `/rezerwacja/:ref?k=` porównuje HMAC z `manage_token_hash` w stałym czasie; brak `k` albo
  zły sekret daje 404 z tą samą stroną, żeby nie potwierdzać istnienia rezerwacji.

## Widżet

- Dane jadą w `structuredContent`; host ogłasza każde przypisanie zdarzeniem
  `openai:set_globals`. `widget/bridge.ts` słucha go **i** dokłada krótki odpyt awaryjny,
  bo ChatGPT nie emituje go niezawodnie. Objaw braku danych: widżet stoi na
  „Wczytuję dane…".
- Adresy zdjęć absolutyzuje `absolutePhoto` w `server.ts` — na granicy MCP, nie
  w `shared/db/catalog.ts`, bo ten sam DTO karmi stronę, która potrzebuje ścieżek
  względnych (pilnują tego testy).
- `_meta.ui.csp`: `connectDomains: []`, `resourceDomains: [origin z PUBLIC_BASE_URL]`
  (`server.ts`). Nie jest puste i puste być nie może — bez tego origin ChatGPT blokuje
  zdjęcia.
- Widżet buduje `scripts/build-widget.mjs` do `widget/generated.ts`: jeden samowystarczalny
  HTML, dziś ~211 kB. Plik jest generowany i nie ma go w gicie — nie edytuj go ręcznie.
