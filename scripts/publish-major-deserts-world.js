#!/usr/bin/env node
// ── publish-major-deserts-world.js ─
// Republica maps/major-deserts-world con geometría de POLÍGONO real.
// ANTES el mapa usaba 15 features Point aproximados a mano con ids de emoji
// inexistentes, lo que incumple AGENTS.md §2/§9 (un desierto es un área:
// exige polígono real, nunca un punto). Este script carga el GeoJSON
// generado por scripts/gen-major-deserts-world.js (WWF TEOW + Natural
// Earth) y actualiza geojsonText/featureCount/mapPreview/dataSource
// preservando el resto de metadatos del documento existente.
// Uso: node scripts/publish-major-deserts-world.js [--dry-run]
'use strict';
const fs = require('fs'), path = require('path');
const { getAccessToken, firestoreRequest, COLLECTION, fsStr, fsInt, fsMap, fsNull } = require('./lib/publisher');

const SLUG = 'major-deserts-world';
const DRY_RUN = process.argv.includes('--dry-run');

const DATA_SOURCE =
  'WWF — Terrestrial Ecoregions of the World (Olson et al., 2001), ecorregiones de desiertos y matorrales xerófilos; ' +
  'Natural Earth 1:50m (geometría antártica). Superficies de referencia: UNEP World Atlas of Desertification.';

function buildMapPreview(geo) {
  let bbox = [180, 90, -180, -90];
  function walk(coords) {
    if (typeof coords[0] === 'number') {
      const x = coords[0], y = coords[1];
      if (x < bbox[0]) bbox[0] = x; if (y < bbox[1]) bbox[1] = y;
      if (x > bbox[2]) bbox[2] = x; if (y > bbox[3]) bbox[3] = y;
    } else coords.forEach(walk);
  }
  geo.features.forEach(f => walk(f.geometry.coordinates));
  function sampleRing(ring, maxPts) {
    if (!ring || ring.length <= maxPts) return ring;
    const step = Math.ceil(ring.length / maxPts);
    const out = [];
    for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
    if (out[out.length - 1] !== ring[ring.length - 1]) out.push(ring[ring.length - 1]);
    return out;
  }
  const previewFeatures = geo.features.map(f => {
    const g = f.geometry;
    let geom;
    if (g.type === 'Polygon') {
      geom = { type: 'Polygon', coordinatesText: JSON.stringify(g.coordinates.map(r => sampleRing(r, 80))) };
    } else if (g.type === 'MultiPolygon') {
      geom = { type: 'MultiPolygon', coordinatesText: JSON.stringify(g.coordinates.map(poly => poly.map(r => sampleRing(r, 80)))) };
    } else {
      geom = { type: g.type, coordinatesText: JSON.stringify(g.coordinates) };
    }
    return { geometry: geom, color: f.properties._manaColor, fillOpacity: f.properties._manaFillOpacity };
  });
  return { bbox, kind: 'geometry', gridSize: null, cells: null, features: previewFeatures };
}

