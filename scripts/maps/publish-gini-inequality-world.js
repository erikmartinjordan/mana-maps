#!/usr/bin/env node
// ── publish-gini-inequality-world.js ─
// Mapa coroplético: Desigualdad de ingresos (índice Gini) mundial por país
// Fuente: World Bank — Poverty and Inequality Platform (PIP, 2026) vía
// Our World in Data (ourworldindata.org/grapher/gini-coefficient-wb).
// Lee data/maps/gini-inequality-world.geojson generado por
// scripts/gen-gini-inequality-world.js y publica en Firestore.
'use strict';
const fs = require('fs'), path = require('path');
const { getAccessToken, firestoreRequest, COLLECTION, fsStr, fsInt, fsBool, fsArr, fsNull, fsMap } = require('../lib/publisher');

const SLUG = 'gini-index-world';
const TITLE = 'Desigualdad de ingresos (índice Gini) mundial por país';
const DRY_RUN = process.argv.includes('--dry-run');
const DATA_YEAR = 2025;
const NUM_KEY = 'Índice Gini (num)';

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
    let geom = null;
    if (g.type === 'Polygon')
      geom = { type: 'Polygon', coordinatesText: JSON.stringify(g.coordinates.map(r => sampleRing(r, 80))) };
    else if (g.type === 'MultiPolygon')
      geom = { type: 'MultiPolygon', coordinatesText: JSON.stringify(g.coordinates.map(poly => poly.map(r => sampleRing(r, 80)))) };
    else
      geom = { type: g.type, coordinatesText: JSON.stringify(g.coordinates) };
    return { geometry: geom, color: f.properties._manaColor, emoji: null };
  });
  return { bbox, kind: 'geometry', gridSize: 8, cells: null, features: previewFeatures };
}

