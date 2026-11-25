// Mana symbols in text (live.js `pips`): "{2}{U}" as pips. The letter stays in the markup for reading aloud; coloured
// pips show their glyph instead (chrome.css).
import type { JSX } from "preact";

const CLASS: Readonly<Record<string, string>> = { W: "w", U: "u", B: "b", R: "r", G: "g", C: "c", S: "n", X: "n", T: "t", Q: "t" };

function pipClass(k: string): string {
  if (/^\d+$/.test(k)) return "n";
  return CLASS[k] ?? (k.includes("/") ? "h" : "n");
}

const glyph = (k: string): string => (k === "T" ? "↷" : k === "Q" ? "↶" : k.replace("/", ""));

/** Text with every braced symbol of up to five characters drawn as a pip. */
export function Pips({ text }: { readonly text: string }): JSX.Element {
  const parts: (string | JSX.Element)[] = [];
  const re = /\{([^}]{1,5})\}/g;
  let last = 0, n = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const k = (m[1] ?? "").toUpperCase();
    parts.push(
      <i key={n++} class={`pip pip-${pipClass(k)}`} aria-label={k}>
        {glyph(k)}
      </i>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
