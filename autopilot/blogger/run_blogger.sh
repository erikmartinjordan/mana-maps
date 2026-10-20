#!/usr/bin/env bash
set -u

ROOT="$HOME/autopilot"
REPO="$ROOT/workspaces/mana-maps"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/blog-$(date +%Y%m%d-%H%M).log"

export PATH="$HOME/bin:$HOME/node/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

cd "$REPO" || {
  echo "No existe el repo en $REPO" >>"$LOG"
  exit 1
}

# Evita solaparse con el loop principal (cada 45 min): espera hasta 15 min.
for _ in $(seq 1 30); do
  [ ! -d "$ROOT/.loop.lock" ] && break
  sleep 30
done
if [ -d "$ROOT/.loop.lock" ]; then
  echo "Loop principal ocupado; se pospone el blog." >>"$LOG"
  exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Repo con cambios sin commitear; se aborta el blog." >>"$LOG"
  exit 1
fi

git fetch origin main >>"$LOG" 2>&1
git checkout main >>"$LOG" 2>&1
git pull --ff-only origin main >>"$LOG" 2>&1

MODEL_OPT=""
if [ -f "$ROOT/config.json" ]; then
  MODEL=$(node -e "try{const c=require('$ROOT/config.json');process.stdout.write(c.model||'')}catch(e){}" 2>/dev/null || true)
  [ -n "$MODEL" ] && MODEL_OPT="--model $MODEL"
fi

# opencode corre dentro del contenedor con el home montado en /home/erik.
OPDIR=$(printf '%s' "$REPO" | sed "s|^$HOME|/home/erik|")

opencode run --dir "$OPDIR" --agent blogger --auto $MODEL_OPT \
  "Escribe y publica el post diario bilingüe (es/en) con un mapa interactivo. Sigue .opencode/agent/blogger.md." \
  >>"$LOG" 2>&1

echo "BLOG_RC=$?" >>"$LOG"
