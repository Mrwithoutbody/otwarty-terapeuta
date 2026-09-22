# Następna sesja: podstrony i wydarzenia w stronach autorskich

Stan na 2026-09-21, wieczór. Wklej sekcję „Prompt” jako pierwszą wiadomość nowej sesji.

## Co już działa (produkcja, wersja `9736a5a7`)

- **Profil terapeutki to strona autorska**, wbudowana w ot-02 (`src/authored/`). Usługę stron
  x402L usunięto z projektu 2026-09-22 w całości - nie ma do czego wracać.
  Terapeutka odpowiada własnymi słowami na pytania pacjentów, strona składa się sama.
  Cztery budowy (Pytaniami / Listem / Drogą / Spisem pytań) × trzy otwarcia (zdjęcie /
  pierwsze zdanie / konkrety). Fakty - cennik, wolne terminy, kwalifikacje z oznaczeniem
  weryfikacji - zawsze z tabel, przy każdym żądaniu. Stopka kryzysowa w rendererze.
- **Narzędzie w panelu**: `/admin/terapeuci/:id/strona` (Odpowiedz → Ułóż → Pokaż światu),
  autozapis szkicu, podgląd tym samym `renderPublic` co Worker. Po zalogowaniu terapeutka
  ląduje właśnie tam.
- **Zakładka „Dane i cennik”** (`src/web/admin-dane.ts`): imię, cennik, gabinet, obszary,
  języki, zasady odwołania, dyplomy. Zapis przez `writeProfileData` (`host-write.ts`).
- **Strażnik faktów** blokuje tylko ceny i terminy wpisane prozą. Kwalifikacji NIE rusza -
  reguła na „certyfik/superwizor” ukryłaby zdania u 7 z 8 realnych osób.
- **Migracja 2026-09-21**: 8 profili z katalogu (7 realnych + demo Marka) dostało stronę
  z danych, które już były (wiersze `authored_pages` o id `ap_mig_*`), z budową dobraną do
  treści. Aleksandra Mazek dostała stronę 2026-09-22 (z jej publicznego opisu).
  Dane profili, FAQ i strony usługi nietknięte - porównane hashami przed i po.

Pliki: `src/authored/{core,store,site,panel,tool,page-css,tool-css}.ts`,
`migrations/0020_authored_pages.sql`, `test/authored.test.ts`, `src/web/admin-dane.ts`,
`src/web/admin.ts` (zakładki), `scripts/build-widget.mjs` (bundel narzędzia).

## Do zrobienia w Google Search Console (od 2026-09-22, po 9:00)

Limit próśb o zindeksowanie (~10 dziennie) wyczerpany 2026-09-21 wieczorem. W Chrome właściciela,
„Sprawdzenie adresu URL” → „Poproś o zindeksowanie”, po kolei:

1. `https://otwartyterapeuta.pl/psychoterapeuta/warszawa` - nowa strona, Google jej nie zna.
2. `https://otwartyterapeuta.pl/` - Google czytał ją 7.09, przed faviconem i nazwą serwisu (19.09).
3. `https://otwartyterapeuta.pl/terapeuci/aleksandra-mazek-ffe4e2df` - nie zmieściła się w limicie.

Już zgłoszone 2026-09-21: `/terapeuci`, obie podstrony, 7 pozostałych profili. Po zrobieniu
usuń tę sekcję.

## Czego jeszcze nie ma

- **Podstrony są (typ `podstrona`), ale tylko publicznie.** Grupa Eweliny i terapia traumy
  Moniki stoją jako strony autorskie; narzędzie w panelu ich nie otwiera - ani do edycji,
  ani do założenia nowej. To reszta punktu 1 niżej.

Gotowe w mechanizmie: rejestr `TYPES` w `core.ts` (pytania, etapy, fakty), renderer i narzędzie
niezależne od typu, kolumna `type` w `authored_pages`, indeks unikalny tylko dla `profil`
(więc wiele stron innych typów na osobę jest już dozwolone). Prototyp wydarzenia leży w
`/home/dadmor/code/PSYCHOTERAPIA/prototypy-stron/dzika-karta/` (`data.js`: `wydarzenie`).

## Kolejność prac

1. **Wiele podstron w narzędziu** (~1 dzień). Zrobione: typ `podstrona`, kolumna `slug`,
   publiczna trasa, pasek, sitemapa. Zostało: lista „Moje strony” w narzędziu, trasy
   `/admin/terapeuci/:id/strona/:pageId`, zakładanie i edycja podstrony, adres z tytułu.
