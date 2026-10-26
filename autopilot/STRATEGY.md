# Maña Maps — Estrategia de crecimiento a 2000 EUR/mes

## Objetivo
2000 EUR/mes de ingresos recurrentes vía suscripciones Pro (~50-100 suscriptores B2B a 20-40 EUR/mes, o 500 consumidores a 4-5 EUR/mes).

## Modelo: Product-Led Growth + Mapas como marketing
La galería no es contenido: es el OUTPUT del producto usado como bucle viral.
Cada mapa excelente = un enlace compartible en X que dice "hecho con Maña Maps" y
trae gente al editor. El motor del SEO eres haciendo mapas con tu propia herramienta.

## Embudo
X/SEO → mapa público (gallery) → CTA "haz tu mapa" → editor → plan gratuito → muro (3 mapas) → Pro

## Pilares (en orden)
1. PIPELINE DE MAPAS: agente genera mapas de datos reales, visualmente excelentes.
2. CALIDAD = DATO: el dato real, limpio y sorprendente es el 80% de la excelencia.
3. DISTRIBUCION: X.com + SEO por keyword. Cada mapa apunta a una busqueda real.
4. CONVERSION: CTA/watermark en cada mapa publico hacia el editor.
5. AUTOMATIZACION: agentes producen en masa, filtro de excelencia en medio.

## Métricas objetivo
- 0-3 meses: 50 mapas publicados, senal de traccion (compartidos o signups).
- Punto de decision: si tras 50-100 mapas no hay senal real, el problema no son
  mas mapas: es el embudo o el angulo.
- 2000 EUR/mes: 50-100 suscriptores B2B o 500 consumer.

## Restricciones
- Sin backend nuevo: GitHub Pages + Firebase existentes.
- Sin cuentas de pago externas de momento.
- El autopilot automatiza PRODUCCION, no el criterio.

## Ciclo mensual (operativo)

El último dato manda sobre la inercia. La primera ejecución de News del último
día del mes cierra el mes y produce un informe canónico en
`autopilot/reports/monthly/<YYYY-MM>.md`. Si falla, los días 1-3 lo regeneran con el
mes completo. `autopilot` lo lee antes de tocar el
BACKLOG, escribe `autopilot/strategy/current.md` y redirige a `ideator`,
`mapmaker`, `blogger` y `reviewer` con instrucciones por rol.

Regla de decisión: si el informe muestra que el cuello de botella es
distribución, medición o activación, **no se producen más mapas por inercia**.
Si muestra que una hipótesis de producto falla, se corrige el embudo antes de
ampliar el catálogo. `AGENTS.md` y las decisiones de producto siguen siendo el
límite duro.
