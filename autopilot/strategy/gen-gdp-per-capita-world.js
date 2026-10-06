#!/usr/bin/env node
'use strict';
// ── gen-gdp-per-capita-world.js ─
// Mapa coroplético: PIB per cápita mundial por país
// Fuente: World Bank — GDP per capita (current US$). Indicator NY.GDP.PCAP.CD.
// Entrega de datos: Our World in Data (ourworldindata.org/grapher/gdp-per-capita-worldbank),
//   que republica el indicador del World Bank (la API directa del WB está
//   bloqueada por WAF desde este entorno). Último valor disponible por país.
// Geometrías: Natural Earth 110m + 50m (costas/fronteras oficiales).
// Ángulo: el PIB per cápita medio por persona separa las economías más ricas
// (Singapur, Irlanda, Luxemburgo, Macao) de las más pobres (Burundi, República
// Centroafricana, Somalia). Completa el cluster económico de la galería junto
// al salario mínimo.
const https = require('https'), fs = require('fs'), path = require('path');

const REPO_DIR = path.join(__dirname, '..', '..');
const RAW_DIR = path.join(__dirname, 'data', 'gdp-per-capita-world');
const OUTPUT = path.join(REPO_DIR, 'data', 'gdp-per-capita-world.geojson');

// Our World in Data republica NY.GDP.PCAP.CD bajo este nombre de gráfico
const OWID_CSV_URL = 'https://ourworldindata.org/grapher/gdp-per-capita-worldbank.csv';
const WB_INDICATOR = 'NY.GDP.PCAP.CD';
const DATA_SOURCE = 'World Bank (vía Our World in Data) — GDP per capita (current US$). Indicator NY.GDP.PCAP.CD. https://data.worldbank.org/indicator/NY.GDP.PCAP.CD';

// Agregados regionales / grupos de renta que no son países.
// OWID usa códigos OWID_* para agregados, pero OWID_KOS sí es Kosovo (país).
const OWID_AGGREGATE_CODES = new Set(['OWID_WRL', 'OWID_EU27', 'OWID_HIC', 'OWID_LIC', 'OWID_LMC', 'OWID_UMC']);
const SKIP_ENTITIES = new Set([
  'World', 'Europe', 'Africa', 'Asia', 'North America', 'South America', 'Oceania',
  'European Union (27)', 'High-income countries', 'Upper-middle-income countries',
  'Lower-middle-income countries', 'Low-income countries',
  'East Asia and Pacific (WB)', 'Europe and Central Asia (WB)', 'Latin America and Caribbean (WB)',
  'Middle East and North Africa (WB)', 'North America (WB)', 'South Asia (WB)', 'Sub-Saharan Africa (WB)',
]);
function isAggregate(entity, code) {
  if (!code) return true;
  if (OWID_AGGREGATE_CODES.has(code)) return true;
  if (code.startsWith('WB_')) return true;
  if (SKIP_ENTITIES.has(entity)) return true;
  return false;
}

