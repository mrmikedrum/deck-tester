#!/bin/sh
# Build the Forge desktop app people use to join a table (goldfish table), from a full Forge checkout holding the
# engine's pin and patch series, under the engine's own build version: Forge warns when a client's version
# differs from the host's. Needs scripts/bootstrap-forge.sh first, which installs the modules the app builds on.
#   scripts/build-forge-client.sh [FORGE_CHECKOUT]   (default: ../forge)
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FORGE="$(cd "${1:-$ROOT/../forge}" && pwd)"
STAMP="$ROOT/.goldfish/forge-build"
[ -f "$STAMP" ] || { echo "no Forge build installed; run scripts/bootstrap-forge.sh" >&2; exit 1; }
VERSION="$(sed -n 's/^version=//p' "$STAMP")"
PIN="$(sed -n 's/^commit=//p' "$STAMP")"

# The checkout must be the engine's Forge: the pin plus exactly the series, committed.
CHECK="$(mktemp -d)"
trap 'rm -rf "$CHECK"' EXIT
if ! git -C "$FORGE" diff --quiet HEAD -- forge-core forge-game forge-ai forge-gui forge-gui-desktop/src/main \
  || ! git -C "$FORGE" format-patch -q -N --zero-commit --no-signature -o "$CHECK" "$PIN..HEAD" \
  || ! diff -rq "$CHECK" "$ROOT/scripts/forge-patches" >/dev/null; then
  echo "$FORGE isn't the engine's Forge ($PIN plus scripts/forge-patches); check out that branch first" >&2
  exit 1
fi

JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 21)}"
export JAVA_HOME
# The app jar and its dependencies in one file; the Windows launcher step is left out (it rejects this version).
(cd "$FORGE" && mvn ${GOLDFISH_MAVEN_ARGS:-} -q -pl forge-gui-desktop -DskipTests -Dcheckstyle.skip \
  -Drevision="$VERSION" compile jar:jar assembly:single@make-assembly)
JAR="$FORGE/forge-gui-desktop/target/forge-gui-desktop-$VERSION-jar-with-dependencies.jar"
echo "built $JAR"
echo "run it from Forge's GUI folder, which holds its resources:"
echo "  cd $FORGE/forge-gui && java -jar $JAR"
