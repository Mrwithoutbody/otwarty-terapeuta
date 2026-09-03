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
Pomiar pokazał odwrotność: trzy ilustracje `public/illustrations/*.webp` są w
95–100% ciepłe — odcień 45° (bursztyn, piasek) i 30° (glina), zieleni poniżej
jednego procenta. Ciepło głównej niesie **treść**, nie CSS. Trzy rundy
cofania.

**Jak to stosować:** jedna przyczyna poparta pomiarem zamiast listy trzech
domysłów. Przy zmianie odcienia sprawdź, czy nowa wartość leży na osi serwisu
(wszystkie powierzchnie: odcień 56–95, większość 64–70), zanim ją wdrożysz.

## Kompozycja profili: reguły wymuszone rundami cofnięć (2026-08-25)

- **Jeden akcent typograficzny i najwyżej jeden dodatkowy ciemny blok na
  stronę** (poza domyślnym ciemnym zamknięciem). Ciemne tło nigdy na tabeli
  danych. Pasy+plakat+duża skala+ciemne naraz = odrzucone jako „katastrofa".
- **Kalendarz slotów = tabela dni w kolumnach (wzór ZnanyLekarz). Nie
  przerabiać.** Dwie próby redesignu (karty dni, wiersze z chipami) cofnięte
  w całości; wolno poprawiać tylko stopkę i odstępy.
- **Portret nie w plakatowym hero** — tam jest polem opcjonalnym, domyślnie
  wyłączonym; zdjęcie mieszka w sekcji „Jak pracuję" (intro, psplit).
- **Motyw = para akcentów**: `--accent-strong` + `--accent-2` (dopełniający
  ~180° w HSL, kontrast ≥ 4.5 na tle motywu; papier celowo achromatyczny).
  Konsumenci accent-2: kreska cytatu, numery kroków, etykiety siatki usług.
  To jest kontrakt przyszłego MCP do zarządzania szablonami.
- Krótka treść (np. zasady odwołania) → wąska taśma, nie pełny pas; zasady
  odwołania renderuje stopka bloku kalendarza, nie osobny rozdział.
- **Grafiki**: relacja `therapist_media`, portret to wskaźnik na jeden z
  wierszy. Upload niczego nie kasuje z R2; pliki znikają tylko przez „Usuń"
  w panelu. Seed przenosi zdjęcia i media dem przez reseed (tabele `_seed_*`)
  — pełny seed na produkcji był raz skasował wgrane zdjęcie.

## Deploy: produkcja leży na koncie Cloudflare `b1277ebcf49382e42bc5c111cd6adce3`

Baza D1 produkcji: `9186df20-81e8-405b-aa74-b8812c082751`. Jeśli `npx wrangler whoami`
nie pokazuje tego konta, `npm run db:migrate:prod` i `wrangler deploy --env production`
padają z „not authorized [code: 7403]" (2026-09-02: zalogowane było tylko ANNA:R).
Wtedy poproś o `! npx wrangler login` na właściwym koncie — `CLOUDFLARE_ACCOUNT_ID` bez
dostępu do konta nic nie da. Kolejność na produkcji: migracja → `npm run build:widget &&
npx wrangler deploy --env production`.

## Strony terapeutek żyją w usłudze stron (2026-09-03)

Profil i podstrony to strony w `x402landings.space` (repo `x402Landings`), nie
w D1 ot-02. ot-02 tylko przysyła dane bloków (`host-blocks.ts`) i osadza edytor
usługi w iframie. Szczegóły i kontrakt: `X402_LANDINGS_INTEGRATION.md`.

- Nowy blok danych = wpis w `HOST_SECTIONS`; usługa dowiaduje się o nim sama
  (`PUT /v1/site/blocks` przed każdą sesją edycji). Żadnego skryptu po deployu.
- Produkcja wymaga sekretu `PAGES_API_KEY` (klucz site'u `ot-02` w usłudze;
  `npm run site:create` po stronie x402Landings). Bez niego `assertConfig` odmawia.
- Kolejność zmian w kontrakcie: najpierw usługa (testy + deploy), potem ot-02.
- Awaria usługi nie zdejmuje profili: kopia w R2, nagłówek `x-pages-stale: 1`.

