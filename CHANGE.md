# Daily Forge upgrade — 2026-10-31

Reason: Mike requested the current official daily build, not a documentation-only fix. Extends the existing bootstrap and Forge patches, without a card overlay or scheduler.

Candidate: cec1aaea3c5e57fbd77c11c9ede9a800d55cf8c6, official master and daily-snapshots resolved together. Replaces b13b6c822a7bc54e3150d0ff4899f1f8fe60346c; version remains 2.0.16-SNAPSHOT. Exact hash records this installation, not an indefinite freeze. Next requested refresh resolves daily-snapshots again and repeats the existing isolated validation/review/install procedure.

Changes: bootstrap pin plus optional GOLDFISH_MAVEN_ARGS for isolated Maven repository; same build argument on host compiler. New modal-text-without-activator.patch guards UI-only mode enumeration until an activating player exists. All original patch bytes preserved (three files affecting four sources, including the untracked cost patch). No host/card scripts changed.

Initial candidate built but two model tests failed: upstream CharmEffect attempted target enumeration while rendering a card trigger without an activating player. Revised candidate guards that enumeration, leaves rules execution filtering unchanged, and passes all 38 existing tests, including seeded manual decisions, automated batch, fork fidelity, snapshot/restore, and model line exploration. See sibling *-tests*.log and *-build.log.

Original exports still refuse honestly: nature: Final Frontier; Genesis Device; Hit It!; Stable Wormhole; U.S.S. Discovery, at Black Alert. Assimilation: Borg Scout Sphere; Co-Option Adjutant; Conquest Mission; Final Frontier; Genesis Device; Locutus of Borg; Maturation Chamber; Warp Speed. Pike now loads from upstream; native scenario with two Forests and Command Tower yields 2/2 (distinct names), and text renders. Top-library permission and full Trek playtests remain unverified/unsupported. Missing implementations are separate from build compatibility and do not block this explicitly requested upgrade.

Install only when live engine has no sessions. Back up live vendor tree, engine target, existing Forge Maven artifacts and changed scripts. Stop idle engine; replace vendor with tested candidate including patches, install isolated Forge artifacts into shared repository, compile unchanged dirty host against them. Do not copy candidate host sources or reset any live work. Verify installed commit, all 38 tests, exact original exports. Roll back backed-up dependency tree/artifacts/target/scripts on regression; retain game records. No OpenClaw restart needed.

Hypothesis: supported decks keep working on current official upstream while card availability improves honestly. Check date: next requested simulator run; rollback on supported-deck regression.
