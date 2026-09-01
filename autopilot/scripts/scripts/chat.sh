#!/usr/bin/env bash
# chat.sh - Conversa con el agente chat (opencode en Docker) y devuelve su respuesta en texto plano
# El agente trabaja directamente en el repo de mana-maps y puede editar/commit/push.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCKER=/Applications/Docker.app/Contents/Resources/bin/docker
HISTORY="$ROOT/logs/chat-history.json"
REPO_DIR="$ROOT/workspaces/mana-maps"
MSG="${1:-}"

[ -n "$MSG" ] || { echo "(sin mensaje)"; exit 1; }

# asegurar que el repo esta al dia
if [ -d "$REPO_DIR/.git" ]; then
  (cd "$REPO_DIR" && git fetch origin -q && git checkout main -q 2>/dev/null && git pull --rebase origin main -q 2>/dev/null) || true
fi

CTX=""
if [ -f "$HISTORY" ]; then
  CTX=$(node -e "
    const fs=require('fs');
    let h=[];
    try { h=JSON.parse(fs.readFileSync('$HISTORY','utf8')); } catch(e){}
    h=h.slice(-6);
    const parts=h.map(x=>'Erik: '+(x.from||'')+'\nTu: '+(x.reply||''));
    process.stdout.write('Conversacion anterior (usala como contexto):\n'+parts.join('\n---\n')+'\n');
  " 2>/dev/null)
fi

PROMPT="Mensaje de Erik por WhatsApp: $MSG

$CTX

Instrucciones de ejecucion:
- Trabaja sobre el repositorio de mana-maps (ya estas en su directorio).
- Si el mensaje pide un cambio en la web, implementalo directamente: edita los
  archivos, ejecuta tests si los hay (npx playwright test -c tests/predeploy/playwright.config.js),
  y publica con: git pull --rebase origin main, git add -A, git commit,
  git push origin main.
- Si el mensaje pide apuntar una tarea, anadela al BACKLOG.md (- [ ] ...) y haz commit+push.
- Responde en espanol, breve: que hiciste, archivos tocados y estado del push."

OUT=$("$DOCKER" run --rm \
  -v /Users/Erik:/home/erik \
  -w /home/erik/autopilot/workspaces/mana-maps \
  -e HOME=/home/erik \
  -e GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new -i /home/erik/.ssh/id_ed25519" \
  plan7-opencode \
  opencode run --agent chat --auto --model opencode-go/mimo-v2.5 --print-logs=false "$PROMPT" 2>/dev/null)

RC=$?
CLEAN=$(printf '%s' "$OUT" | sed -E 's/\x1b\[[0-9;]*m//g' | sed -E 's/^\s+|\s+$//g')
[ "$RC" -ne 0 ] && echo "(el agente fallo: rc=$RC)" && exit 1
[ -z "$CLEAN" ] && echo "(sin respuesta)" && exit 1

node -e "
  const fs=require('fs');
  const f='$HISTORY';
  let h=[];
  try { h=JSON.parse(fs.readFileSync(f,'utf8')); } catch(e){}
  h.push({t:Date.now(), from:process.argv[1], reply:process.argv[2]});
  h=h.slice(-20);
  fs.writeFileSync(f, JSON.stringify(h, null, 2));
" "$MSG" "$CLEAN" 2>/dev/null

printf '%s' "$CLEAN"
