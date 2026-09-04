/**
 * Progressive enhancement for the admin panel.
 *
 * The site CSP is `script-src 'self'` with no inline scripts, so this is
 * served as a real file from `/assets/admin.js` and `/assets/admin.css`.
 *
 * Everything here is an enhancement: with JavaScript disabled the panel still
 * works. Tabs degrade to stacked sections, the bio editor degrades to the
 * plain textarea that holds the stored value, the photo cropper degrades to
 * the URL field next to it, and credential rows degrade to the fixed number
 * of rows the server rendered.
 */

export const ADMIN_JS = String.raw`(function () {
  'use strict';


  // ------------------------------------------------------- profile composer ---
  // Reordering by dragging. The position inputs stay the source of truth and are
  // renumbered after every drop, so the form posts the same thing either way and
  // the no-JS path keeps working untouched.
  // ------------------------------------------------------------------ tabs ---

  /* Edytor stron w oknie dialogowym: iframe wstawiany przy pierwszym otwarciu,
     żeby zamknięty panel nie ładował cudzej strony. */
  function initEditorDialog(box) {
    var dialog = document.querySelector('[data-editor-dialog]');
    var open = box.querySelector('[data-editor-open]');
    var url = box.getAttribute('data-page-editor');
    if (!dialog || !open || !url || typeof dialog.showModal !== 'function') return;
    open.addEventListener('click', function () {
      if (!dialog.querySelector('iframe')) {
        var frame = document.createElement('iframe');
        frame.src = url;
        frame.title = 'Edytor strony';
        dialog.appendChild(frame);
      }
      dialog.showModal();
    });
    var close = dialog.querySelector('[data-editor-close]');
    if (close) close.addEventListener('click', function () { dialog.close(); });
    /* Esc naciśnięty w ramce: klawisz trafia do jej dokumentu, więc edytor
       melduje go wiadomością. Tylko z origin usługi, tylko przy otwartym oknie. */
    var origin = new URL(url, location.href).origin;
    window.addEventListener('message', function (event) {
      if (event.origin !== origin || !event.data) return;
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

  // -------------------------------------------------------------- bio editor ---
  // Storage format stays plain text so the MCP tools and the widget keep
  // reading exactly what they read before: blank line = paragraph,
  // **text** = bold, \* = a literal asterisk.

  var BLOCK = /^(P|DIV|LI|BR|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|PRE|TR|SECTION|ARTICLE)$/;

  function escapeHtml(value) {
    return value.replace(/[&<>]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
    });
  }

  function inlineToHtml(source) {
    var out = '';
    var bold = false;
    var i = 0;
    while (i < source.length) {
      if (source[i] === '\\' && source[i + 1] === '*') { out += '*'; i += 2; continue; }
      if (source[i] === '*' && source[i + 1] === '*') {
        out += bold ? '</strong>' : '<strong>';
        bold = !bold;
        i += 2;
        continue;
      }
      out += escapeHtml(source[i]);
      i += 1;
    }
    return bold ? out + '</strong>' : out;
  }

  function markdownToHtml(value) {
    var blocks = String(value || '').split(/\n{2,}/);
    var html = '';
    for (var i = 0; i < blocks.length; i++) {
      var line = blocks[i].replace(/\n/g, ' ').trim();
      if (line) html += '<p>' + inlineToHtml(line) + '</p>';
    }
    return html || '<p><br></p>';
  }

  function looksBold(node) {
    var name = node.nodeName;
    if (name === 'B' || name === 'STRONG') return true;
    return !!node.style && node.style.fontWeight === 'bold';
  }

  /** Reads only structure and bold. Any other markup the browser produced is dropped. */
  function serialize(root) {
    var paragraphs = [];
    var buffer = '';
    var boldOpen = false;

    function closeBold() {
      if (boldOpen) { buffer += '**'; boldOpen = false; }
    }
    function endParagraph() {
      closeBold();
      var text = buffer.replace(/[ \t\u00a0]+/g, ' ').trim();
      if (text) paragraphs.push(text);
      buffer = '';
    }
    function walk(node, bold) {
      var children = node.childNodes;
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (child.nodeType === 3) {
          var data = child.data;
          if (!data) continue;
          if (bold) {
            if (!boldOpen && data.trim()) { buffer += '**'; boldOpen = true; }
          } else {
            closeBold();
          }
          buffer += data.replace(/\*/g, '\\*');
          continue;
        }
        if (child.nodeType !== 1) continue;
        if (child.nodeName === 'BR') { endParagraph(); continue; }
        var blockish = BLOCK.test(child.nodeName);
        if (blockish && buffer.trim()) endParagraph();
        walk(child, bold || looksBold(child));
        if (blockish) endParagraph();
      }
    }

    walk(root, false);
    endParagraph();
    return paragraphs.join('\n\n');
  }

  function initEditor(wrap) {
    var field = wrap.querySelector('[data-editor-value]');
    if (!field) return;
    var limit = Number(field.getAttribute('maxlength')) || 4000;

    var surface = document.createElement('div');
    surface.className = 'editor-surface';
    surface.contentEditable = 'true';
    surface.setAttribute('role', 'textbox');
    surface.setAttribute('aria-multiline', 'true');
    surface.setAttribute('aria-labelledby', wrap.getAttribute('data-editor-label') || '');
    surface.innerHTML = markdownToHtml(field.value);

    var bar = document.createElement('div');
    bar.className = 'editor-bar';
    var boldButton = document.createElement('button');
    boldButton.type = 'button';
    boldButton.className = 'editor-btn';
    boldButton.textContent = 'Pogrub';
    boldButton.title = 'Pogrubienie (Ctrl+B)';
    boldButton.setAttribute('aria-pressed', 'false');
    bar.appendChild(boldButton);

    var counter = document.createElement('span');
    counter.className = 'editor-count';
    bar.appendChild(counter);

    field.classList.add('visually-hidden');
    field.setAttribute('tabindex', '-1');
    field.setAttribute('aria-hidden', 'true');
    // Right after the textarea, so the hint below the field stays below.
    field.insertAdjacentElement('afterend', surface);
    field.insertAdjacentElement('afterend', bar);
    wrap.classList.add('editor-ready');

    function sync() {
      var value = serialize(surface);
      field.value = value.slice(0, limit);
      counter.textContent = value.length + ' / ' + limit;
      counter.classList.toggle('over', value.length > limit);
    }

    function refreshBoldState() {
      var on = false;
      try { on = document.queryCommandState('bold'); } catch (e) { on = false; }
      boldButton.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    boldButton.addEventListener('mousedown', function (event) { event.preventDefault(); });
    boldButton.addEventListener('click', function () {
      surface.focus();
      document.execCommand('bold');
      sync();
      refreshBoldState();
    });

    surface.addEventListener('input', sync);
    surface.addEventListener('keyup', refreshBoldState);
    surface.addEventListener('mouseup', refreshBoldState);
    surface.addEventListener('blur', sync);

    // Pasted rich text is the usual way junk markup gets in. Take the text only.
    surface.addEventListener('paste', function (event) {
      event.preventDefault();
      var text = (event.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    var form = wrap.closest('form');
    if (form) form.addEventListener('submit', sync);
    sync();
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

  // ------------------------------------------------------------ photo crop ---

  var CROP_VIEW = 320;
  // Master kept generously large: the original never reaches the server, so a
  // rendition that was not produced here can never be produced at all.
  var CROP_OUTPUT = 768;
  // Catalogue card renders at 72 CSS px, so 160 covers a 2x display.
  var CROP_THUMB = 160;

  function initCrop(wrap) {
    var fileInput = wrap.querySelector('[data-crop-file]');
    var pickButton = wrap.querySelector('[data-crop-pick]');
    var dialog = wrap.querySelector('dialog');
    var canvas = wrap.querySelector('[data-crop-canvas]');
    var zoom = wrap.querySelector('[data-crop-zoom]');
    var saveButton = wrap.querySelector('[data-crop-save]');
    var cancelButton = wrap.querySelector('[data-crop-cancel]');
    var status = wrap.querySelector('[data-crop-status]');
    var preview = wrap.querySelector('[data-crop-preview]');
    var urlField = document.getElementById(wrap.getAttribute('data-crop-field') || '');
    if (!fileInput || !pickButton || !dialog || !canvas || !urlField) return;
    if (typeof dialog.showModal !== 'function') return;

    wrap.classList.add('crop-ready');
    var context = canvas.getContext('2d');
    var image = null;
    var minScale = 1;
    var scale = 1;
    var offsetX = 0;
    var offsetY = 0;

    function clamp() {
      var width = image.width * scale;
      var height = image.height * scale;
      offsetX = Math.min(0, Math.max(CROP_VIEW - width, offsetX));
      offsetY = Math.min(0, Math.max(CROP_VIEW - height, offsetY));
    }

    function draw() {
      if (!image) return;
      clamp();
      context.clearRect(0, 0, CROP_VIEW, CROP_VIEW);
      context.drawImage(image, offsetX, offsetY, image.width * scale, image.height * scale);
    }

    // Zooming keeps the centre of the frame put.
    function setScale(next) {
      var previous = scale;
      var centre = CROP_VIEW / 2;
      scale = Math.max(minScale, Math.min(minScale * 4, next));
      offsetX = centre - ((centre - offsetX) / previous) * scale;
      offsetY = centre - ((centre - offsetY) / previous) * scale;
      draw();
    }

    pickButton.addEventListener('click', function () { fileInput.click(); });

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (file.size > 12 * 1024 * 1024) {
        status.textContent = 'Plik jest za duży (limit 12 MB przed kadrowaniem).';
        dialog.showModal();
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var loaded = new Image();
        loaded.onload = function () {
          image = loaded;
          minScale = CROP_VIEW / Math.min(loaded.width, loaded.height);
          scale = minScale;
          offsetX = (CROP_VIEW - loaded.width * scale) / 2;
          offsetY = (CROP_VIEW - loaded.height * scale) / 2;
          zoom.value = '1';
          status.textContent = '';
          saveButton.disabled = false;
          dialog.showModal();
          draw();
        };
        loaded.onerror = function () {
          status.textContent = 'Nie udało się odczytać obrazu.';
          saveButton.disabled = true;
          dialog.showModal();
        };
        loaded.src = reader.result;
      };
      reader.readAsDataURL(file);
      fileInput.value = '';
    });

    zoom.addEventListener('input', function () {
      if (!image) return;
      setScale(minScale * Number(zoom.value));
    });

    var dragging = false;
    var lastX = 0;
    var lastY = 0;

    canvas.addEventListener('pointerdown', function (event) {
      if (!image) return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      offsetX += event.clientX - lastX;
      offsetY += event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      draw();
    });
    function stopDrag() { dragging = false; }
    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);

    canvas.addEventListener('keydown', function (event) {
      if (!image) return;
      var step = event.shiftKey ? 20 : 5;
      var handled = true;
      if (event.key === 'ArrowLeft') offsetX -= step;
      else if (event.key === 'ArrowRight') offsetX += step;
      else if (event.key === 'ArrowUp') offsetY -= step;
      else if (event.key === 'ArrowDown') offsetY += step;
      else handled = false;
      if (!handled) return;
      event.preventDefault();
      draw();
    });

    cancelButton.addEventListener('click', function () { dialog.close(); });

    saveButton.addEventListener('click', function () {
      if (!image) return;
      saveButton.disabled = true;
      status.textContent = 'Wysyłanie…';

      // Side of the crop measured in the SOURCE image's own pixels. Rendering
      // larger than this would invent detail, so it caps the output instead.
      var available = Math.round(CROP_VIEW / scale);

      function render(target) {
        var side = Math.max(1, Math.min(target, available));
        var canvasOut = document.createElement('canvas');
        canvasOut.width = side;
        canvasOut.height = side;
        var ratio = side / CROP_VIEW;
        var ctx = canvasOut.getContext('2d');
        // Without this the browser does a single bilinear pass, which aliases
        // badly once the source is more than about twice the target.
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
          image,
          offsetX * ratio,
          offsetY * ratio,
          image.width * scale * ratio,
          image.height * scale * ratio,
        );
        return new Promise(function (resolve) {
          canvasOut.toBlob(resolve, 'image/webp', 0.85);
        });
      }

      Promise.all([render(CROP_OUTPUT), render(CROP_THUMB)]).then(function (blobs) {
          var blob = blobs[0];
          var thumb = blobs[1];
          if (!blob) {
            status.textContent = 'Nie udało się przygotować pliku.';
            saveButton.disabled = false;
            return;
          }
          var extension = blob.type === 'image/webp' ? 'webp' : 'png';
          var data = new FormData();
          data.append('csrf', wrap.getAttribute('data-crop-csrf') || '');
          data.append('photo', blob, 'profil.' + extension);
          if (thumb) data.append('photo_thumb', thumb, 'profil-160.' + extension);
          fetch(wrap.getAttribute('data-crop-action'), {
            method: 'POST',
            body: data,
            credentials: 'same-origin',
          })
            .then(function (response) {
              return response.json().then(function (payload) {
                return { ok: response.ok, payload: payload };
              });
            })
            .then(function (result) {
              if (!result.ok) throw new Error(result.payload.error || 'Wysyłka nie powiodła się.');
              urlField.value = result.payload.url;
              if (preview) {
                preview.src = result.payload.url;
                preview.hidden = false;
              }
              status.textContent = '';
              dialog.close();
            })
            .catch(function (error) {
              status.textContent = error.message;
            })
            .then(function () {
              saveButton.disabled = false;
            });
      });
    });
  }

  // ------------------------------------------------------------------ boot ---

  function boot() {
    document.querySelectorAll('[data-tabs]').forEach(initTabs);
    document.querySelectorAll('[data-page-editor]').forEach(initEditorDialog);
    document.querySelectorAll('[data-editor]').forEach(initEditor);
    document.querySelectorAll('[data-repeat]').forEach(initRepeat);
    document.querySelectorAll('[data-crop]').forEach(initCrop);
  }

  // Formularze z data-confirm pytają zanim wyślą — usuwanie grafik jest nieodwracalne.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (form instanceof HTMLFormElement && form.dataset.confirm && !window.confirm(form.dataset.confirm)) {
      event.preventDefault();
    }
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
`;

