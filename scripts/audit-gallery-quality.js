#!/usr/bin/env node
// ── audit-gallery-quality.js ─
// Valida los mapas isPublished de Firestore contra el estándar de AGENTS.md:
//   - dataSource y dataDate no vacíos
//   - featureCount coherente (=== nº real de features del geojson)
//   - coordenadas dentro de ±180/±90
//   - colores hex válidos (_manaColor, _manaBorderColor, labelStyle)
//   - tags presentes (array no vacío)
//   - lang === 'es'
//
// Corrige en Firestore lo que sea mecánicamente corregible:
//   - featureCount → nº real de features
//   - lang → 'es'
// Lo que no se puede inventar (dataSource, dataDate, tags, colores inválidos)
// se reporta como pendiente manual y el script sale con 1.
//
// Uso:
//   node scripts/audit-gallery-quality.js [--dry-run] [--verbose]

'use strict';

const { getAccessToken, firestoreRequest, COLLECTION, fsStr, fsInt } = require('./lib/publisher');

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

// Hex válido: #abc o #aabbcc (cualquier mayúscula/minúscula es válida)
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// ── Helpers ────────────────────────────────────────────────────────

function extractField(doc, fieldName) {
  if (!doc || !doc.fields || !doc.fields[fieldName]) return null;
  const f = doc.fields[fieldName];
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return Number(f.doubleValue);
  if ('booleanValue' in f) return f.booleanValue;
  if ('nullValue' in f) return null;
  if ('arrayValue' in f) {
    return (f.arrayValue.values || []).map(v => {
      if ('stringValue' in v) return v.stringValue;
      if ('integerValue' in v) return Number(v.integerValue);
      if ('doubleValue' in v) return Number(v.doubleValue);
      if ('booleanValue' in v) return v.booleanValue;
      return null;
    });
  }
  return null;
}

function isValidHex(raw) {
  return raw !== null && raw !== undefined && HEX_RE.test(String(raw).trim());
}

/** Recorre todas las coordenadas de un GeoJSON. */
function walkCoordinates(geom, visitor) {
  if (!geom || typeof geom !== 'object') return;
  const t = geom.type;
  const c = geom.coordinates;
  if (t === 'GeometryCollection' && Array.isArray(geom.geometries)) {
    for (const g of geom.geometries) walkCoordinates(g, visitor);
    return;
  }
  if (!Array.isArray(c)) return;
  if (typeof c[0] === 'number') { visitor(Number(c[0]), Number(c[1])); return; }
  for (const child of c) walkCoordinates({ type: t, coordinates: child }, visitor);
}

/**
 * Valida un mapa contra AGENTS.md.
 * Devuelve { issues, features } donde issues = [{ code, detail, fixable, fixField?, fixValue? }]
 */
