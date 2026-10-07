#!/usr/bin/env node
'use strict';
// ── gen-infant-mortality-world.js ─
// Mapa coroplético: Mortalidad infantil mundial por país
// Fuente: World Bank / UN IGME — Mortality rate, infant (per 1,000 live births).
//         Indicator SP.DYN.IMRT.IN (UN Inter-agency Group for Child Mortality
//         Estimation: UNICEF/WHO/UN). Último valor disponible por país (2024).
// Geometrías: Natural Earth 110m + 50m (costas/fronteras oficiales).
// Ángulo: la mortalidad infantil (<1 año) separa países con sanitarias sólidas
// (San Marino 1,2 / Estonia 1,5 / Japón 1,8) de los del Sahel y Cuerno de
// África (Sudán del Sur 71,9 / Nigeria 69,8 / Níger 65,6). Completa el cluster
// de salud de la galería junto a esperanza de vida y acceso a agua.
const https = require('https'), fs = require('fs'), path = require('path');

const REPO_DIR = path.join(__dirname, '..', '..');
const RAW_DIR = path.join(__dirname, 'data', 'infant-mortality-world');
const OUTPUT = path.join(REPO_DIR, 'data', 'infant-mortality-world.geojson');

const WB_INDICATOR = 'SP.DYN.IMRT.IN';
const WB_URL = `https://api.worldbank.org/v2/country/all/indicator/${WB_INDICATOR}?format=json&per_page=20000`;
const DATA_SOURCE = 'World Bank / UN IGME — Mortality rate, infant (per 1,000 live births). Indicator SP.DYN.IMRT.IN. https://data.worldbank.org/indicator/SP.DYN.IMRT.IN';

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
  'Micronesia, Fed. Sts.': 'Micronesia', 'Somalia, Fed. Rep.': 'Somalia',
  'St. Lucia': 'Saint Lucia', 'St. Vincent and the Grenadines': 'Saint Vincent and the Grenadines',
  'St. Kitts and Nevis': 'Saint Kitts and Nevis',
  'Bahamas, The': 'The Bahamas', 'Hong Kong SAR, China': 'Hong Kong',
  'Macao SAR, China': 'Macao', 'Egypt, Arab Rep.': 'Egypt',
};

// ISO3 (World Bank) → Natural Earth ADMIN cuando ISO_A3 de NE es -99
const ISO3_TO_NE = {
  USA: 'United States of America',
  KOR: 'South Korea',
  PRK: 'North Korea',
  RUS: 'Russia',
  IRN: 'Iran',
  SYR: 'Syria',
  LAO: 'Laos',
  TWN: 'Taiwan',
  PSE: 'West Bank',
  SSD: 'South Sudan',
  COD: 'Democratic Republic of the Congo',
  COG: 'Republic of the Congo',
  CIV: "Côte d'Ivoire",
  GMB: 'Gambia',
  BHS: 'The Bahamas',
  TZA: 'Tanzania',
  MDA: 'Moldova',
  BRN: 'Brunei',
  MKD: 'Macedonia',
  SWZ: 'eSwatini',
  TLS: 'East Timor',
  CPV: 'Cape Verde',
  STM: 'São Tomé and Príncipe',
  XKX: 'Kosovo',
  MMR: 'Myanmar',
};

// Agregados regionales del World Bank (no son países)
const WB_REGIONS = new Set([
  'AFE', 'AFW', 'ARB', 'CSS', 'CEB', 'EAR', 'EAS', 'EAP', 'TEA', 'EMU', 'ECS', 'ECA', 'TEC',
  'EUU', 'HPC', 'IBD', 'IBT', 'IDB', 'IDX', 'IDA', 'LTE', 'LCN', 'LAC', 'TLA', 'LDC', 'LMY',
  'MEA', 'MNA', 'TMN', 'MIC', 'NAC', 'OED', 'OSS', 'PSS', 'PST', 'SAS', 'TSA', 'SSF', 'SSA',
  'TSS', 'WLD', 'PRE', 'SST', 'LMC', 'HIC', 'LIC', 'UMC', 'ARB',
]);

