# Autopilot — réplica del sistema del iMac

Esta carpeta es una **réplica exacta** de `~/autopilot` del iMac `iMac de Erik` (192.168.1.138, macOS 10.15.8) a fecha 2026-09-01. Sirve para entender cómo funciona el sistema automático de `mana-maps`.

## Arquitectura

- **Trigger:** `launchd` cada 6h (`launcher/com.erik.autopilot.loop.plist` → `StartInterval 21600`) + `run_loop.sh` que lee `BACKLOG.md` del repo `mana-maps`.
- **Ejecución:** `run_loop.sh` lanza `opencode run --agent autopilot --auto --model opencode-go/mimo-v2.5 "Procesa la siguiente tarea del BACKLOG.md"` vía Docker `plan7-opencode` (`docker/Dockerfile`).
- **Agentes:**
  - `agents/autopilot.md` — implementa la primera tarea `- [ ]` del BACKLOG, crea rama `autopilot/AAAAMMDD-slug`, ejecuta tests, commitea y pushea.
  - `agents/reviewer.md` — subagente que revisa `git diff` sin modificar.
  - `agents/mapmaker.md` — crea mapas nuevos con pipeline Natural Earth → Firestore.
  - `agents/ideator.md` — audita la galería y propone tareas en `BACKLOG.md`.
  - `agents/chat.md` — bot de WhatsApp (`whatsapp-bot/bot.js`).

## Flujo

1. `run_loop.sh` hace `git pull`, cuenta `pending=$(grep "^- \[ \]")`, y si >0 lanza `opencode`.
2. `opencode` crea rama, implementa, pasa `npx playwright test`, commitea `BACKLOG.md` y `changelog`, hace `push` y (si hay `GITHUB_TOKEN`) `PR`.
3. Si `rc==0` hace `merge` a `main` en una sola subida y espera `ci_wait` (GitHub Checks). Si `rc!=0` o `Killed:9`/`124`, lo registra en `logs/tasks.json` y `tasks.html`.

## Configuración

Ver `autopilot/config.json.example` (intervalos, modelo, `maxRunsPerDay`). El `config.json` real con `githubToken` y `whatsapp.ownerNumber` **no** se commitea (ver `.gitignore`).

## Logs en el iMac

- `logs/loop.log` — una línea por iteración
- `logs/tasks.json` — historial con `rc` (0 OK, 1 error, 124 timeout, 137 Killed)
- `logs/sessions/AAAAMMDD-HHMM-mana-maps.md` — transcripción completa del agente
- `logs/launchd-*.log` — salida de `launchd`

## Requisitos iMac

- Docker Desktop con 4GB (antes 2GB, causaba `Killed:9`), `lsof`/`ps` en la imagen para matar `http.server 4175`
- `~/autopilot/.publisher-credentials.json` con `email/password/apiKey/projectId` para Firestore (`isPublisher()` en `firestore.rules`)
- Node 20+ y `opencode-ai` global
