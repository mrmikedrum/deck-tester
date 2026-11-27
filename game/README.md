# Deckmaster game

You sit in one seat at a four-player Commander table, in a browser (designed for landscape tablets/iPads and
desktop); Jev with each deck's advisor pilots the other three. From the host machine:

```bash
(cd game && npm ci)            # first setup, or when dependencies change
bin/deckmaster game            # prints the address to open
```

Open the printed address and choose **New game**. The first game takes about a minute to start. The decks come from the
deck database (`deckmaster deck sync`); an opponent's deck needs a plan and an advisor. `--deck` and `--opponents`
set the defaults, `--start` opens a table at once.

## Playing

- **Hand and commander.** Swipe sideways through your hand. Tap a card or commander portrait to read it and see its plays. Drag it onto the table to play it. Use **Keep** or **Mulligan** on the opening hand.
- **Permanents and mana.** Tap a card to inspect it and use an available ability. Tap a pile to browse its cards. During payment, tap mana sources in order, use **List** to choose from a sheet, or select **Auto-pay**. You can float mana before casting by using a permanent's mana ability.
- **Combat and choices.** Tap attackers and tap a nameplate to change their target, or drag an attacker to its target. To block, tap your blocker and then its attacker, or drag between them. Tap highlighted targets on the table or choose from the prompt's list.
- **Stack and priority.** Tap the table to set the stack aside and tap its stack chip or cards to return. **Hold** stops the auto-pass countdown. A threat to you or your cards waits for your answer. **Auto** lets Forge decide once.
- **Look around.** Tap a nameplate for that player's summary and zones. Use **See [player]'s board** to inspect their side. Tap the top-left log for the full history. Use the close control or Escape to leave a focus.

## How it works

`deckmaster/game.py` serves this client and relays one live table to it: the table engine's view of the game and
each decision, with option refs the answers point back to, over long polling. Opponents use the same Jev table
pilot and advisors as automated tests; stock Forge AI as a primary pilot is disabled, though recorded Forge
fallbacks inside that pilot remain. A table plays the decks' latest revisions when it starts. Controller changes need
an idle-engine restart before the next table.

Card images come from Scryfall into `.deckmaster/cache/cards/`, served from here so the board's canvases stay
same-origin; they aren't in git. A fresh checkout fetches the browser fixtures' images with
`bin/deckmaster game --fill-cache`.

Mana abilities stay on their permanents as optional controls. They are excluded from All plays/Respond
counts and do not block automatic passing by themselves. Real responses and targeted threats still
hold the normal response window. The native mana regression checks empty-priority passing; the behaviour suite
(`game/tools/behaviour/`, `npm run behaviour` in `game/`) pins what the client sends for every decision, auto-pass and
Hold included, through real gestures against a mocked bridge.

See [LOOK.md](LOOK.md) for stills, recordings and the status of the look loop.
