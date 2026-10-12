#!/usr/bin/env bash
# Runs a command against the shared local Supabase stack, one caller at a time.
#
#   scripts/stack-lock.sh <command…>        e.g. scripts/stack-lock.sh npm run test:e2e
#   npm run locked -- <command…>            the same through npm
#
# Every agent's worktree shares one Docker Supabase stack and the fixed ports 3100/3101, so
# db:reset, test:db, test:e2e and the check:* scripts must not overlap (execution plan, section D).
# This takes a lock (a directory under /tmp: mkdir is atomic, and macOS has no flock), cds to the
# caller's worktree, runs `npm run db:reset` there (so the stack has that worktree's migrations),
# then runs the command, and releases the lock when it finishes, fails or is interrupted.
#
# A lock whose holder has died (its PID is gone) is taken over. Waits at most
# ORCA_LOCK_TIMEOUT seconds (default 3600), printing who holds the lock.
# Plain bash 3.2 (macOS), no GNU-only flags.

set -u

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/stack-lock.sh <command…>  (e.g. npm run locked -- npm run test:e2e)" >&2
  exit 2
fi

LOCK="${ORCA_STACK_LOCK:-/tmp/orca-supabase-stack.lock}"
TIMEOUT="${ORCA_LOCK_TIMEOUT:-3600}"
# npm runs scripts from the package root; INIT_CWD is where the caller ran it.
CALLER_DIR="${INIT_CWD:-$PWD}"
WORKTREE="$(git -C "$CALLER_DIR" rev-parse --show-toplevel 2>/dev/null)" || {
  echo "stack-lock: $CALLER_DIR isn't inside a git worktree" >&2
  exit 2
}

holder() { cat "$LOCK/owner" 2>/dev/null; }
holder_pid() { sed -n 's/^pid=//p' "$LOCK/owner" 2>/dev/null; }

# Age of the lock directory in seconds (BSD stat on macOS, GNU stat elsewhere).
lock_age() {
  local mtime
  mtime="$(stat -f %m "$LOCK" 2>/dev/null || stat -c %Y "$LOCK" 2>/dev/null)" || { echo 0; return; }
  echo $(( $(date +%s) - mtime ))
}

# A lock is stale when its holder's PID is dead, or when it has no owner file after 30 s (the
# holder died between mkdir and writing it).
is_stale() {
  local pid
  pid="$(holder_pid)"
  if [ -z "$pid" ]; then
    [ -d "$LOCK" ] && [ "$(lock_age)" -gt 30 ]
    return
  fi
  ! kill -0 "$pid" 2>/dev/null
}

acquired=0
child=""

release() {
  if [ "$acquired" = 1 ] && [ "$(holder_pid)" = "$$" ]; then
    rm -rf "$LOCK"
  fi
  acquired=0
}

on_signal() {
  local code="$1"
  if [ -n "$child" ]; then
    # The command runs in its own process group (set -m), so this reaches npm's children too.
    kill -TERM -- "-$child" 2>/dev/null || kill -TERM "$child" 2>/dev/null
    wait "$child" 2>/dev/null
  fi
  release
  exit "$code"
}

trap release EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
trap 'on_signal 129' HUP

start=$(date +%s)
last_note=0
while :; do
  if mkdir "$LOCK" 2>/dev/null; then
    acquired=1
    printf 'pid=%s\nworktree=%s\ncommand=%s\nsince=%s\n' "$$" "$WORKTREE" "$*" "$(date '+%Y-%m-%d %H:%M:%S')" > "$LOCK/owner.tmp"
    mv "$LOCK/owner.tmp" "$LOCK/owner"
    break
  fi
  if is_stale; then
    echo "stack-lock: taking over a stale lock ($(holder_pid | sed 's/^/pid /') is gone)" >&2
    # Rename first so two waiters can't both remove a lock someone else has just taken.
    stale="$LOCK.stale.$$"
    if mv "$LOCK" "$stale" 2>/dev/null; then
      pid="$(sed -n 's/^pid=//p' "$stale/owner" 2>/dev/null)"
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        # Someone took the lock between the check and the rename: give it back.
        [ -d "$LOCK" ] || mv "$stale" "$LOCK" 2>/dev/null || true
      else
        rm -rf "$stale"
      fi
    fi
    continue
  fi
  now=$(date +%s)
  if [ $(( now - start )) -ge "$TIMEOUT" ]; then
    echo "stack-lock: gave up after ${TIMEOUT}s; the stack is held by:" >&2
    holder | sed 's/^/  /' >&2
    exit 75
  fi
  if [ $(( now - last_note )) -ge 60 ]; then
    echo "stack-lock: waiting for the local Supabase stack, held by:" >&2
    holder | sed 's/^/  /' >&2
    last_note=$now
  fi
  sleep 2
done

cd "$WORKTREE" || exit 2
echo "stack-lock: locked; resetting the database from $WORKTREE" >&2

set -m
npm run db:reset &
child=$!
wait "$child"
status=$?
child=""
if [ "$status" -ne 0 ]; then
  echo "stack-lock: npm run db:reset failed ($status); is the stack up (npm run db:start)?" >&2
  exit "$status"
fi

"$@" &
child=$!
wait "$child"
status=$?
child=""
exit "$status"
