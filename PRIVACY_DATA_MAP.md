# Mapa danych osobowych — Otwarty Terapeuta

Dokument techniczny: co jest przechowywane, gdzie, po co i jak długo.
Nie jest opinią prawną ani deklaracją zgodności.

## 1. Zasada nadrzędna

Produkt dotyczy zdrowia psychicznego, więc **każde dane użytkownika traktujemy
jako szczególnie wrażliwe**, nawet jeśli formalnie nią nie są. Sam fakt rezerwacji
u terapeuty o określonej specjalizacji ujawnia informację o zdrowiu.

Konsekwencja projektowa: zbieramy absolutne minimum i nie tworzymy żadnego
trwałego powiązania między osobą a powodem szukania pomocy.

## 2. Czego NIE zbieramy — celowo

| Kategoria | Dlaczego nie |
| --- | --- |
| Treść rozmów z ChatGPT | serwer nie ma pola, które by ją przyjęło; żadne narzędzie MCP nie akceptuje wolnego tekstu opisującego sytuację |
| Opis objawów, historia leczenia, diagnoza | nie jesteśmy usługą medyczną; brak miejsca w schemacie |
| Notatki z sesji | terapeuta prowadzi je poza systemem |
| Powód szukania terapii przypisany do konta | filtry wyszukiwania nie są zapisywane ani wiązane z `user_id` |
| Dane biometryczne, lokalizacja, identyfikatory reklamowe | brak zastosowania |
| Cookies analityczne i marketingowe | jedyne ciasteczko to sesja panelu administracyjnego |

## 3. Katalog danych

### 3.1. Konto użytkownika — `users`

| Pole | Zawartość | Postać | Cel | Podstawa (do potwierdzenia prawnie) |
| --- | --- | --- | --- | --- |
| `id` | losowy identyfikator | jawna | klucz techniczny | wykonanie umowy |
| `email_hash` | HMAC adresu | nieodwracalna | odnalezienie konta bez przechowywania adresu w formie przeszukiwalnej | wykonanie umowy |
| `email_enc` | adres e-mail | AES-256-GCM | wysłanie kodu logowania i potwierdzenia rezerwacji | wykonanie umowy |
| `name_enc` | imię (opcjonalne) | AES-256-GCM | zwrot grzecznościowy w wiadomości | wykonanie umowy |
| `role` | `user`/`support`/`therapist`/`admin` | jawna | kontrola dostępu | uzasadniony interes |
| `created_at`, `updated_at`, `deleted_at` | znaczniki czasu | jawna | cykl życia konta | obowiązek prawny / uzasadniony interes |

### 3.2. Rezerwacja — `bookings`

| Pole | Postać | Uwagi |
| --- | --- | --- |
| `id`, `public_ref` | jawna | identyfikator techniczny i czytelny numer |
| `slot_id`, `therapist_id`, `user_id` | jawna | **powiązanie osoba ↔ terapeuta: element najbardziej wrażliwy w całej bazie** |
| `starts_at_utc`, `ends_at_utc`, `timezone` | jawna | termin wizyty |
| `session_type`, `mode` | jawna | forma spotkania |
| `price_minor`, `currency` | jawna | warunki handlowe, potrzebne do rozliczenia |
| `contact_name_enc`, `contact_email_enc`, `contact_phone_enc` | AES-256-GCM | kontakt w sprawie wizyty; usuwane po 12 miesiącach |
| `terms_version`, `privacy_version` | jawna | dowód akceptacji konkretnej wersji |
| `manage_token_hash` | HMAC | dostęp do strony zarządzania bez logowania |
| `status`, `cancelled_at`, `cancelled_by`, `cancel_reason` | jawna | cykl życia rezerwacji |

### 3.3. Zgody — `consent_records`
`user_id`, `kind` (`terms`/`privacy`), `version`, `granted_at`, `source`.
Bez treści, bez adresu IP, bez user-agenta.

### 3.4. Autoryzacja — `oauth_tokens`, `oauth_auth_codes`, `login_challenges`, `admin_sessions`
Wyłącznie skróty HMAC oraz metadane (klient, zakres, `resource`, wygaśnięcie).
`login_challenges.email_enc` jest zaszyfrowany i usuwany po wygaśnięciu wyzwania.
Ta sama tabela obsługuje logowanie do panelu, zgodę OAuth i rejestrację terapeuty
(kolumna `purpose`); przy rejestracji `context` przechowuje przez 15 minut
tymczasową treść zgłoszenia potrzebną do utworzenia profilu po wpisaniu kodu.
**Żaden token nie jest przechowywany w postaci jawnej.**

### 3.5. Powiadomienia — `notification_outbox`
`payload_enc` (AES-256-GCM) zawiera adresata i treść wiadomości. Wiersz istnieje
wyłącznie do momentu dostarczenia; usuwany zgodnie z polityką retencji.

