/** A lotus of light on dark water, drawn from the petal of the logo: eleven
 * petals fanned from one root that sits under the hero's bottom edge, large
 * enough to leave the hero at the top and on the right.
 * The light is a prism's: it leaves the heart amber and disperses across the
 * fan - cyan and violet on the left, rose in the middle, orange and amber on the right. Depth of field does the
 * rest: only the inner row is sharp, the crown behind and two petals in front
 * are out of focus. */
export function renderHeroLotus(): string {
  const n = (value: number) => value.toFixed(1);
  // The logo's petal: pointed at both ends, widest below the middle.
  const side = (length: number, width: number) =>
    `C${n(width)} ${n(-length * 0.22)} ${n(width * 1.12)} ${n(-length * 0.68)} 0 ${n(-length)}`;
  // Three planes of one flower, each its own <svg> so CSS can blur and float it
  // on the compositor: 0 far (out of focus), 1 in focus, 2 near (a soft foreground).
  const petals = (
    [[0, 400, 100, 0], [28, 412, 102, 0], [56, 432, 100, 0], [82, 452, 84, 0],
      [14, 286, 88, 1], [42, 296, 86, 1], [66, 560, 150, 2]] as const
  )
    .flatMap(([angle, ...rest]) => (angle ? [[-angle, ...rest], [angle, ...rest]] : [[angle, ...rest]]))
    // Outermost first, so petals nearer the axis overlap their neighbours.
    .sort((a, b) => Math.abs(b[0]!) - Math.abs(a[0]!));
  const defs = petals.map(([angle], i) => {
    // -82°..82° across the fan sweeps the spectrum: 200° (cyan) through 265° and 330° to 30° (amber).
    const hue = (200 + ((angle! + 82) / 164) * 190) % 360;
    const ramp = (id: string, stops: [number, string, number][]) =>
      `<linearGradient id="${id}${i}" x1="0" y1="1" x2="0" y2="0">` +
      stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('') + '</linearGradient>';
    // Fill: a translucent wash. Halo: the saturated colour of the line. Core: the same line, white-hot.
    return ramp('lf', [[0, '#ffc98a', 0.32], [0.3, `hsl(${n((hue + 340) % 360)} 75% 66%)`, 0.22],
        [0.7, `hsl(${n(hue)} 70% 62%)`, 0.16], [1, `hsl(${n((hue + 325) % 360)} 70% 68%)`, 0.05]]) +
      ramp('lh', [[0, '#ffb45e', 0], [0.35, `hsl(${n((hue + 340) % 360)} 100% 62%)`, 0.55], [1, `hsl(${n(hue)} 100% 64%)`, 0.9]]) +
      ramp('lr', [[0, '#fff', 0], [0.4, `hsl(${n(hue)} 100% 90%)`, 0.45], [1, '#fff', 0.95]]);
  }).join('');
  // Bloom as in a rendered scene: a hairline core over a wide blurred halo of its own colour.
  // The halo is a plane of its own ('halo'), blurred in CSS and drifting in step with plane 1.
  const plane = (depth: number, halo = false, extra = '') =>
    `<svg class="lotus-plane-${depth}${halo ? ' lotus-halo' : ''}" viewBox="-500 -520 1000 540" fill="none" focusable="false">` + extra +
    petals.map(([angle, length, width, d], i) => d !== depth ? '' :
      `<g transform="rotate(${angle})"><path class="lotus-petal" ` +
      `d="M0 0${side(length!, width!)}C${n(-width! * 1.12)} ${n(-length! * 0.68)} ${n(-width!)} ${n(-length! * 0.22)} 0 0Z" ` +
      (halo ? `stroke="url(#lh${i})" stroke-width="5"` :
        `fill="url(#lf${i})"` + (depth === 2 ? '' : ` stroke="url(#${depth ? 'lr' : 'lh'}${i})" stroke-width="${depth ? 0.6 : 2.5}"`)) +
      '/></g>').join('') + '</svg>';
  return plane(0, false, '<defs>' + defs +
      '<radialGradient id="lotus-heart"><stop stop-color="#ffc47a" stop-opacity=".4"/>' +
      '<stop offset=".3" stop-color="#ff8a5c" stop-opacity=".16"/><stop offset="1" stop-color="#b45cff" stop-opacity="0"/></radialGradient>' +
      '</defs>' +
      '<ellipse rx="520" ry="400" fill="url(#lotus-heart)"/>') +
    plane(1, true) + plane(1) + plane(2);
}
