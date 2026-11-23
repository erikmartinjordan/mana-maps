#!/usr/bin/env node
// ── fix-largest-islands-world.js ─
// Repara los datos y la ficha de `largest-islands-world` (auditoría 22-11):
//
//   • Recalcula `Ranking` ordenando las 22 islas por `Superficie (km²)` real
//     (Gran Bretaña #7 y Honshu #8; Novaya Zemlya #17 e Irlanda #18) y
//     actualiza los ordinales de las descripciones afectadas.
//   • Corrige `_manaName` «Isla de-java» → «Isla de Java» y normaliza los
//     topónimos que aún estaban en inglés en `name`/`_manaName` (Greenland,
//     New Guinea, Baffin Island, Great Britain, South Island, Newfoundland,
//     Iceland, Ireland, Hokkaido, Sakhalin, Spitsbergen…), casando con las
//     etiquetas en español del resto del catálogo (AGENTS.md §4).
//   • Genera y guarda el `mapPreview` que faltaba en el documento de Firestore
//     (geometría simplificada por anillos + color), para que la tarjeta y el
//     globo no dependan de descargar el GeoJSON completo.
//
// Uso:
//   node scripts/tools/fix-largest-islands-world.js [--dry-run]
//
// Lee `data/maps/largest-islands-world.geojson` (fuente versionada), lo
// reescribe normalizado y hace PATCH solo de `geojsonText`, `mapPreview`,
// `shareUrl` y `updatedAt`; no toca visitas, likes ni fechas de creación.

'use strict';

const fs = require('fs');
const path = require('path');

const {
  getAccessToken, firestoreRequest, COLLECTION,
  fsStr, fsInt, fsMap,
} = require('../lib/publisher');
const { findEnglishToponyms } = require('../lib/country-names-en-es');

const REPO = path.join(__dirname, '..', '..');
const SLUG = 'largest-islands-world';
const GEO_PATH = path.join(REPO, 'data', 'maps', `${SLUG}.geojson`);
const SHARE_URL = `https://maña.com/gallery/${SLUG}/`;
const DRY_RUN = process.argv.includes('--dry-run');

// Nombres en español de las islas. Las claves son el `name` de origen
// (Natural Earth / Wikipedia) y el valor la etiqueta visible en el catálogo.
const NAMES_ES = {
  Greenland: 'Groenlandia',
  'New Guinea': 'Nueva Guinea',
  Borneo: 'Borneo',
  Madagascar: 'Madagascar',
  'Baffin Island': 'Isla de Baffin',
  Sumatra: 'Sumatra',
  'Great Britain': 'Gran Bretaña',
  Honshu: 'Honshu',
  'Victoria Island': 'Isla Victoria',
  'Ellesmere Island': 'Isla Ellesmere',
  'South Island': 'Isla Sur',
  Java: 'Isla de Java',
  'North Island': 'Isla Norte',
  Cuba: 'Cuba',
  Newfoundland: 'Isla de Terranova',
  Iceland: 'Islandia',
  'Novaya Zemlya': 'Nueva Zembla',
  Ireland: 'Isla de Irlanda',
  Hokkaido: 'Isla de Hokkaido',
  Sakhalin: 'Isla de Sajalín',
  'Tierra del Fuego': 'Tierra del Fuego',
  Spitsbergen: 'Isla de Spitsbergen',
};

// Ordinales que aparecen al principio de la descripción y cambian al
// reordenar Gran Bretaña (8→7) y Honshu (7→8).
const DESCRIPTION_FIXES = {
  'Gran Bretaña': [/^Octava isla/, 'Séptima isla'],
  Honshu: [/^Séptima isla/, 'Octava isla'],
};

const SPANISH_NAMES = new Set(Object.values(NAMES_ES));

function normalize(geo) {
  const byName = new Map();
  for (const feature of geo.features) {
    const props = feature.properties;
    const source = String(props.name || props._manaName || '').trim();
    // Idempotente: acepta tanto el nombre de origen como el ya traducido.
    const spanish = NAMES_ES[source] || (SPANISH_NAMES.has(source) ? source : null);
    if (!spanish) throw new Error(`Nombre sin traducción: «${source}»`);
    if (byName.has(spanish)) throw new Error(`Nombre duplicado: «${spanish}»`);
    byName.set(spanish, true);
    props._manaName = spanish;
    props.name = spanish;

    const fix = DESCRIPTION_FIXES[spanish];
    if (fix && typeof props.Descripción === 'string') {
      props.Descripción = props.Descripción.replace(fix[0], fix[1]);
    }
  }

  // Ranking real por superficie (descendente), con desempate por nombre.
  const ordered = [...geo.features].sort((a, b) => {
    const diff = b.properties['Superficie (km²)'] - a.properties['Superficie (km²)'];
    return diff !== 0 ? diff : a.properties._manaName.localeCompare(b.properties._manaName, 'es');
  });
  ordered.forEach((feature, index) => {
    feature.properties.Ranking = `#${index + 1}`;
  });
  geo.features = ordered;
  return geo;
}

function walkCoords(coords, fn) {
  if (typeof coords[0] === 'number') return fn(coords);
  for (const c of coords) walkCoords(c, fn);
}

