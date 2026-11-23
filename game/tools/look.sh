#!/bin/sh
# The look loop. Each round: record frame-exact clips; two blind witnesses from different model families review them
# against tools/look/intent.md; a merge verifies and ranks; a fixer works the list; a reviewer from the other family
# checks the fix against the goals and hard limits, and the same fixer session revises if told to; then a re-record
# and a blind judge of before against after.
#   tools/look.sh [rounds, 0 = until stopped] [polish|layout|motion] [clip,clip]
# Default: polish, every clip (`node tools/clips.js` lists them). Serves client/ itself. Usage limits are waited out.
# Writes look/round-N/ (witness-*.md, findings.md, fix.md, fix-review.md, judge.md, key.txt, client-before/) and a line
# per round in look/STATUS.md. A findings.md placed in a new round skips its witnesses. A round resumes from its files.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"; cd "$HERE"
ROUNDS="${1:-1}"; FOCUS="${2:-polish}"; CLIPS="${3:-$(node -e 'console.log(require("./tools/clips.js").filter(c => !c.manual).map(c => c.name).join(","))')}"
FIXER="${FIXER:-opus}"; WITNESS="${WITNESS:-opus}"

# One server for every recording and the eval (python's http.server drops connections when browsers load in parallel).
PORT=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
node tools/serve.js "$PORT" >/dev/null & SERVER=$!; trap 'kill $SERVER 2>/dev/null' EXIT
export BASE="http://127.0.0.1:$PORT/"

