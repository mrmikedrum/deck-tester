// The words a battle line's signs say (`lines`): a seat's muster slip, the spent heap's sign. Facts in, a player's words
// out: counted, never judged, most relevant first.
import type { Muster, NoteFacts } from "../layout";

/** Two short lines under a plaque: "26 ready · 71 power" over "none fly · biggest 5/5 · 1 deathtouch". */
export function musterWords(m: Muster): { readonly text: string; readonly sub: string | null } {
  const clauses = [
    m.fly ? `${m.fly} fly` : "none fly",
    m.biggest ? `biggest ${m.biggest[0]}/${m.biggest[1]}` : "",
    m.deathtouch ? `${m.deathtouch} deathtouch` : "",
    m.trample ? `${m.trample} trample` : "",
    m.reach ? `${m.reach} reach` : "",
    m.firstStrike ? `${m.firstStrike} first strike` : "",
  ].filter(Boolean);
  return { text: `${m.ready} ready · ${m.power} power`, sub: m.ready ? clauses.slice(0, 3).join(" · ") : null };
}

/** A sign on a page: "7 tapped · 21 power", or naming a big one, "4 tapped · Glissa 8/10". */
export function noteWords(f: NoteFacts): { readonly text: string; readonly sub: string | null } {
  if (f.kind === "spent") return { text: `${f.count} tapped · ${f.big ? `${f.big.name.split(",")[0]} ${f.big.p}/${f.big.t}` : `${f.power} power`}`, sub: null };
  return { text: `${f.gone} gone · ${f.exiled} in exile`, sub: null };
}

/** The tally at the head of the lanes, on my plaque's slip: "32 at you", and once blocks are drafted "9 through". */
export function tallyWords(at: number, through: number | null): { readonly text: string; readonly sub: string | null } {
  return { text: `${at} at you`, sub: through === null ? null : `${through} through` };
}
