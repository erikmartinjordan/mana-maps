#!/usr/bin/env bash
# install_agents.sh - Instala los agentes autopilot en la config global de opencode
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$HOME/.config/opencode/agents"
mkdir -p "$TARGET"
cp "$ROOT"/agents/*.md "$TARGET/"
echo "Agentes instalados en $TARGET:"
ls "$TARGET"
