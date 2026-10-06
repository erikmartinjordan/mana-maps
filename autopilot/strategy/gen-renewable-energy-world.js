#!/usr/bin/env node
'use strict';
// ── gen-renewable-energy-world.js ─
// Mapa coroplético: Energía renovable (% de electricidad) mundial por país
// Fuente: World Bank — Renewable electricity output (% of total electricity
//         output). Indicator EG.ELC.RNEW.ZS.
// Geometrías: Natural Earth 110m + 50m (costas/fronteras oficiales).
// Ángulo: la contraparte de nuclear-energy-world en el cluster de energía:
//   qué países generan electricidad desde fuentes renovables (hidro, solar,
//   eólica, biomasa…). Paraguay, Noruega o Islandia superan el 98 %, mientras
//   petroleras como Omán, Qatar o Kuwait se quedan cerca del 0 %.
const https = require('https'), fs = require('fs'), path = require('path');

const REPO_DIR = path.join(__dirname, '..', '..');
const RAW_DIR = path.join(__dirname, 'data', 'renewable-energy-world');
const OUTPUT = path.join(REPO_DIR, 'data', 'renewable-energy-world.geojson');

const WB_INDICATOR = 'EG.ELC.RNEW.ZS';
const WB_URL = `https://api.worldbank.org/v2/country/all/indicator/${WB_INDICATOR}?format=json&per_page=20000`;
const DATA_SOURCE = 'World Bank — Renewable electricity output (% of total electricity output). Indicator EG.ELC.RNEW.ZS. https://data.worldbank.org/indicator/EG.ELC.RNEW.ZS';

// World Bank country name → Natural Earth ADMIN
const WB_TO_NE = {
  'United States': 'United States of America',
  'Turkiye': 'Turkey', 'Viet Nam': 'Vietnam', 'Lao PDR': 'Laos',
  'Syrian Arab Republic': 'Syria', 'Russian Federation': 'Russia',
  'Iran, Islamic Rep.': 'Iran', 'Korea, Rep.': 'South Korea',
  "Korea, Dem. People's Rep.": 'North Korea', 'Egypt, Arab Rep.': 'Egypt',
  'Venezuela, RB': 'Venezuela', 'Congo, Dem. Rep.': 'Democratic Republic of the Congo',
  'Congo, Rep.': 'Republic of the Congo', 'Czechia': 'Czech Republic',
  "Cote d'Ivoire": "Côte d'Ivoire", 'Gambia, The': 'Gambia',
  'Sao Tome and Principe': 'São Tomé and Príncipe', 'West Bank and Gaza': 'West Bank',
  'Yemen, Rep.': 'Yemen', 'Kyrgyz Republic': 'Kyrgyzstan',
  'Slovak Republic': 'Slovakia', 'North Macedonia': 'Macedonia',
  'Bosnia and Herz.': 'Bosnia and Herzegovina', 'Brunei Darussalam': 'Brunei',
  'Timor-Leste': 'East Timor', 'Cabo Verde': 'Cape Verde', 'Eswatini': 'eSwatini',
  'Micronesia, Fed. Sts.': 'Micronesia', 'Moldova': 'Moldova', 'Tanzania': 'Tanzania',
  'Bolivia': 'Bolivia', 'Puerto Rico (US)': 'Puerto Rico',
  'Virgin Islands (U.S.)': 'United States Virgin Islands',
  'Hong Kong SAR, China': 'Hong Kong', 'Macao SAR, China': 'Macao',
  'Somalia, Fed. Rep.': 'Somalia', 'Kosovo': 'Kosovo', 'Curacao': 'Curaçao',
  'Faeroe Islands': 'Faroe Islands', 'Greenland': 'Greenland',
  'New Caledonia': 'New Caledonia', 'French Polynesia': 'French Polynesia',
  'Marshall Is.': 'Marshall Islands',
  'St. Martin (French part)': 'St. Martin (French part)',
  'Sint Maarten (Dutch part)': 'Sint Maarten (Dutch part)',
  'Channel Islands': 'Guernsey', 'Isle of Man': 'Isle of Man',
  'Naoero': 'Nauru', 'Somalia': 'Somalia',
};

