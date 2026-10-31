#!/usr/bin/env node
// ── translate-raw-props.js ─
// Traduce al español las claves crudas que se filtran al popup (AGENTS.md §4)
// en los mapas publicados, sin duplicar claves que ya están en español:
//
//   • largest-islands-world
//       superficie_km2    → Superficie (km²)      (numérica, alimenta la leyenda)
//       superficie_bucket → Grupo de superficie
//       legendKey         → Superficie (km²)
//   • submarine-fiber-cables
//       cable_length_km   → Longitud del cable (km)
//       ready_for_service → En servicio
//       data_source       → Fuente
//       route_note        → Nota de trazado
//       landing_points / countries / «Longitud (km)» se eliminan porque su
//       versión en español (Puntos de aterrizaje, Países, Longitud del cable)
//       ya existe o la sustituye.
//
// Lee el GeoJSON local, valida, escribe data/maps/<slug>.geojson y PATCH en
// Firestore (geojsonText + metadatos de leyenda cuando aplica).
//
// Uso: node scripts/tools/translate-raw-props.js [--dry-run]

'use strict';

const fs = require('fs');
const path = require('path');

const {
  getAccessToken, firestoreRequest, COLLECTION,
  fsStr, fsInt,
} = require('../lib/publisher');

const REPO = path.join(__dirname, '..', '..');
const DRY_RUN = process.argv.includes('--dry-run');

const MAPS = {
  'largest-islands-world': {
    rename: {
      superficie_km2: 'Superficie (km²)',
      superficie_bucket: 'Grupo de superficie',
    },
    drop: [],
    legend: {
      key: 'Superficie (km²)',
      title: 'Superficie (km²)',
      format: 'number',
    },
  },
  'submarine-fiber-cables': {
    rename: {
      cable_length_km: 'Longitud del cable (km)',
      ready_for_service: 'En servicio',
      data_source: 'Fuente',
      route_note: 'Nota de trazado',
    },
    // Claves ya en español con el mismo dato: se descartan en vez de duplicar.
    drop: ['landing_points', 'countries', 'Longitud (km)'],
    legend: null,
  },
};

function transform(slug, geo) {
  const cfg = MAPS[slug];
  for (const feature of geo.features) {
    const props = feature.properties || {};
    for (const [from, to] of Object.entries(cfg.rename)) {
      if (!(from in props)) continue;
      if (!(to in props)) props[to] = props[from];
      delete props[from];
    }
    for (const key of cfg.drop) delete props[key];
  }
}

function validate(slug, geo) {
  const errors = [];
  const cfg = MAPS[slug];
  if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
    errors.push('GeoJSON inválido');
    return errors;
  }
  const names = new Set();
  for (const feature of geo.features) {
    const p = feature.properties || {};
    const name = p._manaName || p.name || '(sin nombre)';
    if (names.has(name)) errors.push(`nombre duplicado: ${name}`);
    names.add(name);
    for (const key of Object.keys(cfg.rename)) {
      if (key in p) errors.push(`${name}: clave cruda «${key}» sin traducir`);
    }
    for (const key of cfg.drop) {
      if (key in p) errors.push(`${name}: clave duplicada «${key}» sin eliminar`);
    }
    for (const key of Object.values(cfg.rename)) {
      if (!(key in p)) errors.push(`${name}: falta la clave traducida «${key}»`);
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(p._manaColor || '')) errors.push(`${name}: color no hex`);
    if (!p._manaLabelStyle || !(p._manaLabelStyle.haloWidth >= 2)) errors.push(`${name}: haloWidth < 2`);
    let coordsOk = true;
    (function walk(c) {
      if (Array.isArray(c) && typeof c[0] === 'number') {
        if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) coordsOk = false;
      } else if (Array.isArray(c)) c.forEach(walk);
    })(feature.geometry.coordinates);
    if (!coordsOk) errors.push(`${name}: coordenadas fuera de ±180/±90`);
  }
  if (JSON.stringify(geo).length > 1024 * 1024) errors.push('geojsonText > 1 MiB');
  return errors;
}

async function main() {
  const { token } = await getAccessToken();

  for (const slug of Object.keys(MAPS)) {
    const cfg = MAPS[slug];
    const geoPath = path.join(REPO, 'data', 'maps', `${slug}.geojson`);
    console.log(`\n── ${slug} ──`);

    const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
    transform(slug, geo);

    const errors = validate(slug, geo);
    if (errors.length) {
      console.error('  VALIDACIÓN FALLIDA:\n   - ' + errors.join('\n   - '));
      process.exitCode = 1;
      continue;
    }

    const text = JSON.stringify(geo);
    console.log(`  features ${geo.features.length} | ${(text.length / 1024).toFixed(1)} KB`);
    console.log(`  claves: ${Object.keys(geo.features[0].properties).join(', ')}`);

    if (!DRY_RUN) fs.writeFileSync(geoPath, text + '\n');
    console.log(`  repo: data/maps/${slug}.geojson${DRY_RUN ? ' (dry-run, sin escribir)' : ' actualizado'}`);

    const patch = {
      geojsonText: fsStr(text),
      featureCount: fsInt(geo.features.length),
      updatedAtMs: fsInt(Date.now()),
      updatedAt: { timestampValue: new Date().toISOString() },
    };
    if (cfg.legend) {
      patch.legendKey = fsStr(cfg.legend.key);
      patch.legendTitle = fsStr(cfg.legend.title);
      patch.legendFormat = fsStr(cfg.legend.format);
    }

    if (DRY_RUN) { console.log('  DRY RUN: sin escritura en Firestore'); continue; }

    const mask = Object.keys(patch)
      .map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
      .join('&');
    const res = await firestoreRequest(token, 'PATCH', `/${COLLECTION}/${slug}?${mask}`, { fields: patch });
    if (res.status >= 400) {
      console.error(`  ERROR PATCH ${res.status}: ${JSON.stringify(res.data).slice(0, 500)}`);
      process.exitCode = 1;
      continue;
    }
    console.log('  Firestore actualizado');
  }

  if (DRY_RUN) return;

  console.log('\n── Verificación ──');
  for (const slug of Object.keys(MAPS)) {
    const res = await firestoreRequest(token, 'GET', `/${COLLECTION}/${slug}`);
    const fields = res.data?.fields || {};
    const geo = JSON.parse(fields.geojsonText?.stringValue || '{}');
    const raw = Object.keys(MAPS[slug].rename).filter(k => k in (geo.features[0]?.properties || {}));
    const keys = Object.keys(geo.features[0]?.properties || {});
    console.log(`${slug}: ${fields.featureCount?.integerValue} features | legendKey=${fields.legendKey?.stringValue || '—'} | crudas=${raw.length ? raw.join(',') : 'ninguna'}`);
    console.log(`  ${keys.join(', ')}`);
    if (raw.length) process.exitCode = 1;
  }
}

main().catch(err => { console.error('Fatal', err); process.exit(1); });
