#!/usr/bin/env node
// ── gen-alcohol-consumption-world.js ─
// Genera data/maps/alcohol-consumption-world.geojson:
//   coropleta mundial «Consumo de alcohol per cápita por país».
//
// Datos: OMS — Global Health Observatory, indicador SA_0000001688
//   («Alcohol, total per capita (15+) consumption (in litres of pure alcohol)
//   (SDG Indicator 3.5.2), three-year average»): litros de alcohol puro por
//   persona de 15 años o más y año. Se usa el último año disponible de la
//   serie (2024; la OMS mantiene el valor de 2023 en el año de cierre).
//   La API se descarga en la ejecución y se guarda un intermedio recortado en
//   autopilot/strategy/data/alcohol-consumption-world/.
// Geometría: Natural Earth 110m + 50m (polígonos oficiales, mismo patrón que
//   inflation-world; microestados desde 50m).
//
// Rampa §3 AGENTS.md: secuencial monocromática (tono 315°, rosado-vino), 9
//   pasos, ordenada por el dato de claro→oscuro. La distribución está sesgada
//   (mediana ≈ 4 litros, máximos > 17 y una decena de países con 0), así que
//   los pasos se asignan por cuantiles para que la rampa siga siendo
//   estrictamente monótona en el dato sin aplastar el rango bajo.
//   Borde blanco fino. Países sin dato: gris neutro.
//
// Uso: node scripts/maps/gen-alcohol-consumption-world.js
'use strict';
const https = require('https'), fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const RAW_DIR = path.join(ROOT, 'autopilot', 'strategy', 'data', 'alcohol-consumption-world');
const OUT = path.join(ROOT, 'data', 'maps', 'alcohol-consumption-world.geojson');

const WHO_URL = 'https://ghoapi.azureedge.net/api/SA_0000001688';
const WHO_INDICATOR = 'SA_0000001688';
const DATA_SOURCE = 'OMS — Global Health Observatory (SA_0000001688, ODS 3.5.2): consumo total de alcohol per cápita (15+ años) en litros de alcohol puro, media trienal; último año publicado 2024 (repite el valor de 2023). Geometrías: Natural Earth 110m/50m.';

const GROUP_NAME = 'Consumo de alcohol';
const GROUP_ID = 'alcohol-consumption';
const NUM_KEY = 'Consumo de alcohol (num)';
const HUE = 315;          // rosado-vino: bebida alcohólica; rampa mono §3
const RAMP_STEPS = 9;
const NO_DATA = '#d9d9d9';

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

// «0,0» / «17,1» — coma decimal es-ES, un decimal.
const fmtL = v => v.toFixed(1).replace('.', ',');

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