// Agregados regionales del World Bank (no son países)
const WB_REGIONS = new Set([
  'AFE','AFW','ARB','CSS','CEB','EAR','EAS','EAP','TEA','EMU','ECS','ECA','TEC',
  'EUU','HPC','IBD','IBT','IDB','IDX','IDA','LTE','LCN','LAC','TLA','LDC','LMY',
  'MEA','MNA','TMN','MIC','NAC','OED','OSS','PSS','PST','SAS','TSA','SSF','SSA',
  'TSS','WLD','PRE','SST',
]);

const CONTINENT_ES = {
  Africa: 'África', Asia: 'Asia', Europe: 'Europa',
  'North America': 'América del Norte', 'South America': 'América del Sur',
  Oceania: 'Oceanía', Antarctica: 'Antártida', 'Seven seas (open ocean)': 'Océano'
};

// Rampa secuencial monocromática verde claro→oscuro por % de electricidad
// renovable. Verde = color semántico de renovables (paralelo al nuclear del
// mismo cluster). Borde blanco fino en coropleta.
const RAMP = [
  { max: 10, color: '#f7fcf5' },
  { max: 25, color: '#c7e9c0' },
  { max: 40, color: '#a1d99b' },
  { max: 55, color: '#74c476' },
  { max: 70, color: '#41ab5d' },
  { max: 85, color: '#238b45' },
  { max: 95, color: '#006d2c' },
  { max: 100, color: '#00441b' },
];
function colorForRenewable(pct) {
  if (pct == null || isNaN(pct)) return '#d9d9d9';
  for (const s of RAMP) if (pct <= s.max) return s.color;
  return RAMP[RAMP.length - 1].color;
}

function formatNumber(n) {
  if (n == null) return 'Sin datos';
  return n.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'mana-maps-publish/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) return fetchJson(res.headers.location).then(resolve, reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function fetchAllWBPages(url) {
  const first = await fetchJson(url);
  const meta = first[0];
  const pages = meta.pages || 1;
  let all = first[1] || [];
  for (let p = 2; p <= pages; p++) {
    const sep = url.includes('?') ? '&' : '?';
    const next = await fetchJson(url + sep + 'page=' + p);
    all = all.concat(next[1] || []);
  }
  return all;
}

function roundCoords(c) {
  if (typeof c[0] === 'number') return [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100];
  return c.map(roundCoords);
}

async function fetchIndicator() {
  console.log(`Fetching World Bank renewable electricity (${WB_INDICATOR}, all years)...`);
  const wbEntries = await fetchAllWBPages(WB_URL);
  console.log(`World Bank returned ${wbEntries.length} entries`);

  const byIso3 = {};
  for (const e of wbEntries) {
    if (e.value == null || !e.countryiso3code) continue;
    if (WB_REGIONS.has(e.countryiso3code)) continue;
    const iso3 = e.countryiso3code;
    const year = parseInt(e.date, 10);
    if (!byIso3[iso3] || year > byIso3[iso3].year) {
      byIso3[iso3] = {
        name: e.country.value,
        iso2: e.country.id,
        iso3,
        pct: Math.round(e.value * 10) / 10,
        year,
      };
    }
  }
  console.log(`Countries with renewable electricity data: ${Object.keys(byIso3).length}`);
  return byIso3;
}

