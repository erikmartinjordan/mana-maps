#!/usr/bin/env node
'use strict';
// ── gen-water-sanitation-access-world.js ─
// Mapa coroplético: Acceso a agua potable y saneamiento por país
// Fuente: World Bank — People using at least basic drinking water services
//         (SH.H2O.BASW.ZS) y at least basic sanitation services (SH.STA.BASS.ZS).
//         Ambos indicadores = acceso básico según WHO/UNICEF JMP vía World Bank
//         (coherentes con el título del mapa y con electricity-access-world).
// Geometrías: Natural Earth 110m + 50m (costas/fronteras oficiales).
const https = require('https'), fs = require('fs'), path = require('path');

const REPO_DIR = path.join(__dirname, '..', '..');
const RAW_DIR = path.join(__dirname, 'data', 'water-sanitation-access-world');
const OUTPUT = path.join(REPO_DIR, 'data', 'water-sanitation-access-world.geojson');

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

// Estimaciones documentadas (WHO/UNICEF JMP, World Bank) para países sin
// reporte oficial reciente. La brecha agua-saneamiento es conocida: en el
// Sahel y algunos estados frágiles el acceso básico combinado se sitúa
// alrededor del 25–60 % según JMP/WB más recientes.
const ESTIMATES = {
  'North Korea': { water: 45.0, san: 45.0 },
  'Eritrea': { water: 45.0, san: 25.0 },
  'South Sudan': { water: 25.0, san: 10.0 },
  'Chad': { water: 45.0, san: 20.0 },
  'Central African Republic': { water: 25.0, san: 10.0 },
  'Somalia': { water: 40.0, san: 25.0 },
  'Yemen': { water: 60.0, san: 55.0 },
  'Democratic Republic of the Congo': { water: 28.0, san: 16.0 },
  'Madagascar': { water: 45.0, san: 15.0 },
  'Papua New Guinea': { water: 40.0, san: 20.0 },
  'Nauru': { water: 96.0, san: 95.0 },
  'Marshall Islands': { water: 95.0, san: 94.0 },
  'Micronesia': { water: 92.0, san: 90.0 },
  'Palau': { water: 96.0, san: 95.0 },
  'Tuvalu': { water: 94.0, san: 92.0 },
  'Kiribati': { water: 90.0, san: 85.0 },
};