// Último valor publicado por país (SpatialDimType COUNTRY, ambos sexos).
function loadWhoAlcohol(rows) {
  const byIso3 = {};
  let latestYear = 0;
  for (const row of rows) {
    if (!row || row.SpatialDimType !== 'COUNTRY') continue;
    if (row.Dim1 !== 'SEX_BTSX') continue;
    const code = row.SpatialDim;
    if (!code || row.NumericValue == null) continue;
    const year = parseInt(row.TimeDim, 10);
    if (!isFinite(year)) continue;
    const value = Math.round(Number(row.NumericValue) * 100) / 100;
    if (!isFinite(value)) continue;
    if (!byIso3[code] || year > byIso3[code].year) {
      byIso3[code] = { iso3: code, value, year };
    }
    if (year > latestYear) latestYear = year;
  }
  return { byIso3, latestYear };
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

// Umbrales por cuantiles para una rampa monótona con datos asimétricos.
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
  console.log('Fetching WHO GHO SA_0000001688 (consumo de alcohol per cápita)...');
  const whoJson = JSON.parse(await fetchText(WHO_URL));
  const { byIso3, latestYear } = loadWhoAlcohol(whoJson.value || []);
  console.log(`Countries with alcohol data: ${Object.keys(byIso3).length} (latest year ${latestYear})`);

  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(path.join(RAW_DIR, 'who-alcohol-raw.json'), JSON.stringify({
    _source: DATA_SOURCE,
    _indicator: WHO_INDICATOR,
    _url: WHO_URL,
    _date: new Date().toISOString().slice(0, 10),
    _lastUpdated: whoJson.value && whoJson.value[0] && whoJson.value[0].Date,
    countries: Object.values(byIso3)
      .sort((a, b) => a.iso3.localeCompare(b.iso3))
      .map(r => ({ iso3: r.iso3, valor: r.value, anio: r.year })),
  }, null, 2));
  console.log(`Saved raw intermediate to ${RAW_DIR}/who-alcohol-raw.json`);

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

  // Rampa mono por cuantiles sobre el dato.
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
  let matched = 0, sinDatos = 0;

  for (const raw of dedup) {
    const p = raw.properties;
    const admin = p.ADMIN;
    if (admin === 'Antarctica') continue;

    let rec = null;
    for (const key of ['ISO_A3', 'ISO_A3_EH', 'ADM0_A3']) {
      const code = p[key];
      if (code && code !== '-99' && byIso3[code]) { rec = byIso3[code]; break; }
    }
    const v = rec ? rec.value : null;
    const dataYear = rec ? rec.year : null;
    if (rec) { matched++; usedCodes.add(rec.iso3); } else { sinDatos++; }

    let esName = p.NAME_ES;
    if (!esName || esName === '-99') esName = ADMIN_TO_ES[admin] || p.NAME || admin;
    const continente = CONTINENT_ES[p.CONTINENT] || p.CONTINENT || '—';

    let uniqueEs = esName;
    let dup = 1;
    while (seenNames.has(uniqueEs)) { dup++; uniqueEs = `${esName} (${dup})`; }
    seenNames.add(uniqueEs);

    const rateStr = v != null ? fmtL(v) : 'Sin datos';
    const description = rec
      ? `${uniqueEs} — ${rateStr} litros de alcohol puro per cápita al año (15+ años, ${dataYear}) — ${continente}`
      : `${uniqueEs} — sin datos de consumo de alcohol — ${continente}`;

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
        'Consumo de alcohol': v != null ? `${rateStr} litros` : 'Sin datos',
        [NUM_KEY]: v,
        'Año de datos': dataYear ? String(dataYear) : 'Sin datos',
        'Fuente': 'OMS — Global Health Observatory (SA_0000001688, ODS 3.5.2)',
        'Description': description,
        'Superficie': continente,
        'Dato': v != null ? `${rateStr} litros de alcohol puro per cápita al año (15+ años, ${dataYear})` : 'Sin datos',
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

  // Registros de datos sin polígono: se reportan (territorios sin geometría NE).
  const huerfanos = Object.values(byIso3).filter(r => !usedCodes.has(r.iso3));
  if (huerfanos.length) {
    console.log(`Registros sin polígono (${huerfanos.length}): ${huerfanos.map(r => `${r.iso3} ${fmtL(r.value)}`).join(' | ')}`);
  }

  const geojsonText = JSON.stringify(geo);
  console.log(`Features: ${geo.features.length} | matched: ${matched} | sin datos: ${sinDatos} | KB: ${(geojsonText.length / 1024).toFixed(1)}`);
  console.log(`Rango: ${fmtL(lo)} — ${fmtL(hi)} litros (último dato por país)`);

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
  console.log(`Top 5: ${ranked.slice(0, 5).map(f => `${f.properties._manaName} ${fmtL(f.properties[NUM_KEY])}`).join(' | ')}`);
  console.log(`Bottom 5: ${ranked.slice(-5).reverse().map(f => `${f.properties._manaName} ${fmtL(f.properties[NUM_KEY])}`).join(' | ')}`);

  const ok = hexOk && haloOk && coordsOk && names.size === geo.features.length && borderOk &&
    rho <= -0.65 && span <= 60 && withData >= 150 && geojsonText.length <= 1048576;
  if (!ok) { console.error('VALIDATION FAILED'); process.exit(1); }

  if (!fs.existsSync(path.join(ROOT, 'data', 'maps'))) fs.mkdirSync(path.join(ROOT, 'data', 'maps'), { recursive: true });
  fs.writeFileSync(OUT, geojsonText, 'utf8');
  console.log('OK →', OUT);
}

main().catch(e => { console.error('Fatal', e); process.exit(1); });
