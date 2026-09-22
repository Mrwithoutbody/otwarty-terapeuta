/**
 * Arkusz narzędzia terapeutki (panel). Strona w podglądzie bierze wygląd z `page-css.ts`,
 * więc to, co ona widzi obok pola, jest tym, co zobaczy pacjent.
 */
export const TOOL_CSS = `
input, textarea, select, button { font: inherit; color: inherit; }
fieldset { min-width: 0; }
input, textarea, select { width: 100%; min-width: 0; padding: 12px 14px; border: 1.5px solid var(--line); border-radius: 10px; background: #fff; }
input:hover, textarea:hover { border-color: var(--muted); }
label { display: block; font-weight: 600; font-size: .95rem; margin-bottom: 14px; }
label input, label select, label textarea { margin-top: 6px; font-weight: 400; display: block; }
label small { display: block; font-weight: 400; color: var(--muted); margin-top: 6px; }

.btn { display: inline-flex; gap: 8px; align-items: center; justify-content: center; min-height: 48px; padding: 10px 20px; border-radius: 999px; border: 1.5px solid var(--green);
  background: var(--green); color: #fff; font-weight: 600; text-decoration: none; cursor: pointer; text-align: center; }
.btn:hover { background: var(--green-d); }
.btn.ghost { background: transparent; color: var(--green); } .btn.ghost:hover { background: var(--soft); }
.btn.danger { color: hsl(8 60% 35%); border-color: hsl(8 40% 60%); }
.btn.small { min-height: 40px; padding: 6px 16px; font-size: .92rem; }
.btn.big { min-height: 56px; font-size: 1.1rem; padding: 12px 28px; }
.row { display: flex; flex-wrap: wrap; gap: 10px; margin: 14px 0 0; } .row.end { justify-content: flex-end; margin-top: 28px; } .row.between { justify-content: space-between; margin-top: 28px; }
.hint, .tip { color: var(--muted); font-size: .95rem; }
.card { background: var(--paper); border: 1px solid var(--line); border-radius: 18px; padding: 20px; margin: 0 0 16px; box-shadow: 0 1px 2px rgb(60 60 20 / .05), 0 8px 24px -12px rgb(60 60 20 / .12); }
.kind { text-transform: uppercase; letter-spacing: .08em; font-size: .75rem; font-weight: 700; color: var(--amber); margin: 0 0 6px; }


/* narzędzie */
.wrap { max-width: 680px; width: 100%; margin: 0 auto; padding: 24px 16px 40px; }
.home h1 { font-size: 2rem; margin-top: 12px; } .lead { font-size: 1.1rem; color: var(--muted); margin-bottom: 24px; } .lead.small { font-size: 1rem; margin-bottom: 20px; } .meta { font-size: .95rem; }
.pages { list-style: none; padding: 0; margin: 0; }
.st { font-weight: 600; } .st.live { color: var(--green); } .st.wait { color: var(--amber); } .st.draft { color: var(--muted); }
.new { background: transparent; border-style: dashed; } .soon { color: var(--muted); font-size: .9rem; margin: 14px 0 0; }

.steps-nav { background: var(--paper); border-bottom: 1px solid var(--line); padding: 14px 16px 0; position: sticky; top: 0; z-index: 5; }
.steps-nav h1 { font-size: 1.15rem; margin: 4px 0 10px; }
.back { font-size: .9rem; text-decoration: none; font-weight: 600; display: inline-block; padding: 4px 0; }
.steps-nav ol { list-style: none; display: flex; gap: 4px; margin: 0; padding: 0; }
.steps-nav li { flex: 1; }
.steps-nav li a { display: block; text-align: center; padding: 10px 2px 12px; text-decoration: none; color: var(--muted); font-weight: 600; font-size: .9rem; border-bottom: 3px solid transparent; }
.steps-nav li a b { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--soft); font-size: .78rem; margin-right: 3px; }
.steps-nav li a[aria-current] { color: var(--ink); border-color: var(--green); } .steps-nav li a[aria-current] b { background: var(--green); color: #fff; }

.linebox textarea { field-sizing: content; resize: none; }
.linebox { background: var(--paper); border: 1px solid var(--line); border-radius: 18px; padding: 16px; }
.sec { margin: 32px 0 4px; }
.qlist { list-style: none; padding: 0; margin: 12px 0 0; display: grid; gap: 10px; }
.qcard { display: block; text-decoration: none; color: inherit; background: var(--paper); border: 1.5px solid var(--line); border-radius: 16px; padding: 14px 16px 14px 46px; position: relative; }
a.qcard:hover { border-color: var(--green); }
.qcard::before { content: ""; position: absolute; left: 14px; top: 17px; width: 20px; height: 20px; border-radius: 50%; border: 2px dashed var(--line); }
.qcard.done::before { content: "✓"; border: 0; background: var(--green); color: #fff; font-size: .8rem; display: grid; place-items: center; }
.qcard.lock { background: var(--soft); border-style: dashed; } .qcard.lock::before { display: none; } .qcard.lock { padding-left: 16px; }
.qq { display: block; font-family: var(--serif); font-size: 1.12rem; font-weight: 600; text-wrap: balance; }
.qprev { display: block; color: var(--muted); font-size: .93rem; margin-top: 4px; } .qcard.done .qprev { color: var(--ink); } .qprev.go { color: var(--green); font-weight: 600; }
.qcard.flag { border-color: var(--amber); } .qcard.flag::before { content: "!"; background: var(--amber); font-weight: 700; }
.flagchip { display: inline-block; margin-top: 8px; font-size: .8rem; font-weight: 700; color: hsl(36 78% 24%); background: var(--amber-bg); border-radius: 999px; padding: 2px 10px; }
.src a { font-weight: 600; white-space: nowrap; }
.more { margin-top: 10px; } .more summary { cursor: pointer; font-weight: 600; color: var(--green); padding: 12px 16px; border: 1.5px dashed var(--line); border-radius: 16px; min-height: 48px; } .more summary:hover { border-color: var(--green); } .more[open] summary { margin-bottom: 0; border-color: transparent; padding-left: 0; }
.src { display: block; font-size: .8rem; color: var(--muted); margin-top: 6px; }
.ownq { margin-top: 18px; padding: 16px; border: 1.5px dashed var(--line); border-radius: 16px; }
.evform { margin-top: 16px; scroll-margin-top: 130px; } .grid2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 12px; }
.dategrid { border: 0; padding: 0; margin: 0; display: grid; grid-template-columns: minmax(0, 4fr) minmax(0, 7fr) minmax(0, 5fr); gap: 0 8px; } .dategrid legend { font-weight: 600; font-size: .95rem; padding: 0; margin-bottom: 0; }
.dategrid select { padding-left: 10px; padding-right: 4px; }
.formstate { margin: 4px 0 0; font-size: .92rem; font-weight: 600; color: var(--amber); } .formstate .ok { color: var(--green); }
.photocard { display: flex; gap: 16px; align-items: center; } .photocard img, .nophoto { flex: none; width: 88px; height: 110px; border-radius: 14px; object-fit: cover; }
.nophoto { border: 2px dashed var(--line); background: var(--soft) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 88 110'%3E%3Ccircle cx='44' cy='44' r='16' fill='%23b9bda8'/%3E%3Cpath d='M14 110c0-24 13-36 30-36s30 12 30 36z' fill='%23b9bda8'/%3E%3C/svg%3E") center / cover; }
.photocard h2 { font-size: 1.1rem; margin-bottom: 4px; } .photocard .hint { margin-bottom: 0; font-size: .9rem; } .photocard .row { margin-top: 10px; } .filebtn { margin: 0; font-size: 1rem; } .filebtn:focus-within { outline: 3px solid var(--amber); outline-offset: 2px; }
.fixq { margin: 0 0 10px; } .fixq summary { cursor: pointer; color: var(--green); font-weight: 600; font-size: .92rem; padding: 6px 0; } .fixq label { margin-top: 8px; }

.answer .bigq { font-size: 1.7rem; margin: 0 0 10px; }
.answer textarea { field-sizing: content; font-size: 1.1rem; line-height: 1.6; min-height: 190px; margin-top: 8px; resize: vertical; font-family: var(--serif); }
.saved { font-size: .85rem; color: var(--muted); margin: 6px 0 12px; }
.warn { background: var(--amber-bg); border-left: 4px solid var(--amber); padding: 12px 14px; border-radius: 8px; font-size: .95rem; margin: 0 0 10px; color: hsl(36 60% 14%); }
.warn p { margin: 0 0 6px; } .warn q { font-family: var(--serif); font-style: italic; } .warn .btn { margin-top: 4px; background: hsl(36 78% 28%); border-color: hsl(36 78% 28%); }
.warn-foot { font-size: .85rem; color: var(--muted); margin: -2px 0 14px; } #lineguard:not(:empty) { margin-top: 10px; }
.fixcard { border-color: var(--amber); } .fixitem { border-top: 1px solid var(--line); padding-top: 14px; margin-top: 14px; } .fixitem .kind { margin-bottom: 8px; } .fixitem .row { margin-top: 8px; }
.tools { display: flex; flex-wrap: wrap; gap: 10px; }
[hidden] { display: none !important; }
.dot { width: 14px; height: 14px; border-radius: 50%; background: hsl(8 80% 60%); animation: pulse 1s infinite alternate; }
@keyframes pulse { to { opacity: .3; transform: scale(.8); } }
@media (prefers-reduced-motion: reduce) { .dot { animation: none; } html { scroll-behavior: auto; } }
.starters { margin-top: 22px; } .starters p { font-size: .95rem; color: var(--muted); margin-bottom: 8px; }
.chip { border: 1.5px solid var(--line); background: var(--paper); border-radius: 999px; padding: 9px 14px; margin: 0 6px 8px 0; cursor: pointer; font-family: var(--serif); font-style: italic; min-height: 44px; }
.chip:hover { border-color: var(--green); }
.tip { margin-top: 14px; }

.forms { border: 0; padding: 0; margin: 0 0 28px; display: grid; gap: 10px; } .nudge { margin-top: -16px; }
.forms legend { font-family: var(--serif); font-size: 1.35rem; font-weight: 600; margin-bottom: 12px; padding: 0; }
.formopt { display: flex; gap: 14px; align-items: center; background: var(--paper); border: 1.5px solid var(--line); border-radius: 16px; padding: 12px 14px; margin: 0; cursor: pointer; font-weight: 400; }
.formopt input { position: absolute; opacity: 0; width: 1px; }
.formopt:has(input:checked) { border-color: var(--green); box-shadow: inset 0 0 0 1.5px var(--green); background: #fff; }
.formopt:has(input:focus-visible) { outline: 3px solid var(--amber); outline-offset: 2px; }
.formopt svg { width: 80px; flex: none; background: var(--bg); border-radius: 8px; }
.formopt svg .a { fill: var(--line); } .formopt svg .b { fill: var(--green); } .formopt svg .p { fill: #fff; stroke: var(--line); } .formopt svg .s { fill: none; stroke: var(--green); stroke-width: 2; } .formopt svg .bt { fill: var(--green); }
.formopt b { display: block; font-family: var(--serif); font-size: 1.15rem; } .formopt small { color: var(--muted); font-size: .9rem; margin: 0; }
.order { list-style: none; padding: 0; margin: 12px 0 0; display: grid; gap: 8px; counter-reset: o; }
.order li { display: flex; align-items: center; gap: 10px; background: var(--paper); border: 1px solid var(--line); border-radius: 14px; padding: 8px 8px 8px 14px; font-family: var(--serif); }
.order li > span:first-child { flex: 1; } .order em { display: block; font: 700 .7rem var(--sans); text-transform: uppercase; letter-spacing: .08em; color: var(--amber); }
.mv { display: flex; gap: 4px; } .mv button { width: 44px; height: 44px; border-radius: 12px; border: 1.5px solid var(--line); background: #fff; cursor: pointer; font-size: 1.1rem; }
.mv button:disabled { opacity: .3; cursor: default; } .mv button:not(:disabled):hover { border-color: var(--green); }
.empty { background: var(--soft); border-radius: 16px; padding: 24px; text-align: center; color: var(--muted); }

.check { list-style: none; padding: 0; margin: 0 0 20px; } .check li { padding: 8px 0 8px 32px; position: relative; border-bottom: 1px solid var(--line); }
.check li::before { position: absolute; left: 2px; font-weight: 700; } .check .ok::before { content: "✓"; color: var(--green); } .check .no::before { content: "…"; color: var(--amber); } .check .no { color: hsl(36 60% 20%); }
.okcard { background: hsl(95 30% 92%); border-color: hsl(95 25% 70%); }

.editor .preview { display: none; }
.pane { display: flex; flex-direction: column; min-height: calc(100dvh - 44px); }
.dock { position: sticky; bottom: 0; z-index: 6; margin-top: auto; background: color-mix(in srgb, var(--paper) 94%, transparent); backdrop-filter: blur(8px); border-top: 1px solid var(--line); padding: 10px 16px calc(10px + env(safe-area-inset-bottom)); }
.dock-in { display: flex; gap: 10px; max-width: 648px; margin: 0 auto; } .dock-in .btn { white-space: nowrap; padding-left: 16px; padding-right: 16px; } .dock-in .btn:not(.pvbtn) { flex: 1; } .dock-in .pvbtn:only-child { flex: 1; }
.dock-note { max-width: 648px; margin: 0 auto 8px; font-size: .88rem; color: var(--muted); } .dock-note b { color: var(--green); }
#toast { position: fixed; left: 16px; right: 16px; bottom: 92px; z-index: 30; max-width: 520px; margin: 0 auto; background: var(--dark); color: #fff; border-radius: 14px; padding: 12px 16px; font-size: .95rem; box-shadow: 0 8px 30px rgb(0 0 0 / .3); }
dialog#peek { border: 0; padding: 0; width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; margin: 0; background: var(--bg); }
dialog#peek::backdrop { background: var(--bg); }
body:has(dialog[open]) { overflow: hidden; }
.pubbar { position: sticky; top: 0; z-index: 9; background: var(--dark); color: #fff; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 16px; font-size: .85rem; }
.pubbar a, .pubbar button { color: #fff; background: none; border: 0; font-weight: 600; cursor: pointer; text-decoration: none; padding: 6px 0; font-size: .9rem; }
.pubbar span { opacity: .75; }
@media (min-width: 1000px) {
  .editor { display: grid; grid-template-columns: minmax(0, 1fr) 440px; align-items: start; }
  .editor .preview { display: block; position: sticky; top: 0; height: 100vh; padding: 16px 24px 24px; background: var(--soft); border-left: 1px solid var(--line); }
  .pvlabel { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; color: var(--muted); margin: 0 0 8px; text-align: center; }
  .pvbtn { display: none; } .dock-in { justify-content: flex-end; } .dock-in .btn:not(.pvbtn) { flex: none; min-width: 260px; } .dock:not(:has(.dock-in > :not(.pvbtn), .dock-note)) { display: none; }
}
.phone { background: var(--bg); border: 8px solid var(--dark); border-radius: 32px; height: calc(100vh - 80px); overflow: auto; scrollbar-width: thin; }
.phone.tall { height: auto; overflow: visible; }
`;
