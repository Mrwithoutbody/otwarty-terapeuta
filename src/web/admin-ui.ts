/**
 * Progressive enhancement for the admin panel.
 *
 * The site CSP is `script-src 'self'` with no inline scripts, so this is
 * served as a real file from `/assets/admin.js` and `/assets/admin.css`.
 *
 * Everything here is an enhancement: with JavaScript disabled the panel still
 * works. Tabs degrade to stacked sections and credential rows degrade to the
 * fixed number of rows the server rendered. The page editor needs JavaScript
 * anyway: it is the service's own application, framed in a dialog.
 */

import { SCHEDULE_HOURS } from '../db/slots';

export const ADMIN_JS = String.raw`(function () {
  'use strict';


  // Reordering by dragging. The position inputs stay the source of truth and are
  // renumbered after every drop, so the form posts the same thing either way and
  // the no-JS path keeps working untouched.
  // ------------------------------------------------------------------ tabs ---

  /* Edytor stron w oknie dialogowym: jedno okno, ramka ładowana przy otwarciu
     z adresem klikniętej strony (własna trasa, która przekierowuje do usługi). */
  function initEditorDialog(dialog) {
    if (typeof dialog.showModal !== 'function') return;
    var origin = dialog.getAttribute('data-editor-origin') || '';
    function open(url) {
      var frame = dialog.querySelector('iframe');
      if (!frame) {
        frame = document.createElement('iframe');
        frame.title = 'Edytor strony';
        dialog.appendChild(frame);
      }
      if (frame.getAttribute('src') !== url) frame.src = url;
      dialog.showModal();
    }
    document.querySelectorAll('[data-editor-open][data-page-editor]').forEach(function (button) {
      button.addEventListener('click', function () { open(button.getAttribute('data-page-editor')); });
    });
    /* Wejście z logowania: edytor jej profilu od razu. Adres traci "?edytor",
       żeby odświeżenie strony nie otwierało go drugi raz. */
    var auto = dialog.getAttribute('data-editor-autoopen');
    if (auto) {
      open(auto);
      history.replaceState(null, '', location.pathname + location.hash);
    }
    var close = dialog.querySelector('[data-editor-close]');
    if (close) close.addEventListener('click', function () { dialog.close(); });
    /* Esc naciśnięty w ramce: klawisz trafia do jej dokumentu, więc edytor
       melduje go wiadomością. Tylko z origin usługi, tylko przy otwartym oknie. */
    window.addEventListener('message', function (event) {
      if (!origin || event.origin !== origin || !event.data) return;
      if (event.data.kind === 'close-editor') dialog.close();
      /* Odnośnik "edytuj dane" z wnętrza edytora: zamykamy okno i przełączamy
         zakładkę u siebie. Nowa karta z ramki cudzego originu i tak by się
         mnożyła, bo nazwany cel nie przechodzi przez tę granicę. */
      if (event.data.kind === 'goto-panel') {
        dialog.close();
        /* "sekcja" albo "sekcja:pole": otwieramy zakładkę, a jeśli host wskazał
           pole, przewijamy do niego i stawiamy w nim kursor. */
        var parts = String(event.data.anchor || '').split(':');
        var tab = document.getElementById(parts[0] + '-tab');
        if (tab) tab.click();
        var field = parts[1] ? document.getElementById(parts[1]) : null;
        if (field) {
          field.scrollIntoView({ block: 'center', behavior: 'smooth' });
          field.focus({ preventScroll: true });
        }
      }
    });
  }

  function initTabs(root) {
    var panels = Array.prototype.slice.call(root.querySelectorAll('[data-tab-panel]'));
    if (panels.length < 2) return;

    var list = document.createElement('div');
    list.className = 'tablist';
    list.setAttribute('role', 'tablist');
    root.insertBefore(list, panels[0]);

    var tabs = panels.map(function (panel, index) {
      var id = panel.id;
      var tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tab';
      tab.id = id + '-tab';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', id);
      tab.textContent = panel.getAttribute('data-tab-label') || 'Sekcja ' + (index + 1);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panel.setAttribute('tabindex', '0');
      list.appendChild(tab);
      tab.addEventListener('click', function () { select(index); });
      return tab;
    });

    function select(index, focus) {
      tabs.forEach(function (tab, i) {
        var on = i === index;
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
        panels[i].hidden = !on;
      });
      if (focus) tabs[index].focus();
      try { sessionStorage.setItem(storageKey, String(index)); } catch (e) { /* private mode */ }
    }

    list.addEventListener('keydown', function (event) {
      var current = tabs.indexOf(document.activeElement);
      if (current < 0) return;
      var next = null;
      if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      select(next, true);
    });

    var storageKey = 'ot-admin-tab:' + (root.getAttribute('data-tabs') || 'default');
    var start = 0;
    try {
      var saved = Number(sessionStorage.getItem(storageKey));
      if (Number.isInteger(saved) && saved >= 0 && saved < tabs.length) start = saved;
    } catch (e) { /* private mode */ }
    // A redirect back to one section (#panel-strony) beats the remembered tab.
    for (var h = 0; h < panels.length; h++) if ('#' + panels[h].id === location.hash) start = h;
    select(start);

    // A validation error inside a hidden panel is invisible and the submit
    // silently does nothing. Reveal the offending panel instead.
    root.addEventListener(
      'invalid',
      function (event) {
        for (var i = 0; i < panels.length; i++) {
          if (panels[i].contains(event.target)) { select(i); break; }
        }
      },
      true,
    );
  }

  // ------------------------------------------------------- repeatable rows ---

  var MAX_REPEAT_ROWS = 20;

  function initRepeat(wrap) {
    var body = wrap.querySelector('[data-repeat-body]');
    var template = wrap.querySelector('template');
    var addButton = wrap.querySelector('[data-repeat-add]');
    if (!body || !template || !addButton) return;

    function reindex() {
      var rows = body.querySelectorAll('[data-repeat-row]');
      for (var i = 0; i < rows.length; i++) {
        var fields = rows[i].querySelectorAll('[data-name]');
        for (var j = 0; j < fields.length; j++) {
          var base = fields[j].getAttribute('data-name');
          fields[j].name = base + '_' + i;
          fields[j].id = base + '_' + i;
          var label = rows[i].querySelector('[data-label-for="' + base + '"]');
          if (label) label.setAttribute('for', fields[j].id);
        }
      }
      addButton.disabled = rows.length >= MAX_REPEAT_ROWS;
    }

    addButton.addEventListener('click', function () {
      if (body.querySelectorAll('[data-repeat-row]').length >= MAX_REPEAT_ROWS) return;
      body.appendChild(template.content.cloneNode(true));
      reindex();
      var rows = body.querySelectorAll('[data-repeat-row]');
      var first = rows[rows.length - 1].querySelector('input, select, textarea');
      if (first) first.focus();
    });

    body.addEventListener('click', function (event) {
      var button = event.target.closest('[data-repeat-remove]');
      if (!button) return;
      var row = button.closest('[data-repeat-row]');
      if (row) row.remove();
      reindex();
    });

    reindex();
  }

  // ------------------------------------------------------------------ boot ---

  /* Grafik: jedna kratka dla wszystkich ofert, jak jeden kalendarz. Wybrana
     oferta to pędzel: klik maluje kratkę jej kolorem, klik w kratkę tej samej
     oferty ją czyści, przeciągnięcie myszą maluje kolejne - bez tego tydzień
     pn-pt 9-17 to czterdzieści pięć kliknięć. Pod spodem zostają zwykłe pola
     (po jednym na ofertę w kratce), więc formularz wysyła to samo co bez skryptu.
     Przeciąganie tylko myszą: na dotyku ten sam gest przewija stronę. */
  var painting = null;
  function cellOf(target) {
    return target instanceof Element ? target.closest('[data-cell]') : null;
  }
  function ownerOf(cell) {
    var box = cell.querySelector('input[data-o]:checked');
    return box ? box.getAttribute('data-o') : 'none';
  }
  function brushOf() {
    var brush = document.querySelector('[data-brush] input:checked');
    return brush ? brush.value : '0';
  }
  /* Co pędzel zrobi z kratką: kłódka przełącza blokadę terminu (tylko tam, gdzie
     termin jest), oferta i gumka zmieniają grafik. Przeciągnięcie niesie to dalej. */
  function nextOf(cell) {
    var brush = brushOf();
    if (brush === 'lock') {
      var lock = cell.querySelector('input[data-lock]');
      return { lock: lock ? !lock.checked : true };
    }
    return { offer: brush === 'erase' || ownerOf(cell) === brush ? 'none' : brush };
  }
  function paint(cell, stroke) {
    var lock = cell.querySelector('input[data-lock]');
    if ('lock' in stroke) {
      if (!lock) return;
      lock.checked = stroke.lock;
    } else {
      var boxes = cell.querySelectorAll('input[data-o]');
      for (var i = 0; i < boxes.length; i++) boxes[i].checked = boxes[i].getAttribute('data-o') === stroke.offer;
    }
    render(cell);
  }
  function render(cell) {
    var face = cell.querySelector('.face');
    if (!face) return;
    var owner = ownerOf(cell);
    var lock = cell.querySelector('input[data-lock]');
    if (owner === 'none') face.removeAttribute('data-c');
    else face.setAttribute('data-c', String(Number(owner) % 4));
    var locked = !cell.hasAttribute('data-booked') && !!lock && lock.checked;
    face.classList.toggle('is-locked', locked);
    face.textContent = cell.hasAttribute('data-booked') ? '•'
      : locked ? ''
      : owner !== 'none' && cell.querySelectorAll('input[data-o]').length > 1 ? String(Number(owner) + 1) : '';
  }
  /* Narzędzie przeżywa zmianę tygodnia i zapis (to przeładowania strony). */
  function initBrush(brush) {
    try {
      var saved = sessionStorage.getItem('ot-brush');
      var radio = saved === null ? null : brush.querySelector('input[value="' + saved.replace(/[^a-z0-9]/g, '') + '"]');
      if (radio) radio.checked = true;
      brush.addEventListener('change', function (event) { sessionStorage.setItem('ot-brush', event.target.value); });
    } catch (e) { /* bez pamięci sesji narzędzie po prostu wraca do pierwszego */ }
  }
  function initScheduleGrid(grid) {
    grid.classList.add('is-painting');
    grid.addEventListener('pointerdown', function (event) {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      var cell = cellOf(event.target);
      if (!cell) return;
      event.preventDefault();
      painting = nextOf(cell);
      paint(cell, painting);
    });
    grid.addEventListener('pointerover', function (event) {
      var cell = painting === null ? null : cellOf(event.target);
      if (cell) paint(cell, painting);
    });
    grid.addEventListener('click', function (event) {
      var cell = cellOf(event.target);
      if (!cell || event.target.tagName === 'INPUT') return;
      event.preventDefault();
      /* Mysz już pomalowała w pointerdown; dotyk i klawiatura malują tutaj. */
      if (event.pointerType !== 'mouse') paint(cell, nextOf(cell));
    });
    /* Superklik: nazwa dnia = wiersz, godzina = kolumna, róg = cała siatka. Działa
       wybranym narzędziem jak "zaznacz wszystko" przy zgodach: jeśli wszystko już
       jest zaznaczone, odznacza. Kłódka obejmuje tylko kratki z terminem. */
    grid.addEventListener('click', function (event) {
      var axis = event.target instanceof Element ? event.target.closest('button.axis') : null;
      if (!axis) return;
      var pick = axis.hasAttribute('data-row') ? '[data-r="' + axis.getAttribute('data-row') + '"]'
        : axis.hasAttribute('data-col') ? '[data-h="' + axis.getAttribute('data-col') + '"]' : '';
      var cells = Array.prototype.slice.call(grid.querySelectorAll('[data-cell]' + pick));
      var brush = brushOf();
      var stroke;
      if (brush === 'lock') {
        cells = cells.filter(function (cell) { return cell.querySelector('input[data-lock]'); });
        stroke = { lock: !cells.every(function (cell) { return cell.querySelector('input[data-lock]').checked; }) };
      } else {
        var full = cells.every(function (cell) { return ownerOf(cell) === brush; });
        stroke = { offer: brush === 'erase' || full ? 'none' : brush };
      }
      cells.forEach(function (cell) { paint(cell, stroke); });
    });
    /* Klawiatura: spacja przełącza ukryte pole jak zwykle, kratka idzie za nim. */
    grid.addEventListener('change', function (event) {
      var cell = cellOf(event.target);
      if (!cell) return;
      if (event.target.hasAttribute('data-o') && event.target.checked) paint(cell, { offer: event.target.getAttribute('data-o') });
      else render(cell);
    });
  }
  document.addEventListener('pointerup', function () { painting = null; });

  function boot() {
    document.querySelectorAll('[data-schedule-grid]').forEach(initScheduleGrid);
    document.querySelectorAll('[data-brush]').forEach(initBrush);
    document.querySelectorAll('[data-tabs]').forEach(initTabs);
    document.querySelectorAll('[data-editor-dialog]').forEach(initEditorDialog);
    document.querySelectorAll('[data-repeat]').forEach(initRepeat);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
`;

