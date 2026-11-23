#!/bin/sh
# The look loop, in lanes. Each round: merge the other lane's branch; record frame-exact clips; blind witnesses from
# more than one model family review them, each with its own focus; a merge verifies and ranks what is in this lane's
# scope and hands the rest to the other lane; a fixer works the list in the files this lane owns; a reviewer checks the
# fix against the goals and hard limits, and the fixer revises if told to; a re-record, a blind judge, a commit.
#   LANE=a|b tools/look.sh [rounds, 0 = until stopped] [clip,clip]
# Lane a (this tree, branch main): the 3D board; Claude fixes. Lane b (lanes/codex, branch lane-codex): the HTML around
# it; Codex fixes. Codex reviews in both (CODEX_REVIEW_*), and fixes lane b (CODEX_FIX_*). Each lane writes
# look/round-N/, look/STATUS.md and look/handoff.md (findings for the other lane). Usage limits are waited out;
# `touch look/STOP` ends a lane after its current round.
set -e
TOOLS="$(cd "$(dirname "$0")" && pwd)"; MAIN="$(dirname "$TOOLS")"; LANE="${LANE:-a}"
SELF="$(shasum "$TOOLS/look.sh" | cut -c1-12)"; ARGS="$*"
ROUNDS="${1:-1}"
case "$LANE" in
  a) HERE="$MAIN"; OTHER=lane-codex; OTHER_DIR="$MAIN/lanes/codex"; FIXER_CLI=claude
     OWN="client/h.js client/fx.js client/world.js client/img tools/boards.js tools/plays.js"
     SCOPE="the 3D board: cards, standees, piles, pages, plaques, labels and effects drawn on the table, how they are laid out and how they move (client/h.js, fx.js, world.js)"
     WITNESSES="claude:polish codex:board-still codex:board-motion" ;;
  b) HERE="$MAIN/lanes/codex"; OTHER=main; OTHER_DIR="$MAIN"; FIXER_CLI=codex
     OWN="client/live.js client/live.css client/live.html client/live-boot.js client/common.css client/common.js client/g.css client/g.js client/h.css client/table-kit.css client/table-kit.js client/index.html"
     SCOPE="the HTML around the board: the prompt and its buttons, the stack panel, sheets of cards, the log, toasts, the loss strip and the hand fan, their text, look, placement and timing (client/live.js and the CSS and HTML files)"
     WITNESSES="codex:chrome-still codex:chrome-motion codex:chrome-board" ;;
  *) echo "LANE must be a or b"; exit 2 ;;
esac
cd "$HERE"
CLIPS="${2:-$(node -e 'console.log(require("./tools/clips.js").filter(c => !c.manual).map(c => c.name).join(","))')}"
FIXER="${FIXER:-opus}"; WITNESS="${WITNESS:-opus}"
CODEX_REVIEW_MODEL="${CODEX_REVIEW_MODEL:-gpt-6.2-astra}"; CODEX_REVIEW_EFFORT="${CODEX_REVIEW_EFFORT:-high}"
CODEX_FIX_MODEL="${CODEX_FIX_MODEL:-gpt-6.2-sol}"; CODEX_FIX_EFFORT="${CODEX_FIX_EFFORT:-xhigh}"
mkdir -p look

# One server for this lane's recordings and eval (python's http.server drops connections when browsers load in parallel).
PORT=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
node tools/serve.js "$PORT" >/dev/null & SERVER=$!; RECORDER=""; trap 'kill $SERVER $RECORDER 2>/dev/null' EXIT
export BASE="http://127.0.0.1:$PORT/"

