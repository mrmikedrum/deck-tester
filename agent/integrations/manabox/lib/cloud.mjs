import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { columns, wireEntry } from "./schema.mjs";
import { atomic, read as readJSON, digest } from "./store.mjs";
import { valid, validatePlan, applyOps, verifyPlan } from "./model.mjs";
import { canonical } from "./account.mjs";
import { retryDelay } from "./network.mjs";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENDPOINT = "https://67b5eed2ee50386f3168b252.powersync.journeyapps.com";
// Fresh tokens are reused within a process instead of spawning the helper per request.
const tokens = new Map();
export function credentials(store) {
  const cached = tokens.get(store.state);
  if (cached?.expires_at > Date.now() / 1000 + 120) return cached;
  try {
    const c = JSON.parse(
      execFileSync(
        "python3",
        [
          "-c",
          'import json,auth; t=auth.fresh_token(); s=auth.load_session(); print(json.dumps({"token":t,"uid":s["uid"],"expires_at":s["expires_at"]}))',
        ],
        {
          cwd: path.join(root, "python"),
          env: { ...process.env, MANABOX_STATE_DIR: store.state },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 45000,
        },
      ),
    );
    tokens.set(store.state, c);
    return c;
  } catch {
    throw Error(
      "Login missing or token refresh failed. Run deckmaster login --email YOUR_EMAIL. Credentials were not printed.",
    );
  }
}
export function login(store, email, noOpen = false) {
  execFileSync(
    "python3",
    [
      path.join(root, "python/auth.py"),
      "login",
      "--email",
      email,
      ...(noOpen ? ["--no-open"] : []),
    ],
    {
      env: { ...process.env, MANABOX_STATE_DIR: store.state },
      stdio: "inherit",
    },
  );
}
export async function openDB(filename) {
  const { PowerSyncDatabase, Schema, Table } = await import("@powersync/node");
  const db = new PowerSyncDatabase({
    schema: new Schema(
      Object.fromEntries(
        Object.entries(columns).map(([k, v]) => [k, new Table(v)]),
      ),
    ),
    database: { dbFilename: filename },
    logger: { debug() {}, info() {}, warn() {}, error() {}, log() {} },
  });
  await db.waitForReady();
  return db;
}
export async function capture(db, uid) {
  return db.readTransaction(async (tx) => ({
    uid,
    captured_at: new Date().toISOString(),
    schema_version: 2,
    tables: Object.fromEntries(
      await Promise.all(
        Object.keys(columns).map(async (t) => [
          t,
          (await tx.getAll(`SELECT id,data FROM "ps_data__${t}"`)).map((r) => ({
            ...JSON.parse(r.data),
            id: r.id,
          })),
        ]),
      ),
    ),
    untyped_tables: (
      await tx.getAll("SELECT type,id,data FROM ps_untyped")
    ).reduce((o, r) => {
      (o[r.type] ??= []).push({ ...JSON.parse(r.data), id: r.id });
      return o;
    }, {}),
    source: { independent: true },
    coverage: {
      known_table_names: Object.keys(columns),
      server_completeness: "Only rows delivered to this authenticated account",
      archives: "Metadata only; archive contents not managed",
    },
  }));
}
export async function connect(db, store) {
  const start = Date.now();
  try {
    await db.connect(
      {
        fetchCredentials: async () => {
          const c = credentials(store);
          return {
            endpoint: ENDPOINT,
            token: c.token,
            expiresAt: new Date(c.expires_at * 1000),
          };
        },
        uploadData: async () => {},
      },
      { connectionMethod: "http", checkpointMode: "legacy" },
    );
    await db.waitForStatus(
      (s) => s.lastSyncedAt && new Date(s.lastSyncedAt).getTime() >= start,
      AbortSignal.timeout(90000),
    );
  } catch {
    throw Error(
      "Cloud download did not reach a complete checkpoint in 90 seconds. Local files are unchanged; check connectivity/login or retry later.",
    );
  } finally {
    await db.disconnect();
  }
}
export async function readCloud(store, { hold = false } = {}) {
  const c = credentials(store),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "deckmaster-sync-"));
  let db;
  try {
    db = await openDB(path.join(dir, "cache.sqlite"));
    await connect(db, store);
    const s = await capture(db, c.uid);
    store.backup(s, "cloud-read");
    if (hold)
      return {
        s,
        db,
        close: async () => {
          await db.close();
          fs.rmSync(dir, { recursive: true, force: true });
        },
      };
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    return s;
  } catch (e) {
    await db?.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}
