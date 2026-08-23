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
