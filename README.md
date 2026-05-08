<p align="center">
  <a href="https://maña.com" target="_blank" rel="noopener noreferrer">
    <img src="./favicon.svg" alt="Maña Maps logo" width="120" height="120">
  </a>
</p>

<h1 align="center">Maña Maps</h1>

<p align="center">A simple browser-based map editor for drawing, importing, exporting, and sharing geospatial data.</p>

<p align="center">
  <a href="https://maña.com">Live Site</a> •
  <a href="https://maña.com/map/">Editor</a> •
  <a href="https://github.com/erikmartinjordan/mana-maps/actions/workflows/pre-deploy-tests.yml">Tests</a> •
  <a href="https://github.com/erikmartinjordan/mana-maps">GitHub</a>
</p>

<p align="center">
  <a href="https://github.com/erikmartinjordan/mana-maps/actions/workflows/pre-deploy-tests.yml"><img src="https://github.com/erikmartinjordan/mana-maps/actions/workflows/pre-deploy-tests.yml/badge.svg" alt="Pre-deployment Tests"></a>
  <a href="https://github.com/erikmartinjordan/mana-maps/actions/workflows/update-changelog.yml"><img src="https://github.com/erikmartinjordan/mana-maps/actions/workflows/update-changelog.yml/badge.svg" alt="Update Changelog"></a>
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
python3 -m http.server 4173
```

Open <http://127.0.0.1:4173> in your browser.

## Configuration

Firebase is optional for local UI work. Without it, the editor still loads and local-only features continue to work.

To enable Firebase-backed auth, sharing, tracking, or collaboration locally, create `js/firebase-config.local.js`:

```js
window.MANA_FIREBASE_CONFIGS = {
  pre: { /* Firebase web app config */ },
  pro: { /* Firebase web app config */ }
};
```

Production deploys generate that file from `FIREBASE_PRE_CONFIG_JSON` and `FIREBASE_PRO_CONFIG_JSON` GitHub Actions secrets. Each secret may be strict JSON or the Firebase Console's JavaScript object-literal snippet, but it must include `apiKey`, `authDomain`, `projectId`, and `appId`.

## Tests

```bash
npx playwright test --config=tests/predeploy/playwright.config.js
```

## Tech stack

Maña Maps is built with vanilla JavaScript, HTML, and CSS. It uses Leaflet for 2D mapping, MapLibre GL JS for the 3D globe, JSZip and shp.js for file handling, and optional Firebase services for accounts and sharing.

## License

MIT © [Erik Martín Jordán](https://github.com/erikmartinjordan)
