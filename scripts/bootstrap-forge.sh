#!/bin/sh
# Fetch Forge at the pinned commit into vendor/forge, apply our patch series as commits on the `goldfish`
# branch, and install the headless modules (forge-core, forge-game, forge-ai, forge-gui) into the local Maven
# repository under a version naming this build, so builds never replace each other.
# Resolve the current daily: git ls-remote https://github.com/Card-Forge/forge.git refs/tags/daily-snapshots
# Patches and updates: docs/architecture.md, "Forge dependency".
# Isolate builds: DECKMASTER_MAVEN_ARGS=-Dmaven.repo.local=/absolute/path
set -eu

FORGE_COMMIT=e7020aa13c376001a7c13e9d2a069a17efe7ab12
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/forge"
STAMP="$ROOT/.deckmaster/forge-build"
# The goldfish branch tip as the series last left it, so a failed build can be retried.
APPLIED="$ROOT/.deckmaster/forge-applied"

if [ ! -d "$DEST/.git" ]; then
  mkdir -p "$DEST"
  git -C "$DEST" init -q
  git -C "$DEST" remote add origin https://github.com/Card-Forge/forge.git
fi

# What a headless host needs: the engine modules and Forge's GUI module with its resources (tables run
# Forge's network server and full model). No images, music, skins or mobile apps.
git -C "$DEST" sparse-checkout set --no-cone \
  '/pom.xml' '/.mvn/' '/forge-core/' '/forge-game/' '/forge-ai/' '/forge-gui/' \
  '/*/pom.xml' '/forge-gui-desktop/src/main/java/forge/view/' \
  '!/forge-gui/res/adventure/' '!/forge-gui/res/music/' '!/forge-gui/res/sound/' '!/forge-gui/res/skins/'

# The build is named by the pin and the patch series; the same name means the same engine.
SERIES="$(cat "$ROOT"/scripts/forge-patches/*.patch | shasum -a 256 | cut -c1-8)"
BUILD="$(echo "$FORGE_COMMIT" | cut -c1-8)-$SERIES"

# Edits made in vendor/forge live only there: commit them on `goldfish` and export the series
# (architecture, "Forge dependency") before rebuilding, so nothing is lost.
TIP="$(git -C "$DEST" rev-parse -q --verify refs/heads/goldfish || true)"
if [ -n "$TIP" ]; then
  if ! git -C "$DEST" diff --quiet HEAD; then
    echo "vendor/forge has uncommitted edits; commit and export them, or discard them, then rerun" >&2
    exit 1
  fi
  if [ -f "$APPLIED" ] && [ "$(cat "$APPLIED")" != "$TIP" ]; then
    echo "vendor/forge's goldfish branch has commits the series lacks; export them, then rerun" >&2
    exit 1
  fi
fi
if [ -f "$STAMP" ] && [ "$(sed -n 's/^build=//p' "$STAMP")" = "$BUILD" ]; then
  echo "forge $BUILD already installed"
  exit 0
fi

if ! git -C "$DEST" cat-file -e "$FORGE_COMMIT^{commit}" 2>/dev/null; then
  git -C "$DEST" fetch -q --depth 1 --filter=blob:none origin "$FORGE_COMMIT"
fi
git -C "$DEST" checkout -q -B goldfish "$FORGE_COMMIT"
# Upstream wins: a card script the series adds that the pin now defines is compared, then dropped from the series.
NAMES="$(sed -n 's/^+Name:/Name:/p' "$ROOT"/scripts/forge-patches/*.patch)"
if [ -n "$NAMES" ]; then
  FOUND=0
  echo "$NAMES" | grep -r -n -x -F -f - "$DEST/forge-gui/res/cardsfolder" || FOUND=$?
  if [ "$FOUND" -ne 1 ]; then
    echo "$FORGE_COMMIT defines cards the series adds (above), or they couldn't be checked: check upstream's" >&2
    echo "with the same scenarios, then drop ours from the series (agent/skills/forge-cards)" >&2
    exit 1
  fi
fi
if ! git -C "$DEST" -c user.name=goldfish -c user.email=goldfish@localhost \
  am -q -3 --committer-date-is-author-date "$ROOT"/scripts/forge-patches/*.patch; then
  echo "a patch no longer applies to $FORGE_COMMIT: resolve it in vendor/forge (git am --continue)," >&2
  echo "then export the series again" >&2
  exit 1
fi
mkdir -p "$ROOT/.deckmaster"
git -C "$DEST" rev-parse HEAD > "$APPLIED"

# SNAPSHOT, as in upstream's own builds, keeps it a development build: Forge loads cardsfolder/upcoming only for those.
VERSION="$(sed -n 's:.*<versionCode>\(.*\)</versionCode>.*:\1:p' "$DEST/pom.xml" | head -1)-SNAPSHOT-goldfish-$BUILD"
JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 21)}"
export JAVA_HOME
(cd "$DEST" && mvn ${DECKMASTER_MAVEN_ARGS:-} -q -pl forge-core,forge-game,forge-ai,forge-gui -am -DskipTests \
  -Dcheckstyle.skip -Drevision="$VERSION" flatten:flatten install)
mkdir -p "$ROOT/.deckmaster"
printf 'build=%s\nversion=%s\ncommit=%s\nhead=%s\n' "$BUILD" "$VERSION" "$FORGE_COMMIT" \
  "$(git -C "$DEST" rev-parse HEAD)" > "$STAMP"
echo "forge $BUILD installed as $VERSION"
