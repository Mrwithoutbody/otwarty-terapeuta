# Panel terapeutki — `apps/panel`

## Zakres i komendy

Obszar: `/admin` (role `admin`, `therapist`, `support`), `/dla-terapeutow` (rejestracja
terapeutki), narzędzie strony autorskiej, zakładki „Dane i cennik" i „Dostępność",
zdjęcia do R2, zasoby `/assets/{app.css, admin.css, admin.js, strona-panel.css,
strona-panel.js}`. Trasy montuje `apps/panel/index.ts`.

- `npm test -- apps/panel` — 7 plików, 41 testów; przed commitem pełne `npm test`.
- `npm run typecheck`, `npm run lint` — z korzenia repo, nie z `apps/panel`.
- `npm run dev:panel` — **https** na `:8792`. Po http przeglądarka odrzuca ciasteczko
  `__Host-ot_admin` i logowanie nie działa.

`apps/panel/**` importuje wyłącznie z `shared/`; pilnuje tego `no-restricted-imports`
w `eslint.config.js` (testy obszaru są z reguły zwolnione). Kod potrzebny też portalowi
albo MCP przenieś do `shared/` razem ze wszystkimi wołającymi, w jednym commicie.

## Narzędzie strony

Po zalogowaniu terapeutka (rola `therapist`) ląduje prosto w
`/admin/terapeuci/:id/strona` — to jej jedyna strona panelu. Trasy narzędzia są
w `apps/panel/authored/panel.ts`: widok, `PUT /szkic` (autozapis), `POST /publikuj`,
`POST /zdjecie`.

- Podgląd rysuje **ten sam** `renderPublic` z `shared/authored/core.ts`, którego używa
  Worker na `/terapeuci/:slug`. Drugiego renderera nie pisz.
- Publikacja (`publish` w `shared/authored/store.ts`) przepisuje jej słowa do
  `therapists.headline`, `bio`, `first_meeting_*` i wierszy `faq_items`. To kontrakt
  z katalogiem i wtyczką ChatGPT: czytają ten sam tekst. Zmiana tych kolumn dotyka
  portalu i MCP.
- `TOOL_JS` w `apps/panel/authored/tool-generated.ts` to bundel
  `apps/panel/authored/tool.ts` robiony przez `scripts/build-widget.mjs` (plik
  generowany, poza gitem). Zmiana w `shared/authored/core.ts` zmienia JS panelu —
  po niej `npm run build:widget`.
- Strażnik faktów (`guard` w `core.ts`) blokuje tylko ceny i terminy wpisane prozą.
  Kwalifikacji nie rusza.
- Publikacja pinguje IndexNow na `/terapeuci/<slug>` (tylko produkcja).

## Dane i cennik

Fakty, nie słowa: `FIELDS` i `patchesFor` w `apps/panel/web/data-fields.ts`, formularz
w `apps/panel/web/admin-dane.ts`, zapis `writeProfileData` w
`apps/panel/web/profile-write.ts`.