p() { python3 -c 'import sys; s = open(sys.argv[1] + "/look/" + sys.argv[2] + ".md").read(); a = sys.argv[3:]
for k, v in zip(a[::2], a[1::2]): s = s.replace(k, v)
sys.stdout.write(s)' "$TOOLS" "$@"; }
sum() { find client -type f -not -path '*/img/*' | sort | xargs cat | shasum | cut -c1-12; }
record() { rm -rf "${1:?}"; node tools/reel.js "$1" "$CLIPS" && node tools/packet.js "$1" >/dev/null && sum >"$1/client.sum"; }
# A usage limit ends a run with a "resets <time>" message: wait until then (or 30 min) and say so.
limited() { tail -5 "$1" | grep -qiE "hit your .*limit|usage limit|rate.?limit"; }
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
codex_rw() { codex exec --skip-git-repo-check -s workspace-write -m "$CODEX_REVIEW_MODEL" -c model_reasoning_effort="$CODEX_REVIEW_EFFORT" "$1"; }
codex_fix() { codex exec --skip-git-repo-check -s workspace-write -m "$CODEX_FIX_MODEL" -c model_reasoning_effort="$CODEX_FIX_EFFORT" "$1"; }
FIXTOOLS="Read,Edit,Write,Glob,Grep,Bash(node tools/*),Bash(ls *),Bash(diff *),Bash(rm reels/*),Bash(rm tools/_*),Bash(git diff*),Bash(git status*)"
# Claude fixes in one session per round (a retry after a limit, and the revision, resume it). Codex fixes sandboxed,
# where a browser can't start: it asks this loop to record (recorder below) and reads the packets.
fixer() {   # fixer <log> <prompt> [session file]
  if [ "$FIXER_CLI" = codex ]; then ai "$1" codex_fix "$2"; return; fi
  sf="${3:-$R/fixer.sid}"; sid="$(cat "$sf" 2>/dev/null || true)"
  if [ -z "$sid" ]; then sid=$(uuidgen | tr A-Z a-z); echo "$sid" >"$sf"; claude -p --model "$FIXER" --session-id "$sid" --allowedTools "$FIXTOOLS" --max-turns 250 "$2" >"$1" 2>&1 || true
  else claude -p --model "$FIXER" --resume "$sid" --allowedTools "$FIXTOOLS" --max-turns 250 "$2" >"$1" 2>&1 || true; fi
  while limited "$1"; do wait_reset "$1"; claude -p --model "$FIXER" --resume "$sid" --allowedTools "$FIXTOOLS" --max-turns 250 "Continue where you left off." >"$1" 2>&1 || true; done
}
record_how() {
  if [ "$FIXER_CLI" = codex ]; then
    echo "- To record, write the clip names, comma-separated, to $R/check.request, then wait (sleep 20 between looks) until $R/check.done exists; the packets are then in $R/check/<clip>/review/ and the log in $R/check.log. A browser can't start in your sandbox, so don't run reel.js yourself. \`node tools/clips.js\` lists the clips. Open the same images the findings cite and compare."
  else
    echo "- \`node tools/reel.js $R/check <clip,clip> --quick\` then \`node tools/packet.js $R/check\` re-records just the clips you need at 15 fps. \`node tools/clips.js\` lists the clips. Open the same images the findings cite and compare."
  fi
}
recorder() {   # records what a sandboxed fixer asks for, until the fixer is done
  while :; do
    if [ -f "$R/check.request" ]; then c=$(tr -d ' \n' <"$R/check.request"); rm -f "$R/check.request" "$R/check.done"
      { node tools/reel.js "$R/check" "$c" --quick && node tools/packet.js "$R/check"; } >"$R/check.log" 2>&1 || true; touch "$R/check.done"; fi
    sleep 5
  done
}
run_fixer() {   # run_fixer <log> <prompt> [session file]: with the recorder alongside for a sandboxed fixer
  [ "$FIXER_CLI" = codex ] && { recorder & RECORDER=$!; }
  fixer "$1" "$2" "$3"
  [ -n "$RECORDER" ] && { kill "$RECORDER" 2>/dev/null; RECORDER=""; }
  return 0
}
# Only this lane's files may change: anything else the fixer touched goes back to how the round started.
keep_scope() {
  for f in $(git diff --name-only HEAD -- client tools; git ls-files --others --exclude-standard -- client tools); do
    case " $OWN " in *" $f "*|*" $(dirname "$f") "*) ;; *) echo "- out of scope, reverted: $f"; git checkout -q HEAD -- "$f" 2>/dev/null || rm -f "$f" ;; esac
  done
}
status() { printf '%s\n' "$1" >>look/STATUS.md; }
[ -f look/STATUS.md ] || printf '# Look loop, lane %s: one line per round\n\n' "$LANE" >look/STATUS.md
# Finished recordings keep their video, sheets and stills; the raw frames go, and the rest moves to the NAS working
# share (config/nas-working-storage.json) when it is mounted, since the local disk is tight.
ARCHIVE="$HOME/NAS/OpenClaw Workspace/seat-look-reels/lane-$LANE"
archive() {
  for d in "$@"; do
    [ -d "$d" ] || continue; rm -rf "${d:?}"/*/frames "${d:?}"/*/still-*.png
    if mount | grep -q "on $HOME/NAS/OpenClaw Workspace "; then mkdir -p "$ARCHIVE" && rsync -a --remove-source-files "${d:?}" "$ARCHIVE/" && rm -rf "${d:?}"; fi
  done
}
free_gb() { df -g "$HERE" | awk 'NR == 2 { print $4 }'; }
disk_guard() {   # below 8 GB free, archive every recording but the newest; below 6, wait for room
  [ "$(free_gb)" -ge 8 ] && return 0
  archive $(ls -dt reels/r*-* 2>/dev/null | tail -n +2)
  while [ "$(free_gb)" -lt 6 ]; do echo "   disk: $(free_gb) GB free, waiting ($(date +%H:%M))"; sleep 1800; done
}

