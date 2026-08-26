# x402 Landings jako produkt zewnętrzny w ot-02

Przewodnik dla sesji, która ma podłączyć landingi do katalogu. Powstał
2026-08-26 z rozmowy projektowej; liczby w nim są zmierzone, nie szacowane.

## Czym to jest, a czym nie

`/home/dadmor/code/x402Landings` to **osobny serwis**, nie biblioteka do
zwendorowania. Renderuje landing page'e z JSON-a: schemat wchodzi, gotowy HTML
wychodzi. Nie woła żadnego modelu językowego — treść generuje klient.

W tej relacji **ot-02 jest klientem**, jednym z wielu. Drugim rodzajem klienta są
agenci AI płacący przez x402.

Konsekwencja, którą trzeba trzymać: **nie kopiuj kodu silnika do ot-02.** Jak
tylko powstanie druga kopia, obie zaczną się rozjeżdżać i przestaniesz być
użytkownikiem własnego produktu — a to jest jedyny mechanizm, który wykryje braki
serwisu szybciej niż zewnętrzny klient.

## Po co to w ot-02

Terapeutka dostaje **osobny landing marketingowy**, obok profilu w katalogu. Do
kampanii, do wizytówki, do linku w bio. Profil w katalogu zostaje jak jest.

To jest cała integracja. Nic więcej.

## CZEGO NIE ROBIĆ: nie podmieniaj silnika profilu

**To jest najdroższy błąd, jaki można tu popełnić.** Kuszące, bo oba silniki
mają wspólnego przodka — `x402Landings` został wydzielony właśnie z
`src/web/sections.ts`. Zmierzone przeszkody:

- **Zero pokrycia nazw.** ot-02 ma 11 sekcji neutralnych domenowo
  (`tekst usluga cytat zdjecie-tekst tekst-zdjecie tekst-wyrozniony filary
  artykuly kroki fakty wyroznienie`), x402 ma 14 innych (`hero hero-poster
  hero-split text features steps stats quote logos pricing faq media-text cta
  contact`). Pojęciowo się pokrywają, nazwy typów i pól nie — polskie kontra
  angielskie. `cleanBlock` wyrzuca nieznany typ **po cichu**, więc istniejący
  `sections_json` wyrenderowałby pustą stronę. Nie błąd, nie ostrzeżenie —
  pustkę.
- **17 sekcji `auto` nie ma odpowiednika.** Kalendarz, oferta, FAQ z bazy —
  cała wartość profilu. W x402 tego nie ma i być nie powinno.
- **Migracja `sections_json` u każdej terapeutki na produkcji.** W tym repo
  pełny seed raz już skasował wgrane zdjęcie. Nie ma powodu wracać w to miejsce.
- Reguły kompozycji profilu z `CLAUDE.md` (kalendarz jako tabela dni w
  kolumnach, jeden akcent typograficzny na stronę) są wywalczone rundami
  cofnięć i oznaczone „nie przerabiać".

Dwa silniki dostrojone do dwóch różnych rzeczy. Profil katalogowy to nie landing
sprzedażowy.

## Kontrakt

```
POST /v1/render              JSON strony → HTML (albo ?format=json → {html, blocks})
GET  /v1/schema              JSON Schema całej strony — to dostaje model
GET  /v1/blocks              katalog bloków, jedna linia na typ
```

```bash
curl -X POST $X402_LANDINGS_URL/v1/render \
  -H 'content-type: application/json' \
  -d '{"meta":{"title":"..."},"layout":{"theme":"forest"},"blocks":[...]}'
```

Wejście jest **niezaufane po stronie serwisu** — nieznany typ wypada, każdy
string jest ucięty do budżetu pola, każdy URL przechodzi przez `safeUrl`. ot-02
nie musi tego dublować, ale też nie może na tym polegać w kwestii treści: to,
że HTML jest bezpieczny składniowo, nie znaczy, że jest prawdziwy.

Odpowiedź to **jeden samowystarczalny plik**: arkusz stylów wklejony, grafika
jako inline SVG, zero zapytań sieciowych.

## Trzy pułapki zmierzone w ot-02

### 1. CSP zablokuje wklejony arkusz — to jest ta ważna

`src/web/layout.ts` ustawia `style-src 'self'` (i `default-src 'none'`).
`renderPage` z x402 wstawia `<style>…</style>` w dokumencie. **Podanie tego
przez zwykłą trasę ot-02 daje stronę bez stylów** — CSP zablokuje inline.

Trzy wyjścia, w kolejności od najczystszego:

1. **Osobna trasa z własnym CSP i hashem.** Policz `sha256` treści `<style>`,
   dopisz `'sha256-…'` do `style-src` tylko dla tej trasy. Polityka zostaje
   ścisła, hash liczy się przy zapisie landinga, nie przy każdym żądaniu.
2. **Hosting po stronie serwisu.** Landing mieszka pod domeną x402Landings,
   ot-02 tylko linkuje. Zero problemu z CSP, ale adres nie jest Twój.
