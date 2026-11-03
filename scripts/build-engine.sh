#!/bin/sh
# Compile the engine against the installed Forge build and write its classpath. bin/goldfish runs this
# when the sources or the Forge build change.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 21)}"
export JAVA_HOME
VERSION="$(sed -n 's/^version=//p' "$ROOT/.goldfish/forge-build" 2>/dev/null || true)"
[ -n "$VERSION" ] || { echo "no Forge build installed; run scripts/bootstrap-forge.sh" >&2; exit 1; }
cd "$ROOT/engine"
mvn ${GOLDFISH_MAVEN_ARGS:-} -q -Dforge.version="$VERSION" compile dependency:build-classpath -Dmdep.outputFile=target/classpath.txt