async function buildGeoJSON() {
  const byIso3 = await fetchIndicator();

  // Guardar crudo intermedio anotado con fuente y fecha
  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  const rawSummary = {
    _source: DATA_SOURCE,
    _date: new Date().toISOString().slice(0, 10),
    _url: WB_URL,
    countries: Object.keys(byIso3).sort().map(iso3 => ({
      entidad: byIso3[iso3].name,
      iso3,
      renovable: byIso3[iso3].pct,
      anio: byIso3[iso3].year,
    })),
  };
  fs.writeFileSync(path.join(RAW_DIR, 'wb-renewable-electricity-raw.json'), JSON.stringify(rawSummary, null, 2));
  console.log(`Saved raw intermediate to ${RAW_DIR}/wb-renewable-electricity-raw.json`);

  console.log('Fetching Natural Earth 110m + 50m...');
  const ne110 = await fetchJson('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson');
  const ne50 = await fetchJson('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson');

  const baseFeatures = ne110.features.filter(f => f.properties.ADMIN !== 'Antarctica');
  const adminSet = new Set(baseFeatures.map(f => f.properties.ADMIN));

  const extra = [];
  for (const f of ne50.features) {
    const admin = f.properties.ADMIN;
    if (admin === 'Antarctica') continue;
    if (!adminSet.has(admin) && f.properties.TYPE === 'Sovereign country')
      extra.push({ type: 'Feature', properties: f.properties, geometry: JSON.parse(JSON.stringify(f.geometry)) });
  }
  console.log(`Base 110m: ${baseFeatures.length}, extra microstates 50m: ${extra.length}`);
  const all = [...baseFeatures, ...extra];

  const seen = new Set();
  const dedup = [];
  for (const f of all) {
    const a = f.properties.ADMIN;
    if (seen.has(a)) continue;
    seen.add(a);
    dedup.push(f);
  }

  const geo = { type: 'FeatureCollection', features: [] };
  const seenNames = new Set();
  let matched = 0, unmatched = 0;

  for (const raw of dedup) {
    const propsRaw = raw.properties;
    const admin = propsRaw.ADMIN;
    if (admin === 'Antarctica') continue;

    let wbRecord = null;
    const iso3 = propsRaw.ISO_A3;
    if (iso3 && byIso3[iso3]) wbRecord = byIso3[iso3];
    if (!wbRecord && propsRaw.ISO_A3_EH && byIso3[propsRaw.ISO_A3_EH]) wbRecord = byIso3[propsRaw.ISO_A3_EH];
    if (!wbRecord) {
      for (const [wbName, neName] of Object.entries(WB_TO_NE)) {
        if (neName === admin) {
          for (const [k, rec] of Object.entries(byIso3)) {
            if (rec.name === wbName) { wbRecord = rec; break; }
          }
          if (wbRecord) break;
        }
      }
    }
    if (!wbRecord) {
      for (const [k, rec] of Object.entries(byIso3)) {
        if (admin.includes(rec.name) || rec.name.includes(admin)) { wbRecord = rec; break; }
      }
    }

    const renewVal = wbRecord ? wbRecord.pct : null;
    const dataYear = wbRecord ? wbRecord.year : null;
    if (wbRecord) matched++; else unmatched++;

    let esName = propsRaw.NAME_ES;
    if (!esName || esName === '-99') esName = propsRaw.NAME || admin;
    const continentEn = propsRaw.CONTINENT || '';
    const continente = CONTINENT_ES[continentEn] || continentEn || '—';

    let uniqueEs = esName;
    let dup = 1;
    while (seenNames.has(uniqueEs)) { dup++; uniqueEs = `${esName} (${dup})`; }
    seenNames.add(uniqueEs);

    const color = colorForRenewable(renewVal);
    const opacity = renewVal == null ? 0.45 : 0.82;
    const renewStr = renewVal != null ? formatNumber(renewVal) + '%' : 'Sin datos';
    const description = wbRecord
      ? `${uniqueEs} — ${renewStr} de la electricidad es renovable (${dataYear}) — ${continente}`
      : `${uniqueEs} — sin datos de electricidad renovable — ${continente}`;

    geo.features.push({
      type: 'Feature',
      properties: {
        _manaName: uniqueEs, name: admin,
        _manaColor: color, _manaFillOpacity: opacity,
        _manaWeight: 0.7, _manaBorderColor: '#FFFFFF',
        _manaGroupName: 'Energía renovable',
        _manaGroupId: 'energia-renovable',
        _manaLabelStyle: {
          enabled: true, fontSize: 11, fontFamily: 'DM Sans, sans-serif',
          fontWeight: '600', color: '#1e293b', haloWidth: 3, haloColor: '#FFFFFF',
          placement: 'point', field: '_manaName'
        },
        'País': uniqueEs, 'País (EN)': admin, 'Continente': continente,
        'Energía renovable': renewStr,
        'Energía renovable (num)': renewVal,
        'Año de datos': dataYear ? String(dataYear) : 'Sin datos',
        'Fuente': 'World Bank — Renewable electricity output (% of total electricity output) — EG.ELC.RNEW.ZS',
        'Description': description,
        'Superficie': continente,
        'Dato': renewStr,
      },
      geometry: { type: raw.geometry.type, coordinates: roundCoords(raw.geometry.coordinates) },
    });
  }

  geo.features.sort((a, b) => (b.properties['Energía renovable (num)'] || 0) - (a.properties['Energía renovable (num)'] || 0));

  console.log(`Features: ${geo.features.length}, matched: ${matched}, unmatched: ${unmatched}`);
  const vals = geo.features.map(f => f.properties['Energía renovable (num)']).filter(v => v != null);
  console.log(`Renewable range: ${formatNumber(Math.min(...vals))} — ${formatNumber(Math.max(...vals))}%`);
  console.log(`Countries with data: ${vals.length}`);
  const years = geo.features.map(f => f.properties['Año de datos']).filter(y => y && y !== 'Sin datos');
  const maxYear = years.length ? Math.max(...years.map(Number)) : null;
  console.log(`Data year range: ${years.length ? Math.min(...years.map(Number)) : '—'} — ${maxYear}`);
  const ranked = geo.features
    .filter(f => f.properties['Energía renovable (num)'] != null)
    .map(f => `${f.properties._manaName}: ${f.properties['Energía renovable']}`);
  console.log('Top 5:', ranked.slice(0, 5).join(' | '));
  console.log('Bottom 5:', ranked.slice(-5).join(' | '));
  return { geo, maxYear };
}