3. **Fragment w chromie ot-02** — `renderBlocks()` zwraca same sekcje bez
   dokumentu, `PAGE_CSS` jest osobnym eksportem. Wymaga zakresowania stylów pod
   `.lp`: PAGE_CSS ma **9 reguł globalnych** (`html, body, *, p, a, img, h1,
   h2/h3, :focus-visible`) i **5 klas kolidujących** z `APP_CSS`
   (`.btn .hero .kicker .lead .steps`). Do zrobienia po stronie x402, nie tutaj.

Dla landinga marketingowego wybierz (1). Fragment jest potrzebny dopiero, gdy
landing ma się pokazać wewnątrz strony serwisu — czyli w podglądzie.

### 2. `frame-src 'self'` zablokuje podgląd w iframe

Panel będzie chciał pokazać podgląd. `frame-src 'self'` przepuszcza tylko własne
źródło, więc iframe landinga z obcej domeny nie wyświetli się i **komunikat
będzie mylący — wskaże adres ot-02, nie zablokowane źródło**. Ten sam mechanizm
już raz zjadł czas przy `form-action` w OAuth (patrz komentarz w `layout.ts`).

Jeżeli podgląd ma być z obcej domeny — dopisz to źródło do `frame-src` tylko na
trasie panelu. Jeżeli landing jest hostowany u siebie (wyjście 1 powyżej),
`'self'` wystarcza i nic nie trzeba ruszać.

### 3. Nie ma KV — cache idzie do R2

Bindingi to `DB` (D1) i `MEDIA` (R2). Render jest **deterministyczny**: ten sam
JSON zawsze daje ten sam HTML, więc wołanie serwisu przy każdym żądaniu strony
to marnowanie pieniędzy i dokładanie cudzej awarii do własnej ścieżki krytycznej.

Renderuj **przy zapisie**, nie przy odczycie. Gotowy HTML trzymaj w R2 obok
mediów. Odczyt strony nie powinien w ogóle dotykać x402Landings.

## Gdzie trzymać dane

`therapists` ma już `sections_json` i `layout_json` — **to jest profil, nie
ruszaj tego.** Landing to osobny byt: własna kolumna albo, lepiej, własna tabela
(terapeutka może z czasem chcieć więcej niż jeden landing, np. pod kampanię).

Trzymaj **JSON, nie HTML, jako źródło prawdy.** HTML w R2 jest cache'em, który
zawsze da się odtworzyć. Odwrotnie się nie da.

## Rozliczenie

ot-02 jest klientem maszynowym, ale **własnym** — nie potrzebuje x402. Konto
serwisowe z kredytami w ledgerze jest prostsze i nie wciąga księgowości w
rozliczenia w USDC między własnymi spółkami.

x402 zostaje dla obcych agentów. Nie mieszaj tych dwóch ścieżek tylko dlatego,
że jedna już działa.

## Awaria serwisu

Skoro HTML jest w R2, a JSON w bazie, to niedostępność x402Landings **nie może
zdjąć landingów z sieci**. Ustal to od pierwszej wersji:

- odczyt landinga: wyłącznie R2, zero zależności od serwisu;
- zapis przy niedostępnym serwisie: zapisz JSON, oznacz jako „do przerenderowania",
  pokaż terapeutce, że zmiany czekają — nie udawaj, że się udało;
- nigdy nie kasuj starego HTML-u przed otrzymaniem nowego.

## Zanim to pójdzie na produkcję

- **Moderacja.** Serwis renderuje dowolny HTML pod Twoją domeną. Nawet przy
  zalogowanych terapeutkach potrzebna jest blokada podszywania się pod cudze
  marki. Przy otwarciu kanału agenckiego to warunek konieczny, nie opcja.
- **Mobile silnika jest NIEZWERYFIKOWANY.** Sprawdzony jest tylko desktop
  (1497 px: kolumna 157–1341, zero przepływu poziomego). Media queries są
  konwencjonalne, ale nikt ich nie widział w działaniu. Sprawdź w DevTools.

## Pierwszy krok

Nie zaczynaj od integracji. Zacznij od **jednego landinga terapeutki
wyrenderowanego ręcznie** — weź `sections_json` jednej demonstracyjnej
terapeutki, przełóż ręcznie na bloki x402, zapisz JSON do pliku, zawołaj
`POST /v1/render`, obejrzyj wynik.

To odpowiada na jedyne pytanie, które naprawdę blokuje: czy te 14 bloków
wystarcza, żeby zrobić landing terapeutki, którego nie wstyd pokazać. Dopiero z
odpowiedzią na to warto ruszać kolumnę w bazie i trasę w panelu.

## Uruchomienie serwisu lokalnie

```bash
cd /home/dadmor/code/x402Landings
npm run dev      # http://localhost:8787, na / przeglądarka przykładów
```

Reguły samego serwisu — czego tam nie wolno, w jakiej kolejności iść, wyniki
researchu x402 — są w `x402Landings/CLAUDE.md`. Przeczytaj przed zmianami po
tamtej stronie.
