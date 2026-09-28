#!/usr/bin/env node
// ── publish-oceans-and-seas.js ─
// Publica/actualiza el mapa "Océanos y mares del mundo" en Firestore con la
// geometría real de Natural Earth (marine polys) y el preview flat-world.
// Uso: node scripts/publish-oceans-and-seas.js [--dry-run]
'use strict';
const fs = require('fs'), path = require('path');
const { getAccessToken, firestoreRequest, COLLECTION, fsStr, fsInt } = require('./lib/publisher');

const SLUG = 'oceans-and-seas-world';
const TITLE = 'Océanos y mares del mundo';
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const geoPath = path.join(__dirname, '..', 'data', 'oceans-and-seas-world.geojson');
  if (!fs.existsSync(geoPath)) { console.error('ERROR: no existe', geoPath); process.exit(1); }
  const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));

  // Validaciones AGENTS.md
  const hexOk = geo.features.every(f => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  const coordsOk = geo.features.every(f => { let ok = true; (function walk(c) { if (typeof c[0] === 'number') { if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) ok = false; } else c.forEach(walk); })(f.geometry.coordinates); return ok; });
  const names = new Set(geo.features.map(f => f.properties._manaName));
  const geojsonText = JSON.stringify(geo);
  console.log('flat-world:', geo.manaPreviewStyle, '| features:', geo.features.length, '| KB:', (geojsonText.length / 1024).toFixed(1));
  console.log('hex valid', hexOk, '| coords ±180/±90', coordsOk, '| unique names', names.size === geo.features.length);
  if (geojsonText.length > 1048576) { console.error('ERROR: GeoJSON >1MiB'); process.exit(1); }

  const fields = {
    title: fsStr(TITLE),
    name: fsStr(TITLE),
    featureCount: fsInt(geo.features.length),
    geojsonText: fsStr(geojsonText),
    updatedAtMs: fsInt(Date.now()),
    dataSource: fsStr('Natural Earth 1:50m geography marine polys (dominio público); límites IHO S-23'),
    dataDate: fsStr('2024-01-01'),
  };
  if (DRY_RUN) { console.log('DRY RUN ->', Object.keys(fields).join(', ')); return; }

  const { token } = await getAccessToken();
  const fieldPaths = Object.keys(fields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const res = await firestoreRequest(token, 'PATCH', `/${COLLECTION}/${SLUG}?${fieldPaths}`, { fields });
  if (res.status !== 200) { console.error('ERROR PATCH', res.status, JSON.stringify(res.data).slice(0, 400)); process.exit(1); }
  const verify = await firestoreRequest(token, 'GET', `/${COLLECTION}/${SLUG}`);
  const vf = verify.data && verify.data.fields || {};
  console.log(`✓ ${SLUG}: isPublished=${vf.isPublished && vf.isPublished.booleanValue}, featureCount=${vf.featureCount && vf.featureCount.integerValue}, title="${vf.title && vf.title.stringValue}"`);
}

main().catch(e => { console.error(e); process.exit(1); });
