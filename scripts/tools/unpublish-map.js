#!/usr/bin/env node
// ── unpublish-map.js ─
// Retira un mapa de la galería pública sin borrarlo: PATCH isPublished=false.
// El documento y sus datos se conservan (el autor lo sigue viendo en Mis mapas)
// y la operación es reversible con el mismo PATCH a true.
//
// Se usa para mapas de comunidad que no cumplen el estándar editorial de
// AGENTS.md y que, al estar isPublished:true, aparecen como tarjeta en la
// galería y rompen `audit-gallery-quality.js` (check 10 de deriva SEO, 11 de
// cobertura de landings/OG, 13 de higiene y 15 de enlaces internos).
//
// Uso:
//   node scripts/tools/unpublish-map.js --slug <slug> --dry-run
//   node scripts/tools/unpublish-map.js --slug <slug> [--force] [--reason "texto"]
//
// Salvaguarda: si el documento parece editorial (título real, dataSource,
// dataDate y tags no vacíos) el script se niega salvo --force, para no retirar
// por error un mapa del catálogo.

'use strict';

const { getAccessToken, firestoreRequest, COLLECTION } = require('../lib/publisher');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return '';
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : '';
}

const SLUG = argValue('--slug');
const REASON = argValue('--reason') || '';

function field(doc, key) {
  const value = doc && doc.fields && doc.fields[key];
  if (!value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(v => v.stringValue || v.integerValue || '');
  return null;
}

function isBlank(value) {
  if (Array.isArray(value)) return value.filter(v => String(v).trim()).length === 0;
  return value == null || String(value).trim() === '';
}

function looksEditorial(doc) {
  const title = String(field(doc, 'title') || field(doc, 'name') || '').trim().toLowerCase();
  const genericTitle = !title || title === 'mapa sin título' || title === 'untitled map';
  return !genericTitle
    && !isBlank(field(doc, 'dataSource'))
    && !isBlank(field(doc, 'dataDate'))
    && !isBlank(field(doc, 'tags'));
}

async function main() {
  if (!SLUG) {
    console.error('Falta --slug. Uso: node scripts/tools/unpublish-map.js --slug <slug> [--dry-run] [--force]');
    process.exit(2);
  }

  const auth = await getAccessToken();
  if (!auth || !auth.token) {
    console.error('ERROR: no se pudo obtener credenciales.');
    process.exit(1);
  }

  const docPath = `/${COLLECTION}/${encodeURIComponent(SLUG)}`;
  const read = await firestoreRequest(auth.token, 'GET', docPath);
  if (read.status === 404) {
    console.error(`ERROR: ${SLUG} no existe en Firestore (${COLLECTION}).`);
    process.exit(1);
  }
  if (read.status !== 200) {
    console.error(`ERROR: lectura fallida (${read.status}): ${JSON.stringify(read.data).slice(0, 300)}`);
    process.exit(1);
  }

  const doc = read.data;
  const current = field(doc, 'isPublished');
  const summary = {
    slug: SLUG,
    title: field(doc, 'title') || field(doc, 'name') || '',
    author: field(doc, 'authorHandle') || '',
    featureCount: field(doc, 'featureCount'),
    views: field(doc, 'views') || 0,
    dataSource: field(doc, 'dataSource'),
    dataDate: field(doc, 'dataDate'),
    tags: field(doc, 'tags'),
    isPublished: current,
  };
  console.log('Mapa:', JSON.stringify(summary, null, 2));

  if (current !== true) {
    console.log(`Sin cambios: ${SLUG} ya está despublicado (isPublished=${current}).`);
    return;
  }

  if (looksEditorial(doc) && !FORCE) {
    console.error('ERROR: el mapa tiene título, dataSource, dataDate y tags (parece editorial).');
    console.error('Revisa su contenido o repite con --force si de verdad quieres retirarlo.');
    process.exit(3);
  }

  if (DRY_RUN) {
    console.log(`DRY RUN: se pondría isPublished=false en ${SLUG}.`);
    return;
  }

  const patch = await firestoreRequest(
    auth.token,
    'PATCH',
    `${docPath}?updateMask.fieldPaths=isPublished`,
    { fields: { isPublished: { booleanValue: false } } }
  );
  if (patch.status !== 200) {
    console.error(`ERROR: PATCH fallido (${patch.status}): ${JSON.stringify(patch.data).slice(0, 300)}`);
    process.exit(1);
  }

  const verify = await firestoreRequest(auth.token, 'GET', docPath);
  const after = verify.status === 200 ? field(verify.data, 'isPublished') : null;
  if (after !== false) {
    console.error(`ERROR: verificación fallida, isPublished=${after}.`);
    process.exit(1);
  }

  console.log(`OK: ${SLUG} despublicado (isPublished=false).${REASON ? ` Motivo: ${REASON}` : ''}`);
  console.log('Recuerda: si el mapa estaba en el catálogo, regenera landings, JSON-LD y sitemap');
  console.log('con `node scripts/tools/generate-map-landings.js --no-images` y');
  console.log('`node scripts/tools/update-sitemap-gallery.js`, y re-audita con');
  console.log('`node scripts/tools/audit-gallery-quality.js --dry-run`.');
}

if (require.main === module) {
  main().catch(error => {
    console.error('ERROR:', error && error.message ? error.message : error);
    process.exit(1);
  });
}

module.exports = { isBlank, looksEditorial };
