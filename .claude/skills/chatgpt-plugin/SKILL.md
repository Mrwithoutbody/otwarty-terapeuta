---
name: chatgpt-plugin
description: Praca z wtyczką ChatGPT (MCP / Apps SDK) dla Otwartego Terapeuty — rejestracja łącznika, tryb programisty, testowanie promptami, widżet, cache ChatGPT, publikacja. Użyj, gdy zadanie dotyczy wtyczki, łącznika, konektora, widżetu, `render_otwarty_terapeuta_widget`, `mcp.otwartyterapeuta.pl`, panelu OpenAI, chatgpt.com/plugins albo gdy ktoś prosi o „przetestuj wtyczkę", „uruchom w ChatGPT", „opublikuj plugin".
---

# Wtyczka ChatGPT — Otwarty Terapeuta

Wiedza zdobyta metodą prób i błędów podczas pierwszego uruchomienia (sierpień 2026).
Czytaj **zanim** cokolwiek klikniesz w ChatGPT — połowa tych rzeczy wygląda jak błąd
w kodzie, a jest zachowaniem klienta.

## 0. Cel, którego nie wolno zgubić

Wtyczkę ma móc dodać **każdy użytkownik ChatGPT, także darmowy**. Dostarczeniem jest
publiczny katalog aplikacji. Instalacja w przestrzeni roboczej Business albo w trybie
programisty to **wyłącznie etap testowy** — nigdy nie raportuj jej jako dostarczenia.
Pełna reguła: `CLAUDE.md`, sekcja „Odbiorca".

Druga twarda reguła: **logowanie tylko przy operacjach zapisu, nigdy do przeglądania**.
Zobacz `CLAUDE.md`. Konfiguracja, która wymusza ekran logowania przed pierwszym
wynikiem, jest błędem, nawet jeśli technicznie działa.

## 1. Gdzie to w ogóle jest

- `platform.openai.com/plugins` — **martwy portal**. Pokazuje komunikat o braku
  uprawnień `api.apps.read`. Nie idź tam, nie da się tam nic zgłosić.
- `chatgpt.com/plugins` — **tu żyją wtyczki**. Przycisk `+` w prawym górnym rogu
  otwiera „Nowa aplikacja".
- `chatgpt.com/#settings/Plugins/<plugin_id>` — ustawienia jednej wtyczki:
  połączenie, lista działań ze schematami, menu `…`.
- `chatgpt.com/admin/plugins` — panel admina przestrzeni roboczej.
- `chatgpt.com/admin/apps` — **zepsute po stronie OpenAI**, kręci się w nieskończoność.
  Nie próbuj, nie diagnozuj, to nie Twoja wina.

## 2. Rejestracja łącznika

W oknie „Nowa aplikacja":

| Pole | Wartość |
| --- | --- |
| Nazwa | musi być unikalna — powtórka daje „Nazwa łącznika już istnieje" |
| Połączenie | `URL serwera` → `https://mcp.otwartyterapeuta.pl/mcp` |
| Uwierzytelnianie | **`Mieszana`** |

Opcje w polu uwierzytelniania: `OAuth`, `Token dostępowy / klucz API`,
`Brak uwierzytelnienia`, `Mieszana`.

**Nigdy nie wybieraj `OAuth`.** Wymusza pełny flow `/oauth/authorize` z wszystkimi
zakresami **przed pierwszym wywołaniem czegokolwiek** — czyli ekran logowania na
wejściu, wprost przeciwko regule produktu. Objawia się też tak, że w panelu widnieje
„0 działań włączonych", a przycisk „Odśwież" mówi *„Aby odświeżyć działania,
aplikacja musi być połączona"*. Klasyczne jajko-kura.

Przy `Mieszana` okno zgody pokazuje trzy przyciski, w tym **„Kontynuuj bez konta"** —
to jest ta właściwa ścieżka do testów katalogowych.

Pole wyboru „Rozumiem i chcę kontynuować" (ostrzeżenie o niesprawdzonych serwerach
MCP) trzeba zaznaczyć, żeby „Utwórz" się odblokowało.

## 3. Cache ChatGPT — najważniejsza sekcja

| Element | Kiedy świeży |
| --- | --- |
| HTML widżetu (`resources/read`) | przy każdym renderze |
| `_meta` narzędzia: CSP, `openai/outputTemplate`, adnotacje | **dopiero po ponownym połączeniu** |
| schematy wejściowe | zwykle szybko, bez gwarancji |

Zasady:

- **Nie zmieniaj `WIDGET_URI`** (`src/env.ts`). Podbicie `v1` → `v2` daje
  `Błąd podczas ładowania aplikacji — Failed to fetch template`, bo klient trzyma
  stary adres. Nowy kod widżetu wchodzi zwykłym `wrangler deploy`.
- Po każdej zmianie w `_meta.ui` (zwłaszcza `csp.resourceDomains`): w ustawieniach
  wtyczki `…` → **Odłącz** → **Połącz** → „Kontynuuj bez konta". Bez tego poprawka
  wygląda na nieskuteczną.
- Zanim uznasz, że poprawka nie działa, sprawdź co serwer **naprawdę** zwraca:

```bash
curl -s -X POST https://mcp.otwartyterapeuta.pl/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'mcp-protocol-version: 2025-06-18' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 2000
```

Trzy razy z rzędu serwer był już poprawny, a problem siedział w kliencie.

## 4. Testowanie na czacie

1. Powierzchnia **Work** wymaga kredytów. Przy pustym saldzie pokazuje „Na razie
   wyczerpano limit użycia Work". Przełącz na **Chat** — działa bez kredytów.
2. Wtyczkę podpina się przyciskiem `+` w polu wpisywania → wybierz z listy.
3. **Sprawdź plakietkę w wysłanej wiadomości.** Łatwo trafić w sąsiednią pozycję
   menu i wysłać zapytanie do `Visualize`, które zrobi własną ładną kartę z
   inicjałami zamiast zdjęcia. Jeśli w dymku widnieje `Visualize`, to nie był
   nasz widżet.
4. Pole wpisywania **nie przyjmuje polskich znaków** przez automatyzację —
   pisz bez diakrytyków, model i tak zrozumie.
5. Argumenty wywołania obejrzysz klikając „Wywołano narzędzie" → strzałka przy
   `{…}`. To jedyny sposób, żeby zobaczyć, co model naprawdę wysłał.

## 5. Pułapki schematu narzędzi

Dwa razy pusty wynik brał się z tego, że model zgadywał wartości:

- **Jednostki.** `price_max` jest w groszach. Model wysyłał `300` przy „budżet
  300 zł". Sam opis „w groszach" nie wystarczył — dopiero przykład liczbowy
  w `describe` („300 zł = 30000").
- **Słowniki.** `topics` przyjmował dowolny slug, a opis odsyłał do zasobu
  `otwarty-terapeuta://slowniki`. Model nigdy go nie otworzył i wysłał angielskie
  `["anxiety","stress"]` → cicho zero wyników. Naprawione przez `z.enum` z pełną
  listą w `src/mcp/schemas.ts` — wartości jadą wtedy w JSON Schema, a błędna
  wartość daje czytelny błąd walidacji zamiast pustki.

**Reguła ogólna: nigdy nie odsyłaj modelu do zasobu po dozwolone wartości.
Wstaw je do schematu.** Enumy muszą pozostać zgodne z tabelami `specialties`
i `modalities` — przy nowej migracji słownikowej dopisz wartość też tam.

## 6. Widżet

- Dane przychodzą przez `window.openai.toolOutput`, a host ogłasza każde
  przypisanie zdarzeniem **`openai:set_globals`**. Kanał `ui/*` po `postMessage`
  w ChatGPT nie wystarcza. Most w `src/widget/bridge.ts` obsługuje oba plus
  krótki odpyt awaryjny.
- Objaw braku danych: widżet stoi na **„Wczytuję dane…"**.
- Obrazy: widżet renderuje się na origin ChatGPT, więc **ścieżka względna trafia
  w zły host**. Adresy zdjęć absolutyzuje `absolutePhoto` w `src/mcp/server.ts` —
  na granicy MCP, nie w `src/db/catalog.ts`, bo tamten DTO karmi też stronę,
  która potrzebuje ścieżek względnych (testy to pilnują).
- CSP: `csp.resourceDomains` musi zawierać origin z `PUBLIC_BASE_URL`, inaczej
  zdjęcie jest blokowane. Czerwona plakietka **„CSP wył."** przy nazwie aplikacji
  pojawia się mimo poprawnej konfiguracji — wygląda na etykietę dla każdej
  aplikacji spoza katalogu.

## 7. Usuwanie i publikacja

- Wtyczka **zainstalowana przez admina w przestrzeni roboczej**: „Usuń" jest
  wyszarzone („Zainstalowano przez administratora"). W panelu admina jest tylko
  **„Wyłącz wtyczkę"**, a okno potwierdzenia wprost mówi *„Aplikacje niestandardowe
  nie zostaną trwale usunięte"*. Trwałego usunięcia po prostu nie ma.
- Wtyczka **osobista** (utworzona przez `+`): menu `…` ma aktywne
  **Usuń**, **Odłącz** i — co najważniejsze — **Publikuj**.
- **„Publikuj"** to droga do publicznego katalogu, czyli do celu z §0. Nie klikaj,
  dopóki `PLUGIN_SUBMISSION_CHECKLIST.md` §10 nie jest zamknięte — w szczególności
  scenariusze kryzysowe z §7.2.

## 8. Kolejność pracy

```
zmiana w kodzie
  → npm run build:widget && npx tsc --noEmit && npx vitest run
  → npx wrangler deploy --env production
  → curl: sprawdź, czy serwer zwraca to, czego oczekujesz
  → jeśli ruszałeś _meta.ui: Odłącz → Połącz → „Kontynuuj bez konta"
  → nowy czat, podepnij wtyczkę, sprawdź plakietkę w dymku
  → rozwiń „Wywołano narzędzie" i obejrzyj argumenty
```

Pomijanie kroku z `curl` kosztowało najwięcej czasu w całej sesji.
