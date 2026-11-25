// The table's words for the by-relevance pages: a page's read and its folds' tags, from layout's facts. Counts and facts
// the engine sends, in a player's words, numbers first; never a verdict on the rules ("no untapped fliers", not "can't
// be blocked"). Wording lives here so it changes without touching layout.
import type { Body, ReadFacts, TagFacts } from "../layout";

const body = (b: Body): string => `${b.power}/${b.toughness}`;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** A page's read: its first line (the sum) and its second (what stands out, or what is absent). */
export function readWords(f: ReadFacts): readonly [string, string | null] {
  switch (f.q) {
    case "rest": {
      const first = f.flyingPower > 0 ? `${f.power} power · ${f.flyingPower} of it flying` : `${f.power} power · ${plural(f.creatures, "creature")}`;
      const second = [
        ...(f.flyingPower > 0 ? [plural(f.creatures, "creature")] : []),
        ...(f.biggest ? [`biggest ${body(f.biggest)}`] : []),
        ...(f.flyingPower > 0 ? [] : ["none fly"]),
        ...f.keywords.slice(0, 2),
      ];
      return [first, second.join(" · ") || null];
    }
    case "threat": {
      if (!f.creatures) return ["Nothing ready", null];
      const first = `${f.power} power ready · ${f.flyingPower > 0 ? `${f.flyingPower} of it flying` : plural(f.creatures, "creature")}`;
      const second = [...(f.flyingPower > 0 ? [] : ["none fly"]), ...f.keywords.slice(0, 2)];
      return [first, second.join(" · ") || null];
    }
    case "strike": {
      if (f.airborne) return f.fliers ? [`${plural(f.fliers, "flier")}${f.fliersBiggest ? ` · biggest ${body(f.fliersBiggest)}` : ""}`, null] : ["No fliers or reach", null];
      if (!f.untapped) return ["Nothing untapped", null];
      const big = f.biggest ? ` · biggest ${body(f.biggest)}${f.biggest.deathtouch ? " deathtouch" : ""}` : "";
      return [`${f.untapped} untapped${big}`, f.fliers ? `${f.fliers} fly or reach` : "no fliers or reach"];
    }
    case "tally":
      return [`Attacking · ${f.power} power${f.air ? ` · ${f.air} in the air` : ""}`, null];
    case "fight": {
      const first = `Attacks ${f.target === "you" ? "you" : f.target} · ${f.power} power`;
      if (f.unblocked < 0) return [first, null];
      return [`${f.unblocked} unblocked`, f.whoName && f.who ? `${f.whoName.split(",")[0]} ${body(f.who)}` : null];
    }
    case "sweep":
      return [f.mine ? `You lose ${f.loses}` : `Loses ${f.loses} · ${f.power} power`, null];
  }
}

const ANSWER = { ready: "ready", untapped: "untapped", flying: "can block fliers", legal: "targetable", lost: "lost", blockers: "can block" } as const;

/** A fold's tag: a regiment's name and body (its count is on its die), a tail's sum, a column's title; under a question,
 * its part of the answer. */
export function tagWords(t: TagFacts): string {
  switch (t.t) {
    case "regiment": {
      const name = t.name.split(",")[0]!.replace(/\s*\(.*\)$/, "");
      return t.answer ? `${t.answer.n} ${ANSWER[t.answer.word]}` : `${name} ${body(t.body)}`;
    }
    case "tail": {
      if (t.answer) return `${t.answer.n} ${ANSWER[t.answer.word]}${t.answer.biggest && t.answer.n ? ` · biggest ${body(t.answer.biggest)}` : ""}`;
      if (t.small) return `Small ${t.count} · ${t.power} power`;
      return [`${t.count} more`, `${t.power} power`, ...(t.biggest ? [`biggest ${body(t.biggest)}`] : []), ...(t.fliers ? [`${t.fliers} ${t.fliers === 1 ? "flies" : "fly"}`] : [])].join(" · ");
    }
    case "column":
      if (t.title === "shelf") return `Shelf ${t.count}${t.walkers ? ` · ${t.walkers} walker${t.walkers > 1 ? "s" : ""}` : ""}`;
      return `${t.title === "binds" ? "Binds everyone" : "Engines"} ${t.count}`;
  }
}

/** Their well's sign: what is open, over what makes it. */
export function wellWords(open: number, lands: number, rocks: number, treasures: number): readonly [string, string] {
  return [`${open} open`, [`Lands ${lands}`, ...(rocks ? [`${rocks} rock${rocks > 1 ? "s" : ""}`] : []), ...(treasures ? [`${treasures} Treasure${treasures > 1 ? "s" : ""}`] : [])].join(" · ")];
}
