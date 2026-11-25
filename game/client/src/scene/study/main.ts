// The render study (render-study.html): the turn-15 table at one card size, drawn one of four ways, for judging what
// makes the table read as real. Not part of the app. Query:
//   v=A|B|C|D           physical, illustrated, hybrid, physical with a focus moment (default A)
//   moment=rest|main|combat|spell, t=0..1   D's moment and how far into it (default rest, 1)
//   view=game|lands|creatures|target        the game's camera or a closer one (default game)
//   shadow=pcf|vsm, ssize=2048, sr=3, live=1  shadow filter, map size, softness radius; redraw shadows every frame
//   dim, lift, flat, halo                     the moment's treatment (see scene/three/study.ts)
// `window.study.measure(ms)` draws continuously for `ms` and returns the median frame interval and the median cost of a
// frame drawn and finished on the GPU.
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/im-fell-english/400.css";
import "@fontsource/im-fell-english/400-italic.css";
import { fontsReady, frame, now } from "../../platform";
import type { V3 } from "../../layout";
import { loadArt, loadAssets } from "../three";
import { buildStudy } from "../three/study";
import type { Moment, StudyParams, Variant } from "../three/study";
import { faceOf, studyBoard } from "./board";

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => {
  const v = q.get(k);
  return v === null || v === "" || Number.isNaN(Number(v)) ? d : Number(v);
};
const pick = <T extends string>(k: string, all: readonly T[], d: T): T => {
  const v = q.get(k);
  return (all as readonly string[]).includes(v ?? "") ? (v as T) : d;
};

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor(s.length / 2)] ?? 0) : 0;
};

async function main(): Promise<void> {
  await fontsReady();
  const variant = pick<Variant>("v", ["A", "B", "C", "D"], "A");
  const prm: StudyParams = {
    variant,
    moment: pick<Moment>("moment", ["rest", "main", "combat", "spell"], "rest"),
    shadow: pick("shadow", ["pcf", "vsm"] as const, "pcf"),
    shadowSize: num("ssize", 2048),
    shadowRadius: num("sr", 3),
    dim: q.has("dim") ? num("dim", 0.4) : null,
    lift: num("lift", 0.3),
    flat: num("flat", 1),
    halo: num("halo", 1),
    t: num("t", 1),
    liveShadows: q.get("live") === "1",
  };
  const board = studyBoard();
  const assets = await loadAssets();
  const urls = new Set<string>();
  for (const p of board.pieces) if (p.face.art) urls.add(p.face.art);
  const swords = faceOf({ name: "Swords to Plowshares" }, false).art;
  if (swords) urls.add(swords);
  const art = new Map<string, NonNullable<Awaited<ReturnType<typeof loadArt>>>>();
  await Promise.all(
    [...urls].map(async (u) => {
      const a = await loadArt(u);
      if (a) art.set(u, a);
    }),
  );
  const canvas = document.getElementById("stage");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("render-study.html lacks #stage");
  const w = globalThis.innerWidth,
    h = globalThis.innerHeight;
  const study = buildStudy(
    canvas,
    board,
    {
      surfaces: assets.surfaces,
      tomeNormal: assets.tomeNormal,
      art: (u) => (art.get(u) as ReturnType<Parameters<typeof buildStudy>[2]["art"]>) ?? null,
    },
    prm,
    { w, h, dpr: Math.min(2, globalThis.devicePixelRatio || 1) },
  );
  const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
  const s = board.spots;
  const views: Record<string, { eye: V3; at: V3; fov: number }> = {
    lands: { eye: add(s.lands, { x: 2.6, y: 2.4, z: 3.4 }), at: add(s.lands, { x: 0, y: 0.05, z: 0 }), fov: 30 },
    creatures: {
      eye: add(s.creatures, { x: 2.5, y: 2.6, z: 7.2 }),
      at: add(s.creatures, { x: -0.6, y: 0, z: 0 }),
      fov: 36,
    },
    target: { eye: add(s.target, { x: 0.8, y: 2.4, z: 5.2 }), at: add(s.target, { x: 0, y: 0.3, z: 0 }), fov: 32 },
  };
  study.look(views[q.get("view") ?? ""] ?? null);
  study.draw();
  // A second frame: textures uploaded and shadows drawn in the first are what a still should show.
  frame(() => {
    study.draw();
    document.documentElement.dataset["ready"] = "1";
  });
  Object.assign(globalThis, {
    study: {
      stats: () => study.stats(),
      measure: (ms: number) =>
        new Promise((resolve) => {
          const start = now();
          const gaps: number[] = [],
            costs: number[] = [];
          let last = -1;
          const tick = (at: number): void => {
            const t0 = now();
            study.drawSync();
            costs.push(now() - t0);
            if (last >= 0) gaps.push(at - last);
            last = at;
            if (now() - start < ms) frame(tick);
            else
              resolve({
                frames: costs.length,
                interval: median(gaps),
                cost: median(costs),
                // WebKit's clock is coarse (1 ms): the mean resolves what the median rounds.
                mean: costs.reduce((x, y) => x + y, 0) / Math.max(1, costs.length),
                ...study.stats(),
              });
          };
          frame(tick);
        }),
    },
  });
}

main().catch((e: unknown) => {
  document.documentElement.dataset["error"] = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
  throw e;
});
