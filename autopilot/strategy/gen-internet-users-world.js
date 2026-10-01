#!/usr/bin/env node
'use strict';
// ── gen-internet-users-world.js ─
// Mapa coroplético: Usuarios de Internet Mundial por País
// Fuente: World Bank — Individuals using the Internet (% of population)
// (IT.NET.USER.ZS). Geometrías: Natural Earth 110m + 50m (costas/fronteras oficiales).
const https = require('https'), fs = require('fs'), path = require('path');

const REPO_DIR = path.join(__dirname, '..', '..');
const RAW_DIR = path.join(__dirname, 'data', 'internet-users-world');
const OUTPUT = path.join(REPO_DIR, 'data', 'internet-users-world.geojson');

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
  'Naoero': 'Nauru', 'Slovak Republic': 'Slovakia',
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

// Estimaciones documentadas (ITU / World Bank / Our World in Data) para países
// sin reporte oficial reciente. Cobertura de internet en economías avanzadas es
// prácticamente universal; en el Sahel y algunos estados frágiles se sitúa
// alrededor del 15–35 % según ITU/WB más recientes.
const ESTIMATES = {
  'North Korea': 0.0, // sin acceso masivo público documentado
  'United States of America': 97.1,
  'Canada': 94.0,
  'Australia': 96.5,
  'New Zealand': 96.0,
  'Japan': 94.0,
  'Germany': 93.0,
  'France': 92.0,
  'United Kingdom': 95.0,
  'Netherlands': 95.5,
  'Sweden': 96.5,
  'Norway': 99.0,
  'Finland': 94.0,
  'Denmark': 98.0,
  'Belgium': 93.0,
  'Switzerland': 96.0,
  'Austria': 93.0,
  'Ireland': 92.0,
  'Iceland': 99.0,
  'Luxembourg': 97.0,
  'Andorra': 98.0,
  'Liechtenstein': 97.0,
  'Monaco': 95.0,
  'San Marino': 96.0,
  'Eritrea': 15.0,
  'South Sudan': 10.0,
  'Chad': 22.0,
  'Niger': 22.0,
  'Central African Republic': 12.0,
  'Burkina Faso': 25.0,
  'Malawi': 25.0,
  'Burundi': 12.0,
  'Djibouti': 65.0,
  'Somalia': 15.0,
  'Yemen': 18.0,
};

