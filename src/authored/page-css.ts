/**
 * Arkusz strony autorskiej. Jeden wygląd dla wszystkich osób - różni je budowa strony, nie kolor;
 * tokeny są tokenami serwisu (`src/web/styles.ts`), kroje leżą w `public/fonts`.
 */
export const AUTHORED_CSS = `
@font-face { font-family: Inter; font-weight: 400; font-display: swap; src: url("/fonts/inter-400.woff2") format("woff2"); }
@font-face { font-family: Inter; font-weight: 500; font-display: swap; src: url("/fonts/inter-500.woff2") format("woff2"); }
@font-face { font-family: Inter; font-weight: 600; font-display: swap; src: url("/fonts/inter-600.woff2") format("woff2"); }
@font-face { font-family: "Lora Variable"; font-weight: 400 700; font-display: swap; src: url("/fonts/lora-latin-ext-variable.woff2") format("woff2"); unicode-range: U+0100-02AF, U+1E00-1EFF, U+2020, U+20A0-20AB; }
@font-face { font-family: "Lora Variable"; font-weight: 400 700; font-display: swap; src: url("/fonts/lora-latin-variable.woff2") format("woff2"); }
/* Tokeny serwisu (otwartyterapeuta.pl): ta sama biel papieru, zielen i granat co na stronie glownej. */
:root {
  --bg: #f7f8f1; --paper: #fffefa; --soft: #f2f3e9; --line: #e2e5d8;
  --ink: #344125; --muted: #5b6151; --green: #3d6529; --green-d: #2f4f20;
  --amber: #8b6415; --amber-bg: #f6efdc; --dark: hsl(226 30% 21%);
  --serif: "Lora Variable", Lora, Georgia, "Times New Roman", serif;
  --sans: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; scroll-padding-bottom: 120px; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.55 var(--sans); }
h1, h2, h3, h4 { font-family: var(--serif); font-weight: 600; line-height: 1.2; margin: 0 0 .4em; text-wrap: balance; }
h1 { font-size: 1.75rem; } h2 { font-size: 1.25rem; }
p { margin: 0 0 .8em; } a { color: var(--green); }
:focus-visible { outline: 3px solid var(--amber); outline-offset: 2px; border-radius: 4px; }
.sr, .skip:not(:focus) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.skip:focus { position: fixed; top: 8px; left: 8px; background: #fff; padding: 8px 12px; z-index: 99; }

/* ================= STRONA PUBLICZNA ================= */
.pub { container-type: inline-size; background: var(--bg); position: relative; }
.pub.plain { background: none; }
.pub h1 { font-size: 1.9rem; margin-bottom: .25em; }
.pub .line { color: var(--muted); margin: 0 0 10px; font-size: 1.05rem; }
.pub .badge { display: table; font-size: .8rem; font-weight: 700; color: var(--green); background: hsl(95 30% 90%); border-radius: 999px; padding: 3px 10px; margin: 0 0 8px; }
.chips { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; padding: 0; margin: 0; } .chips li { font-size: .8rem; border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; color: var(--muted); background: var(--paper); }
.over { font-size: .78rem; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; color: var(--amber); margin-bottom: 6px; }
.ph { flex: none; display: block; width: 64px; height: 64px; border-radius: 50%; object-fit: cover; object-position: 50% 20%; background: var(--soft); }
.ph.mono { display: grid; place-items: center; background: var(--green); color: #fff; font: 600 1.3rem var(--serif); }
.ph.mini { width: 36px; height: 36px; font-size: .85rem; }
.ph.big { width: 120px; height: 120px; font-size: 2.4rem; }
.say { font-family: var(--serif); font-size: 1.45rem; line-height: 1.3; font-style: italic; }
.steps { list-style: none; counter-reset: s; padding: 0; margin: 0 0 .8em; } .steps li { counter-increment: s; position: relative; padding: 0 0 12px 38px; }
.steps li::before { content: counter(s); position: absolute; left: 0; top: 1px; width: 26px; height: 26px; border-radius: 50%; border: 1.5px solid var(--green); color: var(--green); font: 700 .8rem/23px var(--sans); text-align: center; }
.ticks { list-style: none; padding: 0; margin: 0 0 .8em; } .ticks li { padding: 0 0 8px 26px; position: relative; } .ticks li::before { content: "—"; position: absolute; left: 0; color: var(--amber); }

/* otwarcia */
.open { margin: 0 0 20px; padding: 0; font: italic 500 1.6rem/1.3 var(--serif); text-wrap: balance; color: var(--green-d); }
.open::before { content: "„"; } .open::after { content: "”"; }
.strip { list-style: none; padding: 0; margin: 0 0 20px; border: 1px solid var(--line); border-radius: 16px; background: var(--paper); overflow: hidden; }
.strip li + li { border-top: 1px solid var(--line); }
.strip a { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 11px 16px; text-decoration: none; color: inherit; min-height: 44px; } .strip a:hover { background: var(--soft); }
.strip b { font: 600 1.1rem/1.25 var(--serif); color: var(--green-d); white-space: nowrap; } .strip span { font-size: .8rem; line-height: 1.3; color: var(--muted); text-align: right; }
@container (min-width: 520px) {
  .strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); } .strip li + li { border-top: 0; border-left: 1px solid var(--line); }
  .strip a { display: block; height: 100%; text-align: center; padding: 14px 8px; } .strip b { display: block; white-space: normal; } .strip span { display: block; text-align: center; margin-top: 3px; }
}

.fact { background: var(--paper); border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin: 0 0 14px; scroll-margin-top: 70px; }
.fact h3 { font: 700 .75rem var(--sans); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 10px; }
.fact .src { font-size: .75rem; margin: 10px 0 0; }
.offers, .creds { list-style: none; padding: 0; margin: 0; }
.offers li { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); }
.offers small { display: block; color: var(--muted); } .offers b { font: 600 1.25rem var(--serif); white-space: nowrap; }
.policy { font-size: .88rem; color: var(--muted); margin: 10px 0 0; }
.creds li { padding: 6px 0; } .creds span { display: block; font-size: .9rem; color: var(--muted); } .creds em { font-style: normal; font-size: .8rem; font-weight: 700; } .creds .ok { color: var(--green); } .creds .wait { color: var(--amber); }
.day h4 { font: 600 .95rem var(--sans); margin: 8px 0 6px; } .day h4::first-letter { text-transform: uppercase; }
.times { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; padding: 0; margin: 0; } .times li { min-width: 64px; padding: 9px 10px; border-radius: 10px; border: 1px solid var(--line); background: #fff; font-weight: 600; text-align: center; }
.evinfo { margin: 0; display: grid; gap: 8px; } .evinfo div { display: grid; grid-template-columns: 84px 1fr; gap: 8px; } .evinfo dt { color: var(--muted); font-size: .9rem; } .evinfo dd { margin: 0; font-weight: 600; } .evinfo dd::first-letter { text-transform: uppercase; }
.seats { margin: 0 0 6px; } .seats b { font: 600 1.6rem var(--serif); }
.meter { height: 8px; border-radius: 4px; background: var(--soft); overflow: hidden; margin-bottom: 14px; } .meter i { display: block; height: 100%; background: var(--amber); }
.signup form { display: grid; gap: 0; } .signup button { min-height: 48px; border-radius: 999px; border: 0; background: var(--green); color: #fff; font-weight: 700; cursor: pointer; }

/* przycisk rezerwacji: pełny pasek na dole, nie pływająca pigułka — nie zasłania tekstu w środku ekranu */
.ctabar { position: sticky; bottom: 0; z-index: 3; text-align: center; padding: 10px 16px calc(10px + env(safe-area-inset-bottom)); background: color-mix(in srgb, var(--paper) 94%, transparent); backdrop-filter: blur(8px); border-top: 1px solid var(--line); }
.cta { display: inline-block; min-width: min(100%, 320px); background: var(--green); color: #fff; font-weight: 700; text-decoration: none; padding: 12px 26px; border-radius: 999px; }
.cta:hover { background: var(--green-d); }
.crisis { background: var(--dark); color: hsl(60 30% 94%); padding: 28px 16px 36px; }
.crisis > div { max-width: 720px; margin: 0 auto; }
.crisis h2 { font-size: 1.3rem; } .crisis ul { list-style: none; padding: 0; margin: 14px 0; display: grid; gap: 8px; }
.crisis li { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; border-top: 1px solid rgb(255 255 255 / .15); padding-top: 8px; }
.crisis a { color: #fff; font: 600 1.45rem var(--serif); text-decoration: underline; text-underline-offset: 3px; white-space: nowrap; min-width: 8.2ch; } .crisis a:hover { text-decoration: underline; }
.crisis span { font-size: .9rem; color: #d5daea; } .demo-note { font-size: .75rem; opacity: .6; margin: 18px 0 0; }

/* — Pytania i odpowiedzi — */
.f-rozmowa .hero { display: flex; gap: 16px; align-items: center; padding: 28px 16px 20px; max-width: 680px; margin: 0 auto; }
.f-rozmowa.t-twarz .hero { flex-direction: column; align-items: flex-start; }
.talk { max-width: 680px; margin: 0 auto; padding: 0 16px 32px; }
.talk-intro { font-size: .85rem; color: var(--muted); text-align: center; border-top: 1px solid var(--line); padding-top: 14px; }
.ask { margin: 30px 0 10px; }
.ask h2 { margin: 0; font: 600 1.3rem/1.3 var(--serif); color: var(--dark); border-left: 3px solid var(--amber); padding-left: 14px; text-wrap: balance; }
.ans { display: block; } .ans > .ph { display: none; }
.ans > div { font-family: var(--serif); font-size: 1.08rem; line-height: 1.7; padding-left: 17px; }
.ans > div > :last-child { margin-bottom: 0; }
.ans.data { padding-left: 17px; } .ans.data .fact { flex: 1; margin: 0; background: var(--soft); }

/* — List — */
.f-list { background: var(--soft); padding-bottom: 8px; }
.letter { background: var(--paper); margin: 0 auto; padding: 28px 22px 36px; max-width: 720px; font-family: var(--serif); font-size: 1.12rem; line-height: 1.7; box-shadow: 0 1px 0 var(--line), 0 12px 40px rgb(60 60 20 / .08); position: relative; }
.letter .head { display: flex; gap: 14px; align-items: center; font-family: var(--sans); line-height: 1.4; border-bottom: 1px solid var(--line); padding-bottom: 16px; margin-bottom: 8px; }
.letter .head h1 { font-size: 1.45rem; } .letter .head .line { font-size: .95rem; margin-bottom: 8px; } .letter .head .badge { margin: 0; }
.letter .clip { float: right; margin: -6px -4px 10px 14px; padding: 6px 6px 18px; background: #fff; box-shadow: 0 2px 10px rgb(60 60 20 / .25); transform: rotate(2.5deg); position: relative; z-index: 1; }
.letter .clip .ph { width: 96px; height: 120px; border-radius: 2px; font-size: 2rem; }
.letter.has-photo .head { display: block; min-height: 150px; }
.letter .strip { font-family: var(--sans); margin: 16px 0 0; clear: both; }
.letter .date { text-align: right; font-style: italic; color: var(--muted); margin: 18px 0 22px; clear: both; }
.letter .open { border-left: 3px solid var(--amber); padding-left: 16px; font-size: 1.4rem; margin-bottom: 28px; }
.letter .greet { font-size: 2.1rem; font-weight: 400; font-style: italic; margin-bottom: .7em; line-height: 1.2; }
.letter .note { font: 700 .72rem/1.4 var(--sans); text-transform: uppercase; letter-spacing: .08em; color: var(--amber); margin: 1.8em 0 .5em; }
.letter .first > p:first-of-type::first-letter { font-size: 3.2em; float: left; line-height: .85; padding: .06em .08em 0 0; color: var(--green); }
.letter .bye { margin-top: 2em; font-style: italic; } .letter .sign { font-size: 1.7rem; font-style: italic; color: var(--green); margin: 0; }
.letter .chips { font-family: var(--sans); margin-top: 18px; }
.attach { max-width: 720px; margin: 0 auto; padding: 28px 16px 12px; } .attach > h2 { font-style: italic; font-weight: 400; font-size: 1.4rem; margin-bottom: 14px; }

/* — Droga — */
.road-hero { background: var(--green); color: #fff; padding: 28px 16px 20px; }
.road-hero > * { max-width: 720px; margin-left: auto; margin-right: auto; }
.rh { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; } .rh > div { min-width: 0; }
.rh .ph { border: 3px solid rgb(255 255 255 / .85); } .rh .ph.mono { background: rgb(255 255 255 / .16); }
.rh .ph.big { width: 104px; height: 130px; border-radius: 18px; }
.road-hero .over { color: hsl(45 80% 80%); } .road-hero .line { color: rgb(255 255 255 / .88); font-size: 1.1rem; }
.road-hero h1 { font-weight: 500; }
.road-hero .badge { background: rgb(255 255 255 / .16); color: #fff; }
.road-hero .chips li { background: transparent; color: #fff; border-color: rgb(255 255 255 / .45); }
.road-hero .open { color: #fff; margin: 22px auto 0; } .road-hero .strip { margin: 22px auto 0; background: rgb(255 255 255 / .1); border-color: rgb(255 255 255 / .35); }
.road-hero .strip li + li { border-color: rgb(255 255 255 / .35); } .index-hero .strip { text-align: left; } .road-hero .strip b { color: #fff; } .road-hero .strip span { color: rgb(255 255 255 / .85); } .road-hero .strip a:hover { background: rgb(255 255 255 / .12); }
.road-hero nav ol { list-style: none; counter-reset: n; padding: 0; margin: 22px 0 0; display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; }
.road-hero nav li { counter-increment: n; flex: none; } .road-hero nav a { display: block; color: #fff; text-decoration: none; font-size: .85rem; border-top: 2px solid rgb(255 255 255 / .5); padding: 8px 12px 8px 0; min-height: 44px; }
.road-hero nav a::before { content: counter(n) ". "; font-weight: 700; } .road-hero nav a:hover { border-color: #fff; }
.road { max-width: 720px; margin: 0 auto; padding: 28px 16px 12px 16px; }
.station { position: relative; padding: 0 0 28px 48px; scroll-margin-top: 56px; }
.station::before { content: ""; position: absolute; left: 16px; top: 36px; bottom: 0; width: 2px; background: var(--line); }
.station:last-child::before { display: none; }
.station .num { position: absolute; left: 0; top: 0; width: 34px; height: 34px; border-radius: 50%; background: var(--amber); color: #fff; display: grid; place-items: center; font: 700 1rem var(--serif); }
.station h2 { font-size: 1.5rem; padding-top: 3px; margin-bottom: 16px; }
.qa { margin-bottom: 20px; } .qa h3 { font-size: 1.1rem; font-style: italic; color: var(--green); margin-bottom: 6px; }

/* — Spis pytań — */
.index-hero { text-align: center; padding: 32px 16px 8px; max-width: 720px; margin: 0 auto; }
.index-hero .ph { margin: 0 auto 14px; } .index-hero .ph.big { width: 148px; height: 148px; }
.index-hero .badge { margin: 0 auto 10px; } .index-hero .chips { justify-content: center; margin-bottom: 22px; } .index-hero .line { margin-bottom: 12px; }
.index-hero .strip, .index-hero .open { margin-top: 8px; }
.index { max-width: 720px; margin: 0 auto; padding: 8px 16px 32px; }
.index-intro { text-align: center; font-size: .9rem; color: var(--muted); }
.index details { background: var(--paper); border: 1px solid var(--line); border-radius: 16px; margin-bottom: 8px; scroll-margin-top: 60px; }
.index details.data { background: var(--soft); }
.index summary { list-style: none; cursor: pointer; display: flex; gap: 12px; align-items: center; padding: 14px 44px 14px 14px; position: relative; font: 600 1.1rem/1.3 var(--serif); min-height: 56px; border-radius: 16px; }
.index summary::-webkit-details-marker { display: none; }
.index summary::after { content: ""; position: absolute; right: 18px; top: 50%; width: 9px; height: 9px; border-right: 2px solid var(--green); border-bottom: 2px solid var(--green); transform: translateY(-70%) rotate(45deg); transition: transform .15s; }
.index details[open] summary::after { transform: translateY(-30%) rotate(-135deg); }
.index summary .n { flex: none; width: 28px; height: 28px; border-radius: 50%; background: var(--soft); display: grid; place-items: center; font: 700 .8rem var(--sans); color: var(--muted); }
.index details.data .n { background: var(--paper); } .index details[open] .n { background: var(--green); color: #fff; }
.index summary small { display: block; font: 600 .78rem var(--sans); color: var(--muted); margin-top: 3px; }
.index .body { padding: 0 16px 16px 54px; } .index .body > :last-child { margin-bottom: 0; } .index .data .body { padding-left: 16px; } .index .body .fact { border: 0; padding: 0; background: none; }
.slots, .signup, #terminy { scroll-margin-top: 80px; }

@container (min-width: 900px) {
  .pub h1 { font-size: 2.4rem; }
  .open { font-size: 2rem; }
  .strip b { font-size: 1.3rem; } .strip span { font-size: .8rem; } .strip a { padding: 16px 12px; }
  .f-rozmowa { display: grid; grid-template-columns: 340px minmax(0, 680px); justify-content: center; gap: 0 56px; align-items: start; }
  .f-rozmowa .hero { position: sticky; top: 56px; flex-direction: column; align-items: flex-start; padding-top: 56px; margin: 0; }
  .f-rozmowa .ph.big { width: 220px; height: 220px; font-size: 4rem; }
  .f-rozmowa .talk { padding-top: 56px; margin: 0; } .talk-intro { border: 0; text-align: left; padding-top: 0; }
  .f-list { display: grid; grid-template-columns: minmax(0, 760px) 360px; justify-content: center; gap: 0 40px; align-items: start; padding-top: 48px; }
  .letter { padding: 56px 64px 64px 56px; max-width: none; margin: 0 0 48px; }
  .letter .clip { margin: -24px -28px 16px 24px; } .letter .clip .ph { width: 150px; height: 188px; }
  .letter .para { display: grid; grid-template-columns: 150px 1fr; gap: 0 28px; margin-top: 1.4em; } .letter .para > * { grid-column: 2; }
  .letter .para .note { grid-column: 1; grid-row: 1 / span 9; margin: .5em 0 0; text-align: right; }
  .letter .greet, .letter .bye, .letter .sign, .letter .chips, .letter .open { margin-left: 178px; }
  .attach { position: sticky; top: 56px; padding: 0; margin: 0; }
  .road-hero { padding: 56px 16px 28px; } .road-hero h1 { font-size: 3rem; } .road-hero > * { max-width: 932px; } .road-hero .line { font-size: 1.3rem; }
  .rh .ph.big { width: 200px; height: 250px; border-radius: 24px; } .rh .ph { width: 96px; height: 96px; }
  .road { max-width: 964px; padding-top: 48px; } .station { padding-left: 72px; } .station .num { width: 44px; height: 44px; font-size: 1.2rem; } .station::before { left: 21px; top: 48px; }
  .station h2 { font-size: 1.9rem; }
  /* dwie kolumny o stałych rolach: po lewej słowa, po prawej dane — kolejność czytania zostaje jasna */
  .station.both { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 0 48px; align-items: start; } .station.both h2 { grid-column: 1 / -1; }
  .station:not(.both) .st-text, .station:not(.both) .st-facts { max-width: 600px; }
  .index-hero { padding-top: 56px; } .index-hero .ph.big { width: 180px; height: 180px; }
  .index summary { font-size: 1.25rem; padding-top: 18px; padding-bottom: 18px; } .index .body { font-size: 1.05rem; }
}

.book { font-weight: 600; }
.top { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--paper); font-size: .92rem; }
.top nav { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.top a { text-decoration: none; font-weight: 600; } .top .brand { font-family: var(--serif); color: var(--ink); }
`;
