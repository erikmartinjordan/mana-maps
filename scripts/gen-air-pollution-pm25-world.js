#!/usr/bin/env node
// ── gen-air-pollution-pm25-world.js ─
// Genera data/air-pollution-pm25-world.geojson:
//   coropleta mundial «Exposición a la contaminación del aire (PM2.5) por país».
//
// Datos: World Bank (EN.ATM.PM25.MC.M3) — exposición media anual de la
//   población a partículas finas PM2.5 (µg/m³), fuente WHO Global Health
//   Observatory, año 2023. Se descarga el indicador para 2010–2023 y se toma
//   el último dato disponible por país (todos tienen 2023).
// Geometría: Natural Earth 110m + 50m (mismo patrón que el resto de coropletas).
//
// Rampa §3 AGENTS.md: secuencial monocromática (tono 25°, ámbar), 9 pasos,
//   ordenada por el dato de claro→oscuro sobre escala logarítmica (1,6 → 107,8;
//   la escala lineal comprimía el 90 % de los países en 2 pasos).
//
// Uso: node scripts/gen-air-pollution-pm25-world.js
'use strict';
const https = require('https'), fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'autopilot', 'strategy', 'data', 'air-pollution-pm25-world');
const OUT = path.join(ROOT, 'data', 'air-pollution-pm25-world.geojson');

const WB_COUNTRIES_URL = 'https://api.worldbank.org/v2/country?format=json&per_page=400';
const WB_DATA_URL = 'https://api.worldbank.org/v2/country/all/indicator/EN.ATM.PM25.MC.M3?format=json&per_page=20000&date=2010:2023';
const DATA_SOURCE = 'World Bank — World Development Indicators EN.ATM.PM25.MC.M3 (exposición media anual de la población a PM2.5, µg/m³), fuente WHO Global Health Observatory, dato de 2023. Geometrías: Natural Earth 110m/50m.';

const GROUP_NAME = 'Contaminación del aire (PM2.5)';
const GROUP_ID = 'pm25';
const NUM_KEY = 'PM2.5 (µg/m³)';
const HUE = 25;           // ámbar: humo/contaminación; rampa mono §3
const RAMP_STEPS = 9;
const NO_DATA = '#d9d9d9';
const WHO_GUIDELINE = 5;

// Fallback de nombres en español para features sin NAME_ES útil
const ADMIN_TO_ES = {
  'United States of America': 'Estados Unidos',
  'United Republic of Tanzania': 'Tanzania',
  'Democratic Republic of the Congo': 'República Democrática del Congo',
  'Republic of the Congo': 'República del Congo',
  'Congo': 'República del Congo',
  "Côte d'Ivoire": 'Costa de Marfil',
  'Ivory Coast': 'Costa de Marfil',
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
  'United States': 'Estados Unidos',
  'W. Sahara': 'Sáhara Occidental',
  'Gambia': 'Gambia',
  'Nauru': 'Nauru',
  'Naoero': 'Nauru',
};

// Nombre World Bank → Natural Earth ADMIN (fallback si falla ISO3)
const NAME_TO_NE = {
  'United States': 'United States of America',
  'South Korea': 'South Korea',
  'North Korea': 'North Korea',
  'Czechia': 'Czech Republic',
  'eSwatini': 'eSwatini',
  'Eswatini': 'eSwatini',
  'Swaziland': 'eSwatini',
  'Cape Verde': 'Cape Verde',
  'Congo': 'Republic of the Congo',
  'Democratic Republic of Congo': 'Democratic Republic of the Congo',
  'East Timor': 'East Timor',
  'Timor-Leste': 'East Timor',
  "Cote d'Ivoire": "Côte d'Ivoire",
  "Cote d'Ivoire": "Côte d'Ivoire",
  'North Macedonia': 'Macedonia',
  'Solomon Islands': 'Solomon Islands',
  'Palestine': 'Palestine',
  'West Bank': 'West Bank',
  'Micronesia (country)': 'Micronesia',
  'Micronesia, Fed. Sts.': 'Micronesia',
  'Sao Tome and Principe': 'São Tomé and Príncipe',
  'Central African Republic': 'Central African Republic',
  'Equatorial Guinea': 'Equatorial Guinea',
  'Trinidad and Tobago': 'Trinidad and Tobago',
  'Dominican Republic': 'Dominican Republic',
  'Bosnia and Herzegovina': 'Bosnia and Herzegovina',
  'United Kingdom': 'United Kingdom',
  'United Arab Emirates': 'United Arab Emirates',
  'South Africa': 'South Africa',
  'South Sudan': 'South Sudan',
  'Papua New Guinea': 'Papua New Guinea',
  'Nauru': 'Nauru',
  'Naoero': 'Nauru',
};

