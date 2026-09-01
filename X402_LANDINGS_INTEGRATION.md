# x402 Landings jako silnik stron w ot-02

Przewodnik dla sesji, która ma podłączyć silnik do katalogu. Liczby w nim są
zmierzone, nie szacowane.

## Decyzja 2026-09-02: silnik x402 zastępuje silnik profilu

Właściciel: „ma być prosto do edycji dla terapeuty/trenera, superstrony,
booking, eventy, campy, terapie grupowe". Jeden silnik dla ot-02, ZNANY7 i
landingów, jeden schemat dla LLM, jedno narzędzie MCP „zarządzaj stroną".

To odwraca sekcję „nie podmieniaj silnika" z 2026-08-26 (zostawiona niżej jako
historia — jej przeszkody są nadal prawdziwe i to jest lista rzeczy do
zrobienia, nie do ominięcia). Co się zmieniło po stronie x402 (2026-09-02):

- `src/engine` jest **pakietem**: `"x402-landings": "file:../x402Landings"`,
  import z `x402-landings`. Importy bez `.ts`, więc tsc ot-02 przechodzi bez
  zmian w `tsconfig`. Sprawdzone z kopią tsconfig ot-02 i esbuildem.
- `registerBlocks(blokiHosta)` dokłada bloki ot-02 do tego samego rejestru,
  z którego idzie schemat, parser i render.
- `BlockDef.resolve(block, host)` + `resolvePage(page, host)`: pre-pass z
  danymi z D1 przed synchronicznym renderem. Tak przechodzi 15 sekcji `auto`.
  Kalendarz slotów = własny `render` (tabela dni, „nie przerabiać"), FAQ i
  oferta = `resolve` zwracające generyczny `faq` / `pricing`.
- `PAGE_CSS` podawany jako plik `/assets/lp.css` → `style-src 'self'` bez
  zmian. Chrome ot-02 zostaje, w środku `<div class="lp lp--theme-…">`.
- Serwis `/v1/render` i cache w R2 zostają **tylko** dla statycznych landingów
  marketingowych. Profil renderuje się w żądaniu, z bazy.

Kolejność: ZNANY7 pierwszy (mniejsze ryzyko), ot-02 ostatni. Migracja
`sections_json` u każdej terapeutki = jednorazowy skrypt z kopią do
`sections_json_old`. **Nigdy przez seed** — raz już skasował zdjęcie.

## Historia: dlaczego podmiana była odrzucona 2026-08-26

Zmierzone przeszkody, dziś lista pracy:

- **Zero pokrycia nazw.** ot-02 ma 21 sekcji (polskie typy i pola), x402 14
  bloków (angielskie). `cleanBlock` wyrzuca nieznany typ **po cichu** —
  `sections_json` bez migracji renderuje pustą stronę.
- **15 sekcji `auto` nie ma odpowiednika** — dziś: bloki hosta z `resolve`.
- **Migracja na produkcji** — skrypt z kopią kolumny, nie seed.
- Reguły kompozycji z `CLAUDE.md` (kalendarz jako tabela dni, jeden akcent na
  stronę) → walidacja w parse hosta, nie w silniku.

## Landing marketingowy (nadal osobny byt)

Terapeutka może dostać **osobny landing** obok profilu — kampania, link w bio.
Ten sam silnik, ale statyczny: render przy zapisie, HTML w R2. Reszta tego
dokumentu (kontrakt HTTP, CSP, R2, awaria) dotyczy tej ścieżki.

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
   dokumentu. **Zakresowanie jest już zrobione (2026-08-26):** każdy selektor
   `PAGE_CSS` siedzi pod `.lp`, a reguły dokumentu (`html`, `body`, skip link)
   są w osobnym eksporcie `DOCUMENT_CSS`, którego nie bierzesz. Dziewięć reguł
   globalnych i pięć klas kolidujących z `APP_CSS`
   (`.btn .hero .kicker .lead .steps`) przestało istnieć.

   Sprawdzone na stronie z celowo wrogimi stylami gospodarza — zero przecieku
   w obie strony. Po stronie ot-02 zostaje:

   ```
   <style>{PAGE_CSS}</style>                     ← jeden raz, jako /assets/lp.css
   <div class="lp lp--theme-forest">{fragment}</div>
   ```

   Podanie `PAGE_CSS` jako **osobnego pliku** przez `/assets/…` załatwia przy
   okazji problem CSP z punktu wyżej: `style-src 'self'` przepuszcza plik, nie
   przepuszcza wklejki. To jest najprostsza droga, jeśli landing ma żyć w
   chromie serwisu.

   Uwaga: `block--stripe` i `block--dark` celowo wychodzą na pełną szerokość
   okna matematyką `50vw` — uciekną z kolumny `.wrap`. Tak mają działać pasy;
   jeśli landing ma zostać w kolumnie, nie używaj tych dwóch tonów.

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
