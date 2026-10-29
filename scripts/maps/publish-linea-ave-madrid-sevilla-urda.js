#!/usr/bin/env node
// ── publish-linea-ave-madrid-sevilla-urda.js ──────────────────────────────
// Mapa lineal: Línea de alta velocidad Madrid-Sevilla y accidente de Urda.
// Fuente: OpenStreetMap, relación 1254828 (route=train, service=high_speed).
// El punto del accidente se calcula en el kilómetro 118 de la línea.
// Publica el documento maps/<slug> en Firestore (mana-maps-pro-f2177).
'use strict';
const fs = require('fs'), path = require('path');
const { getAccessToken, firestoreRequest, COLLECTION, fsStr, fsInt, fsBool, fsArr, fsNull, fsMap } = require('../lib/publisher');

const SLUG = 'linea-ave-madrid-sevilla-urda';
const TITLE = 'La línea de alta velocidad Madrid-Sevilla y el accidente de Urda';
const DESCRIPTION = 'El corredor de alta velocidad entre Madrid y Sevilla y el punto del accidente de Urda (Toledo) del 28 de octubre de 2026. El siniestro se produjo en el kilómetro 118, cerca de la estación de Urda.';
const DATA_SOURCE = 'OpenStreetMap contributors: relación 1254828 «AVE Madrid - Sevilla» (route=train, service=high_speed), consultada el 29 de octubre de 2026; geometría de la vía y distancia acumulada calculadas sobre la relación. Datos del accidente: Ministerio de Transportes, Gobierno de Castilla-La Mancha y RTVE (28-29 de octubre de 2026).';
const DRY_RUN = process.argv.includes('--dry-run');

function buildMapPreview(geo) {
  let bbox = [180, 90, -180, -90];
  function walk(coords) {
    if (typeof coords[0] === 'number') {
      const x = coords[0], y = coords[1];
      if (x < bbox[0]) bbox[0] = x; if (y < bbox[1]) bbox[1] = y;
      if (x > bbox[2]) bbox[2] = x; if (y > bbox[3]) bbox[3] = y;
    } else coords.forEach(walk);
  }
  geo.features.forEach((f) => walk(f.geometry.coordinates));
  const features = geo.features.map((f) => {
    const props = f.properties || {};
    const entry = {
      geometry: { type: f.geometry.type, coordinatesText: JSON.stringify(f.geometry.coordinates) },
      color: props._manaColor
    };
    const mt = props._manaMarkerType || props.markerType || '';
    if (mt === 'emoji_collision') entry.emoji = '\uD83D\uDCA5';
    if (mt === 'emoji_train') entry.emoji = '\uD83D\uDE82';
    if (typeof props._manaFillOpacity === 'number') entry.fillOpacity = props._manaFillOpacity;
    return entry;
  });
  return { bbox, kind: 'geometry', gridSize: null, cells: null, features };
}

async function main() {
  const geoPath = path.join(__dirname, '..', '..', 'data', 'maps', `${SLUG}.geojson`);
  if (!fs.existsSync(geoPath)) { console.error('ERROR: no existe', geoPath); process.exit(1); }
  const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));

  const hexOk = geo.features.every((f) => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  const haloOk = geo.features.every((f) => f.properties._manaLabelStyle && f.properties._manaLabelStyle.haloWidth >= 2);
  const coordsOk = geo.features.every((f) => {
    let ok = true;
    const walk = (c) => {
      if (typeof c[0] === 'number') {
        if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) ok = false;
      } else c.forEach(walk);
    };
    walk(f.geometry.coordinates);
    return ok;
  });
  const names = new Set(geo.features.map((f) => f.properties._manaName));
  const lineFeature = geo.features.find((f) => f.geometry.type === 'LineString');
  const accident = geo.features.find((f) => f.properties.Tipo === 'Accidente');
  const markerOk = geo.features
    .filter((f) => f.geometry.type === 'Point')
    .every((f) => ['emoji_train', 'emoji_collision'].includes(f.properties._manaMarkerType));
  const geojsonText = JSON.stringify(geo);
  console.log(`features: ${geo.features.length} | line points: ${lineFeature ? lineFeature.geometry.coordinates.length : 0} | KB: ${(geojsonText.length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | coords: ${coordsOk} | uniqueNames: ${names.size === geo.features.length} | markers: ${markerOk}`);
  if (!lineFeature || !accident || !hexOk || !haloOk || !coordsOk || names.size !== geo.features.length || !markerOk) {
    console.error('VALIDATION FAILED'); process.exit(1);
  }
  if (geojsonText.length > 1048576) { console.error('ERROR: GeoJSON >1MiB'); process.exit(1); }

  const preview = buildMapPreview(geo);
  const now = Date.now();
  const serverNow = { timestampValue: new Date().toISOString() };
  const fields = {
    id: fsStr(SLUG), slug: fsStr(SLUG),
    title: fsStr(TITLE), name: fsStr(TITLE),
    description: fsStr(DESCRIPTION),
    lang: fsStr('es'),
    featureCount: fsInt(geo.features.length),
    mapPreview: fsMap({
      bbox: { arrayValue: { values: preview.bbox.map((v) => ({ doubleValue: v })) } },
      kind: fsStr(preview.kind),
      gridSize: fsNull(),
      cells: fsNull(),
      features: {
        arrayValue: {
          values: preview.features.map((pf) => fsMap({
            geometry: fsMap({ type: fsStr(pf.geometry.type), coordinatesText: fsStr(pf.geometry.coordinatesText) }),
            color: fsStr(pf.color),
            emoji: pf.emoji ? fsStr(pf.emoji) : fsNull(),
            fillOpacity: typeof pf.fillOpacity === 'number' ? { doubleValue: pf.fillOpacity } : fsNull()
          }))
        }
      }
    }),
    visibility: fsStr('public'), shareMode: fsStr('view'),
    allowPublicEdit: fsBool(false), isPublished: fsBool(true),
    shareUrl: fsStr(`https://xn--maa-8ma.com/gallery/?slug=${SLUG}`),
    geojsonText: fsStr(geojsonText), geojsonChunked: fsNull(),
    dataSource: fsStr(DATA_SOURCE),
    dataDate: fsStr('2026-10-29'),
    dataYear: fsInt(2026),
    tags: fsArr(['Transporte', 'Ferrocarril', 'España', 'Sucesos']),
    legendKey: fsStr('Tipo'),
    legendTitle: fsStr('Elementos del mapa'),
    legendFormat: fsStr('category'),
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
    const fieldPaths = Object.keys(fields).map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
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
    console.log(`✓ PUBLISHED maps/${SLUG}`);
    console.log(`✓ isPublished ${f?.isPublished?.booleanValue}, featureCount ${f?.featureCount?.integerValue}`);
    console.log(`✓ title: ${f?.title?.stringValue}`);
    console.log(`✓ legendKey: ${f?.legendKey?.stringValue}, legendFormat: ${f?.legendFormat?.stringValue}`);
    console.log(`✓ dataSource: ${f?.dataSource?.stringValue}`);
    console.log(`✓ geojsonText KB: ${((f?.geojsonText?.stringValue?.length || 0) / 1024).toFixed(1)}`);
    console.log(`✓ Gallery https://xn--maa-8ma.com/gallery/?slug=${SLUG}`);
  } else {
    console.error('VERIFY FAILED', verify.status, JSON.stringify(verify.data).slice(0, 300));
    process.exit(1);
  }
}
main().catch((e) => { console.error('Fatal', e); process.exit(1); });
