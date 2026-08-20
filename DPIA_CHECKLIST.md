# Checklista przed oceną prawną i DPIA — Otwarty Terapeuta

**Ten dokument nie jest DPIA i nie stwierdza zgodności z RODO.** Jest materiałem
wejściowym dla prawnika i klinicysty: opisuje, co system faktycznie robi, i wypisuje
pytania, na które trzeba odpowiedzieć **przed** uruchomieniem produkcyjnym.

## 0. Dlaczego DPIA jest prawdopodobnie wymagana

Przetwarzanie łączy trzy czynniki, które w wytycznych EROD podnoszą ryzyko:

1. dane dotyczące zdrowia (powiązanie osoby z terapeutą o określonej specjalizacji),
2. osoby w potencjalnie trudnej sytuacji życiowej,
3. nowa technologia w roli pośrednika (asystent oparty na dużym modelu językowym).

Ocena skutków dla ochrony danych powinna zostać przeprowadzona przed rozpoczęciem
przetwarzania danych realnych osób.

---

## 1. Role i podstawy prawne — **BLOKUJĄCE**

- [ ] Kto jest administratorem danych: operator serwisu, terapeuta, czy współadministrowanie?
- [ ] Jeśli współadministrowanie — czy jest uzgodnienie w rozumieniu art. 26 RODO?
- [ ] Podstawa prawna dla każdej kategorii (art. 6):
      konto, rezerwacja, powiadomienia, audyt.
- [ ] Czy powiązanie osoba ↔ terapeuta o wąskiej specjalizacji stanowi dane
      o zdrowiu w rozumieniu art. 9? Jeśli tak — jaki wyjątek z ust. 2?
- [ ] Czy zgoda jest właściwą podstawą, czy jest to wykonanie umowy?
- [ ] Umowy powierzenia: Cloudflare (Workers, D1, R2, DO), dostawca poczty.
- [ ] Rejestr czynności przetwarzania.
- [ ] Czy trzeba powołać inspektora ochrony danych?

## 2. Lokalizacja danych i transfery — **BLOKUJĄCE**

- [ ] Gdzie fizycznie znajdują się dane D1? Czy ustawić lokalizację EU?
- [ ] Czy Durable Objects wymagają `jurisdiction: 'eu'`?
- [ ] Czy dostawca poczty przetwarza dane poza EOG? Jaki mechanizm transferu?
- [ ] Czy odpowiedzi narzędzi MCP trafiające do OpenAI stanowią transfer, który
      trzeba opisać użytkownikowi?

## 3. Granice kliniczne — **BLOKUJĄCE**

- [ ] Przegląd przez klinicystę: czy komunikaty produktu (strona, widżet, teksty
      narzędzi) nie sugerują diagnozy, kwalifikacji ani gwarancji skuteczności?
- [ ] Przegląd ścieżki kryzysowej: czy instrukcje serwera i opis
      `get_crisis_resources` skutecznie skłaniają model do pominięcia zwykłego
      dopasowania w sytuacji zagrożenia?
- [ ] Testy akceptacyjne scenariuszy kryzysowych w ChatGPT (w tym sformułowań
      pośrednich i niejednoznacznych) — z udziałem klinicysty.
- [ ] Czy zasoby kryzysowe są kompletne i aktualne? Kto jest ich właścicielem?
- [ ] Czy 90-dniowy cykl weryfikacji jest zaplanowany, z osobą odpowiedzialną?
- [ ] Czy brak ścieżki dla osób poniżej 18 lat jest wystarczająco jasno
      zakomunikowany? Jeśli MVP ma je obsługiwać — projekt ścieżki opiekuna
      i jego weryfikacja prawna.

## 4. Weryfikacja terapeutów — **BLOKUJĄCE**

- [ ] Procedura weryfikacji tożsamości i kwalifikacji: kto, jak, na jakiej podstawie?
- [ ] Czy oznaczenie „profil zweryfikowany” jest prawdziwe i nie sugeruje
      gwarancji jakości terapii?
- [ ] Moderacja treści profilu i FAQ **przed** publikacją (profil startuje jako
      `draft` — kto go zatwierdza?).
- [ ] Umowa z terapeutą: jego rola wobec danych pacjenta, obowiązki, odpowiedzialność.
- [ ] Procedura reakcji na skargę dotyczącą terapeuty.

## 5. Minimalizacja danych — stan obecny

| Wymóg | Stan | Uwaga |
| --- | --- | --- |
| Brak zapisu rozmów | ✅ | brak pola w API |
| Brak zapisu powodów szukania terapii | ✅ | filtry nie są wiązane z kontem |
| Brak danych zdrowotnych w schemacie | ✅ | brak tabel i kolumn |
| Dane kontaktowe szyfrowane | ✅ | AES-256-GCM |
| E-mail nieprzeszukiwalny | ✅ | HMAC |
| Audyt bez treści | ✅ | lista dozwolonych kluczy |
| Logi bez PII | ✅ | lista dozwolonych pól + redakcja |
| Brak trackerów | ✅ | CSP `default-src 'none'` |

