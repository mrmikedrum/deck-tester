// The render bench (`workbench.html?only=render`): the real scene drawing the design pass's turn-15 table, timed in this
// browser: at rest, in a highlight (the stack's look: cards stepped out of the light over the scrim) and while cards
// fly (a creature to the graveyard and back, its flight redrawing the shadow map). Each frame is drawn and finished on
// the GPU (one pixel read back), so its cost is the whole frame's, CPU and GPU. It is how the table's cost is measured
// on the iPad: open it there, wait for "Done" and press "Send to Mac" (POST api/bench, as the planTable bench does, kept
// under .deckmaster/bench/); over plain http there is no clipboard, so the results also sit in a box to select by hand.
// Then the table at rest again under each post-processing setting on its own (the composer's pixel ratio at 1.0 and 1.5,
// bloom off, MSAA off, all three), so a run on the iPad shows what dominates its frame.
import { decodeCatalog, diff, modelOf, playerViewer } from "../../model";
import type { CardCatalog, ChangeSet, TableModel } from "../../model";
import { planTable, tableInputOf } from "../../layout";
import type { BoardCues } from "../../play";
import type { CardId } from "../../protocol";
import { decodeSnapshot } from "../../protocol";
import { frame, now } from "../../platform";
import { NO_FOCUS } from "../stage";
import type { HighlightRequest, HighlightTone, SceneFrame, SceneReport } from "../stage";
import { createScene } from "../three";
import type { Quality, SceneHandle } from "../three";

const VIEWPORT = { w: 1180, h: 820 } as const;
const NO_CUES: BoardCues = { stop: null, marks: { cards: new Map(), seats: new Map(), hand: new Set() }, combat: null, handAway: false };
/** Frames timed per moment, after a warm-up. */
const FRAMES = 240;
const WARM = 40;

const design = import.meta.glob<unknown>("../../../../../tests/fixtures/boards/design-pass.json", { import: "default" });
const corpus = import.meta.glob<unknown>("../../../../../tests/fixtures/protocol/0*.json", { import: "default" });
const catalogFile = import.meta.glob<unknown>("../../../test/model/catalog.json", { import: "default" });

interface Table {
  readonly name: string;
  readonly envelope: Record<string, unknown>;
  readonly catalog: CardCatalog;
}

/** The design pass's turn 15 (tests/fixtures/boards); before those boards are in, the corpus's biggest table. */
async function table(): Promise<Table> {
  const load = Object.values(design)[0];
  if (load) {
    const raw = (await load()) as { stages: { turn: number; envelope: Record<string, unknown> }[]; catalog: unknown };
    const st = raw.stages.find((s) => s.turn === 15) ?? raw.stages.at(-1)!;
    return { name: `design pass, turn ${st.turn}`, envelope: st.envelope, catalog: decodeCatalog(raw.catalog) };
  }
  const cat = Object.values(catalogFile)[0];
  const catalog = cat ? decodeCatalog(await cat()) : new Map();
  let best: { name: string; env: Record<string, unknown>; n: number } | null = null;
  for (const [path, l] of Object.entries(corpus)) {
    const env = (await l()) as { view?: { players?: { battlefield?: unknown[] }[] } };
    const n = (env.view?.players ?? []).reduce((t, p) => t + (p.battlefield?.length ?? 0), 0);
    if (!best || n > best.n) best = { name: path.split("/").pop()!, env: env as Record<string, unknown>, n };
  }
  if (!best) throw new Error("no table to draw");
  return { name: `corpus ${best.name} (the design pass's boards are not in yet)`, envelope: best.env, catalog };
}

function modelFrom(env: unknown, catalog: CardCatalog): TableModel {
  const d = decodeSnapshot(env);
  if (!d.ok) throw new Error("the bench's table does not decode");
  const viewer = playerViewer(d.value);
  const model = viewer ? modelOf(d.value, catalog, viewer) : null;
  if (!model) throw new Error("the bench's table has no viewer");
  return model;
}

