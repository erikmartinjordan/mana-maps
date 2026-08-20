# Agentes de mana-maps

Este directorio contiene las definiciones de los agentes autónomos del proyecto.
Cada agente es un fichero Markdown con frontmatter YAML que define su descripción,
modo de ejecución y permisos.

## Agentes activos

| Fichero | Rol | Descripción |
|---|---|---|
| `daily-dev-agent.md` | QA Engineer | Ejecuta tests Playwright, inspecciona errores de consola, revisa UI y recomienda correcciones. |
| `daily-marketing-agent.md` | Content Writer | Escribe un artículo diario de geografía y mapas en español. Solo usa websearch/webfetch para investigar. |

## Convenciones

- Los agentes se ejecutan desde OpenCode con `subagent_type` o como `primary`.
- Los agentes **no** deben modificar ficheros de configuración de auth ni secrets.
- Los agentes de tipo `daily-*` se programan con periodicidad diaria.
- El historial de tareas ejecutadas se refleja en `tasks.html` (página pública, marcada `noindex`).