// ISO3 → Natural Earth ADMIN cuando ISO_A3 de NE es -99
const ISO3_TO_NE = {
  USA: 'United States of America', KOR: 'South Korea', PRK: 'North Korea',
  RUS: 'Russia', IRN: 'Iran', SYR: 'Syria', LAO: 'Laos', TWN: 'Taiwan',
  PSE: 'West Bank', SSD: 'South Sudan', COD: 'Democratic Republic of the Congo',
  COG: 'Republic of the Congo', CIV: "Côte d'Ivoire", GMB: 'Gambia',
  BHS: 'The Bahamas', TZA: 'Tanzania', MDA: 'Moldova', BRN: 'Brunei',
  MKD: 'Macedonia', SWZ: 'eSwatini', TLS: 'East Timor', CPV: 'Cape Verde',
  STM: 'São Tomé and Príncipe', XKX: 'Kosovo', FSM: 'Micronesia',
  MMR: 'Myanmar', MNE: 'Montenegro', SRB: 'Serbia', NRU: 'Nauru',
};

const CONTINENT_ES = {
  Africa: 'África', Asia: 'Asia', Europe: 'Europa',
  'North America': 'América del Norte', 'South America': 'América del Sur',
  Oceania: 'Oceanía', Antarctica: 'Antártida', 'Seven seas (open ocean)': 'Océano',
};

// ── Helpers de color (mismos parámetros que buildMonoRamp del auditor) ──
function hslToHex(h, s, l) {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const ll = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0, g = 0, b = 0;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const hx = n => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}
function buildMonoRamp(hue, steps) {
  const ramp = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    ramp.push(hslToHex(hue, 55 + t * 25, 94 - t * 70)); // l 94%→24%, s 55%→80%
  }
  return ramp;
}

// «42,4» — un decimal con coma decimal (es-ES)
const fmtPM = v => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');

function labelStyle() {
  return {
    enabled: true, fontSize: 11, fontFamily: 'DM Sans, sans-serif',
    fontWeight: '600', color: '#1e293b', haloWidth: 3, haloColor: '#FFFFFF',
    placement: 'point', field: '_manaName',
  };
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'mana-maps-publish/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) return fetchJson(res.headers.location).then(resolve, reject);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function roundCoords(c) {
  if (typeof c[0] === 'number') return [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100];
  return c.map(roundCoords);
}

