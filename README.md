<p align="center">
  <a href="https://maña.com" target="_blank" rel="noopener noreferrer">
    <img src="./site/favicon.svg" alt="Maña Maps logo" width="120" height="120">
  </a>
</p>

<h1 align="center">Maña Maps</h1>

<p align="center">A simple browser-based map editor for drawing, importing, exporting, and sharing geospatial data.</p>

<p align="center">
  <a href="https://maña.com">Live Site</a> •
  <a href="https://maña.com/map/">Editor</a> •
  <a href="https://github.com/erikmartinjordan/mana-maps/actions/workflows/ci.yml">Tests</a> •
  <a href="https://github.com/erikmartinjordan/mana-maps">GitHub</a>
</p>

<p align="center">
  <a href="https://github.com/erikmartinjordan/mana-maps/actions/workflows/ci.yml"><img src="https://github.com/erikmartinjordan/mana-maps/actions/workflows/ci.yml/badge.svg" alt="Pre-deployment Tests"></a>
  <a href="https://maña.com"><img src="https://img.shields.io/badge/deployment-live-success?logo=githubpages" alt="Live Site"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

---

Maña Maps runs entirely in the browser. Use it to sketch map features, work with common GIS file formats, switch between 2D maps and a 3D globe, and optionally save or share maps with Firebase-backed services.

## Features

- Draw points, lines, polygons, and measurements.
- Import GeoJSON, KML, KMZ, and zipped Shapefiles.
- Export GeoJSON, CSV, KML, KMZ, and Shapefiles.
- Switch between standard map, satellite imagery, and a 3D globe.
- Search places, edit attributes, style features, and filter layers.
- Save locally in the browser and optionally share maps online.

## Quick start

No build step is required.

```bash
git clone https://github.com/erikmartinjordan/mana-maps.git
cd mana-maps
python3 -m http.server 4173 --directory site
```

Open <http://127.0.0.1:4173> in your browser.

## Configuration

Firebase is optional for local UI work. Without it, the editor still loads and local-only features continue to work.

To enable Firebase-backed auth, sharing, tracking, or collaboration locally, create `site/js/firebase-config.local.js`:

```js
window.MANA_FIREBASE_CONFIGS = {
  pre: { /* Firebase web app config */ },
  pro: { /* Firebase web app config */ }
};
```

Production deploys generate that file from `FIREBASE_PRE_CONFIG_JSON` and `FIREBASE_PRO_CONFIG_JSON` GitHub Actions secrets. Each secret may be strict JSON or the Firebase Console's JavaScript object-literal snippet, but it must include `apiKey`, `authDomain`, `projectId`, and `appId`.

## Repository layout

- `site/` — everything that is deployed to GitHub Pages (HTML, CSS, JS, assets, landings, OG cards and News).
- `site/gallery/`, `site/og-cards/`, `site/news/`, `site/en/news/` — generated/public content.
- `site/blog/` — solo redirects legacy a `/news/`.
- `data/maps/` — public GeoJSON sources for the gallery maps.
- `data/sources/` — raw source data that is versioned.
- `scripts/maps/` — one `gen-*` and one `publish-*` per map.
- `scripts/tools/` — audits, landings/OG generation, hygiene and utilities.
- `autopilot/` — agent prompts, monthly directive and reports.
- `docs/` — internal documentation (not deployed).

Full details: [`docs/repo-structure.md`](docs/repo-structure.md) and
[`scripts/README.md`](scripts/README.md).

## Tests

```bash
npx playwright test --config=tests/predeploy/playwright.config.js
```

## Tech stack

Maña Maps is built with vanilla JavaScript, HTML, and CSS. It uses Leaflet for 2D mapping, MapLibre GL JS for the 3D globe, JSZip and shp.js for file handling, and optional Firebase services for accounts and sharing.

## License

MIT © [Erik Martín Jordán](https://github.com/erikmartinjordan)
