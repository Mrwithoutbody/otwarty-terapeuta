# Strony terapeutek: usługa stron (x402landings.space)

Usługa stron (repo `x402L`, domena `x402landings.space`) **dystrybuuje motywy i
składa strony** — jak repozytorium motywów WordPressa, nie jak WordPress.com.
Stron nie trzyma. JSON strony (motyw, kolejność bloków, układ, poprawione pola)
leży w tej bazie (`therapist_pages`, migracja `0018`) i idzie do usługi w każdym
żądaniu obok danych terapeutki (`resolved`) i ramy (`chrome`).

Decyzja 2026-09-06 (właściciel): dane osobowe terapeutki nie mają drugiego miejsca
przechowywania. Wcześniejszy model (2026-09-03, „usługa trzyma JSON") odwrócony.

## Podział

| kto | co |
| --- | --- |
| usługa | motywy i komponenty jako pliki, render, edytor `/edit/:token` (sesja na godzinę), zdjęcia branży |
| ot-02 | `therapist_pages` (JSON strony), dane terapeutki jako bloki (`host-blocks.ts`), rama jako dane (`chrome`), kopia zapasowa HTML w R2 |

Usługa **nigdy nie woła hosta** poza jednym: zapis z edytora. Host przy każdym
renderze przysyła `resolved` — treść swoich bloków — i `page` — stronę po edycji.
Blok nakłada się po `id` (= nazwa bloku hosta): kolejność, układ, ton i tylko te
pola, które terapeutka zmieniła. Nowa cena z panelu trafia na stronę, poprawiony
nagłówek zostaje.

## Klient: `src/web/pages-client.ts`

`PAGES_URL` (var). Bez klucza: usługa składa każdemu, a sesję edycji otwiera tylko
hostom z listy `HOSTS` po jej stronie. `memory://` = x402L w procesie (testy).

```
POST /v1/render/page   {owner, slug, title, theme, variant, page, resolved, chrome, industry} → HTML
POST /v1/edit-session  {…jak wyżej, write: {url, token}}                                    → {url} edytora, nowa karta
GET  /v1/themes        → [{slug, label, hint, variants}]
PUT  /v1/site/blocks   → 204
```

Profil = wiersz o slugu `profil`, tworzony przy pierwszym wyświetleniu
(`ensureProfilePage`). Podstrony = własne slugi, tworzone w panelu.

Zapis: usługa liczy różnicę względem strony z początku sesji i POST-uje
`{token, page}` pod `write.url` = `/api/host-blocks?page=<id>`. Host zapisuje
`page_json` i `theme`. Token: HMAC `hostwrite:<id>.<exp>` z `TOKEN_SIGNING_KEY`.

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

Dokument linkuje arkusze usługi (`/base.css`, `/motyw/<id>.css`) i krój z Google Fonts.
CSP dokłada origin usługi do `style-src`, `img-src`, `font-src` oraz
`fonts.googleapis.com` / `fonts.gstatic.com`.
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

## Migracja danych

2026-09-03 strony poszły do usługi (`0017`), 2026-09-06 wróciły (`0018`) w nowym
kształcie (`page_json`). Strony z bazy starej usługi (`x402-landings`) nie były
przenoszone: profil odtwarza się sam z danych, podstrony do założenia na nowo.

## Lokalnie

```bash
cd ../../x402L && PORT=8788 npm run dev            # usługa stron
npm run dev                                         # ot-02, PAGES_URL=http://localhost:8788
```

Reguły samej usługi: `x402L/CLAUDE.md`, kontrakt: `x402L/README.md`.
