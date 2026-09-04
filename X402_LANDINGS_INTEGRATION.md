# Strony terapeutek: usługa stron (x402landings.space)

ot-02 nie renderuje stron terapeutek. Profil i podstrony są **stronami w usłudze**
(repo `x402Landings`, domena `x402landings.space`): usługa trzyma ich JSON, szablony,
edytor i render. ot-02 jest jej klientem — dostarcza dane terapeutki i ramę strony.

Decyzja 2026-09-03 (właściciel): „jak WordPress, w wersji uproszczonej" — jedna
usługa dla ot-02, agregatora trenerów, landingów pod Google Ads. Panel edycji
w usłudze, otwierany z panelu hosta w nowej karcie (2026-09-04; wcześniej iframe).
Profile pod domeną hosta, landingi reklamowe hostuje usługa.

## Podział

| kto | co |
| --- | --- |
| usługa | `sites`, `pages` (JSON), szablony i motywy jako pliki, edytor `/edit/:id/:token`, render, hosting `/p/:id` |
| ot-02 | dane terapeutki jako bloki (`src/web/host-blocks.ts`), rama strony jako dane (`chrome`: katalog, numery kryzysowe), kopia zapasowa HTML w R2 |

Usługa **nigdy nie woła hosta**. Host przy każdym renderze przysyła `resolved` —
treść swoich bloków jako bloki rdzenia usługi (`hero`, `pricing`, `faq`, `calendar`).
Słowa wpisane przez terapeutkę w edytorze wygrywają z danymi; usługa scala.
**ot-02 nie ma ani linii HTML ani CSS stron terapeutek** — kalendarz to blok
`calendar` (dni, godziny, dopisek, przyciski jako JSON), stopka kryzysowa to
`chrome.footerNote` (dane), a jedyny arkusz to arkusz usługi.

## Klient: `src/web/pages-client.ts`

`PAGES_URL` (var) + `PAGES_API_KEY` (sekret; lokalnie `dev`). `memory://` = usługa
w procesie na sklepie w pamięci (testy). Wywołania:

```
PUT  /v1/site/blocks              HOST_BLOCK_DEFS — przed każdym utworzeniem strony i sesją edycji
POST /v1/render/page              {owner, slug, resolved, chrome, industry} → HTML dokumentu
POST /v1/pages/:id/edit-session   {resolved, summary, fixed, industry} → {url} edytora (nowa karta)
GET  /v1/pages?owner=  POST /v1/pages {owner, title, theme, variant}  GET /v1/pages/:id  GET /v1/themes
```

Profil = strona o slugu `profil`, `owner` = id terapeutki; tworzona przy pierwszym
wyświetleniu (`ensureProfilePage`) ze szkieletem `DEFAULT_PROFILE`. Podstrony =
własne slugi. Jedno wywołanie na wyświetlenie strony.

## Pola danych: pole w bloku deklaruje, co siedzi w bazie

Zasada (2026-09-04): pole w bloku mówi edytorowi, co i jak jest w bazie hosta.
Pole związane z jedną wartością to zwykłe pole. Pole związane z rekordami to
repeater, który sam wstawia, poprawia i usuwa (wiersz ma `usuń`). Wartość
wyliczona z innych danych to pole `computed` — tylko do odczytu, z podpisem
źródła. **Nic nie odsyła do panelu**; jedyny wyjątek to upload pliku (R2 jest
po stronie hosta), gdzie pole bierze adres z galerii.

Każde pole opisuje RAZ `src/web/data-fields.ts` (`FIELDS`): etykieta, rodzaj,
`read` (wartość dla formularza) i `write` (łatka do bazy: kolumna, tabela
wiążąca, adres gabinetu, plan kalendarza). Z tego wpisu powstaje deklaracja dla
usługi, wartość w `resolved` i zapis. Listy z bazy (obszary, nurty) wchodzą
w opcje pól przy synchronizacji bloków (`hostBlockDefs(dict)`).

Przepływ zapisu: usługa wyjmuje pola `data` z bloku i POST-uje
`{token, data: {blok: {pole}}}` pod `write.url` z `edit-session`; host
(`src/web/host-write.ts`, `POST /api/host-blocks`) wykonuje łatki i odpowiada
świeżym `{resolved, summary}`. Token: HMAC `hostwrite:<id>.<exp>`
z `TOKEN_SIGNING_KEY`, dwie godziny. Zapis z formularza, który danego pola nie
niósł, niczego nie kasuje.

## Awaria usługi

Po udanym renderze HTML idzie do R2 `pages-html/<owner>/<slug>.html`. Gdy usługa
nie odpowiada: kopia z R2 + nagłówek `x-pages-stale: 1`; bez kopii — 503 z numerami
kryzysowymi. Panel pokazuje wtedy komunikat zamiast przycisku „Otwórz edytor";
dane i strona publiczna działają.

## CSS i CSP

Dokument linkuje jeden arkusz: `style.css` motywu, z usługi (`/themes/<id>/style.css`); usługa linkuje go sama.
CSP dokłada origin usługi do `style-src` i `font-src` (fonty motywów idą z usługi).
`frame-src` już nie — edytor otwiera się we własnej karcie, host niczego nie osadza.
Portret idzie z adresem bezwzględnym, bo podgląd w edytorze żyje na domenie usługi.

## Czego usługa nie wie, a musi dostać

- **`industry`** przy renderze i sesji edycji: puste pole na zdjęcie bierze
  fotografię tej branży, nie branży motywu. Bez tego terapeutka w motywie `wdech`
  dostawała na profilu zdjęcie zajęć jogi. ot-02 wysyła `psychotherapy`.
- **`glyph`** w `HOST_BLOCK_DEFS`: kształt, który paleta edytora rysuje na kaflu
  bloku (`calendar` dla terminów, `pricing` dla oferty). Silnik zna tylko typy
  rdzenia — nazwy naszych bloków nie mają w nim siedzieć.
- **`was: ['stara-nazwa']`**, kiedy przemianowujesz blok w `HOST_SECTIONS`.
  Zapisane strony trzymają nazwę sprzed zmiany; bez aliasu blok znika ze
  wszystkich. Usługa podmienia nazwę przy odczycie, strona prostuje się przy
  najbliższym zapisie.

Kolejność wdrożeń nie jest już zobowiązaniem: usługa narysuje blok, dla którego
przyszła treść, nawet jeśli nie zna jeszcze jego definicji. Host wdrożony
pierwszy traci na chwilę **formularz w edytorze**, nigdy stronę.

## Migracja danych — zrobiona

Stare strony przeniesione do usługi 2026-09-03; migracja `0017_pages_service.sql`
skasowała `therapist_pages` oraz kolumny `sections_json`/`layout_json`. Skrypt
przenoszący usunięty — nie ma już czego czytać.

## Lokalnie

```bash
cd ../../x402Landings && PORT=8788 npm run dev     # site "dev", klucz "dev"
npm run dev                                         # ot-02, PAGES_URL=http://localhost:8788
```

Reguły samej usługi: `x402Landings/CLAUDE.md`.
