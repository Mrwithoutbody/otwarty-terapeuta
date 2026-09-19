/** A lotus of light on dark water, drawn from the petal of the logo: rosettes
 * of petals round one root behind the hero's search card, which covers the
 * heart, turning slowly like a windmill.
 * Depth of field: only the inner rosette is sharp; the crown behind and four
 * petals in front are out of focus and turn at their own pace.
 * No colour lives here. Stops carry a class (lotus-blue, -green, -teal, -gold)
 * and the stylesheet paints them from the tokens in :root; this file holds
 * geometry and how thick the pigment lies. */
export function renderHeroLotus(): string {
  const n = (value: number) => value.toFixed(1);
  // The logo's petal: pointed at both ends, widest below the middle.
  const side = (length: number, width: number) =>
    `C${n(width)} ${n(-length * 0.22)} ${n(width * 1.12)} ${n(-length * 0.68)} 0 ${n(-length)}`;
  // Three planes of one flower, each its own <svg> so CSS can blur and turn it
  // on the compositor: 0 far (out of focus), 1 in focus, 2 near (a soft foreground).
  // Full rosettes, because the planes turn like a windmill and every petal comes round.
  // Neighbours alternate blue and green; the inner row is the teal between them. The band
  // shows only some 80° of the wheel, so a slower change of colour left it all one hue.
  const ring = (step: number, offset: number, length: number, width: number, depth: number, kinds: string[]) =>
    Array.from({ length: 360 / step }, (_, k) => [offset + k * step, length, width, depth, kinds[k % kinds.length]!] as const);
  const petals = [
    ...ring(30, 0, 430, 100, 0, ['blue', 'green']),
    ...ring(30, 15, 292, 88, 1, ['teal']),
    ...ring(90, 66, 560, 150, 2, ['green', 'blue']),
  ];
  const ramp = (id: string, kind: string, opacities: number[]) =>
    `<linearGradient id="${id}" x1="0" y1="1" x2="0" y2="0">` +
    opacities.map((a, k) => `<stop class="lotus-${kind}" offset="${n(k / (opacities.length - 1))}" stop-opacity="${a}"/>`).join('') +
    '</linearGradient>';
  // Blue lies thinner than green: at equal weight it took the band over.
  const defs = ramp('lf-green', 'green', [0.3, 0.24, 0.16, 0.06]) + ramp('lf-teal', 'teal', [0.26, 0.2, 0.13, 0.05]) +
    ramp('lf-blue', 'blue', [0.18, 0.14, 0.09, 0.03]) +
    // A soft line over a wide blurred halo of its own colour - gold, the complement, and only here.
    ramp('lh', 'gold', [0, 0.1, 0.18]) + ramp('lr', 'gold', [0, 0.18, 0.38]) +
    '<radialGradient id="lotus-heart"><stop class="lotus-gold" stop-opacity=".18"/>' +
    '<stop class="lotus-green" offset=".3" stop-opacity=".08"/><stop class="lotus-blue" offset="1" stop-opacity="0"/></radialGradient>';
  // The halo is a plane of its own, blurred in CSS and turning in step with plane 1.
  const plane = (depth: number, halo = false, extra = '') =>
    `<svg class="lotus-plane-${depth}${halo ? ' lotus-halo' : ''}" viewBox="-620 -620 1240 1240" fill="none" focusable="false">` + extra +
    petals.map(([angle, length, width, d, kind]) => d !== depth ? '' :
      `<path transform="rotate(${angle})" ` +
      `d="M0 0${side(length, width)}C${n(-width * 1.12)} ${n(-length * 0.68)} ${n(-width)} ${n(-length * 0.22)} 0 0Z" ` +
      (halo ? 'stroke="url(#lh)" stroke-width="5"' :
        `fill="url(#lf-${kind})"` + (depth === 2 ? '' : ` stroke="url(#${depth ? 'lr' : 'lh'})" stroke-width="${depth ? 0.6 : 2.5}"`)) +
      '/>').join('') + '</svg>';
  return plane(0, false, '<defs>' + defs + '</defs><ellipse rx="520" ry="400" fill="url(#lotus-heart)"/>') +
    plane(1, true) + plane(1) + plane(2);
}
