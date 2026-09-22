# Otwarty Terapeuta — reguły każdej instancji

Jeden Worker, trzy obszary (`apps/portal`, `apps/panel`, `apps/mcp`) i `shared/`. Kilka instancji
Claude pracuje równolegle, każda we własnym worktree.

## Odbiorca: KAŻDY użytkownik ChatGPT. Także darmowy.

Punkt dostarczenia: **publiczny katalog aplikacji w ChatGPT**. Wtyczka w przestrzeni Business albo
w trybie programisty to wyłącznie etap testowy, nigdy „dostarczone". Rozwiązanie wymagające płatnego
konta, zaproszenia do workspace albo ręcznego wklejania adresu MCP jest niezgodne z wymaganiem.

**Każda decyzja techniczna** (uwierzytelnianie łącznika, zakresy, widżet, instrukcje serwera)
**ma być podejmowana pod kątem anonimowego użytkownika z darmowego konta**, który pierwszy raz widzi
tę aplikację. Przy planowaniu **mierz postęp odległością od publikacji** w katalogu OpenAI, nie od
działającego demo u siebie. **Dlaczego:** produkt ma doprowadzić osobę w kryzysie do terapeuty.

## Logowanie: TYLKO przy operacjach zapisu. Nigdy do przeglądania.

Anonimowo, bez wyjątku: `search_therapists`, `get_therapist_profile`, `get_therapist_faq`,
`list_available_slots`, `get_crisis_resources`, `render_otwarty_terapeuta_widget`. Logowanie dopiero
gdy użytkownik sam zaczyna operację prywatną albo zapis: `preview_booking` i `list_my_bookings`
(`booking:read`), `create_booking` i `cancel_booking` (`booking:write`).

Wymuszanie logowania po to, żeby **zobaczyć profil terapeutki**, jest zabronione. **Dlaczego:** ekran
proszący o e-mail, zanim pokaże się cokolwiek z katalogu, czyta się jak phishing.

Serwer zbudowany poprawnie: `apps/mcp/security.ts` daje katalogowi `noauth`, prywatne narzędzia
oddają `_meta["mcp/www_authenticate"]`. Pułapka siedzi w konfiguracji łącznika — `apps/mcp/CLAUDE.md`.

## Niezmienne adresy

Zmiana tylko za zgodą właściciela: `/`, `/terapeuci`, `/terapeuci/:slug(/:strona)`,
`/psychoterapeuta/:miasto`, `/jak-to-dziala`, `/bezpieczenstwo`, `/pomoc-w-kryzysie`,
`/polityka-prywatnosci`, `/regulamin`, `/sitemap.xml`, `/robots.txt`, `/media/:key`,
`/71f406899159b10e0f21a3fcd1bc302f.txt` (klucz IndexNow), `/rezerwacja/:ref?k=` (adres z maili),
`/mcp`, `/public/mcp`, `/oauth/*`, `/.well-known/*`, issuer `https://otwartyterapeuta.pl`
(= `PUBLIC_BASE_URL`) i `WIDGET_URI` (`ui://otwarty-terapeuta/widget/v1.html`, `shared/env.ts`).

## Obszary

| Obszar | Zakres | Testy | Dev i e2e |
| --- | --- | --- | --- |
| `apps/portal` | strony publiczne, katalog, strony autorskie, SEO, `/media` | `npm test -- apps/portal` | `npm run dev:portal` (:8791), `E2E_PORT=8891 npm run test:e2e -- e2e/site.spec.ts` |
| `apps/panel` | `/admin`, `/dla-terapeutow`, narzędzie strony, grafik | `npm test -- apps/panel` | `npm run dev:panel` (https :8792) |
| `apps/mcp` | `/mcp`, OAuth, rezerwacje, DO, widżet, pakiet wtyczki | `npm test -- apps/mcp` | `npm run dev:mcp` (:8793), `E2E_PORT=8893 npm run test:e2e -- e2e/widget.spec.ts` |
| `shared/` | kod używany przez co najmniej dwa obszary | `npm test -- shared` | — |

`apps/<obszar>` importuje tylko z `shared/` — pilnuje tego lint (`eslint.config.js`); `worker.ts`
(kompozycja) i testy są wolne. Lint zawsze całym repo: `npm run lint`. Reguły obszaru:
`apps/<obszar>/CLAUDE.md`.

## Praca równoległa

- Instancja obszaru pracuje we własnym worktree `~/code/PSYCHOTERAPIA/ot-02-<obszar>` (odłączony HEAD,
  start w `apps/<obszar>`). Główny checkout: właściciel i jedna sesja root. Jedna instancja na checkout.
  Sprawdź to: `git rev-parse --show-toplevel`. Jeśli kończy się na `/ot-02`, a pracujesz nad obszarem,
  nie edytuj — podaj właścicielowi komendę
  `git worktree add --detach ~/code/PSYCHOTERAPIA/ot-02-<obszar> origin/main`, potem
  `cd ~/code/PSYCHOTERAPIA/ot-02-<obszar> && npm ci`. Dwie instancje w jednym drzewie nadpisują sobie
  pliki generowane i `.wrangler/state`.
- Start sesji: `git fetch && git rebase origin/main`; `npm ci`, jeśli zmienił się `package-lock.json`;
  `npm run db:migrate:local`.
- Cykl: `git add <ścieżki>` (nigdy `-A` ani `.`; ścieżki liczone od katalogu, w którym jesteś) →
  `git commit -m "<typ>(<obszar>): …"` (scope: `portal`, `panel`, `mcp`, `shared`, `root`) →
  `npm test && npm run typecheck && npm run lint` → `git fetch origin && git rebase origin/main` →
  `git push origin HEAD:main`. Odrzucony push → od `git fetch`. Konflikt → rozwiąż, cudzy kod
  zachowaj. Push = gotowe na produkcję.