/** The same table with my first creature put in my graveyard: a flight there, and back. */
function withoutCreature(env: Record<string, unknown>): Record<string, unknown> {
  const e = structuredClone(env) as { view: { players: { name: string; battlefield?: { type?: string }[]; graveyard?: unknown[] }[] }; v?: number };
  const me = e.view.players[0]!;
  const i = (me.battlefield ?? []).findIndex((c) => /Creature/.test(c.type ?? ""));
  if (i >= 0) me.graveyard = [...(me.graveyard ?? []), ...me.battlefield!.splice(i, 1)];
  e.v = Number(e.v ?? 0) + 1;
  return e;
}

interface Stats {
  readonly median: number;
  readonly p90: number;
  readonly worst: number;
  readonly mean: number;
}
const stats = (xs: readonly number[]): Stats => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? NaN;
  return { median: q(0.5), p90: q(0.9), worst: s.at(-1) ?? NaN, mean: s.reduce((t, x) => t + x, 0) / Math.max(1, s.length) };
};

interface Row {
  readonly moment: string;
  /** The post-processing it was drawn with: the composer's pixel ratio (null: the policy's), bloom, MSAA. */
  readonly quality: Quality;
  readonly what: string;
  readonly frames: number;
  /** A frame drawn and finished on the GPU, ms. */
  readonly frame: Stats;
  /** Between frames (the display's pace), ms. */
  readonly interval: Stats;
  /** Draw calls a frame (every pass: shadows when drawn, the table, the focus, bloom, output) and triangles. */
  readonly calls: { readonly median: number; readonly max: number };
  readonly triangles: number;
  /** Frames whose shadow map was drawn again. */
  readonly shadowRedraws: number;
  readonly cards: number;
  readonly cardBatches: number;
  readonly sprites: number;
  readonly spriteBatches: number;
}

const ms = (x: number): string => x.toFixed(2);

