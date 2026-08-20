/**
 * One stylesheet, served from /assets/app.css so the page needs no inline
 * styles and the CSP can stay strict.
 *
 * Visual direction: calm, editorial and health-focused. Warm ivory surfaces,
 * botanical greens, soft light and generous spacing. Mobile first.
 */
export const APP_CSS = `
@font-face {
  font-family: "Lora Variable";
  font-style: normal;
  font-display: swap;
  font-weight: 400 700;
  src: url("/fonts/lora-latin-ext-variable.woff2") format("woff2-variations");
  unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;
}
@font-face {
  font-family: "Lora Variable";
  font-style: normal;
  font-display: swap;
  font-weight: 400 700;
  src: url("/fonts/lora-latin-variable.woff2") format("woff2-variations");
  unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;
}

:root {
  color-scheme: light;
  --bg: #f8f8f2;
  --surface: rgba(255, 255, 252, 0.94);
  --surface-solid: #fffefa;
  --surface-alt: #f2f3e9;
  --border: #e2e5d8;
  --border-strong: #d1d8c1;
  --text: #334021;
  --text-muted: #747a69;
  --accent: #96a600;
  --accent-strong: #617000;
  --accent-soft: #f0f3d7;
  --focus: #8b6415;
  --danger: #8a2f2f;
  --radius-sm: 10px;
  --radius: 14px;
  --radius-lg: 22px;
  --shadow-sm: 0 5px 18px rgba(62, 76, 31, 0.045);
  --shadow: 0 16px 42px rgba(62, 76, 31, 0.075);
  --maxw: 72rem;
  --serif: "Lora Variable", Lora, Georgia, "Times New Roman", serif;
  --sans: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;
  --space-16: 4rem;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
body {
  min-height: 100vh;
  margin: 0;
  background:
    radial-gradient(circle at 5% 0%, rgba(198, 226, 197, 0.38), transparent 30rem),
    linear-gradient(180deg, #fbfbf7 0%, var(--bg) 100%);
  color: var(--text);
  font: 400 1rem/1.7 var(--sans);
  text-rendering: optimizeLegibility;
}
h1, h2, h3 {
  color: var(--text);
  font-family: var(--serif);
  font-weight: 500;
  font-optical-sizing: auto;
  line-height: 1.12;
  letter-spacing: -0.025em;
  margin: 0 0 var(--space-4);
  text-wrap: balance;
}
h1 { font-size: clamp(2.5rem, 1.8rem + 3vw, 4.25rem); }
h2 { font-size: clamp(1.875rem, 1.55rem + 1.35vw, 2.5rem); margin-top: var(--space-12); }
h3 { font-size: clamp(1.25rem, 1.1rem + 0.55vw, 1.5rem); margin-top: var(--space-6); }
p { margin: 0 0 var(--space-4); max-width: 68ch; }
ul, ol { padding-left: var(--space-6); }
li + li { margin-top: var(--space-2); }
li::marker { color: var(--accent); }
a { color: var(--accent-strong); text-decoration-thickness: 1px; text-underline-offset: 0.22em; }
a:hover { text-decoration-thickness: 2px; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; border-radius: 5px; }
img { max-width: 100%; height: auto; }
code { background: var(--surface-alt); border-radius: 6px; padding: 0.08em 0.32em; }

.skip-link {
  position: fixed; left: 1rem; top: -5rem; z-index: 100;
  background: var(--accent-strong); color: #fff; padding: 0.7rem 1rem;
  border-radius: 0 0 var(--radius-sm) var(--radius-sm); transition: top 0.18s ease;
}
.skip-link:focus { top: 0; }

.wrap { width: 100%; max-width: var(--maxw); margin: 0 auto; padding-inline: clamp(1rem, 3vw, 2rem); }

header.site {
  position: sticky; top: 0; z-index: 20;
  border-bottom: 1px solid rgba(199, 209, 175, 0.72);
  background: rgba(255, 255, 251, 0.94);
  -webkit-backdrop-filter: blur(18px);
  backdrop-filter: blur(18px);
}
header.site .wrap {
  min-height: 4rem; display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-6);
  align-items: center; padding-block: var(--space-2);
}
.brand {
  color: var(--text); font-family: var(--serif); font-size: 1.125rem; font-weight: 500;
  letter-spacing: -0.025em; text-decoration: none; margin-right: auto; white-space: nowrap;
}
.brand::before {
  content: ""; display: inline-grid; place-items: center; width: 1.65rem; height: 1.65rem;
  margin-right: 0.55rem; border-radius: 50%; background: var(--accent-soft);
  box-shadow: inset 0 0 0 6px rgba(150, 166, 0, 0.12); vertical-align: -0.22em;
}
.brand span { color: var(--accent-strong); }
nav.site ul {
  list-style: none; display: flex; flex-wrap: wrap; align-items: center;
  gap: 0.25rem; margin: 0; padding: 0;
}
nav.site a {
  display: block; color: var(--text-muted); text-decoration: none;
  min-height: 2.25rem; font-size: 0.875rem; font-weight: 550; padding: 0.45rem var(--space-3); border-radius: 999px;
  transition: color 0.18s ease, background 0.18s ease;
}
nav.site a:hover, nav.site a[aria-current="page"] {
  color: var(--accent-strong); background: var(--accent-soft); text-decoration: none;
}

main { display: block; padding-block: clamp(2rem, 4vw, 3rem) clamp(4rem, 8vw, 6rem); }
main > .wrap > :first-child { margin-top: 0; }

footer.site {
  border-top: 1px solid var(--border); background: color-mix(in srgb, var(--surface-alt) 72%, transparent);
  padding-block: clamp(2.5rem, 5vw, 4rem); margin-top: 0;
}
footer.site .wrap { position: relative; }
footer.site ul {
  list-style: none; padding: 0; margin: 0 0 1.2rem; display: flex;
  flex-wrap: wrap; gap: 0.55rem 1.4rem;
}
footer.site p { color: var(--text-muted); font-size: 0.88rem; }

.hero {
  isolation: isolate; position: relative; overflow: hidden;
  min-height: clamp(31rem, 52vw, 38rem); display: grid; place-content: center;
  margin-bottom: clamp(3rem, 7vw, 5rem); padding: clamp(2rem, 6vw, 5rem);
  border: 1px solid rgba(209, 216, 193, 0.62); border-radius: var(--radius-lg);
  background:
    linear-gradient(rgba(255, 254, 249, 0.3), rgba(255, 254, 249, 0.3)),
    url("/illustrations/therapy-conversation.webp") center / cover no-repeat,
    #fbfaf3;
  box-shadow: 0 12px 35px rgba(62, 76, 31, 0.045);
  text-align: center;
}
.hero::before, .hero::after {
  content: ""; position: absolute; z-index: -1; border: 1px solid rgba(120, 141, 8, 0.12);
  border-radius: 50%; pointer-events: none;
}
.hero::before { width: 28rem; height: 28rem; left: -16rem; top: 4rem; box-shadow: 0 0 0 4rem rgba(255,255,255,0.07); }
.hero::after { width: 35rem; height: 35rem; right: -22rem; top: -8rem; box-shadow: 0 0 0 5rem rgba(255,255,255,0.07); }
.hero h1 { max-width: 16ch; margin-inline: auto; }
.hero p { margin-inline: auto; }
.hero p.lead { max-width: 52ch; color: #686f5f; font-size: clamp(1rem, 0.96rem + 0.25vw, 1.125rem); line-height: 1.7; }

.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  min-height: 2.75rem; padding: 0.625rem 1.25rem; border: 1px solid var(--accent-strong);
  border-radius: 999px; background: var(--accent-strong); color: #fff;
  box-shadow: 0 6px 18px rgba(77, 97, 0, 0.12); cursor: pointer;
  font: 650 0.875rem/1.25 var(--sans); text-decoration: none;
  transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}
.btn:hover { transform: translateY(-1px); background: #3f5000; box-shadow: 0 11px 28px rgba(77, 97, 0, 0.22); text-decoration: none; }
.btn.secondary { background: var(--surface); color: var(--accent-strong); border-color: var(--border-strong); box-shadow: none; }
.btn.secondary:hover { background: var(--accent-soft); border-color: var(--accent); }
.btn[aria-disabled="true"], .btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; box-shadow: none; }

.notice {
  position: relative; border: 1px solid var(--border); background: var(--surface-alt);
  padding: 1rem 1.15rem 1rem 1.35rem; border-radius: var(--radius-sm); margin: 1.25rem 0;
  box-shadow: var(--shadow-sm);
}
.notice::before {
  content: ""; position: absolute; inset: 0 auto 0 0; width: 4px;
  border-radius: var(--radius-sm) 0 0 var(--radius-sm); background: var(--accent);
}
.notice.warn::before { background: var(--focus); }
.notice h2, .notice h3 { margin-top: 0; }
.notice > :last-child { margin-bottom: 0; }

.grid { display: grid; gap: var(--space-6); grid-template-columns: minmax(0, 1fr); }
@media (min-width: 46rem) { .grid.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 64rem) { .grid.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }

.card {
  position: relative; min-width: 0; padding: clamp(1.25rem, 2.5vw, 1.5rem);
  display: flex; flex-direction: column; gap: var(--space-3);
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface-solid);
  box-shadow: var(--shadow-sm); transition: box-shadow 0.2s ease, border-color 0.2s ease;
}
.card:hover { border-color: var(--border-strong); box-shadow: 0 9px 26px rgba(62, 76, 31, 0.065); }
.card h3 { margin: 0; font-size: 1.375rem; }
.card .meta { color: var(--text-muted); font-size: 0.875rem; margin: 0; }
.card dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--space-1) var(--space-3); margin: 0; font-size: 0.875rem; }
.card dt { color: var(--text-muted); }
.card dd { margin: 0; overflow-wrap: anywhere; }

.avatar {
  width: 72px; height: 72px; border-radius: 22px; object-fit: cover; flex: none;
  border: 1px solid var(--border); background:
    radial-gradient(circle at 35% 25%, rgba(255,255,255,0.75), transparent 34%), var(--accent-soft);
  box-shadow: inset 0 0 0 5px rgba(255,255,255,0.2);
}

.tags { list-style: none; display: flex; flex-wrap: wrap; gap: var(--space-2); padding: 0; margin: 0; }
.tags li + li { margin-top: 0; }
.tag {
  font-size: 0.8125rem; line-height: 1.4; font-weight: 560; background: var(--surface-alt); border: 1px solid var(--border);
  border-radius: 999px; padding: var(--space-1) var(--space-3); color: var(--text-muted);
}
.tag.verified { background: var(--accent-soft); color: var(--accent-strong); border-color: var(--border-strong); }
.tag.demo { background: #fbf0df; color: #82511d; border-color: #e9cda6; }

main .wrap > form:not(.filters) {
  max-width: 56rem; padding: clamp(1.2rem, 3vw, 2rem); margin-block: 1.3rem 2rem;
  border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface);
  box-shadow: var(--shadow-sm);
}
form.filters {
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: clamp(1.15rem, 3vw, 2rem); margin-bottom: 2rem;
  background: var(--surface); box-shadow: var(--shadow-sm);
}
fieldset { border: 0; padding: 0; margin: 0 0 1.2rem; }
legend { font: 500 1.25rem/1.3 var(--serif); padding: 0; margin-bottom: var(--space-3); }
label { display: block; color: var(--text); font-size: 0.875rem; font-weight: 620; margin-bottom: var(--space-2); }
input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="date"], input[type="url"], input:not([type]), select, textarea {
  width: 100%; min-height: 2.75rem; padding: 0.625rem var(--space-3);
  border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
  background: var(--surface-solid); color: var(--text); font: inherit;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}
input:hover, select:hover, textarea:hover { border-color: var(--accent); }
input:focus, select:focus, textarea:focus {
  border-color: var(--accent); outline: 0; box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent);
}
textarea { min-height: 8.5rem; resize: vertical; }
select { cursor: pointer; }
input[type="checkbox"], input[type="radio"] { width: 1.05rem; height: 1.05rem; accent-color: var(--accent-strong); }
.field { margin-bottom: var(--space-4); }
.field-row { display: grid; gap: var(--space-4); grid-template-columns: minmax(0, 1fr); }
@media (min-width: 42rem) { .field-row.two { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.checkbox { display: flex; gap: 0.6rem; align-items: flex-start; margin-bottom: 0.7rem; }
.checkbox input { flex: none; margin-top: 0.32rem; }
.checkbox label { margin: 0; font-weight: 450; }
.hint { color: var(--text-muted); font-size: 0.875rem; line-height: 1.55; margin: var(--space-1) 0 0; }

.table-scroll {
  overflow-x: auto; margin-block: 1rem 1.7rem; border: 1px solid var(--border);
  border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow-sm);
}
table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
th, td { text-align: left; padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border); vertical-align: top; }
th { background: var(--surface-alt); color: var(--text-muted); font-size: 0.75rem; letter-spacing: 0.05em; text-transform: uppercase; font-weight: 700; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: color-mix(in srgb, var(--accent-soft) 38%, transparent); }

.slot-list { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 0.55rem; }
.slot-list li {
  border: 1px solid var(--border-strong); border-radius: 999px; padding: 0.45rem 0.78rem;
  background: var(--surface); box-shadow: var(--shadow-sm); font-size: 0.88rem;
}

.error {
  color: var(--danger); background: color-mix(in srgb, var(--danger) 9%, var(--surface-solid));
  border: 1px solid color-mix(in srgb, var(--danger) 32%, transparent);
  padding: 0.9rem 1rem; border-radius: var(--radius-sm); margin: 1rem 0;
}
.meta { color: var(--text-muted); }
.visually-hidden {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

@media (max-width: 45rem) {
  header.site { position: relative; }
  header.site .wrap { align-items: flex-start; }
  nav.site { width: 100%; overflow-x: auto; padding-bottom: 0.15rem; scrollbar-width: thin; }
  nav.site ul { width: max-content; flex-wrap: nowrap; }
  .hero { min-height: 30rem; border-radius: var(--radius); padding-inline: var(--space-6); }
  .hero h1 { font-size: clamp(2.25rem, 10vw, 3rem); }
  .btn { width: 100%; }
  .card:hover { transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
`;
