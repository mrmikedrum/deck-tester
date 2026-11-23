#!/bin/sh
# The polish loop: shoot the client, have an independent reviewer model list what's wrong in the stills and
# transition strips, have a fixer model work the list, run the transition eval as the gate, repeat.
#   tools/loop.sh [rounds] [reviewer-model] [fixer-model]
# Needs the claude CLI (npm i -g @anthropic-ai/claude-code) and client/ served on :8797. Each round writes
# loop/round-N/{review.md,fix.md,eval.md} and its stills under loop/round-N/shots. Stop any time; every round stands alone.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROUNDS="${1:-3}"; REVIEWER="${2:-sonnet}"; FIXER="${3:-opus}"
cd "$HERE"
command -v claude >/dev/null || { echo "claude CLI not found"; exit 1; }
last=$(ls -d loop/round-* 2>/dev/null | sed 's/.*round-//' | sort -n | tail -1); n=$(( ${last:-0} + 1 ))
for i in $(seq 1 "$ROUNDS"); do
  R="loop/round-$n"; mkdir -p "$R/shots"
  echo "== round $n: shooting"
  node tools/shoot.js "$R/shots" webkit >"$R/shoot.log" 2>&1
  node tools/eval.js "$R/eval" webkit >"$R/eval.log" 2>&1 || true
  echo "== round $n: review ($REVIEWER)"
  claude -p --model "$REVIEWER" --allowedTools "Read,Glob,Write" --max-turns 40 \
    "$(sed "s#__R__#$R#g" tools/loop-review.md)" >"$R/review.log" 2>&1 || true
  echo "== round $n: fix ($FIXER)"
  claude -p --model "$FIXER" --allowedTools "Read,Edit,Write,Glob,Grep,Bash(node tools/*),Bash(python3 *)" --max-turns 80 \
    "$(sed "s#__R__#$R#g" tools/loop-fix.md)" >"$R/fix.log" 2>&1 || true
  node tools/eval.js "$R/eval-after" webkit >"$R/eval-after.log" 2>&1 || true
  echo "== round $n done: see $R/review.md, $R/fix.md, $R/eval-after/eval.md"
  n=$((n + 1))
done
