#!/usr/bin/env bash
set -u

ROOT="$HOME/autopilot"
REPO="$ROOT/workspaces/mana-maps"
LOG_DIR="$ROOT/logs"
RECOVER="$ROOT/scripts/recover_workspace.sh"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/news-$(date +%Y%m%d-%H%M).log"

export PATH="$HOME/bin:$HOME/node/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

cd "$REPO" || {
  echo "No existe el repo en $REPO" >>"$LOG"
  exit 1
}

# Evita solaparse con el loop principal (cada 6 h): espera hasta 15 min.
for _ in $(seq 1 30); do
  [ ! -d "$ROOT/.loop.lock" ] && break
  sleep 30
done
if [ -d "$ROOT/.loop.lock" ]; then
  echo "Loop principal ocupado; se pospone el blog." >>"$LOG"
  exit 0
fi

# Autonomía: si quedó trabajo de una ejecución anterior, se publica (blog) o se
# rescata en una rama antes de empezar, para no bloquear el loop.
if [ -x "$RECOVER" ]; then
  "$RECOVER" "$REPO" >>"$LOG" 2>&1
  REC_RC=$?
  if [ "$REC_RC" -ne 0 ]; then
    echo "BLOG_RC=1 (recovery rc=$REC_RC; revisar $ROOT/logs/recovery.log)" >>"$LOG"
    exit 1
  fi
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "Repo sucio tras el rescate; se aborta el blog." >>"$LOG"
  exit 1
fi

git fetch origin main >>"$LOG" 2>&1
git checkout main >>"$LOG" 2>&1
git pull --ff-only origin main >>"$LOG" 2>&1

# El prompt canónico vive en el repo (autopilot/agents/blogger.md). Lo
# sincronizamos con la config global de opencode para que el agente `blogger`
# esté disponible sin duplicar el archivo en .opencode/agent/.
if [ -f "$REPO/autopilot/agents/blogger.md" ]; then
  mkdir -p "$HOME/.config/opencode/agents" "$ROOT/agents"
  cp "$REPO/autopilot/agents/blogger.md" "$HOME/.config/opencode/agents/blogger.md"
  cp "$REPO/autopilot/agents/blogger.md" "$ROOT/agents/blogger.md"
fi

MODEL_OPT=""
if [ -f "$ROOT/config.json" ]; then
  MODEL=$(node -e "try{const c=require('$ROOT/config.json');process.stdout.write(c.model||'')}catch(e){}" 2>/dev/null || true)
  [ -n "$MODEL" ] && MODEL_OPT="--model $MODEL"
fi

# opencode corre dentro del contenedor con el home montado en /home/erik.
OPDIR=$(printf '%s' "$REPO" | sed "s|^$HOME|/home/erik|")

opencode run --dir "$OPDIR" --agent blogger --auto $MODEL_OPT \
  "Escribe y publica la pieza diaria de News bilingüe (es/en) con un mapa interactivo. Sigue autopilot/agents/blogger.md. No termines sin haber hecho commit y push a main y sin dejar git status limpio." \
  >>"$LOG" 2>&1
AGENT_RC=$?
echo "OPENCODE_RC=$AGENT_RC" >>"$LOG"

# Si el agente dejó el trabajo sin commitear, lo publicamos nosotros.
if [ -x "$RECOVER" ]; then
  "$RECOVER" "$REPO" >>"$LOG" 2>&1
  REC_RC=$?
  if [ "$REC_RC" -ne 0 ]; then
    echo "BLOG_RC=1 (recovery rc=$REC_RC; el post no quedo en main; revisar $ROOT/logs/recovery.log)" >>"$LOG"
    exit 1
  fi
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "BLOG_RC=1 (arbol sucio tras la ejecucion)" >>"$LOG"
  exit 1
fi

git fetch origin main >>"$LOG" 2>&1
LOCAL=$(git rev-parse HEAD 2>/dev/null || echo '')
REMOTE=$(git rev-parse origin/main 2>/dev/null || echo '')
if [ "$LOCAL" != "$REMOTE" ]; then
  git push origin main >>"$LOG" 2>&1 || true
  git fetch origin main >>"$LOG" 2>&1
  LOCAL=$(git rev-parse HEAD 2>/dev/null || echo '')
  REMOTE=$(git rev-parse origin/main 2>/dev/null || echo '')
fi
if [ "$LOCAL" != "$REMOTE" ]; then
  echo "BLOG_RC=1 (HEAD $LOCAL no esta en origin/main $REMOTE)" >>"$LOG"
  exit 1
fi

echo "BLOG_RC=0 (publicado $LOCAL)" >>"$LOG"
exit 0
