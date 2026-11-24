# Local iteration and canonical cache validation — 2026-10-16

Ordinary CLI reads and mutations now use the local workspace; explicit pull merges cloud state and explicit push creates the ManaBox checkpoint. The existing verification, receipt, stale-plan and conflict mechanisms remain in place. No live account write was used to validate this change.

Passed checks across the targeted runs: 26 Node test cases, including the wrapper for three Python authentication scenarios. The initial full-suite run had one loopback-server startup timeout under the sandbox; that authentication test passed when rerun with approved loopback access outside the sandbox. All remaining cases passed in the sandbox. CLI syntax and Git whitespace checks passed.

New disposable-fixture tests cover:

- CLI rename, subsequent card addition, and read without cloud credentials or network; unchanged cloud base and no receipts until push.
- Companion brief preservation through mirror updates and explicit local deletion.
- Staged changes invalidate an earlier checkpoint plan before upload; deletion plans require explicit opt-in.
- Oracle cache retains face rules text and excludes printing details, prices, legality and Game Changer fields.
- Persistent lookup without age expiry, forced refresh, and refusal to replace newer observations with older ones.
- Deck-check facts populate the same canonical cache while retaining full-response data separately.
- The Python search helper reads that shared cache offline, preserves original retrieval time, and fails clearly on a cache miss.

Existing fixture tests also cover three-way merges, partial/uncertain upload handling, process locks, protection boundaries and independent verification. No new live upload, concurrent-phone acceptance test, or model behavior lab was run. ManaBox's lack of an atomic-batch/compare-and-swap guarantee remains a limitation. Companion Markdown is coordinated by workflow and remains outside cloud snapshots.