p() { python3 -c 'import sys; s = open("tools/look/" + sys.argv[1] + ".md").read(); a = sys.argv[2:]
for k, v in zip(a[::2], a[1::2]): s = s.replace(k, v)
sys.stdout.write(s)' "$@"; }
sum() { find client -type f -not -path '*/img/*' | sort | xargs cat | shasum | cut -c1-12; }
record() { rm -rf "$1"; node tools/reel.js "$1" "$CLIPS" && node tools/packet.js "$1" >/dev/null && sum >"$1/client.sum"; }
# A usage limit ends a run with a "resets <time>" message: wait until then (or 30 min) and say so.
limited() { grep -qiE "hit your .*limit|usage limit|rate.?limit" "$1"; }
wait_reset() {
  s=$(python3 - "$1" <<'EOF'
import re, sys, datetime
m = re.search(r"resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)", open(sys.argv[1]).read(), re.I)
if not m: print(1800); sys.exit()
h, mi, ap = int(m.group(1)) % 12, int(m.group(2) or 0), m.group(3).lower()
now = datetime.datetime.now(); t = now.replace(hour=h + (12 if ap == "pm" else 0), minute=mi, second=0)
if t <= now: t += datetime.timedelta(days=1)
print(int((t - now).total_seconds()) + 120)
EOF
)
  echo "   usage limit: waiting $((s / 60)) min ($(date +%H:%M))"; sleep "$s"
}
ai() { log="$1"; shift; while :; do "$@" >"$log" 2>&1 || true; limited "$log" || return 0; wait_reset "$log"; done; }
claude_ro() { claude -p --model "$WITNESS" --allowedTools "Read,Glob,Grep,Write" --max-turns 80 "$1"; }
codex_rw() { codex exec --skip-git-repo-check -s workspace-write "$1"; }
FIXTOOLS="Read,Edit,Write,Glob,Grep,Bash(node tools/*),Bash(ls *),Bash(diff *),Bash(rm reels/*),Bash(rm tools/_*)"
# The fixer keeps one session per round: a retry after a limit, and the revision, resume it with its context.
fixer() {   # fixer <log> <prompt>
  sid="$(cat "$R/fixer.sid" 2>/dev/null || true)"
  if [ -z "$sid" ]; then sid=$(uuidgen | tr A-Z a-z); echo "$sid" >"$R/fixer.sid"; claude -p --model "$FIXER" --session-id "$sid" --allowedTools "$FIXTOOLS" --max-turns 250 "$2" >"$1" 2>&1 || true
  else claude -p --model "$FIXER" --resume "$sid" --allowedTools "$FIXTOOLS" --max-turns 250 "$2" >"$1" 2>&1 || true; fi
  while limited "$1"; do wait_reset "$1"; claude -p --model "$FIXER" --resume "$sid" --allowedTools "$FIXTOOLS" --max-turns 250 "Continue where you left off." >"$1" 2>&1 || true; done
}
status() { printf '%s\n' "$1" >>look/STATUS.md; }
# Finished recordings keep their video, sheets and stills; the raw frames go, and the rest moves to the NAS working
# share (config/nas-working-storage.json) when it is mounted, since the local disk is tight.
ARCHIVE="$HOME/NAS/OpenClaw Workspace/seat-look-reels"
archive() {
  for d in "$@"; do
    [ -d "$d" ] || continue; rm -rf "${d:?}"/*/frames "${d:?}"/*/still-*.png
    if mount | grep -q "on $HOME/NAS/OpenClaw Workspace "; then mkdir -p "$ARCHIVE" && rsync -a --remove-source-files "${d:?}" "$ARCHIVE/" && rm -rf "${d:?}"; fi
  done
}
[ -f look/STATUS.md ] || printf '# Look loop: one line per round\n\n' >look/STATUS.md

last=$(ls -d look/round-*/ 2>/dev/null | sed 's#.*round-##; s#/$##' | grep -E '^[0-9]+$' | sort -n | tail -1); n=${last:-1}
[ -n "$last" ] && [ -f "look/round-$last/judge.md" ] && n=$((last + 1))
i=0
while [ "$ROUNDS" -eq 0 ] || [ "$i" -lt "$ROUNDS" ]; do
  i=$((i + 1)); R="look/round-$n"; B="reels/r$n-before"; A="reels/r$n-after"; PA="reels/r$((n - 1))-after"; mkdir -p "$R"
  echo "$FOCUS $CLIPS" >"$R/focus.txt"; T0=$(date +%s)
  if [ ! -d "$B" ]; then
    # The last round's after-recording is this round's before, if the client hasn't changed since and the clips match.
    if [ -f "$PA/client.sum" ] && [ "$(cat "$PA/client.sum")" = "$(sum)" ] && [ "$(cat "look/round-$((n - 1))/focus.txt" 2>/dev/null | cut -d' ' -f2)" = "$CLIPS" ]; then
      echo "== round $n: reusing $PA"; cp -R "$PA" "$B"; node tools/packet.js "$B" >/dev/null   # packets follow the current audit
    else echo "== round $n: recording"; record "$B"; fi
  fi
  [ -d "$R/client-before" ] || cp -R client "$R/client-before"
  if [ ! -f "$R/findings.md" ]; then
    FOCUSTXT="$(cat "tools/look/focus-$FOCUS.md")"
    if [ ! -s "$R/witness-claude.md" ] || [ ! -s "$R/witness-codex.md" ]; then
      echo "== round $n: witnesses ($WITNESS, codex) on $FOCUS"
      W1=""; W2=""   # wait for these two only: the server runs in the background too
      [ -s "$R/witness-claude.md" ] || { ai "$R/witness-claude.log" claude_ro "$(p witness __PACKETS__ "$B" __OUT__ "$R/witness-claude.md" __FOCUS__ "$FOCUSTXT")" & W1=$!; }
      [ -s "$R/witness-codex.md" ] || { ai "$R/witness-codex.log" codex_rw "$(p witness __PACKETS__ "$B" __OUT__ "$R/witness-codex.md" __FOCUS__ "$FOCUSTXT")" & W2=$!; }
      for w in $W1 $W2; do wait "$w" || true; done
    fi
    echo "== round $n: merge"
    # The last judge's "Other differences" are where regressions show up: they get checked like a third witness.
    PJ="look/round-$((n - 1))/judge.md"; PRIOR=""
    [ -f "$PJ" ] && PRIOR="The previous round's judge compared the recordings before it and noted differences in $PJ (its key is in look/round-$((n - 1))/key.txt). Where it named something worse in the newer version that you can still see in these packets, it belongs in the list."
    ai "$R/merge.log" claude_ro "$(p merge __WITNESSES__ "$R/witness-claude.md and $R/witness-codex.md" __PACKETS__ "$B" __OUT__ "$R/findings.md" __PRIOR__ "$PRIOR")"
  fi
  if [ ! -f "$R/fix.md" ]; then
    echo "== round $n: fix ($FIXER)"
    fixer "$R/fix.log" "$(p fix __FINDINGS__ "$R/findings.md" __PACKETS__ "$B" __AFTER__ "$R/check" __OUT__ "$R/fix.md" __REVISE__ "")"
    [ -f "$R/fix.md" ] || { echo "fixer wrote no $R/fix.md:"; tail -3 "$R/fix.log"; exit 1; }
    echo "== round $n: recording after the fix"; record "$A"
    node tools/eval.js "$R/eval" webkit >"$R/eval.log" 2>&1 || true
  fi
  if [ ! -f "$R/fix-review.md" ]; then
    echo "== round $n: fix review (codex)"
    ai "$R/fix-review.log" codex_rw "$(p review-fix __FINDINGS__ "$R/findings.md" __FIX__ "$R/fix.md" __BEFORE__ "$R/client-before" __AFTER__ "$A" __PACKETS__ "$B" __EVAL__ "$R/eval/eval.md" __OUT__ "$R/fix-review.md")"
  fi
  if grep -q "VERDICT: revise" "$R/fix-review.md" && [ ! -f "$R/fix-2.md" ]; then
    echo "== round $n: revision ($FIXER, same session)"
    fixer "$R/fix-2.log" "An independent reviewer read your fix and wrote $R/fix-review.md; the full re-recording it judged is in $A, and the eval in $R/eval/eval.md. Address everything under Must change, and Should change where you agree; where you disagree, say why. Check as before, then write $R/fix-2.md."
    [ -f "$R/fix-2.md" ] || { echo "fixer wrote no $R/fix-2.md:"; tail -3 "$R/fix-2.log"; exit 1; }
    echo "== round $n: recording after the revision"; record "$A"
    node tools/eval.js "$R/eval" webkit >"$R/eval.log" 2>&1 || true
  fi
  if [ ! -f "$R/judge.md" ]; then
    # The judge doesn't know which recording is which.
    if [ $(( $(date +%s) % 2 )) -eq 0 ]; then X="$B"; Y="$A"; echo "X=before Y=after" >"$R/key.txt"; else X="$A"; Y="$B"; echo "X=after Y=before" >"$R/key.txt"; fi
    echo "== round $n: judge (codex)"
    ai "$R/judge.log" codex_rw "$(p judge __X__ "$X" __Y__ "$Y" __FINDINGS__ "$R/findings.md" __OUT__ "$R/judge.md")"
  fi
  rm -rf "$R/check"   # the fixer's quick recordings
  after=$(grep -q "X=after" "$R/key.txt" && echo X || echo Y)
  overall=$(awk '/^## Overall/{f=1; next} f && NF {print; exit}' "$R/judge.md" | sed "s/^$after better/after better/; s/^[XY] better/before better/" | cut -c1-160)
  gates=$(grep -h "LAYOUT" "$A"/*/review/packet.md 2>/dev/null | grep -c FAIL || true)
  status "- round $n ($(date +%m-%d\ %H:%M), $(( ($(date +%s) - T0) / 60 )) min): $(grep -c '^### F' "$R/findings.md") findings; review $(grep -o 'VERDICT: [a-z]*' "$R/fix-review.md" | cut -d' ' -f2)$( [ -f "$R/fix-2.md" ] && echo ', revised'); layout fails in $gates clips; judge: $overall"
  archive "$B" $(ls -d reels/r*-after 2>/dev/null | grep -v "^$A\$")
  echo "== round $n done: $(tail -1 look/STATUS.md)"
  n=$((n + 1))
done
