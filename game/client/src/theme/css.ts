// Generates the CSS custom properties from the tokens, so the HTML layer and the canvas painters read one source.
// Pure: `cssVariables` returns the names and values, `cssText` the rule; `installCss` puts it in a document.
import { tokens } from "./tokens";
import type { Tokens } from "./tokens";

const kebab = (s: string): string =>
  s
    .replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())
    .replace(/(\d+)/g, "-$1")
    .replace(/-+/g, "-");

/** The custom properties for a token set, in a stable order: `--sig-option`, `--seat-near`, `--page-base`, ... */
export function cssVariables(t: Tokens = tokens): readonly (readonly [string, string])[] {
  const out: [string, string][] = [];
  const add = (name: string, value: string | number): void => {
    out.push([`--${name}`, typeof value === "number" ? String(value) : value]);
  };
  const hex = (n: number): string => "#" + n.toString(16).padStart(6, "0");
  // Colours: the old common.css names, so the chrome's stylesheet ports unchanged.
  const c = t.colour;
  add("table", c.table);
  add("panel", c.panel);
  add("line", c.line);
  add("text", c.text);
  add("muted", c.muted);
  add("ink", c.ink);
  add("ink-2", c.ink2);
  add("ink-3", c.ink3);
  add("bone", c.bone);
  add("bone-2", c.bone2);
  add("bone-3", c.bone3);
  add("bone-dim", c.boneDim);
  add("bronze-colour", c.bronze);
  add("gold", c.gold);
  add("commander", c.commander);
  add("buff", c.buff);
  add("hurt", c.hurt);
  add("card-edge", hex(c.cardEdge));
  for (const [k, v] of Object.entries(c.page)) add(`page-${kebab(k)}`, v);
  for (const [k, v] of Object.entries(c.wood)) add(`wood-${kebab(k)}`, v);
  add("sig-option", t.signal.option);
  add("sig-selected", t.signal.selected);
  add("sig-danger", t.signal.danger);
  add("sig-danger-ink", t.signal.dangerInk);
  add("sig-danger-rim", t.signal.dangerRim);
  add("sig-gilt-rim", t.signal.giltRim);
  for (const [k, v] of Object.entries(t.seat)) add(`seat-${k}`, v);
  for (const [k, v] of Object.entries(t.seatInk)) add(`seat-ink-${k}`, v);
  add("ui", t.font.ui);
  add("serif", t.font.serif);
  add("num", t.font.num);
  for (const [k, v] of Object.entries(t.space))
    add(`space-${kebab(k)}`, typeof v === "number" && k.startsWith("s") && k !== "space" ? `${v}px` : v);
  for (const [k, v] of Object.entries(t.motion))
    if (["fast", "base", "slow", "hold", "turnHandoff"].includes(k)) add(`t-${kebab(k)}`, `${v}ms`);
  for (const [k, v] of Object.entries(t.mana)) add(`mana-${k.toLowerCase()}`, v);
  return out;
}

/** The `:root` rule holding every custom property. */
export function cssText(t: Tokens = tokens): string {
  return `:root {\n${cssVariables(t)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n")}\n}\n`;
}

/** Adds the rule to a document's head (once: the style element has a fixed id). */
export function installCss(doc: Document, t: Tokens = tokens): void {
  let el = doc.getElementById("theme-tokens");
  if (!el) {
    el = doc.createElement("style");
    el.id = "theme-tokens";
    doc.head.append(el);
  }
  el.textContent = cssText(t);
}
