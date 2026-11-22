#!/usr/bin/env node
// ── repair-corrupted-text.js ─
// Repara los caracteres de reemplazo U+FFFD que quedaron en el `geojsonText`
// de mapas publicados (auditoría GIS 22-11). La corrupción venía de leer los
// documentos de Firestore concatenando trozos de string sin decodificar UTF-8:
// cada carácter multibyte partido entre paquetes se guardaba como U+FFFD.
//
// El script no reemplaza el GeoJSON entero (Firestore puede tener correcciones
// posteriores que todavía no están en local): aplica únicamente las secuencias
// corruptas conocidas, tanto al fichero `data/maps/<slug>.geojson` como al
// `geojsonText` del documento, y verifica que no quede ningún U+FFFD.
//
// No toca `views`, `likes`, autoría ni fechas: solo `geojsonText`.
//
// Uso:
//   node scripts/tools/repair-corrupted-text.js [<slug>…] [opciones]
//     --dry-run      no escribe ni publica, solo informa
//     --local-only   no publica en Firestore
//     --remote-only  no escribe el GeoJSON local

'use strict';

const fs = require('fs');
const path = require('path');
const { getAccessToken, firestoreRequest, COLLECTION, fsStr } = require('../lib/publisher');

const ROOT = path.join(__dirname, '..', '..');
const MAPS_DIR = path.join(ROOT, 'data', 'maps');
const REPLACEMENT_CHAR = '\uFFFD';

// Secuencias corruptas verificadas en la auditoría del 22-11. Cada entrada es
// [texto corrupto, texto correcto] y se aplica literalmente (sin regex).
const REPAIRS = {
  'bibliotecas-barcelona': [
    [`C${REPLACEMENT_CHAR}${REPLACEMENT_CHAR}digo Postal`, 'Código Postal'],
    [`Sants-Montju${REPLACEMENT_CHAR}${REPLACEMENT_CHAR}c`, 'Sants-Montjuïc'],
  ],
  'patrimonio-unesco-por-pais': [
    [`Santa Lucía ${REPLACEMENT_CHAR}${REPLACEMENT_CHAR}${REPLACEMENT_CHAR} 1 sitio`, 'Santa Lucía — 1 sitio'],
  ],
  'indice-desarrollo-humano-por-pais': [
    [`(Alto desarrollo humano) ${REPLACEMENT_CHAR}${REPLACEMENT_CHAR} Asia`, '(Alto desarrollo humano) — Asia'],
  ],
  'worst-wildfires-world': [
    [`mort${REPLACEMENT_CHAR}${REPLACEMENT_CHAR}fero`, 'mortífero'],
  ],
};

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const requested = args.filter((a) => !a.startsWith('--'));
const slugs = requested.length ? requested : Object.keys(REPAIRS);
const DRY_RUN = flags.has('--dry-run');
const LOCAL_ONLY = flags.has('--local-only');
const REMOTE_ONLY = flags.has('--remote-only');

function countReplacementChars(text) {
  return (String(text).match(/\uFFFD/g) || []).length;
}

function applyRepairs(text, repairs) {
  let out = text;
  let applied = 0;
  for (const [bad, good] of repairs) {
    const parts = out.split(bad);
    if (parts.length > 1) {
      applied += parts.length - 1;
      out = parts.join(good);
    }
  }
  return { text: out, applied };
}

async function main() {
  const unknown = slugs.filter((slug) => !REPAIRS[slug]);
  if (unknown.length) {
    console.error(`Sin secuencias de reparación conocidas para: ${unknown.join(', ')}`);
    process.exit(1);
  }

  let errors = 0;
  let token = null;

  for (const slug of slugs) {
    const repairs = REPAIRS[slug];
    console.log(`\n${slug}`);

    // 1) Fichero local (fuente mantenida en el repo).
    const geoPath = path.join(MAPS_DIR, `${slug}.geojson`);
    let localText = null;
    if (!REMOTE_ONLY && fs.existsSync(geoPath)) {
      localText = fs.readFileSync(geoPath, 'utf8');
      const before = countReplacementChars(localText);
      const fixed = applyRepairs(localText, repairs);
      if (before === 0) {
        console.log(`  · ${path.relative(ROOT, geoPath)}: ya limpio`);
      } else if (fixed.applied === 0) {
        console.error(`  ✗ ${path.relative(ROOT, geoPath)}: ${before} U+FFFD sin reparación conocida`);
        errors++;
      } else if (countReplacementChars(fixed.text) > 0) {
        console.error(`  ✗ ${path.relative(ROOT, geoPath)}: quedan U+FFFD tras reparar`);
        errors++;
      } else if (DRY_RUN) {
        console.log(`  · (dry-run) ${path.relative(ROOT, geoPath)}: ${before} → 0 U+FFFD`);
      } else {
        fs.writeFileSync(geoPath, fixed.text);
        console.log(`  ✓ ${path.relative(ROOT, geoPath)}: ${before} → 0 U+FFFD`);
      }
    } else if (!REMOTE_ONLY) {
      console.warn(`  · no existe ${path.relative(ROOT, geoPath)}, se omite el fichero local`);
    }

    // 2) Documento de Firestore: solo `geojsonText`.
    if (LOCAL_ONLY) continue;
    if (!token) token = (await getAccessToken()).token;
    const current = await firestoreRequest(token, 'GET', `/${COLLECTION}/${slug}`);
    if (current.status !== 200) {
      console.error(`  ✗ Firestore GET ${current.status}`);
      errors++;
      continue;
    }
    const remoteText = current.data.fields?.geojsonText?.stringValue || '';
    if (!remoteText) {
      console.error('  ✗ el documento no tiene geojsonText');
      errors++;
      continue;
    }
    const before = countReplacementChars(remoteText);
    if (before === 0) {
      console.log('  · Firestore: ya limpio');
      continue;
    }
    const fixed = applyRepairs(remoteText, repairs);
    if (fixed.applied === 0 || countReplacementChars(fixed.text) > 0) {
      console.error(`  ✗ Firestore: ${before} U+FFFD sin reparación completa`);
      errors++;
      continue;
    }
    if (DRY_RUN) {
      console.log(`  · (dry-run) Firestore: ${before} → 0 U+FFFD`);
      continue;
    }
    const mask = 'updateMask.fieldPaths=geojsonText';
    const res = await firestoreRequest(token, 'PATCH', `/${COLLECTION}/${slug}?${mask}`, {
      fields: { geojsonText: fsStr(fixed.text) },
    });
    if (res.status >= 400) {
      console.error(`  ✗ PATCH ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
      errors++;
      continue;
    }
    const verify = await firestoreRequest(token, 'GET', `/${COLLECTION}/${slug}`);
    const vText = verify.status === 200 ? (verify.data.fields?.geojsonText?.stringValue || '') : '';
    const vViews = verify.status === 200 ? verify.data.fields?.views?.integerValue : null;
    if (vText !== fixed.text) {
      console.error('  ✗ Verify FAILED: geojsonText no coincide tras el PATCH');
      errors++;
      continue;
    }
    console.log(`  ✓ Firestore: ${before} → 0 U+FFFD (views ${vViews ?? 'n/d'})`);
  }

  if (errors) {
    console.error(`\n${errors} incidencia(s).`);
    process.exit(1);
  }
  console.log('\nOK');
}

main().catch((e) => {
  console.error('Fatal', e);
  process.exit(1);
});
