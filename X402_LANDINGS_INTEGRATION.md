# Strony terapeutek: usługa stron (x402landings.space)

ot-02 nie renderuje stron terapeutek. Profil i podstrony są **stronami w usłudze**
(repo `x402Landings`, domena `x402landings.space`): usługa trzyma ich JSON, szablony,
edytor i render. ot-02 jest jej klientem — dostarcza dane terapeutki i ramę strony.

Decyzja 2026-09-03 (właściciel): „jak WordPress, w wersji uproszczonej" — jedna
usługa dla ot-02, agregatora trenerów, landingów pod Google Ads. Panel edycji
w usłudze, osadzony w hoście przez iframe. Profile pod domeną hosta, landingi
reklamowe hostuje usługa.

## Podział

| kto | co |
| --- | --- |
| usługa | `sites`, `pages` (JSON), szablony i motywy (kod), edytor `/edit/:id/:token`, render, hosting `/p/:id` |
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
POST /v1/render/page              {owner, slug, resolved, chrome} → HTML dokumentu
POST /v1/pages/:id/edit-session   {resolved, summary, fixed} → {url} do iframe
GET  /v1/pages?owner=  POST /v1/pages {owner, title, theme, variant}  GET /v1/pages/:id  GET /v1/themes
```

Profil = strona o slugu `profil`, `owner` = id terapeutki; tworzona przy pierwszym
wyświetleniu (`ensureProfilePage`) ze szkieletem `DEFAULT_PROFILE`. Podstrony =
własne slugi. Jedno wywołanie na wyświetlenie strony.

## Awaria usługi

Po udanym renderze HTML idzie do R2 `pages-html/<owner>/<slug>.html`. Gdy usługa
nie odpowiada: kopia z R2 + nagłówek `x-pages-stale: 1`; bez kopii — 503 z numerami
kryzysowymi. Panel pokazuje wtedy komunikat zamiast iframe; dane i strona publiczna
działają.

## CSS i CSP

Dokument linkuje jeden arkusz: `style.css` motywu, z usługi (`/themes/<id>/style.css`); usługa linkuje go sama.
CSP dokłada origin usługi do `style-src`, `font-src` (fonty motywów idą z usługi)
i `frame-src` (edytor w panelu). Edytor usługi odpowiada `frame-ancestors
<origin site'u>`. Portret idzie z adresem bezwzględnym, bo podgląd w edytorze
żyje na domenie usługi.

## Migracja danych (jednorazowo)

```bash
node scripts/pages-migrate.mjs --selftest                       # translator starych typów
PAGES_URL=https://x402landings.space PAGES_API_KEY=… node scripts/pages-migrate.mjs --env preview
PAGES_URL=https://x402landings.space PAGES_API_KEY=… node scripts/pages-migrate.mjs --env production
```

Idempotentna (po `owner+slug`). Dopiero po weryfikacji na produkcji: migracja
kasująca `therapist_pages` i kolumny `sections_json`/`layout_json` oraz odpowiednie
`UPDATE` w `seed/seed.sql`.

## Lokalnie

```bash
cd ../../x402Landings && PORT=8788 npm run dev     # site "dev", klucz "dev"
npm run dev                                         # ot-02, PAGES_URL=http://localhost:8788
```

Reguły samej usługi: `x402Landings/CLAUDE.md`.