function auditMap(doc, map) {
  const issues = [];
  const geo = JSON.parse(map.geojsonText);
  const features = Array.isArray(geo.features) ? geo.features : [];

  // 1. dataSource / dataDate
  const dataSource = extractField(doc, 'dataSource');
  const dataDate = extractField(doc, 'dataDate');
  if (dataSource === null || String(dataSource).trim() === '') {
    issues.push({ code: 'dataSource-empty', detail: 'dataSource vacío o ausente', fixable: false });
  }
  if (dataDate === null || String(dataDate).trim() === '') {
    issues.push({ code: 'dataDate-empty', detail: 'dataDate vacío o ausente', fixable: false });
  }

  // 2. featureCount coherente
  const featureCount = extractField(doc, 'featureCount');
  if (featureCount !== features.length) {
    issues.push({
      code: 'featureCount-mismatch',
      detail: `featureCount=${featureCount} pero geojson tiene ${features.length} features`,
      fixable: true,
      fixField: 'featureCount',
      fixValue: features.length,
    });
  }

  // 3. Coordenadas dentro de ±180/±90
  let coordsTotal = 0;
  let coordsBad = 0;
  let firstBad = null;
  for (let i = 0; i < features.length; i++) {
    walkCoordinates(features[i] && features[i].geometry, (lon, lat) => {
      coordsTotal++;
      if (!Number.isFinite(lon) || !Number.isFinite(lat) ||
          Math.abs(lon) > 180 || Math.abs(lat) > 90) {
        coordsBad++;
        if (!firstBad) firstBad = `feature#${i} (${lon}, ${lat})`;
      }
    });
  }
  if (coordsBad > 0) {
    issues.push({ code: 'coords-out-of-range', detail: `${coordsBad}/${coordsTotal} coords fuera de ±180/±90 (ej: ${firstBad})`, fixable: false });
  }

  // 4. Colores hex válidos
  let colorInvalid = 0;
  const colorSamples = [];
  for (let i = 0; i < features.length; i++) {
    const p = (features[i] && features[i].properties) || {};
    const candidates = [p._manaColor, p._manaBorderColor];
    const ls = p._manaLabelStyle;
    if (ls && typeof ls === 'object') candidates.push(ls.color, ls.haloColor);
    for (const v of candidates) {
      if (v === undefined || v === null || v === '') continue;
      if (!isValidHex(v)) {
        colorInvalid++;
        if (colorSamples.length < 3) colorSamples.push(`feature#${i}="${v}"`);
      }
    }
  }
  if (colorInvalid > 0) {
    issues.push({ code: 'color-invalid', detail: `${colorInvalid} colores hex inválidos (${colorSamples.join('; ')})`, fixable: false });
  }

  // 5. tags presentes
  const tags = extractField(doc, 'tags');
  if (!Array.isArray(tags) || tags.length === 0 ||
      tags.every(t => t === null || String(t).trim() === '')) {
    issues.push({ code: 'tags-empty', detail: 'tags ausente o vacío', fixable: false });
  }

  // 6. lang === 'es'
  const lang = extractField(doc, 'lang');
  if (lang !== 'es') {
    issues.push({
      code: 'lang-not-es',
      detail: `lang="${lang}" (se espera "es")`,
      fixable: true,
      fixField: 'lang',
      fixValue: 'es',
    });
  }

  return { issues, features: features.length };
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== audit-gallery-quality.js ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  let auth = await getAccessToken();
  if (!auth || !auth.token) {
    console.error('ERROR: no access token');
    process.exit(1);
  }
  console.log(`Access token obtained (uid=${auth.uid || 'anon'}).`);

  async function fsReq(method, urlPath, body) {
    let lastRes = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      lastRes = await firestoreRequest(auth.token, method, urlPath, body);
      if (lastRes.status === 401 && attempt < 5) {
        console.log(`  ${method} → 401, re-auth + retry ${attempt}...`);
        await new Promise(r => setTimeout(r, attempt * 1000));
        auth = await getAccessToken();
        if (!auth || !auth.token) throw new Error('re-auth failed: no token');
        continue;
      }
      return lastRes;
    }
    return lastRes;
  }

  async function listAllMaps() {
    const docs = [];
    let pageToken = '';
    let pages = 0;
    do {
      const url = `/${COLLECTION}?pageSize=100` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const res = await fsReq('GET', url);
      if (res.status !== 200) {
        throw new Error(`List maps failed (${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
      }
      docs.push(...(res.data.documents || []));
      pageToken = res.data.nextPageToken || '';
      pages++;
    } while (pageToken && pages < 20);
    return docs;
  }

  const allDocs = await listAllMaps();
  const published = allDocs
    .map(doc => ({ doc, id: doc.name.split('/').pop() }))
    .filter(({ doc }) => extractField(doc, 'isPublished') === true);
  console.log(`Found ${allDocs.length} docs, ${published.length} published.\n`);

  console.log('SLUG | FEATURES | ISSUES');
  console.log('-----|----------|-------');

  let mapsAudited = 0;
  let mapsFixed = 0;
  let mapsClean = 0;
  let mapsPendingManual = 0;
  let errors = 0;

  for (const { doc, id } of published) {
    mapsAudited++;
    const geojsonText = extractField(doc, 'geojsonText') || '';
    if (!geojsonText) {
      console.log(`${id} | - | SKIP no geojsonText`);
      errors++;
      mapsPendingManual++;
      continue;
    }

    let result;
    try {
      result = auditMap(doc, { id, geojsonText });
    } catch (e) {
      console.error(`${id} | - | ERROR parse: ${e.message}`);
      errors++;
      mapsPendingManual++;
      continue;
    }

    const { issues } = result;

    if (issues.length === 0) {
      console.log(`${id} | ${result.features} | OK`);
      mapsClean++;
      continue;
    }

    const fixable = issues.filter(i => i.fixable);
    const manual = issues.filter(i => !i.fixable);
    console.log(`${id} | ${result.features} | ${issues.map(i => i.code).join(', ')}`);
    if (VERBOSE) {
      for (const iss of issues) console.log(`    - ${iss.code}: ${iss.detail}${iss.fixable ? ' [auto-fix]' : ' [manual]'}`);
    }

    if (DRY_RUN) {
      const would = fixable.map(f => `${f.fixField}=${JSON.stringify(f.fixValue)}`);
      console.log(`  → DRY RUN, would fix: ${would.join(', ') || '(ninguno automático)'}`);
      if (manual.length) console.log(`  → pendiente manual: ${manual.map(m => `${m.code}: ${m.detail}`).join('; ')}`);
      if (fixable.length) mapsFixed++;
      if (manual.length) mapsPendingManual++;
      continue;
    }

    // Aplicar correcciones automáticas (escalares)
    try {
      const fields = {};
      const mask = [];
      for (const f of fixable) {
        if (!f.fixField) continue;
        mask.push(f.fixField);
        fields[f.fixField] = f.fixField === 'featureCount' ? fsInt(f.fixValue) : fsStr(f.fixValue);
      }

      if (mask.length === 0) {
        console.log(`  → sin correcciones automáticas disponibles; pendiente manual`);
        mapsPendingManual++;
        continue;
      }

      const maskQs = mask.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
      const res = await fsReq('PATCH', `/${COLLECTION}/${id}?${maskQs}`, { fields });
      if (res.status >= 400) {
        console.error(`  ✗ UPDATE failed (${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
        errors++;
        continue;
      }
      console.log(`  ✓ Fixed: ${mask.join(', ')}`);
      mapsFixed++;

      // Verificación post-update
      const verify = await fsReq('GET', `/${COLLECTION}/${id}`);
      if (verify.status === 200 && verify.data && verify.data.fields) {
        const vf = verify.data.fields;
        const fcOk = Number(vf.featureCount && vf.featureCount.integerValue) === result.features;
        const langOk = vf.lang && vf.lang.stringValue === 'es';
        console.log(`  ✓ Verify: featureCount=${vf.featureCount && vf.featureCount.integerValue} (esperado ${result.features}) ${fcOk ? 'OK' : 'FAIL'}; lang="${vf.lang && vf.lang.stringValue}" ${langOk ? 'OK' : 'FAIL'}`);
        if (!fcOk || !langOk) errors++;
      }

      if (manual.length) {
        console.log(`  → pendiente manual: ${manual.map(m => `${m.code}: ${m.detail}`).join('; ')}`);
        mapsPendingManual++;
      }
    } catch (e) {
      console.error(`  ✗ Error: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Published maps audited: ${mapsAudited}`);
  console.log(`Maps clean: ${mapsClean}`);
  console.log(`Maps fixed (auto): ${mapsFixed}`);
  console.log(`Maps pending manual: ${mapsPendingManual}`);
  console.log(`Errors: ${errors}`);
  console.log('');

  const unresolved = mapsPendingManual + errors;
  process.exit(unresolved > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
