You are fixing "Seat", a three.js + HTML iPad card table in client/ (h.js lays out, draws and animates the board; world.js makes textures; fx.js effects; LOOK.md explains the look). The findings to work are in __FINDINGS__; the packets they came from are in __PACKETS__.

Read tools/look/intent.md first: the goals the table serves, why, and the hard limits. You may replace how a goal is met with something better; never give a goal up, and never remove, hide, shrink or slow something just to make a finding go away. If a finding can only be fixed by giving up a goal, skip it and say so.

Work from the top, as many as you can do well; the first matters most. For each: reproduce it in the packet images, find the cause in the code, fix the cause. Prefer the platform's way (three.js, the tweens and layout already in h.js) to new machinery.

__REVISE__

Check your work by recording and looking:
- `node tools/reel.js __AFTER__ <clip,clip> --quick` then `node tools/packet.js __AFTER__` re-records just the clips you need at 15 fps (a few clips at once in parallel; it serves client/ itself). `node tools/clips.js` lists the clips. Open the same images the findings cite and compare. The layout audit at the end of each packet.md must say PASS.
- Record only what you need to check a change; the loop records everything, and runs the page-health eval, after you finish.

Write __OUT__: per finding, fixed / partly / skipped, the cause in one line, and what you changed. Then the layout audit's result, and any new problem you noticed. Keep code in the surrounding style; leave no scratch files behind.
