// @vitest-environment happy-dom
// A scene that cannot start (no WebGL, a failed load) is a terminal fault: reported once, the Reload notice shown and
// kept, `ready` rejected so the tools can tell, and the scene not built again on every commit.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_INSETS, now } from "../../src/platform";
import { noticeView } from "../../src/app/notice";
import { pageRenderer } from "../../src/app/renderer";
import type { PageRenderer } from "../../src/app/renderer";
import { initialState } from "../../src/app/state";
import { envelope, rig } from "./rig";

const built = { count: 0, disposed: 0 };

vi.mock("../../src/scene/three/scene", () => ({
  createScene: () => {
    built.count += 1;
    return {
      host: null,
      renderer: null,
      out: { size: 0, drain: () => [], listen: () => undefined },
      ready: () => Promise.reject(new Error("WebGL is not available")),
      show: () => {
        throw new Error("not ready");
      },
      inspect: () => null,
      pick: () => null,
      dispose: () => {
        built.disposed += 1;
      },
    };
  },
}));

vi.mock("../../src/chrome", async (original) => ({
  ...(await original<typeof import("../../src/chrome")>()),
  chromeRenderer: () => ({ show: () => ({ active: false, fault: null }), dispose: () => undefined }),
}));

let page: PageRenderer;
const state = { ...initialState({ clientBuild: "b", viewport: { w: 1180, h: 820, safe: NO_INSETS } }), commit: 1 };

beforeEach(() => {
  built.count = 0;
  built.disposed = 0;
  document.body.innerHTML = `<canvas id="stage"></canvas><div id="ui"></div>`;
  page = pageRenderer({
    canvas: document.getElementById("stage") as HTMLCanvasElement,
    ui: document.getElementById("ui")!,
    emit: () => undefined,
    wake: () => undefined,
    dpr: () => 1,
  });
});
afterEach(() => page.dispose());

describe("the scene fails to start", () => {
  it("rejects `ready`, reports one terminal fault, and is not built again", async () => {
    page.show(state, now());
    await expect(page.ready).rejects.toThrow("WebGL is not available");
    const first = page.show(state, now());
    expect(first.fault).toContain("WebGL is not available");
    expect(first.terminal).toBe(true);
    const next = page.show(state, now());
    expect(next.fault).toBeNull();
    expect(built.count).toBe(1);
    expect(built.disposed).toBe(1); // what it held is freed
    expect(page.scene).toBeNull();
  });
});

describe("a terminal renderer fault in the loop", () => {
  it("shows the Reload notice at once and keeps it; no recovery commits are asked for", () => {
    const r = rig();
    r.loop.start();
    r.frame(0);
    r.transport.push(envelope({ v: 1, decision: 1 }));
    r.renderer.report = null;
    r.renderer.terminal = "scene: WebGL is not available";
    r.frame(10);
    expect(noticeView(r.state)?.text).toBeTruthy();
    expect(r.logs.filter((l) => l.code === "render")).toHaveLength(1);
    expect(r.sched.requested).toBe(false);
    r.renderer.terminal = null;
    r.loop.wake();
    r.frame(5000 + 10); // long after: still shown
    r.transport.push(envelope({ v: 2, decision: 2 }));
    r.frame(9000);
    expect(noticeView(r.state)?.text).toBeTruthy();
  });
});
