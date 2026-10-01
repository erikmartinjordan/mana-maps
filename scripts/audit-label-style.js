#!/usr/bin/env node
// ── audit-label-style.js ─
// Audita _manaLabelStyle (enabled, haloWidth ≥ 2, campos completos) en todos
// los mapas isPublished de Firestore y completa los que falten, siguiendo el
// patrón ya aplicado a minimum-wage-by-country.
//
// Uso:
//   node scripts/audit-label-style.js [--dry-run] [--verbose]

'use strict';

const { getAccessToken, firestoreRequest, COLLECTION, fsStr } = require('./lib/publisher');

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');
const MAX_DOC_BYTES = 1024 * 1024; // Firestore limit 1 MiB

// ── Patrón de label style (patrón publish-* / minimum-wage fix) ──
const DEFAULT_POLYGON = {
  enabled: true,
  fontSize: 11,
  fontFamily: 'DM Sans, sans-serif',
  fontWeight: '600',
  color: '#1e293b',
  haloWidth: 3,
  haloColor: '#FFFFFF',
  placement: 'point',
  field: '_manaName',
};

const DEFAULT_LINE = {
  enabled: true,
  fontSize: 11,
  fontFamily: 'Arial, sans-serif',
  fontWeight: 'bold',
  color: '#0D47A1',
  haloWidth: 3,
  haloColor: '#FFFFFF',
  placement: 'line',
  field: '_manaName',
};

// Campos que AGENTS.md exige para "_manaLabelStyle completo"
const REQUIRED_FIELDS = [
  'enabled',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'color',
  'haloWidth',
  'haloColor',
  'placement',
  'field',
];

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

function isLineGeometry(geomType) {
  return geomType === 'LineString' || geomType === 'MultiLineString';
}

// Completa un _manaLabelStyle existente siguiendo el patrón, preservando valores.
// Devuelve { style, issues, changed }
function auditAndFixLabelStyle(existing, geomType) {
  const issues = [];
  const pattern = isLineGeometry(geomType) ? DEFAULT_LINE : DEFAULT_POLYGON;

  if (!existing || typeof existing !== 'object' || Object.keys(existing).length === 0) {
    issues.push('missing');
    return { style: { ...pattern }, issues, changed: true };
  }

  const style = { ...existing };

  // 1. enabled debe ser true (patrón minimum-wage)
  if (style.enabled !== true) {
    issues.push('enabled');
    style.enabled = true;
  }

  // 2. haloWidth >= 2
  const hw = Number(style.haloWidth);
  if (!Number.isFinite(hw) || hw < 2) {
    issues.push(`haloWidth(${style.haloWidth})<2`);
    style.haloWidth = 3;
  }

  // 3. Campos completos según el patrón (preservar valores existentes)
  for (const key of REQUIRED_FIELDS) {
    if (style[key] === undefined || style[key] === null || style[key] === '') {
      const def = pattern[key];
      if (def !== undefined && def !== null && def !== '') {
        style[key] = def;
        if (!issues.includes('incomplete')) issues.push('incomplete');
      }
    }
  }

  const changed = issues.length > 0;
  return { style, issues, changed };
}