export function policy(store) {
  const p = store.file("policy.json");
  return fs.existsSync(p) ? readJSON(p) : { protectedDecks: [] };
}
export function unresolved(store) {
  return store
    .receipts()
    .filter((r) =>
      [
        "sending",
        "response-received",
        "unresolved",
        "verification-failed",
      ].includes(r.status),
    );
}
export function unexpected(base, plan, observed) {
  const expected = applyOps(base, plan.operations),
    out = [];
  for (const table of Object.keys(expected.tables)) {
    const a = new Map(expected.tables[table].map((r) => [r.id, r])),
      b = new Map((observed.tables[table] ?? []).map((r) => [r.id, r]));
    for (const id of new Set([...a.keys(), ...b.keys()])) {
      const x = a.get(id),
        y = b.get(id);
      if (!x || !y) {
        out.push({ table, id, field: "row" });
        continue;
      }
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)]))
        if (canonical(x[k] ?? null) !== canonical(y[k] ?? null))
          out.push({ table, id, field: k });
    }
  }
  if (
    canonical(expected.untyped_tables ?? {}) !==
    canonical(observed.untyped_tables ?? {})
  )
    out.push({ table: "untyped", field: "rows" });
  return out;
}
export async function queue(db, ops) {
  await db.writeTransaction(async (tx) => {
    for (const o of ops) {
      if (o.op === "DELETE")
        await tx.execute(`DELETE FROM ${o.table} WHERE id=?`, [o.id]);
      else {
        const ks = Object.keys(o.data),
          vs = ks.map((k) => o.data[k]);
        if (ks.some((k) => !Object.hasOwn(columns[o.table], k)))
          throw Error("Unsupported SQL column");
        if (o.op === "PUT")
          await tx.execute(
            `INSERT INTO ${o.table} (id,${ks.join(",")}) VALUES (${[o.id, ...vs].map(() => "?").join(",")})`,
            [o.id, ...vs],
          );
        else
          await tx.execute(
            `UPDATE ${o.table} SET ${ks.map((k) => k + "=?").join(",")} WHERE id=?`,
            [...vs, o.id],
          );
      }
    }
  });
  const batch = await db.getCrudBatch(10001);
  if (!batch || batch.crud.length !== ops.length)
    throw Error("Generated write count differs from plan");
  const wire = batch.crud.map(wireEntry);
  for (let i = 0; i < wire.length; i++) {
    const a = wire[i],
      o = ops[i];
    if (a.op !== o.op || a.table !== o.table || a.id !== o.id)
      throw Error("Generated write differs from plan");
    const effective = Object.fromEntries(
      Object.entries(o.data ?? {}).filter(
        ([, v]) => o.op !== "PUT" || v !== null,
      ),
    );
    if (canonical(a.data ?? {}) !== canonical(effective))
      throw Error("Generated fields differ from plan");
  }
  return wire;
}
async function upload(store, wire, version) {
  const c = credentials(store);
  let response;
  try {
    response = await fetch("https://cloud.manabox.app/sync/upload", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: "Bearer " + c.token,
        "Content-Type": "application/json",
        "User-Agent": "ManaBox/4.2.1 PersonalInteroperability/0.1",
        "x-cards-db-version": String(version),
      },
      body: JSON.stringify(wire),
    });
  } catch {
    throw Error(
      "Upload outcome is uncertain. Run deckmaster receipts reconcile before any further write; it will not resend.",
    );
  }
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw Error(
      "Upload returned an unexpected response. Reconcile the receipt before writing again.",
    );
  }
  return {
    http_status: response.status,
    body,
    retry_after: response.headers.get("retry-after"),
  };
}
export async function sendPlan(
  store,
  catalog,
  plan,
  { read = readCloud, post = upload } = {},
) {
  const cooldown = store.file("upload-cooldown.json");
  if (fs.existsSync(cooldown) && readJSON(cooldown).until > Date.now())
    throw Error(
      "ManaBox requested a cooldown. Try again after " +
        new Date(readJSON(cooldown).until).toISOString(),
    );
  if (unresolved(store).length)
    throw Error(
      "An earlier upload needs reconciliation. Run deckmaster receipts reconcile.",
    );
  if (plan.version !== 1 || plan.uid !== store.account)
    throw Error("Plan version/account mismatch");
  if (!plan.operations.length) return { status: "no-changes" };
  let version = (await catalog.ensure()).version;
  const live = await read(store, { hold: true });
  const before = live.s;
  try {
    if (digest(before) !== plan.base_digest)
      throw Error(
        "Cloud changed since the plan was made. Run deckmaster pull and make a fresh plan.",
      );
    validatePlan(before, plan.operations, {
      ...policy(store),
      allowDelete: plan.allow_delete,
    });
    // Reject references missing from the real current catalog, including deck/folder images.
    for (const o of plan.operations)
      for (const k of [
        "dc_cv_id",
        "d_cv_id_image",
        "df_cv_id_image_1",
        "df_cv_id_image_2",
      ])
        if (o.data?.[k] != null && !catalog.lookup(o.data[k]))
          throw Error("Card reference missing from current catalog");
    const before_snapshot = store.backup(before, "before-write"),
      wire = await queue(live.db, plan.operations);
    const id =
        new Date().toISOString().replace(/[:.]/g, "-") +
        "-" +
        randomUUID().slice(0, 8),
      receiptFile = path.join(store.home, "receipts", id + ".json");
    const receipt = {
      id,
      status: "prepared",
      plan,
      before_snapshot,
      wire,
      attempts: [],
    };
    atomic(receiptFile, receipt, { exclusive: true });
    let result;
    for (let attempt = 0; attempt < 2; attempt++) {
      receipt.status = "sending";
      receipt.sent_at = new Date().toISOString();
      receipt.attempts.push({
        sent_at: receipt.sent_at,
        catalog_version: version,
      });
      atomic(receiptFile, receipt);
      try {
        result = await post(store, wire, version);
      } catch (e) {
        receipt.status = "unresolved";
        receipt.message = e.message;
        atomic(receiptFile, receipt);
        throw e;
      }
      if (result.http_status === 429)
        atomic(store.file("upload-cooldown.json"), {
          until: Date.now() + (retryDelay(result.retry_after) ?? 60000),
          reason: "ManaBox HTTP 429",
        });
      Object.assign(receipt.attempts.at(-1), result);
      receipt.status = "response-received";
      atomic(receiptFile, receipt);
      if (
        result.http_status === 400 &&
        result.body?.reason === "outdated_db" &&
        attempt === 0
      ) {
        const observed = await read(store);
        receipt.catalog_rejection_snapshot = store.backup(
          observed,
          "catalog-rejection",
        );
        if (digest(observed) !== digest(before)) {
          receipt.status = "unresolved";
          atomic(receiptFile, receipt);
          throw Error(
            "Cloud changed after catalog rejection; reconciliation required.",
          );
        }
        version = (await catalog.ensure({ force: true })).version;
        continue;
      }
      break;
    }
    const observed = await read(store);
    valid(observed);
    receipt.after_snapshot = store.backup(observed, "after-write");
    receipt.verification = verifyPlan(plan, observed);
    receipt.unexpected_changes = unexpected(before, plan, observed);
    const success =
      result.http_status >= 200 &&
      result.http_status < 300 &&
      (!result.body?.errors ||
        (Array.isArray(result.body.errors) && !result.body.errors.length));
    receipt.status =
      success && receipt.verification.ok && !receipt.unexpected_changes.length
        ? "verified"
        : !success && digest(before) === digest(observed)
          ? "rejected"
          : "verification-failed";
    atomic(receiptFile, receipt);
    if (receipt.status !== "verified") {
      if (result.http_status === 429)
        throw Error(
          `ManaBox rate limit: wait ${result.retry_after ?? "the indicated interval"} before trying again. No automatic write retry. Receipt: ${receiptFile}`,
        );
      throw Error(
        `Upload ${receipt.status} (HTTP ${result.http_status}). Inspect deckmaster receipts list / reconcile. Receipt: ${receiptFile}`,
      );
    }
    return {
      status: "verified",
      receipt: receiptFile,
      snapshot: observed,
      operations: wire.length,
    };
  } finally {
    await live.close();
  }
}
export async function reconcile(store, { acceptCurrent = false, reason } = {}) {
  const pending = unresolved(store);
  if (!pending.length) return [];
  const now = await readCloud(store),
    out = [];
  for (const r of pending) {
    const before = store.snapshot(r.before_snapshot),
      v = verifyPlan(r.plan, now),
      extra = unexpected(before, r.plan, now);
    r.verification = v;
    r.unexpected_changes = extra;
    r.after_snapshot = store.backup(now, "reconcile");
    if (v.ok && !extra.length) r.status = "verified";
    else if (
      digest(before) === digest(now) &&
      r.attempts.at(-1)?.http_status >= 400 &&
      r.attempts.at(-1)?.http_status < 500
    )
      r.status = "rejected";
    else r.status = "unresolved";
    if (r.status === "unresolved" && acceptCurrent) {
      if (!reason?.trim())
        throw Error("Provide --reason when accepting a partial result");
      if (!r.attempts.at(-1)?.http_status)
        throw Error(
          "The upload has no HTTP response; its outcome remains uncertain. Do not automatically acknowledge or resend.",
        );
      r.status = "accepted-current";
      r.accepted_current = {
        at: new Date().toISOString(),
        reason,
        snapshot: r.after_snapshot,
      };
    }
    const { file, ...data } = r;
    atomic(file, data);
    out.push({
      file,
      status: r.status,
      desired_values_observed: v.ok,
      unexpected_changes: extra.length,
      operations: v.operations,
    });
  }
  return out;
}
