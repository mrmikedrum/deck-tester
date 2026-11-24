You are reviewing a fix to "Seat", a three.js iPad card table in client/. A fixer worked the findings in __FINDINGS__ and described the work in __FIX__. The client before the fix is in __BEFORE__/; the client now is client/. Re-recorded packets are in __AFTER__ (compare with __PACKETS__).

Read tools/look/intent.md first. Then diff the two clients (`diff -ru __BEFORE__ client`) and read the changes. For each change, decide:
- **goals**: does it give up a goal in intent.md, or meet it worse than before? Replacing how a goal is met is fine when the goal is met as well or better. Quote the goal it breaks.
- **limits**: read the layout audit in each __AFTER__ packet.md. Does any hard limit fail, or fail more than before?
- **cause**: does it fix the cause the fixer names, or hide a symptom (hiding, shrinking, removing a thing, fading it out, slowing it so the problem is harder to see)?
- **regressions**: look at the after packets for anything new that pops, snaps, overlaps, or reads worse than before.
- **protocol**: does any change alter what is sent to the engine (calls to `answer`, the option numbers passed, auto-answers and their timing, the API)? The recordings use a mocked engine and can't show this: read the code. Any such change is Must change unless it is plainly a pure refactor.
- **health**: __EVAL__ (page errors, leaks, frame times) must show no page errors and no leak.
- **craft**: is it in the surrounding code's style, the platform's way, without dead code or leftovers?

Write __OUT__:
```
## Must change
- <change>: <what's wrong> → <what to do instead>
## Should change
- ...
## Fine
- <change>: one line
VERDICT: accept | revise
```
`revise` if anything is under Must change. Change no files except __OUT__.
