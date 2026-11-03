package goldfish.engine;

import forge.game.GameEntity;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

import java.util.ArrayList;
import java.util.List;

/** Short, name-based labels for options. Agents read these, so they stay terse: no ids, no rules text. */
final class Labels {
    private static final int MAX = 50;

    private Labels() { }

    /** A card's name; on the battlefield also what tells copies apart: P/T, counters, tapped, token. */
    static String card(Card card, Player me) {
        StringBuilder label = new StringBuilder(card.getName());
        if (card.isInZone(ZoneType.Battlefield)) {
            if (card.isCreature()) {
                label.append(' ').append(card.getNetPower()).append('/').append(card.getNetToughness());
            }
            if (!card.getCounters().isEmpty()) {
                List<String> counters = new ArrayList<>();
                card.getCounters().entrySet().forEach(e -> counters.add(e.getElement().getName() + " " + e.getCount()));
                label.append(" [").append(String.join(", ", counters)).append(']');
            }
            List<String> flags = new ArrayList<>();
            if (card.isTapped()) {
                flags.add("tapped");
            }
            if (card.isToken()) {
                flags.add("token");
            }
            Player controller = card.getController();
            if (controller != null && !controller.equals(me)) {
                flags.add(controller.getName());
            }
            if (!flags.isEmpty()) {
                label.append(" (").append(String.join(", ", flags)).append(')');
            }
        } else if (card.getController() != null && !card.getController().equals(me)) {
            label.append(" (").append(card.getController().getName()).append(')');
        }
        return label.toString();
    }

    /**
     * The full text behind a card option, for agents that ask for detail. On the battlefield a permanent's
     * abilities as they are now (a copy's, gained ones, a clone's drawback), since what it does is what
     * matters there; elsewhere the printed text.
     */
    static String detail(Card card) {
        String raw = card.isInZone(ZoneType.Battlefield) ? card.getAbilityText() : card.getOracleText();
        // Forge separates abilities with a literal backslash-n, and sometimes a real newline.
        String text = raw == null ? "" : raw.replace("\\n", "\n").replaceAll("\\s*\n\\s*", " / ").trim();
        String cost = card.getManaCost() == null || card.getManaCost().isNoCost() ? "" : " " + card.getManaCost();
        return card.getName() + cost + " — " + card.getType() + (text.isEmpty() ? "" : " — " + text);
    }

    /** The full text behind an ability option. */
    static String detail(SpellAbility sa) {
        if (sa.isSpell() || sa.isLandAbility()) {
            return detail(sa.getHostCard());
        }
        return sa.getHostCard().getName() + ": " + named(sa.toString(), sa.getHostCard().getName());
    }

    static String entity(GameEntity entity, Player me) {
        if (entity instanceof Card card) {
            return card(card, me);
        }
        return entity.equals(me) ? "you" : entity.getName();
    }

    static String ability(SpellAbility sa) {
        Card host = sa.getHostCard();
        String name = host.getName();
        if (sa.isLandAbility()) {
            return name + " (land)";
        }
        if (sa.isSpell()) {
            StringBuilder label = new StringBuilder(name);
            if (sa.getAlternativeCost() != null) {
                label.append(" (").append(sa.getAlternativeCost().name().toLowerCase()).append(')');
            }
            if (host.isInZone(ZoneType.Command)) {
                label.append(" (commander)");
            } else if (host.isInZone(ZoneType.Graveyard)) {
                label.append(" (from graveyard)");
            } else if (host.isInZone(ZoneType.Exile)) {
                label.append(" (from exile)");
            }
            return label.toString();
        }
        return name + ": " + text(sa.toString(), name);
    }

    /** Rules text in one line, with Forge's placeholders for the card's own name filled in. */
    static String named(String raw, String name) {
        String text = raw == null ? "" : raw.trim().replaceAll("\\s+", " ");
        return name.isEmpty() ? text : text.replace("CARDNAME", name).replace("NICKNAME", name);
    }

    /** Rules text shortened for a label: the card's own name prefix dropped, cut at MAX characters. */
    static String text(String raw, String name) {
        String text = named(raw, name);
        if (text.startsWith(name + " - ")) {
            text = text.substring(name.length() + 3);
        } else if (text.startsWith(name + ": ")) {
            text = text.substring(name.length() + 2);
        }
        if (!name.isEmpty()) {
            text = text.replace(name, "this");
        }
        return text.length() <= MAX ? text : text.substring(0, MAX - 1) + "…";
    }
}
