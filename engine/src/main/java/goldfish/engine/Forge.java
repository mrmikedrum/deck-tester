package goldfish.engine;

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
        return data;
    }
}
