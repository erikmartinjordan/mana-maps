#!/usr/bin/env node
// ── publish-co2-total.js ─
// Mapa coroplético: Países que más emiten CO2 (totales)
// Fuente: Global Carbon Project / Our World in Data — CO2 fósil total anual (Mt), 2024
// Rampa secuencial monocromática naranja claro→oscuro por emisiones totales
// Geometrías Natural Earth 110m + 50m
//
// Uso:
//   node scripts/publish-co2-total.js [--dry-run]

'use strict';
const https = require('https'), fs = require('fs'), path = require('path');
const { getAccessToken, firestoreRequest, COLLECTION, fsStr, fsInt, fsBool, fsArr, fsNum, fsNull, fsMap } = require('./lib/publisher');

const SLUG = 'co2-total-emissions-world';
const TITLE = 'Países que más emiten CO2 (totales)';
const DRY_RUN = process.argv.includes('--dry-run');
const DATA_YEAR = 2024;

// OWID aggregates / non-countries to skip
const SKIP_NAMES = new Set([
  'World', 'Antarctica', 'Europe', 'Africa', 'Asia', 'North America',
  'South America', 'Oceania', 'European Union (27)', 'High-income countries',
  'Upper-middle-income countries', 'Lower-middle-income countries', 'Low-income countries',
  'European Union (28)', 'International aviation', 'International shipping'
]);

// OWID name → Natural Earth ADMIN (when ISO3 match fails)
const OWID_TO_NE = {
  'United States': 'United States of America',
  'Russia': 'Russia',
  'South Korea': 'South Korea',
  'North Korea': 'North Korea',
  'Iran': 'Iran',
  'Syria': 'Syria',
  'Vietnam': 'Vietnam',
  'Laos': 'Laos',
  'Bolivia': 'Bolivia',
  'Venezuela': 'Venezuela',
  'Tanzania': 'Tanzania',
  'Moldova': 'Moldova',
  'Brunei': 'Brunei',
  'Czechia': 'Czech Republic',
  'eSwatini': 'eSwatini',
  'Cape Verde': 'Cape Verde',
  'Dominican Republic': 'Dominican Republic',
  'Trinidad and Tobago': 'Trinidad and Tobago',
  'Equatorial Guinea': 'Equatorial Guinea',
  'Central African Republic': 'Central African Republic',
  'United Kingdom': 'United Kingdom',
  "Côte d'Ivoire": "Côte d'Ivoire",
  'Republic of the Congo': 'Republic of the Congo',
  'Democratic Republic of Congo': 'Democratic Republic of the Congo',
  'Timor-Leste': 'East Timor',
  'North Macedonia': 'Macedonia',
  'Solomon Islands': 'Solomon Islands',
  'Palestine': 'Palestine',
  'Hong Kong': 'Hong Kong',
  'Macao': 'Macao',
  'Taiwan': 'Taiwan',
  'Kosovo': 'Kosovo',
  'São Tomé and Príncipe': 'São Tomé and Príncipe',
  'Curaçao': 'Curaçao',
  'Greenland': 'Greenland',
};

const CONTINENT_ES = {
  Africa: 'África', Asia: 'Asia', Europe: 'Europa',
  'North America': 'América del Norte', 'South America': 'América del Sur',
  Oceania: 'Oceanía', Antarctica: 'Antártida', 'Seven seas (open ocean)': 'Océano'
};

// Rampa secuencial monocromática (naranja→marrón oscuro) por Mt de CO2 fósil.
// Bins en escala logarítmica para que China/EE.UU./India no colapsen en el mismo color.
const RAMP = [
  { max: 0.05, color: '#fff5ec' },
  { max: 0.5, color: '#fee0d2' },
  { max: 2, color: '#fcbba1' },
  { max: 10, color: '#fc9272' },
  { max: 50, color: '#fb6a4a' },
  { max: 200, color: '#ef3b2c' },
  { max: 800, color: '#cb181d' },
  { max: 2000, color: '#a50f15' },
  { max: 5000, color: '#67000d' },
  { max: Infinity, color: '#4a0007' },
];
const NO_DATA_COLOR = '#d9d9d9';

