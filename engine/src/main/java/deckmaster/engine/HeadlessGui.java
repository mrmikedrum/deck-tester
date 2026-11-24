package deckmaster.engine;

import java.io.File;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.function.Consumer;

import org.jupnp.UpnpServiceConfiguration;

import forge.gamemodes.match.HostedMatch;
import forge.gui.download.GuiDownloadService;
import forge.gui.interfaces.IGuiBase;
import forge.gui.interfaces.IGuiGame;
import forge.item.PaperCard;
import forge.localinstance.skin.FSkinProp;
import forge.localinstance.skin.ISkinImage;
import forge.sound.IAudioClip;
import forge.sound.IAudioMusic;
import forge.util.BuildInfo;
import forge.util.FSerializableFunction;
import forge.util.ImageFetcher;

/**
 * Forge's GUI for a host with no screen: a table where people join over the network and the engine seats its
 * own players. Nothing is shown and nothing is asked here; seats ask through their controllers, people through
 * their own Forge.
 */
final class HeadlessGui implements IGuiBase {
    private final String assets;

    /** @param assets Forge's assets folder: its {@code res/}, and the profile naming where its user files go */
    HeadlessGui(String assets) {
        this.assets = assets.endsWith("/") ? assets : assets + "/";
    }

    @Override public boolean isRunningOnDesktop() { return true; }
    @Override public boolean isLibgdxPort() { return false; }
    @Override public String getCurrentVersion() { return BuildInfo.getVersionString(); }
    @Override public String getUserAgent() { return "deckmaster-table"; }
    @Override public void invokeInEdtNow(Runnable runnable) { runnable.run(); }
    @Override public void invokeInEdtLater(Runnable runnable) { runnable.run(); }
    @Override public void invokeInEdtAndWait(Runnable proc) { proc.run(); }
    @Override public void runBackgroundTask(String message, Runnable task) {
        Thread thread = new Thread(task, "background");
        thread.setDaemon(true);
        thread.start();
    }
    @Override public boolean isGuiThread() { return false; }
    @Override public String getAssetsDir() { return assets; }
    @Override public ImageFetcher getImageFetcher() { return null; }
    @Override public ISkinImage getSkinIcon(FSkinProp skinProp) { return null; }
    @Override public ISkinImage getUnskinnedIcon(String path) { return null; }
    @Override public ISkinImage getCardArt(PaperCard card, boolean backFace) { return null; }
    @Override public ISkinImage createLayeredImage(PaperCard card, FSkinProp background, String overlayFilename, float opacity) { return null; }
    @Override public void clearImageCache() { }
    @Override public String encodeSymbols(String str, boolean formatReminderText) { return str; }
    @Override public int getAvatarCount() { return 0; }
    @Override public int getSleevesCount() { return 0; }
    @Override public float getScreenScale() { return 1f; }
    @Override public void preventSystemSleep(boolean preventSleep) { }
    @Override public void download(GuiDownloadService service, Consumer<Boolean> callback) { callback.accept(false); }
    @Override public void copyToClipboard(String text) { }
    @Override public void browseToUrl(String url) { }
    @Override public void showCardList(String title, String message, List<PaperCard> list) { }
    @Override public boolean showBoxedProduct(String title, String message, List<PaperCard> list) { return false; }
    @Override public void showBugReportDialog(String title, String text, boolean showExitAppBtn) { System.err.println(title + ": " + text); }
    @Override public void showImageDialog(ISkinImage image, String message, String title) { }
    @Override public int showOptionDialog(String message, String title, FSkinProp icon, List<String> options, int defaultOption) { return defaultOption; }
    @Override public String showInputDialog(String message, String title, FSkinProp icon, String initialInput, List<String> inputOptions, boolean isNumeric) { return initialInput; }
    @Override public String showFileDialog(String title, String defaultDir) { return null; }
    @Override public File getSaveFile(File defaultFile) { return defaultFile; }
    @Override public <T> List<T> order(String title, String top, int remainingObjectsMin, int remainingObjectsMax, List<T> sourceChoices, List<T> destChoices) { return new ArrayList<>(sourceChoices); }
    @Override public <T> List<T> getChoices(String message, int min, int max, Collection<T> choices, Collection<T> selected, FSerializableFunction<T, String> display) { return new ArrayList<>(choices).subList(0, Math.min(min, choices.size())); }
    @Override public PaperCard chooseCard(String title, String message, List<PaperCard> list) { return list.isEmpty() ? null : list.get(0); }
    @Override public boolean isSupportedAudioFormat(File file) { return false; }
    @Override public IAudioClip createAudioClip(String filename) { return null; }
    @Override public IAudioMusic createAudioMusic(String filename) { return null; }
    @Override public void startAltSoundSystem(String filename, boolean isSynchronized) { }
    @Override public void showSpellShop() { }
    @Override public void showBazaar() { }
    /** A view nobody watches: Forge's match host wants a spectator when no person sits at the table. */
    @Override public IGuiGame getNewGuiGame() {
        return (IGuiGame) java.lang.reflect.Proxy.newProxyInstance(IGuiGame.class.getClassLoader(), new Class<?>[] {IGuiGame.class},
                (proxy, method, args) -> {
                    Class<?> type = method.getReturnType();
                    if (method.getName().equals("equals")) {
                        return proxy == args[0];
                    }
                    if (method.getName().equals("hashCode")) {
                        return System.identityHashCode(proxy);
                    }
                    if (type == boolean.class) {
                        return false;
                    }
                    if (type == int.class || type == long.class || type == short.class || type == byte.class) {
                        return type == long.class ? 0L : 0;
                    }
                    if (type == float.class || type == double.class) {
                        return type == float.class ? 0f : 0d;
                    }
                    if (type == java.util.List.class) {
                        return new ArrayList<>();
                    }
                    return null;
                });
    }
    @Override public HostedMatch hostMatch() { return new HostedMatch(); }
    @Override public UpnpServiceConfiguration getUpnpPlatformService() { return null; }
    @Override public boolean hasNetGame() { return true; }
}
