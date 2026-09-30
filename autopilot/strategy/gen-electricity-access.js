#!/usr/bin/env node
'use strict';
const https = require('https'), fs = require('fs'), path = require('path');

const REPO_DIR = path.join(__dirname, '..', '..');
const OUTPUT = path.join(REPO_DIR, 'data', 'electricity-access-world.geojson');

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
  'Dominican Republic': 'Dominican Republic', 'Equatorial Guinea': 'Equatorial Guinea',
  'Central African Republic': 'Central African Republic', 'United Kingdom': 'United Kingdom',
  'Micronesia, Fed. Sts.': 'Micronesia', 'Moldova': 'Moldova', 'Tanzania': 'Tanzania',
  'Bolivia': 'Bolivia', 'Puerto Rico (US)': 'Puerto Rico',
  'Virgin Islands (U.S.)': 'United States Virgin Islands',
  'Hong Kong SAR, China': 'Hong Kong', 'Macao SAR, China': 'Macao',
  'Somalia, Fed. Rep.': 'Somalia', 'Kosovo': 'Kosovo', 'Curacao': 'Curaçao',
  'Faeroe Islands': 'Faroe Islands', 'Greenland': 'Greenland',
  'New Caledonia': 'New Caledonia', 'French Polynesia': 'French Polynesia',
  'Aruba': 'Aruba', 'Bermuda': 'Bermuda', 'Cayman Islands': 'Cayman Islands',
  'British Virgin Islands': 'British Virgin Islands',
  'Turks and Caicos Islands': 'Turks and Caicos Islands',
  'Northern Mariana Islands': 'Northern Mariana Islands', 'Guam': 'Guam',
  'American Samoa': 'American Samoa', 'Gibraltar': 'Gibraltar',
  'San Marino': 'San Marino', 'Andorra': 'Andorra',
  'Liechtenstein': 'Liechtenstein', 'Monaco': 'Monaco', 'Nauru': 'Nauru',
  'Marshall Is.': 'Marshall Islands',
  'St. Martin (French part)': 'St. Martin (French part)',
  'Sint Maarten (Dutch part)': 'Sint Maarten (Dutch part)',
  'Channel Islands': 'Guernsey', 'Isle of Man': 'Isle of Man',
};

const WB_REGIONS = new Set([
  'AFE','AFW','ARB','CSS','CEB','EAR','EAS','EAP','TEA','EMU','ECS','ECA','TEC',
  'EUU','HPC','IBD','IBT','IDB','IDX','IDA','LTE','LCN','LAC','TLA','LDC','LMY',
  'MEA','MNA','TMN','MIC','NAC','OED','OSS','PSS','PST','SAS','TSA','SSF','SSA',
  'TSS','WLD'
]);

const CONTINENT_ES = {
  Africa: 'África', Asia: 'Asia', Europe: 'Europa',
  'North America': 'América del Norte', 'South America': 'América del Sur',
  Oceania: 'Oceanía', Antarctica: 'Antártida', 'Seven seas (open ocean)': 'Océano'
};

