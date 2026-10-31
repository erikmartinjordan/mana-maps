#!/usr/bin/env node
// ── gen-obesity-adults-world.js ─
// Genera data/maps/obesity-adults-world.geojson:
//   coropleta mundial «Obesidad adulta mundial por país».
//
// Datos: OMS — Global Health Observatory (2026), vía Our World in Data
//   (ourworldindata.org/grapher/share-of-adults-defined-as-obese): prevalencia
//   de obesidad en adultos (IMC ≥ 30 kg/m²), ambos sexos, 18+ años, estimación
//   bruta. Se usa el último año disponible por país (2024 para todos).
// Geometría: Natural Earth 110m + 50m (polígonos oficiales; los Estados y
//   territorios pequeños que no aparecen en 110m se toman de 50m cuando tienen
//   dato, como Samoa Americana, Islas Cook, Tonga, Nauru o Niue).
//
// Rampa §3 AGENTS.md: secuencial monocromática (tono 15°, naranja-rojo), 9
//   pasos, ordenada por el dato de claro→oscuro sobre escala lineal
//   (2,5 → 75,8 %). Borde blanco fino. Países sin dato: gris neutro.
//
// Uso: node scripts/maps/gen-obesity-adults-world.js
'use strict';
const https = require('https'), fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const RAW_DIR = path.join(ROOT, 'data', 'sources', 'obesity-adults-world');
const OUT = path.join(ROOT, 'data', 'maps', 'obesity-adults-world.geojson');

const OWID_CSV_URL = 'https://ourworldindata.org/grapher/share-of-adults-defined-as-obese.csv?csvType=full';
const OWID_META_URL = 'https://ourworldindata.org/grapher/share-of-adults-defined-as-obese.metadata.json';
const NE110_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
const NE50_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const DATA_SOURCE = 'OMS — Global Health Observatory (2026), vía Our World in Data (share-of-adults-defined-as-obese): prevalencia de obesidad en adultos (IMC ≥ 30 kg/m²), ambos sexos, 18+ años, estimación bruta, 2024. Geometrías: Natural Earth 110m/50m.';

const GROUP_NAME = 'Tasa de obesidad adulta';
const GROUP_ID = 'obesity';
const NUM_KEY = 'Tasa de obesidad adulta (num)';
const HUE = 15;           // naranja-rojo: riesgo sanitario; rampa mono §3
const RAMP_STEPS = 9;
const NO_DATA = '#d9d9d9';

// Fragmentos dependientes de Australia que Natural Earth etiqueta con ISO_A3
// australiano: no son países con dato propio y duplicarían Australia.
const SKIP_ADMIN = new Set(['Indian Ocean Territories', 'Ashmore and Cartier Islands']);

// Fallback de nombres en español para features sin NAME_ES útil.
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

// Nombres en español preferidos sobre NAME_ES de Natural Earth.
const NAME_ES_OVERRIDE = {
  'American Samoa': 'Samoa Americana',
  'W. Sahara': 'Sáhara Occidental',
};

