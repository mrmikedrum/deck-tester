// The chrome's surfaces: parchment sheets, bronze plaques, card stock in the hand, mana pips in text. These are the old
// common.css and live.css values the theme's tokens do not carry yet; they are generated here as custom properties
// (the stylesheet, chrome.css, spells no colour of its own), from the theme's tokens wherever a token exists. When a
// second theme needs them to vary they move into theme/tokens.ts.
import { GLYPH, PIP, colour, signal } from "../../theme";
import type { ManaKey } from "../../theme";
import bronze from "../../theme/grimoire/tex/bronze.jpg";
import parchment from "./parchment-ui.jpg";

/** The parchment's own tone under its texture, and the quiet sheet's wash. */
const PAPER = "#e3d3ab";
const PAPER_WASH = "rgba(240,228,198,.55)";

/** HTML pips are paler than the card faces' (live.css `.pip-*`), so they hold on parchment beside ink. */
const PIP_FILL: Readonly<Record<ManaKey, string>> = {
  W: "#f3edd2",
  U: "#8fc1ec",
  B: "#a99bb3",
  R: "#ec9a83",
  G: "#88c99a",
  C: "#cfd3d9",
};

const svg = (d: string, fill: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='${fill}' fill-rule='evenodd' d='${d}'/></svg>`,
  )}")`;

/** Bronze corner mounts, the ones the pages wear, for sheets laid over the table (common.css `--mount-*`). */
function mount(transform: string): string {
  const s =
    `<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30' viewBox='0 0 30 30'><defs><linearGradient id='g' ` +
    `x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#d2ac68'/><stop offset='.5' stop-color='${colour.bronze}'/>` +
    `<stop offset='1' stop-color='#4a3216'/></linearGradient></defs><g transform='${transform}'><path ` +
    `d='M1 1H29L23 7H7V23L1 29Z' fill='url(#g)' stroke='#2a1a08' stroke-width='1.2'/><circle cx='5' cy='5' r='1.8' ` +
    `fill='#1a1008'/><circle cx='4.6' cy='4.6' r='.7' fill='#ffdca0' opacity='.6'/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
}

/** Every surface as a custom property: name, value. */
export function surfaces(): readonly (readonly [string, string])[] {
  const pips = (Object.keys(GLYPH) as ManaKey[]).flatMap((k) => [
    [`--pip-${k.toLowerCase()}`, `${svg(GLYPH[k], PIP[k][1])} center / 80% no-repeat, ${PIP_FILL[k]}`] as const,
  ]);
  return [
    ["--parchment", `url("${parchment}")`],
    ["--bronze", `url("${bronze}")`],
    // A parchment sheet, and a quieter one for writing areas.
    ["--sheet", `var(--parchment) center / 420px, ${PAPER}`],
    ["--sheet-quiet", `linear-gradient(${PAPER_WASH}, ${PAPER_WASH}), var(--parchment) center / 420px, ${PAPER}`],
    [
      "--sheet-shadow",
      "inset 0 0 0 1px rgba(255,245,220,.55), inset 0 0 60px rgba(90,60,20,.35), 0 3px 0 #8a7050, 0 18px 40px rgba(0,0,0,.65)",
    ],
    ["--sheet-rule", "rgba(60,40,15,.4)"],
    ["--sheet-rule-strong", "rgba(60,40,15,.5)"],
    // A bronze plaque.
    [
      "--plaque",
      `linear-gradient(180deg, rgba(255,235,190,.28), rgba(255,255,255,0) 45%, rgba(0,0,0,.35)), var(--bronze) center / 300px, ${colour.bronze}`,
    ],
    ["--plaque-shadow", "inset 0 0 0 1.5px rgba(30,18,6,.9), inset 0 0 0 4px rgba(255,230,180,.18), 0 2px 0 #2a1a08, 0 8px 18px rgba(0,0,0,.6)"],
    [
      "--mounts",
      [
        `${mount("")} left top / calc(30 * var(--u)) no-repeat`,
        `${mount("translate(30 0) scale(-1 1)")} right top / calc(30 * var(--u)) no-repeat`,
        `${mount("translate(0 30) scale(1 -1)")} left bottom / calc(30 * var(--u)) no-repeat`,
        `${mount("translate(30 30) scale(-1 -1)")} right bottom / calc(30 * var(--u)) no-repeat`,
      ].join(", "),
    ],
    // The prompt's rings: the option ember when it asks, blood when something is aimed at me.
    ["--ring-ask", `0 0 0 2px color-mix(in srgb, ${signal.option} 90%, transparent), 0 0 34px color-mix(in srgb, ${signal.option} 55%, transparent)`],
    ["--ring-threat", `0 0 0 2px color-mix(in srgb, ${signal.danger} 85%, transparent), 0 0 34px color-mix(in srgb, ${signal.danger} 50%, transparent)`],
    ["--threat-glow", `radial-gradient(ellipse at 50% 120%, color-mix(in srgb, ${signal.dangerInk} 35%, transparent), transparent 60%)`],
    // Buttons, three tiers (live.css): secondary is a bronze rim round a flat bronze inset carrying the ink label.
    ["--btn-inset", "linear-gradient(180deg, #c09a5e, #a17d47) center / calc(100% - 8px) calc(100% - 8px) no-repeat"],
    ["--btn-ink", "#140b03"],
    ["--btn-ink-lift", "0 1px 0 rgba(255,238,200,.5)"],
    // Primary (the answer): bronze with an ember lit in it, cream text.
    ["--btn-act", "linear-gradient(180deg, rgba(255,150,60,.3), rgba(110,35,0,.4) 55%, rgba(20,6,0,.6)), var(--bronze) center / 300px, #4a2a10"],
    ["--btn-act-glow", "inset 0 0 16px rgba(255,120,30,.5), 0 0 16px rgba(255,140,40,.3)"],
    ["--btn-act-ink", "#fff4dc"],
    ["--btn-act-ink-shadow", "0 1px 1px rgba(20,6,0,.95), 0 0 8px rgba(40,12,0,.8)"],
    // Tertiary (letting Forge decide): an ink-ruled pill in the parchment's own tone.
    ["--btn-ghost", "#e6d6ae"],
    ["--btn-ghost-hover", "#ecdfbc"],
    ["--btn-ghost-rule", "inset 0 0 0 1px rgba(40,25,8,.6), inset 0 0 0 3px rgba(120,85,40,.12)"],
    // A row to choose in a sheet: a slip of lighter parchment ruled in ink; picked, gold leaf.
    ["--opt-paper", "rgba(255,248,228,.42)"],
    ["--opt-shadow", `inset 3px 0 0 ${signal.option}, inset 0 0 0 1px rgba(255,250,230,.45), inset 0 0 14px rgba(120,80,30,.12), 0 1px 0 rgba(60,40,15,.3)`],
    ["--opt-on", "linear-gradient(180deg, #ffe39a, #e8c25a)"],
    ["--opt-on-rule", "#6a4a10"],
    ["--opt-on-shadow", `inset 0 0 0 1px rgba(255,255,255,.6), 0 0 16px color-mix(in srgb, ${signal.selected} 60%, transparent)`],
    ["--opt-read-shadow", "inset 0 0 0 1px rgba(255,250,230,.45), inset 0 0 14px rgba(120,80,30,.12)"],
    ["--scrim", "rgba(8,5,3,.6)"],
    // The hand's "View hand" slip, ruled in ember; the menu's fields, light stock.
    ["--hand-view-rule", "#c67b37"],
    ["--field-ground", "#f8f3e8"],
    ["--scrim-deep", "rgba(8,5,3,.72)"],
    // The close stud set into a sheet.
    ["--stud", "radial-gradient(circle at 36% 30%, #f3d9a2, #b08a4a 40%, #6a4a20 80%, #3a240c)"],
    ["--stud-shadow", "0 0 0 1.5px #2a1a08, inset 0 -2px 3px rgba(0,0,0,.35), 0 2px 5px rgba(0,0,0,.45)"],
    ["--stud-ink", "#2a1606"],
    // The hand: card stock with an inked edge; a playable card's edge lit by embers.
    ["--card-stock-edge", "#4d3825"],
    ["--card-shadow", "-4px 2px 14px rgba(0,0,0,.55)"],
    ["--card-lifted-shadow", "0 18px 40px rgba(0,0,0,.7)"],
    ["--card-art-ground", "#302419"],
    ["--card-art-rule", "rgba(44,30,16,.65)"],
    [
      "--card-playable",
      `0 0 0 2px color-mix(in srgb, ${signal.option} 95%, transparent), 0 0 28px rgba(255,120,30,.75), 0 0 8px rgba(255,170,80,.6), -4px 2px 14px rgba(0,0,0,.55)`,
    ],
    // A bunched hand card's cost ribbon: vellum, lifted off the card under it.
    ["--ribbon-shadow", "inset 0 0 0 1px rgba(40,25,8,.55), 0 1px 3px rgba(0,0,0,.45)"],
    ["--card-drawn", "0 0 0 2px rgba(247,225,171,.9), 0 0 24px 4px rgba(226,193,132,.6)"],
    ["--peek-ground", "#111"],
    ["--peek-shadow", "0 20px 50px rgba(0,0,0,.7)"],
    ["--toast-ink", "#fff"],
    ["--toast-shadow", "0 10px 26px rgba(0,0,0,.5)"],
    // The log strip: aged parchment a shade darker than the sheets, in ink; the log's rules; the loss notice's wash.
    ["--log-paper", "#c2a676"],
    ["--log-wash", "linear-gradient(rgba(120,82,38,.34), rgba(96,64,28,.42))"],
    ["--log-shadow", "inset 0 0 28px rgba(70,42,12,.35), 0 3px 8px rgba(0,0,0,.3)"],
    ["--log-ink", "#3a2c1c"],
    ["--log-ink-soft", "#493820"],
    ["--log-draw-rule", "#765024"],
    ["--log-rule", "rgba(22,18,14,.1)"],
    ["--recap-wash", `color-mix(in srgb, ${signal.dangerInk} 12%, transparent)`],
    ["--recap-close-ink", "#6a4b39"],
    // The stack summary in the prompt: ruled rows, the next to resolve on lighter paper with a bronze edge.
    ["--stackinfo-rule-strong", "rgba(60,40,15,.35)"],
    ["--stackinfo-rule", "rgba(60,40,15,.2)"],
    ["--stackinfo-next", "rgba(255,248,228,.46)"],
    ["--stackinfo-next-edge", "#905c28"],
    // The prompt's buttons while the table moves (live.css `.l-prompt.moving`).
    ["--moving-rule", "inset 0 0 0 1px rgba(60,40,15,.4)"],
    ["--pip-ground", "#c9ccd2"],
    ["--pip-n", PIP_FILL.C],
    ["--pip-shadow", "0 1px 0 rgba(0,0,0,.45)"],
    ["--pip-ink", "#14161a"],
    ["--pip-tap", "#e6e2d6"],
    ["--pip-hybrid", `linear-gradient(135deg, ${PIP_FILL.W} 50%, ${PIP_FILL.U} 50%)`],
    ...pips,
  ];
}

/** Adds the surfaces to a document's head (once: the style element has a fixed id). They are declared on the chrome's
 * root, not :root, because some are sized in --u, which the renderer sets there. */
export function installSurfaces(doc: Document): void {
  let el = doc.getElementById("chrome-surfaces");
  if (!el) {
    el = doc.createElement("style");
    el.id = "chrome-surfaces";
    doc.head.append(el);
  }
  el.textContent = `.dm-chrome {\n${surfaces()
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n")}\n}\n`;
}
