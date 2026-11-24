import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { atomic, read, hash } from "./store.mjs";
import { get } from "./network.mjs";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function sqlcipher(store) {
  const candidates = [
    process.env.MANABOX_SQLCIPHER,
    store.file("bin", "sqlcipher"),
    "/opt/homebrew/bin/sqlcipher",
    "/usr/local/bin/sqlcipher",
    "/usr/bin/sqlcipher",
  ].filter(Boolean);
  for (const p of candidates) if (fs.existsSync(p)) return p;
  try {
    const p = execFileSync("which", ["sqlcipher"], { encoding: "utf8" }).trim();
    if (p) return p;
  } catch {}
  throw Error(
    "SQLCipher is needed for catalog updates. Install it (macOS: brew install sqlcipher), or set MANABOX_SQLCIPHER to its executable.",
  );
}
export class Catalog {
  constructor(store) {
    this.store = store;
    this.dir = store.file("catalog");
    this.pointer = path.join(this.dir, "current.json");
  }
  current() {
    if (!fs.existsSync(this.pointer))
      throw Error("Card catalog missing. Run deckmaster catalog update.");
    const p = read(this.pointer);
    const file = path.join(this.dir, p.file);
    return { ...p, path: file };
  }
  open() {
    const c = this.current(),
      db = new Database(c.path, { readonly: true, fileMustExist: true });
    if (
      db.prepare("select updated_at from metadata").pluck().get() !== c.version
    ) {
      db.close();
      throw Error("Catalog version mismatch. Run deckmaster catalog update --force.");
    }
    return db;
  }
  async ensure({
    force = false,
    fetcher = get,
    decryptor = decryptCatalog,
  } = {}) {
    let manifest, origin;
    for (const base of [
      "https://files2.manabox.app/",
      "https://cloud-alt.manabox.app/files/",
    ]) {
      try {
        manifest = await fetcher(base + "update_assets_metadata.json");
        origin = base;
        break;
      } catch (e) {
        if (base.includes("cloud-alt"))
          throw Error("Cannot verify current catalog: " + e.message);
      }
    }
    const spec = manifest?.cards?.versions?.find((v) => v.version === 12),
      version = manifest?.cardsPatches?.lastDataVersion;
    if (
      !spec ||
      manifest.cardsPatches.schemaVersion !== 12 ||
      !Number.isSafeInteger(version) ||
      !/^cards\/12\/cards_\d+\.db\?[a-zA-Z0-9_]+$/.test(spec.path)
    )
      throw Error(
        "Unsupported catalog manifest/schema. No cloud write will be sent.",
      );
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (!force && fs.existsSync(this.pointer)) {
      try {
        const c = this.current();
        const db = this.open();
        try {
          if (
            c.version === version &&
            db.pragma("quick_check", { simple: true }) === "ok" &&
            hash(fs.readFileSync(c.path)) === c.sha256
          )
            return { ...c, updated: false };
        } finally {
          db.close();
        }
      } catch {}
    }
    const binary = sqlcipher(this.store),
      tmp = fs.mkdtempSync(path.join(this.dir, "download-")),
      encrypted = path.join(tmp, "cards.db"),
      output = path.join(tmp, "readable.sqlite");
    try {
      // The public file host sometimes rejects non-Dart UAs; use the app's documented fallback.
      let bytes;
      try {
        bytes = await fetcher(origin + spec.path, { binary: true });
      } catch {
        bytes = await fetcher(
          (origin.includes("cloud-alt")
            ? "https://files2.manabox.app/"
            : "https://cloud-alt.manabox.app/files/") + spec.path,
          { binary: true },
        );
      }
      atomic(encrypted, bytes);
      const v = Number(decryptor(binary, encrypted, output));
      if (v !== version)
        throw Error("Downloaded catalog version does not match manifest");
      const db = new Database(output, { readonly: true });
      try {
        for (const t of ["cards", "card_versions", "sets", "card_faces"])
          if (
            !db
              .prepare(
                `select 1 from sqlite_master where type='table' and name=?`,
              )
              .get(t)
          )
            throw Error("Missing catalog table: " + t);
        if (db.pragma("quick_check", { simple: true }) !== "ok")
          throw Error("Catalog integrity check failed");
      } finally {
        db.close();
      }
      const data = fs.readFileSync(output),
        sha256 = hash(data),
        file = `cards-${version}-${sha256.slice(0, 12)}.sqlite`;
      const finalPath = path.join(this.dir, file);
      if (
        fs.existsSync(finalPath) &&
        hash(fs.readFileSync(finalPath)) !== sha256
      ) {
        fs.renameSync(finalPath, finalPath + ".corrupt-" + Date.now());
      }
      if (!fs.existsSync(finalPath))
        atomic(finalPath, data, { exclusive: true });
      const metadata = {
        version,
        file,
        sha256,
        encrypted_sha256: hash(bytes),
        manifest_url: origin + "update_assets_metadata.json",
        source_url: origin + spec.path,
        checked_at: new Date().toISOString(),
      };
      atomic(path.join(this.dir, `manifest-${version}.json`), manifest);
      atomic(this.pointer, metadata);
      this.close();
      return { ...metadata, path: path.join(this.dir, file), updated: true };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  // One read-only connection and memoized rows per process; the catalog file is immutable.
  get db() {
    return (this._db ??= this.open());
  }
  close() {
    this._db?.close();
    this._db = undefined;
    this._refs = undefined;
  }
  lookup(id) {
    const refs = (this._refs ??= new Map());
    if (!refs.has(id)) refs.set(id, lookup(this.db, id));
    return refs.get(id);
  }
  resolve(name, { set, number } = {}) {
    const db = this.db;
    if (set) {
      const rows = db.prepare(
        `select cv.cv_id from card_versions cv join cards c on c.c_oracle_id=cv.cv_oracle_id where c.c_name=? collate nocase and cv.cv_set_id=? collate nocase and cv.cv_digital=0 and cv.cv_oversized=0` +
        (number ? " and cv.cv_collector_number=? collate nocase" : ""),
      ).all(...(number ? [name, set, number] : [name, set]));
      if (rows.length !== 1) throw Error("Printing not found or ambiguous: " + name + " (" + set + ") " + (number ?? "") + ". Supply an exact set and collector number; no default substituted.");
      return this.lookup(rows[0].cv_id);
    }
    const rows = db
      .prepare(
        `select cv.cv_id,cv.cv_oracle_id,c.c_layout from card_versions cv join cards c on c.c_oracle_id=cv.cv_oracle_id where c.c_name=? collate nocase and cv.cv_non_foil=1 and cv.cv_digital=0 and cv.cv_oversized=0 order by cv.cv_priority,cv.cv_promo,cv.cv_id`,
      )
      .all(name);
    if (!rows.length)
      throw Error(
        "Card not in current ManaBox catalog: " +
          name +
          ". Use deckmaster catalog update; names must be exact.",
      );
    // ManaBox schema 12: layouts 10 and 11 are token and double-faced
    // token. Never default to a namesake token ahead of the actual card.
    // Explicit set/number resolution above remains exact, including tokens.
    const cards = rows.filter((row) => ![10, 11].includes(row.c_layout));
    const candidates = cards.length ? cards : rows;
    if (new Set(candidates.map((row) => row.cv_oracle_id)).size !== 1)
      throw Error(
        "Card name is ambiguous: " + name +
        ". Supply an exact set and collector number; no default substituted.",
      );
    return this.lookup(candidates[0].cv_id);
  }
}
const statements = new WeakMap();
export function lookup(db, id) {
  let statement = statements.get(db);
  if (!statement) {
    statement = db.prepare(
      `select cv.*,c.*,s.s_name from card_versions cv join cards c on c.c_oracle_id=cv.cv_oracle_id join sets s on s.s_id=cv.cv_set_id where cv_id=?`,
    );
    statements.set(db, statement);
  }
  return statement.get(id) ?? null;
}

export function decryptCatalog(binary, encrypted, output) {
  return execFileSync(
    "python3",
    [path.join(root, "python/decrypt.py"), encrypted, output, binary],
    { encoding: "utf8", timeout: 200000, stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}
