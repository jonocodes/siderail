// Whether an icon needs a light plate behind it to show up on a dark button:
// true for icons on transparency whose visible pixels are mostly near-black
// or dark grey (like a black Apple TV+ logo). Saturated colours such as
// YouTube red count as visible. Takes canvas RGBA pixel data.
export function suggestPlate(rgba) {
  let opaque = 0;
  let dark = 0;
  const pixels = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    opaque++;
    if (Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) < 80) dark++;
  }
  // Icons that mostly fill their square (rounded squares cover ~85%) bring
  // their own background.
  if (opaque === 0 || opaque / pixels > 0.75) return false;
  return dark / opaque > 0.5;
}
