# Bezpieczeństwo — Otwarty Terapeuta

## Zgłaszanie podatności

Podatności zgłaszaj na **security@otwartyterapeuta.pl** (do czasu uruchomienia
tej skrzynki: adres z `SUPPORT_EMAIL` w `wrangler.jsonc`).

- Nie zgłaszaj podatności przez publiczne issue.
- Prosimy o: opis, kroki odtworzenia, wpływ, ewentualny PoC.
- Potwierdzenie przyjęcia: **do 3 dni roboczych.** Wstępna ocena: do 10 dni roboczych.
- Nie testuj na danych realnych użytkowników. Nie wykonuj DoS. Nie próbuj uzyskać
  dostępu do cudzych rezerwacji poza własnym kontem testowym.
- Nie podejmujemy kroków prawnych wobec badaczy działających zgodnie z powyższym.

## Środki bezpieczeństwa w kodzie

| Obszar | Realizacja |
| --- | --- |
| Transport | wyłącznie HTTPS; HSTS na produkcji |
| CSP strony WWW | `default-src 'none'`, brak `unsafe-inline`, brak `unsafe-eval`; jedyna zewnętrzna domena to Turnstile i tylko na stronach z formularzem |
| CSP widżetu | `_meta.ui.csp` z pustymi `connectDomains` i `resourceDomains` |
| Nagłówki | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` |
| XSS | React (widżet) + `escapeHtml()` (strona WWW) na każdym polu pochodzącym od użytkownika lub terapeuty |
| Linki | `safeUrl()` / `safeHref()` — przechodzą tylko `https:`, `mailto:` i ścieżki własnego pochodzenia |
| CSRF | ciasteczko `__Host-` + SameSite=Lax + token wyprowadzony HMAC-em z sekretu sesji, weryfikowany przy każdym POST panelu |
| IDOR | rezerwacja cudza zwraca `not_found`, nie `forbidden`; token potwierdzenia jest związany z konkretnym `user_id` |
| Enumeracja | identyfikatory z 96 bitami entropii; logowanie zwraca identyczną odpowiedź dla konta istniejącego i nieistniejącego; `/oauth/revoke` zawsze 200 |
| Replay | kod autoryzacyjny jednorazowy (ponowne użycie unieważnia wszystkie tokeny pary klient–użytkownik); refresh token rotowany; `idempotency_key` na rezerwacjach |
| Rate limiting | `RL_PUBLIC` 120/min per IP (`/mcp`), `RL_WRITE` 10/min per użytkownik (zapisy), `RL_AUTH` 8/min per IP (logowanie, rejestracja klienta) |
| Turnstile | wszystkie publiczne formularze (logowanie OAuth, logowanie do panelu) |
| DNS rebinding | walidacja nagłówków `Host` i `Origin` przed obsługą żądania MCP |
| Szyfrowanie danych kontaktowych | AES-256-GCM (Web Crypto), losowy IV, klucz w sekrecie |
| Wyszukiwanie po e-mailu | HMAC adresu, nie sam adres |
| Sekrety | wyłącznie Wrangler secrets; repozytorium nie zawiera żadnej wartości |
| Logi | lista dozwolonych pól + redakcja e-maili, telefonów i tokenów |
| Prompt injection | neutralizacja markerów przy zapisie + brak jakichkolwiek uprawnień treści terapeuty |
| Walidacja | Zod po stronie serwera na każdym wejściu MCP; parametryzowane zapytania SQL |

## Model uprawnień

| Rola | Może |
| --- | --- |
| anonimowy | katalog, profile, FAQ, terminy, zasoby kryzysowe |
| `booking:read` | podsumowanie rezerwacji, własne rezerwacje |
| `booking:write` | utworzenie i odwołanie własnej rezerwacji, po jawnym potwierdzeniu |
| `support` | minimalne dane rezerwacji, odwołanie z powodem audytowym |
| `therapist` | wyłącznie własny profil, FAQ, oferta, dostępność, własne rezerwacje |
| `admin` | pełny zakres, w tym weryfikacja, publikacja, zasoby kryzysowe, eksport i usunięcie danych |

Zakres i właściciela zasobu weryfikuje **serwer przy każdym wywołaniu**.
Ani model, ani widżet nie są granicą bezpieczeństwa.

## Rotacja sekretów

### `TURNSTILE_SECRET_KEY`
Bezstanowy. Wygeneruj nowy w panelu Cloudflare i wykonaj:
```bash
npx wrangler secret put TURNSTILE_SECRET_KEY --env production
```
Zaktualizuj też `TURNSTILE_SITE_KEY` w `wrangler.jsonc` i wdroż.

### `EMAIL_API_KEY`
Bezstanowy. Nowy klucz u dostawcy → `wrangler secret put` → wdrożenie →
unieważnienie starego klucza u dostawcy.

### `TOKEN_SIGNING_KEY` — **rotacja wymaga migracji**
Ten klucz podpisuje:
1. tokeny OAuth (hash w `oauth_tokens.token_hash`),
2. kody autoryzacyjne i kody logowania,
3. tokeny potwierdzeń `preview_booking`,
4. linki zarządzania rezerwacją (`bookings.manage_token_hash`),
5. tokeny CSRF i sesje panelu,
6. **klucz wyszukiwania konta** (`users.email_hash`).

Punkty 1–5 są krótkotrwałe albo odtwarzalne; punkt 6 nie. Procedura:

```bash
# 1. Tryb serwisowy / okno konserwacyjne.
# 2. Zrób kopię bazy:
npx wrangler d1 export otwarty-terapeuta-prod --env production --output backup.sql