function validate(geo) {
  const errors = [];
  if (geo.features.length !== 22) errors.push(`se esperaban 22 islas, hay ${geo.features.length}`);

  const names = new Set();
  const hex = /^#[0-9a-fA-F]{6}$/;
  let previousSurface = Infinity;
  geo.features.forEach((feature, index) => {
    const props = feature.properties;
    const surface = props['Superficie (km²)'];
    if (!Number.isFinite(surface)) errors.push(`${props._manaName}: superficie no numérica`);
    if (surface > previousSurface) errors.push(`${props._manaName}: ranking fuera de orden por superficie`);
    previousSurface = surface;
    if (props.Ranking !== `#${index + 1}`) errors.push(`${props._manaName}: ranking ${props.Ranking} ≠ #${index + 1}`);
    if (props._manaName !== props.name) errors.push(`${props._manaName}: name «${props.name}» no coincide`);
    if (names.has(props._manaName)) errors.push(`nombre duplicado: ${props._manaName}`);
    names.add(props._manaName);
    for (const hit of findEnglishToponyms({ name: props.name })) {
      errors.push(`${props.name}: topónimo en inglés «${hit.value}» → «${hit.spanish}»`);
    }
    if (!hex.test(props._manaColor)) errors.push(`${props._manaName}: color ${props._manaColor} inválido`);
    if (!props._manaLabelStyle || props._manaLabelStyle.haloWidth < 2) {
      errors.push(`${props._manaName}: _manaLabelStyle incompleto`);
    }
    walkCoords(feature.geometry.coordinates, ([lon, lat]) => {
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        errors.push(`${props._manaName}: coordenada fuera de rango [${lon}, ${lat}]`);
      }
    });
  });
  return errors;
}

// Mismo formato que usan los publicadores del repo: anillos simplificados
// (~30 vértices) y color por feature; el globo y las tarjetas lo consumen tal cual.
function buildMapPreview(geo) {
  const bbox = [180, 90, -180, -90];
  walkCoords(geo.features.map((f) => f.geometry.coordinates), ([x, y]) => {
    if (x < bbox[0]) bbox[0] = x;
    if (y < bbox[1]) bbox[1] = y;
    if (x > bbox[2]) bbox[2] = x;
    if (y > bbox[3]) bbox[3] = y;
  });
  const features = geo.features.map((f) => {
    const g = f.geometry;
    let ring = [];
    if (g.type === 'Polygon') ring = g.coordinates[0];
    else if (g.type === 'MultiPolygon') ring = g.coordinates[0][0];
    if (!ring || ring.length < 2) ring = [[0, 0], [1, 1]];
    const step = Math.max(1, Math.floor(ring.length / 30));
    const sampled = [];
    for (let i = 0; i < ring.length; i += step) sampled.push(ring[i]);
    if (sampled.length < 2) sampled.push(ring[ring.length - 1]);
    return {
      geometry: { type: 'LineString', coordinatesText: JSON.stringify(sampled) },
      color: f.properties._manaColor,
      emoji: null,
    };
  });
  return { bbox, kind: 'geometry', gridSize: 8, cells: null, features };
}

async function main() {
  const geo = JSON.parse(fs.readFileSync(GEO_PATH, 'utf8'));
  normalize(geo);

  const errors = validate(geo);
  if (errors.length) {
    console.error('Validación fallida:');
    for (const e of errors) console.error('  -', e);
    process.exit(1);
  }

  const preview = buildMapPreview(geo);
  const geojsonText = JSON.stringify(geo);
  fs.writeFileSync(GEO_PATH, geojsonText);
  console.log(`GeoJSON normalizado: ${geo.features.length} islas, ${(geojsonText.length / 1024).toFixed(1)} KB`);
  for (const feature of geo.features.slice(0, 4)) {
    console.log(`  ${feature.properties.Ranking} ${feature.properties._manaName} · ${feature.properties.Superficie}`);
  }
  console.log(`  … ${geo.features.slice(-2).map((f) => `${f.properties.Ranking} ${f.properties._manaName}`).join(' · ')}`);

  if (DRY_RUN) {
    console.log('\n=== DRY RUN === sin escritura en Firestore');
    return;
  }

  const { token } = await getAccessToken();
  const before = await firestoreRequest(token, 'GET', `/${COLLECTION}/${SLUG}`);
  if (before.status !== 200) {
    console.error(`No se encontró /${COLLECTION}/${SLUG} (${before.status})`);
    process.exit(1);
  }
  const views = before.data.fields?.views?.integerValue;
  console.log(`Visitas conservadas: ${views ?? '(sin campo)'}`);

  const now = Date.now();
  const fields = {
    geojsonText: fsStr(geojsonText),
    mapPreview: fsMap(preview),
    shareUrl: fsStr(SHARE_URL),
    updatedAtMs: fsInt(now),
    updatedAt: { timestampValue: new Date(now).toISOString() },
  };
  const updateMask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const patch = await firestoreRequest(token, 'PATCH', `/${COLLECTION}/${SLUG}?${updateMask}`, { fields });
  if (patch.status >= 400) {
    console.error('PATCH fallido', patch.status, JSON.stringify(patch.data).slice(0, 600));
    process.exit(1);
  }

  const after = await firestoreRequest(token, 'GET', `/${COLLECTION}/${SLUG}`);
  const remote = after.data.fields || {};
  const remoteGeo = JSON.parse(remote.geojsonText.stringValue);
  const same = JSON.stringify(remoteGeo) === geojsonText;
  console.log(`✓ geojsonText remoto idéntico al local: ${same}`);
  console.log(`✓ mapPreview presente: ${Boolean(remote.mapPreview)}`);
  console.log(`✓ visitas tras el PATCH: ${remote.views?.integerValue ?? '(sin campo)'}`);
  console.log(`✓ shareUrl: ${remote.shareUrl?.stringValue}`);
  console.log(`✓ landings: ${SHARE_URL}`);
  if (!same || !remote.mapPreview) process.exit(1);
}

main().catch((error) => {
  console.error('Fatal', error);
  process.exit(1);
});