// Spearman con media de rangos para empates (validación §3)
function spearmanRho(xs, ys) {
  const n = xs.length;
  if (n < 3) return 0;
  const rank = arr => {
    const s = arr.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
    const r = new Array(arr.length);
    let i = 0;
    while (i < s.length) {
      let j = i;
      while (j + 1 < s.length && s[j + 1].x === s[i].x) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[s[k].i] = avg;
      i = j + 1;
    }
    return r;
  };
  const rv = rank(xs), rl = rank(ys);
  const mean = a => a.reduce((x, y) => x + y, 0) / n;
  const mv = mean(rv), ml = mean(rl);
  let num = 0, dv = 0, dl = 0;
  for (let i = 0; i < n; i++) {
    num += (rv[i] - mv) * (rl[i] - ml);
    dv += (rv[i] - mv) ** 2; dl += (rl[i] - ml) ** 2;
  }
  return (dv && dl) ? num / Math.sqrt(dv * dl) : 0;
}
function hexToLum(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function hexToHue(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return h * 360;
}
function hueSpanDegrees(hues) {
  if (!hues || hues.length < 2) return 0;
  const hs = hues.slice().sort((a, b) => a - b);
  if (hs[hs.length - 1] === hs[0]) return 0;
  let maxGap = 0;
  for (let i = 0; i < hs.length - 1; i++) maxGap = Math.max(maxGap, hs[i + 1] - hs[i]);
  maxGap = Math.max(maxGap, (hs[0] + 360) - hs[hs.length - 1]);
  return 360 - maxGap;
}

async function main() {
  console.log('Fetching World Bank country metadata...');
  const countryPayload = await fetchJson(WB_COUNTRIES_URL);
  const countries = {};
  for (const r of countryPayload[1] || []) {
    if (!r.region || r.region.id === 'NA') continue; // excluye agregados
    countries[r.id] = r;
  }
  console.log(`Países (sin agregados): ${Object.keys(countries).length}`);

  console.log('Fetching PM2.5 indicator (2010–2023)...');
  const dataPayload = await fetchJson(WB_DATA_URL);
  const byIso3 = {};
  for (const r of dataPayload[1] || []) {
    if (r.value == null) continue;
    const iso3 = r.countryiso3code;
    if (!iso3 || !countries[iso3]) continue;
    const year = parseInt(r.date, 10);
    if (!isFinite(year)) continue;
    if (!byIso3[iso3] || year > byIso3[iso3].year) {
      byIso3[iso3] = { name: countries[iso3].name, iso3, pm25: r.value, year };
    }
  }
  console.log(`Países con dato: ${Object.keys(byIso3).length}`);

  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(path.join(RAW_DIR, 'wb-pm25-raw.json'), JSON.stringify({
    _source: DATA_SOURCE,
    _date: new Date().toISOString().slice(0, 10),
    _url: WB_DATA_URL,
    countries: Object.values(byIso3).map(r => ({ entidad: r.name, valor: r.pm25, anio: r.year, iso3: r.iso3 })),
  }, null, 2));
  console.log(`Saved raw intermediate to ${RAW_DIR}/wb-pm25-raw.json`);

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

  const seenAdmin = new Set();
  const dedup = [];
  for (const f of [...baseFeatures, ...extra]) {
    const a = f.properties.ADMIN;
    if (seenAdmin.has(a)) continue;
    seenAdmin.add(a);
    dedup.push(f);
  }

  const wbByNeName = {};
  for (const rec of Object.values(byIso3)) {
    const neName = NAME_TO_NE[rec.name];
    if (neName) wbByNeName[neName] = rec;
  }

  // Escala logarítmica sobre el rango real (1,6 → 107,8): 9 pasos mono.
  const values = Object.values(byIso3).map(r => r.pm25);
  const lo = Math.min(...values), hi = Math.max(...values);
  const ramp = buildMonoRamp(HUE, RAMP_STEPS);
  const colorForPM = v => {
    if (v == null || !isFinite(v)) return NO_DATA;
    const t = hi === lo ? 1 : (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
    const step = Math.max(0, Math.min(RAMP_STEPS - 1, Math.round(t * (RAMP_STEPS - 1))));
    return ramp[step];
  };

  const geo = { type: 'FeatureCollection', features: [] };
  const seenNames = new Set();
  const usedCodes = new Set();
  let matched = 0, sinDatos = 0;

  for (const raw of dedup) {
    const p = raw.properties;
    const admin = p.ADMIN;
    if (admin === 'Antarctica') continue;

    let rec = null;
    const iso3 = p.ISO_A3;
    if (iso3 && iso3 !== '-99' && byIso3[iso3]) rec = byIso3[iso3];
    if (!rec && p.ISO_A3_EH && byIso3[p.ISO_A3_EH]) rec = byIso3[p.ISO_A3_EH];
    if (!rec && wbByNeName[admin]) rec = wbByNeName[admin];
    if (!rec && ISO3_TO_NE) {
      for (const [code, neName] of Object.entries(ISO3_TO_NE)) {
        if (neName === admin && byIso3[code]) { rec = byIso3[code]; break; }
      }
    }
    if (!rec) {
      const norm = s => String(s).toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
      const nAdmin = norm(admin);
      for (const r of Object.values(byIso3)) {
        if (norm(r.name) === nAdmin) { rec = r; break; }
      }
    }

    const v = rec ? rec.pm25 : null;
    const dataYear = rec ? rec.year : null;
    if (rec) { matched++; usedCodes.add(rec.iso3); } else { sinDatos++; }

    let esName = p.NAME_ES;
    if (!esName || esName === '-99') esName = ADMIN_TO_ES[admin] || p.NAME || admin;
    const continente = CONTINENT_ES[p.CONTINENT] || p.CONTINENT || '—';

    let uniqueEs = esName;
    let dup = 1;
    while (seenNames.has(uniqueEs)) { dup++; uniqueEs = `${esName} (${dup})`; }
    seenNames.add(uniqueEs);

    const pmStr = v != null ? fmtPM(v) : 'Sin datos';
    const description = rec
      ? `${uniqueEs} — exposición media anual a PM2.5 de ${pmStr} µg/m³ (${dataYear}) — ${continente}`
      : `${uniqueEs} — sin datos de contaminación por PM2.5 — ${continente}`;

    geo.features.push({
      type: 'Feature',
      properties: {
        _manaName: uniqueEs, name: admin,
        _manaColor: colorForPM(v),
        _manaFillOpacity: v == null ? 0.45 : 0.85,
        _manaWeight: 0.7, _manaBorderColor: '#FFFFFF',
        _manaGroupName: GROUP_NAME, _manaGroupId: GROUP_ID,
        _manaLabelStyle: labelStyle(),
        'País': uniqueEs, 'País (EN)': admin, 'Continente': continente,
        'Exposición PM2.5 (µg/m³)': pmStr,
        [NUM_KEY]: v,
        'Año de datos': dataYear ? String(dataYear) : 'Sin datos',
        'Fuente': 'WHO Global Health Observatory / World Bank (2023)',
        'Description': description,
        'Superficie': continente,
        'Dato': v != null ? `PM2.5 ${pmStr} µg/m³ (${dataYear})` : 'Sin datos',
      },
      geometry: { type: raw.geometry.type, coordinates: roundCoords(raw.geometry.coordinates) },
    });
  }

  geo.features.sort((a, b) => (b.properties[NUM_KEY] || 0) - (a.properties[NUM_KEY] || 0));

  const huerfanos = Object.values(byIso3).filter(r => !usedCodes.has(r.iso3));
  if (huerfanos.length) {
    console.log(`Registros sin polígono (${huerfanos.length}): ${huerfanos.map(r => `${r.name} ${fmtPM(r.pm25)} (${r.year})`).join(' | ')}`);
  }

  const geojsonText = JSON.stringify(geo);
  console.log(`Features: ${geo.features.length} | matched: ${matched} | sin datos: ${sinDatos} | KB: ${(geojsonText.length / 1024).toFixed(1)}`);
  console.log(`Rango: ${fmtPM(lo)} — ${fmtPM(hi)} µg/m³ (último dato por país)`);

  // ── Validaciones (AGENTS.md §6 + §3) ──
  const hexOk = geo.features.every(f => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  const haloOk = geo.features.every(f => f.properties._manaLabelStyle && f.properties._manaLabelStyle.haloWidth >= 2 && f.properties._manaLabelStyle.enabled === true);
  let coordsOk = true;
  const walk = c => {
    if (typeof c[0] === 'number') {
      if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) coordsOk = false;
    } else c.forEach(walk);
  };
  geo.features.forEach(f => walk(f.geometry.coordinates));
  const names = new Set(geo.features.map(f => f.properties._manaName));
  const borderOk = geo.features.every(f => f.properties._manaBorderColor === '#FFFFFF');
  const withData = geo.features.filter(f => f.properties[NUM_KEY] != null).length;

  const pairs = geo.features
    .filter(f => f.properties[NUM_KEY] != null)
    .map(f => ({ v: Number(f.properties[NUM_KEY]), hex: f.properties._manaColor, l: hexToLum(f.properties._manaColor) }));
  const rho = spearmanRho(pairs.map(p => p.v), pairs.map(p => p.l));
  const span = hueSpanDegrees(pairs.map(p => hexToHue(p.hex)));

  console.log(`hex: ${hexOk} | halo: ${haloOk} | coords: ${coordsOk} | uniqueNames: ${names.size === geo.features.length} | whiteBorder: ${borderOk}`);
  console.log(`§3 rho(valor,luminancia)=${rho.toFixed(3)} (≤ -0.65 OK) | span tono=${span.toFixed(1)}° (≤ 60 OK) | con datos: ${withData}`);

  const ranked = geo.features
    .filter(f => f.properties[NUM_KEY] != null)
    .sort((a, b) => b.properties[NUM_KEY] - a.properties[NUM_KEY]);
  console.log(`Top 5: ${ranked.slice(0, 5).map(f => `${f.properties._manaName} ${fmtPM(f.properties[NUM_KEY])} (${f.properties['Año de datos']})`).join(' | ')}`);
  console.log(`Bottom 5: ${ranked.slice(-5).reverse().map(f => `${f.properties._manaName} ${fmtPM(f.properties[NUM_KEY])} (${f.properties['Año de datos']})`).join(' | ')}`);

  const ok = hexOk && haloOk && coordsOk && names.size === geo.features.length && borderOk &&
    rho <= -0.65 && span <= 60 && withData >= 150 && geojsonText.length <= 1048576;
  if (!ok) { console.error('VALIDATION FAILED'); process.exit(1); }

  if (!fs.existsSync(path.join(ROOT, 'data'))) fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.writeFileSync(OUT, geojsonText, 'utf8');
  console.log('OK →', OUT);
}

main().catch(e => { console.error('Fatal', e); process.exit(1); });
