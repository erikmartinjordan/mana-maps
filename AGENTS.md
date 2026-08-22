# AGENTS.md — Convenciones para agentes en mana-maps

Repositorio de Maña Maps (`maña.com`): editor de mapas en el navegador con
galería comunitaria servida desde Firestore. Este archivo es de lectura
obligatoria para cualquier agente que trabaje aquí.

## Arquitectura vigente

- La galería carga mapas **exclusivamente de Firestore** (colección `maps`,
  proyecto `mana-maps-pro-f2177`). Los bundles locales `data/gallery-*.js`
  fueron eliminados: **no recrearlos** ni añadir `<script>` de datos.
- El mapa destacado de `/gallery/?slug=<id>` se renderiza con MapLibre y
  respeta por feature: `_manaFillOpacity`, `_manaBorderColor`, `_manaWeight`
  y etiqueta polígonos con `_manaName`. Genera leyenda automática cuando una
  coropleta usa la clave «Profundidad media» (ver `buildDepthLegend` en
  `js/gallery-page.js`).

## Estándar de publicación de mapas (obligatorio)

Todo mapa nuevo o actualización de la galería debe cumplir:

1. **Datos de fuente autoritativa y citada** (Natural Earth, IHO, GEBCO/NOAA,
   USGS, ONU, Smithsonian…). Rellenar siempre `dataSource` y `dataDate`.
2. **Geometría real**: prohibidos polígonos aproximados a mano. Usar
   geometrías oficiales recortadas (shapely: región aproximada ∩ geometría
   real), `simplify(preserve_topology)` y descartar partes pequeñas
   (`área >= max(25°², 40 % de la parte mayor)`) para evitar etiquetas
   duplicadas.
3. **Paleta semántica**: si hay variable numérica, rampa secuencial
   monocromática ordenada por el dato (claro→oscuro). Nada de colores
   arbitrarios tipo arcoíris. En coropletas, borde blanco fino.
4. **Propiedades por feature** (contenido en español): `_manaName`, `name`,
   `_manaColor`, `_manaFillOpacity`, `_manaGroupName`, `_manaGroupId`,
   `_manaLabelStyle` completo (haloWidth ≥ 2) y claves de datos legibles:
   `Superficie`, `Dato`, `Description` + la clave numérica que alimente la
   leyenda (p. ej. `Profundidad media`).
5. **Popups con información real**: cada feature muestra datos concretos,
   no solo el nombre.
6. **Validación previa obligatoria**: GeoJSON válido, coordenadas dentro de
   ±180/±90, `featureCount` coherente, colores hex válidos, labelStyles
   completos, sin nombres duplicados, rampa ordenable por el dato.
7. **Tests en verde**: `npx playwright test --config=tests/predeploy/playwright.config.js`
   → 10/10 antes de pushear.
8. **Publicación directa en Firestore** (REST o SDK con cuenta publicadora;
   credenciales fuera del repo): documento `maps/<slug>` con `isPublished:
   true`, `shareMode: 'view'`, `createdBy`/`ownerUid` = uid autenticado.
   Tamaño máx. 1 MiB/doc; geojsonText como string.
9. **Verificación posterior**: lectura REST (`isPublished`, `featureCount`)
   y revisión visual escritorio + móvil de `/gallery/?slug=<id>`
   (leyenda, etiquetas únicas, popup funcional).

## Contenido

- Español para todo lo visible por usuarios (títulos, popups, descripciones).
- Cada mapa es una landing SEO: título descriptivo, descripción útil,
  OG card generada (workflow `generate-images.yml`) y entrada en changelog.

## Higiene

- No commitear secretos ni credenciales.
- No modificar `firestore.rules` sin necesidad explícita.
- Tests y lint antes de cada push; commits concisos estilo `feat:`/`chore:`.