export const ADMIN_CSS = String.raw`
/* Admin panel only. Loaded on top of app.css, never on public pages. */

/* Panel siedzi w tym samym kontenerze co nagłówek i stopka (76 rem, wyśrodkowany). */
.tabs {
  display: grid; grid-template-columns: 12.5rem minmax(0, 1fr);
  gap: 0 2rem; align-items: start;
}
[data-tab-panel] { grid-column: 2; }
.panel-lead { max-width: 64ch; margin: 0 0 1.4rem; color: var(--text-muted, #6a7360); font-size: 0.95rem; }
.tablist {
  display: flex; flex-direction: column; gap: 0.2rem; margin: 0;
  position: sticky; top: 5.5rem;
  border-right: 1px solid var(--border-strong); padding-right: 0.7rem;
}
.tab {
  font: inherit; font-weight: 600; cursor: pointer; text-align: left;
  min-height: 2.5rem; padding: 0.5rem 0.9rem;
  border: 1px solid transparent; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-muted);
}
@media (max-width: 60rem) {
  .tabs { grid-template-columns: minmax(0, 1fr); }
  [data-tab-panel] { grid-column: 1; }
  .tablist {
    flex-direction: row; flex-wrap: wrap; gap: 0.4rem; margin: 0 0 1.5rem; position: static;
    border-right: 0; border-bottom: 1px solid var(--border-strong); padding: 0 0 0.6rem;
  }
  .tab { border-radius: 999px; }
}
.tab:hover { background: var(--surface-alt); color: var(--text); }
.tab[aria-selected="true"] {
  background: var(--accent-soft); border-color: var(--border-strong); color: var(--accent-strong);
}
[data-tab-panel][hidden] { display: none; }
[data-tab-panel] > h2:first-child { margin-top: 0; }

/* app.css gives forms their card treatment through a direct-child selector on
   .wrap, which a form inside a tab panel no longer matches. Same look, one level down. */
[data-tab-panel] > form {
  padding: clamp(1.2rem, 3vw, 2rem); margin-block: 1.3rem 2rem;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface);
  box-shadow: var(--shadow-sm);
}

/* Segmented status radios. The input itself is off-screen; its label is the visible control. */
.seg-label {
  display: block; color: var(--text); font-size: 0.875rem; font-weight: 620; margin-bottom: var(--space-2);
}
.seg { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.seg input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.seg label {
  margin: 0; cursor: pointer; font-weight: 600; font-size: 0.9375rem;
  min-height: 2.5rem; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border-strong); background: var(--surface-solid); color: var(--text-muted);
}
.seg label { padding: 0.55rem 1.1rem; border-radius: 999px; }
.seg label:hover { border-color: var(--accent); color: var(--text); }
.seg input:checked + label {
  background: var(--accent-strong); border-color: var(--accent-strong); color: #fff;
}
.seg input:focus-visible + label {
  outline: 2px solid var(--accent-strong); outline-offset: 2px;
}

/* Dostępność. Kolory z tokenów serwisu, bez nowych odcieni. */
.week-nav { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1.25rem; margin: 0 0 0.75rem; }
/* Oferty w grafiku i kalendarzu: tokeny z białą cyfrą o kontraście >= 4.5
   (accent-strong 68° 5.3, focus 40° 5.3, text 88° 10.9, text-muted 83° 4.7). */
:root { --offer-0: var(--accent-strong); --offer-1: var(--focus); --offer-2: var(--text); --offer-3: var(--text-muted); }
[data-c="0"] { --c: var(--offer-0); } [data-c="1"] { --c: var(--offer-1); }
[data-c="2"] { --c: var(--offer-2); } [data-c="3"] { --c: var(--offer-3); }
.brush { display: grid; gap: 0.4rem; margin: 0 0 1rem; padding: 0; border: 0; }
.brush-opt {
  display: flex; align-items: center; gap: 0.6rem; margin: 0; cursor: pointer; font-weight: 450;
  padding: 0.45rem 0.7rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-solid);
}
.brush-opt input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.brush-opt:has(input:checked) { border-color: var(--accent-strong); box-shadow: 0 0 0 1px var(--accent-strong); }
.brush-opt:has(input:focus-visible) { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
.swatch {
  flex: none; display: grid; place-items: center; width: 1.6rem; height: 1.6rem; border-radius: 6px;
  color: #fff; font-size: 0.8125rem; font-weight: 700;
}
.swatch.is-erase { border: 1px dashed var(--border-strong); background: var(--surface-solid); color: var(--text); font-size: 0.75rem; }
.swatch[data-c] { background: var(--c); }

/* Siatka tygodnia - grafik i kalendarz. Elementy idą dzień po dniu; wąsko (telefon)
   siatka wypełnia się kolumnami - dni obok siebie, godziny w dół; szeroko wierszami -
   godziny w poziomie, dni w pionie, cały tydzień bez przewijania. Decyduje szerokość
   miejsca, nie ekranu. */
.week-wrap { container-type: inline-size; overflow-x: auto; margin: 0 0 0.5rem; }
.week-grid {
  /* Liczba godzin z tej samej stałej co znacznik - CSP nie wpuszcza atrybutu style. */
  --hours: ${SCHEDULE_HOURS.length};
  display: grid; gap: 3px; align-items: center; justify-content: center;
  grid-auto-flow: column;
  grid-template-rows: auto repeat(var(--hours), 1.9rem);
  grid-template-columns: auto repeat(7, minmax(2.2rem, 2.6rem));
}
@container (min-width: 40rem) {
  .week-grid {
    grid-auto-flow: row; justify-content: stretch;
    grid-template-rows: none; grid-auto-rows: 1.9rem;
    grid-template-columns: auto repeat(var(--hours), minmax(0, 1fr));
  }
  .week-grid .axis.hour { font-size: 0.6875rem; }
}
.week-grid .axis {
  color: var(--text-muted); font-size: 0.75rem; font-weight: 600; text-align: center; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.week-grid .axis.day { padding-inline: 0.2rem 0.5rem; text-align: right; }
button.axis { margin: 0; padding-block: 0.15rem; border: 0; border-radius: 6px; background: none; font-family: inherit; cursor: pointer; }
button.axis:hover { background: var(--accent-soft); color: var(--accent-strong); }
button.axis:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 1px; }
button.axis[data-all] { font-size: 0.625rem; }
.week-grid .cell { display: flex; gap: 1px; height: 100%; margin: 0; }
.week-grid input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.week-grid label, .week-grid .face {
  flex: 1; min-width: 0; margin: 0; padding: 0; cursor: pointer; user-select: none;
  border: 1px solid var(--border-strong); border-radius: 6px; background: var(--surface-solid);
  color: #fff; font: inherit; font-size: 0.75rem; font-weight: 700; line-height: 1.8rem; text-align: center;
}
.week-grid label:hover, .week-grid .face:hover { border-color: var(--accent); }
/* Grafik */
[data-multi] label, .week-grid label.lock { color: var(--text-muted); }
/* Kłódka rysowana maską w kolorze tekstu - emoji wyglądało inaczej w każdym systemie. */
.ico-lock, .face.is-locked::before {
  content: ''; display: inline-block; width: 0.8rem; height: 0.8rem; vertical-align: -0.1rem; background: currentColor;
  -webkit-mask: var(--lock) center / contain no-repeat; mask: var(--lock) center / contain no-repeat;
}
:root { --lock: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1zm2 0h6V7a3 3 0 0 0-6 0v3z'/%3E%3C/svg%3E"); }
.week-grid input[data-lock]:checked + label { background: var(--surface-alt); border-style: dashed; }
.week-grid .face { color: var(--text); }
.week-grid .face[data-c] { color: #fff; }
.week-grid .cell.is-past { opacity: 0.45; }
.week-grid input:checked + label { background: var(--c); border-color: var(--c); color: #fff; }
.week-grid input:focus-visible + label { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
.week-grid .face { display: none; }
.week-grid.is-painting label { display: none; }
.week-grid.is-painting .face { display: block; }
.week-grid .face[data-c] { background: var(--c); border-color: var(--c); }
.week-grid.is-painting .cell:has(input:focus-visible) .face { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
.time-off { list-style: none; padding: 0; margin: 0 0 1.5rem; }
.time-off li { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; align-items: baseline; padding: 0.6rem 0; border-bottom: 1px solid var(--border); }
.notice-inline { color: var(--danger); font-weight: 600; }

/* Repeatable rows (credentials) */
.repeat-row {
  display: grid; gap: 0.5rem 0.75rem; align-items: end; margin-bottom: 0.75rem;
  padding: 0.85rem; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface-alt);
  grid-template-columns: minmax(9rem, 2fr) minmax(9rem, 2fr) 6rem auto auto;
}
.repeat-row .field { margin: 0; }
.repeat-row .checkbox { margin: 0 0 0.6rem; }
.repeat-remove {
  font: inherit; cursor: pointer; min-height: 2.5rem; padding: 0.5rem 0.9rem; margin-bottom: 0.05rem;
  border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
  background: var(--surface-solid); color: var(--danger);
}
.repeat-remove:hover { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, transparent); }
@media (max-width: 720px) {
  .repeat-row { grid-template-columns: 1fr 1fr; }
}

/* Jeden wiersz: tytuł bierze resztę szerokości, motyw i przycisk tyle, ile potrzebują. */
.form-row { display: grid; gap: 0.5rem 0.75rem; align-items: end; grid-template-columns: minmax(0, 1fr) minmax(12rem, auto) auto; }
.form-row .field, .form-row .btn { margin: 0; }
/* Dane i cennik: sekcje faktów, wiersze list (cennik, dyplomy), grupy pól wyboru. */
.form-section { padding: 1.25rem 0; border-top: 1px solid var(--border); }
.form-section h3 { margin: 0 0 0.35rem; font-size: 1.05rem; }
.form-section > .hint { margin: 0 0 0.9rem; }
.list-row { border: 0; padding: 0; margin: 0 0 0.6rem; grid-template-columns: minmax(10rem, 2.4fr) repeat(4, minmax(5.5rem, 1fr)); align-items: end; }
.list-row .field label { font-size: 0.72rem; }
.list-row + .list-row .field label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.checks { border: 0; padding: 0; margin: 0 0 1rem; display: flex; flex-wrap: wrap; gap: 0.4rem 0.5rem; }
.checks legend { padding: 0; margin-bottom: 0.45rem; font-weight: 600; font-size: 0.85rem; }
.checks .hint { flex-basis: 100%; }
.check { display: inline-flex; align-items: center; gap: 0.4rem; min-height: 2.5rem; padding: 0.3rem 0.75rem; border: 1px solid var(--border-strong); border-radius: 999px; background: var(--surface); font-size: 0.85rem; cursor: pointer; }
.check:has(input:checked) { background: var(--accent-soft); border-color: var(--accent-strong); }
.check input { width: auto; margin: 0; }
@media (max-width: 720px) {
  .form-row { grid-template-columns: 1fr; }
  .list-row { grid-template-columns: 1fr 1fr; padding-bottom: 0.75rem; border-bottom: 1px dashed var(--border); }
  .list-row .field:first-of-type { grid-column: 1 / -1; }
  .list-row + .list-row .field label { position: static; width: auto; height: auto; clip-path: none; }
}

.panel-bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin: 0 0 1rem; }
/* Edytor stron w modalu: ramka w kolumnie panelu była za wąska, a nowa karta
   na każde kliknięcie mnożyła karty. Okno dialogowe daje prawie całe okno. */
.editor-dialog { width: 96vw; max-width: none; height: 94dvh; padding: 0; border: 0; border-radius: 14px;
  background: var(--surface-solid, #fff); overflow: hidden; }
.editor-dialog::backdrop { background: rgba(24, 28, 12, 0.55); }
.editor-dialog iframe { display: block; width: 100%; height: 100%; border: 0; }
button.link { background: none; border: 0; padding: 0; font: inherit; font-weight: 600; color: var(--accent-strong); cursor: pointer; text-decoration: underline; }
.editor-close { position: absolute; top: 0.6rem; right: 0.9rem; z-index: 2; }
.notice { padding: 0.8rem 1rem; border-radius: 10px; background: var(--surface-alt, #f7f8f2); border: 1px solid var(--border, #e3e6d8); }
/* With drag available the numbers are redundant, so JS hides them. */
`;
