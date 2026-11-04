# Vision

## Mission

Let Deckmaster playtest a Commander deck by goldfishing it, cheaply enough in tokens and reasoning that the
agent's attention goes to judging the deck rather than running the game.

A goldfish asks: when nobody interferes, does the deck do what it was built to do? It usually looks at
the early turns rather than finished games: mana development, colour access, how the curve gets used,
whether the engine assembles, and where the deck stalls (screw, flood, dead cards, the missing piece).

## Who it serves

Agents: Drummer's Deckmaster skill, plus Claude or Codex sessions doing deck work. No human ever plays
through it, so there's no UI. Its outputs are read by a model and are written to be cheap to read.

## Two modes

- **Manual.** The agent makes every decision itself: mulligans, land drops, casts, targets, modes, scry,
  attacks. No script and no AI fills in. It can inspect any zone, snapshot and branch, and override state by
  hand when a card misbehaves. This mode is for learning a deck, checking a line, or building a pilot.
- **Automated.** The agent writes a pilot script once per deck: rules for the decisions that express the
  deck's plan, with Forge's AI making the rest. A batch of about 100 games finishes in about a minute and
  returns a short report. Every game keeps a full trace, so any game can be opened afterwards turn by turn
  and decision by decision, or resumed in manual mode from any point.

Both modes run the same games on the same engine; they differ only in who answers each decision.

## Principles

- **Forge decides the rules; we don't.** Rules accuracy comes from embedding
  [Forge](https://github.com/Card-Forge/forge). We never reimplement rules. A card Forge gets wrong is fixed
  as a Forge card script, in Forge's own language.
- **Tokens are the budget.** Default outputs are short digests, and detail is one command away. Every field
  an agent reads has to earn its place. Decisions with only one legal answer never reach the agent.
- **Reasoning is spent once.** Whatever the agent learns in manual mode should become pilot rules, so later
  games cost no new reasoning.
- **The record tells the truth.** Manual overrides, unsupported cards and the decisions Forge's AI made are
  all recorded, and reports flag games that depended on them.

## Not goals

- A human interface of any kind.
- Opponent interaction, politics or social simulation: opponents are passive. Deckmaster judges fun.
- Playing games to completion, or estimating win rates.
- Deckbuilding advice; Deckmaster owns judgment about the deck.
