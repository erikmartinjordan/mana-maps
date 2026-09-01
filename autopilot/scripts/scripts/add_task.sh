#!/usr/bin/env bash
# add_task.sh - Anade una tarea al BACKLOG del primer repo
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${2:-mana-maps}"
TEXT="$1"
if [ -z "${TEXT:-}" ]; then
  echo "Uso: $0 \"<texto de la tarea>\" [repo]"
  exit 1
fi
mkdir -p "$ROOT/queue"
node -e "const fs=require('fs');fs.writeFileSync(process.argv[1],JSON.stringify({cmd:'task',repo:process.argv[2],text:process.argv[3]}))" \
  "$ROOT/queue/$(date +%s%N).json" "$REPO" "$TEXT"
echo "Tarea encolada para $REPO"
