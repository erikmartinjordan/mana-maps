#!/usr/bin/env node
// ── translate-country-labels.js ─
// Corrige las etiquetas de país que aún se muestran en inglés en mapas `lang:es`
// (AGENTS.md §4) usando el diccionario scripts/lib/country-names-en-es.js.
//
// Traduce `_manaName` y `País` (y `name` con --include-name), actualiza el
// prefijo de `Description` cuando empieza por el nombre antiguo, opcionalmente
// pasa los decimales de `Description`/`Dato` a coma española (--decimal-comma),
// añade `País` si falta (--add-country), escribe el GeoJSON local en
// data/maps/<slug>.geojson y republica `geojsonText`/`featureCount` en
// Firestore sin pisar métricas ni autoría.
//
// Uso:
//   node scripts/tools/translate-country-labels.js <slug> [<slug>…] [opciones]
//     --dry-run          no escribe ni publica, solo informa
//     --local-only       no publica en Firestore
//     --include-name     traduce también `name`
//     --add-country      añade `País` cuando falta
//     --decimal-comma    convierte decimales con punto a coma en Dato/Description

'use strict';

const fs = require('fs');
const path = require('path');
const { toSpanishCountryName } = require('../lib/country-names-en-es');
const { getAccessToken, firestoreRequest, COLLECTION, fsStr, fsInt } = require('../lib/publisher');

const ROOT = path.join(__dirname, '..', '..');
const MAPS_DIR = path.join(ROOT, 'data', 'maps');

// Nombres que ya son válidos en español aunque la fuente inglesa los use igual.
// Evita marcar «Myanmar», «Macedonia» o el río «Congo» como topónimos ingleses.
const SPANISH_VALID = new Set(['Myanmar', 'Macedonia', 'Congo']);

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const slugs = args.filter((a) => !a.startsWith('--'));
const DRY_RUN = flags.has('--dry-run');
const LOCAL_ONLY = flags.has('--local-only');
const INCLUDE_NAME = flags.has('--include-name');
const ADD_COUNTRY = flags.has('--add-country');
const DECIMAL_COMMA = flags.has('--decimal-comma');

if (!slugs.length) {
  console.error('Uso: node scripts/tools/translate-country-labels.js <slug> [<slug>…] [--dry-run] [--local-only] [--include-name] [--add-country] [--decimal-comma]');
  process.exit(1);
}

function spanish(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (!key || SPANISH_VALID.has(key)) return null;
  const es = toSpanishCountryName(key);
  return es && es !== key ? es : null;
}

function toDecimalComma(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/(\d)\.(\d)/g, '$1,$2');
}

function translateFeature(props) {
  const changes = [];
  const oldName = props._manaName || props.name || null;

  for (const field of ['_manaName', 'País', ...(INCLUDE_NAME ? ['name'] : [])]) {
    const current = props[field];
    const es = spanish(current);
    if (!es) continue;
    props[field] = es;
    changes.push({ field, from: current, to: es });
  }

  if (ADD_COUNTRY && !props.País) {
    const country = props._manaName || props.name;
    if (country) {
      props.País = country;
      changes.push({ field: 'País', from: null, to: country });
    }
  }

  const label = props._manaName || props.name;
  if (typeof props.Description === 'string' && oldName && oldName !== label && props.Description.startsWith(`${oldName}:`)) {
    props.Description = `${label}${props.Description.slice(oldName.length)}`;
    changes.push({ field: 'Description', from: oldName, to: label });
  }

  if (DECIMAL_COMMA) {
    for (const field of ['Dato', 'Description']) {
      if (typeof props[field] === 'string') {
        const next = toDecimalComma(props[field]);
        if (next !== props[field]) {
          props[field] = next;
          changes.push({ field, from: 'decimales con punto', to: 'coma española' });
        }
      }
    }
  }

  return changes;
}

async function main() {
  const prepared = [];
  for (const slug of slugs) {
    const geoPath = path.join(MAPS_DIR, `${slug}.geojson`);
    if (!fs.existsSync(geoPath)) {
      console.error(`✗ ${slug}: no existe ${path.relative(ROOT, geoPath)}`);
      process.exit(1);
    }
    const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
    let featuresChanged = 0;
    let replacements = 0;
    const samples = [];
    for (const feature of geo.features || []) {
      const changes = translateFeature(feature.properties || (feature.properties = {}));
      if (!changes.length) continue;
      featuresChanged++;
      replacements += changes.length;
      if (samples.length < 5) samples.push(`${feature.properties._manaName || feature.properties.name}: ${changes.map((c) => `${c.field} «${c.from}»→«${c.to}»`).join(', ')}`);
    }
    prepared.push({ slug, geo, geoPath, featuresChanged, replacements, samples });
  }

  for (const item of prepared) {
    console.log(`\n${item.slug}: ${item.featuresChanged} features, ${item.replacements} etiquetas`);
    for (const sample of item.samples) console.log(`  · ${sample}`);
    if (!item.featuresChanged) continue;
    if (DRY_RUN) { console.log('  (dry-run, sin cambios)'); continue; }

    const text = JSON.stringify(item.geo);
    if (Buffer.byteLength(text, 'utf8') > 1048576) {
      console.error(`✗ ${item.slug}: geojsonText >1MiB`);
      process.exit(1);
    }
    fs.writeFileSync(item.geoPath, text);
    console.log(`  ✓ ${path.relative(ROOT, item.geoPath)} actualizado (${(text.length / 1024).toFixed(1)} KB)`);

    if (LOCAL_ONLY) continue;
    const { token } = await getAccessToken();
    const mask = ['geojsonText', 'featureCount', 'updatedAtMs', 'updatedAt']
      .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
      .join('&');
    const fields = {
      geojsonText: fsStr(text),
      featureCount: fsInt(item.geo.features.length),
      updatedAtMs: fsInt(Date.now()),
      updatedAt: { timestampValue: new Date().toISOString() },
    };
    const res = await firestoreRequest(token, 'PATCH', `/${COLLECTION}/${item.slug}?${mask}`, { fields });
    if (res.status >= 400) {
      console.error(`  ✗ Firestore PATCH ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
      process.exit(1);
    }
    const verify = await firestoreRequest(token, 'GET', `/${COLLECTION}/${item.slug}`);
    const vGeo = verify.status === 200 ? (verify.data.fields?.geojsonText?.stringValue || '') : '';
    const vCount = verify.status === 200 ? Number(verify.data.fields?.featureCount?.integerValue) : NaN;
    if (vCount !== item.geo.features.length || vGeo !== text) {
      console.error('  ✗ Verify FAILED (featureCount o geojsonText no coinciden)');
      process.exit(1);
    }
    console.log(`  ✓ Firestore ${item.slug} republicado (featureCount ${vCount})`);
  }
}

main().catch((e) => { console.error('Fatal', e); process.exit(1); });
