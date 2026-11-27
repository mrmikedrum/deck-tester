Use the findings, recordings and scope in the brief to fix the game client.

Read [the design intent](intent.md) first. Preserve its goals and hard limits. Send any finding that
requires changing a goal to the owner.

Start with the highest-ranked finding. Reproduce it with the cited frames, trace the cause in
`client/src/`, and fix it within scope. Record the affected beats using [the visual tools](../../LOOK.md).
Read the layout audit and compare the before and after images.

For each finding, report fixed, partial or skipped, with the cause and the evidence. Include the audit
result and any regressions you found.
