# Otwarty Terapeuta — reguły projektu

## Odbiorca: KAŻDY użytkownik ChatGPT. Także darmowy.

**Twarde wymaganie produktowe.**

Docelowo wtyczkę ma móc dodać i użyć **dowolna osoba szukająca terapeuty** —
z konta darmowego, Plus, Pro czy Business, bez zaproszenia do jakiejkolwiek
przestrzeni roboczej i bez trybu programisty. Punktem dostarczenia jest
**publiczny katalog aplikacji w ChatGPT**.

Z tego wynika, co jest, a co nie jest ukończoną pracą:

- Wtyczka w przestrzeni roboczej Business albo w trybie programisty to
  **wyłącznie etap testowy**. Nigdy nie jest to dostarczenie produktu i nigdy
  nie należy tego tak raportować.
- Rozwiązanie, które wymaga od osoby szukającej terapeuty płatnego konta,
  zaproszenia do workspace albo ręcznego wklejania adresu serwera MCP, jest
  **niezgodne z wymaganiem** — nawet jeżeli technicznie działa.
- Każda decyzja techniczna (uwierzytelnianie łącznika, zakresy, widżet,
  instrukcje serwera) ma być podejmowana pod kątem anonimowego użytkownika
  z darmowego konta, który pierwszy raz widzi tę aplikację.

**Dlaczego:** produkt istnieje po to, żeby osoba w kryzysie znalazła terapeutę.
Zamknięcie go za płatnym planem albo za firmową przestrzenią roboczą przekreśla
sens całego przedsięwzięcia.

**Jak to stosować:** przy planowaniu prac mierz postęp odległością od publikacji
w katalogu OpenAI, nie od działającego demo u siebie. Kolejność: naprawa
konfiguracji → testy §7 w trybie programisty → zgłoszenie publiczne → dopiero
wtedy `PUBLIC_PLUGIN_URL` i CTA na stronie.

## Logowanie: TYLKO przy operacjach zapisu. Nigdy do przeglądania.

**Twarde ograniczenie produktowe. Nie podlega negocjacji.**

Przeglądanie katalogu MUSI działać w pełni anonimowo:

- wyszukanie terapeutów (`search_therapists`)
- odczyt profilu (`get_therapist_profile`)
- odczyt FAQ (`get_therapist_faq`)
- lista wolnych terminów (`list_available_slots`)
- zasoby kryzysowe (`get_crisis_resources`)
- widżet (`render_otwarty_terapeuta_widget`)

Prośba o e-mail, hasło albo jakiekolwiek logowanie jest dozwolona **wyłącznie**
wtedy, gdy użytkownik sam inicjuje operację prywatną lub zapis:

- utworzenie rezerwacji (`create_booking`)
- odwołanie rezerwacji (`cancel_booking`)
- podsumowanie przed rezerwacją (`preview_booking`)
- lista własnych rezerwacji (`list_my_bookings`)
- dodanie opinii

Wymuszanie logowania po to, żeby **zobaczyć profil terapeuty**, jest **zabronione**.

