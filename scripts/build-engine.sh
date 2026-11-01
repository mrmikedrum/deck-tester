#!/bin/sh
# Compile the engine and write its classpath. bin/goldfish runs this when the sources change.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 21)}"
export JAVA_HOME
cd "$ROOT/engine"
mvn ${GOLDFISH_MAVEN_ARGS:-} -q compile dependency:build-classpath -Dmdep.outputFile=target/classpath.txt
