---
name: pomiar-kolorow
description: Pomiar kolorystyki Otwartego Terapeuty przed postawieniem tezy — tokeny `:root` przeliczone na HSL, histogram odcieni obrazów z PIL, sprawdzenie osi odcieni serwisu. Użyj przy każdym twierdzeniu o kolorze („za zielone", „za chłodno", „pasuje do palety", „brakuje ciepła"), przed zmianą odcienia, tła, gradientu albo akcentu.
---

# Kolorystyka: najpierw pomiar, potem teza

Ocena „na oko" ze zrzutu myli chromę z jasnością. 2026-08-24 wyszło z tego
pchnięcie profili w chłodny szałwiowy (`#e9efe0`, odcień 84°) na podstawie tezy,
że strona główna „też jest tylko zielona". Pomiar pokazał odwrotność: ciepło
głównej niosą **obrazy**, nie CSS. Trzy rundy cofania.

Żadnej tezy bez liczb. Liczby idą do odpowiedzi razem z wnioskiem.

## 1. Tokeny `:root` → HSL

Trzy pliki, trzy różne palety:

- `shared/web/styles.ts` — serwis (portal i panel, `APP_CSS`),
- `shared/authored/page-css.ts` — strony autorskie terapeutek,
- `apps/mcp/widget/widget.css` — widżet w ChatGPT, osobna paleta (patrz krok 3).

```bash
python3 - <<'PY'
import re, colorsys
for f in ['shared/web/styles.ts','shared/authored/page-css.ts','apps/mcp/widget/widget.css']:
    print('==', f)
    for m in re.finditer(r'(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})', open(f).read()):
        v = m.group(2).lstrip('#')
        if len(v) == 3: v = ''.join(c*2 for c in v)
        r,g,b = [int(v[i:i+2],16)/255 for i in (0,2,4)]
        h,l,s = colorsys.rgb_to_hls(r,g,b)
        print(f'  {m.group(1):16} #{v}  H{h*360:6.1f} S{s*100:5.1f}% L{l*100:5.1f}%')
PY
```

Tokeny zapisane jako `hsl(...)` (`--navy`, `--dark`) regexp pomija — czyta się je wprost.

## 2. Obrazy → histogram odcieni i udział ciepła

Wrażenie kolorystyczne strony buduje treść. Mierz piksele, nie nazwy plików.

```bash
python3 - <<'PY'
import glob, colorsys
from PIL import Image
for f in sorted(glob.glob('public/media/site/*.webp')):
    px = list(Image.open(f).convert('RGB').resize((160,160)).getdata())
    warm, bins = 0, {}
    for r,g,b in px:
        h,l,s = colorsys.rgb_to_hls(r/255,g/255,b/255)
        if s < 0.12: continue            # szarości nie niosą odcienia
        d = int(h*360); bins[d//30*30] = bins.get(d//30*30,0)+1
        if d < 70 or d > 330: warm += 1
    print(f, 'ciepłe%', round(100*warm/len(px),1),
          'top', sorted(bins.items(), key=lambda x:-x[1])[:4])
PY
```

Zdjęcia terapeutek leżą w R2, nie w repo — pobierz je z produkcji
(`https://otwartyterapeuta.pl/media/<key>`) i przepuść przez ten sam kod.

Punkt odniesienia (pomiar 2026-09-22, trzy hero z `public/media/site/`):
ciepłe piksele **19,3-24,0%**, dominujący kosz odcieni **180°** we wszystkich
trzech, drugi najczęstszy 150° albo 30°.

## 3. Sprawdzenie osi

Oś odcieni serwisu z pomiaru 2026-09-22, nie z pamięci — nowa wartość musi na niej
leżeć, zanim ją wdrożysz:

- tła i obramowania w `styles.ts` i `page-css.ts`: **66-78°**. `--surface-alt`/`--soft`
  66,0°, `--bg` 68,6°, `--border`/`--line` 73,8°, `--border-strong` 78,3°. Tu trzymaj
  każdy nowy odcień powierzchni; `#e9efe0` (84°) cofaliśmy trzy razy;
- neutralne tekstowe wyżej, **82-88°**: `--text`/`--ink` 87,9°, `--text-muted` 82,5°;
- akcenty leżą **poza** osią i tak ma być: `--accent` 97,7°, `--accent-strong`/`--green`
  100,0°, `--focus`/`--amber` 40,2° (ciepły bursztyn kontrastu);
- tokeny prawie białe i prawie czarne (`--surface-solid`/`--paper` #fffefa) nie niosą
  odcienia — nie licz ich do osi, choć skrypt wypisze im jakieś H;
- `widget.css` to **inna paleta**, nie oś serwisu: `--accent` 176,9° (teal),
  neutralne 24-45°, plus osobny zestaw dla `prefers-color-scheme: dark`.
  Nie równaj go do 56-95 i nie „poprawiaj" na zielono — działa w interfejsie ChatGPT.

## 4. Odpowiedź

Jedna przyczyna poparta pomiarem, nie lista trzech domysłów. W odpowiedzi podaj
konkretne H/S/L i procenty, na których stoi wniosek.
