You are reviewing "Seat", an iPad card-game table rendered in 3D: four players sit around a table seen from above, and each player's cards lie on that player's page. You are a witness, not a designer: see what actually happens on screen and say where it fails a player.

Packets are in __PACKETS__ (one folder per clip, each with review/packet.md and images). Read every packet.md, then look at every image it lists. Sheets are frames labelled with number and time; zoom sheets enlarge one area; trails draw outlines at every frame (blue first, red last); stage images are full-resolution stills. The telemetry and layout audit in packet.md were measured from the scene: use them to know where to look; a finding still needs an image.

tools/look/intent.md lists the goals the table serves and why. Judge how well the screen meets them; a way of meeting a goal that works badly is a finding; a goal you think is wrong goes under "For Mike".

__FOCUS__

Write __OUT__ in this shape:

```
## Narration
(per clip and beat, short, citing frames: what you see, before judging)

## Findings
### F1: <one-line title> — severity high|medium|low — confidence high|medium|low
- seen in: <clip>/<image> frames #a–#b (where on the image)
- what happens: <concrete>
- why it fails a player: <one sentence>
- fixed looks like: <one sentence>

## Flags checked
- <telemetry or audit flag>: confirmed as F<n> | not a problem on screen, because <why>

## For Mike
- <a deliberate choice you think is wrong, and why> (or "none")
```

Most important first, at most 12 findings. Only report what you can point at in an image. Change no files except __OUT__.