// Fallback de nombres en español para features sin NAME_ES útil
const ADMIN_TO_ES = {
  'United States of America': 'Estados Unidos',
  'United Republic of Tanzania': 'Tanzania',
  'Democratic Republic of the Congo': 'República Democrática del Congo',
  'Republic of the Congo': 'República del Congo',
  'Congo': 'República del Congo',
  "Côte d'Ivoire": "Costa de Marfil",
  'Ivory Coast': "Costa de Marfil",
  'Swaziland': 'Suazilandia',
  'eSwatini': 'Suazilandia',
  'Macedonia': 'Macedonia del Norte',
  'North Macedonia': 'Macedonia del Norte',
  'Czech Republic': 'República Checa',
  'Czechia': 'República Checa',
  'South Korea': 'Corea del Sur',
  'North Korea': 'Corea del Norte',
  'Laos': 'Laos',
  'Vietnam': 'Vietnam',
  'Syria': 'Siria',
  'Russia': 'Rusia',
  'Iran': 'Irán',
  'Egypt': 'Egipto',
  'Venezuela': 'Venezuela',
  'Bolivia': 'Bolivia',
  'Tanzania': 'Tanzania',
  'Micronesia': 'Micronesia',
  'Federated States of Micronesia': 'Micronesia',
  'Micronesia (country)': 'Micronesia',
  'Brunei': 'Brunéi',
  'Timor-Leste': 'Timor Oriental',
  'East Timor': 'Timor Oriental',
  'Cape Verde': 'Cabo Verde',
  'São Tomé and Principe': 'Santo Tomé y Príncipe',
  'Sao Tome and Principe': 'Santo Tomé y Príncipe',
  'West Bank': 'Palestina',
  'Palestine': 'Palestina',
  'Somaliland': 'Somalilandia',
  'Northern Cyprus': 'República Turca del Norte de Chipre',
  'N. Cyprus': 'República Turca del Norte de Chipre',
  'Kosovo': 'Kosovo',
  'Taiwan': 'Taiwán',
  'Greenland': 'Groenlandia',
  'Falkland Islands': 'Islas Malvinas',
  'Fr. S. Antarctic Lands': 'Tierras Australes y Antárticas Francesas',
  'French Southern and Antarctic Lands': 'Tierras Australes y Antárticas Francesas',
  'Solomon Islands': 'Islas Salomón',
  'Marshall Islands': 'Islas Marshall',
  'Saint Kitts and Nevis': 'San Cristóbal y Nieves',
  'Saint Lucia': 'Santa Lucía',
  'Saint Vincent and the Grenadines': 'San Vicente y las Granadinas',
  'Trinidad and Tobago': 'Trinidad y Tobago',
  'Central African Republic': 'República Centroafricana',
  'Equatorial Guinea': 'Guinea Ecuatorial',
  'Papua New Guinea': 'Papúa Nueva Guinea',
  'Bosnia and Herzegovina': 'Bosnia y Herzegovina',
  'Dominican Republic': 'República Dominicana',
  'United Arab Emirates': 'Emiratos Árabes Unidos',
  'United Kingdom': 'Reino Unido',
  'South Africa': 'Sudáfrica',
  'South Sudan': 'Sudán del Sur',
  'São Tomé & Príncipe': 'Santo Tomé y Príncipe',
  'United States': 'Estados Unidos',
  'Bosnia and Herz.': 'Bosnia y Herzegovina',
  'Central African Rep.': 'República Centroafricana',
  'Dem. Rep. Congo': 'República Democrática del Congo',
  'Eq. Guinea': 'Guinea Ecuatorial',
  'S. Sudan': 'Sudán del Sur',
  'Solomon Is.': 'Islas Salomón',
  'W. Sahara': 'Sáhara Occidental',
  'Cote d\'Ivoire': 'Costa de Marfil',
  'Democratic Republic of Congo': 'República Democrática del Congo',
  'Gambia': 'Gambia',
  'Cape Verde': 'Cabo Verde',
};

// Nombre OWID/World Bank → Natural Earth ADMIN (fallback si falla ISO3)
const NAME_TO_NE = {
  'United States': 'United States of America',
  'United States of America': 'United States of America',
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
  'Czech Republic': 'Czech Republic',
  'eSwatini': 'eSwatini',
  'Eswatini': 'eSwatini',
  'Swaziland': 'eSwatini',
  'Cape Verde': 'Cape Verde',
  'Dominican Republic': 'Dominican Republic',
  'Trinidad and Tobago': 'Trinidad and Tobago',
  'Equatorial Guinea': 'Equatorial Guinea',
  'Central African Republic': 'Central African Republic',
  'United Kingdom': 'United Kingdom',
  "Cote d'Ivoire": "Côte d'Ivoire",
  'Congo': 'Republic of the Congo',
  'Democratic Republic of Congo': 'Democratic Republic of the Congo',
  'East Timor': 'East Timor',
  'Timor-Leste': 'East Timor',
  'North Macedonia': 'Macedonia',
  'Solomon Islands': 'Solomon Islands',
  'Palestine': 'Palestine',
  'West Bank': 'West Bank',
  'Hong Kong': 'Hong Kong',
  'Macao': 'Macao',
  'Taiwan': 'Taiwan',
  'Kosovo': 'Kosovo',
  'Sao Tome and Principe': 'São Tomé and Príncipe',
  'Curacao': 'Curaçao',
  'Greenland': 'Greenland',
  'Micronesia (country)': 'Micronesia',
  'Micronesia': 'Micronesia',
  'Gambia': 'Gambia',
  'Yemen': 'Yemen',
  'Egypt': 'Egypt',
  'Kyrgyzstan': 'Kyrgyzstan',
  'Slovakia': 'Slovakia',
  'Turkey': 'Turkey',
  'Turkiye': 'Turkey',
};

