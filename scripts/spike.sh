#!/bin/sh
# Rerun the M0 measurements: scripts/spike.sh [deck] [turns] [lazy]
# Needs scripts/bootstrap-forge.sh first. Forge's own stdout noise is filtered out.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DECK="${1:-$ROOT/examples/decks/eternities-living-worlds-iii.txt}"
JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 21)}"
export JAVA_HOME

cd "$ROOT/engine"
mvn -q compile dependency:build-classpath -Dmdep.outputFile=target/classpath.txt
java -Xmx2g -cp "target/classes:$(cat target/classpath.txt)" goldfish.engine.Spike \
  "$ROOT/vendor/forge/forge-gui/res" "$DECK" "${2:-8}" "${3:-eager}" 2>&1 \
  | grep -v -e 'Did not have activator' -e '^[[:space:]]*$'