export async function renderBench(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <h2>Render bench: the table's frame</h2>
    <p id="r-env" style="color:#a69c8b;font-size:13px"></p>
    <p id="r-status">Loading the table…</p>
    <style>#r-table td, #r-table th { padding: 2px 10px; } #r-table th { font-weight: 600; }</style>
    <div style="overflow-x:auto"><table id="r-table" style="border-collapse:collapse;font:14px/1.5 Barlow, sans-serif"></table></div>
    <p style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <button id="r-send" disabled>Send to Mac</button> <button id="r-select">Select all</button>
      <button id="r-copy" hidden>Copy</button> <button id="r-run">Run again</button>
      <span id="r-sent" style="color:#a69c8b;font-size:13px"></span>
    </p>
    <textarea id="r-json" readonly style="box-sizing:border-box;width:100%;height:24vh;font:11px/1.4 monospace;background:#120b06;color:#d8cfbf;border:1px solid #3b2717;padding:8px"></textarea>
    <canvas id="stage" style="width:${VIEWPORT.w}px;height:${VIEWPORT.h}px;max-width:100%"></canvas>`;
  const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
  const t = await table();
  const a = modelFrom(t.envelope, t.catalog);
  const b = modelFrom(withoutCreature(t.envelope), t.catalog);
  const planA = planTable(tableInputOf(a, { viewport: VIEWPORT, memory: null }));
  const planB = planTable(tableInputOf(b, { viewport: VIEWPORT, memory: planA.memory }));
  const canvas = root.querySelector<HTMLCanvasElement>("#stage")!;
  const scene: SceneHandle = createScene({ canvas, viewport: VIEWPORT, dpr: globalThis.devicePixelRatio || 1 });
  await scene.ready();
  const host = scene.host!;
  // The art the table shows, decoded before anything is timed.
  const urls = [...new Set([...a.cards.values()].map((c) => c.face.art).filter((u): u is string => !!u))];
  host.preloadArt(urls);
  const gl = host.renderer.getContext(),
    px = new Uint8Array(4);
  $("r-env").textContent = `${navigator.userAgent} · screen ${screen.width}x${screen.height} @${devicePixelRatio}x · drawn at ${VIEWPORT.w}x${VIEWPORT.h} · ${t.name} · ${FRAMES} frames a moment`;

  // A highlight as the stack's focus steps cards out: five of my creatures (mine) and one of theirs (a threat).
  const me = a.viewer.perspective;
  const onTable = [...a.cards.values()].filter((c) => c.zone === "battlefield" && /Creature/.test(c.face.type));
  const pick: [CardId, HighlightTone][] = [
    ...onTable.filter((c) => c.controller === me).slice(0, 5).map((c): [CardId, HighlightTone] => [c.id, "mine"]),
    ...onTable.filter((c) => c.controller !== me).slice(0, 1).map((c): [CardId, HighlightTone] => [c.id, "threat"]),
  ];
  const highlight: HighlightRequest = { cards: new Map(pick), look: { dim: 0.3 } };

  let commit = 0,
    seq = 0,
    mode: SceneFrame["mode"] = "cut";
  let pending: ChangeSet[] = [];
  let atB = false;
  const show = (hl: boolean): SceneReport => {
    const model = atB ? b : a;
    const r = scene.show(
      { model, plan: atB ? planB : planA, changes: pending, mode, cues: NO_CUES, focus: NO_FOCUS, moments: [], hover: null, commit: ++commit, ...(hl ? { highlight } : {}) },
      now(),
    );
    mode = "animate";
    if (r.consumedSeq !== null) pending = pending.filter((c) => c.seq > r.consumedSeq!);
    return r;
  };
  const nextFrame = (): Promise<number> => new Promise((r) => void frame((at) => r(at)));
  const settle = async (): Promise<void> => {
    for (let k = 0; k < 600 && (host.stats().art.pending > 0 || show(false).active); k++) await nextFrame();
  };

  /** Time `n` frames of a moment; `step` draws one (and says whether it counts). */
  let quality: Quality = { composerDpr: null, bloom: true, msaa: true };
  async function time(moment: string, what: string, step: () => boolean): Promise<Row> {
    const costs: number[] = [],
      gaps: number[] = [],
      calls: number[] = [];
    let last = -1,
      redraws = 0,
      warm = 0;
    while (costs.length < FRAMES) {
      const at = await nextFrame();
      const before = host.stats().shadowFrames;
      const t0 = now();
      const counts = step();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const cost = now() - t0;
      if (!counts || warm++ < WARM) {
        last = -1;
        continue;
      }
      costs.push(cost);
      if (last >= 0) gaps.push(at - last);
      last = at;
      const s = host.stats();
      calls.push(s.calls);
      if (s.shadowFrames > before) redraws++;
    }
    const s = host.stats();
    const c = [...calls].sort((x, y) => x - y);
    return {
      moment,
      quality,
      what,
      frames: costs.length,
      frame: stats(costs),
      interval: stats(gaps),
      calls: { median: c[Math.floor(c.length / 2)] ?? 0, max: c.at(-1) ?? 0 },
      triangles: s.triangles,
      shadowRedraws: redraws,
      cards: s.cards,
      cardBatches: s.cardBatches,
      sprites: s.sprites,
      spriteBatches: s.spriteBatches,
    };
  }

  let last: unknown = null;
  const run = async (): Promise<void> => {
    const tableEl = $("r-table");
    tableEl.innerHTML = `<tr><th align=left>moment</th><th>frame median</th><th>p90</th><th>worst</th><th>mean</th><th>interval median</th><th>draw calls</th><th>max</th><th>shadow redraws</th><th>cards / batches</th><th>sprites / batches</th></tr>`;
    quality = { composerDpr: null, bloom: true, msaa: true };
    host.setQuality(quality);
    const rows: Row[] = [];
    const add = (row: Row): void => {
      rows.push(row);
      const over = (x: number) => (x > 16 ? ` style="color:#e06a4f"` : "");
      tableEl.insertAdjacentHTML(
        "beforeend",
        `<tr><td title="${row.what}">${row.moment}</td><td align=right${over(row.frame.median)}>${ms(row.frame.median)}</td><td align=right${over(row.frame.p90)}>${ms(row.frame.p90)}</td><td align=right${over(row.frame.worst)}>${ms(row.frame.worst)}</td><td align=right>${ms(row.frame.mean)}</td><td align=right>${ms(row.interval.median)}</td><td align=right>${row.calls.median}</td><td align=right>${row.calls.max}</td><td align=right>${row.shadowRedraws}</td><td align=right>${row.cards} / ${row.cardBatches}</td><td align=right>${row.sprites} / ${row.spriteBatches}</td></tr>`,
      );
    };
    atB = false;
    mode = "cut";
    pending = [];
    $("r-status").textContent = "Waiting for the table to come to rest…";
    await settle();
    $("r-status").textContent = "Timing the table at rest…";
    add(await time("rest", "the table at rest, drawn every frame (the shadow map is not redrawn)", () => (show(false), true)));
    $("r-status").textContent = "Timing a highlight…";
    add(await time("highlight", "five of my creatures and one of theirs stepped out of the light over a 0.3 scrim", () => (show(true), true)));
    await settle();
    $("r-status").textContent = "Timing flights…";
    // A creature flies to my graveyard and back, again and again; only frames with something in flight count.
    let still = 0;
    add(
      await time("flight", "a creature flying to the graveyard and back (frames with cards in flight; shadows redrawn)", () => {
        const r = show(false);
        if (r.active) still = 0;
        else if (++still > 3) {
          atB = !atB;
          pending.push({ ...diff(atB ? a : b, atB ? b : a, ++seq), seq });
          still = 0;
        }
        return r.active;
      }),
    );
    atB = false;
    await settle();
    // The table at rest under each post-processing setting on its own, then all three off.
    const variants: [string, Partial<Quality>][] = [
      ["rest · composer 1.0x", { composerDpr: 1 }],
      ["rest · composer 1.5x", { composerDpr: 1.5 }],
      ["rest · no bloom", { bloom: false }],
      ["rest · no MSAA", { msaa: false }],
      ["rest · 1.0x, no bloom, no MSAA", { composerDpr: 1, bloom: false, msaa: false }],
    ];
    for (const [name, q] of variants) {
      quality = { composerDpr: null, bloom: true, msaa: true, ...q };
      host.setQuality(quality);
      $("r-status").textContent = `Timing ${name}…`;
      add(await time(name, "the table at rest with only this post-processing changed", () => (show(false), true)));
    }
    quality = { composerDpr: null, bloom: true, msaa: true };
    host.setQuality(quality);
    last = { userAgent: navigator.userAgent, screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio }, viewport: VIEWPORT, table: t.name, framesPerMoment: FRAMES, bench: "render", rows };
    (root.querySelector("#r-json") as HTMLTextAreaElement).value = JSON.stringify(last, null, 1);
    (root.querySelector("#r-send") as HTMLButtonElement).disabled = false;
    (globalThis as { __bench?: unknown }).__bench = last;
    $("r-status").textContent = "Done. A frame's cost is ms, drawn and finished on the GPU; 16.7 ms is a 60 fps frame.";
    document.documentElement.dataset["ready"] = "1";
  };
  $("r-run").onclick = () => void run();
  const text = () => JSON.stringify(last, null, 1);
  const said = (s: string) => ($("r-sent").textContent = s);
  $("r-send").onclick = async () => {
    said("Sending…");
    try {
      // relative: /next/api/bench under the game server, /api/bench under tools/serve.js
      const r = await fetch("api/bench", { method: "POST", headers: { "Content-Type": "application/json" }, body: text() });
      const reply = (await r.json()) as { ok?: boolean; file?: string; error?: string };
      said(r.ok && reply.ok ? `Sent: ${reply.file ?? ""}` : `Not sent: ${reply.error ?? r.status}`);
    } catch (e) {
      said(`Not sent: ${e instanceof Error ? e.message : String(e)} (select all and copy instead)`);
    }
  };
  $("r-select").onclick = () => {
    const ta = root.querySelector("#r-json") as HTMLTextAreaElement;
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
  };
  if (globalThis.isSecureContext && navigator.clipboard) {
    $("r-copy").hidden = false;
    $("r-copy").onclick = () => void navigator.clipboard.writeText(text()).then(() => said("Copied"), () => said("Not copied: select all instead"));
  }
  await run();
}
