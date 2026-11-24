import path from "node:path";
import { atomic, digest, hash } from "./store.mjs";
import { readCloud, sendPlan, policy, unresolved } from "./cloud.mjs";
import { valid, merge, compilePlan, diff, applyOps } from "./model.mjs";
import { ingest, materialize } from "./library.mjs";
import { recordRefinement, refinementReview, finishRefinementPass } from "./refinements.mjs";
export function local(store, catalog) {
  let w = store.workspace();
  if (w.uid !== store.account) throw Error("Workspace/account mismatch");
  return ingest(store, w, catalog);
}
export async function pull(store, catalog) {
  let w;
  try {
    w = store.workspace();
  } catch (e) {
    if (!e.message.startsWith("No local workspace")) throw e;
  }
  if (w) w = ingest(store, w, catalog);
  const remote = await readCloud(store);
  valid(remote);
  if (w) w = { ...w, base: remote, working: merge(w.base, w.working, remote) };
  else
    w = {
      version: 1,
      uid: remote.uid,
      base: remote,
      working: structuredClone(remote),
    };
  store.saveWorkspace(w);
  materialize(store, w, catalog);
  return w;
}
export async function prepare(store, catalog, w, options = {}) {
  const plan = compilePlan(w.base, w.working, {
    ...policy(store),
    allowDelete: options.allowDelete,
  });
  plan.refinement_review = refinementReview(w);
  const file = path.join(
    store.home,
    "plans",
    Date.now() + "-" + plan.base_digest.slice(0, 8) + ".json",
  );
  atomic(file, plan, { exclusive: true });
  return { plan, file };
}
export async function mutate(
  store,
  catalog,
  fn,
  { offline = true, dryRun = false, allowDelete = false, refinement = false, revisedPass } = {},
) {
  if (!offline && unresolved(store).length)
    throw Error(
      "An earlier write needs reconciliation. Run deckmaster receipts reconcile.",
    );
  if (!offline) await catalog.ensure();
  const w = offline ? local(store, catalog) : await pull(store, catalog);
  if (!offline && diff(w.base, w.working).length)
    throw Error(
      "Local/file edits are pending. Run deckmaster diff then deckmaster push before another cloud edit, or use --offline.",
    );
  const next = structuredClone(w.working);
  const result = await fn(next);
  const plan = compilePlan(w.base, next, { ...policy(store), allowDelete });
  const decision = refinement ? recordRefinement(w, w.working, next, result) : undefined;
  if (revisedPass) Object.assign(w, revisedPass, { working: w.working });
  if (dryRun) return { status: "preview", operations: plan.operations, result, refinement: decision };
  if (offline) {
    store.backup(w.working, "before-offline-edit");
    w.working = next;
    store.saveWorkspace(w);
    materialize(store, w, catalog);
    return { status: "saved-offline", changes: plan.operations.length, result, refinement: decision };
  }
  const sent = await sendPlan(store, catalog, plan);
  if (sent.snapshot) {
    w.base = sent.snapshot;
    w.working = structuredClone(sent.snapshot);
    store.saveWorkspace(w);
    materialize(store, w, catalog);
  }
  return {
    status: sent.status,
    operations: sent.operations ?? 0,
    receipt: sent.receipt,
    result,
  };
}
export async function apply(store, catalog, plan, sendOptions = {}) {
  const w = local(store, catalog);
  if (
    digest(w.base) !== plan.base_digest ||
    digest(w.working) !==
      digest(applyOps(w.base, plan.operations))
  )
    throw Error("Local workspace changed since this plan. Make a fresh plan.");
  if (plan.refinement_review && hash(plan.refinement_review) !== hash(refinementReview(w))) throw Error("Refinement decisions changed since this plan. Review and make a fresh plan.");
  let r;
  if (!plan.operations.length && w.refinement_pass_id) {
    if (unresolved(store).length) throw Error("An earlier upload needs reconciliation. Run deckmaster receipts reconcile.");
    const observed = await (sendOptions.read ?? readCloud)(store);
    if (digest(observed) !== digest(w.working)) throw Error("Cloud changed since review; pull and reconsider the pass");
    r = { status: "verified", operations: 0, snapshot: observed, receipt: null };
  } else r = await sendPlan(store, catalog, plan, sendOptions);
  if (r.snapshot) {
    const updated = {
      ...w,
      version: 1,
      uid: r.snapshot.uid,
      base: r.snapshot,
      working: structuredClone(r.snapshot),
    };
    if (r.status === "verified") {
      finishRefinementPass(updated, plan.refinement_review ?? refinementReview(w), r.receipt);
      delete updated.refinements;
      delete updated.refinements_reviewed;
      delete updated.refinement_pass_id;
      delete updated.refinement_base;
      delete updated.refinement_signoff;
    }
    store.saveWorkspace(updated);
    materialize(store, updated, catalog);
  }
  const report = plan.refinement_review ?? refinementReview(w);
  return { status: r.status, operations: r.operations, receipt: r.receipt, refinement_review: report,
    delivery_brief: `${r.status === "verified" ? "ManaBox state independently verified." : "Publication status: " + r.status}\n\n${report.brief}` };
}