async function main() {
  console.log(`\n=== audit-label-style.js ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  // Auth state (mutable so we can refresh on 401)
  let auth = await getAccessToken();
  if (!auth || !auth.token) {
    console.error('ERROR: no access token');
    process.exit(1);
  }
  console.log(`Access token obtained (uid=${auth.uid || 'anon'}, len=${auth.token.length}).`);

  async function fsReq(method, urlPath, body) {
    // Retry on transient 401 (Firestore REST can flake right after Auth)
    let lastRes = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      lastRes = await firestoreRequest(auth.token, method, urlPath, body);
      if (lastRes.status === 401 && attempt < 5) {
        console.log(`  ${method} ${urlPath.slice(0, 60)} → 401, re-auth + retry ${attempt}...`);
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
    // Firestore REST pages in small batches even with pageSize=100 — follow nextPageToken
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
    return docs.map(doc => {
      const id = doc.name.split('/').pop();
      return {
        id,
        title: extractField(doc, 'title') || extractField(doc, 'name') || '',
        isPublished: extractField(doc, 'isPublished'),
        geojsonText: extractField(doc, 'geojsonText') || '',
        featureCount: extractField(doc, 'featureCount'),
        rawDoc: doc,
      };
    });
  }

  const allMaps = await listAllMaps();
  const published = allMaps.filter(m => m.isPublished === true);
  console.log(`Found ${allMaps.length} docs, ${published.length} published.\n`);

  console.log('SLUG | FEATURES | LABEL-STYLE ISSUES');
  console.log('-----|----------|-------------------');

  let mapsAudited = 0;
  let mapsFixed = 0;
  let featuresTotal = 0;
  let featuresFixed = 0;
  let errors = 0;
  const summary = [];

  for (const map of published) {
    mapsAudited++;

    if (!map.geojsonText) {
      console.log(`${map.id} | - | no geojsonText`);
      summary.push({ slug: map.id, status: 'skip-no-geojson' });
      continue;
    }

    let geo;
    try {
      geo = JSON.parse(map.geojsonText);
    } catch (e) {
      console.error(`${map.id} | - | invalid GeoJSON: ${e.message}`);
      errors++;
      summary.push({ slug: map.id, status: 'error-parse' });
      continue;
    }

    if (!geo.features || !Array.isArray(geo.features)) {
      console.log(`${map.id} | - | no features array`);
      summary.push({ slug: map.id, status: 'skip-no-features' });
      continue;
    }

    const features = geo.features;
    featuresTotal += features.length;
    const mapIssues = new Map(); // featureName -> issues[]
    let mapFeaturesFixed = 0;

    for (let i = 0; i < features.length; i++) {
      const feature = features[i];
      if (!feature.properties) feature.properties = {};
      const props = feature.properties;
      const geomType = feature.geometry && feature.geometry.type;
      const featureName = props._manaName || props.name || `#${i}`;

      const { style, issues, changed } = auditAndFixLabelStyle(
        props._manaLabelStyle,
        geomType
      );

      if (changed) {
        props._manaLabelStyle = style;
        mapFeaturesFixed++;
        featuresFixed++;
        mapIssues.set(featureName, issues);
        if (VERBOSE) {
          console.log(`  ${map.id} → ${featureName}: ${issues.join(', ')}`);
        }
      }
    }

    if (mapFeaturesFixed === 0) {
      console.log(`${map.id} | ${features.length} | OK (0 issues)`);
      summary.push({ slug: map.id, status: 'ok', features: features.length });
      continue;
    }

    const issueSample = [...mapIssues.entries()].slice(0, 3)
      .map(([name, iss]) => `${name}: ${iss.join('+')}`)
      .join('; ');
    const more = mapIssues.size > 3 ? ` (+${mapIssues.size - 3} more)` : '';
    console.log(`${map.id} | ${features.length} | FIX ${mapFeaturesFixed} features — ${issueSample}${more}`);
    summary.push({ slug: map.id, status: 'fix', features: features.length, fixed: mapFeaturesFixed, issues: [...mapIssues.entries()] });

    // Comprobar tamaño tras la actualización
    const newGeoText = JSON.stringify(geo);
    const newSize = Buffer.byteLength(newGeoText, 'utf8');
    if (newSize > MAX_DOC_BYTES) {
      console.error(`  ✗ SKIP ${map.id}: new geojsonText ${newSize} > 1 MiB limit`);
      errors++;
      summary[summary.length - 1].status = 'skip-size';
      continue;
    }

    if (DRY_RUN) {
      mapsFixed++;
      continue;
    }

    try {
      // Solo actualizar geojsonText (mask mínimo)
      const urlPath = `/${COLLECTION}/${map.id}?updateMask.fieldPaths=geojsonText`;
      const res = await fsReq('PATCH', urlPath, {
        fields: { geojsonText: fsStr(newGeoText) },
      });
      if (res.status >= 400) {
        console.error(`  ✗ UPDATE failed (${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
        errors++;
        summary[summary.length - 1].status = 'error-update';
      } else {
        console.log(`  ✓ Updated geojsonText (${newSize} bytes, ${mapFeaturesFixed} features fixed)`);
        mapsFixed++;
        // Verificación post-update
        const verify = await fsReq('GET', `/${COLLECTION}/${map.id}`);
        if (verify.status === 200 && verify.data && verify.data.fields) {
          const vg = extractField(verify.data, 'geojsonText') || '';
          let ok = false;
          try {
            const vgeo = JSON.parse(vg);
            ok = (vgeo.features || []).every(f => {
              const ls = f.properties && f.properties._manaLabelStyle;
              return ls && ls.enabled === true && Number(ls.haloWidth) >= 2;
            });
          } catch (_) { ok = false; }
          console.log(`  ✓ Verify: _manaLabelStyle complete (enabled + haloWidth>=2) = ${ok}`);
          if (!ok) {
            errors++;
            summary[summary.length - 1].status = 'error-verify';
          } else {
            summary[summary.length - 1].status = 'updated';
          }
        }
      }
    } catch (e) {
      console.error(`  ✗ Error: ${e.message}`);
      errors++;
      summary[summary.length - 1].status = 'error-update';
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Published maps audited: ${mapsAudited}`);
  console.log(`Maps OK (no issues): ${summary.filter(s => s.status === 'ok').length}`);
  console.log(`Maps fixed: ${mapsFixed}`);
  console.log(`Maps skipped/error: ${summary.filter(s => s.status.startsWith('skip') || s.status.startsWith('error')).length}`);
  console.log(`Features total: ${featuresTotal}`);
  console.log(`Features fixed: ${featuresFixed}`);
  console.log(`Errors: ${errors}`);
  console.log('');

  if (VERBOSE) {
    console.log('Per-map details:');
    for (const s of summary) {
      if (s.issues && s.issues.length) {
        console.log(`  ${s.slug}: ${s.fixed} features — issues: ${s.issues.slice(0, 5).map(([n, i]) => `${n}[${i}]`).join(', ')}${s.issues.length > 5 ? '...' : ''}`);
      }
    }
  }

  process.exit(errors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