# 3. Przelicz `users.email_hash` nowym kluczem.
#    Wymaga odszyfrowania `email_enc` kluczem PII_ENC_KEY i policzenia
#    HMAC(nowy_klucz, "email:" + adres) dla każdego konta.
#    Uruchom jednorazowy skrypt migracyjny w Workerze mającym OBA klucze.

# 4. Ustaw nowy klucz i wdroż:
npx wrangler secret put TOKEN_SIGNING_KEY --env production
npx wrangler deploy --env production

# 5. Unieważnij stan zależny od starego klucza:
npx wrangler d1 execute otwarty-terapeuta-prod --env production --remote --command \
  "DELETE FROM oauth_tokens; DELETE FROM oauth_auth_codes; DELETE FROM login_challenges; DELETE FROM admin_sessions;"
```

Skutki: wszyscy użytkownicy muszą ponownie połączyć konto, wszystkie sesje panelu
wygasają, wszystkie linki „zarządzaj rezerwacją” przestają działać (rezerwacje
pozostają ważne — dostęp do nich odbywa się przez `list_my_bookings`).

### `PII_ENC_KEY` — **rotacja wymaga ponownego zaszyfrowania**
1. Kopia bazy.
2. Skrypt migracyjny w Workerze z oboma kluczami: odszyfruj starym, zaszyfruj nowym
   kolumny `users.email_enc`, `users.name_enc`, `bookings.contact_*_enc`,
   `notification_outbox.payload_enc`, `therapists.contact_email_enc`.
3. `wrangler secret put PII_ENC_KEY --env production` i wdrożenie.
4. Bezpieczne usunięcie kopii ze starymi danymi.

> Nie ma obecnie identyfikatora wersji klucza. Przy pierwszej rotacji warto dodać
> prefiks wersji do ciphertextu, aby umożliwić rotację bez okna serwisowego.

## Procedura incydentu

### Klasyfikacja

| Poziom | Przykład | Reakcja |
| --- | --- | --- |
| **P1** | wyciek danych kontaktowych lub tokenów; nieuprawniony dostęp do cudzych rezerwacji | natychmiast |
| **P2** | podatność umożliwiająca eskalację uprawnień bez potwierdzonego wykorzystania | 24 h |
| **P3** | XSS w polu bez uprawnień, wyciek nie-osobowy | 5 dni roboczych |
| **P4** | brak nagłówka, nieaktualna zależność | najbliższy cykl |

### Kroki dla P1/P2

1. **Zatrzymaj krwawienie.** Jeśli wektorem jest MCP: usuń trasę `mcp.*` albo wdroż
   wersję z `env.RL_PUBLIC` ustawionym restrykcyjnie. Jeśli auth: usuń wszystkie
   tokeny (`DELETE FROM oauth_tokens`).
2. **Zabezpiecz dowody.** Wyeksportuj `audit_events` i logi observability z okna
   incydentu, zanim cokolwiek zmienisz.
3. **Rotuj to, co mogło wyciec** — zgodnie z procedurami powyżej.
4. **Ustal zakres.** Które konta? Czy dane kontaktowe? Czy dane zdrowotne
   (w tym systemie nie powinny w ogóle istnieć — jeśli istnieją, to osobne
   ustalenie do wyjaśnienia).
5. **Powiadom.** Naruszenie ochrony danych osobowych: zgłoszenie do organu
   nadzorczego w ciągu **72 godzin** od stwierdzenia (art. 33 RODO) oraz
   powiadomienie osób, których dane dotyczą, jeśli ryzyko jest wysokie (art. 34).
   Decyzję o zgłoszeniu podejmuje administrator danych z prawnikiem — nie zespół
   techniczny samodzielnie.
6. **Napraw i potwierdź.** Poprawka + test regresyjny, który by ten incydent wykrył.
7. **Retrospektywa bez winnych**, w ciągu 5 dni roboczych. Wynik: wpis w
   `DECISIONS.md` albo nowy test.

### Kontakty do uzupełnienia przed produkcją

| Rola | Kto | Kontakt |
| --- | --- | --- |
| Administrator danych | DO UZUPEŁNIENIA | — |
| Inspektor ochrony danych (jeśli powołany) | DO UZUPEŁNIENIA | — |
| Osoba odpowiedzialna za bezpieczeństwo | DO UZUPEŁNIENIA | — |
| Radca prawny | DO UZUPEŁNIENIA | — |
| Konsultacja kliniczna | DO UZUPEŁNIENIA | — |

## Higiena zależności

- Wszystkie wersje w `package.json` są **przypięte** (bez `^`, bez `~`).
- Przed każdym wdrożeniem produkcyjnym: `npm audit --omit=dev`.
- Aktualizacje zależności wchodzą osobnym commitem, z przejściem pełnego
  `npm run typecheck && npm run lint && npm test && npm run test:e2e`.

## Czego ten dokument NIE stwierdza

Nie stwierdza zgodności z RODO ani z żadną inną regulacją. Opisuje wyłącznie
środki techniczne obecne w kodzie. Ocena zgodności wymaga analizy prawnej
i przeprowadzenia DPIA — patrz `DPIA_CHECKLIST.md`.
