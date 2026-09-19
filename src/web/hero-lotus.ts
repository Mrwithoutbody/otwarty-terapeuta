/** A lotus of light on dark water, drawn from the petal of the logo: rosettes
 * of petals round one root under the hero's bottom edge, large enough that
 * only the crown rises into the band, turning slowly like a
 * windmill. Matte pastels - sand, clay, dusty rose - rather than neon.
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
    // Round the rosette the hue runs 45° (sand) through 20° (clay) to 350° (dusty rose) and
    // back, twice a turn - a triangle wave, so the whole palette is in view at any moment.
    // Warm only: these are the illustrations' hues (30-45°) and the complement of the navy
    // ground. Sage was tried (2026-09-20) and mixed with the navy into an olive mud.
    const hue = (45 - (1 - Math.abs((angle % 180) / 90 - 1)) * 55 + 360) % 360;
    const ramp = (id: string, stops: [number, string, number][]) =>
      `<linearGradient id="${id}${i}" x1="0" y1="1" x2="0" y2="0">` +
      stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('') + '</linearGradient>';
    // Matte pastels: saturation stays under 50%, nothing is white-hot, nothing is screen-blended.
    const tone = (shift: number, light: number) => `hsl(${n((hue + shift) % 360)} 46% ${light}%)`;
    return ramp('lf', [[0, '#d9b994', 0.3], [0.3, tone(340, 64), 0.24], [0.7, tone(0, 60), 0.17], [1, tone(325, 66), 0.06]]) +
      ramp('lh', [[0, '#d9b994', 0], [0.35, tone(340, 68), 0.14], [1, tone(0, 70), 0.24]]) +
      ramp('lr', [[0, '#d9b994', 0], [0.4, tone(0, 76), 0.2], [1, tone(0, 80), 0.42]]);
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
      '<radialGradient id="lotus-heart"><stop stop-color="#d9b994" stop-opacity=".18"/>' +
      '<stop offset=".3" stop-color="#c9907c" stop-opacity=".08"/><stop offset="1" stop-color="#c9907c" stop-opacity="0"/></radialGradient>' +
      '</defs>' +
      '<ellipse rx="520" ry="400" fill="url(#lotus-heart)"/>') +
    plane(1, true) + plane(1) + plane(2);
}
