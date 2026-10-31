#!/usr/bin/env node
// ── gen-inflation-world.js ─
// Genera data/maps/inflation-world.geojson:
//   coropleta mundial «Inflación anual por país».
//
// Datos: Banco Mundial — World Development Indicators, indicador
//   FP.CPI.TOTL.ZG («Inflation, consumer prices (annual %)»): variación
//   porcentual anual del índice de precios al consumidor. Se usa el último año
//   disponible por país (2025 para 169 de los 193 países con dato; 2011–2024
//   para los demás). La API se descarga en la ejecución y se guarda un
//   intermedio recortado en data/sources/inflation-world/.
// Geometría: Natural Earth 110m + 50m (polígonos oficiales, mismo patrón que
//   unemployment-world; microestados desde 50m).
//
// Rampa §3 AGENTS.md: secuencial monocromática (tono 355°, rojo), 9 pasos,
//   ordenada por el dato de claro→oscuro. La distribución de la inflación está
//   muy sesgada (mediana ≈ 3 %, máximos > 250 % y varios países con deflación),
//   así que los pasos se asignan por cuantiles: cada color agrupa ~1/9 de los
//   países y la rampa sigue siendo estrictamente monótona en el dato.
//   Borde blanco fino. Países sin dato: gris neutro.
//
// Uso: node scripts/maps/gen-inflation-world.js
'use strict';
const https = require('https'), fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const RAW_DIR = path.join(ROOT, 'data', 'sources', 'inflation-world');
const OUT = path.join(ROOT, 'data', 'maps', 'inflation-world.geojson');

const WB_INDICATOR_URL = 'https://api.worldbank.org/v2/country/all/indicator/FP.CPI.TOTL.ZG?format=json&per_page=20000';
const WB_COUNTRIES_URL = 'https://api.worldbank.org/v2/country?format=json&per_page=400';
const DATA_SOURCE = 'Banco Mundial — World Development Indicators (FP.CPI.TOTL.ZG): inflación, precios al consumidor (% anual), último año disponible por país. Banco Mundial actualizado el 2026-10-08. Geometrías: Natural Earth 110m/50m.';

const GROUP_NAME = 'Inflación anual';
const GROUP_ID = 'inflation';
const NUM_KEY = 'Inflación anual (num)';
const HUE = 355;          // rojo: subida de precios; rampa mono §3
const RAMP_STEPS = 9;
const NO_DATA = '#d9d9d9';

// Nombres del Banco Mundial → nombres de Natural Earth (fallback si falla ISO3)
const NAME_TO_NE = {
  'Egypt, Arab Rep.': 'Egypt',
  'Congo, Rep.': 'Republic of the Congo',
  'Congo, Dem. Rep.': 'Democratic Republic of the Congo',
  'Gambia, The': 'Gambia',
  'Iran, Islamic Rep.': 'Iran',
  'Korea, Rep.': 'South Korea',
  "Korea, Dem. People's Rep.": 'North Korea',
  'Lao PDR': 'Laos',
  'Russian Federation': 'Russia',
  'Slovak Republic': 'Slovakia',
  'Syrian Arab Republic': 'Syria',
  'Turkiye': 'Turkey',
  'Venezuela, RB': 'Venezuela',
  'Viet Nam': 'Vietnam',
  'Yemen, Rep.': 'Yemen',
  'Bahamas, The': 'The Bahamas',
  'Brunei Darussalam': 'Brunei',
  'Cabo Verde': 'Cape Verde',
  "Cote d'Ivoire": 'Ivory Coast',
  "Côte d'Ivoire": 'Ivory Coast',
  'Czechia': 'Czech Republic',
  'Eswatini': 'eSwatini',
  'Micronesia, Fed. Sts.': 'Federated States of Micronesia',
  'St. Kitts and Nevis': 'Saint Kitts and Nevis',
  'St. Lucia': 'Saint Lucia',
  'St. Vincent and the Grenadines': 'Saint Vincent and the Grenadines',
  'Kyrgyz Republic': 'Kyrgyzstan',
  'North Macedonia': 'Macedonia',
  'Timor-Leste': 'East Timor',
  'Sao Tome and Principe': 'São Tomé and Príncipe',
  'West Bank and Gaza': 'West Bank',
};

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
  'Vatican': 'Ciudad del Vaticano',
  'Monaco': 'Mónaco',
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
    ramp.push(hslToHex(hue, 48 + t * 28, 92 - t * 72)); // l 92%→20%, s 48%→76%
  }
  return ramp;
}

// «2,7» / «254,95» — coma decimal es-ES; dos decimales para valores pequeños.
const fmtPct = v => {
  const d = Math.abs(v) < 10 ? 2 : 1;
  return v.toFixed(d).replace('.', ',');
};

