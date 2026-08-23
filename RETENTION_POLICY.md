# Polityka retencji — Otwarty Terapeuta

Wersja: 2026-08-01. Dokument techniczno-operacyjny; okresy wymagają
zatwierdzenia prawnego przed produkcją.

## 1. Zasada

Każda kategoria danych ma jawny okres przechowywania i jawny mechanizm usunięcia.
Dane, które nie są potrzebne do realizacji wizyty, rozliczenia albo obrony przed
roszczeniem, usuwamy najwcześniej jak to możliwe.

## 2. Tabela retencji

| Dane | Okres | Co się dzieje po upływie | Mechanizm |
| --- | --- | --- | --- |
| Filtry wyszukiwania | **0** | nigdy nie są zapisywane | z założenia |
| Kody logowania (`login_challenges`, `purpose` = `oauth`/`admin`) | 15 min (ważność) | usunięcie wiersza | cron co 5 min |
| Niepotwierdzone zgłoszenia (`login_challenges`, `purpose` = `therapist_signup`) | 15 min | usunięcie wiersza wraz z tymczasowymi danymi profilu w `context` | cron co 5 min |
| Kody autoryzacyjne (`oauth_auth_codes`) | 5 min | usunięcie wiersza | cron |
| Tokeny dostępu (`oauth_tokens`, `access`) | 1 h | usunięcie wiersza | cron |
| Tokeny odświeżania (`oauth_tokens`, `refresh`) | 30 dni | usunięcie wiersza | cron |
| Sesje panelu (`admin_sessions`) | 8 h | usunięcie wiersza | cron |
| Wysłane powiadomienia (`notification_outbox`) | 30 dni od wysłania | usunięcie wiersza | **do wdrożenia — patrz §5** |
| Nieudane powiadomienia (`status='failed'`) | 90 dni | usunięcie wiersza | **do wdrożenia** |
| Dane kontaktowe rezerwacji (`bookings.contact_*_enc`) | 12 mies. od terminu wizyty | wyzerowanie kolumn, reszta wiersza zostaje | **do wdrożenia** |
| Rezerwacja (dane nieidentyfikujące) | 6 lat od terminu | usunięcie | ręcznie / **do wdrożenia** |
| Zgody (`consent_records`) | 6 lat od udzielenia | usunięcie | ręcznie / **do wdrożenia** |
| Audyt (`audit_events`) | 24 mies. | usunięcie | **do wdrożenia** |
| Konto nieaktywne (brak logowania i rezerwacji) | 24 mies. | pseudonimizacja jak przy żądaniu usunięcia | **do wdrożenia** |
| Konto — żądanie usunięcia | natychmiast | `eraseUserData()` | panel, gotowe |
| Profil terapeuty po wycofaniu | `deleted_at`, niewidoczny publicznie | usunięcie po 12 mies. | ręcznie |
| Zasoby kryzysowe | bezterminowo | wymagają weryfikacji co 90 dni, nie usunięcia | panel |
| Logi observability Cloudflare | zgodnie z ustawieniami konta | — | konfiguracja Cloudflare |

Okres 6 lat dla rezerwacji i zgód wynika z ogólnego terminu przedawnienia roszczeń
w prawie polskim. **Wymaga potwierdzenia prawnego** dla tego konkretnego modelu
usługi (serwis nie jest stroną umowy o świadczenie terapii).

## 3. Co jest zaimplementowane dzisiaj

| Mechanizm | Gdzie | Status |
| --- | --- | --- |
| Czyszczenie wygasłego stanu autoryzacji | `purgeExpiredAuthState()`, cron co 5 min | **działa** |
| Ponawianie i wygaszanie powiadomień | `drainOutbox()`, 6 prób | **działa** |
| Usunięcie danych na żądanie | `eraseUserData()`, panel `/admin/uzytkownicy` | **działa** |
| Eksport danych na żądanie | `exportUserData()`, panel | **działa** |
| Soft delete profili | `therapists.deleted_at` filtrowane w każdym zapytaniu publicznym | **działa** |

## 4. Co robi `eraseUserData()`

1. Zeruje `contact_name_enc`, `contact_email_enc`, `contact_phone_enc` we
   wszystkich rezerwacjach użytkownika.
2. Usuwa wszystkie tokeny, kody autoryzacyjne i sesje panelu.
3. Zeruje `email_enc` i `name_enc`, podmienia `email_hash` na wartość
   niepowiązywalną, ustawia `deleted_at`.

**Co zostaje:** wiersz rezerwacji bez danych identyfikujących (termin, terapeuta,
cena, status) oraz wpisy audytowe wskazujące na już nieistniejące konto.
Uzasadnienie: terapeuta i operator muszą móc wykazać, że płatna wizyta się odbyła.
**Ta ocena wymaga potwierdzenia prawnego.**

## 5. Zapytania retencyjne do dopisania do crona

Pozycja 8 bramki wydania (`DPIA_CHECKLIST.md` §11). Tutaj jest gotowy SQL.

Zadanie cron istnieje (`scheduled` w `src/index.ts`), ale realizuje dziś tylko
czyszczenie stanu autoryzacji i ponawianie powiadomień. Przed produkcją należy
dopisać do niego:

```sql
-- Powiadomienia: usuń wysłane po 30 dniach, nieudane po 90.
DELETE FROM notification_outbox
 WHERE (status = 'sent'   AND updated_at < datetime('now','-30 days'))
    OR (status = 'failed' AND updated_at < datetime('now','-90 days'));

-- Dane kontaktowe rezerwacji: 12 miesięcy od terminu wizyty.
UPDATE bookings
   SET contact_name_enc = NULL, contact_email_enc = NULL, contact_phone_enc = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
 WHERE starts_at_utc < datetime('now','-12 months')
   AND (contact_name_enc IS NOT NULL OR contact_email_enc IS NOT NULL OR contact_phone_enc IS NOT NULL);

-- Audyt: 24 miesiące.
DELETE FROM audit_events WHERE at < datetime('now','-24 months');
```

Wymagane przed uruchomieniem tych zapytań:
1. zatwierdzenie okresów przez prawnika,
2. potwierdzona procedura kopii zapasowych D1 (usunięcie musi obejmować kopie),
3. test na środowisku preview z realistycznym wolumenem.

## 6. Kopie zapasowe

Nieustalone. Przed produkcją trzeba zdecydować:
- częstotliwość i sposób (`wrangler d1 export` na harmonogramie? Time Travel D1?),
- miejsce przechowywania i szyfrowanie kopii,
- **retencję kopii — usunięcie danych na żądanie musi objąć także kopie**,
- procedurę i test odtworzenia.

## 7. Przegląd

Ta polityka podlega przeglądowi co 12 miesięcy oraz każdorazowo przy:
- dodaniu nowej kategorii danych,
- zmianie odbiorców danych,
- zmianie podstawy prawnej przetwarzania.