function colorForMt(mt) {
  if (mt == null || !isFinite(mt)) return NO_DATA_COLOR;
  for (const s of RAMP) if (mt <= s.max) return s.color;
  return RAMP[RAMP.length - 1].color;
}

function fmtEs(n, digits) {
  if (n == null || !isFinite(n)) return 'Sin datos';
  const d = digits != null ? digits : (Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 1 ? 1 : 2);
  const fixed = n.toFixed(d);
  const [int, dec] = fixed.split('.');
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec ? `${withSep},${dec}` : withSep;
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchText(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function fetchJson(url) {
  return fetchText(url).then(t => JSON.parse(t));
}

// Minimal CSV parser (handles quoted fields)
function parseCsv(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQ = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = []; i++; continue;
    }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadOwidCo2(text) {
  const rows = parseCsv(text);
  const header = rows[0];
  const idx = {};
  header.forEach((h, i) => { idx[h] = i; });
  const byIso3 = {};
  let kept = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const year = parseInt(row[idx.year], 10);
    if (year !== DATA_YEAR) continue;
    const iso = (row[idx.iso_code] || '').trim();
    const country = (row[idx.country] || '').trim();
    if (!iso || !country) continue;
    if (SKIP_NAMES.has(country)) continue;
    const co2Raw = row[idx.co2];
    if (co2Raw == null || co2Raw === '') continue;
    const co2 = parseFloat(co2Raw);
    if (!isFinite(co2)) continue;
    const share = row[idx.share_global_co2] != null && row[idx.share_global_co2] !== ''
      ? parseFloat(row[idx.share_global_co2]) : null;
    const perCapita = row[idx.co2_per_capita] != null && row[idx.co2_per_capita] !== ''
      ? parseFloat(row[idx.co2_per_capita]) : null;
    const pop = row[idx.population] != null && row[idx.population] !== ''
      ? parseFloat(row[idx.population]) : null;
    byIso3[iso] = {
      name: country, iso3: iso,
      co2Mt: Math.round(co2 * 1000) / 1000,
      shareGlobal: share != null && isFinite(share) ? Math.round(share * 1000) / 1000 : null,
      co2PerCapita: perCapita != null && isFinite(perCapita) ? Math.round(perCapita * 100) / 100 : null,
      population: pop != null && isFinite(pop) ? Math.round(pop) : null,
    };
    kept++;
  }
  return { byIso3, kept };
}

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

async function buildGeoJSON() {
  console.log(`Fetching OWID CO2 data (${DATA_YEAR})...`);
  const owidText = await fetchText('https://raw.githubusercontent.com/owid/co2-data/master/owid-co2-data.csv');
  const { byIso3, kept } = loadOwidCo2(owidText);
  console.log(`OWID countries with fossil CO2 ${DATA_YEAR}: ${kept}`);

  console.log('Fetching Natural Earth 110m + 50m...');
  const ne110 = await fetchJson('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson');
  const ne50 = await fetchJson('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson');

  const baseFeatures = ne110.features.filter(f => f.properties.ADMIN !== 'Antarctica');
  const adminSet = new Set(baseFeatures.map(f => f.properties.ADMIN));

  const extra = [];
  for (const f of ne50.features) {
    const admin = f.properties.ADMIN;
    if (admin === 'Antarctica') continue;
    if (!adminSet.has(admin) && f.properties.TYPE === 'Sovereign country') {
      const g = JSON.parse(JSON.stringify(f.geometry));
      function rnd(c) {
        if (typeof c[0] === 'number') return [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100];
        return c.map(rnd);
      }
      g.coordinates = rnd(g.coordinates);
      extra.push({ type: 'Feature', properties: f.properties, geometry: g });
    }
  }
  console.log(`Base 110m: ${baseFeatures.length}, extra microstates 50m: ${extra.length}`);

  const all = [...baseFeatures, ...extra];
  const seen = new Set();
  const dedup = [];
  for (const f of all) {
    const a = f.properties.ADMIN;
    if (seen.has(a)) continue;
    seen.add(a); dedup.push(f);
  }

  // Reverse name map: OWID name → NE feature (for ISO3 misses)
  const owidByNeName = {};
  for (const rec of Object.values(byIso3)) {
    const neName = OWID_TO_NE[rec.name];
    if (neName) owidByNeName[neName] = rec;
  }

  const geo = { type: 'FeatureCollection', features: [] };
  const seenNames = new Set();
  let matched = 0, unmatched = 0;

  for (const raw of dedup) {
    const propsRaw = raw.properties;
    const admin = propsRaw.ADMIN;
    if (admin === 'Antarctica') continue;

    let rec = null;
    const iso3 = propsRaw.ISO_A3;
    if (iso3 && iso3 !== '-99' && byIso3[iso3]) rec = byIso3[iso3];
    if (!rec && propsRaw.ISO_A3_EH && byIso3[propsRaw.ISO_A3_EH]) rec = byIso3[propsRaw.ISO_A3_EH];
    if (!rec && owidByNeName[admin]) rec = owidByNeName[admin];
    if (!rec) {
      for (const r of Object.values(byIso3)) {
        if (admin.includes(r.name) || r.name.includes(admin)) { rec = r; break; }
      }
    }

    const mt = rec ? rec.co2Mt : null;
    if (rec) matched++; else unmatched++;

    let esName = propsRaw.NAME_ES;
    if (!esName || esName === '-99') esName = propsRaw.NAME || admin;

    let uniqueEs = esName;
    let dup = 1;
    while (seenNames.has(uniqueEs)) { dup++; uniqueEs = `${esName} (${dup})`; }
    seenNames.add(uniqueEs);

    const continentEn = propsRaw.CONTINENT || '';
    const continente = CONTINENT_ES[continentEn] || continentEn || '—';

    const color = colorForMt(mt);
    const opacity = mt == null ? 0.45 : 0.85;

    const mtStr = mt != null ? `${fmtEs(mt)} Mt` : 'Sin datos';
    const shareStr = rec && rec.shareGlobal != null ? `${fmtEs(rec.shareGlobal, 1)}% del total mundial` : 'sin cuota global publicada';
    const description = rec
      ? `${uniqueEs} — ${mtStr} de CO2 fósil (${shareStr}) — ${DATA_YEAR}`
      : `${uniqueEs} — sin datos de emisiones de CO2 — ${continente}`;

    const geom = raw.geometry;
    function roundCoords(c) {
      if (typeof c[0] === 'number') return [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100];
      return c.map(roundCoords);
    }
    const simplifiedGeom = { type: geom.type, coordinates: roundCoords(geom.coordinates) };

    const feature = {
      type: 'Feature',
      properties: {
        _manaName: uniqueEs,
        name: admin,
        _manaColor: color,
        _manaFillOpacity: opacity,
        _manaWeight: 0.7,
        _manaBorderColor: '#FFFFFF',
        _manaGroupName: 'Emisiones CO2 totales',
        _manaGroupId: 'co2-total',
        _manaLabelStyle: {
          enabled: true,
          fontSize: 11,
          fontFamily: 'DM Sans, sans-serif',
          fontWeight: '600',
          color: '#1e293b',
          haloWidth: 3,
          haloColor: '#FFFFFF',
          placement: 'point',
          field: '_manaName'
        },
        'País': uniqueEs,
        'País (EN)': admin,
        'Continente': continente,
        'Emisiones CO2 totales': mtStr,
        'Emisiones CO2 totales (num)': mt,
        'Cuota global': rec && rec.shareGlobal != null ? `${fmtEs(rec.shareGlobal, 2)}%` : 'Sin datos',
        'CO2 per capita (Mt)': rec && rec.co2PerCapita != null ? rec.co2PerCapita : null,
        'Población': rec && rec.population != null ? fmtEs(Math.round(rec.population / 1e5) / 10) + ' M' : 'Sin datos',
        'Año': DATA_YEAR,
        'Fuente': 'Global Carbon Project / Our World in Data — CO2 fósil total anual (Mt)',
        'Description': description,
        'Superficie': continente,
        'Dato': mtStr,
      },
      geometry: simplifiedGeom,
    };
    geo.features.push(feature);
  }

  geo.features.sort((a, b) => (b.properties['Emisiones CO2 totales (num)'] || -1) - (a.properties['Emisiones CO2 totales (num)'] || -1));

  console.log(`Features: ${geo.features.length}, matched: ${matched}, unmatched: ${unmatched}`);
  const vals = geo.features.map(f => f.properties['Emisiones CO2 totales (num)']).filter(v => v != null);
  console.log(`Mt range: ${fmtEs(Math.min(...vals))} — ${fmtEs(Math.max(...vals))}`);
  const top = geo.features.slice(0, 5).map(f => `${f.properties['País']}: ${f.properties['Emisiones CO2 totales']}`);
  console.log('Top 5:', top.join(' | '));

  return geo;
}

async function main() {
  const geo = await buildGeoJSON();
  const geojsonText = JSON.stringify(geo);
  console.log(`GeoJSON ${(geojsonText.length / 1024).toFixed(1)} KB, features ${geo.features.length}`);
  if (geojsonText.length > 1048576) { console.error('ERROR >1MiB'); process.exit(1); }

  // Validaciones AGENTS.md
  const hexOk = geo.features.every(f => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  console.log('hex valid', hexOk);
  const haloOk = geo.features.every(f => f.properties._manaLabelStyle.haloWidth >= 2);
  console.log('haloWidth >=2', haloOk);
  const coordsOk = geo.features.every(f => {
    let ok = true;
    function walk(c) { if (typeof c[0] === 'number') { if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) ok = false; } else c.forEach(walk); }
    walk(f.geometry.coordinates); return ok;
  });
  console.log('coords within ±180/±90', coordsOk);
  const dupNames = new Set(geo.features.map(f => f.properties._manaName));
  console.log('unique names', dupNames.size === geo.features.length);
  if (!hexOk || !haloOk || !coordsOk || dupNames.size !== geo.features.length) {
    console.error('VALIDATION FAILED'); process.exit(1);
  }

  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'co2-total-emissions-world.geojson'), geojsonText);
  console.log('GeoJSON saved to data/co2-total-emissions-world.geojson');

  const preview = buildMapPreview(geo);
  const now = Date.now();
  const serverNow = { timestampValue: new Date().toISOString() };
  const withData = geo.features.filter(f => f.properties['Emisiones CO2 totales (num)'] != null).length;
  const docFields = {
    id: fsStr(SLUG), slug: fsStr(SLUG),
    title: fsStr(TITLE), name: fsStr(TITLE),
    description: fsStr('Mapa coroplético mundial de las emisiones totales de dióxido de carbono (CO2 fósil) por país con datos del Global Carbon Project / Our World in Data (2024). China (≈12.289 Mt, 31,8% del total mundial), Estados Unidos (≈4.904 Mt) e India (≈3.193 Mt) concentran más de la mitad de las emisiones globales; este mapa completa el par con las emisiones per cápita.'),
    lang: fsStr('es'),
    featureCount: fsInt(geo.features.length),
    mapPreview: fsMap({
      bbox: { arrayValue: { values: preview.bbox.map(v => fsNum(v)) } },
      kind: fsStr('geometry'),
      gridSize: fsInt(8),
      cells: fsNull(),
      features: { arrayValue: { values: preview.features.map(pf => fsMap({
        geometry: fsMap({
          type: fsStr(pf.geometry.type),
          coordinatesText: fsStr(pf.geometry.coordinatesText)
        }),
        color: fsStr(pf.color),
        emoji: fsNull()
      })) } }
    }),
    visibility: fsStr('public'), shareMode: fsStr('view'), allowPublicEdit: fsBool(false), isPublished: fsBool(true),
    shareUrl: fsStr(`https://xn--maa-8ma.com/gallery/?slug=${SLUG}`),
    geojsonText: fsStr(geojsonText), geojsonChunked: fsNull(),
    dataSource: fsStr('Global Carbon Project / Our World in Data (ourworldindata.org) — annual fossil CO2 emissions, million tonnes (GCB, datos 2024)'),
    dataDate: fsStr('2024-12-31'),
    dataYear: fsInt(DATA_YEAR),
    tags: fsArr(['Medio Ambiente', 'Energía', 'Geografía']),
    legendKey: fsStr('Emisiones CO2 totales (num)'),
    legendTitle: fsStr('Emisiones de CO2 (Mt/año)'),
    legendFormat: fsStr('number'),
    authorHandle: fsStr('maña-maps'), createdBy: fsStr('maña-maps'), ownerUid: fsStr('maña-maps'),
    createdAtMs: fsInt(now), updatedAtMs: fsInt(now), createdAt: serverNow, updatedAt: serverNow,
    views: fsInt(0), likes: fsInt(0),
    _featuresWithCount: fsInt(withData),
  };
  delete docFields._featuresWithCount;

  if (DRY_RUN) {
    console.log('\n=== DRY RUN ===');
    console.log('Slug:', SLUG);
    console.log('Title:', TITLE);
    console.log('Features:', geo.features.length, '| with data:', withData);
    console.log('Size:', (geojsonText.length / 1024).toFixed(1), 'KB');
    console.log('legendKey: Emisiones CO2 totales (num)');
    console.log('tags: Medio Ambiente, Energía, Geografía');
    return;
  }

  console.log('Authenticating...');
  const { token, uid } = await getAccessToken();
  if (uid) { docFields.createdBy = fsStr(uid); docFields.ownerUid = fsStr(uid); }
  console.log(`Checking /maps/${SLUG}...`);
  const existing = await firestoreRequest(token, 'GET', `/${COLLECTION}/${SLUG}`);
  if (existing.status === 200) {
    console.log('Updating document...');
    const fieldPaths = Object.keys(docFields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const res = await firestoreRequest(token, 'PATCH', `/${COLLECTION}/${SLUG}?${fieldPaths}`, { fields: docFields });
    if (res.status >= 400) { console.error('Update failed', res.status, JSON.stringify(res.data).slice(0, 600)); process.exit(1); }
    console.log('Updated!');
  } else {
    console.log('Creating...');
    const res = await firestoreRequest(token, 'POST', `/${COLLECTION}?documentId=${SLUG}`, { fields: docFields });
    if (res.status >= 400) { console.error('Create failed', res.status, JSON.stringify(res.data).slice(0, 600)); process.exit(1); }
    console.log('Created!');
  }
  const verify = await firestoreRequest(token, 'GET', `/${COLLECTION}/${SLUG}`);
  if (verify.status === 200) {
    console.log(`✓ isPublished ${verify.data.fields?.isPublished?.booleanValue}, featureCount ${verify.data.fields?.featureCount?.integerValue}`);
    console.log(`✓ title: ${verify.data.fields?.title?.stringValue}`);
    const tags = verify.data.fields?.tags?.arrayValue?.values?.map(v => v.stringValue) || [];
    console.log(`✓ tags: ${tags.join(', ')}`);
    console.log(`✓ legendKey: ${verify.data.fields?.legendKey?.stringValue}`);
    console.log(`✓ dataSource: ${verify.data.fields?.dataSource?.stringValue}`);
    console.log(`✓ Gallery https://xn--maa-8ma.com/gallery/?slug=${SLUG}`);
  } else {
    console.error('Verification failed', verify.status);
    process.exit(1);
  }
}
main().catch(e => { console.error('Fatal', e); process.exit(1); });
