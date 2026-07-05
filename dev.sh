#!/usr/bin/env bash
# Dev server: watches src/, rebuilds TS and copies static files, restarts node.
# Usage: ./dev.sh
#
# Runs tsc --watch in the background for fast TS recompilation.
# Runs node --watch on the build dir so the server restarts when tsc emits new JS.
set -euo pipefail

if [ -f ~/.m365mutator-env ]; then
  set -a; source ~/.m365mutator-env; set +a
fi
# Ensure session cookies work over plain HTTP. Only set NODE_ENV=production in a
# deployment that terminates TLS (reverse proxy).
export NODE_ENV="${NODE_ENV:-development}"

PORT="${PORT:-3700}"
EXISTING_PID=$(lsof -ti :"$PORT" 2>/dev/null || true)
if [ -n "$EXISTING_PID" ]; then
  echo "[dev] Killing existing process on port $PORT (PID $EXISTING_PID)..."
  kill "$EXISTING_PID" 2>/dev/null || true
  sleep 0.5
fi

npm run build

tsc --watch --preserveWatchOutput &
TSC_PID=$!

SERVER_PID=""
cleanup() {
  trap - EXIT INT TERM
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  kill "$TSC_PID" 2>/dev/null || true
  PORT_PID=$(lsof -ti :"$PORT" 2>/dev/null || true)
  [ -n "$PORT_PID" ] && kill "$PORT_PID" 2>/dev/null || true
}
trap 'cleanup; exit 0' INT TERM
trap cleanup EXIT

while true; do
  echo "[dev] Starting server..."
  node --watch --watch-path=build build/main.js &
  SERVER_PID=$!
  wait "$SERVER_PID" || true
  echo "[dev] Server exited, restarting..."
  sleep 0.5
done
