# Estructura del repositorio

Maña Maps es un sitio estático en GitHub Pages con una galería servida desde
Firestore. La raíz del repo **es** la raíz pública del sitio, así que solo debe
contener lo que necesita el hosting o una URL pública.

## Regla de oro

Si no es una URL pública, un requisito de GitHub Pages/PWA o un archivo de
desarrollo, no va en la raíz.

## Raíz

```text
# Plataforma / hosting (no mover)
index.html  404.html  CNAME  robots.txt  sitemap.xml
manifest.webmanifest  sw.js  favicon.ico  favicon.svg
firestore.rules  package.json  package-lock.json

# Documentación de desarrollo
README.md  AGENTS.md  BACKLOG.md

# Rutas públicas
about/  blog/  changelog/  en/  gallery/  map/
my-maps/  open/  pricing/  profile/  tasks.html

# Código y contenido
assets/       # imágenes de marca y tarjetas OG raíz
autopilot/    # prompts, informes mensuales y directiva de estrategia
basemaps/     # estilos MapLibre (JSON)
blog/         # posts ES (en/ contiene los EN)
changelog/    # página generada
css/          # main.css + auth-gallery.css + site-footer.css + site-navbar.css
data/
  maps/       # GeoJSON publicables (fuente de los publicadores)
  sources/    # crudos que sí se versionan (p. ej. UNESCO)
docs/         # documentación y páginas internas (fabrica.html)
en/           # rutas públicas en inglés
gallery/      # landings estáticas por slug
icons/        # iconos PWA
js/           # aplicación del editor y la galería
og-cards/     # tarjetas OG por mapa
scripts/      # ver scripts/README.md
tests/        # Playwright predeploy
tools/        # generadores de tarjetas y utilidades de build
```

## Qué no debe existir

- `data/gallery-*.js` (bundles locales obsoletos).
- `strategy/`, `styles/` o `brand/` en la raíz (sus contenidos viven en
  `data/sources/`, `basemaps/`/`css/` y `assets/brand/`).
- `.DS_Store`, `*.tmp.js`, `test-results/`, `playwright-report/`, logs.
- GeoJSON sueltos en `data/` (deben ir en `data/maps/`).
- Scripts de mapas en la raíz de `scripts/` (deben ir en `scripts/maps/`).

La guardia `scripts/tools/check-repo-hygiene.js` se ejecuta en CI y falla si
alguno de estos patrones reaparece.

## Pipeline de mapas

Ver `scripts/README.md`. Resumen:

```text
fuente cruda → scripts/maps/gen-*.js → data/maps/*.geojson
→ scripts/maps/publish-*.js → Firestore
→ tools/generate-map-landings → gallery/ + og-cards/
→ update-sitemap-gallery → sitemap.xml + JSON-LD
```

## Assets y estilos

- `assets/og-card.png`: imagen OG de las páginas generales.
- `assets/brand/`: logotipos.
- `basemaps/*.json`: estilos MapLibre (no son CSS).
- `css/main.css`: hoja principal del editor.
- `css/auth-gallery.css`: autenticación y acciones de galería.
- `css/site-footer.css`: pie de página compartido y fondo del overscroll iOS.
- `css/site-navbar.css`: barra superior compartida de las páginas públicas.
- `og-cards/`: una tarjeta 1200×630 por mapa publicado.

## Higiene

- No commitear secretos ni credenciales.
- No añadir archivos generados a mano si un script puede regenerarlos.
- Mantener `main` limpio: sin stashes ni ramas locales con commits sin subir.
- Antes de push: `check-local-assets`, Playwright y `check-repo-hygiene`.
