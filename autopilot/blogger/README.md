# Blog diario (ES + EN)

El agente `blogger` escribe una noticia diaria en español e inglés con un mapa
interactivo del editor de Maña Maps. El prompt canónico vive en
`.opencode/agent/blogger.md` y el wrapper para el autopilot en
`autopilot/agents/blogger.md`.

## Instalación en el iMac

1. Añade el agente a `~/autopilot/opencode.json`:

```json
"blogger": {
  "description": "Escribe el post diario bilingüe (ES/EN) con un mapa interactivo.",
  "mode": "primary",
  "prompt": "{file:./agents/blogger.md}",
  "steps": 60,
  "permission": {
    "question": "deny",
    "read": "allow",
    "edit": "allow",
    "bash": "allow",
    "glob": "allow",
    "grep": "allow",
    "list": "allow",
    "webfetch": "allow",
    "websearch": "allow",
    "task": "allow",
    "todowrite": "allow",
    "lsp": "deny",
    "skill": "allow"
  }
}
```

2. Copia el prompt wrapper al directorio de agentes del autopilot:

```sh
cp ~/autopilot/workspaces/mana-maps/autopilot/agents/blogger.md ~/autopilot/agents/blogger.md
```

3. Da permisos de ejecución al runner y carga el LaunchAgent:

```sh
chmod +x ~/autopilot/workspaces/mana-maps/autopilot/blogger/run_blogger.sh
cp ~/autopilot/workspaces/mana-maps/autopilot/blogger/com.mana-maps.blogger.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.mana-maps.blogger.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.mana-maps.blogger.plist
```

Se ejecuta todos los días a las 08:00 (hora local). Para cambiar la hora,
edita `StartCalendarInterval` en el plist y vuelve a cargarlo.

Los logs quedan en `~/autopilot/logs/blog-AAAAMMDD-HHMM.log`.

## Autonomía ante árbol sucio

El runner y el loop llaman a `~/autopilot/scripts/recover_workspace.sh` antes
de sincronizar. Si solo hay cambios de blog (`blog/`, `en/blog/`, `sitemap.xml`)
los commitea y publica en `main`; cualquier otro cambio se preserva en una rama
`autopilot/rescue-<fecha>` y el workspace vuelve limpio. Así un post a medias
ya no bloquea el autopilot.

Al terminar, `run_blogger.sh` verifica que el árbol está limpio y que `HEAD`
coincide con `origin/main`; si no, registra `BLOG_RC=1` y sale con error.
