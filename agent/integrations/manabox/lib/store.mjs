import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { canonical } from "./account.mjs";
export const hash = (v) =>
  createHash("sha256")
    .update(typeof v === "string" || Buffer.isBuffer(v) ? v : canonical(v))
    .digest("hex");
export const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
export function atomic(p, data, { exclusive = false } = {}) {
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  const tmp = p + ".tmp-" + randomUUID();
  const b =
    typeof data === "string" || Buffer.isBuffer(data)
      ? data
      : JSON.stringify(data, null, 2) + "\n";
  try {
    const fd = fs.openSync(tmp, "wx", 0o600);
    try {
      fs.writeFileSync(fd, b);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (exclusive) {
      fs.linkSync(tmp, p);
      fs.unlinkSync(tmp);
    } else fs.renameSync(tmp, p);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
export function digest(s) {
  return hash({
    uid: s.uid,
    tables: Object.fromEntries(
      Object.entries(s.tables)
        .sort()
        .map(([k, v]) => [k, [...v].sort((a, b) => a.id.localeCompare(b.id))]),
    ),
    untyped_tables: s.untyped_tables ?? {},
  });
}
export class Store {
  constructor({ state, repo } = {}) {
    this.repo = path.resolve(
      repo ?? process.env.MTG_DECKS_REPO ?? process.cwd(),
    );
    this.state = path.resolve(
      state ??
        process.env.MANABOX_STATE_DIR ??
        path.join(this.repo, ".manabox"),
    );
    this.library = path.join(this.repo, "decks", "manabox");
    fs.mkdirSync(this.state, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.state, 0o700);
    if (!fs.existsSync(this.file(".gitignore")))
      atomic(this.file(".gitignore"), "*\n", { exclusive: true });
  }
  file(...p) {
    return path.join(this.state, ...p);
  }
  get account() {
    let s;
    try {
      s = read(this.file("session.json"));
    } catch {
      throw Error(
        "Private session missing or invalid; run deckmaster login --email YOUR_EMAIL",
      );
    }
    if (!s.uid) throw Error("Invalid session; run deckmaster login");
    return s.uid;
  }
  get home() {
    return this.file("accounts", hash(this.account).slice(0, 24));
  }
  workspace() {
    const p = path.join(this.home, "workspace.json");
    if (!fs.existsSync(p))
      throw Error("No local workspace. Run deckmaster pull first.");
    return read(p);
  }
  saveWorkspace(w) {
    if (w.uid !== this.account) throw Error("Workspace/account mismatch");
    atomic(path.join(this.home, "workspace.json"), w);
  }
  backup(s, label = "pull") {
    if (s.uid !== this.account) throw Error("Snapshot/account mismatch");
    const id = digest(s),
      dir = path.join(this.home, "snapshots");
    const p = path.join(dir, id + ".json.gz");
    if (!fs.existsSync(p))
      atomic(p, gzipSync(Buffer.from(JSON.stringify(s)), { level: 9 }), {
        exclusive: true,
      });
    const found = this.snapshot(id);
    if (digest(found) !== id) throw Error("Snapshot verification failed");
    atomic(path.join(dir, "latest.json"), {
      id,
      label,
      captured_at: s.captured_at,
      observed_at: new Date().toISOString(),
    });
    return id;
  }
  snapshot(id) {
    const dir = path.join(this.home, "snapshots");
    if (id === "latest") id = read(path.join(dir, "latest.json")).id;
    if (!/^[a-f0-9]{64}$/.test(id))
      throw Error("Use the complete snapshot hash from deckmaster snapshots list");
    const s = JSON.parse(
      gunzipSync(fs.readFileSync(path.join(dir, id + ".json.gz"))),
    );
    if (s.uid !== this.account || digest(s) !== id)
      throw Error("Snapshot corrupt or belongs to another account");
    return s;
  }
  snapshots() {
    const dir = path.join(this.home, "snapshots");
    return fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".json.gz"))
          .map((f) => ({
            id: f.slice(0, -8),
            bytes: fs.statSync(path.join(dir, f)).size,
          }))
      : [];
  }
  receipts() {
    const dir = path.join(this.home, "receipts");
    return fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => ({ file: path.join(dir, f), ...read(path.join(dir, f)) }))
      : [];
  }
  lock(fn) {
    return withLock(this.file("client.lock"), fn);
  }
}
export async function withLock(file, fn) {
  const token = randomUUID();
  for (let i = 0; i < 2; i++) {
    try {
      atomic(
        file,
        { pid: process.pid, host: os.hostname(), token },
        { exclusive: true },
      );
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const old = read(file);
      let alive = true;
      if (old.host === os.hostname()) {
        try {
          process.kill(old.pid, 0);
        } catch (e) {
          if (e.code === "ESRCH") alive = false;
        }
      }
      if (alive || i)
        throw Error(
          "Another deckmaster process holds the local lock. Wait for it to finish.",
        );
      // A dead same-host owner is recoverable; retain the old lock as evidence.
      const archived = file + ".stale-" + randomUUID();
      fs.renameSync(file, archived);
    }
  }
  try {
    return await fn();
  } finally {
    if (fs.existsSync(file) && read(file).token === token) fs.unlinkSync(file);
  }
}
