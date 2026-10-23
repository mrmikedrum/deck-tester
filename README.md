# MTG Goldfish

Agent-driven Commander goldfishing on top of [Forge](https://github.com/Card-Forge/forge). An agent plays a
deck's first turns against passive opponents, either by hand (manual mode) or with a pilot script it wrote
(automated mode), and gets back compact reports on how the deck develops.

Status: design and scaffolding. The Forge engine host arrives in M0; see the [roadmap](docs/roadmap.md).

- [Vision](docs/vision.md): what this is for, the two modes, and principles
- [Architecture](docs/architecture.md): components, the decision seam, records and reports
- [Decisions](docs/decisions.md): what's settled and what's open
- [AGENTS.md](AGENTS.md): how to work in this repo

```bash
bin/goldfish doctor
bin/goldfish deck check examples/decks/eternities-living-worlds-iii.txt
python3 -m unittest discover -s tests -v
```
