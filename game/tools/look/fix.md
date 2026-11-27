Fix the ranked findings in __FINDINGS__ on the branch for __SCOPE__, using baseline __BEFORE__.
Read [the design intent](intent.md). The 3D scene lane owns `client/src/scene/three/` and `client/src/scene/stage/` (motion),
Grimoire faces in `client/src/theme/grimoire/`, and `client/src/layout/`. The HTML chrome lane
owns `client/src/chrome/` and `client/src/app/`. The palette and shared CSS (`client/src/theme/tokens.ts`, `client/src/theme/css.ts`) belong to both: agree before changing them. Hand off cross-lane findings with evidence
and send goal changes to the owner.

Start with the highest-ranked finding. Reproduce it using the cited still or frames, trace the
cause in this lane's code, then fix it. Preserve engine answers and their timing. Use
[the runner](../../LOOK.md) for a matching after packet. Compare the audit and the affected
images at the same scale.

Run `npm run check` from `game/` and open a pull request on the lane branch. For each finding,
report fixed, partial or skipped, with the cause and matching evidence. Include the layout audit,
check results and any regressions.
