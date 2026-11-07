// The fallback for sites with no usable icon: a coloured tile with a letter.

export function letterFor(name) {
  const m = name.match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : "?";
}

// A stable colour per name, so a site keeps its colour between sessions.
export function colorFor(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return `hsl(${hash % 360} 55% 42%)`;
}