**Dlaczego:** to rdzeń obietnicy produktu („logowanie wymagane dopiero przy
rezerwacji"). Ekran proszący o e-mail, zanim pokaże się cokolwiek z katalogu,
czyta się jak phishing i właściciel produktu zgłosiłby go jako phishing. Osoby
szukające terapeuty są w trudnym momencie — żądanie danych kontaktowych za sam
podgląd publicznego profilu niszczy zaufanie i łamie minimalizację danych z
`DPIA_CHECKLIST.md`.

**Jak to stosować:**

Serwer MCP jest zbudowany poprawnie — narzędzia katalogowe są publiczne
(`securitySchemes: noauth`), a prywatne zwracają `_meta["mcp/www_authenticate"]`,
więc klient uruchamia autoryzację leniwie, dopiero przy realnej potrzebie.

Pułapka jest po stronie **konfiguracji klienta**. Zarejestrowanie łącznika w
ChatGPT z `Uwierzytelnianie: OAuth` powoduje, że ChatGPT przechodzi pełny flow
`/oauth/authorize` (zakresy `catalog:read booking:read booking:write`) **przed
pierwszym wywołaniem jakiegokolwiek narzędzia** — czyli wymusza logowanie na
wejściu, tylko po to, żeby przeglądać. Łącznik ma być rejestrowany **bez
uwierzytelniania**; OAuth ma się włączać dopiero w momencie wywołania narzędzia
rezerwacyjnego.

Przy każdej zmianie w `src/mcp/security.ts`, endpointach OAuth albo konfiguracji
łącznika: sprawdź od nowa, że anonimowa ścieżka katalogowa działa end-to-end.

Poprawka: opcja `Mieszana` w polu „Uwierzytelnianie" robi dokładnie to, co trzeba —
narzędzia katalogowe anonimowo, OAuth dopiero przy rezerwacyjnym. Ekran zgody
pokazuje wtedy przycisk **„Kontynuuj bez konta"**.

## Cache ChatGPT — co się odświeża, a co nie

Zmarnowane trzy rundy debugowania. Zapamiętaj podział:

| Element | Kiedy się odświeża |
| --- | --- |
| HTML widżetu (`resources/read`) | **przy każdym renderze**, zawsze świeży po deployu |
| `_meta` narzędzia — CSP, `openai/outputTemplate`, adnotacje | **dopiero po ponownym połączeniu** wtyczki |
| schematy wejściowe narzędzi | zwykle szybko, ale bez gwarancji |

Wnioski, które kosztowały najwięcej:

- **Nie zmieniaj `WIDGET_URI`.** Nowy kod widżetu wchodzi zwykłym deployem. Podbicie
  wersji adresu daje `Błąd podczas ładowania aplikacji — Failed to fetch template`,
  bo ChatGPT ma stary adres w cache, a serwer już go nie zna.
- Zmiana czegokolwiek w `_meta.ui` (najczęściej `csp.resourceDomains`) **wymaga**
  w ustawieniach wtyczki: `…` → **Odłącz** → **Połącz** → „Kontynuuj bez konta".
  Sam deploy nie wystarczy i objawia się jako „poprawka nie działa".
- Zanim uznasz poprawkę za nieskuteczną, sprawdź `curl`-em, co serwer faktycznie
  zwraca w `tools/list` i `resources/read`. Trzy razy okazało się, że serwer był
  już dobry, a patrzyłem na cache klienta.

## Kolorystyka: najpierw pomiar, potem teza

Zanim postawisz jakiekolwiek twierdzenie o kolorach („ta strona jest zielona",
„to pasuje do palety", „tu brakuje ciepła"), **zmierz**:

- tokeny z `:root` w `src/web/styles.ts` przelicz na HSL — odcień, nasycenie,
  jasność, nie same nazwy hex;
- dominujące barwy zdjęć i ilustracji policz z pikseli (PIL: histogram
  odcieni, udział barw ciepłych).

Liczby podaj w odpowiedzi razem z wnioskiem.

**Dlaczego:** wrażenie kolorystyczne strony budują obrazy i gradienty, nie
lista tokenów. Ocena „na oko" ze zrzutu myli chromę z jasnością. 2026-08-24
uznałem, że strona główna „też jest tylko zielona", i na tej podstawie
pchnąłem profile jeszcze dalej w chłodny szałwiowy (`#e9efe0`, odcień 84°).
Pomiar pokazał odwrotność: ciepło głównej niosła **treść** (obrazy), nie CSS.
Trzy rundy cofania.

**Jak to stosować:** jedna przyczyna poparta pomiarem zamiast listy trzech
domysłów. Przy zmianie odcienia sprawdź, czy nowa wartość leży na osi serwisu
(wszystkie powierzchnie: odcień 56–95, większość 64–70), zanim ją wdrożysz.

## Aktualny system stron i motywów

Strony terapeutek i landingi renderuje `x402Landings`. Motyw jest tam folderem
plików Mustache (`theme.json`, `layout.html`, `style.css`, bloki i partials),
który można wgrać przez API. `ot-02` nie zawiera rendererów ani CSS-u tych stron;
przekazuje dane bloków i korzysta z kontraktu w `X402_LANDINGS_INTEGRATION.md`.

## Deploy: produkcja leży na koncie Cloudflare `b1277ebcf49382e42bc5c111cd6adce3`

Baza D1 produkcji: `9186df20-81e8-405b-aa74-b8812c082751`. Jeśli `npx wrangler whoami`
nie pokazuje tego konta, `npm run db:migrate:prod` i `wrangler deploy --env production`
padają z „not authorized [code: 7403]" (2026-09-02: zalogowane było tylko ANNA:R).
Wtedy poproś o `! npx wrangler login` na właściwym koncie — `CLOUDFLARE_ACCOUNT_ID` bez
dostępu do konta nic nie da. Kolejność na produkcji: migracja → `npm run build:widget &&
npx wrangler deploy --env production`.

**Deploy wypuszcza wszystko zaległe, nie tylko twój commit.** Zanim puszczysz produkcję,
`npx wrangler deployments list --env production` daje wdrożoną wersję, a
`git log <ta-wersja>..HEAD --oneline` — listę, która wyjedzie na żywo. Ta lista idzie do
właściciela **przed** deployem, razem ze zdaniem, ilu realnych terapeutek dotknie
(katalog `/terapeuci` minus profile `-demo`). Notuj id wdrożonej wersji od razu: rollback
to wtedy `npx wrangler rollback <id> --env production --message "<powód>"`, jedna komenda.
Host renderuje na żywo, więc deploy zmienia strony wszystkim w tej samej sekundzie.
(2026-09-17: deploy na prośbę „zdeployuj hosta" wypuścił dziesięć dni zaległych commitów
i przestawił wygląd jedenastu profili, w tym siedmiu realnych osób; rollback po 7 min 48 s.)

**Blok hosta i jego wpis w motywie to jedna zmiana w dwóch repo.** Nowa sekcja
w `HOST_SECTIONS` potrzebuje po stronie x402L wpisu w `themes/<motyw>/sklad.json`:
`order` (kolejność), `kinds`, `layouts`, czasem `media`. Bez wpisu `host.ts` liczy
`order.indexOf(source)` = −1 i sekcja spada na koniec strony, za CTA, w domyślnym układzie
kategorii. Na produkcję idą razem albo wcale: usługa pierwsza, host po niej. Sam host
z blokiem, którego wdrożony motyw nie zna, wychodzi gorzej niż stan sprzed zmiany.

## Strony terapeutek żyją w usłudze stron (2026-09-03)

Profil i podstrony to strony w `x402landings.space` (repo `x402Landings`), nie
w D1 ot-02. ot-02 tylko przysyła dane bloków (`host-blocks.ts`) i linkuje do
edytora usługi. Szczegóły i kontrakt: `X402_LANDINGS_INTEGRATION.md`.

- Nowy blok danych = wpis w `HOST_SECTIONS`; usługa dowiaduje się o nim sama
  (`fields` i `locks` w każdym `POST /v1/edit-session`). Żadnego skryptu po deployu.
- **Edytor stron zapisuje dane profilu do tej bazy dopiero od 2026-09-19.** Wcześniej
  `host-write.ts` (ścieżka `data`) żył tylko w testach - usługa odsyłała samą stronę.
  Zanim utniesz cokolwiek w panelu „bo edytor to robi", otwórz sesję edycji na preview
  i sprawdź `GET <adres edytora>/data` oraz zapis w D1. Zielone testy po obu stronach
  nie dowodzą, że usługi ze sobą rozmawiają (2026-09-19: cięcie zakładki „Dane" na tej
  podstawie, rollback po ~30 min).
- Od 2026-09-19 edytor to **jedyna** droga edycji treści: imię, adres profilu, zdjęcie, opis,
  gabinet, obszary, cennik, FAQ, pierwsze spotkanie. Terapeutka po zalogowaniu ląduje w edytorze
  swojego profilu (`/admin` → `/admin/terapeuci/<id>?edytor`); pod nim zakładki Strony, Dostępność,
  Rezerwacje. W panelu zostaje tylko to, czego strona nie niesie albo czego terapeutka nie może
  sama sobie nadać: grafik, rezerwacje (szyfrowane dane kontaktowe nie jadą do usługi stron),
  weryfikacja i publikacja (zakładka administratora). Awaria usługi = brak edycji treści do jej
  powrotu; strony stoją dalej z kopii w R2.
- Zdjęcie wybrane w oknie mediów edytora leży w R2 usługi; `host-write.ts` kopiuje je przy
  zapisie do naszego R2 (`adoptPhoto`), bo widżet ChatGPT wpuszcza obrazy tylko z naszego
  originu, a zmiana `resourceDomains` wymaga ponownego podłączenia wtyczki. Przyjmuje wyłącznie
  pliki z originu usługi. Stary portret, którego nie używa żadna jej strona, znika (`pruneMedia`).
- Produkcja wymaga sekretu `PAGES_API_KEY` (klucz site'u `ot-02` w usłudze;
  `npm run site:create` po stronie x402Landings). Bez niego `assertConfig` odmawia.
- Kolejność zmian w kontrakcie: najpierw usługa (testy + deploy), potem ot-02.
- Edytor otwiera się **w oknie dialogowym** na niemal całe okno panelu (2026-09-06):
  zakładka „Strony" listuje profil i podstrony, klik w tytuł ładuje ramkę z własną
  trasą `/admin/terapeuci/:id/strony/:pid`, która przekierowuje 303 do usługi.
  Panel nie tworzy sesji edytora przy renderze — dopiero przy kliknięciu.
- Awaria usługi nie zdejmuje profili: kopia w R2, nagłówek `x-pages-stale: 1`.

