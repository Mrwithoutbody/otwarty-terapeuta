/** A lotus of light on dark water, drawn from the petal of the logo: rosettes
 * of petals round one root under the hero's bottom edge, large enough that
 * only the crown rises into the band, turning slowly like a
 * windmill. Matte tones of the site - its green and its navy, gold in the lines - not neon.
 * Depth of field: only the inner rosette is sharp; the crown behind and four
 * petals in front are out of focus and turn at their own pace. */
export function renderHeroLotus(): string {
  const n = (value: number) => value.toFixed(1);
  // The logo's petal: pointed at both ends, widest below the middle.
  const side = (length: number, width: number) =>
    `C${n(width)} ${n(-length * 0.22)} ${n(width * 1.12)} ${n(-length * 0.68)} 0 ${n(-length)}`;
  // Three planes of one flower, each its own <svg> so CSS can blur and turn it
  // on the compositor: 0 far (out of focus), 1 in focus, 2 near (a soft foreground).
  // Full rosettes, because the planes turn like a windmill and every petal comes round.
  const ring = (step: number, offset: number, length: number, width: number, depth: number) =>
    Array.from({ length: 360 / step }, (_, k) => [offset + k * step, length, width, depth] as const);
  const petals = [...ring(30, 0, 430, 100, 0), ...ring(30, 15, 292, 88, 1), ...ring(90, 66, 560, 150, 2)];
  const defs = petals.map(([angle], i) => {
    // The site's own two colours: the hue swings between 225° (the hero's navy, lifted) and
    // 105° (the accent green, measured 98°) every 30° of the rosette, so neighbouring petals
    // alternate and the inner row lands on the teal between them. The band shows only some
    // 80° of the wheel; a slower swing left it all blue for a minute at a time. Shifts go towards teal, never below 100°: the
    // 60-95° band over navy is the olive mud of 2026-09-20. Yellow (48°) is the complement and
    // stays in the lines and their halo only, never in a wash.
    const hue = 225 - (1 - Math.abs((angle % 60) / 30 - 1)) * 120;
    const ramp = (id: string, stops: [number, string, number][]) =>
      `<linearGradient id="${id}${i}" x1="0" y1="1" x2="0" y2="0">` +
      stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('') + '</linearGradient>';
    // Matte pastels: saturation stays under 50%, nothing is white-hot, nothing is screen-blended.
    const tone = (shift: number, light: number) => `hsl(${n((hue + shift) % 360)} 46% ${light}%)`;
    const gold = (light: number) => `hsl(48 62% ${light}%)`;
    return ramp('lf', [[0, gold(70), 0.3], [0.3, tone(15, 58), 0.24], [0.7, tone(0, 54), 0.17], [1, tone(25, 60), 0.06]]) +
      ramp('lh', [[0, gold(70), 0], [0.35, gold(68), 0.1], [1, gold(72), 0.18]]) +
      ramp('lr', [[0, gold(70), 0], [0.4, gold(74), 0.18], [1, gold(80), 0.38]]);
  }).join('');
  // A soft line over a wide blurred halo of its own colour.
  const plane = (depth: number, halo = false, extra = '') =>
    `<svg class="lotus-plane-${depth}${halo ? ' lotus-halo' : ''}" viewBox="-620 -620 1240 1240" fill="none" focusable="false">` + extra +
    petals.map(([angle, length, width, d], i) => d !== depth ? '' :
      `<g transform="rotate(${angle})"><path class="lotus-petal" ` +
      `d="M0 0${side(length!, width!)}C${n(-width! * 1.12)} ${n(-length! * 0.68)} ${n(-width!)} ${n(-length! * 0.22)} 0 0Z" ` +
      (halo ? `stroke="url(#lh${i})" stroke-width="5"` :
        `fill="url(#lf${i})"` + (depth === 2 ? '' : ` stroke="url(#${depth ? 'lr' : 'lh'}${i})" stroke-width="${depth ? 0.6 : 2.5}"`)) +
      '/></g>').join('') + '</svg>';
  return plane(0, false, '<defs>' + defs +
      '<radialGradient id="lotus-heart"><stop stop-color="#e2cf86" stop-opacity=".18"/>' +
      '<stop offset=".3" stop-color="#8fbf86" stop-opacity=".08"/><stop offset="1" stop-color="#5f78b8" stop-opacity="0"/></radialGradient>' +
      '</defs>' +
      '<ellipse rx="520" ry="400" fill="url(#lotus-heart)"/>') +
    plane(1, true) + plane(1) + plane(2);
}
