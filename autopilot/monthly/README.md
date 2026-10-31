# Directiva mensual

`autopilot/monthly/current.md` es la directiva operativa del mes. La escribe el
agente `autopilot` en su primera ejecución de cada mes a partir del informe
canónico `autopilot/reports/monthly/<YYYY-MM>.md` del mes anterior.

Todos los agentes la leen antes de empezar:

- `ideator` → `role_directives.ideator`
- `mapmaker` → `role_directives.mapmaker`
- `blogger` → `role_directives.blogger`
- `reviewer` → `role_directives.reviewer`

Si `current.md` no existe, está caducada (más de 45 días) o su `month` no
corresponde al mes en curso, los agentes ignoran la directiva y usan su prompt y
`autopilot/CHARTER.md`.

El día 1, `autopilot` espera al informe del mes anterior. Si no está, no escribe
un fallback ese día: lo reintenta en los ciclos siguientes. A partir del día 2-3
puede escribir una directiva de fallback (`fallback: true`) y la refresca en
cuanto aparezca el informe final.

## Reglas

- `autopilot` es el único que escribe `current.md`.
- El archivo se commitea y pushea a `main` como única excepción a la regla de no
  escribir en `main`: así el resto de agentes lo ve en su siguiente ejecución.
- Solo se tocan `autopilot/monthly/current.md` y el archivo de archivo
  `autopilot/monthly/<YYYY-MM>.md` (mes en curso) en ese commit.
- La directiva no puede contradecir `AGENTS.md`, las decisiones de producto ni
  las reglas de seguridad. Si hay conflicto, gana `AGENTS.md`.
- Máximo 3 prioridades. Cada una con métrica de éxito.

Plantilla: `TEMPLATE.md`.
