---
name: podglad-panelu
description: Otwarcie zalogowanego panelu terapeutki lokalnie — `npm run dev:panel` po https, kod logowania z logu serwera, sesja wklejona do okna Chrome przez Playwright. Użyj, gdy właściciel ma obejrzeć panel, narzędzie strony, „Dane i cennik" albo „Dostępność", i gdy pisze „pokaż w przeglądarce", „otwórz panel", „zaloguj mnie".
---

# Podgląd panelu lokalnie

Właściciel chce dostać **otwarte, zalogowane okno** — nie instrukcję z adresem, mailem
i kodem. Preview na Cloudflare się nie nadaje: nie wysyła maili (brak `EMAIL_API_KEY`)
i nie ma R2.

## 1. Serwer

```sh
npm run db:reset:local     # tylko gdy lokalna baza jest pusta albo po nowej migracji
npm run dev:panel          # https://localhost:8792, certyfikat self-signed
```

Https jest konieczne: ciasteczko sesji ma prefiks `__Host-` (Secure), po http
przeglądarka je odrzuca. Dlatego `curl -k` i `ignoreHTTPSErrors` niżej.

## 2. Kod logowania

```sh
EMAIL=$(grep '^ADMIN_BOOTSTRAP_EMAILS=' .dev.vars | cut -d= -f2 | cut -d, -f1)
curl -sk -X POST https://localhost:8792/admin/login \
  -d "email=$EMAIL" -d "cf-turnstile-response=x" | grep -o 'challenge_id" value="[^"]*'
```

Turnstile lokalnie używa testowych kluczy „always passes" (`wrangler.jsonc`, `.dev.vars`),
więc dowolny niepusty `cf-turnstile-response` przechodzi. Kod dostaje tylko konto
personelu albo adres z `ADMIN_BOOTSTRAP_EMAILS`; odpowiedź dla obcego adresu wygląda
tak samo.

## 3. Kod z logu serwera

`EMAIL_PROVIDER=console`, a logowanie opróżnia outbox od razu (`drainOutbox`
w `waitUntil`) — kod jest w logu w ciągu sekundy, nie czekasz na cron:

```sh
grep 'Kod logowania do panelu:' <log dev:panel> | tail -1   # 6 cyfr, ważny 15 minut
```

## 4. Sesja

```sh
curl -sk -D - -o /dev/null -X POST https://localhost:8792/admin/login/confirm \
  -d "challenge_id=$CID" -d "code=$CODE"
```

`302 → /admin` i `Set-Cookie: __Host-ot_admin=…` (8 h). Wartość ciasteczka bierzesz
do kroku 5.

## 5. Okno Chrome

Playwright z lokalnie zainstalowanym Chrome (`channel: 'chrome'`, tak jak
`playwright.config.ts`). Skrypt trzymaj w katalogu roboczym sesji, nie w repo, ale
uruchom **z korzenia repo** i w tle — `--input-type=module -e` rozwiązuje importy
względem katalogu bieżącego, a proces musi żyć, inaczej okno zniknie:

```sh
COOKIE=<wartość __Host-ot_admin> node --input-type=module -e "$(cat <skrypt>)" &
```

```js
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
await ctx.addCookies([{ name: '__Host-ot_admin', value: process.env.COOKIE,
  url: 'https://localhost:8792', httpOnly: true, sameSite: 'Lax' }]);
const page = await ctx.newPage();
await page.goto('https://localhost:8792/admin');
await new Promise(() => {}); // bez browser.close(): okno zostaje dla właściciela
```

Rola `therapist` z `/admin` wpada prosto w `/admin/terapeuci/:id/strona`; z konta
`admin` wejdź tam adresem.

## 6. Zamknięcie

Napisz, co jest otwarte i pod jakim adresem. Serwer `dev:panel` i proces Playwrighta
ubij dopiero, gdy właściciel skończy oglądać.