const CONTINENT_ES = {
  Africa: 'África', Asia: 'Asia', Europe: 'Europa',
  'North America': 'América del Norte', 'South America': 'América del Sur',
  Oceania: 'Oceanía', Antarctica: 'Antártida', 'Seven seas (open ocean)': 'Océano'
};

// Rampa secuencial monocromática roja claro→oscuro por mortalidad infantil.
// Rojo = color semántico de riesgo/mortalidad (distinto del azul de esperanza
// de vida y del azul de agua). Más oscuro = más muertes por cada 1.000 nacidos.
// Bins pensados para el rango real del indicador (~1–72).
const RAMP = [
  { max: 3, color: '#fff5f0' },
  { max: 6, color: '#fee0d2' },
  { max: 10, color: '#fcbba1' },
  { max: 15, color: '#fc9272' },
  { max: 25, color: '#fb6a4a' },
  { max: 40, color: '#ef3b2c' },
  { max: 55, color: '#cb181d' },
  { max: 70, color: '#a50f15' },
  { max: Infinity, color: '#67000d' },
];
function colorForMortality(rate) {
  if (rate == null || isNaN(rate)) return '#d9d9d9';
  for (const s of RAMP) if (rate <= s.max) return s.color;
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

async function fetchInfantMortality() {
  console.log(`Fetching World Bank infant mortality (${WB_INDICATOR}, all years)...`);
  const wbEntries = await fetchAllWBPages(WB_URL);
  console.log(`World Bank returned ${wbEntries.length} entries for ${WB_INDICATOR}`);

  const byIso3 = {};
  for (const e of wbEntries) {
    if (e.value == null || !e.countryiso3code) continue;
    if (WB_REGIONS.has(e.countryiso3code)) continue;
    if (!e.country || !e.country.id || e.country.id.length !== 2) continue;
    const iso3 = e.countryiso3code;
    const year = parseInt(e.date, 10);
    if (!byIso3[iso3] || year > byIso3[iso3].year) {
      byIso3[iso3] = {
        name: e.country.value,
        iso2: e.country.id,
        iso3,
        rate: Math.round(e.value * 10) / 10,
        year,
      };
    }
  }
  console.log(`Countries with infant mortality data: ${Object.keys(byIso3).length}`);
  return byIso3;
}

async function buildGeoJSON() {
  const byIso3 = await fetchInfantMortality();

  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  const rawSummary = {
    _source: DATA_SOURCE,
    _date: new Date().toISOString().slice(0, 10),
    _url: WB_URL,
    countries: Object.values(byIso3)
      .sort((a, b) => b.rate - a.rate)
      .map(r => ({ entidad: r.name, value: r.rate, year: r.year, iso3: r.iso3 })),
  };
  fs.writeFileSync(path.join(RAW_DIR, 'wb-infant-mortality-raw.json'), JSON.stringify(rawSummary, null, 2));
  console.log(`Saved raw intermediate to ${RAW_DIR}/wb-infant-mortality-raw.json`);

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

  // Reverse name map: WB name → NE feature (for ISO3 misses)
  const wbByNeName = {};
  for (const rec of Object.values(byIso3)) {
    const neName = WB_TO_NE[rec.name];
    if (neName) wbByNeName[neName] = rec;
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
    if (!rec && iso3 && ISO3_TO_NE[iso3] && byIso3[iso3]) rec = byIso3[iso3];
    if (!rec && wbByNeName[admin]) rec = wbByNeName[admin];
    if (!rec) {
      for (const r of Object.values(byIso3)) {
        if (admin.includes(r.name) || r.name.includes(admin)) { rec = r; break; }
      }
    }

    const rate = rec ? rec.rate : null;
    const dataYear = rec ? rec.year : null;
    if (rec) matched++; else unmatched++;

    let esName = propsRaw.NAME_ES;
    if (!esName || esName === '-99') esName = propsRaw.NAME || admin;
    const continentEn = propsRaw.CONTINENT || '';
    const continente = CONTINENT_ES[continentEn] || continentEn || '—';

    let uniqueEs = esName;
    let dup = 1;
    while (seenNames.has(uniqueEs)) { dup++; uniqueEs = `${esName} (${dup})`; }
    seenNames.add(uniqueEs);

    const color = colorForMortality(rate);
    const opacity = rate == null ? 0.45 : 0.82;
    const rateStr = rate != null ? formatNumber(rate) + ' por cada 1.000 nacidos vivos' : 'Sin datos';
    const description = rec
      ? `${uniqueEs} — mortalidad infantil de ${formatNumber(rate)} por cada 1.000 nacidos vivos (${dataYear}) — ${continente}`
      : `${uniqueEs} — sin datos de mortalidad infantil — ${continente}`;

    geo.features.push({
      type: 'Feature',
      properties: {
        _manaName: uniqueEs, name: admin,
        _manaColor: color, _manaFillOpacity: opacity,
        _manaWeight: 0.7, _manaBorderColor: '#FFFFFF',
        _manaGroupName: 'Mortalidad infantil',
        _manaGroupId: 'infant-mortality',
        _manaLabelStyle: {
          enabled: true, fontSize: 11, fontFamily: 'DM Sans, sans-serif',
          fontWeight: '600', color: '#1e293b', haloWidth: 3, haloColor: '#FFFFFF',
          placement: 'point', field: '_manaName'
        },
        'País': uniqueEs, 'País (EN)': admin, 'Continente': continente,
        'Mortalidad infantil': rateStr,
        'Mortalidad infantil (num)': rate,
        'Año de datos': dataYear != null ? String(dataYear) : 'Sin datos',
        'Fuente': 'World Bank / UN IGME — Mortality rate, infant (per 1,000 live births) — SP.DYN.IMRT.IN',
        'Description': description,
        'Superficie': continente,
        'Dato': rate != null ? formatNumber(rate) : 'Sin datos',
      },
      geometry: { type: raw.geometry.type, coordinates: roundCoords(raw.geometry.coordinates) },
    });
  }

  geo.features.sort((a, b) => (b.properties['Mortalidad infantil (num)'] || 0) - (a.properties['Mortalidad infantil (num)'] || 0));

  console.log(`Features: ${geo.features.length}, matched: ${matched}, unmatched: ${unmatched}`);
  const vals = geo.features.map(f => f.properties['Mortalidad infantil (num)']).filter(v => v != null);
  console.log(`Mortality range: ${formatNumber(Math.min(...vals))} — ${formatNumber(Math.max(...vals))} per 1,000 live births`);
  console.log(`Countries with data: ${vals.length}`);
  const ranked = geo.features
    .filter(f => f.properties['Mortalidad infantil (num)'] != null)
    .map(f => `${f.properties._manaName}: ${f.properties['Mortalidad infantil (num)']}`);
  console.log('Top 5 (highest):', ranked.slice(0, 5).join(' | '));
  console.log('Bottom 5 (lowest):', ranked.slice(-5).join(' | '));
  return geo;
}

async function main() {
  const geo = await buildGeoJSON();
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
  console.log(`Validations — hex: ${hexOk}, halo: ${haloOk}, coords: ${coordsOk}, uniqueNames: ${dupNames.size === geo.features.length}`);
  if (!hexOk || !haloOk || !coordsOk || dupNames.size !== geo.features.length) {
    console.error('VALIDATION FAILED');
    process.exit(1);
  }
  if (geojsonText.length > 1048576) { console.error('ERROR: GeoJSON >1MiB'); process.exit(1); }

  const dataDir = path.join(REPO_DIR, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(OUTPUT, geojsonText);
  console.log(`Saved to ${OUTPUT}`);
}
main().catch(e => { console.error('Fatal', e); process.exit(1); });
