# Portal — publiczna strona

## Zakres i komendy

Trasy: `/`, `/terapeuci`, `/terapeuci/:slug`, `/terapeuci/:slug/:strona`, `/psychoterapeuta/:miasto`,
`/jak-to-dziala`, `/bezpieczenstwo`, `/pomoc-w-kryzysie`, `/polityka-prywatnosci`, `/regulamin`,
`/sitemap.xml`, `/robots.txt`, klucz IndexNow `/<klucz>.txt`, `/media/:key`, `/assets/strona.css`.

Pliki: `apps/portal/index.ts` (trasy techniczne), `web/pages.ts` (`siteApp`), `web/seo.ts`,
`web/labels.ts`, `authored/site.ts`, `test/`.

- `npm test -- apps/portal` — 3 pliki, 18 testów.
- `npm run typecheck`, `npm run lint` — całe repo. `npx eslint apps/portal` z `apps/portal` szuka
  `apps/portal/apps/portal` i nic nie znajduje: npm odpala skrypty z korzenia, ścieżki nie.
- `npm run dev:portal` (:8791), `E2E_PORT=8891 npm run test:e2e -- e2e/site.spec.ts`.
- Import tylko z `shared/`; `apps/panel` i `apps/mcp` blokuje eslint.

## Strony terapeutek

Profil renderuje `authored/site.ts` z dwóch źródeł: jej słowa z `authored_pages`, fakty (cennik,
wolne terminy, kwalifikacje) z tabel przy każdym żądaniu. Bez opublikowanej strony profil składa się
z tego, co już jest w danych (`seedDraft` w `shared/authored/store.ts`), więc nowa osoba ma stronę od
pierwszego dnia. Podstrona bez publikacji = 404 (`notFoundProfile`), nie pusta strona.

Renderer i strażnik faktów są w `shared/authored/core.ts` — nie kopiuj ich do portalu. Strażnik
blokuje tylko ceny i terminy wpisane prozą; kwalifikacji nie rusza. Stopka kryzysowa to stała `CRISIS`
renderera, nie treść strony: nie da się jej wyłączyć z poziomu portalu.

Strony autorskie nie idą przez `renderPage` — mają własny dokument (`authoredDocument`) i linkują
`/assets/strona.css?v=<hash>`; `withSeoHead` dokleja im head. Profile `is_demo` dostają
`noindex, nofollow`.

## SEO

- Google Search Console: usługa domenowa `sc-domain:otwartyterapeuta.pl`. Bing Webmaster Tools
  zaimportowany z GSC. Konto właściciela, sitemapa zgłoszona w obu.
- IndexNow (`shared/lib/indexnow.ts`): **klucz jest publiczny z założenia** — wyszukiwarka pobiera
  `/<klucz>.txt`, żeby sprawdzić, że ping przyszedł od nas. Nie traktuj go jako wycieku i nie
  przenoś do sekretów. Portal serwuje klucz, pingi wysyła panel (`apps/panel/web/admin.ts`,
  `apps/panel/authored/panel.ts`), tylko na produkcji. Google IndexNow nie czyta.
- `/psychoterapeuta/<miasto>` powstaje sam od 3 realnych profili w mieście (`listCityPages`,
  `shared/db/catalog.ts`); mniej = 404, nie pusta strona. Filtry katalogu renderują się z
  `path: '/terapeuci'`, więc canonical nie dubluje strony miasta.
- Tytuł profilu niesie nurt z jej danych (`practiceOf`), „sesja od” to najniższa **płatna** cena
  (`sessionFrom`) — bezpłatna rozmowa wstępna to nie cena sesji.
- Ocen (gwiazdek) nie wpisujemy w kod: Google ignoruje oceny wystawione sobie samemu. Gwiazdki
  i mapka są tylko z wizytówki Google terapeutki.
- Nowy adres: sitemapa → IndexNow → GSC „Sprawdzenie adresu URL” → „Poproś o zindeksowanie”
  w Chrome właściciela. Limit ~10 dziennie, odnawia się ok. 9:00 czasu PL.
- Kolejka na 2026-09-23 (po 9:00), po kolei: `/psychoterapeuta/warszawa` (Google jej nie zna),
  `/` (czytana 7.09, przed faviconem i nazwą serwisu z 19.09),
  `/terapeuci/aleksandra-mazek-ffe4e2df`. Po wykonaniu usuń te trzy linijki.

## Wygląd

Najpierw pomiar, potem teza — liczby podaj w odpowiedzi. Zmierzone dziś z `:root`
(`shared/web/styles.ts`, `shared/authored/page-css.ts`): powierzchnie `#f7f8f1` 69°, `#f2f3e9` 66°,
obramowania `#e2e5d8` 74°, `#d1d8c1` 78°, tekst `#344125` 88°, zieleń `#3d6529` 100°, bursztyn
`#8b6415` 40°. Pasma i procedura: skill `pomiar-kolorow`.

Wrażenie kolorystyczne robi treść, nie tokeny: hero z `public/media/site` ma medianę odcienia
161–196° i 19–32% pikseli ciepłych, a portret z katalogu medianę 12° i 96% ciepłych. Oceniając
„zimno/ciepło” licz piksele (PIL), nie patrz na hex-y.

Strony publiczne nie mają JavaScriptu (poza `application/ld+json`). `APP_CSS` jedzie inline, a CSP
ma jego hash (`style-src 'self' <hash>` w `shared/web/layout.ts`) — zmiana stylu zmienia hash.
`layout.ts`, `styles.ts` i `page-css.ts` leżą w `shared/`, ale treść ich należy do portalu: jedna
zmiana przestyluje też panel i ekran zgody OAuth, więc obejrzyj `/admin` i `/oauth/authorize`.

## Prawne

Tożsamość administratora jest tylko w `shared/web/controller.ts` (`CONTROLLER`), a polityka
prywatności i regulamin renderują ją przez `controllerDetails()`. Pola puste nie tworzą wiersza —
dopóki zarząd nie potwierdzi KRS/NIP/REGON, strona pokazuje nazwę i kontakt. Nigdy nie wpisuj tam
wartości zmyślonej ani skopiowanej z innego dokumentu; numer dopisuje się w jednym polu.

## CTA wtyczki

`pluginCta` (`web/labels.ts`) czyta `PUBLIC_PLUGIN_URL`. Pusty (tak jest dziś we wszystkich
środowiskach w `wrangler.jsonc`) = link do `/jak-to-dziala`. Adres ustawia MCP po publikacji
w katalogu OpenAI; portal go tylko czyta. Nie zgaduj adresu wtyczki i nie wpisuj go na sztywno.
