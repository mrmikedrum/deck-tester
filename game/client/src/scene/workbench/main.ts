// The workbench entry (workbench.html): a gallery of every painted piece, and a static table drawn by the host from
// layout's plan on hand-built boards, and the corpus played through the stage. Query: `?only=table`, `?only=gallery`,
// `?only=motion` (see motion.ts).
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/im-fell-english/400.css";
import "@fontsource/im-fell-english/400-italic.css";
import { after, fontsReady, frame } from "../../platform";
import { planTable, tableTemplate } from "../../layout";
import type { SeatId } from "../../layout";
import { installCss, seat as seatColours } from "../../theme";
import type { FaceEnv } from "../../theme";
import { Host, loadArt, loadAssets, StaticTable } from "../three";
import { artUrl, faceOf, fixture, SEAT_PLACES } from "./fixtures";
import type { SeatKey } from "./fixtures";
import { gallery } from "./gallery";
import { motion } from "./motion";

const VIEWPORT = { w: 1180, h: 820 };

async function main(): Promise<void> {
  await fontsReady();
  installCss(document);
  const only = new URLSearchParams(location.search).get("only");
  if (only === "motion") {
    const root = document.getElementById("root");
    if (!root) throw new Error("workbench.html lacks #root");
    await motion(root);
    document.documentElement.dataset["ready"] = "1";
    return;
  }
  const assets = await loadAssets();
  const fx = fixture();
  const slugs = [...new Set([...fx.entries.values()].map((e) => e.entry.art ?? e.entry.name))];
  const urls = [
    ...new Set([
      ...slugs.map((s) =>
        artUrl(
          s
            .toLowerCase()
            .replace(/['’]/g, "-")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .replace(/-+/g, "-"),
        ),
      ),
      artUrl("brimaz-blight-of-oreskos"),
      artUrl("chrome-host-seedshark"),
      artUrl("phyrexian-metamorph"),
      artUrl("sword-of-truth-and-justice"),
      artUrl("chaos-warp"),
      artUrl("command-tower"),
      artUrl("marath-will-of-the-wild"),
      artUrl("meloku-the-clouded-mirror"),
      artUrl("tezzeret-cruel-captain"),
    ]),
  ];
  // The gallery paints on plain canvases: its art is decoded up front.
  const decoded = new Map<string, NonNullable<Awaited<ReturnType<typeof loadArt>>>>();
  await Promise.all(
    urls.map(async (u) => {
      const a = await loadArt(u);
      if (a) decoded.set(u, a);
    }),
  );
  const root = document.getElementById("root");
  if (!root) throw new Error("workbench.html lacks #root");

  if (only !== "table") {
    const env: FaceEnv = {
      surfaces: assets.surfaces,
      art: (u) => (decoded.get(u) as ReturnType<FaceEnv["art"]>) ?? null,
    };
    gallery(root, env, (u) => decoded.has(u));
  }
  if (only !== "gallery") {
    const wrap = document.createElement("section");
    wrap.id = "table";
    const canvas = document.createElement("canvas");
    canvas.id = "stage";
    canvas.style.width = `${VIEWPORT.w}px`;
    canvas.style.height = `${VIEWPORT.h}px`;
    wrap.append(Object.assign(document.createElement("h2"), { textContent: "The table (host, static)" }), canvas);
    root.append(wrap);
    let view: StaticTable | null = null;
    let pending = false;
    // The host's art cache starts empty (the page's decoded art is the gallery's); faces repaint as art arrives.
    const host = new Host({
      canvas,
      viewport: VIEWPORT,
      dpr: globalThis.devicePixelRatio || 1,
      camera: tableTemplate(4).camera,
      assets,
      art: async (u) => {
        const a = decoded.get(u);
        return a ? await createImageBitmap(a as ImageBitmap) : null;
      },
      onArt: () => {
        if (pending) return;
        pending = true;
        after(30, () => {
          pending = false;
          view?.build();
        });
      },
      onRebuild: () => view?.build(),
    });
    const place = (s: SeatId) => SEAT_PLACES[s as SeatKey];
    view = new StaticTable(host, {
      plan: () =>
        planTable({
          viewport: host.size,
          mode: "normal",
          settling: false,
          memory: null,
          involved: new Set(),
          stack: [],
          seats: fx.boards,
        }),
      face: (u, s) => {
        const e = fx.entries.get(u.top);
        return e ? faceOf(e.entry, s !== "you", (url) => host.art(url) !== null) : null;
      },
      token: (u) => fx.entries.get(u.top)?.entry.token === true,
      plate: (s) => ({
        name: fx.names.get(s)?.name ?? s,
        life: fx.names.get(s)?.life ?? 40,
        seat: seatColours[place(s)],
        monarch: false,
        turn: s === "you",
        ring: "none",
        art: null,
      }),
      place,
      mine: (s) => s === "you",
    });
    view.build();
    const tick = (at: number): void => {
      host.render(at);
      frame(tick);
    };
    frame(tick);
    Object.assign(globalThis, { __workbench: { host, view } });
  }
  document.documentElement.dataset["ready"] = "1";
}

void main();
