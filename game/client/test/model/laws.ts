// Laws every change set keeps, shared by the model's suites.
import { expect } from "vitest";
import type { ChangeSet } from "../../src/model";

/** Every change is in exactly one moment, moments hold consecutive runs in order, and none is empty. */
export function expectPartition(set: ChangeSet): void {
  const all = set.moments.flatMap((m) => [...m.changes]);
  expect(all).toEqual(set.changes.map((_, i) => i));
  for (const m of set.moments) expect(m.changes.length).toBeGreaterThan(0);
}