// ISO3 (OWID Code) → Natural Earth ADMIN cuando ISO_A3 de NE es -99
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
  OWID_KOS: 'Kosovo',
  FSM: 'Micronesia',
  MMR: 'Myanmar',
  MNE: 'Montenegro',
  SRB: 'Serbia',
};

const CONTINENT_ES = {
  Africa: 'África', Asia: 'Asia', Europe: 'Europa',
  'North America': 'América del Norte', 'South America': 'América del Sur',
  Oceania: 'Oceanía', Antarctica: 'Antártida', 'Seven seas (open ocean)': 'Océano'
};

// Rampa secuencial monocromática verde claro→oscuro por USD de PIB per cápita.
// Verde = color semántico de riqueza/economía (distinto del azul del salario
// mínimo). Bins en escala logarítmica para que Singapur/Irlanda/Luxemburgo no
// colapsen con países de renta media.
const RAMP = [
  { max: 1500, color: '#f7fcf5' },
  { max: 4000, color: '#c7e9c0' },
  { max: 8000, color: '#a1d99b' },
  { max: 15000, color: '#74c476' },
  { max: 30000, color: '#41ab5d' },
  { max: 60000, color: '#238b45' },
  { max: 100000, color: '#006d2c' },
  { max: Infinity, color: '#00441b' },
];
function colorForGdp(usd) {
  if (usd == null || isNaN(usd)) return '#d9d9d9';
  for (const s of RAMP) if (usd <= s.max) return s.color;
  return RAMP[RAMP.length - 1].color;
}

function formatUsd(n) {
  if (n == null) return 'Sin datos';
  // ES: 12345.67 -> "12.346" (redondeado a unidad, PIB per cápita en USD)
  const rounded = Math.round(n);
  return rounded.toLocaleString('es-ES', { maximumFractionDigits: 0 });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'mana-maps-publish/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) return fetchText(res.headers.location).then(resolve, reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
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

function loadOwidGdp(text) {
  const rows = parseCsv(text);
  const header = rows[0];
  const idx = {};
  header.forEach((h, i) => { idx[h] = i; });
  const byIso3 = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const entity = (row[idx.Entity] || '').trim();
    const code = (row[idx.Code] || '').trim();
    const year = parseInt(row[idx.Year], 10);
    const raw = row[idx['GDP per capita']];
    if (!entity || !code || !isFinite(year) || raw == null || raw === '') continue;
    if (isAggregate(entity, code)) continue;
    const gdp = parseFloat(raw);
    if (!isFinite(gdp)) continue;
    // Último valor disponible por país (OWID incluye 2024/2025 según país)
    if (!byIso3[code] || year > byIso3[code].year) {
      byIso3[code] = {
        name: entity,
        iso3: code,
        gdpPc: Math.round(gdp),
        year,
      };
    }
  }
  return { byIso3, kept: Object.keys(byIso3).length };
}

function roundCoords(c) {
  if (typeof c[0] === 'number') return [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100];
  return c.map(roundCoords);
}

