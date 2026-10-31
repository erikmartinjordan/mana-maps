# Estructura del repositorio

Maña Maps es un sitio estático en GitHub Pages con una galería servida desde
Firestore. **La raíz del repo ya no es la raíz pública**: todo lo que se
despliega vive en `site/` y el workflow sube solo esa carpeta como artefacto de
Pages (`ci.yml`, `path: site`). Las URLs públicas no cambian.

## Regla de oro

- En `site/` solo va lo público que debe servirse en `maña.com`.
- En la raíz solo va el proyecto: datos, scripts, prompts, tests, docs y
  configuración. Nada de páginas públicas ni assets del sitio.

## Raíz del repositorio

```text
# Documentación y gestión
README.md  AGENTS.md  BACKLOG.md
docs/                 # documentación interna (no se publica)
autopilot/            # prompts, directiva mensual e informes

# Datos y herramientas
data/
  maps/               # GeoJSON publicables (fuente de los publicadores)
  sources/            # crudos que sí se versionan (p. ej. UNESCO)
scripts/              # ver scripts/README.md
tests/                # Playwright predeploy

# Configuración
.github/  .opencode/  firestore.rules
package.json  package-lock.json  .gitignore
```

## Sitio público (`site/`)

```text
site/
├── index.html  404.html  CNAME  robots.txt  sitemap.xml
├── manifest.webmanifest  sw.js  favicon.ico  favicon.svg
├── about/  changelog/  en/  gallery/  map/  my-maps/
├── open/  pricing/  profile/  tasks.html
├── news/              # listado, posts.json y artículos ES (news/<slug>/)
├── blog/              # solo redirects legacy a /news/ (temporal)
├── en/                # rutas EN, incluido en/news/<slug>/
├── assets/            # imágenes de marca y OG raíz
├── basemaps/          # estilos MapLibre (JSON)
├── css/               # main.css, auth-gallery, footer, navbar y tutorial
├── icons/             # iconos PWA
├── js/                # aplicación del editor y la galería
├── og-cards/          # tarjetas OG por mapa
└── docs/fabrica.html  # vista incrustada en tasks.html
```

## Qué no debe existir

- Páginas o assets públicos fuera de `site/` (`index.html`, `gallery/`,
  `news/`, `css/`, `js/`, `favicon.*`, `sitemap.xml`… en la raíz).
- Contenido interno dentro de `site/` (`AGENTS.md`, `data/`, `scripts/`,
  `autopilot/`, `tests/`, `package.json`, `firestore.rules`…).
- `data/gallery-*.js` (bundles locales obsoletos).
- `strategy/`, `styles/` o `brand/` en la raíz (sus contenidos viven en
  `data/sources/`, `site/basemaps/`/`site/css/` y `site/assets/brand/`).
- `.DS_Store`, `*.tmp.js`, `test-results/`, `playwright-report/`, logs.
- Carpetas de artículo fuera de `site/news/` y `site/en/news/`.
- GeoJSON sueltos en `data/` (deben ir en `data/maps/`).
- Scripts de mapas en la raíz de `scripts/` (deben ir en `scripts/maps/`).

La guardia `scripts/tools/check-repo-hygiene.js` se ejecuta en CI y falla si
alguno de estos patrones reaparece.

## Pipeline de mapas

Ver `scripts/README.md`. Resumen:

```text
fuente cruda → scripts/maps/gen-*.js → data/maps/*.geojson
→ scripts/maps/publish-*.js → Firestore
→ scripts/tools/generate-map-landings.js → site/gallery/ + site/og-cards/
→ scripts/tools/update-sitemap-gallery.js → site/sitemap.xml + JSON-LD
```

## Assets y estilos

- `site/assets/og-card.png`: imagen OG de las páginas generales.
- `site/assets/brand/`: logotipos.
- `site/basemaps/*.json`: estilos MapLibre (no son CSS).
- `site/css/main.css`: hoja principal del editor.
- `site/css/auth-gallery.css`: autenticación y acciones de galería.
- `site/css/site-footer.css`: pie de página compartido y fondo del overscroll iOS.
- `site/css/site-navbar.css`: barra superior compartida de las páginas públicas.
- `site/og-cards/`: una tarjeta 1200×630 por mapa publicado.

## Higiene

- No commitear secretos ni credenciales.
- No añadir archivos generados a mano si un script puede regenerarlos.
- Mantener `main` limpio: sin stashes ni ramas locales con commits sin subir.
- Antes de push: `check-local-assets`, Playwright y `check-repo-hygiene`.