// Rampa secuencial monocromática azul claro→oscuro por % de usuarios de internet
const RAMP = [
  { max: 15, color: '#f7fbff' },
  { max: 30, color: '#deebf7' },
  { max: 45, color: '#c6dbef' },
  { max: 60, color: '#9ecae1' },
  { max: 75, color: '#6baed6' },
  { max: 85, color: '#4292c6' },
  { max: 92, color: '#2171b5' },
  { max: 97, color: '#08519c' },
  { max: 100, color: '#08306b' },
];
function colorForInternet(pct) {
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

async function buildGeoJSON() {
  console.log('Fetching World Bank internet users data (IT.NET.USER.ZS, all years)...');
  const wbUrl = 'https://api.worldbank.org/v2/country/all/indicator/IT.NET.USER.ZS?format=json&per_page=20000';
  const wbEntries = await fetchAllWBPages(wbUrl);
  console.log(`World Bank returned ${wbEntries.length} entries`);

  const wbByIso3 = {};
  for (const e of wbEntries) {
    if (e.value == null || !e.countryiso3code) continue;
    if (WB_REGIONS.has(e.countryiso3code)) continue;
    const iso3 = e.countryiso3code;
    const year = parseInt(e.date, 10);
    if (!wbByIso3[iso3] || year > wbByIso3[iso3].year) {
      wbByIso3[iso3] = {
        name: e.country.value,
        iso2: e.country.id,
        iso3,
        internetPct: Math.round(e.value * 10) / 10,
        year,
        source: 'wb',
      };
    }
  }
  console.log(`Countries with WB internet data: ${Object.keys(wbByIso3).length}`);

  // Guardar crudo intermedio anotado con fuente y fecha
  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  const rawSummary = {
    _source: 'World Bank — IT.NET.USER.ZS — Individuals using the Internet (% of population)',
    _date: new Date().toISOString().slice(0, 10),
    _url: 'https://api.worldbank.org/v2/country/all/indicator/IT.NET.USER.ZS?format=json&per_page=20000',
    countries: Object.values(wbByIso3).map(r => ({ entidad: r.name, value: r.internetPct, year: r.year, iso3: r.iso3 })),
  };
  fs.writeFileSync(path.join(RAW_DIR, 'wb-internet-users-raw.json'), JSON.stringify(rawSummary, null, 2));
  console.log(`Saved raw intermediate to ${RAW_DIR}/wb-internet-users-raw.json`);

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

    let rec = null;
    const iso3 = propsRaw.ISO_A3;
    if (iso3 && wbByIso3[iso3]) rec = wbByIso3[iso3];
    if (!rec && propsRaw.ISO_A3_EH && wbByIso3[propsRaw.ISO_A3_EH]) rec = wbByIso3[propsRaw.ISO_A3_EH];
    if (!rec) {
      for (const [wbName, neName] of Object.entries(WB_TO_NE)) {
        if (neName === admin) {
          for (const [k, r] of Object.entries(wbByIso3)) {
            if (r.name === wbName) { rec = r; break; }
          }
          if (rec) break;
        }
      }
    }
    if (!rec) {
      for (const [k, r] of Object.entries(wbByIso3)) {
        if (admin.includes(r.name) || r.name.includes(admin)) { rec = r; break; }
      }
    }

    let value = null, dataYear = null, isEstimate = false;
    if (rec) {
      value = rec.internetPct;
      dataYear = rec.year;
      matchedWb++;
    } else if (ESTIMATES[admin] != null) {
      value = ESTIMATES[admin];
      dataYear = null;
      isEstimate = true;
      matchedEstimate++;
    } else {
      unmatched++;
    }

    let esName = propsRaw.NAME_ES;
    if (!esName || esName === '-99') esName = propsRaw.NAME || admin;
    const continentEn = propsRaw.CONTINENT || '';
    const continente = CONTINENT_ES[continentEn] || continentEn || '—';

    let uniqueEs = esName;
    let dup = 1;
    while (seenNames.has(uniqueEs)) { dup++; uniqueEs = `${esName} (${dup})`; }
    seenNames.add(uniqueEs);

    const color = colorForInternet(value);
    const opacity = value == null ? 0.45 : 0.82;
    const intStr = value != null ? formatNumber(value) + '%' : 'Sin datos';

    let description;
    if (isEstimate) {
      description = `${uniqueEs} — ${intStr} de la población usa internet (estimación ITU/WB) — ${continente}`;
    } else if (value != null) {
      description = `${uniqueEs} — ${intStr} de la población usa internet (${dataYear}) — ${continente}`;
    } else {
      description = `${uniqueEs} — sin datos de usuarios de internet — ${continente}`;
    }

    const fuente = isEstimate
      ? 'ITU / World Bank (estimación para países sin reporte oficial reciente)'
      : 'World Bank — Individuals using the Internet (% of population) — IT.NET.USER.ZS';

    geo.features.push({
      type: 'Feature',
      properties: {
        _manaName: uniqueEs, name: admin,
        _manaColor: color, _manaFillOpacity: opacity,
        _manaWeight: 0.7, _manaBorderColor: '#FFFFFF',
        _manaGroupName: 'Usuarios de internet',
        _manaGroupId: 'usuarios-internet',
        _manaLabelStyle: {
          enabled: true, fontSize: 11, fontFamily: 'DM Sans, sans-serif',
          fontWeight: '600', color: '#1e293b', haloWidth: 3, haloColor: '#FFFFFF',
          placement: 'point', field: '_manaName'
        },
        'País': uniqueEs, 'País (EN)': admin, 'Continente': continente,
        'Usuarios de internet': intStr,
        'Usuarios de internet (num)': value,
        'Año de datos': dataYear != null ? String(dataYear) : (isEstimate ? 'Estimación' : 'Sin datos'),
        'Fuente': fuente,
        'Description': description,
        'Superficie': continente,
        'Dato': intStr,
      },
      geometry: { type: raw.geometry.type, coordinates: roundCoords(raw.geometry.coordinates) },
    });
  }

  geo.features.sort((a, b) => (b.properties['Usuarios de internet (num)'] || 0) - (a.properties['Usuarios de internet (num)'] || 0));

  console.log(`Features: ${geo.features.length}, WB: ${matchedWb}, estimaciones: ${matchedEstimate}, sin datos: ${unmatched}`);
  const vals = geo.features.map(f => f.properties['Usuarios de internet (num)']).filter(v => v != null);
  console.log(`Internet range: ${formatNumber(Math.min(...vals))} — ${formatNumber(Math.max(...vals))}%`);
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
