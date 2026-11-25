// The fonts-ready gate: nothing is measured or painted to a canvas until the web fonts have loaded.

/**
 * Every face the client draws with, as CSS font shorthands: the weights and styles the app imports (app/main.ts's
 * `@fontsource` imports; a test holds the two lists equal). `document.fonts.ready` alone waits only for faces the page
 * has already used, so a face first used by a canvas measure or paint (the hand labels' Barlow Condensed 700, the
 * painters' faces) would be measured in a fallback: each is loaded by name.
 */
export const FONT_FACES: readonly string[] = [
  '400 16px "Barlow"',
  '500 16px "Barlow"',
  '600 16px "Barlow"',
  '700 16px "Barlow"',
  '500 16px "Barlow Condensed"',
  '600 16px "Barlow Condensed"',
  '700 16px "Barlow Condensed"',
  '400 16px "IM Fell English"',
  'italic 400 16px "IM Fell English"',
];

/** Resolves once every face the client uses has loaded or failed (immediately where there is no document). */
export async function fontsReady(): Promise<void> {
  const fonts = globalThis.document?.fonts;
  if (!fonts) return;
  await Promise.allSettled(FONT_FACES.map((f) => fonts.load(f)));
  await fonts.ready;
}