- Formularz nie niesie znacznika `verified` (nadaje go administrator w zakładce
  „Weryfikacja"), więc zapis scala kwalifikacje po nazwie i wydającym i dokłada wpisy
  spoza widocznych `CREDENTIAL_ROWS`. Zapis wprost skasowałby weryfikację i obciął listę.
- Zdjęcie: `POST /admin/terapeuci/:id/strona/zdjecie`, ≤ `PHOTO_MAX_BYTES` (2 MB), typ
  z magic bytes (`sniffImageType`), nie z nagłówka. Portret i miniatura dzielą klucz R2,
  miniatura z przyrostkiem `-160` — katalog wyprowadza jej adres z adresu portretu.
- Zapis danych i zmiana statusu profilu pingują IndexNow.

## Bezpieczeństwo

- Sesja: `__Host-ot_admin`, HttpOnly, Secure, SameSite=Lax, 8 h. W bazie tylko HMAC
  sekretu (`TOKEN_SIGNING_KEY`), nigdy sam sekret.
- CSRF: token wyprowadzony HMAC-iem z sekretu sesji, nie trzymany w bazie. Formularze
  wysyłają pole `csrf`, narzędzie strony nagłówek `x-csrf`. Każda trasa zapisu woła
  `verifyCsrf`.
- `ownsTherapist()` w każdej trasie zapisu: `therapist` tylko swój profil, `support`
  tylko rezerwacje i odwołanie, bez notatek weryfikacyjnych i kontaktów.
- Turnstile na `POST /admin/login` i w rejestracji; `verifyTurnstile` fails closed
  (brak sekretu albo błąd sieci = niezweryfikowany).
- Panel i `/dla-terapeutow` renderują się z `noindex`.
- Kontakty zapisane przez MCP panel odszyfrowuje tym samym `PII_ENC_KEY`; e-mail
  terapeutki szyfruje rejestracja. Rotacja któregoś klucza osierocia dane.

## Grafik i czas

`apps/panel/db/slots.ts`: grafik tygodniowy siedzi w `session_offers.schedule` (per
oferta, bo „online" i „w gabinecie" bywają w inne dni), urlop w `therapist_time_off`,
terminy w `appointment_slots` na `HORIZON_DAYS` = 56 dni.

- Cron co 5 minut (`wrangler.jsonc` → `scheduled` w `worker.ts`) woła
  `fillFromSchedules(env)` i dokłada ogon tym kalendarzom, którym zostało mniej niż
  tydzień. Po zdjęciu urlopu panel woła je od razu z `therapistId`, bo dziura jest
  w środku.
- Terminy powstają z **lokalnej** daty i godziny przez `zonedTimeToUtc`: „10:00
  Europe/Warsaw" zostaje dziesiątą po obu stronach zmiany czasu. Unikalność
  `(therapist_id, starts_at_utc)` czyni wstawienia idempotentnymi.
- Nieznana strefa = 400, nie ciche `Europe/Warsaw`.
- Operacje panelu na slotach i odwołanie rezerwacji przez personel idą prosto do D1.
  `TherapistBookingCoordinator` serializuje tylko rezerwacje z MCP; ostatnią zaporą
  jest `idx_bookings_one_active_per_slot`.

## Podgląd

Skill `podglad-panelu` (`apps/panel/.claude/skills/podglad-panelu/SKILL.md`): dev:panel
po https, logowanie kodem z logu serwera, otwarte zalogowane okno Chrome. Właściciel
chce kliknąć, nie przeczytać instrukcji z mailem i kodem.

## Kolejne prace

Stan rzeczy, nie obietnice. Nic z tej listy nie zaczynaj bez decyzji właściciela.

- **Strona Aleksandry Mazek** powstała 2026-09-22 z jej publicznego opisu — **do
  akceptacji przez nią**. Jej tekstu nie zmieniaj i nie publikuj bez tej zgody.
- **Przed zmianą w renderowaniu stron autorskich** sprawdź, czy któraś terapeutka
  zmieniała już swoją stronę: `authored_pages` z `draft_json <> published_json` albo
  `updated_at <> published_at`. Raport dwoma zdaniami. To 8 realnych osób, nie fixture;
  zapis do ich wierszy → skill `migracja-realnych-danych`.
- **Podstrony** (typ `podstrona`) działają publicznie — na produkcji stoją dziś dwie,
  `ewelina-mastalerz-…/grupa-wsparcia-dla-rodzicow` i `monika-tarczynska-…/terapia-traumy`,
  obie realnych osób. Narzędzie panelu ich nie otwiera — ani do edycji, ani do
  założenia. Gotowe w mechanizmie: `TYPES`
  w `shared/authored/core.ts`, kolumny `type` i `slug` w `authored_pages`, indeks
  unikalny tylko dla `profil` (wiele stron innych typów na osobę już wolno). Zostało:
  lista „Moje strony", trasy `/admin/terapeuci/:id/strona/:pageId`, adres z tytułu.
- **Wydarzenie**: fakty z danych (data, godzina, miejsce, cena, liczba miejsc) w osobnej
  tabeli, renderery tych faktów, formularz danych wydarzenia w narzędziu. Prototyp leży
  w `/home/dadmor/code/PSYCHOTERAPIA/prototypy-stron/dzika-karta/` (`data.js`:
  `wydarzenie`) — stamtąd pytania („Dla kogo to jest?", „Czy muszę się odzywać przy
  innych?").
- **Zapisy na wydarzenie** — dopiero po „OK" właściciela: limit miejsc liczony
  transakcyjnie w D1, dane zapisanych szyfrowane jak przy rezerwacjach (`encryptPii`),
  mail z potwierdzeniem przez outbox. `idx_bookings_one_active_per_slot` pozwala na
  jedną rezerwację na slot, więc zapisy potrzebują własnej tabeli uczestników.
- **Gabinet, blog, sklep**: bez decyzji właściciela nie zaczynaj.