async function main() {
  const { geo, maxYear } = await buildGeoJSON();
  const geojsonText = JSON.stringify(geo);
  console.log(`GeoJSON ${(geojsonText.length / 1024).toFixed(1)} KB, features ${geo.features.length}`);

  const hexOk = geo.features.every(f => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  const haloOk = geo.features.every(f => f.properties._manaLabelStyle && f.properties._manaLabelStyle.haloWidth >= 2);
  const coordsOk = geo.features.every(f => {
    let ok = true;
    function walk(c) { if (typeof c[0] === 'number') { if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) ok = false; } else c.forEach(walk); }
    walk(f.geometry.coordinates); return ok;
  });
  const dupNames = new Set(geo.features.map(f => f.properties._manaName));
  const borderOk = geo.features.every(f => f.properties._manaBorderColor === '#FFFFFF');
  console.log(`Validations — hex: ${hexOk}, halo: ${haloOk}, coords: ${coordsOk}, uniqueNames: ${dupNames.size === geo.features.length}, whiteBorder: ${borderOk}`);
  if (!hexOk || !haloOk || !coordsOk || dupNames.size !== geo.features.length || !borderOk) {
    console.error('VALIDATION FAILED');
    process.exit(1);
  }
  if (geojsonText.length > 1048576) { console.error('ERROR: GeoJSON >1MiB'); process.exit(1); }

  const dataDir = path.join(REPO_DIR, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(OUTPUT, geojsonText);
  console.log(`Saved to ${OUTPUT}`);
  if (maxYear) console.log(`SUGGESTED dataDate: ${maxYear}-12-31 / dataYear: ${maxYear}`);
}
main().catch(e => { console.error('Fatal', e); process.exit(1); });
