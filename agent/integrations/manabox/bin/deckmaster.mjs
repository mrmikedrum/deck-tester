#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { Store, atomic, read, digest, hash } from "../lib/store.mjs";
import { Catalog, sqlcipher } from "../lib/catalog.mjs";
import {
  credentials,
  login,
  policy,
  reconcile,
  unresolved,
} from "../lib/cloud.mjs";
import * as M from "../lib/model.mjs";
import {
  deckDocument,
  textList,
  parseList,
  materialize,
} from "../lib/library.mjs";
import { pull, local, mutate, prepare, apply } from "../lib/workshop.mjs";
import { checkDeck } from "../lib/facts.mjs";
import { refine, refinementReview, revertRefinement, reviseRefinement, signOffRefinements } from "../lib/refinements.mjs";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HELP = `deckmaster — Commander workshop (local iteration; explicit push checkpoint)

  deckmaster login --email EMAIL                Google sign-in; credentials stay private
  deckmaster doctor                             Check login, catalog, snapshots, pending receipts
  deckmaster pull                               Refresh cloud mirror; preserve local drafts
  deckmaster diff                               Inspect pending local/file changes
  deckmaster refine --file FILE                 Apply one reasoned refinement: any number of adds/sets/removes/moves across decks
  deckmaster review                            Return pending decisions, reasoning, changes and advisory warnings
  deckmaster review --reason TEXT              Record a brief whole-pass self-review; does the combined result serve the vision?
  deckmaster refine --revert ID --reason TEXT   Reconsider a decision without overwriting subsequent edits
  deckmaster refine --update ID --file FILE     Replace a package and replay the active pass
  deckmaster refine --delete ID                Remove a package and replay the remaining pass
  deckmaster review --finalize                  Merge phone edits and prepare a reviewed publication plan
  deckmaster review --finalize --plan FILE      Publish the reviewed pass; retain history on verified success
  deckmaster review --history [--deck DECK]     Read completed passes and their decision trails
  deckmaster push [--dry-run] [--allow-delete]    Checkpoint ALL pending edits to ManaBox
  deckmaster push --plan FILE                   Send a previously reviewed, unchanged plan

  deckmaster decks list [--folder Claw] [--recursive]
  deckmaster deck show DECK [--tag TAG]
  deckmaster deck create NAME [--commander CARD] [--folder Claw]
  deckmaster deck copy DECK --name NAME [--folder Claw]
  deckmaster deck rename DECK --name NAME
  deckmaster deck move DECK --folder PATH        Use / for the account root
  deckmaster deck notes DECK --text TEXT         Or --file FILE
  deckmaster deck import DECK --file FILE [--replace] [--folder Claw]
  deckmaster deck export DECK [--format text|enriched|json] [--output FILE]
  deckmaster deck check DECK [--force]           Current Scryfall basic Commander checks
  deckmaster deck delete DECK --confirm-delete EXACT_NAME

  deckmaster card add CARD --deck DECK [--quantity 1] [--board main]
  deckmaster card set CARD --deck DECK --quantity N [--board main]
  deckmaster card remove CARD --deck DECK [--quantity 1 | --all] [--board main]
  deckmaster card move CARD --deck DECK --to maybe [--board main]

  deckmaster folders list
  deckmaster folder create PATH                 Creates missing parent folders
  deckmaster folder rename PATH --name NAME
  deckmaster folder move PATH --to PARENT        / means root
  deckmaster folder delete PATH --confirm-delete EXACT_NAME   Empty folders only

  deckmaster tags list [--deck DECK]
  deckmaster tag create NAME
  deckmaster tag rename TAG --name NAME          Shared definition: affects every assignment
  deckmaster tag add TAG --deck DECK --card CARD [--board main]
  deckmaster tag remove TAG --deck DECK --card CARD [--board main]
  deckmaster tag delete TAG                      Unused tags only

  deckmaster catalog status | update [--force]
  deckmaster snapshots list | show HASH | restore HASH
  deckmaster receipts list | reconcile           Reconcile never resends a write
  deckmaster receipts reconcile --accept-current --reason TEXT   Acknowledge a known partial response

Global options (anywhere):
  --offline     Local reads/edits (now the default); deck check still needs Scryfall
  --dry-run     Preview a mutation without changing local or cloud data
  --json        Machine-readable output and errors
  --repo PATH   Workshop repository (or MTG_DECKS_REPO)
  --state PATH  Private state directory (or MANABOX_STATE_DIR)

Deck selectors: exact ID, exact name, or Folder/Subfolder/Deck name.
Boards: main, commander, side, maybe. Existing printings/finishes are preserved.
Use --cv-id NUMBER and/or --finish normal|foil|etched to disambiguate a card.
New decks default to Claw. Commands with spaces require shell quotes.
Names must match the catalog exactly; use the workshop's Scryfall tool to search.
Local files: decks/manabox/library.json and */deck.json (deck.txt is generated).
Run pull explicitly to merge phone/cloud changes. Ordinary reads and edits stay local.
Never manually alter ManaBox databases or private workspace/snapshot/receipt files.
Snapshots are compressed, content-addressed, retained forever; no automatic pruning.
`;
const optionTypes = {
  json: "boolean",
  offline: "boolean",
  "dry-run": "boolean",
  recursive: "boolean",
  force: "boolean",
  all: "boolean",
  replace: "boolean",
  "no-open": "boolean",
  help: "boolean",
  "accept-current": "boolean",
  "allow-delete": "boolean",
  reason: "string",
  repo: "string",
  state: "string",
  email: "string",
  name: "string",
  folder: "string",
  commander: "string",
  text: "string",
  file: "string",
  deck: "string",
  card: "string",
  tag: "string",
  quantity: "string",
  board: "string",
  to: "string",
  format: "string",
  output: "string",
  "cv-id": "string",
  finish: "string",
  "confirm-delete": "string",
  plan: "string",
  revert: "string",
  finalize: "boolean",
  history: "boolean",
  update: "string",
  delete: "string",
};
const commandOptions = {
  login: ["email", "no-open"],
  doctor: [],
  pull: [],
  diff: [],
  refine: ["file", "revert", "reason", "update", "delete"],
  review: ["finalize", "plan", "history", "deck", "reason"],
  push: ["plan", "allow-delete"],
  "decks list": ["folder", "recursive"],
  "deck show": ["tag"],
  "deck create": ["commander", "folder"],
  "deck copy": ["name", "folder"],
  "deck rename": ["name"],
  "deck move": ["folder"],
  "deck notes": ["text", "file"],
  "deck import": ["file", "replace", "folder"],
  "deck export": ["format", "output"],
  "deck check": ["force"],
  "deck delete": ["confirm-delete"],
  "card add": ["deck", "quantity", "board"],
  "card set": ["deck", "quantity", "board", "cv-id", "finish"],
  "card remove": ["deck", "quantity", "board", "all", "cv-id", "finish"],
  "card move": ["deck", "board", "to", "cv-id", "finish"],
  "folders list": [],
  "folder create": [],
  "folder rename": ["name"],
  "folder move": ["to"],
  "folder delete": ["confirm-delete"],
  "tags list": ["deck"],
  "tag create": [],
  "tag rename": ["name"],
  "tag add": ["deck", "card", "board", "cv-id", "finish"],
  "tag remove": ["deck", "card", "board", "cv-id", "finish"],
  "tag delete": [],
  "catalog status": [],
  "catalog update": ["force"],
  "snapshots list": [],
  "snapshots show": [],
  "snapshots restore": [],
  "receipts list": [],
  "receipts reconcile": ["accept-current", "reason"],
};
let json = process.argv.includes("--json");
function emit(value) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (typeof value === "string") {
    console.log(value);
    return;
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      console.log("(none)");
      return;
    }
    for (const r of value)
      console.log(
        typeof r === "string"
          ? r
          : Object.entries(r)
              .filter(([, v]) => v !== undefined && v !== null)
              .map(
                ([k, v]) =>
                  `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`,
              )
              .join(" | "),
      );
  } else console.log(JSON.stringify(value, null, 2));
}
async function main() {
  const parsed = parseArgs({
    options: Object.fromEntries(
      Object.entries(optionTypes).map(([k, type]) => [k, { type }]),
    ),
    allowPositionals: true,
    strict: true,
  });
  const o = parsed.values;
  json = !!o.json;
  if (o.help || !parsed.positionals.length) {
    console.log(HELP);
    return;
  }
  const [group, action, ...rest] = parsed.positionals,
    top = ["login", "doctor", "pull", "diff", "push", "refine", "review"].includes(group),
    key = top ? group : group + " " + action,
    args = top ? [action, ...rest].filter((v) => v !== undefined) : rest;
  if (!Object.hasOwn(commandOptions, key))
    throw Error("Unknown command. Run deckmaster --help.");
  for (const k of Object.keys(o))
    if (
      !["json", "offline", "dry-run", "repo", "state"].includes(k) &&
      !commandOptions[key].includes(k)
    )
      throw Error(`--${k} does not apply to ${key}`);
  const expected = [
    "deck show",
    "deck create",
    "deck copy",
    "deck rename",
    "deck move",
    "deck notes",
    "deck import",
    "deck export",
    "deck check",
    "deck delete",
    "card add",
    "card set",
    "card remove",
    "card move",
    "folder create",
    "folder rename",
    "folder move",
    "folder delete",
    "tag create",
    "tag rename",
    "tag add",
    "tag remove",
    "tag delete",
    "snapshots show",
    "snapshots restore",
  ].includes(key)
    ? 1
    : 0;
  if (args.length !== expected)
    throw Error(
      `${key} expects ${expected} positional argument${expected === 1 ? "" : "s"}. Run deckmaster --help.`,
    );
  const requireOpt = (k) => {
    if (o[k] === undefined || o[k] === "") throw Error("Missing --" + k);
    return o[k];
  };
  const store = new Store({ state: o.state, repo: o.repo }),
    catalog = new Catalog(store);
  await store.lock(async () => {
    if (key === "login") {
      login(store, requireOpt("email"), o["no-open"]);
      emit({ status: "signed-in" });
      return;
    }
    if (key === "doctor") {
      const report = {
        node: process.version,
        repo: store.repo,
        state: store.state,
        cloud_default: false,
        registration: "Not used",
        checks: [],
      };
      for (const [name, fn] of [
        [
          "python",
          () =>
            execFileSync("python3", ["--version"], { encoding: "utf8" }).trim(),
        ],
        ["sqlcipher", () => sqlcipher(store)],
        [
          "session",
          () => {
            credentials(store);
            return "Authenticated / refresh available";
          },
        ],
        [
          "catalog",
          () => {
            const db = catalog.open();
            try {
              return {
                ...catalog.current(),
                integrity: db.pragma("quick_check", { simple: true }),
              };
            } finally {
              db.close();
            }
          },
        ],
        [
          "snapshots",
          () => {
            const all = store.snapshots();
            for (const s of all) store.snapshot(s.id);
            return {
              count: all.length,
              total_bytes: all.reduce((n, s) => n + s.bytes, 0),
              retention: "forever",
            };
          },
        ],
        ["receipts", () => ({ unresolved: unresolved(store).length })],
      ]) {
        try {
          report.checks.push({ name, ok: true, result: fn() });
        } catch (e) {
          report.checks.push({ name, ok: false, message: e.message });
        }
      }
      emit(report);
      if (report.checks.some((c) => !c.ok)) process.exitCode = 1;
      return;
    }
    if (key === "catalog update") {
      emit(await catalog.ensure({ force: o.force }));
      return;
    }
    if (key === "catalog status") {
      emit(catalog.current());
      return;
    }
    if (key === "receipts reconcile") {
      emit(
        await reconcile(store, {
          acceptCurrent: o["accept-current"],
          reason: o.reason,
        }),
      );
      return;
    }
    if (key === "receipts list") {
      emit(
        store.receipts().map((r) => ({
          file: r.file,
          status: r.status,
          operations: r.plan.operations.length,
          http_status: r.attempts.at(-1)?.http_status,
        })),
      );
      return;
    }
    if (key === "snapshots list") {
      emit(store.snapshots());
      return;
    }
    if (key === "snapshots show") {
      const s = store.snapshot(args[0]);
      emit({
        captured_at: s.captured_at,
        tables: Object.fromEntries(
          Object.entries(s.tables).map(([t, rs]) => [t, rs.length]),
        ),
      });
      return;
    }
    if (key === "snapshots restore") {
      const w = local(store, catalog),
        s = store.snapshot(args[0]);
      M.valid(s);
      const proposed = M.compilePlan(w.base, s, {
        ...policy(store),
        allowDelete: false,
      });
      if (o["dry-run"]) {
        emit({
          status: "preview-local-restore",
          operations: proposed.operations,
        });
        return;
      }
      store.backup(w.working, "before-local-restore");
      w.working = s;
      store.saveWorkspace(w);
      materialize(store, w, catalog);
      emit({
        status: "restored-locally",
        changes: proposed.operations.length,
        next: "deckmaster diff, then deckmaster push when ready",
      });
      return;
    }
    if (key === "pull") {
      if (o.offline) throw Error("pull needs cloud access");
      await catalog.ensure();
      const w = await pull(store, catalog);
      emit({
        status: "synced",
        decks: w.working.tables.decks.length,
        folders: w.working.tables.decks_folders.length,
        tags: w.working.tables.deck_card_tags.length,
        pending_local_changes: M.diff(w.base, w.working).length,
        library: store.library,
      });
      return;
    }
    if (key === "review") {
      const w = local(store, catalog);
      if ((o.history && (o.finalize || o.plan || o.reason)) || (o.deck && !o.history) || (o.plan && (!o.finalize || o.reason))) throw Error("Use review --history [--deck], review [--reason TEXT], or review --finalize [--reason TEXT | --plan FILE]");
      if (o.history) {
        const id = o.deck ? M.resolveDeck(w.working, o.deck).id : null;
        emit((w.refinement_history ?? []).filter((pass) => !id || pass.deck_ids.includes(id)));
        return;
      }
      if (o.finalize) {
        if (o.offline) throw Error("Finalization requires cloud access");
        if (o.plan) {
          const plan = read(path.resolve(o.plan));
          emit(o["dry-run"] ? { status: "preview", operations: plan.operations, refinement_review: plan.refinement_review } : await apply(store, catalog, plan));
        } else {
          await catalog.ensure();
          const refreshed = await pull(store, catalog);
          if (o.reason) {
            signOffRefinements(refreshed, o.reason);
            store.saveWorkspace(refreshed);
          }
          const prepared = await prepare(store, catalog, refreshed);
          emit({ status: "preview", plan_file: prepared.file, operations: prepared.plan.operations, refinement_review: prepared.plan.refinement_review });
        }
        return;
      }
      if (o.reason) signOffRefinements(w, o.reason);
      const review = refinementReview(w);
      if (!o["dry-run"]) {
        w.refinements_reviewed = (w.refinements ?? []).length;
        store.saveWorkspace(w);
      }
      emit(review);
      return;
    }
    if (key === "refine") {
      if (o.update || o.delete) {
        if ((o.update && o.delete) || o.revert || o.reason || (o.delete && o.file)) throw Error("Use refine --update ID --file FILE or refine --delete ID");
        const workspace = local(store, catalog);
        const revisedPass = reviseRefinement(workspace, catalog, o.update ?? o.delete, o.update ? read(path.resolve(requireOpt("file"))) : null);
        const result = await mutate(store, catalog, (state) => {
          Object.assign(state, revisedPass.working);
          return { updated: o.update, deleted: o.delete };
        }, { offline: true, dryRun: o["dry-run"], revisedPass });
        emit({ ...result, refinement_review: refinementReview({ ...workspace, ...revisedPass }) });
        return;
      }
      if (!!o.file === !!o.revert || (o.reason && !o.revert)) throw Error("Use refine --file FILE or refine --revert ID --reason TEXT");
      const input = o.file ? read(path.resolve(o.file)) : null;
      const workspace = o.revert ? local(store, catalog) : null;
      emit(await mutate(store, catalog, (state) => o.revert ? revertRefinement(workspace, state, o.revert, o.reason) : refine(state, catalog, input), {
        offline: true, dryRun: o["dry-run"], refinement: true,
      }));
      return;
    }
    if (key === "diff") {
      const w = local(store, catalog);
      emit(M.diff(w.base, w.working));
      return;
    }
    if (key === "push") {
      if (o.offline) throw Error("push requires cloud access");
      if (o.plan) {
        const plan = read(path.resolve(o.plan));
        if (o["dry-run"]) {
          emit({
            status: "preview",
            plan_file: path.resolve(o.plan),
            operations: plan.operations,
            refinement_review: plan.refinement_review,
          });
          return;
        }
        emit(await apply(store, catalog, plan));
        return;
      }
      await catalog.ensure();
      const w = await pull(store, catalog),
        p = await prepare(store, catalog, w, { allowDelete: o["allow-delete"] });
      if (o["dry-run"])
        emit({
          status: "preview",
          plan_file: p.file,
          operations: p.plan.operations,
          refinement_review: p.plan.refinement_review,
        });
      else emit(await apply(store, catalog, p.plan));
      return;
    }
    const isRead = [
      "decks list",
      "deck show",
      "deck export",
      "deck check",
      "folders list",
      "tags list",
    ].includes(key);
    async function state() {
      return local(store, catalog).working;
    }
    if (isRead) {
      const s = await state();
      if (key === "decks list") {
        let ds = s.tables.decks;
        if (o.folder !== undefined) {
          const f = M.resolveFolder(s, o.folder),
            id = f?.id ?? null;
          ds = ds.filter(
            (d) =>
              d.d_parent_folder === id ||
              (o.recursive &&
                id !== null &&
                M.folderPath(s, d.d_parent_folder).startsWith(
                  M.folderPath(s, id) + "/",
                )),
          );
        }
        emit(
          ds.map((d) => ({
            id: d.id,
            name: d.d_name,
            folder: M.folderPath(s, d.d_parent_folder),
            format: d.d_format === 4 ? "commander" : d.d_format,
            cards: s.tables.deck_cards
              .filter(
                (c) =>
                  c.dc_d_id === d.id && [0, 2].includes(c.dc_board_category),
              )
              .reduce((n, c) => n + c.dc_quantity + c.dc_proxy_qty, 0),
            locked: d.d_locked === 1,
          })),
        );
        return;
      }
      if (key === "folders list") {
        emit(
          s.tables.decks_folders.map((f) => ({
            id: f.id,
            path: M.folderPath(s, f.id),
            decks: s.tables.decks.filter((d) => d.d_parent_folder === f.id)
              .length,
          })),
        );
        return;
      }
      if (key === "tags list") {
        let tags = s.tables.deck_card_tags;
        if (o.deck) {
          const d = M.resolveDeck(s, o.deck),
            ids = new Set(
              s.tables.deck_card_tags_rel
                .filter((r) => r.dctr_dc_d_id === d.id)
                .map((r) => r.dctr_dct_id),
            );
          tags = tags.filter((t) => ids.has(t.id));
        }
        emit(
          tags.map((t) => ({
            id: t.id,
            name: t.dct_name,
            assignments: s.tables.deck_card_tags_rel.filter(
              (r) => r.dctr_dct_id === t.id,
            ).length,
          })),
        );
        return;
      }
      const d = M.resolveDeck(s, args[0]),
        doc = deckDocument(s, d, catalog);
      if (key === "deck check") {
        const report = await checkDeck(store, doc, { force: o.force });
        emit(report);
        if (report.issues.length) process.exitCode = 2;
        return;
      }
      if (o.tag) {
        const t = M.resolveTag(s, o.tag);
        doc.cards = doc.cards.filter((c) => c.tags.includes(t.id));
      }
      if (key === "deck show") {
        emit({
          ...doc,
          tag_names: Object.fromEntries(
            s.tables.deck_card_tags.map((t) => [t.id, t.dct_name]),
          ),
        });
        return;
      }
      const format = o.format ?? "text";
      if (!["text", "enriched", "json"].includes(format))
        throw Error("Export format must be text, enriched or json");
      const data =
        format === "json" ? JSON.stringify(doc, null, 2) + "\n" : textList(doc, {
          enriched: format === "enriched", repo: store.repo, state: store.state, catalog,
          tagNames: Object.fromEntries(s.tables.deck_card_tags.map((tag) => [tag.id, tag.dct_name])),
        });
      if (o.output) {
        atomic(path.resolve(o.output), data, { exclusive: true });
        emit({ output: path.resolve(o.output), format });
      } else if (json) emit({ format, content: data });
      else process.stdout.write(data);
      return;
    }
    const mutationOptions = {
      offline: true,
      dryRun: o["dry-run"],
      allowDelete: key === "deck delete",
    };
    const result = await mutate(
      store,
      catalog,
      async (s) => {
        const deck = () =>
          M.resolveDeck(
            s,
            key.startsWith("card ") || key === "tag add" || key === "tag remove"
              ? requireOpt("deck")
              : args[0],
          );
        const card = (d, name = args[0]) => {
          let rows = s.tables.deck_cards.filter(
            (c) =>
              c.dc_d_id === d.id && c.dc_board_category === M.board(o.board),
          );
          if (o["cv-id"] !== undefined) {
            const id = Number(o["cv-id"]);
            if (!Number.isSafeInteger(id) || id < 0)
              throw Error("Invalid --cv-id");
            rows = rows.filter((c) => c.dc_cv_id === id);
          } else
            rows = rows.filter(
              (c) =>
                catalog.lookup(c.dc_cv_id)?.c_name.toLowerCase() ===
                name.toLowerCase(),
            );
          if (o.finish) {
            const finishes = { normal: 0, foil: 1, etched: 2 };
            if (!Object.hasOwn(finishes, o.finish))
              throw Error("Finish must be normal, foil, or etched");
            rows = rows.filter((c) => c.dc_foil === finishes[o.finish]);
          }
          if (rows.length !== 1)
            throw Error(
              rows.length
                ? "Multiple printings/finishes match. Use --cv-id or --finish."
                : "Card not found on selected board",
            );
          return rows[0];
        };
        if (key === "deck create") {
          const c = o.commander ? catalog.resolve(o.commander) : null;
          const d = M.createDeck(s, args[0], {
            folder: o.folder ?? "Claw",
            commander: c,
          });
          return { id: d.id, name: d.d_name };
        }
        if (key === "deck copy") {
          const d = M.copyDeck(
            s,
            deck(),
            M.named(requireOpt("name")),
            o.folder ?? "Claw",
          );
          return { id: d.id, name: d.d_name };
        }
        if (key === "deck rename") {
          const d = deck();
          M.editable(s, d);
          d.d_name = M.named(requireOpt("name"));
          M.touch(d);
          return { name: d.d_name };
        }
        if (key === "deck move") {
          const d = deck();
          M.editable(s, d);
          const ref = requireOpt("folder");
          d.d_parent_folder = ref === "/" ? null : M.createFolder(s, ref).id;
          M.touch(d);
          return { folder: M.folderPath(s, d.d_parent_folder) };
        }
        if (key === "deck notes") {
          const d = deck();
          M.editable(s, d);
          if ((o.text !== undefined) === (o.file !== undefined))
            throw Error("Provide exactly one of --text or --file");
          d.d_notes = o.file
            ? fs.readFileSync(path.resolve(o.file), "utf8")
            : o.text;
          M.touch(d);
          return { name: d.d_name };
        }
        if (key === "deck import") {
          const rows = parseList(
            fs.readFileSync(path.resolve(requireOpt("file")), "utf8"),
          );
          let d;
          try {
            d = deck();
          } catch (e) {
            if (!e.message.startsWith("Deck not found")) throw e;
            d = M.createDeck(s, args[0], { folder: o.folder ?? "Claw" });
          }
          M.importList(s, d, rows, catalog, { replace: o.replace });
          return { id: d.id, name: d.d_name, entries: rows.length };
        }
        if (key === "deck delete") {
          const d = deck();
          if (requireOpt("confirm-delete") !== d.d_name)
            throw Error("--confirm-delete must exactly match the deck name");
          M.removeDeck(s, d);
          return { deleted: d.d_name };
        }
        if (key === "card add") {
          const d = deck(),
            c = catalog.resolve(args[0]),
            b = M.board(o.board);
          const existing = s.tables.deck_cards.filter(
            (r) =>
              r.dc_d_id === d.id &&
              r.dc_board_category === b &&
              r.dc_foil === 0 &&
              catalog.lookup(r.dc_cv_id)?.cv_oracle_id === c.cv_oracle_id,
          );
          if (existing.length > 1)
            throw Error(
              "Multiple printings match; use card set --cv-id to change a quantity",
            );
          M.addCard(
            s,
            d,
            existing[0]?.dc_cv_id ?? c.cv_id,
            M.quantity(o.quantity ?? 1),
            b,
          );
          return { deck: d.d_name, card: c.c_name };
        }
        if (key === "card set") {
          const d = deck(),
            c = card(d);
          M.setCard(s, d, c, M.quantity(requireOpt("quantity")));
          return { deck: d.d_name };
        }
        if (key === "card remove") {
          const d = deck(),
            c = card(d);
          if (o.all && o.quantity) throw Error("Use --all or --quantity");
          if (o.all) M.deleteCard(s, d, c);
          else {
            const q = M.quantity(o.quantity ?? 1);
            if (!q || q > c.dc_quantity)
              throw Error(
                "Removal exceeds real quantity; use --all to remove proxies too",
              );
            M.setCard(s, d, c, c.dc_quantity - q);
          }
          return { deck: d.d_name };
        }
        if (key === "card move") {
          const d = deck(),
            c = card(d);
          M.moveCard(s, d, c, M.board(requireOpt("to")));
          return { deck: d.d_name, to: o.to };
        }
        if (key === "folder create") {
          const f = M.createFolder(s, args[0]);
          return { id: f.id, path: M.folderPath(s, f.id) };
        }
        if (key === "folder rename") {
          const f = M.resolveFolder(s, args[0]);
          if (!f) throw Error("Root cannot be renamed");
          f.df_name = M.named(requireOpt("name"));
          if (f.df_name.includes("/"))
            throw Error("Folder name cannot contain /");
          return { path: M.folderPath(s, f.id) };
        }
        if (key === "folder move") {
          const f = M.resolveFolder(s, args[0]);
          if (!f) throw Error("Root cannot be moved");
          const dest = M.resolveFolder(s, requireOpt("to"));
          f.df_parent_folder = dest?.id ?? null;
          M.valid(s);
          return { path: M.folderPath(s, f.id) };
        }
        if (key === "folder delete") {
          const f = M.resolveFolder(s, args[0]);
          if (!f || requireOpt("confirm-delete") !== f.df_name)
            throw Error("Confirm the exact folder name");
          if (
            s.tables.decks.some((d) => d.d_parent_folder === f.id) ||
            s.tables.decks_folders.some((d) => d.df_parent_folder === f.id)
          )
            throw Error("Only empty folders may be deleted");
          s.tables.decks_folders = s.tables.decks_folders.filter(
            (r) => r.id !== f.id,
          );
          return { deleted: f.df_name };
        }
        if (key === "tag create") {
          const t = M.createTag(s, args[0]);
          return { id: t.id, name: t.dct_name };
        }
        if (key === "tag rename") {
          const t = M.resolveTag(s, args[0]);
          t.dct_name = M.named(requireOpt("name"));
          return { id: t.id, name: t.dct_name };
        }
        if (key === "tag add") {
          const d = deck();
          M.editable(s, d);
          const c = card(d, requireOpt("card")),
            t = M.createTag(s, args[0]);
          M.tagCard(s, c, t.id);
          M.touch(d);
          return { tag: t.dct_name, deck: d.d_name };
        }
        if (key === "tag remove") {
          const d = deck();
          M.editable(s, d);
          const c = card(d, requireOpt("card")),
            t = M.resolveTag(s, args[0]);
          s.tables.deck_card_tags_rel = s.tables.deck_card_tags_rel.filter(
            (r) => r.id !== t.id + "." + c.id,
          );
          M.touch(d);
          return { tag: t.dct_name, deck: d.d_name };
        }
        if (key === "tag delete") {
          const t = M.resolveTag(s, args[0]);
          if (s.tables.deck_card_tags_rel.some((r) => r.dctr_dct_id === t.id))
            throw Error("Tag is still assigned; remove its assignments first");
          s.tables.deck_card_tags = s.tables.deck_card_tags.filter(
            (r) => r.id !== t.id,
          );
          return { deleted: t.dct_name };
        }
        throw Error("Command not implemented");
      },
      mutationOptions,
    );
    emit(result);
  });
}
main().catch((e) => {
  const message =
    e?.stdout || e?.stderr
      ? "A private helper failed. Run deckmaster doctor; credentials were not printed."
      : e.message;
  if (json)
    console.error(JSON.stringify({ error: message, conflicts: e.conflicts }));
  else console.error("deckmaster: " + message);
  process.exitCode = 1;
});