export const ADMIN_CSS = String.raw`
/* Admin panel only. Loaded on top of app.css, never on public pages. */

/* Panel czyta się jak aplikacja, nie jak artykuł: zakładki stoją z boku,
   treść bierze resztę okna. Kolumna 76 rem zostaje stronom publicznym. */
main > .wrap:has(.tabs) { max-width: none; }
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
  max-width: 56rem; padding: clamp(1.2rem, 3vw, 2rem); margin-block: 1.3rem 2rem;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface);
  box-shadow: var(--shadow-sm);
}

/* Two chip groups share one look: the segmented status radios, and the hour
   picker. The input itself is off-screen; its label is the visible control. */
.seg-label {
  display: block; color: var(--text); font-size: 0.875rem; font-weight: 620; margin-bottom: var(--space-2);
}
.seg { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.hour-grid {
  display: grid; gap: 0.4rem;
  grid-template-columns: repeat(auto-fill, minmax(4.5rem, 1fr));
}
.seg input, .hour-grid input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.seg label, .hour-grid label {
  margin: 0; cursor: pointer; font-weight: 600; font-size: 0.9375rem;
  min-height: 2.5rem; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border-strong); background: var(--surface-solid); color: var(--text-muted);
}
.seg label { padding: 0.55rem 1.1rem; border-radius: 999px; }
.hour-grid label {
  padding: 0.5rem 0.4rem; border-radius: var(--radius-sm); font-variant-numeric: tabular-nums;
}
.seg label:hover, .hour-grid label:hover { border-color: var(--accent); color: var(--text); }
.seg input:checked + label, .hour-grid input:checked + label {
  background: var(--accent-strong); border-color: var(--accent-strong); color: #fff;
}
.seg input:focus-visible + label, .hour-grid input:focus-visible + label {
  outline: 2px solid var(--accent-strong); outline-offset: 2px;
}

/* Checkbox grids replacing the hand-typed JSON and comma-separated slugs. */
.choice-grid {
  display: grid; gap: 0.35rem 1rem; margin: 0;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
}
.choice-grid .checkbox { margin: 0; }

/* Bio editor */
.editor-bar { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.4rem; }
.editor-btn {
  font: inherit; font-weight: 700; cursor: pointer; min-height: 2.25rem; padding: 0.35rem 0.9rem;
  border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
  background: var(--surface-solid); color: var(--text);
}
.editor-btn:hover { border-color: var(--accent); background: var(--accent-soft); }
.editor-btn[aria-pressed="true"] { background: var(--accent-strong); border-color: var(--accent-strong); color: #fff; }
.editor-count { margin-left: auto; font-size: 0.8125rem; color: var(--text-muted); }
.editor-count.over { color: var(--danger); font-weight: 700; }
.editor-surface {
  min-height: 11rem; padding: 0.75rem 0.9rem; overflow-y: auto; max-height: 26rem;
  border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
  background: var(--surface-solid); color: var(--text); font: inherit; line-height: 1.65;
}
.editor-surface:focus { border-color: var(--accent); outline: 0; box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent); }
.editor-surface p { margin: 0 0 0.75rem; }
.editor-surface p:last-child { margin-bottom: 0; }

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

/* Photo picker + crop dialog */
.photo-row { display: flex; gap: 1.1rem; align-items: flex-start; flex-wrap: wrap; }
/* Grafiki profilu: miniatury z akcjami, portret oznaczony. */
.media-gallery ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 1rem; }
.media-gallery li { margin: 0; display: flex; flex-direction: column; gap: 0.4rem; align-items: stretch;
  width: 8.5rem; }
.media-gallery img { width: 8.5rem; height: 8.5rem; object-fit: cover; border-radius: 10px;
  border: 1px solid var(--border, #d9d4cc); }
.media-gallery .is-portrait img { outline: 3px solid var(--accent-strong, #4d6100); outline-offset: 2px; }
.media-gallery .media-tag { font-size: 0.75rem; font-weight: 650; text-transform: uppercase;
  letter-spacing: 0.06em; text-align: center; }
.media-gallery form { margin: 0; display: contents; }
.media-gallery .btn { font-size: 0.75rem; padding: 0.3rem 0.5rem; min-height: 0; }
.photo-preview {
  width: 7rem; height: 7rem; border-radius: 50%; object-fit: cover;
  border: 1px solid var(--border-strong); background: var(--surface-alt);
}
.photo-actions { flex: 1 1 16rem; min-width: 14rem; }
[data-crop]:not(.crop-ready) [data-crop-pick] { display: none; }
.crop-dialog {
  border: 1px solid var(--border-strong); border-radius: var(--radius);
  padding: 1.4rem; background: var(--surface-solid); color: var(--text); max-width: min(92vw, 26rem);
}
.crop-dialog::backdrop { background: rgba(24, 28, 12, 0.55); }
.crop-dialog h2 { margin-top: 0; font-size: 1.15rem; }
.crop-canvas {
  display: block; width: 320px; max-width: 100%; height: 320px; touch-action: none; cursor: grab;
  border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface-alt);
}
.crop-canvas:active { cursor: grabbing; }
.crop-canvas:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
.crop-actions { display: flex; gap: 0.6rem; justify-content: flex-end; margin-top: 1rem; }
.crop-status { min-height: 1.25rem; margin: 0.5rem 0 0; font-size: 0.9375rem; color: var(--danger); }

/* Edytor stron w modalu: ramka w kolumnie panelu była za wąska, a nowa karta
   na każde kliknięcie mnożyła karty. Okno dialogowe daje prawie całe okno. */
.editor-dialog { width: 96vw; max-width: none; height: 94dvh; padding: 0; border: 0; border-radius: 14px;
  background: var(--surface-solid, #fff); overflow: hidden; }
.editor-dialog::backdrop { background: rgba(24, 28, 12, 0.55); }
.editor-dialog iframe { display: block; width: 100%; height: 100%; border: 0; }
.editor-close { position: absolute; top: 0.6rem; right: 0.9rem; z-index: 2; }
.notice { padding: 0.8rem 1rem; border-radius: 10px; background: var(--surface-alt, #f7f8f2); border: 1px solid var(--border, #e3e6d8); }
/* --- profile composer (legacy layout, kept for the photo cropper) ---- */
.composer .hint { max-width: 62ch; }
.composer-split { display: grid; grid-template-columns: minmax(18rem, 27rem) minmax(0, 1fr);
  gap: 1.5rem; align-items: start; }
.composer-preview { position: sticky; top: 1rem; }
.composer-preview .hint { margin: 0 0 0.5rem; }
.composer-preview iframe { width: 100%; height: min(78vh, 900px); border: 1px solid var(--border, #e3e6d8);
  border-radius: 12px; background: #fff; }
@media (max-width: 68rem) {
  .composer-split { grid-template-columns: 1fr; }
  .composer-preview { position: static; }
  .composer-preview iframe { height: 60vh; }
}
.sec-save { margin: 0.9rem 0 0; }

.sec-hero { display: grid; gap: 0.5rem; margin-top: 1rem; padding: 0.9rem;
  border: 1px solid var(--border, #e3e6d8); border-radius: 12px; background: #fbfcf7; }
.sec-hero span { display: block; color: var(--text-muted, #6a7360); font-size: 0.86rem; }
.sec-hero select { max-width: 32rem; }
.sec-item.dragging { opacity: 0.45; }
.sec-item.over { border-color: var(--accent-strong, #637200); }
/* With drag available the numbers are redundant, so JS hides them. */
`;