function labelStyle() {
  return {
    enabled: true, fontSize: 11, fontFamily: 'DM Sans, sans-serif',
    fontWeight: '600', color: '#1e293b', haloWidth: 3, haloColor: '#FFFFFF',
    placement: 'point', field: '_manaName',
  };
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

function norm(s) {
  return String(s).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Último valor por país. Solo economías reales (la lista /country excluye los
// agregados regionales, que tienen region.id === 'NA').
function loadWbInflation(indicatorJson, countriesJson) {
  const indicator = indicatorJson[1] || [];
  const countries = countriesJson[1] || [];
  const economies = new Map();
  for (const c of countries) {
    if (c && c.id && c.region && c.region.id && c.region.id !== 'NA') {
      economies.set(c.id, c.name);
    }
  }
  const byIso3 = {};
  for (const row of indicator) {
    const code = row && row.countryiso3code;
    if (!code || !economies.has(code)) continue;
    if (row.value == null) continue;
    const year = parseInt(row.date, 10);
    if (!isFinite(year)) continue;
    const value = Math.round(Number(row.value) * 100) / 100;
    if (!isFinite(value)) continue;
    if (!byIso3[code] || year > byIso3[code].year) {
      byIso3[code] = { name: economies.get(code), iso3: code, value, year };
    }
  }
  return { byIso3 };
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

// Umbrales por cuantiles para una rampa monótona con datos muy asimétricos.
function quantileThresholds(values, steps) {
  const sorted = values.slice().sort((a, b) => a - b);
  const out = [];
  for (let i = 1; i < steps; i++) {
    const pos = (sorted.length - 1) * (i / steps);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    out.push(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
  }
  return out;
}

async function main() {
  console.log('Fetching World Bank FP.CPI.TOTL.ZG (inflación, precios al consumidor)...');
  const indicatorJson = JSON.parse(await fetchText(WB_INDICATOR_URL));
  console.log('Fetching World Bank country list (para excluir agregados)...');
  const countriesJson = JSON.parse(await fetchText(WB_COUNTRIES_URL));
  const { byIso3 } = loadWbInflation(indicatorJson, countriesJson);
  console.log(`Countries with inflation data: ${Object.keys(byIso3).length}`);

  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(path.join(RAW_DIR, 'wb-inflation-raw.json'), JSON.stringify({
    _source: DATA_SOURCE,
    _date: new Date().toISOString().slice(0, 10),
    _url: WB_INDICATOR_URL,
    _lastUpdated: indicatorJson[0] && indicatorJson[0].lastupdated,
    countries: Object.values(byIso3)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(r => ({ entidad: r.name, valor: r.value, anio: r.year, iso3: r.iso3 })),
  }, null, 2));
  console.log(`Saved raw intermediate to ${RAW_DIR}/wb-inflation-raw.json`);

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

  const seen = new Set();
  const dedup = [];
  for (const f of [...baseFeatures, ...extra]) {
    const a = f.properties.ADMIN;
    if (seen.has(a)) continue;
    seen.add(a);
    dedup.push(f);
  }

  const neByIso = {};
  for (const rec of Object.values(byIso3)) {
    const neName = NAME_TO_NE[rec.name];
    if (neName) neByIso[neName] = rec;
  }

  // Rampa mono por cuantiles sobre el dato (distribución muy asimétrica).
  const values = Object.values(byIso3).map(r => r.value);
  const lo = Math.min(...values), hi = Math.max(...values);
  const ramp = buildMonoRamp(HUE, RAMP_STEPS);
  const thresholds = quantileThresholds(values, RAMP_STEPS);
  const colorForRate = v => {
    if (v == null || !isFinite(v)) return NO_DATA;
    let idx = 0;
    while (idx < thresholds.length && v >= thresholds[idx]) idx++;
    return ramp[Math.min(RAMP_STEPS - 1, idx)];
  };

  const geo = { type: 'FeatureCollection', features: [] };
  const seenNames = new Set();
  const usedCodes = new Set();
  let matched = 0, unmatched = 0, sinDatos = 0;

  for (const raw of dedup) {
    const p = raw.properties;
    const admin = p.ADMIN;
    if (admin === 'Antarctica') continue;

    let rec = null;
    for (const key of ['ISO_A3', 'ISO_A3_EH', 'ADM0_A3']) {
      const code = p[key];
      if (code && code !== '-99' && byIso3[code]) { rec = byIso3[code]; break; }
    }
    if (!rec && neByIso[admin]) rec = neByIso[admin];
    // Último recurso: igualdad exacta de nombres normalizados.
    if (!rec) {
      const nAdmin = norm(admin);
      for (const r of Object.values(byIso3)) {
        const target = NAME_TO_NE[r.name] || r.name;
        if (norm(target) === nAdmin || norm(r.name) === nAdmin) { rec = r; break; }
      }
    }

    const v = rec ? rec.value : null;
    const dataYear = rec ? rec.year : null;
    if (rec) { matched++; usedCodes.add(rec.iso3); } else { unmatched++; sinDatos++; }

    let esName = p.NAME_ES;
    if (!esName || esName === '-99') esName = ADMIN_TO_ES[admin] || p.NAME || admin;
    const continente = CONTINENT_ES[p.CONTINENT] || p.CONTINENT || '—';

    let uniqueEs = esName;
    let dup = 1;
    while (seenNames.has(uniqueEs)) { dup++; uniqueEs = `${esName} (${dup})`; }
    seenNames.add(uniqueEs);

    const rateStr = v != null ? fmtPct(v) : 'Sin datos';
    const description = rec
      ? `${uniqueEs} — inflación anual del ${rateStr} % (${dataYear}) — ${continente}`
      : `${uniqueEs} — sin datos de inflación — ${continente}`;

    geo.features.push({
      type: 'Feature',
      properties: {
        _manaName: uniqueEs, name: admin,
        _manaColor: colorForRate(v),
        _manaFillOpacity: v == null ? 0.5 : 0.82,
        _manaWeight: 0.7, _manaBorderColor: '#FFFFFF',
        _manaGroupName: GROUP_NAME, _manaGroupId: GROUP_ID,
        _manaLabelStyle: labelStyle(),
        'País': uniqueEs, 'País (EN)': admin, 'Continente': continente,
        'Inflación anual': v != null ? `${rateStr} %` : 'Sin datos',
        [NUM_KEY]: v,
        'Año de datos': dataYear ? String(dataYear) : 'Sin datos',
        'Fuente': 'Banco Mundial — WDI (FP.CPI.TOTL.ZG)',
        'Description': description,
        'Superficie': continente,
        'Dato': v != null ? `${rateStr} % de variación anual del IPC (${dataYear})` : 'Sin datos',
      },
      geometry: { type: raw.geometry.type, coordinates: roundCoords(raw.geometry.coordinates) },
    });
  }

  const hasValue = f => {
    const v = f.properties[NUM_KEY];
    return v != null && Number.isFinite(Number(v));
  };
  geo.features.sort((a, b) => {
    const va = Number(a.properties[NUM_KEY]), vb = Number(b.properties[NUM_KEY]);
    const aOk = hasValue(a), bOk = hasValue(b);
    if (aOk && bOk) return vb - va;
    if (aOk) return -1;
    if (bOk) return 1;
    return 0;
  });

  // Registros de datos sin polígono: se reportan (p. ej. Hong Kong, Guam).
  const huerfanos = Object.values(byIso3).filter(r => !usedCodes.has(r.iso3));
  if (huerfanos.length) {
    console.log(`Registros sin polígono (${huerfanos.length}): ${huerfanos.map(r => `${r.name} ${fmtPct(r.value)} (${r.year})`).join(' | ')}`);
  }

  const geojsonText = JSON.stringify(geo);
  console.log(`Features: ${geo.features.length} | matched: ${matched} | sin datos: ${sinDatos} | KB: ${(geojsonText.length / 1024).toFixed(1)}`);
  console.log(`Rango: ${fmtPct(lo)} — ${fmtPct(hi)} % (último dato por país)`);

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
  const withData = geo.features.filter(hasValue).length;

  const pairs = geo.features
    .filter(hasValue)
    .map(f => ({ v: Number(f.properties[NUM_KEY]), hex: f.properties._manaColor, l: hexToLum(f.properties._manaColor) }));
  const rho = spearmanRho(pairs.map(p => p.v), pairs.map(p => p.l));
  const span = hueSpanDegrees(pairs.map(p => hexToHue(p.hex)));

  console.log(`hex: ${hexOk} | halo: ${haloOk} | coords: ${coordsOk} | uniqueNames: ${names.size === geo.features.length} | whiteBorder: ${borderOk}`);
  console.log(`§3 rho(valor,luminancia)=${rho.toFixed(3)} (≤ -0.65 OK) | span tono=${span.toFixed(1)}° (≤ 60 OK) | con datos: ${withData}`);

  const ranked = geo.features
    .filter(hasValue)
    .sort((a, b) => b.properties[NUM_KEY] - a.properties[NUM_KEY]);
  console.log(`Top 5: ${ranked.slice(0, 5).map(f => `${f.properties._manaName} ${fmtPct(f.properties[NUM_KEY])} (${f.properties['Año de datos']})`).join(' | ')}`);
  console.log(`Bottom 5: ${ranked.slice(-5).reverse().map(f => `${f.properties._manaName} ${fmtPct(f.properties[NUM_KEY])} (${f.properties['Año de datos']})`).join(' | ')}`);

  const ok = hexOk && haloOk && coordsOk && names.size === geo.features.length && borderOk &&
    rho <= -0.65 && span <= 60 && withData >= 150 && geojsonText.length <= 1048576;
  if (!ok) { console.error('VALIDATION FAILED'); process.exit(1); }

  if (!fs.existsSync(path.join(ROOT, 'data', 'maps'))) fs.mkdirSync(path.join(ROOT, 'data', 'maps'), { recursive: true });
  fs.writeFileSync(OUT, geojsonText, 'utf8');
  console.log('OK →', OUT);
}

main().catch(e => { console.error('Fatal', e); process.exit(1); });