- Nigdy: gałęzie, force push, `--amend`, `docs/`, `git push origin main` (wypchnie main głównego
  checkoutu, nie twoje commity).

## Kod wspólny (`shared/` i pliki w korzeniu)

- Przed zmianą znajdź wołających: `git grep -n "<moduł>" -- :/`. Zmiana albo addytywna, albo razem ze
  wszystkimi wołającymi w jednym commicie `…(shared): …`, po pełnym `npm test`.
- Właściciel treści: `shared/web/{styles,layout}.ts` i `shared/authored/page-css.ts` → portal (zmiana
  przestyluje panel i ekran zgody OAuth oraz zmieni hash CSP — obejrzyj `/admin` i `/oauth/authorize`);
  `shared/authored/{core,store}.ts` → kontrakt publikacji (panel pisze `headline`, `bio`,
  `first_meeting_*` i FAQ, czytają portal i MCP); `SCOPES` i `WIDGET_URI` w `shared/env.ts` → MCP.
- Niezmienniki: `toPublicTherapist` (`shared/db/catalog.ts`) jedyną projekcją publiczną; PII tylko
  szyfrowane `PII_ENC_KEY`, hashe przez `TOKEN_SIGNING_KEY` (rotacja osieroci dane);
  `shared/lib/{log,audit}.ts` z listą dozwolonych pól; `core.ts` bez DOM i bazy (bunduje się do JS
  panelu); strażnik faktów blokuje tylko ceny i terminy, kwalifikacji nie rusza; stopka kryzysowa to
  stała renderera; ceny i terminy zawsze z danych, nigdy z prozy.

## Migracje D1

- Numer = najwyższy po rebase + 1 (najwyższy dziś: `0022`). Kolizja → przenumeruj własną, niewypchniętą;
  `scripts/deploy.sh` odrzuca duplikat. Wypchniętej nie edytuj.
- Tylko addytywne (`CREATE`, `ADD COLUMN` z domyślną): stary kod musi działać na nowym schemacie, bo
  rollback Workera nie cofa D1. `DROP`/`RENAME` w dwóch deployach, za zgodą.
- Migracja w tym samym commicie co kod; słownik specialties i modalities = zmiana `z.enum`
  w `apps/mcp/schemas.ts` w tym samym commicie. Wiersze realnych osób → skill `migracja-realnych-danych`.

## Środowisko lokalne

- Porty z tabeli obszarów; właściciel w głównym checkoucie: `npm run dev` (:8787), e2e :8788.
- Każdy worktree ma własne `.wrangler/state`, pliki generowane i `.dev.vars`; `npm run db:reset:local`
  rusza tylko twój worktree. Panel lokalnie tylko po HTTPS (ciasteczko `__Host-ot_admin`).
  Preview nie wysyła maili (brak `EMAIL_API_KEY`) i nie ma R2.

## Deploy

- Konto Cloudflare `b1277ebcf49382e42bc5c111cd6adce3`, D1 produkcji
  `9186df20-81e8-405b-aa74-b8812c082751`. Błąd 7403 → poproś o `! npx wrangler login`.
- Tylko `npm run deploy` (`scripts/deploy.sh`: lock, czyste drzewo, `HEAD == origin/main`, `npm ci`,
  testy, migracja, build, deploy z SHA w `--message`). `wrangler deploy --env production` wprost —
  zabronione (preview wdraża się wprost — `README.md`, „Od pustego konta Cloudflare do
  działającego preview").
- Jeden Worker: deploy wypuszcza **wszystko wypchnięte, ze wszystkich obszarów**. W tej samej turze,
  przed deployem: lista zaległych commitów i ilu realnych terapeutek dotyka — informacja, nie pytanie.
  Procedura: skill `deploy-produkcja`. **Dlaczego:** 2026-09-17 deploy na prośbę „zdeployuj hosta"
  wypuścił dziesięć zaległych commitów i zmienił wygląd siedmiu realnych profili.
- Rollback: `npx wrangler rollback <id> --env production --message "<powód>"`. Zaraz potem
  `git revert <sha>`, push i deploy, inaczej następny deploy innej instancji wypuści błąd ponownie.

## Praca z właścicielem

- Decyzje techniczne podejmuj sam i raportuj jednym zdaniem; pytaj o cel i wygląd.
- Naprawiaj w tej samej turze, bez markerów długu (także bez komentarzy `ponytail:`).
- Zmiana skończona = wdrożona. Wynik pokazuj w przeglądarce, nie opisem.

## Kolory

- Żadnej tezy o kolorze bez pomiaru: tokeny `:root` przelicz na HSL, dominujące barwy zdjęć policz
  z pikseli, liczby podaj razem z wnioskiem. Oś odcieni i pomiar: skill `pomiar-kolorow`.
- Wrażenie kolorystyczne budują obrazy, nie tokeny.

## Dokumenty

- `README.md` (start, sekrety), `ARCHITECTURE.md`, `SECURITY.md`, `DPIA_CHECKLIST.md` (§11 = jedyna
  bramka wydania), `PRIVACY_DATA_MAP.md`, `RETENTION_POLICY.md`,
  `apps/mcp/PLUGIN_SUBMISSION_CHECKLIST.md`. Nazw tych plików i ich sekcji nie zmieniaj — cytuje je
  kod (`shared/env.ts` → „Sekrety" w README, `shared/db/retention.ts` → `RETENTION_POLICY.md` §5
  i `DPIA_CHECKLIST.md` §11).
- `docs/` prywatne: nigdy nie czytać, nigdy nie commitować.
