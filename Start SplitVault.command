#!/bin/bash
# SplitVault launcher — double-click this file.
cd "$(dirname "$0")" || exit 1

NODE="$(command -v node)"
if [ -z "$NODE" ]; then
  for c in "$HOME"/.hermes/tools/node-*/bin/node /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -x "$c" ] && NODE="$c" && break
  done
fi
if [ -z "$NODE" ]; then
  echo "Node.js not found. Install it, or run: PORT=8795 /path/to/node server.mjs"
  read -r -n 1 -p "Press any key to close." _
  exit 1
fi

PORT="${PORT:-8795}"
mkdir -p data

if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo "SplitVault is already running on http://127.0.0.1:$PORT/"
else
  echo "Starting SplitVault with $NODE"
  nohup "$NODE" server.mjs > data/server.log 2>&1 &
  for _ in $(seq 1 80); do
    curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
    sleep 0.25
  done
fi

if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo "Up. Keys: 1857 → games, 1936 → instagram"
  open "http://127.0.0.1:$PORT/"
else
  echo "It did not come up. Tail of data/server.log:"
  tail -20 data/server.log 2>/dev/null
  read -r -n 1 -p "Press any key to close." _
fi