- [ ] Czy `bookings.price_minor` i `session_type` są potrzebne po rozliczeniu?
- [ ] Czy `audit_events.actor_id` powinien być pseudonimizowany po usunięciu konta?

## 6. Prawa osób

| Prawo | Stan | Do zrobienia |
| --- | --- | --- |
| Dostęp / kopia | ✅ eksport JSON w panelu | opisać SLA odpowiedzi |
| Usunięcie | ✅ `eraseUserData()` | potwierdzić prawnie, co musi zostać |
| Sprostowanie | częściowo | procedura zmiany adresu e-mail konta |
| Ograniczenie / sprzeciw | ❌ | procedura organizacyjna |
| Przenoszalność | ✅ JSON | — |
| Skarga do organu | ❌ | informacja w polityce prywatności |

- [ ] Kanał przyjmowania żądań (adres, formularz) i termin odpowiedzi.
- [ ] Sposób weryfikacji tożsamości osoby żądającej.

## 7. Retencja

- [ ] Zatwierdzenie okresów z `RETENTION_POLICY.md`.
- [ ] **Wdrożenie automatycznego usuwania** (dziś działa tylko czyszczenie stanu
      autoryzacji — SQL do dopisania jest w `RETENTION_POLICY.md` §5).
- [ ] Polityka kopii zapasowych i objęcie ich usuwaniem danych.

## 8. Bezpieczeństwo

| Środek | Stan |
| --- | --- |
| HTTPS + HSTS | ✅ |
| Ścisły CSP bez `unsafe-inline` | ✅ |
| OAuth 2.1 + PKCE S256 | ✅ |
| Rate limiting (3 poziomy) | ✅ |
| Turnstile na formularzach publicznych | ✅ |
| Szyfrowanie PII | ✅ |
| Audyt operacji zapisu | ✅ |
| Kontrola dostępu oparta na rolach | ✅ |
| Idempotencja zapisów | ✅ |
| Ochrona przed podwójną rezerwacją | ✅ DO + unikalny indeks |

- [ ] Niezależny przegląd bezpieczeństwa albo test penetracyjny.
- [ ] Procedura incydentu przetestowana „na sucho” (`SECURITY.md`).
- [ ] Kontakty w `SECURITY.md` uzupełnione.
- [ ] Wersjonowanie kluczy szyfrujących (rotacja bez okna serwisowego).

## 9. Ryzyka specyficzne dla LLM

| Ryzyko | Ograniczenie | Ryzyko szczątkowe | Do decyzji |
| --- | --- | --- | --- |
| Model kontynuuje dopasowanie mimo kryzysu | instrukcje serwera, disclaimery, stopka widżetu | **wysokie** | akceptacja klinicysty |
| Model tworzy odpowiedź „w imieniu terapeuty” | jawny zakaz w instrukcjach, `no_approved_answer` | średnie | testy akceptacyjne |
| Prompt injection w treści terapeuty | sanityzacja + brak uprawnień treści + moderacja | **wysokie** | proces moderacji |
| Model rezerwuje bez zgody użytkownika | dwustopniowy przepływ, zakres `booking:write`, audyt, odwoływalność | średnie | monitoring |
| Model przekazuje do narzędzia opis objawów | brak pola przyjmującego wolny tekst; instrukcje | niskie | — |

## 10. Przejrzystość

- [ ] Polityka prywatności napisana/zatwierdzona przez prawnika (obecna jest
      roboczym opisem technicznym).
- [ ] Regulamin zatwierdzony prawnie.
- [ ] Informacja o wersjonowaniu dokumentów i o tym, że rezerwacja wiąże się
      z akceptacją konkretnej wersji (mechanizm już działa).
- [ ] Jasne wskazanie odbiorców danych, w tym terapeuty i dostawcy poczty.

## 11. Bramka „gotowe do produkcji”

Nie wdrażaj na dane realnych osób, dopóki **wszystkie** poniższe nie są spełnione:

1. [ ] Sekcje 1–4 (role i podstawy, lokalizacja, granice kliniczne, weryfikacja
       terapeutów) zamknięte.
2. [ ] DPIA przeprowadzona i udokumentowana.
3. [ ] Umowy powierzenia podpisane.
4. [ ] Automatyczna retencja wdrożona i przetestowana.
5. [ ] Polityka prywatności i regulamin zatwierdzone prawnie.
6. [ ] Procedura incydentu z uzupełnionymi kontaktami.
7. [ ] Proces moderacji profili i FAQ działa.
8. [ ] Właściciel i harmonogram weryfikacji zasobów kryzysowych ustalony.
9. [ ] Dane demonstracyjne (`is_demo = 1`) **nieobecne** w bazie produkcyjnej.
10. [ ] Testy akceptacyjne scenariuszy kryzysowych zaliczone z udziałem klinicysty.
