package goldfish.engine;

import forge.game.GameEntity;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

/** Short, name-based labels for options. Agents read these, so they stay terse: no ids, no rules text. */
final class Labels {
    private static final int MAX = 50;

    private Labels() { }

    static String card(Card card, Player me) {
        Player controller = card.getController();
        return controller == null || controller.equals(me) ? card.getName() : card.getName() + " (" + controller.getName() + ")";
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

    /** Rules text shortened for a label: the card's own name prefix dropped, cut at MAX characters. */
    static String text(String raw, String name) {
        String text = raw == null ? "" : raw.trim().replaceAll("\\s+", " ");
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
