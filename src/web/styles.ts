/**
 * One stylesheet, served from `/assets/app.css` so the page needs no inline
 * <style> and the CSP can stay strict.
 *
 * Visual direction: calm, neutral, credible. Warm greys and a muted teal, no
 * urgency colours, no countdowns, no imagery of distress. Mobile first.
 */
export const APP_CSS = `
:root {
  color-scheme: light dark;
  --bg: #fbfaf8;
  --surface: #ffffff;
  --surface-alt: #f3f1ed;
  --border: #ddd8d0;
  --text: #23211e;
  --text-muted: #5c574f;
  --accent: #1f5f5b;
  --accent-strong: #174a47;
  --accent-soft: #e4efee;
  --focus: #8a4b1f;
  --radius: 12px;
  --maxw: 68rem;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161815;
    --surface: #1e211e;
    --surface-alt: #262a26;
    --border: #3a403a;
    --text: #eceae5;
    --text-muted: #b3aea4;
    --accent: #6fbdb5;
    --accent-strong: #8fd3cb;
    --accent-soft: #21302e;
    --focus: #f0b078;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 400 1rem/1.65 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
h1, h2, h3 { line-height: 1.25; letter-spacing: -0.01em; margin: 0 0 0.5em; font-weight: 650; }
h1 { font-size: clamp(1.7rem, 1.2rem + 2.2vw, 2.6rem); }
h2 { font-size: clamp(1.3rem, 1.1rem + 1vw, 1.7rem); margin-top: 2rem; }
h3 { font-size: 1.1rem; margin-top: 1.5rem; }
p { margin: 0 0 1rem; max-width: 68ch; }
a { color: var(--accent-strong); text-underline-offset: 0.18em; }
a:hover { text-decoration-thickness: 2px; }
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
img { max-width: 100%; height: auto; }

.skip-link {
  position: absolute; left: -9999px; top: 0; background: var(--accent); color: #fff;
  padding: 0.6rem 1rem; z-index: 20; border-radius: 0 0 var(--radius) 0;
}
.skip-link:focus { left: 0; }

.wrap { width: 100%; max-width: var(--maxw); margin: 0 auto; padding: 0 1rem; }

header.site {
  border-bottom: 1px solid var(--border); background: var(--surface); position: sticky; top: 0; z-index: 10;
}
header.site .wrap { display: flex; flex-wrap: wrap; gap: 0.75rem 1.25rem; align-items: center; padding-block: 0.85rem; }
.brand { font-weight: 700; font-size: 1.05rem; color: var(--text); text-decoration: none; margin-right: auto; }
.brand span { color: var(--accent); }
nav.site ul { list-style: none; display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; margin: 0; padding: 0; }
nav.site a { color: var(--text-muted); text-decoration: none; font-size: 0.94rem; padding: 0.25rem 0; }
nav.site a:hover, nav.site a[aria-current="page"] { color: var(--accent-strong); text-decoration: underline; }

main { display: block; padding-block: 2rem 3rem; }
footer.site { border-top: 1px solid var(--border); background: var(--surface); padding-block: 2rem; margin-top: 2rem; }
footer.site ul { list-style: none; padding: 0; margin: 0 0 1rem; display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; }
footer.site p { color: var(--text-muted); font-size: 0.9rem; }

.hero { background: var(--accent-soft); border-radius: var(--radius); padding: clamp(1.5rem, 1rem + 3vw, 3rem); margin-bottom: 2rem; }
.hero p.lead { font-size: 1.1rem; color: var(--text-muted); }

.btn {
  display: inline-block; font: inherit; font-weight: 600; cursor: pointer;
  background: var(--accent); color: #fff; border: 2px solid var(--accent);
  padding: 0.7rem 1.25rem; border-radius: var(--radius); text-decoration: none;
}
.btn:hover { background: var(--accent-strong); border-color: var(--accent-strong); }
.btn.secondary { background: transparent; color: var(--accent-strong); }
.btn.secondary:hover { background: var(--accent-soft); }
.btn[aria-disabled="true"], .btn:disabled { opacity: 0.55; cursor: not-allowed; }
@media (prefers-color-scheme: dark) { .btn { color: #10201f; } }

.notice {
  border-left: 4px solid var(--accent); background: var(--surface-alt);
  padding: 0.9rem 1.1rem; border-radius: 0 var(--radius) var(--radius) 0; margin: 1rem 0;
}
.notice.warn { border-left-color: var(--focus); }
.notice h2, .notice h3 { margin-top: 0; }

.grid { display: grid; gap: 1rem; grid-template-columns: 1fr; }
@media (min-width: 46rem) { .grid.cols-2 { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 62rem) { .grid.cols-3 { grid-template-columns: repeat(3, 1fr); } }

.card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 1.1rem; display: flex; flex-direction: column; gap: 0.6rem;
}
.card h3 { margin: 0; font-size: 1.15rem; }
.card .meta { color: var(--text-muted); font-size: 0.92rem; margin: 0; }
.card dl { display: grid; grid-template-columns: auto 1fr; gap: 0.2rem 0.75rem; margin: 0; font-size: 0.93rem; }
.card dt { color: var(--text-muted); }
.card dd { margin: 0; }

.avatar {
  width: 64px; height: 64px; border-radius: 50%; background: var(--surface-alt);
  border: 1px solid var(--border); object-fit: cover; flex: none;
}

.tags { list-style: none; display: flex; flex-wrap: wrap; gap: 0.4rem; padding: 0; margin: 0; }
.tag {
  font-size: 0.83rem; background: var(--surface-alt); border: 1px solid var(--border);
  border-radius: 999px; padding: 0.15rem 0.65rem; color: var(--text-muted);
}
.tag.verified { background: var(--accent-soft); color: var(--accent-strong); border-color: var(--accent); }
.tag.demo { background: #fdf1e2; color: #8a4b1f; border-color: #e8c9a4; }
@media (prefers-color-scheme: dark) { .tag.demo { background: #33261a; color: #f0b078; border-color: #6a4c2c; } }

form.filters { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem; margin-bottom: 1.5rem; }
fieldset { border: 0; padding: 0; margin: 0 0 1rem; }
legend { font-weight: 600; padding: 0; margin-bottom: 0.4rem; }
label { display: block; font-size: 0.93rem; margin-bottom: 0.25rem; }
input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="date"], select, textarea {
  width: 100%; font: inherit; padding: 0.55rem 0.7rem; border-radius: 8px;
  border: 1px solid var(--border); background: var(--surface); color: var(--text);
}
textarea { min-height: 7rem; resize: vertical; }
.field { margin-bottom: 0.9rem; }
.field-row { display: grid; gap: 0.9rem; grid-template-columns: 1fr; }
@media (min-width: 40rem) { .field-row.two { grid-template-columns: 1fr 1fr; } }
.checkbox { display: flex; gap: 0.5rem; align-items: start; margin-bottom: 0.6rem; }
.checkbox input { margin-top: 0.35rem; }
.checkbox label { margin: 0; }
.hint { color: var(--text-muted); font-size: 0.86rem; margin: 0.2rem 0 0; }

table { width: 100%; border-collapse: collapse; font-size: 0.93rem; }
th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--text-muted); font-weight: 600; }
.table-scroll { overflow-x: auto; }

.slot-list { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 0.5rem; }
.slot-list li { border: 1px solid var(--border); border-radius: 8px; padding: 0.4rem 0.7rem; background: var(--surface); font-size: 0.92rem; }

.error { color: #8a1f1f; background: #fdecec; border-left: 4px solid #8a1f1f; padding: 0.8rem 1rem; border-radius: 0 8px 8px 0; margin: 1rem 0; }
@media (prefers-color-scheme: dark) { .error { color: #f2b8b8; background: #331b1b; } }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;
