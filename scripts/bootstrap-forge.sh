#!/bin/sh
# Fetch Forge at the pinned commit into vendor/forge, apply our patch series as commits on the `goldfish`
# branch, and install the headless modules (forge-core, forge-game, forge-ai) into the local Maven
# repository under a version naming this build, so builds never replace each other.
# Resolve the current daily: git ls-remote https://github.com/Card-Forge/forge.git refs/tags/daily-snapshots
# Patches and updates: docs/architecture.md, "Forge dependency".
# Isolate builds: GOLDFISH_MAVEN_ARGS=-Dmaven.repo.local=/absolute/path
set -eu

FORGE_COMMIT=cec1aaea3c5e57fbd77c11c9ede9a800d55cf8c6
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/forge"
STAMP="$ROOT/.goldfish/forge-build"

if [ ! -d "$DEST/.git" ]; then
  mkdir -p "$DEST"
  git -C "$DEST" init -q
  git -C "$DEST" remote add origin https://github.com/Card-Forge/forge.git
fi

# Only what a headless host needs: the engine modules, card data, and GUI sources kept as
# reference for how Forge initialises itself. No images, music or mobile apps.
git -C "$DEST" sparse-checkout set --no-cone \
  '/pom.xml' '/.mvn/' '/forge-core/' '/forge-game/' '/forge-ai/' \
  '/*/pom.xml' '/forge-gui/src/' '/forge-gui-desktop/src/main/java/forge/view/' \
  '/forge-gui/res/cardsfolder/' '/forge-gui/res/editions/' '/forge-gui/res/blockdata/' \
  '/forge-gui/res/formats/' '/forge-gui/res/tokenscripts/' '/forge-gui/res/ai/' \
  '/forge-gui/res/languages/' '/forge-gui/res/lists/' '/forge-gui/res/effects/' \
  '/forge-gui/res/setlookup/' '/forge-gui/res/puzzle/' '/forge-gui/res/defaults/'

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
  if [ -f "$STAMP" ] && [ "$(sed -n 's/^head=//p' "$STAMP")" != "$TIP" ]; then
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
if ! git -C "$DEST" -c user.name=goldfish -c user.email=goldfish@localhost \
  am -q -3 --committer-date-is-author-date "$ROOT"/scripts/forge-patches/*.patch; then
  echo "a patch no longer applies to $FORGE_COMMIT: resolve it in vendor/forge (git am --continue)," >&2
  echo "then export the series again" >&2
  exit 1
fi

VERSION="$(sed -n 's:.*<versionCode>\(.*\)</versionCode>.*:\1:p' "$DEST/pom.xml" | head -1)-goldfish-$BUILD"
JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 21)}"
export JAVA_HOME
(cd "$DEST" && mvn ${GOLDFISH_MAVEN_ARGS:-} -q -pl forge-core,forge-game,forge-ai -am -DskipTests \
  -Dcheckstyle.skip -Drevision="$VERSION" flatten:flatten install)
mkdir -p "$ROOT/.goldfish"
printf 'build=%s\nversion=%s\ncommit=%s\nhead=%s\n' "$BUILD" "$VERSION" "$FORGE_COMMIT" \
  "$(git -C "$DEST" rev-parse HEAD)" > "$STAMP"
echo "forge $BUILD installed as $VERSION"
