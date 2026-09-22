---
name: deploy-produkcja
description: Procedura wydania Otwartego Terapeuty na produkcję — konto, lista zaległych commitów, liczba realnych terapeutek, sha256 przed i po, `npm run deploy`, gotowy rollback. Użyj, gdy zmiana jest skończona albo ktoś pisze „wdróż", „deploy", „na produkcję", „wypuść", a także gdy trzeba cofnąć wydanie.
---

# Deploy na produkcję

Jeden Worker. Deploy wypuszcza **wszystko, co wypchnięte** — ze wszystkich obszarów,
nie tylko twój commit. Host renderuje na żywo, więc zmiana dotyka wszystkich w tej
samej sekundzie. Dlatego kroki 2-5 są przed, nie po.

## 1. Konto

```bash
npx wrangler whoami
```

Musi pokazać `b1277ebcf49382e42bc5c111cd6adce3` (GOTO:RDY otwarty). Inne konto →
`npm run db:migrate:prod` i deploy padają z „not authorized [code: 7403]".
Wtedy poproś właściciela o `! npx wrangler login` na właściwym koncie;
`CLOUDFLARE_ACCOUNT_ID` bez dostępu nic nie da.

## 2. Co stoi na produkcji (zapisz od razu)

```bash
npx wrangler deployments list --env production | tail -12
```

Ostatni blok to stan żywy. Potrzebujesz dwóch rzeczy:

- `Version(s): (100%) <uuid>` — **cel rollbacku**, zanotuj teraz, nie po awarii;
- `Message: <krótki sha>` — wersja kodu. `Message: -` = deploy sprzed reguły z SHA,
  wtedy wersję ustal po sygnaturze w żywym kodzie.

## 3. Lista zaległych commitów

```bash
git fetch -q origin main
git log <sha z kroku 2>..origin/main --oneline
```

Pogrupuj po scope commita (`portal|panel|mcp|shared|root`). To jest lista, która
wyjedzie na żywo.

## 4. Ilu realnych terapeutek to dotyka

```bash
curl -s https://otwartyterapeuta.pl/sitemap.xml | grep -c '/terapeuci/[a-z0-9-]*</loc>'
```

Sitemapa niesie wyłącznie opublikowane profile z `is_demo = 0`
(`listSitemapEntries` w `shared/db/catalog.ts`), więc ta liczba to realne osoby.
Zmiana tylko w `apps/mcp/` nie rusza żadnej strony — wtedy 0.

## 5. Powiedz właścicielowi — w tej samej turze, przed deployem

Lista z kroku 3 + liczba z kroku 4 + id wersji z kroku 2. To **informacja, nie pytanie**;
nie czekaj na zgodę, chyba że właściciel sam powiedział „nie wdrażaj".

## 6. sha256 odpowiedzi MCP przed deployem

```bash
mcp() { curl -s -X POST https://mcp.otwartyterapeuta.pl/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'mcp-protocol-version: 2025-06-18' -d "$1" | sha256sum; }

mcp '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
mcp '{"jsonrpc":"2.0","id":2,"method":"resources/read","params":{"uri":"ui://otwarty-terapeuta/widget/v1.html"}}'
```

Obie odpowiedzi są deterministyczne — dwa strzały pod rząd dają ten sam hash.
Różnica po deployu mówi dokładnie, co się zmieniło: schematy narzędzi czy widżet.

## 7. Deploy

```bash
npm run deploy
```

Tylko tak. `wrangler deploy` prosto z ręki jest zabroniony: `scripts/deploy.sh`
trzyma blokadę (`flock`), sprawdza czyste drzewo, `HEAD == origin/main`, `npm ci`,
zdublowane numery migracji, `typecheck`, `test`, a dopiero potem robi
migracja → build widżetu → `wrangler deploy --message "$(git rev-parse --short HEAD)"`.
Skrypt odmawia z komunikatem po polsku — czytaj go, nie obchodź.

## 8. Po deployu

1. Nowe id wersji: `npx wrangler deployments list --env production | tail -10`.
2. Hamulec pod ręką — jedna komenda, bez budowania:
   ```bash
   npx wrangler rollback <version-id sprzed deployu> --env production --message "<powód>"
   ```
   Rollback Workera **nie cofa D1**. Zaraz po nim `git revert <sha>`, push i deploy —
   inaczej następny deploy dowolnej instancji wypuści ten sam błąd jeszcze raz.
3. Smoke: `curl -sI https://otwartyterapeuta.pl/`, `…/terapeuci`, oraz oba polecenia
   z kroku 6. Porównaj hashe.
4. Jeśli zmieniło się `_meta` narzędzia (CSP, `openai/outputTemplate`, adnotacje):
   powiedz właścicielowi, że w ustawieniach wtyczki trzeba `…` → **Odłącz** →
   **Połącz** → „Kontynuuj bez konta". Sam deploy tego nie odświeża. Szczegóły cache:
   skill `chatgpt-plugin`.
