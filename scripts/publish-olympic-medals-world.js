#!/usr/bin/env node
// ── publish-olympic-medals-world.js ─
// Mapa coroplético: Los países con más medallas olímpicas de la historia
// Fuente: COI / Olympics.com — tabla histórica de los Juegos de Verano hasta
// París 2024, recopilada en Wikipedia (All-time Olympic Games medal table).
// Lee data/olympic-medals-world.geojson generado por
// scripts/gen-olympic-medals-world.js y publica en Firestore.
'use strict';
const fs = require('fs'), path = require('path');
const { getAccessToken, firestoreRequest, COLLECTION, fsStr, fsInt, fsBool, fsArr, fsNull, fsMap } = require('./lib/publisher');

const SLUG = 'olympic-medals-world';
const TITLE = 'Los países con más medallas olímpicas de la historia';
const DRY_RUN = process.argv.includes('--dry-run');
const DATA_YEAR = 2024;
const NUM_KEY = 'Medallas (num)';

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
  const geoPath = path.join(__dirname, '..', 'data', 'olympic-medals-world.geojson');
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
  const withData = geo.features.filter(f => f.properties[NUM_KEY] != null && f.properties[NUM_KEY] > 0).length;
  const borderOk = geo.features.every(f => f.properties._manaBorderColor === '#FFFFFF');
  const geojsonText = JSON.stringify(geo);
  console.log(`features: ${geo.features.length} | with medals: ${withData} | KB: ${(geojsonText.length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | coords: ${coordsOk} | uniqueNames: ${names.size === geo.features.length} | whiteBorder: ${borderOk}`);
  if (!hexOk || !haloOk || !coordsOk || names.size !== geo.features.length || !borderOk) { console.error('VALIDATION FAILED'); process.exit(1); }
  if (withData < 130) { console.error(`VALIDATION FAILED: solo ${withData} países con medallas (≥130 exigidos)`); process.exit(1); }
  if (geojsonText.length > 1048576) { console.error('ERROR: GeoJSON >1MiB'); process.exit(1); }

  const preview = buildMapPreview(geo);
  const now = Date.now();
  const serverNow = { timestampValue: new Date().toISOString() };
  const description = 'Mapa coroplético del medallero histórico de los Juegos Olímpicos de Verano hasta París 2024, con el recuento acumulado de medallas de cada equipo olímpico vigente. Estados Unidos domina la tabla con 2.774 medallas (1.106 oros), muy por delante de Reino Unido (986), Francia (824), China (727), Alemania (687), Italia (658), Australia (594), Japón (542) y Hungría (530); España suma 187 (53 oros). La rampa de oro ordena los países de menos a más medallas y se muestran 138 equipos con al menos una medalla, además de los países que aún no han subido al podio. Los equipos históricos (URSS, RDA, RFA, Checoslovaquia, Yugoslavia, Equipo Unificado, ROC, AIN) se contabilizan por separado en la fuente oficial y no se atribuyen a los países sucesores. Primer mapa de temática deportiva de la galería.';

  const fields = {
    id: fsStr(SLUG), slug: fsStr(SLUG),
    title: fsStr(TITLE), name: fsStr(TITLE),
    description: fsStr(description),
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
    dataSource: fsStr('Comité Olímpico Internacional (COI / Olympics.com) — tabla histórica de medallas de los Juegos Olímpicos de Verano hasta París 2024, recopilada en Wikipedia (All-time Olympic Games medal table, consultada 2026-10). Los equipos históricos (URSS, RDA, RFA, Checoslovaquia, Yugoslavia, Equipo Unificado, ROC, AIN…) se contabilizan por separado y no se atribuyen a los países sucesores. Geometrías: Natural Earth 110m/50m.'),
    dataDate: fsStr('2024-08-11'),
    dataYear: fsInt(DATA_YEAR),
    tags: fsArr(['Deporte', 'Historia', 'Geografía']),
    legendKey: fsStr(NUM_KEY),
    legendTitle: fsStr('Medallas olímpicas de verano (hasta París 2024)'),
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
