# Deckmaster game

You sit in one seat at a four-player Commander table, in a browser (an iPad, added to the Home Screen, is the
target); Jev with each deck's advisor pilots the other three. On the Mac:

```bash
bin/deckmaster game            # prints the address to open: http://<this machine>:8765/live.html
```

then choose decks and start from **Game**. The first game takes about a minute to start. `--deck` and
`--opponents` set the default decks (from `examples/decks/`), `--start` opens a table at once.

## Playing

- **Your hand** is held in the bottom left corner, always in full, about three cards wide, lands first, then cheapest to
  dearest, each card in front of the one to its left. Your plate and commander sit beside it, and your side of the table
  ends above it, so nothing is ever behind the hand. Thumb through it by swiping sideways (or hovering, or scrolling
  sideways on a trackpad): each swipe turns one card, sliding the cards along without changing their order. The
  cards lean with the push, settle on a spring, and open one card in full while the rest bunch up. Tap a card to open
  it there. At the start, the opening hand comes to the middle of the screen with Keep and Mulligan.
- **Play a card:** drag it up from your hand onto the table, open or bunched. Tap the open card to read it,
  with Play buttons if it can be played.
- **Your commander** peeks out from behind your plate, beside your hand, while it's in the command zone: drag it onto the table to cast it,
  or tap it to look.
- **Use an ability:** tap a glowing permanent; it opens with its abilities as buttons.
- **Float mana:** tap a land, select its mana ability, then choose a colour if asked. Floating mana appears in the prompt and can pay the next spell; unspent mana normally empties when the step or phase ends. This also works around an automatic colour-matching failure.
- **Choices** happen on the table when every option is on it (tap the glowing cards or plates); otherwise they come up as a sheet of cards.
- **Attack:** tap creatures to attack the lit player, drag one onto another player, or tap a plate to change target.
- **Block:** drag a blocker onto an attacker, or tap your creature and then the attacker.
- **Pay:** tap lands and other sources (a pile gives one card per tap), or Auto-pay.
- **The stack** is a layer over the table. When something new goes on it, the table dims and the stack comes to the
  middle with what each item does beside it. The corner prompt just says what happened, with Hold and OK. Tap the
  table to look past the stack; tap the stack to bring it back.
- **When the others act**, play stops on each spell and ability they put on the stack. One aimed at you or yours turns
  the prompt red and waits for you; anything else carries on after a few seconds unless you tap Hold. Cards of yours
  that leave the battlefield on their turns are listed above the prompt, with why.
- **Focus:** your side never moves. On another player's turn their side comes toward the middle. Tap an opponent's
  side to lean in on it; Back returns you to the table.
- **Look:** tap any card to inspect it, or hold to peek. The log is top left; tap it for the whole game.
- **Let Forge decide** hands that one decision to Forge's AI.

## How it works

`deckmaster/game.py` serves this client and relays one live table to it: the table engine's view of the game and
each decision, with option refs the answers point back to, over long polling. Opponents use the same Jev table
pilot and Python advisors as guided tests; stock Forge AI as a primary pilot is disabled, though recorded Forge
fallbacks inside that pilot remain. Current deck files are read when a new table starts. Controller changes need
an idle-engine restart before the next table.

Card images come from Scryfall into `.deckmaster/cache/cards/`, served from here so the board's canvases stay
same-origin; they aren't in git. A fresh checkout fetches the offline fixtures' images with
`bin/deckmaster game --fill-cache`.

Mana abilities stay on their permanents as optional controls. They are excluded from All plays/Respond
counts and do not block automatic passing by themselves. Real responses and targeted threats still
hold the normal response window. The native mana regression checks empty-priority passing; the UI
state-machine test checks mana-only auto-continue, real responses, threats and direct mana buttons.

The look, and the loop that records and judges it, are in [LOOK.md](LOOK.md).