async function buildGeoJSON() {
  console.log(`Fetching OWID GDP per capita CSV (World Bank NY.GDP.PCAP.CD)...`);
  const csvText = await fetchText(OWID_CSV_URL);
  const { byIso3, kept } = loadOwidGdp(csvText);
  console.log(`Countries with GDP per capita data: ${kept}`);

  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  const rawSummary = {
    _source: DATA_SOURCE,
    _date: new Date().toISOString().slice(0, 10),
    _url: OWID_CSV_URL,
    countries: Object.values(byIso3).map(r => ({ entidad: r.name, value: r.gdpPc, year: r.year, iso3: r.iso3 })),
  };
  fs.writeFileSync(path.join(RAW_DIR, 'wb-gdp-per-capita-raw.json'), JSON.stringify(rawSummary, null, 2));
  console.log(`Saved raw intermediate to ${RAW_DIR}/wb-gdp-per-capita-raw.json`);

  console.log('Fetching Natural Earth 110m + 50m...');
  const ne110 = JSON.parse(await fetchText('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'));
  const ne50 = JSON.parse(await fetchText('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson'));

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

  // Reverse name map: OWID name → NE feature (for ISO3 misses)
  const owidByNeName = {};
  for (const rec of Object.values(byIso3)) {
    const neName = NAME_TO_NE[rec.name];
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
    if (!rec && iso3 && ISO3_TO_NE[iso3] && byIso3[iso3]) rec = byIso3[iso3];
    if (!rec && owidByNeName[admin]) rec = owidByNeName[admin];
    if (!rec) {
      for (const r of Object.values(byIso3)) {
        if (admin.includes(r.name) || r.name.includes(admin)) { rec = r; break; }
      }
    }

    const gdpVal = rec ? rec.gdpPc : null;
    const dataYear = rec ? rec.year : null;
    if (rec) matched++; else unmatched++;

    let esName = propsRaw.NAME_ES;
    if (!esName || esName === '-99') esName = ADMIN_TO_ES[admin] || propsRaw.NAME || admin;
    const continentEn = propsRaw.CONTINENT || '';
    const continente = CONTINENT_ES[continentEn] || continentEn || '—';

    let uniqueEs = esName;
    let dup = 1;
    while (seenNames.has(uniqueEs)) { dup++; uniqueEs = `${esName} (${dup})`; }
    seenNames.add(uniqueEs);

    const color = colorForGdp(gdpVal);
    const opacity = gdpVal == null ? 0.45 : 0.82;
    const gdpStr = gdpVal != null ? formatUsd(gdpVal) + ' $' : 'Sin datos';
    const description = rec
      ? `${uniqueEs} — PIB per cápita de ${gdpStr} (${dataYear}) — ${continente}`
      : `${uniqueEs} — sin datos de PIB per cápita — ${continente}`;

    geo.features.push({
      type: 'Feature',
      properties: {
        _manaName: uniqueEs, name: admin,
        _manaColor: color, _manaFillOpacity: opacity,
        _manaWeight: 0.7, _manaBorderColor: '#FFFFFF',
        _manaGroupName: 'PIB per cápita',
        _manaGroupId: 'gdp-per-capita',
        _manaLabelStyle: {
          enabled: true, fontSize: 11, fontFamily: 'DM Sans, sans-serif',
          fontWeight: '600', color: '#1e293b', haloWidth: 3, haloColor: '#FFFFFF',
          placement: 'point', field: '_manaName'
        },
        'País': uniqueEs, 'País (EN)': admin, 'Continente': continente,
        'PIB per cápita (USD)': gdpStr,
        'PIB per cápita (num)': gdpVal,
        'Año de datos': dataYear ? String(dataYear) : 'Sin datos',
        'Fuente': 'World Bank (vía Our World in Data) — GDP per capita (current US$) — NY.GDP.PCAP.CD',
        'Description': description,
        'Superficie': continente,
        'Dato': gdpStr,
      },
      geometry: { type: raw.geometry.type, coordinates: roundCoords(raw.geometry.coordinates) },
    });
  }

  geo.features.sort((a, b) => (b.properties['PIB per cápita (num)'] || 0) - (a.properties['PIB per cápita (num)'] || 0));

  console.log(`Features: ${geo.features.length}, matched: ${matched}, unmatched: ${unmatched}`);
  const vals = geo.features.map(f => f.properties['PIB per cápita (num)']).filter(v => v != null);
  console.log(`GDP per capita range: ${formatUsd(Math.min(...vals))} — ${formatUsd(Math.max(...vals))} $`);
  console.log(`Countries with data: ${vals.length}`);
  const ranked = geo.features
    .filter(f => f.properties['PIB per cápita (num)'] != null)
    .map(f => `${f.properties._manaName}: ${f.properties['PIB per cápita (USD)']}`);
  console.log('Top 5:', ranked.slice(0, 5).join(' | '));
  console.log('Bottom 5:', ranked.slice(-5).join(' | '));
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