const RAMP = [
  { max: 10, color: '#eff3ff' },
  { max: 25, color: '#bdd7e7' },
  { max: 50, color: '#6baed6' },
  { max: 75, color: '#3182bd' },
  { max: 90, color: '#08519c' },
  { max: 95, color: '#08306b' },
  { max: 100, color: '#041533' },
];
function colorForAccess(pct) {
  if (pct == null || isNaN(pct)) return '#d9d9d9';
  for (const s of RAMP) if (pct <= s.max) return s.color;
  return RAMP[RAMP.length - 1].color;
}
function formatNumber(n, dec) {
  if (n == null) return 'Sin datos';
  return n.toLocaleString('es-ES', { minimumFractionDigits: dec || 1, maximumFractionDigits: dec || 1 });
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
  console.log('Fetching World Bank electricity access data (EG.ELC.ACCS.ZS)...');
  const wbUrl = 'https://api.worldbank.org/v2/country/all/indicator/EG.ELC.ACCS.ZS?format=json&per_page=300&mrv=1';
  const wbEntries = await fetchAllWBPages(wbUrl);
  console.log(`World Bank returned ${wbEntries.length} entries`);

  const wbByIso3 = {};
  for (const e of wbEntries) {
    if (e.value == null || !e.countryiso3code) continue;
    if (WB_REGIONS.has(e.countryiso3code)) continue;
    const iso3 = e.countryiso3code;
    const year = parseInt(e.date, 10);
    if (!wbByIso3[iso3] || year > wbByIso3[iso3].year) {
      wbByIso3[iso3] = { name: e.country.value, iso2: e.country.id, iso3, accessPct: Math.round(e.value * 10) / 10, year };
    }
  }
  console.log(`Countries with electricity data: ${Object.keys(wbByIso3).length}`);

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

  const neByIso3 = {};
  for (const f of dedup) {
    const iso3 = f.properties.ISO_A3;
    if (iso3 && iso3 !== '-99') neByIso3[iso3] = f;
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
    if (iso3 && wbByIso3[iso3]) wbRecord = wbByIso3[iso3];
    if (!wbRecord && propsRaw.ISO_A3_EH && wbByIso3[propsRaw.ISO_A3_EH]) wbRecord = wbByIso3[propsRaw.ISO_A3_EH];
    if (!wbRecord) {
      for (const [wbName, neName] of Object.entries(WB_TO_NE)) {
        if (neName === admin) {
          for (const [k, rec] of Object.entries(wbByIso3)) {
            if (rec.name === wbName) { wbRecord = rec; break; }
          }
          if (wbRecord) break;
        }
      }
    }
    if (!wbRecord) {
      for (const [k, rec] of Object.entries(wbByIso3)) {
        if (admin.includes(rec.name) || rec.name.includes(admin)) { wbRecord = rec; break; }
      }
    }

    const accessVal = wbRecord ? wbRecord.accessPct : null;
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

    const color = colorForAccess(accessVal);
    const opacity = accessVal == null ? 0.45 : 0.82;
    const accessStr = accessVal != null ? formatNumber(accessVal) + '%' : 'Sin datos';
    const description = wbRecord
      ? `${uniqueEs} — ${accessStr} de la población con electricidad (${dataYear}) — ${continente}`
      : `${uniqueEs} — sin datos de acceso a electricidad — ${continente}`;

    geo.features.push({
      type: 'Feature',
      properties: {
        _manaName: uniqueEs, name: admin,
        _manaColor: color, _manaFillOpacity: opacity,
        _manaWeight: 0.7, _manaBorderColor: '#FFFFFF',
        _manaGroupName: 'Acceso a electricidad',
        _manaGroupId: 'electricidad',
        _manaLabelStyle: {
          enabled: true, fontSize: 11, fontFamily: 'DM Sans, sans-serif',
          fontWeight: '600', color: '#1e293b', haloWidth: 3, haloColor: '#FFFFFF',
          placement: 'point', field: '_manaName'
        },
        'País': uniqueEs, 'País (EN)': admin, 'Continente': continente,
        'Acceso a electricidad': accessStr,
        'Acceso a electricidad (num)': accessVal,
        'Año de datos': dataYear ? String(dataYear) : 'Sin datos',
        'Fuente': 'World Bank — Access to electricity (% of population) (EG.ELC.ACCS.ZS)',
        'Description': description,
        'Superficie': continente,
        'Dato': accessStr,
      },
      geometry: { type: raw.geometry.type, coordinates: roundCoords(raw.geometry.coordinates) },
    });
  }

  geo.features.sort((a, b) => (b.properties['Acceso a electricidad (num)'] || 0) - (a.properties['Acceso a electricidad (num)'] || 0));

  console.log(`Features: ${geo.features.length}, matched: ${matched}, unmatched: ${unmatched}`);
  const vals = geo.features.map(f => f.properties['Acceso a electricidad (num)']).filter(v => v != null);
  console.log(`Access range: ${formatNumber(Math.min(...vals))} — ${formatNumber(Math.max(...vals))}%`);
  return geo;
}

async function main() {
  const geo = await buildGeoJSON();
  const geojsonText = JSON.stringify(geo);
  console.log(`GeoJSON ${(geojsonText.length / 1024).toFixed(1)} KB, features ${geo.features.length}`);

  // Validations
  const hexOk = geo.features.every(f => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  const haloOk = geo.features.every(f => f.properties._manaLabelStyle.haloWidth >= 2);
  const coordsOk = geo.features.every(f => {
    let ok = true;
    function walk(c) { if (typeof c[0] === 'number') { if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) ok = false; } else c.forEach(walk); }
    walk(f.geometry.coordinates); return ok;
  });
  const dupNames = new Set(geo.features.map(f => f.properties._manaName));
  console.log(`Validations — hex: ${hexOk}, halo: ${haloOk}, coords: ${coordsOk}, uniqueNames: ${dupNames.size === geo.features.length}`);

  const dataDir = path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(OUTPUT, geojsonText);
  console.log(`Saved to ${OUTPUT}`);
}
main().catch(e => { console.error('Fatal', e); process.exit(1); });