last=$(ls -d look/round-*/ 2>/dev/null | sed 's#.*round-##; s#/$##' | grep -E '^[0-9]+$' | sort -n | tail -1); n=${last:-1}
[ -n "$last" ] && [ -f "look/round-$last/judge.md" ] && n=$((last + 1))
i=0
while [ "$ROUNDS" -eq 0 ] || [ "$i" -lt "$ROUNDS" ]; do
  [ -f look/STOP ] && { rm -f look/STOP; echo "== stopped"; break; }
  i=$((i + 1)); R="look/round-$n"; B="reels/r$n-before"; A="reels/r$n-after"; PA="reels/r$((n - 1))-after"
  disk_guard
  if [ ! -d "$R" ]; then
    # A new round starts from the other lane's latest committed work; the lanes own different files.
    if git merge -q --no-edit "$OTHER" >/dev/null 2>&1; then echo "== round $n: merged $OTHER ($(git rev-parse --short HEAD))"
    else git merge --abort 2>/dev/null || true; status "- round $n: merging $OTHER conflicted; went on without it"; echo "== round $n: merge of $OTHER conflicted, went on without it"; fi
  fi
  mkdir -p "$R"; echo "$LANE $CLIPS" >"$R/focus.txt"; T0=$(date +%s)
  if [ ! -d "$B" ]; then
    # The last round's after-recording is this round's before, if the client hasn't changed since and the clips match.
    if [ -f "$PA/client.sum" ] && [ "$(cat "$PA/client.sum")" = "$(sum)" ] && [ "$(cut -d' ' -f2 "look/round-$((n - 1))/focus.txt" 2>/dev/null)" = "$CLIPS" ]; then
      echo "== round $n: reusing $PA"; cp -R "$PA" "$B"; node tools/packet.js "$B" >/dev/null   # packets follow the current audit
    else echo "== round $n: recording"; record "$B"; fi
  fi
  [ -d "$R/client-before" ] || cp -R client "$R/client-before"
  if [ ! -f "$R/findings.md" ]; then
    echo "== round $n: witnesses ($WITNESSES)"; PIDS=""; LIST=""
    for w in $WITNESSES; do
      cli=${w%%:*}; focus=${w#*:}; out="$R/witness-$cli-$focus.md"; LIST="$LIST $out"
      [ -s "$out" ] && continue
      prompt="$(p witness __PACKETS__ "$B" __OUT__ "$out" __FOCUS__ "$(cat "$TOOLS/look/focus-$focus.md")")"
      if [ "$cli" = claude ]; then ai "$out.log" claude_ro "$prompt" & else ai "$out.log" codex_rw "$prompt" & fi
      PIDS="$PIDS $!"
    done
    for w in $PIDS; do wait "$w" || true; done   # these only: the server runs in the background too
    echo "== round $n: merge (codex)"
    PJ="look/round-$((n - 1))/judge.md"; PRIOR=""; INBOX=""
    [ -f "$PJ" ] && PRIOR="The previous round's judge compared the recordings before it and noted differences in $PJ (its key is in look/round-$((n - 1))/key.txt). Where it named something worse in the newer version that you can still see in these packets, it belongs in the list."
    [ -s "$OTHER_DIR/look/handoff.md" ] && INBOX="The other lane handed findings in this lane's scope to $OTHER_DIR/look/handoff.md: verify them like a witness's."
    ai "$R/merge.log" codex_rw "$(p merge __WITNESSES__ "$(echo $LIST | sed 's/ /, /g')" __PACKETS__ "$B" __OUT__ "$R/findings.md" __PRIOR__ "$PRIOR" __SCOPE__ "$SCOPE" __INBOX__ "$INBOX" __HANDOFF__ "look/handoff.md")"
    [ -f "$R/findings.md" ] || { echo "merge wrote no $R/findings.md:"; tail -3 "$R/merge.log"; exit 1; }
  fi
  if [ ! -f "$R/fix.md" ]; then
    echo "== round $n: fix ($FIXER_CLI)"
    run_fixer "$R/fix.log" "$(p fix __FINDINGS__ "$R/findings.md" __PACKETS__ "$B" __OUT__ "$R/fix.md" __REVISE__ "" __OWN__ "$OWN" __RECORD__ "$(record_how)")"
    [ -f "$R/fix.md" ] || { echo "fixer wrote no $R/fix.md:"; tail -3 "$R/fix.log"; exit 1; }
    # A fixer that stops with findings unattempted is followed by a fresh one (a clean context) for the rest, twice at most.
    for k in 2 3; do
      grep -qiE "not attempted|not reached|didn.t get to|did not get to|ran out of|left for (a|the) next|remaining findings" "$R/fix.md" || break
      echo "== round $n: fix, continued ($k)"
      run_fixer "$R/fix-cont$k.log" "$(p fix __FINDINGS__ "$R/findings.md" __PACKETS__ "$B" __OUT__ "$R/fix.md" __OWN__ "$OWN" __RECORD__ "$(record_how)" __REVISE__ "An earlier fixer this round worked some of these findings and wrote $R/fix.md; its changes are in the client now (diff -ru $R/client-before client). Continue with the findings it did not attempt, from the top. Rewrite $R/fix.md to cover the whole round: its results and yours.")" "$R/fixer-$k.sid"
    done
    keep_scope >>"$R/fix.md"
  fi
  # Re-record after the fix (and again after a revision): its own step, so a restart picks it up.
  if [ ! -f "$A/client.sum" ] || { [ -f "$R/fix-2.md" ] && [ "$R/fix-2.md" -nt "$A/client.sum" ]; }; then
    echo "== round $n: recording after the fix"; record "$A"
    node tools/eval.js "$R/eval" webkit >"$R/eval.log" 2>&1 || true
  fi
  if [ ! -f "$R/fix-review.md" ]; then
    echo "== round $n: fix review (codex)"
    ai "$R/fix-review.log" codex_rw "$(p review-fix __FINDINGS__ "$R/findings.md" __FIX__ "$R/fix.md" __BEFORE__ "$R/client-before" __AFTER__ "$A" __PACKETS__ "$B" __EVAL__ "$R/eval/eval.md" __OUT__ "$R/fix-review.md")"
  fi
  if grep -q "VERDICT: revise" "$R/fix-review.md" && [ ! -f "$R/fix-2.md" ]; then
    echo "== round $n: revision ($FIXER_CLI)"
    run_fixer "$R/fix-2.log" "An independent reviewer read the fix described in $R/fix.md and wrote $R/fix-review.md; the full re-recording it judged is in $A, and the eval in $R/eval/eval.md. Address everything under Must change, and Should change where you agree; where you disagree, say why. You own only: $OWN; edit nothing else. Check as before:
$(record_how)
Then write $R/fix-2.md."
    [ -f "$R/fix-2.md" ] || { echo "fixer wrote no $R/fix-2.md:"; tail -3 "$R/fix-2.log"; exit 1; }
    keep_scope >>"$R/fix-2.md"
    echo "== round $n: recording after the revision"; record "$A"
    node tools/eval.js "$R/eval" webkit >"$R/eval.log" 2>&1 || true
  fi
  if [ ! -f "$R/judge.md" ]; then
    # The judge doesn't know which recording is which.
    if [ $(( $(date +%s) % 2 )) -eq 0 ]; then X="$B"; Y="$A"; echo "X=before Y=after" >"$R/key.txt"; else X="$A"; Y="$B"; echo "X=after Y=before" >"$R/key.txt"; fi
    echo "== round $n: judge (codex)"
    ai "$R/judge.log" codex_rw "$(p judge __X__ "$X" __Y__ "$Y" __FINDINGS__ "$R/findings.md" __OUT__ "$R/judge.md")"
  fi
  rm -rf "$R/check"
  after=$(grep -q "X=after" "$R/key.txt" && echo X || echo Y)
  overall=$(awk '/^## Overall/{f=1; next} f && NF {print; exit}' "$R/judge.md" | sed "s/^$after better/after better/; s/^[XY] better/before better/" | cut -c1-160)
  # The round's work goes on this lane's branch, for the other lane to merge.
  git add -A client tools LOOK.md 2>/dev/null || true
  git -c user.name="mrmikedrum" -c user.email="mdrum@omitv.org" commit -qm "Look lane $LANE, round $n: $overall" 2>/dev/null || true
  gates=$(grep -h "LAYOUT" "$A"/*/review/packet.md 2>/dev/null | grep -c FAIL || true)
  status "- round $n ($(date +%m-%d\ %H:%M), $(( ($(date +%s) - T0) / 60 )) min): $(grep -c '^### F' "$R/findings.md") findings; review $(grep -o 'VERDICT: [a-z]*' "$R/fix-review.md" | cut -d' ' -f2)$( [ -f "$R/fix-2.md" ] && echo ', revised'); layout fails in $gates clips; judge: $overall"
  archive "$B" $(ls -d reels/r*-after 2>/dev/null | grep -v "^$A\$")
  echo "== round $n done: $(tail -1 look/STATUS.md)"
  n=$((n + 1))
  # A changed loop script takes over from the next round.
  if [ "$(shasum "$TOOLS/look.sh" | cut -c1-12)" != "$SELF" ] && { [ "$ROUNDS" -eq 0 ] || [ "$i" -lt "$ROUNDS" ]; }; then
    echo "== the loop script changed: reloading"; kill $SERVER 2>/dev/null; trap - EXIT
    [ "$ROUNDS" -eq 0 ] && exec "$TOOLS/look.sh" $ARGS || exec "$TOOLS/look.sh" $((ROUNDS - i)) $(echo $ARGS | cut -s -d' ' -f2-)
  fi
done