async function main() {
  const geoPath = path.join(__dirname, '..', 'data', 'major-deserts-world.geojson');
  if (!fs.existsSync(geoPath)) { console.error('ERROR: no existe', geoPath); process.exit(1); }
  const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));

  // Validación previa (AGENTS.md §Estándar de publicación)
  const hexOk = geo.features.every(f => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  const haloOk = geo.features.every(f => f.properties._manaLabelStyle && f.properties._manaLabelStyle.haloWidth >= 2);
  const polyOk = geo.features.every(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
  const coordsOk = geo.features.every(f => {
    let ok = true;
    function walk(c) { if (typeof c[0] === 'number') { if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) ok = false; } else c.forEach(walk); }
    walk(f.geometry.coordinates); return ok;
  });
  const names = new Set(geo.features.map(f => f.properties._manaName));
  const withData = geo.features.filter(f => f.properties.Continent && f.properties.Area && f.properties.Countries && f.properties.Description).length;
  const noMarkers = geo.features.every(f => !f.properties.markerType && !f.properties._manaMarkerType);
  const geojsonText = JSON.stringify(geo);
  console.log(`features: ${geo.features.length} | con datos popup: ${withData} | KB: ${(geojsonText.length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | polígonos: ${polyOk} | coords: ${coordsOk} | uniqueNames: ${names.size === geo.features.length} | sin markerType: ${noMarkers}`);
  if (!hexOk || !haloOk || !polyOk || !coordsOk || names.size !== geo.features.length || !noMarkers || withData !== geo.features.length) {
    console.error('VALIDATION FAILED'); process.exit(1);
  }
  if (geo.features.length !== 15) { console.error('ERROR: se exigen 15 features'); process.exit(1); }
  if (geojsonText.length > 1048576) { console.error('ERROR: GeoJSON >1MiB'); process.exit(1); }

  const preview = buildMapPreview(geo);
  const now = Date.now();
  const serverNow = { timestampValue: new Date().toISOString() };
  const fields = {
    geojsonText: fsStr(geojsonText),
    featureCount: fsInt(geo.features.length),
    dataSource: fsStr(DATA_SOURCE),
    dataDate: fsStr('2024'),
    shareUrl: fsStr(`https://xn--maa-8ma.com/gallery/?slug=${SLUG}`),
    mapPreview: fsMap({
      bbox: { arrayValue: { values: preview.bbox.map(v => ({ doubleValue: v })) } },
      kind: fsStr(preview.kind),
      gridSize: fsNull(),
      cells: fsNull(),
      features: { arrayValue: { values: preview.features.map(pf => fsMap({
        geometry: fsMap({ type: fsStr(pf.geometry.type), coordinatesText: fsStr(pf.geometry.coordinatesText) }),
        color: fsStr(pf.color),
        fillOpacity: typeof pf.fillOpacity === 'number' ? { doubleValue: pf.fillOpacity } : fsNull(),
      })) } }
    }),
    updatedAtMs: fsInt(now), updatedAt: serverNow,
  };

  if (DRY_RUN) {
    console.log('\n=== DRY RUN ===');
    console.log(`  campos a actualizar: ${Object.keys(fields).join(', ')}`);
    console.log(`  dataSource: ${DATA_SOURCE}`);
    return;
  }

  console.log('Authenticating...');
  const { token } = await getAccessToken();

  console.log(`Checking /maps/${SLUG}...`);
  const existing = await firestoreRequest(token, 'GET', `/${COLLECTION}/${SLUG}`);
  if (existing.status !== 200) { console.error('El documento no existe; cancelo (no se crea desde cero).', existing.status); process.exit(1); }
  console.log('Updating document (updateMask de los campos tocados)...');
  const fieldPaths = Object.keys(fields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const res = await firestoreRequest(token, 'PATCH', `/${COLLECTION}/${SLUG}?${fieldPaths}`, { fields });
  if (res.status >= 400) { console.error('Update failed', res.status, JSON.stringify(res.data).slice(0, 600)); process.exit(1); }
  console.log('Updated!');

  const verify = await firestoreRequest(token, 'GET', `/${COLLECTION}/${SLUG}`);
  if (verify.status !== 200) { console.error('VERIFY FAILED', verify.status); process.exit(1); }
  const f = verify.data.fields;
  const vGeo = JSON.parse(f?.geojsonText?.stringValue || '{}');
  const vTypes = new Set((vGeo.features || []).map(x => x.geometry && x.geometry.type));
  console.log(`✓ isPublished ${f?.isPublished?.booleanValue}, featureCount ${f?.featureCount?.integerValue}`);
  console.log(`✓ geometrías: ${[...vTypes].join(', ')} (${(vGeo.features || []).length} features)`);
  console.log(`✓ dataSource: ${f?.dataSource?.stringValue}`);
  console.log(`✓ geojsonText KB: ${((f?.geojsonText?.stringValue?.length || 0) / 1024).toFixed(1)}`);
  console.log(`✓ Gallery https://xn--maa-8ma.com/gallery/?slug=${SLUG}`);
}
main().catch(e => { console.error('Fatal', e); process.exit(1); });
