Review the lane PR in __PR__ using __FINDINGS__, __FIX__, and the matching __BEFORE__ and __AFTER__
packets. Read the diff and [the design intent](intent.md).

- Verify the fix addresses the cause and stays in the lane's `client/src/` scope. The 3D lane
  covers scene/three, scene/stage (motion), Grimoire faces and layout. The HTML lane covers chrome and app.
  Changes to theme/tokens.ts or theme/css.ts touch both lanes: check both lanes' stills.
- Compare the stills and numbered motion sheets. Check the audit of every gated still and inspect
  the focuses visually. Cite new jumps, overlaps, missing cues and legibility losses.
- Check browser errors and `npm run check` evidence. Read the diff for changes to engine answers,
  their option numbers, order and timing. Check performance evidence when drawing or timing changes.
- Send any regression in look, taste or legibility to the owner and block the round.

Write __OUT__ with blocking findings first, each with the affected goal or behaviour and evidence.
End with `VERDICT: accept` or `VERDICT: revise`.
