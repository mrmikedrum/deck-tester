// @vitest-environment happy-dom
// Faults the frame must survive: an effect that throws (the frame still commits and schedules; the fault is reported;
// a failed card request is asked again), a renderer fault while idle (one recovery commit, bounded for a persistent
// one), and the notice with Reload, drawn by the app's own surface whatever the game renderer does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as play from "../../src/play";
import { play as playKind } from "../../src/play/kinds/play";
import { noticeSurface } from "../../src/app/notice";
import type { NoticeSurface } from "../../src/app/notice";
import { raw } from "../play/rig";
import { BUILD, envelope, rig } from "./rig";

describe("an effect that throws", () => {
  it("a card request that throws: the frame commits and schedules, the fault is reported, the names are asked again", () => {
    const r = rig({ cold: true });
    r.loop.start();
    r.frame(0);
    const real = r.transport.cards.bind(r.transport);
    let throwing = true;
    (r.transport as { cards: typeof r.transport.cards }).cards = (epoch, names) => {
      if (throwing) throw new URIError("URI malformed");
      real(epoch, names);
    };
    const commits = r.commits.length;
    r.transport.push(raw("023-play-monarch.json"));
    expect(() => r.frame(10)).not.toThrow();
    expect(r.commits.length).toBe(commits + 1); // committed
    expect(r.commits.at(-1)?.lines.join("\n")).toMatch(/decision 120/);
    expect(r.logs.map((l) => l.code)).toContain("effect.cards");
    expect(r.state.faults.count).toBeGreaterThan(0);
    expect(r.state.cardAsks.out.has("Lightning Bolt")).toBe(false); // released
    throwing = false;
    const again = raw("023-play-monarch.json");
    again["v"] = 61;
    r.transport.push(again);
    r.frame(20);
    expect(r.transport.cardRequests.flat()).toContain("Lightning Bolt");
  });

  it("an answer that throws: the frame commits, and the prompt is free again", () => {
    const r = rig();
    r.loop.start();
    r.frame(0);
    (r.transport as { answer: typeof r.transport.answer }).answer = () => {
      throw new Error("no fetch");
    };
    r.transport.push(envelope({ v: 1, decision: 1 }));
    r.frame(10);
    r.act();
    expect(() => r.frame(20)).not.toThrow();
    expect(r.logs.map((l) => l.code)).toContain("effect.answer");
    expect(r.state.answer.pending).toBeNull();
    expect(play.present(r.state.play).controls.prompt?.busy).toBe(false);
  });
});

describe("a renderer fault while idle", () => {
  it("gets one recovery commit, a cut", () => {
    const r = rig();
    r.loop.start();
    r.frame(0);
    r.transport.push(envelope({ v: 1, decision: 1 }));
    r.frame(10);
    r.settle();
    expect(r.sched.requested).toBe(false);
    r.renderer.throwNext = "chrome broke";
    r.loop.wake();
    r.frame(100);
    expect(r.state.faults.count).toBe(1);
    expect(r.sched.requested).toBe(true); // a recovery commit
    const before = r.commits.length;
    r.frame(116);
    expect(r.commits.length).toBe(before + 1);
    expect(r.commits.at(-1)?.frame?.mode).toBe("cut");
    expect(r.sched.requested).toBe(false); // recovered: idle again
  });

  it("a persistent fault is retried a bounded number of times, then the loop idles", () => {
    const r = rig();
    r.loop.start();
    r.frame(0);
    r.renderer.throwAll = "broken for good";
    r.loop.wake();
    let frames = 0;
    for (let t = 100; r.sched.requested || t === 100; t += 16) {
      r.frame(t);
      if (++frames > 50) break;
    }
    expect(frames).toBeLessThan(10);
    expect(r.sched.requested).toBe(false);
    expect(r.state.faults.notice).toBe("render");
  });
});

describe("the notice with Reload", () => {
  let reloads: number, surface: NoticeSurface;
  beforeEach(() => {
    document.body.innerHTML = "";
    reloads = 0;
    surface = noticeSurface(document.body, () => reloads++);
  });
  afterEach(() => surface.dispose());

  const shown = () => document.querySelector<HTMLElement>("[data-audit='notice']");
  const reload = () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Reload");

  it("shows a repeated renderer fault with a Reload that works, though the renderer keeps failing", () => {
    const r = rig({ notice: surface });
    r.loop.start();
    r.renderer.throwAll = "WebGL is gone";
    r.frame(0);
    r.frame(100);
    expect(r.state.faults.notice).toBe("render");
    expect(shown()?.hidden).toBe(false);
    expect(shown()?.textContent).toMatch(/went wrong/);
    reload()!.click();
    expect(reloads).toBe(1);
  });

  it("shows a stale build with Reload, and nothing while all is well", () => {
    const r = rig({ notice: surface });
    r.loop.start();
    r.frame(0);
    r.transport.push(envelope({ v: 1, decision: 1, build: BUILD }));
    r.frame(10);
    expect(shown()?.hidden ?? true).toBe(true);
    r.transport.push(envelope({ v: 2, decision: 1, build: "newer000000" }));
    r.frame(20);
    expect(shown()?.hidden).toBe(false);
    expect(shown()?.textContent).toMatch(/out of date/);
    expect(reload()).toBeDefined();
  });
});

describe("a snapshot play fails to reduce", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is an ingest fault: reported, not acknowledged (the transport re-syncs), and the app keeps its old state", () => {
    const r = rig();
    r.loop.start();
    r.frame(0);
    const boom = vi.spyOn(playKind, "start").mockImplementation(() => {
      throw new Error("kind broke");
    });
    r.transport.push(envelope({ v: 1, decision: 1 }));
    r.frame(10);
    expect(r.logs.map((l) => l.code)).toContain("ingest.update");
    expect(r.transport.acks).toEqual([{ v: 1, ack: "fault" }]);
    expect(r.state.model).toBeNull(); // the new model was not adopted with stale play state
    expect(r.state.session.stop).toBeNull();
    boom.mockRestore();
    // The re-sync brings it again, and it is taken.
    r.frame(20);
    expect(r.transport.acks.at(-1)).toEqual({ v: 1, ack: "took" });
    expect(r.state.session.stop).not.toBeNull();
  });

  it("an act whose kind throws stays a no-op with a warning", () => {
    const r = rig();
    r.loop.start();
    r.frame(0);
    r.transport.push(envelope({ v: 1, decision: 1 }));
    r.frame(10);
    const before = r.state.play;
    vi.spyOn(playKind, "pick").mockImplementation(() => {
      throw new Error("kind broke");
    });
    r.send({ a: "pick", option: 2 });
    r.frame(20);
    expect(r.state.play).toBe(before);
    expect(r.logs.map((l) => l.code)).toContain("play.warn");
    expect(r.logs.map((l) => l.code)).not.toContain("ingest.update");
  });
});
