#!/bin/sh
# Fetch Forge at the pinned commit into vendor/forge and install the headless modules
# (forge-core, forge-game, forge-ai) into the local Maven repository.
# Resolve the current daily: git ls-remote https://github.com/Card-Forge/forge.git refs/tags/daily-snapshots
# Update procedure: docs/architecture.md, "Updating upstream support".
# Isolate builds: GOLDFISH_MAVEN_ARGS=-Dmaven.repo.local=/absolute/path
set -eu

FORGE_COMMIT=cec1aaea3c5e57fbd77c11c9ede9a800d55cf8c6
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/forge"

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

if [ "$(git -C "$DEST" rev-parse -q --verify HEAD 2>/dev/null)" != "$FORGE_COMMIT" ]; then
  git -C "$DEST" fetch -q --depth 1 --filter=blob:none origin "$FORGE_COMMIT"
  git -C "$DEST" checkout -q FETCH_HEAD
fi

# Fixes we need before Forge has them (each is also offered upstream); skipped once applied.
for patch in "$ROOT"/scripts/forge-patches/*.patch; do
  [ -e "$patch" ] || continue
  if ! git -C "$DEST" apply --reverse --check "$patch" 2>/dev/null; then
    git -C "$DEST" apply "$patch"
  fi
done

JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 21)}"
export JAVA_HOME
cd "$DEST" && mvn ${GOLDFISH_MAVEN_ARGS:-} -q -pl forge-core,forge-game,forge-ai -am -DskipTests -Dcheckstyle.skip flatten:flatten install
echo "forge $FORGE_COMMIT installed"
