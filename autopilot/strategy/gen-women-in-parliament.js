#!/usr/bin/env node
'use strict';
// ── gen-women-in-parliament.js ─
// Mapa coroplético: Mujeres en el parlamento mundial por país
// Fuente: World Bank — Proportion of seats held by women in national
// parliaments (%). Indicator SG.GEN.PARL.ZS.
// Geometrías: Natural Earth 110m + 50m (costas/fronteras oficiales).
// Ángulo: revela dónde el poder legislativo es realmente paritario
// (Ruanda 63,7 %, Cuba 55,7 %…) frente a parlamentos casi sin mujeres.
const https = require('https'), fs = require('fs'), path = require('path');

const REPO_DIR = path.join(__dirname, '..', '..');
const RAW_DIR = path.join(__dirname, 'data', 'women-in-parliament-world');
const OUTPUT = path.join(REPO_DIR, 'data', 'women-in-parliament-world.geojson');

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
  'Brunei': 'Brunéi',
  'Timor-Leste': 'Timor Oriental',
  'East Timor': 'Timor Oriental',
  'Cape Verde': 'Cabo Verde',
  'São Tomé and Principe': 'Santo Tomé y Príncipe',
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
};

// World Bank country name → Natural Earth ADMIN
const WB_TO_NE = {
  'United States': 'United States of America',
  'Turkiye': 'Turkey', 'Viet Nam': 'Vietnam', 'Lao PDR': 'Laos',
  'Syrian Arab Republic': 'Syria', 'Russian Federation': 'Russia',
  'Iran, Islamic Rep.': 'Iran', 'Korea, Rep.': 'South Korea',
  "Korea, Dem. People's Rep.": 'North Korea', 'Egypt, Arab Rep.': 'Egypt',
  'Venezuela, RB': 'Venezuela', 'Congo, Dem. Rep.': 'Democratic Republic of the Congo',
  'Congo, Rep.': 'Republic of the Congo', 'Czechia': 'Czechia',
  "Cote d'Ivoire": "Ivory Coast", 'Gambia, The': 'Gambia',
  'Sao Tome and Principe': 'São Tomé and Principe', 'West Bank and Gaza': 'West Bank',
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
  'Naoero': 'Nauru',
};

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

// Rampa secuencial monocromática violeta claro→oscuro por % de escaños
// de mujeres (más representación = más oscuro). Violeta = color histórico
// del movimiento por los derechos de las mujeres. El escalón 0 % es
// propio para que la leyenda muestre el rango real (0–63,8 %).
const RAMP = [
  { max: 0.001, color: '#faf6fc' },
  { max: 5, color: '#eee2f6' },
  { max: 15, color: '#e0cdf0' },
  { max: 25, color: '#cbb0e4' },
  { max: 35, color: '#b08ed4' },
  { max: 45, color: '#9168c0' },
  { max: 55, color: '#7043a8' },
  { max: 65, color: '#52278c' },
  { max: 100, color: '#35105c' },
];
function colorForParliament(pct) {
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
  console.log('Fetching World Bank women in parliament data (SG.GEN.PARL.ZS)...');
  const wbUrl = 'https://api.worldbank.org/v2/country/all/indicator/SG.GEN.PARL.ZS?format=json&per_page=300&mrv=1';
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
        womenPct: Math.round(e.value * 10) / 10,
        year,
      };
    }
  }
  console.log(`Countries with WB parliament data: ${Object.keys(wbByIso3).length}`);

  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  const rawSummary = {
    _source: 'World Bank — SG.GEN.PARL.ZS — Proportion of seats held by women in national parliaments (%)',
    _date: new Date().toISOString().slice(0, 10),
    _url: wbUrl,
    countries: Object.values(wbByIso3).map(r => ({ entidad: r.name, value: r.womenPct, year: r.year, iso3: r.iso3 })),
  };
  fs.writeFileSync(path.join(RAW_DIR, 'wb-women-in-parliament-raw.json'), JSON.stringify(rawSummary, null, 2));
  console.log(`Saved raw intermediate to ${RAW_DIR}/wb-women-in-parliament-raw.json`);

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

    const womenVal = wbRecord ? wbRecord.womenPct : null;
    const dataYear = wbRecord ? wbRecord.year : null;
    if (wbRecord) matched++; else unmatched++;

    let esName = propsRaw.NAME_ES;
    if (!esName || esName === '-99') esName = ADMIN_TO_ES[admin] || propsRaw.NAME || admin;
    const continentEn = propsRaw.CONTINENT || '';
    const continente = CONTINENT_ES[continentEn] || continentEn || '—';

    let uniqueEs = esName;
    let dup = 1;
    while (seenNames.has(uniqueEs)) { dup++; uniqueEs = `${esName} (${dup})`; }
    seenNames.add(uniqueEs);

    const color = colorForParliament(womenVal);
    const opacity = womenVal == null ? 0.45 : 0.82;
    const womenStr = womenVal != null ? formatNumber(womenVal) + '%' : 'Sin datos';
    const description = wbRecord
      ? `${uniqueEs} — ${womenStr} de los escaños parlamentarios los ocupan mujeres (${dataYear}) — ${continente}`
      : `${uniqueEs} — sin datos de mujeres en el parlamento — ${continente}`;

    geo.features.push({
      type: 'Feature',
      properties: {
        _manaName: uniqueEs, name: admin,
        _manaColor: color, _manaFillOpacity: opacity,
        _manaWeight: 0.7, _manaBorderColor: '#FFFFFF',
        _manaGroupName: 'Mujeres en el parlamento',
        _manaGroupId: 'mujeres-parlamento',
        _manaLabelStyle: {
          enabled: true, fontSize: 11, fontFamily: 'DM Sans, sans-serif',
          fontWeight: '600', color: '#1e293b', haloWidth: 3, haloColor: '#FFFFFF',
          placement: 'point', field: '_manaName'
        },
        'País': uniqueEs, 'País (EN)': admin, 'Continente': continente,
        'Mujeres en el parlamento': womenStr,
        'Mujeres en el parlamento (num)': womenVal,
        'Año de datos': dataYear ? String(dataYear) : 'Sin datos',
        'Fuente': 'World Bank — Proportion of seats held by women in national parliaments (%) — SG.GEN.PARL.ZS',
        'Description': description,
        'Superficie': continente,
        'Dato': womenStr,
      },
      geometry: { type: raw.geometry.type, coordinates: roundCoords(raw.geometry.coordinates) },
    });
  }

  geo.features.sort((a, b) => (b.properties['Mujeres en el parlamento (num)'] || 0) - (a.properties['Mujeres en el parlamento (num)'] || 0));

  console.log(`Features: ${geo.features.length}, matched: ${matched}, unmatched: ${unmatched}`);
  const vals = geo.features.map(f => f.properties['Mujeres en el parlamento (num)']).filter(v => v != null);
  console.log(`Parliament range: ${formatNumber(Math.min(...vals))} — ${formatNumber(Math.max(...vals))}%`);
  console.log(`Countries with data: ${vals.length}`);
  // Top/bottom for hook verification
  const ranked = geo.features
    .filter(f => f.properties['Mujeres en el parlamento (num)'] != null)
    .map(f => `${f.properties._manaName}: ${formatNumber(f.properties['Mujeres en el parlamento (num)'])}%`);
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
