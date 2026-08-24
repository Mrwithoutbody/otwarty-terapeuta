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
@font-face {
  font-family: "Playfair Variable";
  font-style: normal;
  font-display: swap;
  font-weight: 400 700;
  src: url("/fonts/playfair-latin-ext-variable.woff2") format("woff2-variations");
  unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;
}
@font-face {
  font-family: "Playfair Variable";
  font-style: normal;
  font-display: swap;
  font-weight: 400 700;
  src: url("/fonts/playfair-latin-variable.woff2") format("woff2-variations");
  unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;
}

:root {
  color-scheme: light;
  --bg: #f7f8f1;
  --surface: rgba(255, 255, 252, 0.94);
  --surface-solid: #fffefa;
  --surface-alt: #f2f3e9;
  --band: #f1ecdb;
  --border: #e2e5d8;
  --border-strong: #d1d8c1;
  --text: #344125;
  --text-muted: #707765;
  --accent: #9cad00;
  --accent-strong: #637200;
  --accent-soft: #f0f3d6;
  --focus: #8b6415;
  --danger: #8a2f2f;
  --radius-sm: 10px;
  --radius: 14px;
  --radius-lg: 22px;
  --shadow-sm: 0 5px 18px rgba(62, 76, 31, 0.045);
  --shadow: 0 16px 42px rgba(62, 76, 31, 0.075);
  --maxw: 76rem;
  --serif: "Lora Variable", Lora, Georgia, "Times New Roman", serif;
  /* The profile page reads these; a theme redefines them on .profile-page and
     nothing else in the service moves. Hard-coded hexes here were what made
     "one palette for everyone" a fact rather than a default. */
  --dark: #344125;
  --dark-ink: #f0f3d6;
  --dark-mute: #d5dcc2;
  --dark-head: #fffefa;
  --wash-a: #faf9eb;
  --wash-b: #eef4e8;
  --panel-tint: #f3f6ec;
  --glow: rgba(238, 244, 145, 0.42);
  --prose: #596250;
  /* Air between the bands. The rhythm axis multiplies it - the same sections
     read as a catalogue entry at 0.7 and as a practice's own site at 1.4. */
  --rhythm: 1;
  /* Multiplier on the profile's own headings; 1 is the catalogue voice. */
  --display: 1;
  /* The accent of each theme, named once. The theme reads it, and so does the
     catalogue card of a therapist who chose that theme - a card must not take
     the whole palette (a list of six palettes is a rainbow, not a catalogue),
     but one hairline of her colour carries across. */
  --acc-bursztyn: #a9762a;
  --acc-glina: #a4553a;
  --acc-grafit: #40566e;
  --acc-las: #2f6d4f;
  --acc-papier: #2b2b2a;
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
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; overflow-x: clip;
  scroll-padding-top: 5.5rem; }
