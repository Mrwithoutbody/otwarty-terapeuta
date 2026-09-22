---
name: migracja-realnych-danych
description: Procedura zapisu do wierszy realnych terapeutek na produkcyjnym D1 — sprawdzenie, czyją stronę ktoś już edytował, bookmark time-travel, odczyt przed, generacja kodem produkcyjnym, raport co zostanie ucięte, tylko INSERT, porównanie hashami, sprawdzenie na żywo, skasowanie lokalnych kopii. Użyj przy każdej migracji treści, skrypcie lub backfillu dotykającym `therapists`, `authored_pages`, `faq_items` albo `session_offers` na produkcji.
---

# Migracja realnych danych

Realne terapeutki to znajome właściciela. Wiedzą, że to beta, ale **dane są
prawdziwe i napisane przez nie**. Nadpisany akapit to nie bug — to cudzy tekst,
którego nikt nie odtworzy.

Dotyczy każdego zapisu do produkcyjnego D1 spoza panelu. Lokalnie
(`npm run db:reset:local`) rób co chcesz.

## 0. Czyją stronę ona sama już zmieniła (najpierw, zawsze)

```bash
npx wrangler d1 execute DB --env production --remote --json --command \
"SELECT t.slug, a.type, a.slug AS strona,
        a.draft_json <> COALESCE(a.published_json,'') AS szkic_inny,
        a.updated_at, a.published_at
   FROM authored_pages a JOIN therapists t ON t.id = a.therapist_id
  ORDER BY t.slug"
```

`szkic_inny = 1` albo `updated_at <> published_at` = pisała po migracji.
Jej wiersza **nie ruszasz**. Zgłoś listę takich osób właścicielowi i czekaj na
decyzję co do nich; resztę możesz prowadzić dalej. To zapytanie jest tylko do
odczytu — pisanie do produkcji zaczyna się w kroku 5.

## 1. Bookmark time-travel

```bash
npx wrangler d1 time-travel info DB --env production
```

Bookmark idzie do raportu, zanim cokolwiek napiszesz. To jedyne cofnięcie —
rollback Workera nie cofa D1.

## 2. Odczyt przed

Zrzuć wszystkie wiersze, których dotknie migracja, do katalogu **poza repo**
(katalog tymczasowy sesji) i policz `sha256sum` każdego. Bez tego krok 6 nie ma
z czym porównywać.

## 3. Generuj tym samym kodem, co produkcja

Nie przepisuj logiki do skryptu. Zbundluj `shared/authored/store.ts` i
`shared/authored/core.ts` esbuildem — dokładnie tak, jak robi to
`scripts/build-widget.mjs` dla narzędzia panelu:

```bash
npx esbuild shared/authored/store.ts --bundle --format=esm --platform=node \
  --outfile=<katalog tymczasowy>/store.mjs
```

Stamtąd bierzesz `seedDraft`, `normalizeDraft` i `guard`. Przepisana „taka sama"
logika rozjeżdża się z rendererem i wychodzi dopiero na żywej stronie.

## 4. Raport: co zostałoby ucięte albo ukryte

Zanim cokolwiek zapiszesz, przepuść wygenerowaną treść przez `guard()` i `LIMITS`
z `core.ts` i wypisz:

- każde zdanie oznaczone przez strażnika (`kwota`, `termin`) — strażnik blokuje
  publikację, więc taki wiersz wjedzie i zostanie nieopublikowany;
- każde pole dłuższe niż `LIMITS` (`title` 140, `line` 200, `answer` 4000,
  `question` 200, `custom` 20 pozycji) — nadmiar przepada.

Raport idzie do właściciela razem z bookmarkiem. Zero ucięć = też napisz.

## 5. Tylko INSERT

Nowe wiersze z własnymi id. Żadnego `UPDATE` ani `DELETE` na istniejących
kolumnach, żadnego `INSERT OR REPLACE`. Plik `.sql` przez
`npx wrangler d1 execute DB --env production --remote --file=<plik>`.
Wcześniej ten sam plik na lokalnej bazie po `npm run db:reset:local`.

## 6. Odczyt po i porównanie hashami

Powtórz krok 2. Hashe wierszy, których migracja nie miała dotykać, muszą być
**identyczne**. Różnica = zatrzymaj się i zgłoś, nie „popraw" drugim skryptem.

## 7. Sprawdzenie na produkcji

```bash
curl -s https://otwartyterapeuta.pl/terapeuci/<slug> | grep -c '<p>'
```

Dla każdej dotkniętej osoby otwórz stronę i sprawdź, że każdy akapit tam jest.
Wiersz w bazie to nie to samo co akapit na stronie.

## 8. Skasuj lokalne kopie

Zrzuty z kroków 2 i 6 oraz wygenerowane pliki zawierają realne dane — usuń je po
migracji. W repo nie ląduje nic z produkcji.
