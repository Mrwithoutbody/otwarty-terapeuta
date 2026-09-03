# System szablonów: która to próba i dlaczego znowu jest źle

Spisane 2026-09-03 po pytaniu właściciela: „No to jak Ewelina ma dodać teraz
szablon?”. Odpowiedź brzmiała: nie może. To jest **piąta** próba zbudowania
systemu szablonów i piąty raz szablon skończył jako kod dla programisty.

## Próby

| # | kiedy | co | gdzie | dlaczego padło |
| --- | --- | --- | --- | --- |
| 1 | 2025-08 | `profesjonalna-psychoterapia`, Vite + React, generator statyczny | `pp-01` | strony w komponentach React; brak pojęcia szablonu |
| 2 | 2026-08 | Astro, motywy jako katalogi komponentów, treść w JSON | `pp-02` | motyw = pliki `.astro`; realne projekty (Ewelina, Anna, Olga…) skończyły w `arch/` jako 5 115 linii ręcznego kodu, bo w motyw nie dało się ich wpasować |
| 3 | 2026-08-24/25 | własny silnik profilu w ot-02: 21 sekcji, osie układu, budowniczy w panelu | `ot-02 src/web/sections.ts` (skasowany) | trzy rundy cofnięć kompozycji; sekcje po polsku, na sztywno w kodzie; każdy nowy wygląd = commit |
| 4 | 2026-08-26 → 09-02 | x402Landings: silnik bloków najpierw jako serwis HTTP, potem jako pakiet wklejany do hosta | `x402Landings`, `ot-02 src/web/lp.ts` | motywy i szablony dalej w `themes.ts`/`presets.ts`; dwa motywy z pp-02 sportowane ręcznie do TypeScriptu |
| 5 | 2026-09-03 | ta sama usługa jako „WordPress uproszczony”: baza stron, edytor w iframie, API, hosting | `x402Landings`, ot-02 jako klient | działa dla terapeutki (wybór szablonu, bloki, teksty). **Nie działa dla projektantki: nowy szablon to nadal `presets.ts` i deploy** |

## Dlaczego za każdym razem to samo

Przez pięć prób ani razu nie padło pytanie: **kto tworzy szablon, w czym, i co
dokładnie oddaje**. Odpowiedź, którą właściciel miał od początku: projektantka,
w narzędziu graficznym albo w HTML/CSS, i oddaje gotowy wygląd. Dowód leży w
`pp-02/arch/`: dziewięć stron napisanych ręcznie, bo żaden z naszych „systemów
szablonów” nie umiał przyjąć jej pracy.

Za każdym razem definiowałem „szablon” od strony silnika: zestaw bloków, osie
układu, tokeny CSS, renderery w TypeScripcie. To jest szablon dla programisty.
W WordPressie motyw to katalog plików, który projektant pisze i **wgrywa**, a
rdzeń go tylko uruchamia. U nas motyw to funkcje w `themes.ts`, więc „wgrać”
znaczy „zlecić programiście port”. Piąta próba dołożyła edytor i bazę, ale nie
ruszyła tej granicy, więc odpowiedź na pytanie o Ewelinę nie zmieniła się od
próby drugiej.

Drugi błąd, powtarzany: każda próba zaczynała od budowania silnika i kończyła
na obietnicy „szablony potem”. Silnik zawsze wychodził, szablony nigdy nie
wyszły spoza kodu.

## Czego nie wolno powtórzyć w próbie szóstej

1. **Najpierw artefakt projektantki, potem silnik.** Zanim powstanie linia
   kodu: jeden realny szablon od Ewelinie w formacie, w którym ona pracuje,
   wgrany do systemu bez udziału programisty. Dopiero to jest test akceptacyjny.
2. **Szablon = pliki, nie kod rdzenia.** HTML z miejscami na bloki, własny CSS,
   obrazek podglądu, opis. Rdzeń dostarcza dane (bloki, dane hosta), szablon
   je układa. Żadnych rendererów per motyw w TypeScripcie.
3. **Wgrywanie w panelu**, nie commit. Nowy szablon pojawia się w galerii
   każdego hosta po zapisaniu, bez deployu.
4. **`pp-02/arch/` to zbiór testowy.** Jeśli szósta próba nie przyjmie tych
   dziewięciu stron jako szablonów, jest tak samo zła jak pięć poprzednich.

## Co z piątej próby zostaje

Baza stron, edytor bloków, API dla hostów, hosting, bloki danych (kalendarz,
oferta, FAQ) i migracja produkcji nie są złe: to warstwa „treść i dane”.
Wymiany wymaga warstwa „wygląd”: motyw jako kod → motyw jako wgrywane pliki.
