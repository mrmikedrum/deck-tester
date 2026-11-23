// Bake the Grimoire's textures to image files, once: node tools/bake.js  (with node tools/serve.js running)
const fs = require("fs");
const pw = require(process.env.PW || "playwright");
(async () => {
  const browser = await pw.chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`<script src="http://localhost:8797/world.js"></script>`);
  await page.waitForFunction(() => window.SeatWorld);
  const out = await page.evaluate(() => {
    const W = window.SeatWorld, o = {};
    const v = W.vellum(1024, { tone: "#d8c59c", wear: 0.65 });
    o["vellum.jpg"] = v.map.toDataURL("image/jpeg", 0.92); o["vellum-n.png"] = v.normal.toDataURL("image/png");
    const d = W.vellum(1024, { tone: "#7a6443", wear: 0.9 });
    o["tome.jpg"] = d.map.toDataURL("image/jpeg", 0.92); o["tome-n.png"] = d.normal.toDataURL("image/png");
    const b = W.bronze(512, { patina: 0.55 });
    o["bronze.jpg"] = b.map.toDataURL("image/jpeg", 0.92); o["bronze-n.png"] = b.normal.toDataURL("image/png"); o["bronze-r.png"] = b.roughness.toDataURL("image/png");
    const bd = W.bronze(512, { patina: 0.15 });
    o["bronze-clean.jpg"] = bd.map.toDataURL("image/jpeg", 0.92);
    o["leather.jpg"] = W.vellum(512, { tone: "#3a2616", wear: 1.2 }).map.toDataURL("image/jpeg", 0.88);
    "WUBRGCMLT".split("").forEach(k => (o["frame-" + k + ".jpg"] = W.frame(k).toDataURL("image/jpeg", 0.92)));
    o["parchment-ui.jpg"] = W.vellum(512, { tone: "#e6d6ae", wear: 0.5 }).map.toDataURL("image/jpeg", 0.88);
    return o;
  });
  for (const [name, url] of Object.entries(out)) fs.writeFileSync("client/img/tex/" + name, Buffer.from(url.split(",")[1], "base64"));
  console.log(Object.keys(out).join(" "));
  await browser.close();
})();