body {
  min-height: 100vh;
  margin: 0;
  background: var(--bg);
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

.wrap { width: 100%; max-width: var(--maxw); margin: 0 auto; padding-inline: clamp(1rem, 3vw, 2.5rem); }

header.site {
  position: sticky; top: 0; z-index: 20;
  border-bottom: 1px solid rgba(210, 216, 194, 0.72);
  background: rgba(253, 254, 248, 0.92);
  -webkit-backdrop-filter: blur(18px);
  backdrop-filter: blur(18px);
}
header.site .wrap {
  min-height: 4.75rem; display: flex; gap: var(--space-4);
  align-items: center; padding-block: 0.65rem;
}
.brand {
  display: inline-flex; align-items: center; gap: 0.65rem; color: var(--text);
  font-family: var(--serif); font-size: 1.06rem; font-weight: 550;
  letter-spacing: -0.025em; text-decoration: none; margin-right: auto; white-space: nowrap;
}
.brand img { width: 2rem; height: 2rem; padding: 0.42rem; border-radius: 9px; color: var(--accent-strong); background: var(--accent-soft); }
.brand span { color: var(--text); }
nav.site ul {
  list-style: none; display: flex; flex-wrap: wrap; align-items: center;
  gap: 0.25rem; margin: 0; padding: 0;
}
header.site nav li { margin-top: 0; }
nav.site a {
  display: block; color: var(--text-muted); text-decoration: none;
  min-height: 2.25rem; font-size: 0.875rem; font-weight: 550; padding: 0.45rem var(--space-3); border-radius: 999px;
  transition: color 0.18s ease, background 0.18s ease;
}
nav.site a:hover, nav.site a[aria-current="page"] {
  color: var(--accent-strong); background: var(--accent-soft); text-decoration: none;
}
.header-cta {
  display: inline-flex; align-items: center; min-height: 2.55rem; padding: 0.55rem 1rem;
  border-radius: 999px; background: #414839; color: #fff; font-size: 0.8rem;
  font-weight: 700; text-decoration: none; white-space: nowrap;
}
.header-cta:hover { background: #2d3428; text-decoration: none; }
.mobile-nav { display: none; position: relative; }

main { display: block; padding-block: clamp(2rem, 4vw, 3rem) clamp(4rem, 8vw, 6rem); }
/* A band that breaks out to the full viewport has to meet the footer. Left with
   main's bottom padding under it, the page ends on a strip of white below a
   dark block, which reads as a mistake - because it is one. */
main:has(.profile-page > .pblock--dark:last-child) { padding-bottom: 0; }
main > .wrap > :first-child { margin-top: 0; }

footer.site { border-top: 1px solid var(--border); background: #f1f3e8; padding-block: clamp(3rem, 6vw, 5rem) 2rem; }
footer.site .wrap { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(20rem, 1fr); gap: 3rem 6rem; }
/* The crisis numbers open the footer, across its full width, with the accent
   rule down the side. Loud enough to find while scrolling past, quiet enough
   not to shout at someone who is not in a crisis. */
.footer-crisis { grid-column: 1 / -1; background: var(--surface-solid);
  border: 1px solid var(--border); border-left: 4px solid var(--accent-strong);
  border-radius: var(--radius); padding: var(--space-6) var(--space-8); margin-bottom: 0.5rem; }
.footer-crisis h2 { font-size: 1.05rem; margin: 0 0 var(--space-4); }
.footer-crisis ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: var(--space-4); list-style: none; margin: 0; padding: 0; }
/* The link-list rule in footer.site sets a top margin and ties with this
   selector, so it has to be beaten on specificity - otherwise the second and
   third numbers sit lower than the first. */
footer.site .footer-crisis li + li { margin-top: 0; }
.footer-crisis li a { display: block; text-decoration: none; color: inherit; }
.footer-crisis b { display: block; font-family: var(--serif); font-size: 1.5rem; font-weight: 600;
  letter-spacing: -0.02em; color: var(--accent-strong); font-variant-numeric: tabular-nums; }
.footer-crisis li span { display: block; color: var(--text-muted); font-size: 0.84rem; }
.footer-crisis li a:hover b { text-decoration: underline; }
/* The global paragraph measure would wrap the arrow onto its own line. */
.footer-crisis > p { margin: var(--space-4) 0 0; max-width: none; }
.footer-crisis > p a { font-size: 0.88rem; color: var(--accent-strong); }
@media (max-width: 40rem) { .footer-crisis { padding: var(--space-6); } }

.footer-brand p { color: var(--text-muted); margin-top: 1rem; max-width: 38ch; font-size: 0.9rem; }
.footer-links { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2rem; }
.footer-links h2 { margin: 0 0 0.8rem; font: 700 0.72rem/1.3 var(--sans); letter-spacing: 0.08em; text-transform: uppercase; }
footer.site ul { list-style: none; padding: 0; margin: 0; }
footer.site li + li { margin-top: 0.45rem; }
footer.site a { color: var(--text-muted); font-size: 0.86rem; text-decoration: none; }
footer.site a:hover { color: var(--accent-strong); text-decoration: underline; }
.footer-legal { grid-column: 1 / -1; display: flex; justify-content: space-between; gap: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--border-strong); }
.footer-legal p { color: var(--text-muted); font-size: 0.76rem; line-height: 1.55; margin: 0; }
.footer-legal p:first-child { max-width: 80ch; }

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
.grid > li { margin-top: 0; }
@media (min-width: 46rem) { .grid.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 64rem) { .grid.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }

.card {
  position: relative; min-width: 0; padding: clamp(1.25rem, 2.5vw, 1.5rem);
  display: flex; flex-direction: column; gap: var(--space-3);
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface-solid);
  /* The hairline a themed card carries rides along with both shadows; hover
     used to replace the whole box-shadow and wiped it off exactly when the
     card was supposed to be louder. */
  box-shadow: var(--card-edge, 0 0 #0000), var(--shadow-sm);
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
}
.card:hover { border-color: var(--border-strong);
  box-shadow: var(--card-edge, 0 0 #0000), 0 9px 26px rgba(62, 76, 31, 0.065); }
.card h3 { margin: 0; font-size: 1.375rem; }
.card .meta { color: var(--text-muted); font-size: 0.875rem; margin: 0; }
.card dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--space-1) var(--space-3); margin: 0; font-size: 0.875rem; }
.card dt { color: var(--text-muted); }
.card dd { margin: 0; overflow-wrap: anywhere; }
.lang { display: inline-flex; align-items: center; gap: 0.4em; }
/* Przygaszone: flaga ma być znacznikiem, nie najjaśniejszym punktem strony. */
.lang svg { width: 1.15em; height: auto; aspect-ratio: 3 / 2; border-radius: 2px; filter: saturate(0.62); box-shadow: 0 0 0 1px rgb(0 0 0 / 0.12); flex: none; }
.therapist-card .card-actions { margin-top: auto; padding-top: var(--space-2); }
/* Her colour on the card, as a hairline and a link - not as a repainted card.
   The list has to stay comparable: six differently coloured cards side by side
   is a rainbow, and the eye stops reading the facts.
   --card-ink is the accent taken 30% towards black, because the accent itself
   is a decoration colour: the service green reads 2.5:1 on the card surface,
   and a link has to clear 4.5:1. Mixed, the quietest theme lands at 4.75:1. */
.therapist-card {
  --card-accent: var(--accent);
  --card-edge: inset 0 3px 0 color-mix(in srgb, var(--card-accent) 62%, transparent);
  --card-ink: color-mix(in srgb, var(--card-accent) 70%, #000);
}
/* Hover strengthens: the hairline goes to full accent instead of vanishing. */
.therapist-card:hover { --card-edge: inset 0 3px 0 var(--card-accent); }
.therapist-card--theme-bursztyn { --card-accent: var(--acc-bursztyn); }
.therapist-card--theme-glina { --card-accent: var(--acc-glina); }
.therapist-card--theme-grafit { --card-accent: var(--acc-grafit); }
.therapist-card--theme-las { --card-accent: var(--acc-las); }
.therapist-card--theme-papier { --card-accent: var(--acc-papier); }
.therapist-card .card-actions a { color: var(--card-ink); }
/* The name keeps its colour and gains her underline - swapping the colour on
   hover made the strongest link on the card go paler the moment it was aimed at. */
.therapist-card h3 a:hover { text-decoration-color: var(--card-accent); }

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

/* Public subpages */
.subpage { display: grid; gap: clamp(4.5rem, 9vw, 7.5rem); }
.subpage > *, .subpage h2, .subpage h3, .document-page h2 { margin-top: 0; }
.subpage p { max-width: none; }
.subpage-hero {
  isolation: isolate; position: relative; overflow: hidden; min-height: clamp(28rem, 46vw, 35rem);
  display: flex; flex-direction: column; align-items: flex-start; justify-content: center;
  padding: clamp(2.5rem, 7vw, 6rem); border: 1px solid #dce3cf; border-radius: 1.5rem;
  background:
    radial-gradient(circle at 82% 18%, rgba(210,232,198,0.78), transparent 25rem),
    radial-gradient(circle at 15% 100%, rgba(239,244,163,0.68), transparent 24rem),
    linear-gradient(145deg, #eef5e9, #faf9e9 76%);
}
.subpage-hero::after { content: ""; position: absolute; z-index: -1; right: -10rem; bottom: -16rem; width: 35rem; height: 35rem; border: 1px solid rgba(99,114,0,0.1); border-radius: 48% 52% 42% 58%; transform: rotate(-18deg); box-shadow: 0 0 0 5rem rgba(255,255,255,0.09); }
.subpage-hero h1 { max-width: 15ch; margin: 0 0 1.25rem; font-size: clamp(2.8rem, 5.4vw, 5rem); line-height: 0.99; letter-spacing: -0.055em; }
.subpage-hero .lead { max-width: 58ch; margin: 0 0 1.75rem; color: #66705d; font-size: clamp(1rem, 1.4vw, 1.15rem); line-height: 1.75; }
.subpage-heading { max-width: 45rem; margin-bottom: 2.5rem; }
.subpage-heading h2, .resource-heading h2 { margin: 0 0 0.8rem; font-size: clamp(2.2rem, 4vw, 3.7rem); letter-spacing: -0.045em; }
.subpage-heading > p:last-child, .resource-heading > p:last-child { color: var(--text-muted); font-size: 0.95rem; line-height: 1.7; }

.process-grid { counter-reset: process; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; margin: 0; padding: 0; list-style: none; }
.process-grid li { counter-increment: process; min-height: 17rem; margin: 0; padding: 1.8rem; border: 1px solid var(--border); border-radius: 1rem; background: #fff; box-shadow: var(--shadow-sm); }
.process-grid li::before { content: "0" counter(process); display: grid; place-items: center; width: 2.35rem; height: 2.35rem; margin-bottom: 2.6rem; border-radius: 50%; background: var(--accent-soft); color: var(--accent-strong); font-size: 0.7rem; font-weight: 800; }
.process-grid h3 { margin: 0 0 0.65rem; font-size: 1.25rem; }
.process-grid p { margin: 0; color: var(--text-muted); font-size: 0.82rem; line-height: 1.65; }
.principles-panel { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); overflow: hidden; border: 1px solid var(--border); border-radius: 1.4rem; background: #f1f3e7; }
.principles-panel article { padding: clamp(2.2rem, 5vw, 4.2rem); }
.principles-panel article + article { border-left: 1px solid var(--border-strong); background: rgba(255,255,255,0.48); }
.principles-panel h2, .data-panel h2, .contact-panel h2 { margin: 0 0 1.2rem; font-size: clamp(2rem, 3vw, 3rem); }
.principles-panel p { color: var(--text-muted); font-size: 0.9rem; line-height: 1.75; }
.calm-list { display: grid; gap: 0.85rem; margin: 1.4rem 0 0; padding: 0; list-style: none; }
.calm-list li { position: relative; margin: 0; padding-left: 1.6rem; color: #596250; font-size: 0.88rem; line-height: 1.65; }
.calm-list li::before { content: "✓"; position: absolute; left: 0; top: 0.05rem; color: var(--accent-strong); font-weight: 800; }

.info-card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.info-card { min-height: 21rem; padding: clamp(2rem, 4vw, 3rem); border: 1px solid var(--border); border-radius: 1.2rem; background: #fff; box-shadow: var(--shadow-sm); }
.info-card:nth-child(2), .info-card:nth-child(3) { background: #f3f5ea; }
.info-index { display: inline-flex; margin-bottom: 3rem; color: var(--accent-strong); font-size: 0.7rem; font-weight: 800; letter-spacing: 0.06em; }
.info-card h2 { margin: 0 0 1rem; font-size: clamp(1.8rem, 3vw, 2.7rem); }
.info-card p { max-width: 52ch; color: var(--text-muted); font-size: 0.9rem; line-height: 1.75; }
.info-card a { font-size: 0.86rem; font-weight: 750; text-decoration: none; }
.data-panel { display: grid; grid-template-columns: 0.8fr 1.2fr; gap: clamp(3rem, 8vw, 8rem); padding: clamp(2.5rem, 7vw, 5rem); border-radius: 1.5rem; background: #eaf0e3; }
.data-panel > div > p:last-child { color: var(--text-muted); font-size: 0.9rem; line-height: 1.7; }
.data-panel .calm-list { margin: 0; }
.contact-panel { padding: clamp(2.5rem, 6vw, 4.5rem); border: 1px solid var(--border); border-radius: 1.3rem; background: #fff; }
.contact-panel p:last-child { margin-bottom: 0; color: var(--text-muted); }

.crisis-page { gap: clamp(4rem, 8vw, 7rem); }
.crisis-hero { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(18rem, 0.8fr); gap: clamp(2.5rem, 7vw, 7rem); align-items: center; padding: clamp(2.5rem, 7vw, 6rem); border-radius: 1.5rem; background: linear-gradient(135deg, #eef2e4, #faf6e8); border: 1px solid var(--border); }
.crisis-hero h1 { max-width: 14ch; margin: 0 0 1.2rem; font-size: clamp(2.7rem, 5vw, 4.8rem); line-height: 1; letter-spacing: -0.055em; }
.crisis-hero .lead { max-width: 52ch; margin: 0; color: var(--text-muted); font-size: 1rem; line-height: 1.75; }
.emergency-panel { display: grid; justify-items: start; padding: clamp(2rem, 5vw, 3.5rem); border-radius: 1.2rem; background: #45503d; color: #fff; box-shadow: var(--shadow); }
.emergency-panel p { margin: 0; color: #e7eadf; font-size: 0.75rem; font-weight: 700; }
.emergency-panel .emergency-warning { margin-bottom: 1.4rem; padding-bottom: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.18); color: #fff; font-size: 0.78rem; line-height: 1.5; }
.emergency-panel a { margin: 0.4rem 0; color: #f4f5ce; font: 500 clamp(4rem, 8vw, 6.5rem)/1 var(--serif); letter-spacing: -0.06em; text-decoration: none; }
.emergency-panel span { color: #cdd4c6; font-size: 0.75rem; }
.resource-heading { max-width: 48rem; margin-bottom: 2.5rem; }
.resource-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin: 0; padding: 0; list-style: none; }
.resource-card { display: flex; flex-direction: column; min-height: 26rem; margin: 0; padding: clamp(1.6rem, 3vw, 2.3rem); border: 1px solid var(--border); border-radius: 1.1rem; background: #fff; box-shadow: var(--shadow-sm); }
.resource-card h3 { margin: 0 0 1rem; font-size: 1.35rem; }
.resource-card > p:not(.resource-hours):not(.resource-source) { margin: 0 0 1.5rem; color: var(--text-muted); font-size: 0.86rem; line-height: 1.7; }
.resource-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.65rem; margin-top: auto; padding-top: 1.25rem; }
.resource-phone { display: grid; padding: 0.65rem 1rem; border-radius: 0.8rem; background: var(--accent-soft); text-decoration: none; }
.resource-phone span { color: var(--text-muted); font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.resource-phone strong { color: var(--accent-strong); font-size: 1rem; }
.resource-link { padding: 0.7rem 0.9rem; font-size: 0.78rem; font-weight: 750; text-decoration: none; }
.resource-hours { margin: 1.25rem 0 0; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--text-muted); font-size: 0.72rem; }
.resource-hours span { color: var(--accent); font-size: 0.6rem; }
.resource-source { margin: 0.55rem 0 0; color: #8a8f83; font-size: 0.66rem; }
.minor-resources { padding: clamp(2.5rem, 6vw, 4.5rem); border-radius: 1.5rem; background: #f1f3e8; }
.minor-resources .resource-card { background: rgba(255,255,252,0.82); }
.source-note { max-width: 54rem; margin: -2rem auto 0; text-align: center; }
.source-note p { margin: 0; color: var(--text-muted); font-size: 0.72rem; line-height: 1.6; }

.document-page { display: grid; gap: clamp(4rem, 8vw, 6rem); }
.document-hero { position: relative; overflow: hidden; padding: clamp(3rem, 7vw, 6rem); border: 1px solid var(--border); border-radius: 1.5rem; background: linear-gradient(135deg, #eef3e8, #faf8ea); }
.document-hero h1 { max-width: 15ch; margin: 0 0 1rem; font-size: clamp(2.8rem, 5vw, 4.8rem); letter-spacing: -0.055em; }
.document-hero .lead { max-width: 58ch; margin: 0; color: var(--text-muted); font-size: 1rem; line-height: 1.75; }
.document-version { display: inline-flex; margin: 2rem 0 0; padding: 0.4rem 0.7rem; border: 1px solid var(--border-strong); border-radius: 999px; color: var(--text-muted); background: rgba(255,255,255,0.55); font-size: 0.7rem; }
.document-content { width: min(100%, 52rem); margin-inline: auto; }
.document-content section { padding: clamp(2rem, 5vw, 3.5rem) 0; border-bottom: 1px solid var(--border); }
.document-content section:first-child { padding-top: 0; }
.document-content section:last-child { border-bottom: 0; }
.document-content h2 { margin: 0 0 1.4rem; font-size: clamp(1.8rem, 3vw, 2.5rem); }
.document-content p, .document-content li { color: #5f6758; font-size: 0.92rem; line-height: 1.8; }
.document-content ul { display: grid; gap: 0.8rem; padding-left: 1.3rem; }

.directory-page { display: grid; gap: clamp(3.5rem, 7vw, 5.5rem); }
.directory-hero { padding: clamp(2.5rem, 6vw, 5rem); border: 1px solid var(--border); border-radius: 1.5rem; background: linear-gradient(140deg, #eef4e8, #faf9eb); }
.directory-hero h1 { max-width: 15ch; margin: 0 0 1rem; font-size: clamp(2.8rem, 5vw, 4.8rem); letter-spacing: -0.055em; }
.directory-hero > p:last-child { max-width: 55ch; margin: 0; color: var(--text-muted); font-size: 1rem; line-height: 1.75; }
.directory-page .filters { margin: 0; padding: clamp(1.5rem, 4vw, 2.7rem); border-radius: 1.2rem; }
.directory-results-heading { margin-bottom: 2rem; }
.directory-results-heading h2 { margin: 0; font-size: clamp(2.2rem, 4vw, 3.5rem); }
.profile-page { width: min(100%, 76rem); margin-inline: auto; }
.profile-page > nav { margin-bottom: 2.5rem; color: var(--text-muted); font-size: 0.78rem; }
.profile-page .crumbs { margin: 0; }

/* --- profile spine: never moves, so profiles stay comparable ------------- */
/* Every other heading on the site is a painted panel - the directory, the
   documents, the crisis page, the signup. The profile was the one page that
   opened on flat ivory, which is what made it read as colourless beside the
   home page. The two variants that paint themselves override this. */
.phero { display: grid; grid-template-columns: 1.05fr minmax(17rem, 26rem); gap: clamp(2rem, 5vw, 4rem);
  align-items: center; margin-top: var(--space-6); padding: clamp(1.8rem, 3.5vw, 3.2rem);
  border: 1px solid var(--border); border-radius: var(--radius-lg);
  background: linear-gradient(140deg, var(--wash-a), var(--wash-b)); }
.phero > div { order: -1; }
/* The name used to be the loudest thing on the page at 3.6rem. Someone looking
   for help is not looking for a surname - they are looking for whether this is
   for them, which is what the line under it answers. */
.phero h1 { font-size: calc(clamp(1.7rem, 1.5rem + 0.8vw, 2rem) * var(--display));
  line-height: calc(1.12 - (var(--display) - 1) * 0.09); letter-spacing: -0.025em;
  margin-bottom: var(--space-3); }
.phero-photo { width: 100%; height: auto; aspect-ratio: 4 / 5; border-radius: var(--radius-lg);
  object-fit: cover; border: 1px solid var(--border); background: var(--surface-alt);
  display: block; box-shadow: var(--shadow); }
.phero-actions { display: flex; flex-wrap: wrap; gap: 0.8rem; margin: var(--space-6) 0 var(--space-6); }
/* The same drawing the demo profiles are served, so an empty photo slot and a
   demo avatar cannot end up looking like two different ideas. */
/* One drawing, every theme: the placeholder keeps its shape and takes the
   page's hue from the band it sits on. Without the blend a sage avatar sat in
   the middle of an amber profile. */
.phero-photo.empty, .psplit-empty, .phero-card-empty {
  background: var(--band) url("/avatar-placeholder.webp") center / cover no-repeat;
  background-blend-mode: luminosity; }
.phero-photo.empty { display: block; }

/* --- heading blocks ------------------------------------------------------ */
/* Portrait first in the source, text second, so the classic block puts the text
   back on the left and the others build on that order. */

/* The promise heading: her sentence carries the page, the name rides on a card
   under the portrait. Measured off the reference - quote at 1.1rem italic serif
   with an accent rule, portrait 4:5 in a bordered card. */
.phero--obietnica { grid-template-columns: 1.15fr 0.85fr; align-items: center; }
.phero--obietnica > div { order: -1; }
.phero-quote { font-family: var(--serif); font-style: italic; color: var(--text-muted);
  border-left: 3px solid var(--accent); padding-left: 1.1rem; margin: 0 0 1.8rem; max-width: 52ch;
  font-size: 1rem; line-height: 1.7; }
.phero-lead { font-size: 1.12rem; color: var(--text-muted); max-width: 56ch; margin: 0; }
.phero--obietnica .phero-actions { margin: 2rem 0 1.4rem; }
.phero-card { margin: 0; background: var(--surface-solid); border: 1px solid var(--border);
  border-radius: var(--radius-lg); box-shadow: var(--shadow); overflow: hidden; }
.phero-card img, .phero-card-empty { display: block; width: 100%; height: auto; aspect-ratio: 4 / 5;
  object-fit: cover; }
.phero-card figcaption { padding: 1.1rem 1.3rem; border-top: 1px solid var(--border); }
.phero-card strong { display: block; font-family: var(--serif); font-size: 1.1rem; font-weight: 600; }
.phero-card span { display: block; color: var(--text-muted); font-size: 0.9rem; }
@media (max-width: 56rem) { .phero--obietnica { grid-template-columns: 1fr; } }

/* Dark, centred, portrait above the name - the shape a single-person site uses
   when the person is the whole offer. */
.phero--spotlight { grid-template-columns: minmax(0, 46rem); justify-content: center;
  text-align: center; background: var(--dark); color: var(--dark-ink); border: 0; border-radius: var(--radius-lg);
  padding: clamp(2rem, 5vw, 3.5rem); margin-top: var(--space-6); }
.phero--spotlight > div { order: 0; }
.phero--spotlight h1 { color: var(--dark-head); }
.phero--spotlight .phero-headline { color: var(--dark-mute); }
.phero--spotlight .phero-photo { width: 11rem; aspect-ratio: 1; border-radius: 50%;
  margin: 0 auto var(--space-6); border-color: color-mix(in srgb, var(--dark-ink) 30%, transparent); }
.phero--spotlight .phero-facts { justify-content: center; }
.phero-greeting { font-family: var(--serif); font-size: clamp(1.2rem, 1.05rem + 0.8vw, 1.7rem);
  line-height: 1.4; margin-bottom: var(--space-4); }
.phero--spotlight .phero-facts li { background: color-mix(in srgb, var(--dark-ink) 12%, transparent); border-color: color-mix(in srgb, var(--dark-ink) 30%, transparent);
  color: var(--dark-ink); }
.phero--spotlight .badges { justify-content: center; }
.phero--spotlight .badge { background: color-mix(in srgb, var(--dark-ink) 12%, transparent); border-color: color-mix(in srgb, var(--dark-ink) 30%, transparent);
  color: var(--dark-ink); }
.phero--spotlight .phero-actions { justify-content: center; }
.phero--spotlight .btn.ghost { color: var(--dark-ink); border-color: color-mix(in srgb, var(--dark-ink) 45%, transparent); }

/* Label and value, two pairs across - the layout the catalogue card has always
   used for exactly these facts. Two columns rather than three: at three the
   label and its value drift apart and the eye stops pairing them. */
.pdata { display: grid; grid-template-columns: repeat(auto-fit, minmax(26rem, 1fr));
  gap: 0 var(--space-8); margin: 0; }
.pdata > div { display: grid; grid-template-columns: minmax(8rem, auto) minmax(0, 1fr);
  gap: var(--space-4); padding: 0.7rem 0; border-top: 1px solid var(--border); align-items: baseline; }
.pdata dt { color: var(--text-muted); font-size: 0.92rem; }
.pdata dd { margin: 0; overflow-wrap: anywhere; }
@media (max-width: 46rem) { .pdata > div { grid-template-columns: minmax(7rem, auto) minmax(0, 1fr); } }

/* Two cards in one row: the whole "what it costs and when" in a single glance,
   instead of two full-width bands one under the other. */
.pcards { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
  align-items: start; }
.pcard { background: var(--surface-solid); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: var(--space-6); box-shadow: var(--shadow-sm); }
.pcard h3 { margin: 0 0 var(--space-4); font-size: 0.82rem; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--text-muted); font-family: var(--sans); font-weight: 600; }
.pcard .offer-rows { border: 0; border-radius: 0; background: none; }
.pcard .offer-rows li { padding-inline: 0; }
.pcard .hint { margin: var(--space-3) 0 0; }
.slot-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; list-style: none; margin: 0; padding: 0; }
.slot-chips li { margin: 0; background: var(--bg); border: 1px solid var(--border-strong);
  border-radius: var(--radius); padding: 0.5rem 0.85rem; }
.slot-chips b { display: block; font-size: 0.92rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.slot-chips span { display: block; color: var(--text-muted); font-size: 0.78rem; }

/* The offer as rows: three cards of one line each is a lot of furniture. */
.offer-rows { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border);
  border-radius: var(--radius); background: var(--surface-solid); overflow: hidden; }
.offer-rows li { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2) var(--space-4);
  margin: 0; padding: 0.9rem var(--space-6); border-top: 1px solid var(--border); }
.offer-rows li:first-child { border-top: 0; }
.offer-name { font-weight: 500; }
.offer-meta { color: var(--text-muted); font-size: 0.88rem; }
.offer-price { margin-left: auto; font-family: var(--serif); font-size: 1.25rem; font-weight: 600; }

/* The whole heading on a colour block: words one side, portrait the other with
   one fact pinned to it. A panoramic crop was the first attempt and it turned a
   portrait photograph into a forehead. */
.phero--okladka { grid-template-columns: 1.05fr 0.95fr; gap: clamp(2rem, 4vw, 3.5rem);
  background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--accent-soft)); border-radius: var(--radius-lg);
  padding: clamp(1.8rem, 3.5vw, 3.2rem); margin-top: var(--space-6); align-items: center; }
.phero--okladka > div { order: -1; }
.phero-frame { position: relative; margin: 0; max-width: 22rem; margin-inline: auto; }
.phero--okladka .phero-photo { aspect-ratio: 4 / 5; border-radius: var(--radius-lg); }
.phero-badge { position: absolute; left: -0.9rem; bottom: 1.4rem; background: var(--surface-solid);
  border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow);
  padding: 0.7rem 1rem; }
.phero-badge b { display: block; font-size: 0.95rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.phero-badge span { display: block; color: var(--text-muted); font-size: 0.76rem; }
.phero--okladka .phero-facts li { background: var(--surface-solid); border-color: var(--border); }
@media (max-width: 56rem) { .phero--okladka { grid-template-columns: 1fr; } }
.phero-headline { font-size: 1.15rem; line-height: 1.55; color: var(--text-muted); max-width: 52ch;
  margin-bottom: var(--space-6); }
.phero-facts { display: flex; flex-wrap: wrap; gap: 0.5rem; list-style: none; margin: 0; padding: 0; }
.phero-facts li { margin: 0; background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--accent-soft));
  border-radius: 999px; padding: 0.34rem 0.85rem; font-size: 0.87rem; color: var(--accent-strong); }
.phero-facts .lang { display: inline-flex; align-items: center; gap: 0.3rem; }
.badges { display: flex; flex-wrap: wrap; gap: 0.45rem; list-style: none; margin: 0 0 var(--space-3); padding: 0; }
.badges li { margin: 0; }
.badge { display: inline-block; font-size: 0.78rem; padding: 0.36rem 0.75rem; border-radius: 999px;
  border: 1px solid var(--border); background: var(--surface-solid); }
.badge.ok { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 30%, var(--accent-soft)); color: var(--accent-strong); }
.badge.demo { background: var(--surface-alt); color: var(--text-muted); }

.pfacts { margin-top: var(--space-6); background: var(--surface-solid); border: 1px solid var(--border);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-6);
  display: grid; grid-template-columns: repeat(3, 1fr) auto; gap: var(--space-6); align-items: center; }
.pfact strong { display: block; font-family: var(--serif); font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; }
.pfact span { display: block; color: var(--text-muted); font-size: 0.82rem; }
.pfact.empty strong { font-family: var(--sans); font-size: 1rem; font-weight: 500; color: var(--text-muted); }

/* --- sections: the therapist's own arrangement --------------------------- */
/* Not a landing page by default. Six rems of air between bands is right for a
   page selling something and wrong for a profile someone is comparing against
   three others. */
.pblock { padding-block: calc(clamp(2.6rem, 5.5vw, 6rem) * var(--rhythm)); border-top: 1px solid var(--border); }
/* The first section sits right under the fact card, which already has its own
   outline - a hairline there separates nothing. A tinted section draws its own
   bottom border, so the one after it must not add a second. */
.pblock:first-of-type { border-top: 0; }
.pblock--alt + .pblock, .pblock--dark + .pblock, .pblock--narrow + .pblock { border-top: 0; }
.pblock > h2 { margin: 0 0 var(--space-4);
  font-size: calc(clamp(1.35rem, 1.2rem + 0.6vw, 1.5rem) * var(--display));
  line-height: 1.12; letter-spacing: -0.025em; }
.pblock > .block-lead { max-width: 56ch; color: var(--text-muted); font-size: 1.02rem;
  margin-bottom: var(--space-6); }
.pblock > h2 + .chips, .pblock > h2 + .offer-grid, .pblock > h2 + .meeting-steps { margin-top: var(--space-6); }

/* Background belongs to the section, not to its position. Tinting every second
   block gave seven identical bands; now she picks, and a page can have one
   tinted stretch, a narrow strip and a dark close.
   The sections live inside main > .wrap > .profile-page, so a tinted one is an
   island unless it breaks out. This escapes to the full viewport and pads the
   content straight back to the column, which is what the reference does with
   full-width sections wrapping an inner container.
   overflow-x: clip on the root is what keeps 100vw (which counts the
   scrollbar) from adding a horizontal scrollbar. */
.pblock--dark { margin-inline: calc(50% - 50vw); padding-inline: calc(50vw - 50%); }
/* A tinted section is a panel, not a stripe. Two flat full-width fills tried
   here first - one sage, one sand - and both turned the page below the heading
   into wallpaper: the tint ran wall to wall, the sections lost their edges and
   the whole scroll read as one colour. The heading works because it is a framed
   panel with a wash inside it, so the tinted sections are built the same way,
   with the pool of light on the opposite side. Consecutive panels mirror, so
   two in a row are not the same picture twice - counted among the panels, not
   among all sections: nth-of-type counts every section element, so two panels
   with a plain block between them landed on the same gradient. */
.pblock--alt, .pblock--narrow {
  margin-block: var(--space-6); padding-inline: clamp(1.6rem, 3vw, 3rem); border: 1px solid var(--border);
  border-radius: var(--radius-lg); background:
    radial-gradient(circle at 84% 10%, var(--glow), transparent 20rem),
    linear-gradient(140deg, var(--panel-tint), var(--band)); }
:is(.pblock--alt, .pblock--narrow):nth-child(even of :is(.pblock--alt, .pblock--narrow)) { background:
    radial-gradient(circle at 14% 88%, var(--glow), transparent 20rem),
    linear-gradient(220deg, var(--panel-tint), var(--band)); }
.pblock--narrow { padding-block: calc(clamp(1.2rem, 2vw, 1.6rem) * var(--rhythm)); }
/* The other presentation: the same sections as bands running the full width of
   the viewport, flat, no frame. The heading loses its card by default in this
   layout (see layoutClasses) - a bordered card butting straight into a
   full-width band is a seam with nothing on either side of it.
   overflow-x: clip on the root is what keeps 100vw, which counts the
   scrollbar, from adding a horizontal scrollbar. */
.profile-page--pasy .pblock--alt, .profile-page--pasy .pblock--narrow {
  margin-inline: calc(50% - 50vw); padding-inline: calc(50vw - 50%);
  margin-block: 0; border: 0; border-block: 1px solid var(--border-strong);
  border-radius: 0; background: var(--band); }
main:has(.profile-page--pasy > :is(.pblock--alt, .pblock--narrow):last-child) { padding-bottom: 0; }
/* Only the two headings that take their background from here lose it; the dark
   one and the coloured one are cards by definition. */
.profile-page--hero-goly :is(.phero--klasyczny, .phero--obietnica) {
  margin-top: 0; padding: 0; border: 0; border-radius: 0; background: none;
  padding-block: clamp(1.5rem, 4vw, 5rem) clamp(2rem, 5vw, 6rem); }

/* The dark band the page closes on. Ending on "Zasady odwołania" was ending on
   the dullest thing the profile had to say. */
.pblock--dark { background: var(--dark); color: var(--dark-ink); border-block: 0;
  padding-block: calc(clamp(3rem, 6vw, 4.5rem) * var(--rhythm)); }
.pblock--dark h2 { color: var(--dark-head); }
.pblock--dark .btn { background: var(--dark-head); color: var(--dark); border-color: var(--dark-head); }
.pblock--dark .btn.ghost { background: transparent; color: var(--dark-ink); border-color: color-mix(in srgb, var(--dark-ink) 45%, transparent); }

/* --- themes: the same sections, her palette ------------------------------ */
/* A theme is a set of tokens on the profile element - nothing here is a new
   component, and nothing leaks past .profile-page into the service chrome.
   Presets rather than a colour picker: a free palette produces unreadable
   contrast and a catalogue that looks like nine different products. */
/* A theme owns the whole strip, not just the boxes inside it: the page ground
   stayed service-sage around an amber profile. Painted by a bleeding pseudo
   element - the same margin trick the bands use collapses the column here,
   because the padding percentage resolves against the width it just changed. */
.profile-page { position: relative; }
.profile-page[class*="--theme-"]::before {
  content: ""; position: absolute; z-index: -1; inset-block: calc(var(--space-16) * -1) 0;
  left: 50%; width: 100vw; translate: -50% 0; background: var(--wash-a); }

/* Air, not colour: the same arrangement as a catalogue entry or as a practice's
   own site. */
/* Type scale, the axis the reference profiles actually carry themselves on.
   The catalogue default stays where it was: a profile compared against three
   others wants a 2rem name, not a 6rem one. */
.profile-page--skala-duza { --display: 1.7; }
.profile-page--skala-plakat { --display: 2.7; }

.profile-page--rytm-zwarty { --rhythm: 0.72; }
.profile-page--rytm-dostojny { --rhythm: 1.25; }

/* The themes that speak in a display serif; las keeps the service face. */
:is(.profile-page--theme-bursztyn, .profile-page--theme-glina, .profile-page--theme-grafit,
    .profile-page--theme-papier) {
  --serif: "Playfair Variable", Playfair Display, Georgia, "Times New Roman", serif;
}
.profile-page--theme-bursztyn {
  --text: #3b3020; --text-muted: #6f6350;
  --band: #f5ead3; --panel-tint: #fdf7ea; --glow: rgba(240, 200, 120, 0.34);
  --wash-a: #fdf7ea; --wash-b: #f6e8cf;
  --border: #e8ddc6; --border-strong: #d9c9a6;
  --accent: var(--acc-bursztyn); --accent-strong: #7c5417; --accent-soft: #f7ecd7;
  --dark: #3d3222; --dark-ink: #f3e6cd; --dark-mute: #d8c7a5; --dark-head: #fffdf6;
  --prose: #5f5340;
}
.profile-page--theme-grafit {
  --text: #232830; --text-muted: #5c6472;
  --band: #eceef1; --panel-tint: #f7f8fa; --glow: rgba(150, 170, 200, 0.26);
  --wash-a: #f8f9fb; --wash-b: #e9ecf1;
  --border: #dde0e6; --border-strong: #c4c9d3;
  --accent: var(--acc-grafit); --accent-strong: #2c3e52; --accent-soft: #e8ecf2;
  --dark: #232830; --dark-ink: #e4e8ee; --dark-mute: #b9c1cd; --dark-head: #ffffff;
  --prose: #4d5560;
}
.profile-page--theme-glina {
  --text: #3e2f28; --text-muted: #6f5d55;
  --band: #f3e3da; --panel-tint: #fbf1ec; --glow: rgba(226, 160, 130, 0.3);
  --wash-a: #fbf2ed; --wash-b: #f2e0d6;
  --border: #e8d5cb; --border-strong: #d8bcae;
  --accent: var(--acc-glina); --accent-strong: #7c3c26; --accent-soft: #f7e6de;
  --dark: #40302a; --dark-ink: #f2ded4; --dark-mute: #d5b8ab; --dark-head: #fffaf7;
  --prose: #62504a;
}
/* Achromatic on purpose: every surface at S<=4%, the accent carried by the
   near-black rather than by a hue. The reference profile that reads as the most
   "designed" has no colour in it at all. */
.profile-page--theme-papier {
  --text: #171716; --text-muted: #6b6b66;
  --band: #f2f2f1; --panel-tint: #fafafa; --glow: rgba(0, 0, 0, 0.035);
  --wash-a: #fbfbfa; --wash-b: #f0f0ef;
  --border: #e3e3e2; --border-strong: #c8c8c6;
  --accent: var(--acc-papier); --accent-strong: #171716; --accent-soft: #f0f0ee;
  --dark: #171716; --dark-ink: #ededec; --dark-mute: #b8b8b6; --dark-head: #ffffff;
  --prose: #56564f;
}
.profile-page--theme-las {
  --text: #1f3a2c; --text-muted: #55665a;
  --band: #e4ede4; --panel-tint: #f2f7f1; --glow: rgba(120, 190, 150, 0.26);
  --wash-a: #f3f8f2; --wash-b: #e2ebe1;
  --border: #d7e2d6; --border-strong: #bacfb9;
  --accent: var(--acc-las); --accent-strong: #1f4d37; --accent-soft: #e3f0e6;
  --dark: #1f3a2c; --dark-ink: #dcead9; --dark-mute: #b4c9b2; --dark-head: #fbfffa;
  --prose: #4a5c4d;
}

/* The section label in the left column, not above the heading. This is what
   makes the reference pages read as a grid rather than as a stack; it needs the
   room only the poster scale has. */
@media (min-width: 60rem) {
  .profile-page--skala-plakat .pblock {
    display: grid; grid-template-columns: minmax(0, 10rem) minmax(0, 1fr); column-gap: var(--space-8);
  }
  .profile-page--skala-plakat .pblock > * { grid-column: 2; }
  .profile-page--skala-plakat .pblock > .eyebrow {
    grid-column: 1; grid-row: 1 / span 40; margin: 0.7rem 0 0; align-self: start;
  }
}

/* --- the profile's own anchor bar ---------------------------------------- */
/* Not sticky: the service header already is, and two stacked bars eat a phone
   screen. It sits under the heading and lists what the page actually renders,
   which is why it is built from the sections rather than hand-kept. */
.pnav { display: flex; flex-wrap: wrap; gap: 0.4rem 1.4rem; align-items: baseline;
  padding: 0.9rem 0; border-bottom: 1px solid var(--border); margin-bottom: var(--space-4); }
.pnav a { font: 600 0.78rem/1.4 var(--sans); letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-muted); text-decoration: none; padding: 0.25rem 0; }
.pnav a:hover { color: var(--accent-strong); }
.profile-page--pasy .pnav { margin-bottom: 0; }

/* Three claims across, the shape every reference profile uses under its
   philosophy paragraphs. */
.pillars { display: grid; gap: var(--space-6); grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  margin-top: var(--space-6); padding: 0; list-style: none; }
.pillars li { margin: 0; padding: var(--space-6); border: 1px solid var(--border);
  border-radius: var(--radius-lg); background: var(--surface-solid); }
.pillars h3 { margin: 0 0 var(--space-3); font-family: var(--serif); font-size: 1.1rem; font-weight: 600; }
.pillars p { margin: 0; color: var(--prose); font-size: 0.95rem; line-height: 1.65; }

/* Her writing elsewhere: title, one line, link out. */
.plinks { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
  margin-top: var(--space-6); padding: 0; list-style: none; }
.plinks li { margin: 0; }
.plinks a { display: block; height: 100%; padding: var(--space-6); text-decoration: none;
  border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface-solid);
  color: inherit; transition: border-color 0.15s ease; }
.plinks a:hover { border-color: var(--border-strong); }
.plinks strong { display: block; font-family: var(--serif); font-size: 1.05rem; font-weight: 600;
  margin-bottom: var(--space-2); }
.plinks span { display: block; color: var(--prose); font-size: 0.92rem; line-height: 1.6; }
.plinks em { display: block; margin-top: var(--space-3); font-style: normal; font-size: 0.8rem;
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent-strong); }

/* Two columns: her words beside her portrait. Without a section shaped like
   this every block was one full-width column, which is what went flat after the
   third heading. */
.psplit { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: clamp(2rem, 5vw, 4rem);
  align-items: center; }
.psplit--flip > div { order: 2; }
.psplit-photo { margin: 0; }
.psplit-photo img, .psplit-empty { display: block; width: 100%; height: auto; aspect-ratio: 4 / 5;
  object-fit: cover; border-radius: var(--radius-lg); border: 1px solid var(--border);
  background: var(--surface-alt); box-shadow: var(--shadow); }
@media (max-width: 860px) { .psplit { grid-template-columns: 1fr; } .psplit--flip > div { order: 0; } }

.pquote { margin: 0; }
.pquote blockquote { margin: 0; border-left: 3px solid var(--accent); padding-left: 1.2rem; }
.pquote p { font-family: var(--serif); font-style: italic; max-width: 52ch;
  font-size: clamp(1.15rem, 1.05rem + 0.6vw, 1.5rem); }
.pquote figcaption { margin-top: var(--space-3); padding-left: 1.2rem; color: var(--text-muted);
  font-size: 0.92rem; }

/* A short band between two tall sections is what keeps a long page from reading
   as one column. */
.pfacts-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: var(--space-4) var(--space-6); list-style: none; margin: 0; padding: 0; }
.pfacts-strip li { margin: 0; font-size: 0.92rem; color: var(--text-muted); }
.pfacts-strip strong { display: block; font-family: var(--serif); font-size: 1.02rem;
  font-weight: 600; color: var(--text); margin-bottom: 0.15rem; }
.pblock > p:not(.eyebrow):not(.hint) { max-width: 62ch; color: var(--prose); }
/* Same specificity as the rule above, and after it - that is what carries the
   light text on the dark band, without reaching for !important. */
.pblock--dark > p:not(.eyebrow):not(.hint), .pblock--dark > .block-lead { color: var(--dark-mute); }
.chips { display: flex; flex-wrap: wrap; gap: 0.5rem; list-style: none; margin: var(--space-4) 0 0; padding: 0; }
.chips li { margin: 0; background: var(--surface-solid); border: 1px solid var(--border);
  border-radius: 999px; padding: 0.55rem 1.1rem; font-size: 0.95rem; }
.offer-grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
.offer-card { background: var(--surface-solid); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: var(--space-8); box-shadow: var(--shadow-sm); }
.offer-card h3 { margin: 0 0 var(--space-2); font-size: 1.02rem; }
.offer-card .amount { display: block; font-family: var(--serif); font-size: 2.4rem; font-weight: 600; letter-spacing: -0.02em; }
.offer-card .per { color: var(--text-muted); font-size: 0.86rem; }
/* Days as columns, hours beneath - the ZnanyLekarz/Booksy pattern people
   already know. A table because that is what this is: days across, times down. */
.slot-table-scroll { overflow-x: auto; margin-bottom: var(--space-4); }
.slot-table { border-collapse: collapse; width: 100%; min-width: 30rem; }
.slot-table th { padding: 0 var(--space-2) var(--space-3); text-align: center; font-weight: 400; }
.slot-table th b { display: block; font-size: 0.9rem; font-weight: 600; text-transform: capitalize; }
.slot-table th span { display: block; font-size: 0.78rem; color: var(--text-muted); }
.slot-table td { padding: 0.45rem var(--space-2); text-align: center; vertical-align: top; }
/* Plain text, no filled blocks: thirty-five tinted rectangles read as noise. */
.slot-time { display: block; font-size: 0.98rem; font-variant-numeric: tabular-nums; }
.slot-mode { display: block; font-size: 0.7rem; color: var(--text-muted); }
.slot-none { display: block; color: var(--border-strong); }
/* The site's tables highlight rows on hover, which promises a click. These rows
   are hours to read, not rows to act on. */
.slot-table tbody tr:hover td { background: none; }
.slot-table td, .slot-table th { border: 0; }

/* Where else to find her: quiet text links under the name, not a band. */
.phero-links { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); list-style: none;
  margin: var(--space-4) 0 0; padding: 0; }
.phero-links li { margin: 0; }
.phero-links a { color: var(--text-muted); font-size: 0.86rem; text-decoration: none;
  border-bottom: 1px solid var(--border-strong); padding-bottom: 1px; }
.phero-links a:hover { color: var(--accent-strong); border-color: var(--accent-strong); }
.phero--spotlight .phero-links { justify-content: center; }
.phero--spotlight .phero-links a { color: var(--dark-mute); border-color: color-mix(in srgb, var(--dark-ink) 40%, transparent); }
.pblock--dark .phero-links a { color: var(--dark-mute); border-color: color-mix(in srgb, var(--dark-ink) 40%, transparent); }
/* "Pierwsze spotkanie": her answers, in the order the person will live them. */
.meeting-steps { counter-reset: s; list-style: none; display: grid; gap: var(--space-4);
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); margin: 0; padding: 0; }
.meeting-steps li { counter-increment: s; position: relative; margin: 0; background: var(--surface-solid);
  border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm);
  padding: 1.9rem 1.6rem 1.5rem; }
.meeting-steps li::before { content: counter(s); position: absolute; top: -0.85rem; left: 1.3rem;
  width: 1.9rem; height: 1.9rem; display: grid; place-items: center; background: var(--accent-strong);
  color: var(--surface-solid); border-radius: 50%; font-size: 0.9rem; font-weight: 600; }
.meeting-steps h3 { margin: 0.3rem 0 0.4rem; font-size: 1.02rem; }
.meeting-steps p { margin: 0; color: var(--text-muted); font-size: 0.95rem; }
/* A card at --surface-solid on the --bg page is three percent of lightness
   away from it, and all that said "card" was a #e2e5d8 hairline and a shadow at
   four percent opacity. That was already thin; beside a tinted band the eye
   adapts and the card stops existing. The profile's cards get an edge and a
   shadow strong enough to survive the comparison. */
.pfacts, .pcard, .offer-card, .meeting-steps li, .phero-card, .phero-badge {
  border-color: var(--border-strong); box-shadow: var(--shadow); }
/* Stacked rows and pills: an edge, but no shadow - four dropped cards in a
   column is a pile, not a list. */
.pblock details, .chips li { border-color: var(--border-strong); }

.read-more { margin-top: var(--space-4); }
/* Sits inside whichever band the therapist put it in. --surface-alt is a green
   grey and went muddy on the sand band; the card white the rest of the page
   uses reads on every background. */
.policy-box { background: var(--surface-solid); border: 1px solid var(--border-strong); border-radius: var(--radius); padding: var(--space-6); }
.policy-box p { margin: 0; color: var(--text-muted); }
.pblock details { background: var(--surface-solid); border: 1px solid var(--border);
  border-radius: var(--radius); margin: 0.7rem 0 0; }
.pblock summary { cursor: pointer; padding: 1rem 1.3rem; font-weight: 500; list-style: none;
  display: flex; justify-content: space-between; gap: var(--space-4); align-items: center; }
.pblock summary::-webkit-details-marker { display: none; }
.pblock summary::after { content: "+"; color: var(--accent-strong); font-size: 1.25rem; line-height: 1; }
.pblock details[open] summary::after { content: "–"; }
.details-body { padding: 0 1.15rem 1rem; color: var(--text-muted); font-size: 0.95rem; }
.details-body p:last-child { margin-bottom: 0; }

@media (max-width: 52rem) {
  .phero { grid-template-columns: 1fr; }
  .phero > div { order: 0; }
  .phero-photo { max-width: 18rem; }
  .pfacts { grid-template-columns: 1fr 1fr; }
  .pfacts .pfact-cta { grid-column: 1 / -1; }
}
@media (max-width: 30rem) { .pfacts { grid-template-columns: 1fr; } }
.signup-page { width: min(100%, 62rem); margin-inline: auto; }
.signup-intro { margin-bottom: 2.5rem; padding: clamp(2.5rem, 6vw, 4.5rem); border: 1px solid var(--border); border-radius: 1.4rem; background: linear-gradient(140deg, var(--wash-b), var(--wash-a)); }
.signup-intro h1 { margin: 0 0 1rem; font-size: clamp(2.6rem, 5vw, 4.2rem); }
.signup-intro p:last-child { max-width: 58ch; margin: 0; color: var(--text-muted); }
.signup-page > form { max-width: none !important; margin-inline: 0; padding: clamp(1.5rem, 4vw, 2.7rem) !important; }

/* Homepage */
.home { display: grid; gap: 0; }
.home p { max-width: none; }
.home h2 { margin-top: 0; }
.home-hero {
  isolation: isolate; position: relative; overflow: hidden; min-height: 48rem;
  display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
  padding: clamp(3.5rem, 7vw, 6.25rem) clamp(1.25rem, 5vw, 4.5rem) 0;
  border: 1px solid #dce3cf; border-radius: 1.5rem 1.5rem 0 0;
  background:
    radial-gradient(circle at 50% 63%, rgba(238, 244, 145, 0.95) 0, rgba(243, 247, 191, 0.68) 18rem, transparent 34rem),
    radial-gradient(circle at 15% 0%, rgba(193, 226, 201, 0.75), transparent 31rem),
    radial-gradient(circle at 92% 18%, rgba(215, 234, 204, 0.68), transparent 27rem),
    linear-gradient(180deg, #eef5e9 0%, #f9faec 80%);
  text-align: center;
}
.home-hero::before, .home-hero::after {
  content: ""; position: absolute; z-index: -1; width: 34rem; height: 34rem;
  border: 1px solid rgba(91, 110, 39, 0.085); border-radius: 48% 52% 42% 58%; pointer-events: none;
}
.home-hero::before { left: -20rem; top: 4rem; transform: rotate(28deg); box-shadow: 0 0 0 5rem rgba(255,255,255,0.08); }
.home-hero::after { right: -21rem; top: 1rem; transform: rotate(-18deg); box-shadow: 0 0 0 6rem rgba(255,255,255,0.08); }
.hero-copy { position: relative; z-index: 2; max-width: 53rem; margin-inline: auto; }
.eyebrow, .kicker {
  color: var(--accent-strong); font-size: 0.72rem; line-height: 1.4; font-weight: 750;
  letter-spacing: 0.08em; text-transform: uppercase;
}
.eyebrow { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.7rem; margin-bottom: 1.25rem; border: 1px solid rgba(99,114,0,0.18); border-radius: 999px; background: rgba(255,255,250,0.62); }
/* Inside a profile the eyebrow is a plain line of small caps, the way the
   reference sets it - the pill belongs to the marketing pages. */
.profile-page .eyebrow { display: block; padding: 0; border: 0; background: none;
  font-size: 0.78rem; font-weight: 600; letter-spacing: 0.09em; margin-bottom: 0.7rem; }
.eyebrow > span { width: 0.42rem; height: 0.42rem; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px rgba(156,173,0,0.12); }
.home-hero h1 { max-width: 16ch; margin: 0 auto 1.25rem; font-size: clamp(2.65rem, 5.1vw, 5.2rem); line-height: 0.98; letter-spacing: -0.055em; }
.home-hero .lead { max-width: 48rem; margin: 0 auto 1.65rem; color: #66705d; font-size: clamp(1rem, 1.4vw, 1.13rem); line-height: 1.7; }
.hero-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 0.7rem; }
.hero-actions .btn { min-width: 11.5rem; }
.hero-availability { display: flex; align-items: center; justify-content: center; gap: 0.4rem; margin: 0.85rem 0 0; color: #747b6c; font-size: 0.67rem; }
.hero-availability > span { width: 0.4rem; height: 0.4rem; border-radius: 50%; background: #d99b35; }
.hero-assurances { display: flex; justify-content: center; flex-wrap: wrap; gap: 0.55rem 1.4rem; margin: 1.3rem 0 0; padding: 0; list-style: none; color: #697261; font-size: 0.76rem; }
.hero-assurances li { margin: 0; }
.hero-assurances li::before { content: "✓"; margin-right: 0.35rem; color: var(--accent-strong); font-weight: 800; }

.finder-preview {
  position: relative; z-index: 3; width: min(100%, 52rem); margin-top: 2.4rem; padding: 1rem;
  border: 1px solid rgba(197, 207, 175, 0.9); border-radius: 1.25rem 1.25rem 0 0;
  background: rgba(255,255,251,0.92); box-shadow: 0 25px 70px rgba(61, 76, 33, 0.16);
  text-align: left;
}
.preview-toolbar { display: flex; align-items: center; gap: 0.65rem; color: var(--text); font-size: 0.78rem; font-weight: 700; }
.preview-mark { display: grid; place-items: center; width: 2rem; height: 2rem; color: var(--accent-strong); border-radius: 0.55rem; background: var(--accent-soft); }
.preview-mark img { width: 1.15rem; height: 1.15rem; }
.preview-status { margin-left: auto; padding: 0.25rem 0.55rem; border-radius: 99px; color: var(--accent-strong); background: var(--accent-soft); font-size: 0.67rem; }
.preview-filters { display: flex; gap: 0.5rem; margin: 0.9rem 0; padding-bottom: 0.9rem; border-bottom: 1px solid var(--border); }
.preview-filters span { padding: 0.34rem 0.62rem; border: 1px solid var(--border); border-radius: 99px; background: #fafbf5; color: var(--text-muted); font-size: 0.66rem; }
.preview-result { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 0.8rem; padding: 0.9rem; border: 1px solid var(--border); border-radius: 0.85rem; background: #fff; }
.profile-photo { display: grid; place-items: center; width: 3.5rem; height: 3.5rem; border-radius: 1rem; background: linear-gradient(145deg, #dbe8d4, #f1e9d3); color: #657155; font: 600 0.8rem var(--serif); }
.preview-result h2 { margin: 0.08rem 0 0.22rem; font-size: 1rem; letter-spacing: -0.02em; }
.preview-result p { margin: 0; color: var(--text-muted); font-size: 0.68rem; line-height: 1.4; }
.preview-result .result-label { color: var(--accent-strong); font-size: 0.6rem; font-weight: 750; letter-spacing: 0.04em; text-transform: uppercase; }
.match-score { align-self: start; padding: 0.3rem 0.5rem; border-radius: 99px; background: #eef5dd; color: #536900; font-size: 0.61rem; font-weight: 700; }
.preview-slots { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.7rem; padding: 0.7rem 0.85rem; border-radius: 0.75rem; background: #f6f7ef; }
.preview-slots p { margin: 0 auto 0 0; color: var(--text-muted); font-size: 0.65rem; }
.preview-slots span { padding: 0.3rem 0.5rem; border: 1px solid var(--border); border-radius: 0.5rem; background: white; font-size: 0.62rem; }
.preview-slots a { font-size: 0.65rem; font-weight: 700; text-decoration: none; }
.preview-note { position: absolute; right: -4.2rem; bottom: 1.9rem; display: flex; gap: 0.55rem; width: 15.5rem; padding: 0.7rem; border: 1px solid var(--border); border-radius: 0.8rem; background: rgba(255,255,252,0.96); box-shadow: var(--shadow); }
.preview-note > span { display: grid; place-items: center; flex: 0 0 1.5rem; height: 1.5rem; border-radius: 50%; background: var(--accent-soft); color: var(--accent-strong); font-size: 0.7rem; font-weight: 800; }
.preview-note p { margin: 0; color: var(--text-muted); font-size: 0.63rem; line-height: 1.45; }
.preview-note strong { color: var(--text); }

.trust-strip { display: grid; grid-template-columns: repeat(4, 1fr); padding: 1.15rem clamp(1rem, 4vw, 3rem); border: 1px solid var(--border); border-top: 0; border-radius: 0 0 1.5rem 1.5rem; background: #f6f7ed; }
.trust-strip p { margin: 0; padding: 0.2rem 1rem; border-right: 1px solid var(--border-strong); font-size: 0.72rem; line-height: 1.4; }
.trust-strip p:last-child { border-right: 0; }
.trust-strip strong, .trust-strip span { display: block; }
.trust-strip strong { color: var(--text); font-size: 0.7rem; }
.trust-strip span { margin-top: 0.15rem; color: var(--text-muted); font-size: 0.61rem; }

.home-section { margin-top: clamp(5rem, 10vw, 8rem); }
.section-heading { max-width: 34rem; }
.section-heading.centered { margin-inline: auto; text-align: center; }
.section-heading h2, .assistant-copy h2, .safety-copy h2 { font-size: clamp(2.2rem, 4vw, 4rem); line-height: 1.02; letter-spacing: -0.045em; }
.section-heading > p:last-child, .assistant-copy > p, .safety-copy > p { color: var(--text-muted); line-height: 1.7; }
.kicker { margin-bottom: 0.85rem; }
.value-section { display: grid; grid-template-columns: 0.85fr 1.15fr; gap: clamp(3rem, 8vw, 8rem); align-items: start; }
.value-list { display: grid; }
.value-list article { display: grid; grid-template-columns: auto 1fr; gap: 1rem; padding: 1.7rem 0; border-bottom: 1px solid var(--border); }
.value-list article:first-child { padding-top: 0; }
.feature-icon { display: grid; place-items: center; width: 2.6rem; height: 2.6rem; border: 1px solid var(--border-strong); border-radius: 0.75rem; background: var(--accent-soft); color: var(--accent-strong); font-size: 0.67rem; font-weight: 800; }
.value-list h3 { margin: 0 0 0.5rem; font-size: 1.18rem; }
.value-list p { margin: 0; color: var(--text-muted); font-size: 0.88rem; line-height: 1.65; }

.steps-section { padding: clamp(3rem, 7vw, 5.5rem); border: 1px solid var(--border); border-radius: 1.5rem; background: #f6f7ef; }
.steps-section .section-heading { max-width: 40rem; }
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin: 3rem 0 2.5rem; padding: 0; list-style: none; background: var(--border-strong); }
.steps li { position: relative; margin: 0; padding: 1.75rem; background: #f6f7ef; }
.steps li > span { display: grid; place-items: center; width: 2rem; height: 2rem; margin-bottom: 2.8rem; border: 1px solid var(--border-strong); border-radius: 50%; background: #fff; color: var(--accent-strong); font-size: 0.72rem; font-weight: 800; }
.steps h3 { margin: 0 0 0.6rem; font-size: 1.2rem; }
.steps p { margin: 0; color: var(--text-muted); font-size: 0.83rem; line-height: 1.6; }
.section-action { margin: 0; text-align: center; }

.assistant-section { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(3rem, 8vw, 7rem); align-items: center; }
.chat-window { overflow: hidden; border: 1px solid #d7d9d2; border-radius: 1.3rem; background: #fff; box-shadow: 0 24px 70px rgba(50, 55, 45, 0.13); }
.chat-topbar { display: flex; align-items: center; gap: 0.55rem; padding: 0.8rem 1rem; border-bottom: 1px solid #e5e6e1; color: #30332d; font-size: 0.74rem; }
.chatgpt-mark { display: grid; place-items: center; width: 1.55rem; height: 1.55rem; border-radius: 50%; background: #282b27; color: #fff; font-size: 0.65rem; }
.chat-demo-label { margin-left: auto; color: #858981; font-size: 0.61rem; }
.chat-thread { padding: clamp(1rem, 3vw, 1.5rem); background: #fbfbfa; }
.chat-user { width: fit-content; max-width: 78%; margin: 0 0 1.1rem auto; padding: 0.68rem 0.85rem; border-radius: 1rem 1rem 0.3rem 1rem; background: #ecece9; color: #373a34; font-size: 0.72rem; line-height: 1.5; }
.chat-assistant { display: flex; align-items: flex-start; gap: 0.65rem; margin-bottom: 0.8rem; }
.chat-assistant .chatgpt-mark { flex: 0 0 1.55rem; }
.chat-assistant p { margin: 0.12rem 0 0; color: #444740; font-size: 0.7rem; line-height: 1.5; }
.chat-widget { margin-left: 2.2rem; overflow: hidden; border: 1px solid #dbddd5; border-radius: 0.9rem; background: #fff; box-shadow: 0 6px 18px rgba(50,55,45,0.055); }
.chat-widget-head { display: flex; align-items: center; gap: 0.55rem; padding: 0.65rem 0.75rem; border-bottom: 1px solid #e5e6df; }
.chat-widget-head .preview-mark { width: 1.75rem; height: 1.75rem; }
.chat-widget-head > div { display: grid; }
.chat-widget-head strong { color: #30352a; font-size: 0.68rem; }
.chat-widget-head small { color: #858a7f; font-size: 0.57rem; }
.chat-profile { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 0.65rem; margin: 0.7rem; padding: 0.7rem; border: 1px solid #e3e5dc; border-radius: 0.7rem; background: #fdfefa; }
.chat-profile .profile-photo { width: 2.8rem; height: 2.8rem; border-radius: 0.75rem; }
.chat-profile > div { display: grid; gap: 0.12rem; }
.chat-profile strong { color: #353a2f; font: 600 0.72rem/1.3 var(--serif); }
.chat-profile small { color: #74796e; font-size: 0.57rem; }
.verified-dot { color: var(--accent-strong); font-size: 0.52rem; font-weight: 750; text-transform: uppercase; letter-spacing: 0.04em; }
.chat-reason { display: flex; gap: 0.5rem; margin: 0 0.7rem 0.7rem; padding: 0.55rem 0.65rem; border-radius: 0.6rem; background: var(--accent-soft); }
.chat-reason > span { display: grid; place-items: center; flex: 0 0 1.25rem; height: 1.25rem; border-radius: 50%; background: #fff; color: var(--accent-strong); font-size: 0.6rem; font-weight: 800; }
.chat-reason p { margin: 0; color: #68705d; font-size: 0.57rem; line-height: 1.45; }
.chat-reason strong { color: #424936; }
.chat-widget-actions { display: flex; justify-content: flex-end; gap: 0.45rem; padding: 0.65rem 0.7rem; border-top: 1px solid #e5e6df; }
.chat-widget-actions span { padding: 0.38rem 0.58rem; border: 1px solid #d7dacd; border-radius: 99px; color: #5f6b29; font-size: 0.56rem; font-weight: 700; }
.chat-widget-actions span:last-child { border-color: var(--accent-strong); background: var(--accent-strong); color: #fff; }
.chat-caption { margin: 0.7rem 0 0 2.2rem; color: #7f837a; font-size: 0.58rem; line-height: 1.5; }
.assistant-copy { max-width: 33rem; }
.chat-steps { display: grid; gap: 0.7rem; margin: 1.3rem 0; padding: 0; list-style: none; }
.chat-steps li { display: grid; grid-template-columns: auto 1fr; align-items: start; gap: 0.65rem; margin: 0; }
.chat-steps li > span { display: grid; place-items: center; width: 1.45rem; height: 1.45rem; border-radius: 50%; background: var(--accent-soft); color: var(--accent-strong); font-size: 0.62rem; font-weight: 800; }
.chat-steps p { display: grid; margin: 0; color: var(--text); font-size: 0.79rem; line-height: 1.35; }
.chat-steps small { margin-top: 0.15rem; color: var(--text-muted); font-size: 0.7rem; line-height: 1.45; }
.launch-note { padding: 0.75rem 0.85rem; border: 1px solid var(--border); border-radius: 0.7rem; background: #f7f8f1; color: var(--text-muted); font-size: 0.7rem; line-height: 1.5; }
.launch-note > span { display: inline-block; width: 0.48rem; height: 0.48rem; margin-right: 0.4rem; border-radius: 50%; background: #d99b35; }
.launch-note strong { color: var(--text); }
.assistant-copy > a, .safety-copy > a { font-size: 0.82rem; font-weight: 750; text-decoration: none; }

.for-you-section .section-heading { max-width: 45rem; }
.audience-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-top: 2.5rem; }
.audience-grid article { overflow: hidden; padding: 0 1.25rem 1.5rem; border: 1px solid var(--border); border-radius: 1rem; background: #fff; box-shadow: var(--shadow-sm); }
.audience-art { display: block; width: calc(100% + 2.5rem); max-width: none; height: 11rem; margin: 0 -1.25rem 1.4rem; border-bottom: 1px solid var(--border); object-fit: cover; background: #f3f5ea; }
.audience-art-first { object-position: 50% 48%; }
.audience-art-choice { object-position: 50% 43%; }
.audience-art-transparency { object-position: 50% 44%; }
.audience-grid h3 { margin: 0 0 0.6rem; font-size: 1.08rem; }
.audience-grid p { margin: 0; color: var(--text-muted); font-size: 0.8rem; line-height: 1.6; }

.safety-section { display: grid; grid-template-columns: 0.85fr 1.15fr; gap: clamp(3rem, 8vw, 8rem); padding: clamp(3rem, 7vw, 5rem); border-radius: 1.5rem; background: #eef1e5; }
.safety-copy { align-self: center; }
.safety-list { display: grid; }
.safety-list article { display: grid; grid-template-columns: auto 1fr; gap: 0.8rem; padding: 1.35rem 0; border-bottom: 1px solid var(--border-strong); }
.safety-list article:last-child { border-bottom: 0; }
.safety-list article > span { display: grid; place-items: center; width: 1.8rem; height: 1.8rem; border: 1px solid var(--border-strong); border-radius: 50%; color: var(--accent-strong); background: rgba(255,255,255,0.45); font-size: 0.7rem; font-weight: 800; }
.safety-list h3 { margin: 0 0 0.35rem; font-size: 1rem; }
.safety-list p { margin: 0; color: var(--text-muted); font-size: 0.79rem; line-height: 1.55; }

.home-cta { display: grid; grid-template-columns: 1.25fr 0.75fr; gap: 2rem; align-items: center; margin-top: clamp(5rem, 10vw, 8rem); padding: clamp(2.5rem, 6vw, 4.5rem); border: 1px solid #dce3b2; border-radius: 1.5rem; background: radial-gradient(circle at 70% 50%, rgba(227,237,116,0.62), transparent 22rem), linear-gradient(120deg, #eef2dc, #f7f7e4); }
.home-cta h2 { max-width: 18ch; margin: 0; font-size: clamp(2rem, 4vw, 3.7rem); line-height: 1.04; letter-spacing: -0.045em; }
.home-cta > div:last-child { display: grid; justify-items: start; gap: 0.9rem; }
.home-cta > div:last-child > a:last-child { font-size: 0.76rem; }
.crisis-inline { display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; margin: 1rem 0 0; padding: 0.85rem 1rem; color: var(--text-muted); font-size: 0.7rem; }
.crisis-inline p { margin: 0; }
.crisis-inline a { flex: none; font-weight: 700; }

@media (max-width: 64rem) {
  .desktop-nav, .header-cta { display: none; }
  .mobile-nav { display: block; }
  .mobile-nav summary { cursor: pointer; list-style: none; padding: 0.48rem 0.8rem; border: 1px solid var(--border-strong); border-radius: 999px; color: var(--text); font-size: 0.78rem; font-weight: 700; }
  .mobile-nav summary::-webkit-details-marker { display: none; }
  .mobile-nav[open] summary { background: var(--accent-soft); }
  .mobile-nav nav { position: absolute; z-index: 30; right: 0; top: calc(100% + 0.55rem); width: min(18rem, calc(100vw - 2rem)); padding: 0.65rem; border: 1px solid var(--border); border-radius: 0.9rem; background: #fff; box-shadow: var(--shadow); }
  .mobile-nav ul { display: grid; margin: 0; padding: 0; list-style: none; }
  .mobile-nav li { margin: 0; }
  .mobile-nav a { display: block; padding: 0.65rem 0.75rem; border-radius: 0.55rem; color: var(--text); font-size: 0.82rem; text-decoration: none; }
  .mobile-nav a:hover, .mobile-nav a[aria-current="page"] { background: var(--accent-soft); color: var(--accent-strong); }
  .preview-note { right: -1rem; }
  .value-section, .assistant-section, .safety-section { grid-template-columns: 1fr; gap: 2.5rem; }
  .section-heading, .assistant-copy { max-width: 42rem; }
  .process-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .crisis-hero { grid-template-columns: 1fr; }
  .emergency-panel { width: min(100%, 32rem); }
}

@media (max-width: 45rem) {
  header.site { position: sticky; }
  header.site .wrap { min-height: 4.1rem; padding-block: 0.5rem; }
  .brand { font-size: 0.94rem; }
  .brand img { width: 1.8rem; height: 1.8rem; }
  main { padding-block: 1rem 3.5rem; }
  .hero { min-height: 30rem; border-radius: var(--radius); padding-inline: var(--space-6); }
  .hero h1 { font-size: clamp(2.25rem, 10vw, 3rem); }
  .btn { width: 100%; }
  .card:hover { transform: none; }
  .home-hero { min-height: 42rem; padding: 3.25rem 1rem 0; border-radius: 1rem 1rem 0 0; }
  .home-hero h1 { max-width: 12ch; font-size: clamp(2.6rem, 12vw, 3.65rem); }
  .home-hero .lead { font-size: 0.93rem; line-height: 1.65; }
  .hero-actions { width: 100%; }
  .hero-assurances { gap: 0.35rem 0.8rem; font-size: 0.67rem; }
  .finder-preview { width: calc(100% + 0.5rem); margin-top: 2rem; padding: 0.7rem; border-radius: 1rem 1rem 0 0; }
  .preview-toolbar > span:nth-child(2) { max-width: 10rem; }
  .preview-filters { overflow-x: auto; }
  .preview-filters span { flex: none; }
  .preview-result { grid-template-columns: auto 1fr; }
  .match-score { display: none; }
  .profile-photo { width: 3rem; height: 3rem; }
  .preview-result h2 { font-size: 0.86rem; }
  .preview-slots { display: grid; grid-template-columns: repeat(2, 1fr); }
  .preview-slots p, .preview-slots a { grid-column: 1 / -1; }
  .preview-note { display: none; }
  .trust-strip { grid-template-columns: repeat(2, 1fr); padding: 0.65rem; border-radius: 0 0 1rem 1rem; }
  .trust-strip p { padding: 0.65rem; }
  .trust-strip p:nth-child(2) { border-right: 0; }
  .trust-strip p:nth-child(-n+2) { border-bottom: 1px solid var(--border); }
  .home-section { margin-top: 4.5rem; }
  .section-heading h2, .assistant-copy h2, .safety-copy h2 { font-size: 2.45rem; }
  .value-list article { padding: 1.35rem 0; }
  .steps-section { padding: 2.5rem 1rem; border-radius: 1rem; }
  .steps { grid-template-columns: 1fr; margin-top: 2rem; }
  .steps li { display: grid; grid-template-columns: auto 1fr; column-gap: 0.85rem; padding: 1.2rem 0.85rem; }
  .steps li > span { grid-row: 1 / 3; margin: 0; }
  .steps h3 { margin-top: 0.25rem; }
  .steps p { grid-column: 2; }
  .chat-window { border-radius: 1rem; }
  .chat-thread { padding: 0.8rem; }
  .chat-widget { margin-left: 0; }
  .chat-caption { margin-left: 0; }
  .audience-grid { grid-template-columns: 1fr; }
  .audience-art { height: clamp(10rem, 48vw, 13rem); }
  .safety-section { padding: 2.5rem 1.25rem; border-radius: 1rem; }
  .home-cta { grid-template-columns: 1fr; padding: 2.5rem 1.25rem; border-radius: 1rem; }
  .home-cta > div:last-child { justify-items: stretch; }
  .home-cta > div:last-child > a:last-child { text-align: center; }
  .crisis-inline { display: grid; padding-inline: 0.25rem; }
  .crisis-inline a { justify-self: start; }
  .subpage { gap: 4rem; }
  .subpage-hero, .document-hero, .crisis-hero { min-height: 0; padding: 3rem 1.25rem; border-radius: 1rem; }
  .subpage-hero h1, .crisis-hero h1, .document-hero h1 { font-size: clamp(2.45rem, 12vw, 3.4rem); }
  .process-grid, .principles-panel, .info-card-grid, .data-panel, .resource-grid { grid-template-columns: 1fr; }
  .process-grid li { min-height: 0; padding: 1.5rem; }
  .process-grid li::before { margin-bottom: 2rem; }
  .principles-panel article { padding: 2rem 1.25rem; }
  .principles-panel article + article { border-top: 1px solid var(--border-strong); border-left: 0; }
  .info-card { min-height: 0; padding: 2rem 1.25rem; }
  .info-index { margin-bottom: 2rem; }
  .data-panel { gap: 2rem; padding: 2.5rem 1.25rem; border-radius: 1rem; }
  .contact-panel { padding: 2.5rem 1.25rem; }
  .emergency-panel { padding: 2rem 1.25rem; }
  .resource-card { min-height: 0; padding: 1.5rem 1.25rem; }
  .minor-resources { margin-inline: -0.25rem; padding: 2.5rem 0.75rem; border-radius: 1rem; }
  .document-content section { padding-block: 2.5rem; }
  .directory-page { gap: 3rem; }
  .directory-hero, .signup-intro { padding: 3rem 1.25rem; border-radius: 1rem; }
  .directory-hero h1, .signup-intro h1 { font-size: clamp(2.45rem, 12vw, 3.4rem); }
  footer.site .wrap { grid-template-columns: 1fr; gap: 2.5rem; }
  .footer-links { max-width: 24rem; }
  .footer-legal { display: grid; gap: 0.8rem; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
`;