// Natural Earth clasifica algunas islas como «Seven seas (open ocean)»; se
// asigna el continente real de su región de la ONU.
const CONTINENT_OVERRIDE_BY_ADMIN = {
  'Seychelles': 'África',
  'Mauritius': 'África',
  'Maldives': 'Asia',
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

// «41,8» — un decimal con coma decimal (es-ES)
const fmtPct = v => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');

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

// Parser CSV mínimo con soporte de campos entre comillas.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function norm(s) {
  return String(s).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Último valor por país; se descartan agregados (WHO_*, OWID_*) y valores nulos.
function loadOwidObesity(csvText) {
  const rows = parseCsv(csvText);
  const header = rows.shift() || [];
  const valueIdx = header.findIndex(h => /^Obesity among adults/i.test(h));
  if (valueIdx < 0) throw new Error('No se encontró la columna de obesidad en el CSV de OWID');
  const byIso3 = {};
  for (const r of rows) {
    const entity = r[0], code = r[1];
    if (!/^[A-Z]{3}$/.test(code || '')) continue;
    const value = Number(r[valueIdx]);
    const year = parseInt(r[2], 10);
    if (!isFinite(value) || !isFinite(year)) continue;
    if (!byIso3[code] || year > byIso3[code].year) {
      byIso3[code] = { name: entity, iso3: code, value: Math.round(value * 10) / 10, year };
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

function matchByIso(feature, byIso3) {
  const p = feature.properties || {};
  for (const key of ['ISO_A3', 'ISO_A3_EH']) {
    const code = p[key];
    if (code && code !== '-99' && byIso3[code]) return byIso3[code];
  }
  return null;
}

function matchByName(feature, byIso3) {
  const p = feature.properties || {};
  const names = [p.ADMIN, p.NAME, p.NAME_ES].filter(Boolean).map(norm);
  for (const rec of Object.values(byIso3)) {
    const candidate = norm(rec.name);
    if (names.includes(candidate)) return rec;
  }
  return null;
}

async function main() {
  console.log('Fetching Our World in Data — obesity among adults (WHO GHO)...');
  const csvText = await fetchText(OWID_CSV_URL);
  const meta = JSON.parse(await fetchText(OWID_META_URL));
  const { byIso3 } = loadOwidObesity(csvText);
  console.log(`Countries/territories with obesity data: ${Object.keys(byIso3).length}`);

  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(path.join(RAW_DIR, 'owid-obesity-raw.json'), JSON.stringify({
    _source: DATA_SOURCE,
    _date: new Date().toISOString().slice(0, 10),
    _url: OWID_CSV_URL,
    _lastUpdated: meta && meta.columns && Object.values(meta.columns)[0] && Object.values(meta.columns)[0].lastUpdated,
    entities: Object.values(byIso3)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(r => ({ entidad: r.name, valor: r.value, anio: r.year, iso3: r.iso3 })),
  }, null, 2));
  console.log(`Saved raw intermediate to ${RAW_DIR}/owid-obesity-raw.json`);

  console.log('Fetching Natural Earth 110m + 50m...');
  const ne110 = JSON.parse(await fetchText(NE110_URL));
  const ne50 = JSON.parse(await fetchText(NE50_URL));

  const baseFeatures = ne110.features.filter(f => f.properties.ADMIN !== 'Antarctica');
  const baseAdmins = new Set(baseFeatures.map(f => f.properties.ADMIN));

  // Territorios pequeños con dato propio que no están en 110m: se añaden
  // desde 50m (p. ej. Samoa Americana, Islas Cook, Tonga, Nauru, Niue).
  const extra = [];
  for (const f of ne50.features) {
    const admin = f.properties.ADMIN;
    if (admin === 'Antarctica' || baseAdmins.has(admin) || SKIP_ADMIN.has(admin)) continue;
    if (!matchByIso(f, byIso3)) continue;
    extra.push({ type: 'Feature', properties: f.properties, geometry: JSON.parse(JSON.stringify(f.geometry)) });
    baseAdmins.add(admin);
  }
  console.log(`Base 110m: ${baseFeatures.length}, extra 50m con dato: ${extra.length}`);

  const dedup = [];
  const seenAdmins = new Set();
  for (const f of [...baseFeatures, ...extra]) {
    const a = f.properties.ADMIN;
    if (seenAdmins.has(a)) continue;
    seenAdmins.add(a);
    dedup.push(f);
  }

  // Rampa lineal sobre el rango real del dato (2,5 → 75,8): 9 pasos mono.
  const values = Object.values(byIso3).map(r => r.value);
  const lo = Math.min(...values), hi = Math.max(...values);
  const ramp = buildMonoRamp(HUE, RAMP_STEPS);
  const colorForRate = v => {
    if (v == null || !isFinite(v)) return NO_DATA;
    const t = hi === lo ? 1 : (v - lo) / (hi - lo);
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

    const rec = matchByIso(raw, byIso3) || matchByName(raw, byIso3);
    const v = rec ? rec.value : null;
    const dataYear = rec ? rec.year : null;
    if (rec) { matched++; usedCodes.add(rec.iso3); } else { sinDatos++; }

    let esName = NAME_ES_OVERRIDE[admin] || p.NAME_ES;
    if (!esName || esName === '-99') esName = ADMIN_TO_ES[admin] || p.NAME || admin;
    const continente = CONTINENT_OVERRIDE_BY_ADMIN[admin] || CONTINENT_ES[p.CONTINENT] || p.CONTINENT || '—';

    let uniqueEs = esName;
    let dup = 1;
    while (seenNames.has(uniqueEs)) { dup++; uniqueEs = `${esName} (${dup})`; }
    seenNames.add(uniqueEs);

    const rateStr = v != null ? fmtPct(v) : 'Sin datos';
    const description = rec
      ? `${uniqueEs} — ${rateStr} % de adultos con obesidad (IMC ≥ 30 kg/m²) en ${dataYear} — ${continente}`
      : `${uniqueEs} — sin datos de obesidad adulta — ${continente}`;

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
        'Tasa de obesidad adulta': v != null ? `${rateStr} %` : 'Sin datos',
        [NUM_KEY]: v,
        'Año de datos': dataYear ? String(dataYear) : 'Sin datos',
        'Fuente': 'OMS — Global Health Observatory (2026), vía Our World in Data',
        'Description': description,
        'Superficie': continente,
        'Dato': v != null ? `${rateStr} % de adultos con obesidad (${dataYear})` : 'Sin datos',
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