async function main() {
  const geoPath = path.join(__dirname, '..', '..', 'data', 'maps', 'gini-inequality-world.geojson');
  if (!fs.existsSync(geoPath)) { console.error('ERROR: no existe', geoPath); process.exit(1); }
  const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));

  const hexOk = geo.features.every(f => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  const haloOk = geo.features.every(f => f.properties._manaLabelStyle && f.properties._manaLabelStyle.haloWidth >= 2 && f.properties._manaLabelStyle.enabled === true);
  const coordsOk = geo.features.every(f => {
    let ok = true;
    function walk(c) { if (typeof c[0] === 'number') { if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) ok = false; } else c.forEach(walk); }
    walk(f.geometry.coordinates); return ok;
  });
  const names = new Set(geo.features.map(f => f.properties._manaName));
  const withData = geo.features.filter(f => f.properties[NUM_KEY] != null).length;
  const borderOk = geo.features.every(f => f.properties._manaBorderColor === '#FFFFFF');
  const geojsonText = JSON.stringify(geo);
  console.log(`features: ${geo.features.length} | with data: ${withData} | KB: ${(geojsonText.length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | coords: ${coordsOk} | uniqueNames: ${names.size === geo.features.length} | whiteBorder: ${borderOk}`);
  if (!hexOk || !haloOk || !coordsOk || names.size !== geo.features.length || !borderOk) { console.error('VALIDATION FAILED'); process.exit(1); }
  if (withData < 150) { console.error(`VALIDATION FAILED: solo ${withData} países con datos (≥150 exigidos)`); process.exit(1); }
  if (geojsonText.length > 1048576) { console.error('ERROR: GeoJSON >1MiB'); process.exit(1); }

  const preview = buildMapPreview(geo);
  const now = Date.now();
  const serverNow = { timestampValue: new Date().toISOString() };
  const fields = {
    id: fsStr(SLUG), slug: fsStr(SLUG),
    title: fsStr(TITLE), name: fsStr(TITLE),
    description: fsStr('Mapa coroplético mundial del índice Gini, la medida clásica de la desigualdad de renta: 0 significa igualdad perfecta y 100 desigualdad máxima. Los datos del Poverty and Inequality Platform del Banco Mundial (vía Our World in Data) cubren 171 países con su último dato disponible (encuestas de ingreso en países ricos y de consumo en países en desarrollo; años 1992–2025, mediana 2021). Haití (60,5), Namibia (59,1), Botsuana (54,9), Suazilandia (54,6) y Colombia (54,4) encabezan la desigualdad, mientras India (23,0), Eslovaquia (23,8) y Bielorrusia (24,4) son los países más igualitarios. Completa el cluster económico de la galería junto al PIB per cápita y el salario mínimo.'),
    lang: fsStr('es'),
    featureCount: fsInt(geo.features.length),
    mapPreview: fsMap({
      bbox: preview.bbox,
      kind: 'geometry',
      gridSize: 8,
      cells: null,
      features: preview.features.map(pf => fsMap({
        geometry: fsMap({ type: pf.geometry.type, coordinatesText: pf.geometry.coordinatesText }),
        color: pf.color,
        emoji: null
      }))
    }),
    visibility: fsStr('public'), shareMode: fsStr('view'),
    allowPublicEdit: fsBool(false), isPublished: fsBool(true),
    shareUrl: fsStr(`https://xn--maa-8ma.com/gallery/?slug=${SLUG}`),
    geojsonText: fsStr(geojsonText), geojsonChunked: fsNull(),
    dataSource: fsStr('World Bank — Poverty and Inequality Platform (PIP, 2026), vía Our World in Data (ourworldindata.org/grapher/gini-coefficient-wb): Gini coefficient, ingreso/consumo tras impuestos y transferencias. Geometrías: Natural Earth 110m/50m.'),
    dataDate: fsStr('2025-12-31'),
    dataYear: fsInt(DATA_YEAR),
    tags: fsArr(['Economía', 'Desigualdad', 'Geografía']),
    legendKey: fsStr(NUM_KEY),
    legendTitle: fsStr('Índice Gini (0–100)'),
    legendFormat: fsStr('number'),
    authorHandle: fsStr('maña-maps'), createdBy: fsStr('maña-maps'), ownerUid: fsStr('maña-maps'),
    createdAtMs: fsInt(now), updatedAtMs: fsInt(now), createdAt: serverNow, updatedAt: serverNow,
    views: fsInt(0), likes: fsInt(0)
  };

  if (DRY_RUN) {
    console.log('\n=== DRY RUN ===');
    for (const fn of Object.keys(fields)) {
      const v = fields[fn];
      if ('stringValue' in v) console.log(`  ${fn}: "${v.stringValue.substring(0, 120)}${v.stringValue.length > 120 ? '...' : ''}"`);
      else if ('integerValue' in v) console.log(`  ${fn}: ${v.integerValue}`);
      else if ('booleanValue' in v) console.log(`  ${fn}: ${v.booleanValue}`);
      else if ('nullValue' in v) console.log(`  ${fn}: null`);
      else if ('mapValue' in v) console.log(`  ${fn}: [map]`);
      else if ('arrayValue' in v) console.log(`  ${fn}: [array ${v.arrayValue.values.length} items]`);
    }
    return;
  }

  console.log('Authenticating...');
  const { token, uid } = await getAccessToken();
  if (uid) { fields.createdBy = fsStr(uid); fields.ownerUid = fsStr(uid); }

  console.log(`Checking /maps/${SLUG}...`);
  const existing = await firestoreRequest(token, 'GET', `/${COLLECTION}/${SLUG}`);
  if (existing.status === 200) {
    console.log('Updating document...');
    const fieldPaths = Object.keys(fields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const res = await firestoreRequest(token, 'PATCH', `/${COLLECTION}/${SLUG}?${fieldPaths}`, { fields });
    if (res.status >= 400) { console.error('Update failed', res.status, JSON.stringify(res.data).slice(0, 600)); process.exit(1); }
    console.log('Updated!');
  } else {
    console.log('Creating...');
    const res = await firestoreRequest(token, 'POST', `/${COLLECTION}?documentId=${SLUG}`, { fields });
    if (res.status >= 400) { console.error('Create failed', res.status, JSON.stringify(res.data).slice(0, 600)); process.exit(1); }
    console.log('Created!');
  }
  const verify = await firestoreRequest(token, 'GET', `/${COLLECTION}/${SLUG}`);
  if (verify.status === 200) {
    const f = verify.data.fields;
    console.log(`✓ isPublished ${f?.isPublished?.booleanValue}, featureCount ${f?.featureCount?.integerValue}`);
    console.log(`✓ title: ${f?.title?.stringValue}`);
    console.log(`✓ tags: ${f?.tags?.arrayValue?.values?.map(v => v.stringValue).join(', ')}`);
    console.log(`✓ legendKey: ${f?.legendKey?.stringValue}, legendTitle: ${f?.legendTitle?.stringValue}, legendFormat: ${f?.legendFormat?.stringValue}`);
    console.log(`✓ dataSource: ${f?.dataSource?.stringValue}`);
    console.log(`✓ dataDate: ${f?.dataDate?.stringValue}`);
    console.log(`✓ lang: ${f?.lang?.stringValue}`);
    console.log(`✓ geojsonText KB: ${((f?.geojsonText?.stringValue?.length || 0) / 1024).toFixed(1)}`);
    console.log(`✓ Gallery https://xn--maa-8ma.com/gallery/?slug=${SLUG}`);
  } else {
    console.error('VERIFY FAILED', verify.status, JSON.stringify(verify.data).slice(0, 300));
    process.exit(1);
  }
}
main().catch(e => { console.error('Fatal', e); process.exit(1); });