2. **Wydarzenie** (~2 dni): fakty z danych - data, godzina, miejsce, cena, liczba miejsc -
   w osobnej tabeli, renderery tych faktów, formularz danych wydarzenia w narzędziu.
   Pytania z prototypu („Dla kogo to jest?”, „Czy muszę się odzywać przy innych?”…).
3. **Zapisy na wydarzenie** (~3 dni): limit miejsc liczony transakcyjnie w D1, dane
   zapisanych szyfrowane jak przy rezerwacjach (`encryptPii`), mail z potwierdzeniem przez
   outbox. Obecny indeks `idx_bookings_one_active_per_slot` pozwala na jedną rezerwację
   na slot - zapisy potrzebują własnej tabeli uczestników.
4. ~~Przeniesienie podstron z x402L i odcięcie mostu~~ - zrobione 2026-09-22.

**Nie zaczynać bez decyzji właściciela:** gabinet (kto edytuje stronę gabinetu, zgoda członków
zespołu), blog (inny kształt treści: wpisy z datą), sklep (strona produktu tak; sprzedaż,
płatności, faktury - osobny system albo link do zewnętrznego sklepu).

## Zasady, których się trzymać

- **Realne dane.** 8 realnych terapeutek, znajome właściciela, wiedzą, że to beta - ale dane
  są prawdziwe. Każda migracja treści: odczyt przed → generacja tym samym kodem co produkcja
  (esbuild bundel `store.ts`/`core.ts`, nie przepisana logika) → raport, co zostałoby ucięte
  albo ukryte → tylko `INSERT` nowych wierszy, żadnych zmian w istniejących kolumnach →
  odczyt po i porównanie hashami → sprawdzenie na produkcji, że każdy akapit jest na stronie.
  Przed zmianą: `npx wrangler d1 time-travel info DB --env production` (bookmark do raportu).
  Lokalne kopie realnych danych kasować po migracji.
- **Deploy** jak w `CLAUDE.md`: lista commitów i liczba realnych osób do właściciela przed
  produkcją, id wdrożonej wersji do rollbacku. Kolejność: migracja → build → deploy.
- **Testowanie przed produkcją**: preview nie wysyła maili (brak `EMAIL_API_KEY`) i nie ma R2.
  Działa lokalnie: `npx wrangler dev --port 8787 --local-protocol https` (ciasteczko sesji ma
  prefiks `__Host-`, po http przeglądarka je odrzuca). Logowanie: `POST /admin/login` adresem
  z `ADMIN_BOOTSTRAP_EMAILS` w `.dev.vars`, kod z logu serwera (tryb `console`), sesja do okna
  Chrome przez Playwright (`channel: 'chrome'`, `ignoreHTTPSErrors`, `addCookies`). Właściciel
  chce dostać otwarte, zalogowane okno - nie instrukcję z mailem i kodem.
- Ceny, terminy, liczba miejsc - zawsze z danych, nigdy z tekstu. Stopka kryzysowa w każdej
  stronie publicznej, poza stanem strony.
- Właściciel: decyzje inżynierskie podejmuj sam i raportuj; pytaj tylko o cel i wygląd.
  Wynik pokazuj w przeglądarce, nie opisem.

## Prompt

```
Kontynuujemy strony autorskie w ot-02. Przeczytaj NASTEPNA_SESJA_PODSTRONY.md i sekcję
„System stron” w CLAUDE.md.

Zadanie: podstrony w narzędziu panelu (reszta punktu 1), potem wydarzenie z faktami z danych
(data, godzina, miejsce, cena, liczba miejsc) - w kolejności punktów 1 i 2 pliku. Zapisy na
wydarzenie (punkt 3) dopiero po moim OK.

Przed kodem: sprawdź, czy produkcja nadal ma wersję 9736a5a7 i czy ktoś z terapeutek
zmieniał już swoją stronę (authored_pages: draft_json <> published_json albo
updated_at <> published_at) - raport w dwóch zdaniach.

Po każdym punkcie: testy, preview lokalnie po HTTPS i otwarte zalogowane okno Chrome
z narzędziem i gotową stroną, żebym mógł kliknąć. Na produkcję nic bez mojego „wdrażaj”.
```