### 3.6. Audyt — `audit_events`
`at`, `actor_type`, `actor_id`, `action`, `subject_type`, `subject_id`, `meta_json`.
`meta_json` przechodzi przez listę dozwolonych kluczy (`src/lib/audit.ts`):
**żadnego wolnego tekstu, żadnych danych kontaktowych, żadnych tokenów, żadnych
treści zdrowotnych.**

### 3.7. Dane terapeutów — `therapists` i tabele powiązane
Dane osoby prowadzącej działalność zawodową: nazwisko, opis, kwalifikacje,
adres gabinetu, ceny — publikowane świadomie i za zgodą.
Wyjątki, **nigdy niepubliczne**: `verification_notes`, `contact_email_enc`.

### 3.8. Dane referencyjne — `crisis_resources`, słowniki
Bez danych osobowych. Publiczne. Wymagają weryfikacji, nie ochrony.

## 4. Przepływy danych

### 4.1. Wyszukiwanie (anonimowe)
```
użytkownik → ChatGPT → search_therapists(ustrukturyzowane filtry) → D1 (odczyt)
```
Nic nie jest zapisywane. Filtry istnieją tylko w pamięci obsługi żądania i wracają
w polu `applied_filters` odpowiedzi, żeby użytkownik widział, na czym oparto wynik.
Nie są wiązane z kontem ani logowane.

### 4.2. Połączenie konta (OAuth)
```
użytkownik → /oauth/authorize → Turnstile → kod e-mail → dostawca poczty
                                                        → skrzynka użytkownika
           → /oauth/token → access + refresh token (w bazie tylko HMAC)
```

### 4.3. Rezerwacja
```
preview_booking  → odczyt D1, podpisany token (bez PII)
create_booking   → zapis: bookings (kontakt zaszyfrowany), consent_records,
                          audit_events, notification_outbox
cron / waitUntil → dostawca poczty → skrzynka użytkownika
```

### 4.4. Odbiorcy danych

| Odbiorca | Co otrzymuje | Rola |
| --- | --- | --- |
| Terapeuta | dane niezbędne do realizacji wizyty | odrębny administrator lub współadministrator — **do ustalenia prawnie** |
| Cloudflare | cała infrastruktura i dane w tranzycie | procesor |
| Dostawca poczty (np. Resend) | adres odbiorcy, treść potwierdzenia | procesor |
| ChatGPT / OpenAI | odpowiedzi narzędzi (dane publiczne + własne rezerwacje użytkownika) | poza naszą kontrolą; użytkownik świadomie łączy konto |

**Nie sprzedajemy i nie udostępniamy danych do celów marketingowych.**

## 5. Transfery poza EOG

Cloudflare Workers i D1 działają w sieci globalnej. Konfiguracja jurysdykcji
(`jurisdiction: 'eu'` dla Durable Objects, lokalizacja D1) **wymaga świadomej
decyzji przed produkcją** i jest wpisana w `DPIA_CHECKLIST.md`.
Dostawca poczty może przetwarzać dane poza EOG — do zweryfikowania w umowie.

## 6. Prawa osób

| Prawo | Realizacja |
| --- | --- |
| Dostęp / kopia | `/admin/uzytkownicy` → eksport JSON (odszyfrowany, komplet: konto, rezerwacje, zgody) |
| Sprostowanie | zmiana danych kontaktowych przy rezerwacji; e-mail konta przez kontakt z obsługą |
| Usunięcie | `/admin/uzytkownicy` → usuwa dane kontaktowe i konto; wiersze rezerwacji pozostają w formie pozbawionej danych identyfikujących (potrzebne do rozliczeń) |
| Ograniczenie / sprzeciw | procedura organizacyjna — **do opisania przed produkcją** |
| Przenoszalność | eksport JSON jest formatem ustrukturyzowanym i czytelnym maszynowo |

Wszystkie operacje na danych użytkownika trafiają do `audit_events`.

## 7. Podsumowanie środków technicznych

| Środek | Gdzie |
| --- | --- |
| Szyfrowanie aplikacyjne PII (AES-256-GCM) | `src/lib/crypto.ts` |
| Nieodwracalny klucz wyszukiwania e-maila | `emailLookupHash()` |
| Redakcja logów | `src/lib/log.ts` |
| Lista dozwolonych pól audytu | `src/lib/audit.ts` |
| Minimalizacja wejścia (brak pól na wolny tekst) | `src/mcp/schemas.ts` |
| Projekcje publiczne bez pól prywatnych | `src/db/catalog.ts` |
| Brak trackerów i zewnętrznych skryptów | `src/web/layout.ts` (CSP) |
| Eksport i usunięcie danych | `src/db/users.ts` |

## 8. Do ustalenia przed produkcją

Pytania prawne z tej sekcji (administrator danych, podstawa prawna z art. 6 i 9,
umowy powierzenia, rejestr czynności, transfery poza EOG, zatwierdzenie polityki)
są pozycjami 3–7 bramki wydania w **`DPIA_CHECKLIST.md` §11**. Merytoryczny
kontekst każdej z nich znajdziesz w sekcjach §1–§5 powyżej.
