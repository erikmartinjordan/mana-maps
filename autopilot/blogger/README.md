# News diario (ES + EN)

El agente `blogger` escribe la pieza diaria de News en español e inglés con un
mapa interactivo del editor de Maña Maps. El prompt canónico vive en
`autopilot/agents/blogger.md` y es el único sitio donde se mantiene.

## Ejecución

Ya no hay runner ni LaunchAgent propios. El loop `~/autopilot/run_loop.sh` lo
ejecuta como primer trabajo de cada ciclo:

- **07:00** — primer intento.
- **13:00** — reintento si falta el post del día.
- **19:00** — segundo reintento si sigue faltando.
- **01:00** — no ejecuta News (fuera de la ventana 07–23 h).

El loop sincroniza los prompts desde `autopilot/agents/`, lanza
`opencode run --agent blogger` (120 steps) y publica en `main` solo si
`news/posts.json` contiene la fecha de hoy y existen las páginas ES/EN.

Si el agente deja trabajo sin commitear, el loop lo commitea y lo pushea. Si el
resultado no es válido, lo guarda en `git stash` y lo reintenta en el siguiente
ciclo (máximo 3 intentos al día).

Los logs quedan en `~/autopilot/logs/sessions/blogger-AAAAMMDD-HHMM.md` y en
`~/autopilot/logs/loop.log`.