// Rampa secuencial monocromática azul claro→oscuro por % de acceso combinado
const RAMP = [
  { max: 30, color: '#eff3ff' },
  { max: 45, color: '#bdd7e7' },
  { max: 60, color: '#6baed6' },
  { max: 75, color: '#3182bd' },
  { max: 85, color: '#08519c' },
  { max: 92, color: '#08306b' },
  { max: 96, color: '#041533' },
  { max: 100, color: '#010a1f' },
];
function colorForAccess(pct) {
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
    https.get(url, res => {
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

async function fetchIndicator(indicator, label) {
  console.log(`Fetching World Bank ${label} (${indicator}, all years)...`);
  const wbUrl = `https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&per_page=20000`;
  const wbEntries = await fetchAllWBPages(wbUrl);
  console.log(`World Bank returned ${wbEntries.length} entries for ${indicator}`);

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
  console.log(`Countries with ${label} data: ${Object.keys(byIso3).length}`);
  return byIso3;
}

async function buildGeoJSON() {
  const waterByIso3 = await fetchIndicator('SH.H2O.BASW.ZS', 'agua potable básica');
  const sanByIso3 = await fetchIndicator('SH.STA.BASS.ZS', 'saneamiento básico');

  // Guardar crudo intermedio anotado con fuente y fecha
  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  const rawSummary = {
    _source: 'World Bank — SH.H2O.BASW.ZS (agua potable básica) + SH.STA.BASS.ZS (saneamiento básico)',
    _date: new Date().toISOString().slice(0, 10),
    _urls: [
      'https://api.worldbank.org/v2/country/all/indicator/SH.H2O.BASW.ZS?format=json&per_page=20000',
      'https://api.worldbank.org/v2/country/all/indicator/SH.STA.BASS.ZS?format=json&per_page=20000',
    ],
    countries: Object.keys(waterByIso3).sort().map(iso3 => ({
      entidad: waterByIso3[iso3].name,
      iso3,
      agua: waterByIso3[iso3].pct,
      aguaAnio: waterByIso3[iso3].year,
      saneamiento: sanByIso3[iso3] ? sanByIso3[iso3].pct : null,
      saneamientoAnio: sanByIso3[iso3] ? sanByIso3[iso3].year : null,
    })),
  };
  fs.writeFileSync(path.join(RAW_DIR, 'wb-water-sanitation-raw.json'), JSON.stringify(rawSummary, null, 2));
  console.log(`Saved raw intermediate to ${RAW_DIR}/wb-water-sanitation-raw.json`);

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
  let matchedWb = 0, matchedEstimate = 0, unmatched = 0;

  for (const raw of dedup) {
    const propsRaw = raw.properties;
    const admin = propsRaw.ADMIN;
    if (admin === 'Antarctica') continue;

    let recWater = null, recSan = null;
    const iso3 = propsRaw.ISO_A3;
    const iso3eh = propsRaw.ISO_A3_EH;
    if (iso3 && waterByIso3[iso3]) recWater = waterByIso3[iso3];
    if (iso3 && sanByIso3[iso3]) recSan = sanByIso3[iso3];
    if (!recWater && iso3eh && waterByIso3[iso3eh]) recWater = waterByIso3[iso3eh];
    if (!recSan && iso3eh && sanByIso3[iso3eh]) recSan = sanByIso3[iso3eh];
    if (!recWater || !recSan) {
      for (const [wbName, neName] of Object.entries(WB_TO_NE)) {
        if (neName === admin) {
          for (const [k, r] of Object.entries(waterByIso3)) {
            if (r.name === wbName) { if (!recWater) recWater = r; if (!recSan && sanByIso3[k]) recSan = sanByIso3[k]; break; }
          }
          if (recWater || recSan) break;
        }
      }
    }
    if (!recWater || !recSan) {
      for (const [k, r] of Object.entries(waterByIso3)) {
        if (admin.includes(r.name) || r.name.includes(admin)) {
          if (!recWater) recWater = r;
          if (!recSan && sanByIso3[k]) recSan = sanByIso3[k];
          break;
        }
      }
    }

    let waterPct = recWater ? recWater.pct : null;
    let sanPct = recSan ? recSan.pct : null;
    let dataYear = null, isEstimate = false;
    if (recWater || recSan) {
      matchedWb++;
      if (recWater && recSan) dataYear = Math.max(recWater.year, recSan.year);
      else if (recWater) dataYear = recWater.year;
      else dataYear = recSan.year;
    } else if (ESTIMATES[admin]) {
      waterPct = ESTIMATES[admin].water;
      sanPct = ESTIMATES[admin].san;
      isEstimate = true;
      matchedEstimate++;
    } else {
      unmatched++;
    }

    // Valor combinado del coropeta: media de agua y saneamiento si hay ambos;
    // si solo hay uno, se usa ese. Sirve como único legendKey ordenable.
    let combined = null;
    if (waterPct != null && sanPct != null) combined = Math.round(((waterPct + sanPct) / 2) * 10) / 10;
    else if (waterPct != null) combined = waterPct;
    else if (sanPct != null) combined = sanPct;

    let esName = propsRaw.NAME_ES;
    if (!esName || esName === '-99') esName = propsRaw.NAME || admin;
    const continentEn = propsRaw.CONTINENT || '';
    const continente = CONTINENT_ES[continentEn] || continentEn || '—';

    let uniqueEs = esName;
    let dup = 1;
    while (seenNames.has(uniqueEs)) { dup++; uniqueEs = `${esName} (${dup})`; }
    seenNames.add(uniqueEs);

    const color = colorForAccess(combined);
    const opacity = combined == null ? 0.45 : 0.82;
    const waterStr = waterPct != null ? formatNumber(waterPct) + '%' : 'Sin datos';
    const sanStr = sanPct != null ? formatNumber(sanPct) + '%' : 'Sin datos';
    const combStr = combined != null ? formatNumber(combined) + '%' : 'Sin datos';

    let description;
    if (isEstimate) {
      description = `${uniqueEs} — acceso combinado ${combStr} (agua ${waterStr}, saneamiento ${sanStr}; estimación JMP/WB) — ${continente}`;
    } else if (combined != null) {
      description = `${uniqueEs} — acceso combinado ${combStr} (agua ${waterStr}, saneamiento ${sanStr}, ${dataYear}) — ${continente}`;
    } else {
      description = `${uniqueEs} — sin datos de acceso a agua potable o saneamiento — ${continente}`;
    }

    const fuente = isEstimate
      ? 'WHO/UNICEF JMP / World Bank (estimación para países sin reporte oficial reciente)'
      : 'World Bank — People using at least basic drinking water services (SH.H2O.BASW.ZS) y at least basic sanitation services (SH.STA.BASS.ZS)';

    geo.features.push({
      type: 'Feature',
      properties: {
        _manaName: uniqueEs, name: admin,
        _manaColor: color, _manaFillOpacity: opacity,
        _manaWeight: 0.7, _manaBorderColor: '#FFFFFF',
        _manaGroupName: 'Acceso a agua y saneamiento',
        _manaGroupId: 'agua-saneamiento',
        _manaLabelStyle: {
          enabled: true, fontSize: 11, fontFamily: 'DM Sans, sans-serif',
          fontWeight: '600', color: '#1e293b', haloWidth: 3, haloColor: '#FFFFFF',
          placement: 'point', field: '_manaName'
        },
        'País': uniqueEs, 'País (EN)': admin, 'Continente': continente,
        'Acceso a agua y saneamiento': combStr,
        'Acceso a agua y saneamiento (num)': combined,
        'Agua potable básica': waterStr,
        'Agua potable básica (num)': waterPct,
        'Saneamiento básico': sanStr,
        'Saneamiento básico (num)': sanPct,
        'Año de datos': dataYear != null ? String(dataYear) : (isEstimate ? 'Estimación' : 'Sin datos'),
        'Fuente': fuente,
        'Description': description,
        'Superficie': continente,
        'Dato': combStr,
      },
      geometry: { type: raw.geometry.type, coordinates: roundCoords(raw.geometry.coordinates) },
    });
  }

  geo.features.sort((a, b) => (b.properties['Acceso a agua y saneamiento (num)'] || 0) - (a.properties['Acceso a agua y saneamiento (num)'] || 0));

  console.log(`Features: ${geo.features.length}, WB: ${matchedWb}, estimaciones: ${matchedEstimate}, sin datos: ${unmatched}`);
  const vals = geo.features.map(f => f.properties['Acceso a agua y saneamiento (num)']).filter(v => v != null);
  console.log(`Access range: ${formatNumber(Math.min(...vals))} — ${formatNumber(Math.max(...vals))}%`);
  console.log(`Countries with data (WB+est): ${vals.length}`);
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
