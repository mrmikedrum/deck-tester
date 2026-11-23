package deckmaster.engine;

import forge.CardStorageReader;
import forge.StaticData;
import forge.ai.AiProfileUtil;
import forge.card.CardDb;
import forge.card.CardType;
import forge.game.card.CardUtil;
import forge.util.FileSection;
import forge.util.FileUtil;
import forge.util.Lang;
import forge.util.Localizer;
import forge.MulliganDefs;

import java.io.File;
import java.util.List;
import java.util.Map;

/** Headless Forge startup: the parts of forge-gui's FModel.initialize a game needs, without the GUI. */
public final class Forge {
    private Forge() { }

    public static StaticData start(String resDir, boolean lazyCards) {
        String res = resDir.endsWith("/") ? resDir : resDir + "/";
        Lang.createInstance("en-US");
        Localizer.getInstance().initialize("en-US", res + "languages/");

        if (!CardType.Constant.LOADED.isSet()) {
            Map<String, List<String>> types = FileSection.parseSections(FileUtil.readFile(res + "lists/TypeLists.txt"));
            types.forEach(CardType.Helper::parseTypes);
            CardType.Constant.LOADED.set();
        }
        for (String keyword : FileUtil.readFile(res + "lists/NonStackingKWList.txt")) {
            if (keyword.length() > 1) {
                CardUtil.NON_STACKING_LIST.add(keyword);
            }
        }

        CardStorageReader cards = new CardStorageReader(res + "cardsfolder", null, lazyCards);
        CardStorageReader tokens = new CardStorageReader(res + "tokenscripts", null, false);
        StaticData data = new StaticData(cards, tokens, null, null,
                res + "editions", new File(res, "no-custom-editions").getPath(), res + "blockdata",
                res + "setlookup", CardDb.CardArtPreference.LATEST_ART_ALL_EDITIONS.name(),
                false, true, false, false);
        data.setMulliganRule(MulliganDefs.MulliganRule.London);
        AiProfileUtil.loadAllProfiles(res + "ai/");
        // Copying a game (copy forks) looks up card image keys; with no images here, their folders are empty.
        forge.ImageKeys.initializeDirs("", new java.util.HashMap<>(), "", "", "", "", "", "", "");
        return data;
    }

    /**
     * Forge's full start-up, for hosting tables: its network server and lobby need the whole model (preferences,
     * the match host), not only the card data. The model reads its assets from a folder of the engine's own, which
     * links Forge's resources and keeps Forge's user files (preferences, logs) out of the person's own Forge.
     */
    public static void startForTables(java.nio.file.Path res, java.nio.file.Path dir) throws java.io.IOException {
        java.nio.file.Path assets = dir.resolve("assets");
        java.nio.file.Files.createDirectories(assets);
        java.nio.file.Path link = assets.resolve("res");
        if (!java.nio.file.Files.exists(link, java.nio.file.LinkOption.NOFOLLOW_LINKS)) {
            java.nio.file.Files.createSymbolicLink(link, res.toAbsolutePath());
        }
        java.nio.file.Path user = dir.resolve("user").toAbsolutePath();
        java.nio.file.Files.writeString(assets.resolve("forge.profile.properties"),
                "userDir=" + user + "/\ncacheDir=" + user + "/cache/\n");
        forge.gui.GuiBase.setInterface(new HeadlessGui(assets.toAbsolutePath().toString()));
        forge.model.FModel.initialize(null, preferences -> {
            preferences.setPref(forge.localinstance.properties.ForgePreferences.FPref.LOAD_CARD_SCRIPTS_LAZILY, false);
            preferences.setPref(forge.localinstance.properties.ForgePreferences.FPref.UI_LANGUAGE, "en-US");
            preferences.setPref(forge.localinstance.properties.ForgePreferences.FPref.ENFORCE_DECK_LEGALITY, false);
            return null;
        });
        forge.model.FModel.getNetPreferences().setPref(forge.localinstance.properties.ForgeNetPreferences.FNetPref.UPnP, "NEVER");
    }
}
