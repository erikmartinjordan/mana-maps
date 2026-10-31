#!/usr/bin/env node
// ── gen-meat-consumption-world.js ─
// Genera data/maps/meat-consumption-world.geojson:
//   coropleta mundial «Consumo de carne per cápita por país».
//
// Datos: FAO — Food Balances (2025), vía Our World in Data
//   (ourworldindata.org/grapher/meat-supply-per-person, descargado en la
//   ejecución). Mide el suministro de carne disponible para consumo en
//   kilogramos por persona y año; excluye pescado y marisco y no corrige el
//   desperdicio doméstico, por lo que es una aproximación al consumo.
//   Último dato disponible por país: 176 países en 2023, 11 en 2022 y casos
//   aislados anteriores (Cuba 2019, Corea del Norte 2018).
// Geometría: data/maps/population-by-country.geojson (205 países y territorios con
//   polígonos Natural Earth ya validados en la galería).
//
// Rampa §3 AGENTS.md: secuencial monocromática (tono 12°, terracota), 9 pasos,
//   ordenada por el dato de claro→oscuro sobre escala lineal (3,5 → 156,9 kg).
//   Borde blanco fino. Países sin dato: gris neutro.
//
// Uso: node scripts/maps/gen-meat-consumption-world.js
'use strict';
const https = require('https'), fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const RAW_DIR = path.join(ROOT, 'data', 'sources', 'meat-consumption-world');
const SRC_BASE = path.join(ROOT, 'data', 'maps', 'population-by-country.geojson');
const OUT = path.join(ROOT, 'data', 'maps', 'meat-consumption-world.geojson');

const OWID_CSV_URL = 'https://ourworldindata.org/grapher/meat-supply-per-person.csv?csvType=full';
const DATA_SOURCE = 'FAO — Food Balances (2025), vía Our World in Data (ourworldindata.org/grapher/meat-supply-per-person): suministro de carne disponible para consumo, kg por persona y año; excluye pescado y no corrige el desperdicio doméstico. Geometrías: Natural Earth, vía population-by-country.';

const GROUP_NAME = 'Consumo de carne';
const GROUP_ID = 'meat-consumption';
const NUM_KEY = 'Consumo de carne (num)';
const HUE = 12;          // terracota: carne/alimentación; rampa mono §3
const RAMP_STEPS = 9;
const NO_DATA = '#d9d9d9';

// Nombres OWID (inglés) → nombre exacto de la base (ES o EN).
const OWID_TO_BASE = {
  'United States': 'United States of America',
  'Cape Verde': 'Cabo Verde',
  'Congo': 'Republic of the Congo',
  'Democratic Republic of Congo': 'Democratic Republic of the Congo',
  'Micronesia (country)': 'Federated States of Micronesia',
  'Türkiye': 'Turkey',
  'Cote d\'Ivoire': 'Ivory Coast',
  "Côte d'Ivoire": 'Ivory Coast',
  'Eswatini': 'Swaziland',
  'Timor-Leste': 'East Timor',
  'North Macedonia': 'Macedonia',
  'The Bahamas': 'Bahamas',
  'United Republic of Tanzania': 'Tanzania',
  'Republic of Serbia': 'Serbia',
  'Sao Tome and Principe': 'São Tomé and Príncipe',
};

function norm(s) {
  return String(s).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

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

// «156,9» — un decimal con coma decimal (es-ES)
const fmtKg = v => (Math.round(v * 10) / 10).toLocaleString('es-ES', {
  minimumFractionDigits: 1, maximumFractionDigits: 1,
});

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

// Último valor por país. Se descartan agregados (World, continentes, FAO…).
function loadOwidMeat(text) {
  const rows = parseCsv(text);
  const idx = {};
  rows[0].forEach((h, i) => { idx[h] = i; });
  const byName = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const entity = (row[idx.Entity] || '').trim();
    const code = (row[idx.Code] || '').trim();
    const year = parseInt(row[idx.Year], 10);
    const raw = row[idx['Per capita consumption of meat']];
    if (!entity || !code || !isFinite(year) || raw == null || raw === '') continue;
    // Códigos OWID_/WB_ son regiones agregadas (salvo Kosovo si apareciera).
    if (code.startsWith('OWID_') && code !== 'OWID_KOS') continue;
    if (code.startsWith('WB_')) continue;
    const v = parseFloat(raw);
    if (!isFinite(v)) continue;
    if (!byName[entity] || year > byName[entity].year) {
      byName[entity] = { name: entity, iso3: code, value: Math.round(v * 10) / 10, year };
    }
  }
  return { byName };
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
  if (!fs.existsSync(SRC_BASE)) { console.error('ERROR: falta', SRC_BASE); process.exit(1); }
  const base = JSON.parse(fs.readFileSync(SRC_BASE, 'utf8'));

  console.log('Fetching OWID meat supply CSV (FAO Food Balances)...');
  const csvText = await fetchText(OWID_CSV_URL);
  const { byName } = loadOwidMeat(csvText);
  console.log(`Countries with meat data: ${Object.keys(byName).length}`);

  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(path.join(RAW_DIR, 'owid-meat-raw.json'), JSON.stringify({
    _source: DATA_SOURCE,
    _date: new Date().toISOString().slice(0, 10),
    _url: OWID_CSV_URL,
    countries: Object.values(byName).map(r => ({ entidad: r.name, valor: r.value, anio: r.year, iso3: r.iso3 })),
  }, null, 2));
  console.log(`Saved raw intermediate to ${RAW_DIR}/owid-meat-raw.json`);

  const byNorm = new Map();
  for (const f of base.features) {
    const p = f.properties || {};
    if (p['País (EN)']) byNorm.set(norm(p['País (EN)']), f);
    if (p['País']) byNorm.set(norm(p['País']), f);
  }

  const values = Object.values(byName).map(r => r.value);
  const lo = Math.min(...values), hi = Math.max(...values);
  const ramp = buildMonoRamp(HUE, RAMP_STEPS);
  const colorFor = v => {
    if (v == null || !isFinite(v)) return NO_DATA;
    const t = hi === lo ? 1 : (v - lo) / (hi - lo);
    const step = Math.max(0, Math.min(RAMP_STEPS - 1, Math.round(t * (RAMP_STEPS - 1))));
    return ramp[step];
  };

  const features = [];
  const usedNames = new Set();
  let matched = 0, sinDatos = 0;

  for (const f of base.features) {
    const p = f.properties || {};
    const es = p['País'], en = p['País (EN)'] || es, continente = p['Continente'] || '—';
    const rec = byName[en] || byName[es] ||
      (OWID_TO_BASE[en] && byName[OWID_TO_BASE[en]]) ||
      (OWID_TO_BASE[es] && byName[OWID_TO_BASE[es]]) ||
      null;

    // Búsqueda normalizada (acentos/mayúsculas) como último recurso.
    let found = rec;
    if (!found) {
      for (const r of Object.values(byName)) {
        const alias = OWID_TO_BASE[r.name];
        if (norm(r.name) === norm(en) || norm(r.name) === norm(es) ||
            (alias && (norm(alias) === norm(en) || norm(alias) === norm(es)))) {
          found = r; break;
        }
      }
    }

    const v = found ? found.value : null;
    const dataYear = found ? found.year : null;
    if (found) { matched++; usedNames.add(found.name); } else { sinDatos++; }

    let uniqueEs = es;
    let dup = 1;
    while (usedNames.has(`__feature__${uniqueEs}`)) { dup++; uniqueEs = `${es} (${dup})`; }
    usedNames.add(`__feature__${uniqueEs}`);

    const kgStr = v != null ? fmtKg(v) : 'Sin datos';
    const props = {
      _manaName: uniqueEs, name: en,
      _manaColor: colorFor(v),
      _manaFillOpacity: v == null ? 0.5 : 0.82,
      _manaWeight: 0.7, _manaBorderColor: '#FFFFFF',
      _manaGroupName: GROUP_NAME, _manaGroupId: GROUP_ID,
      _manaLabelStyle: labelStyle(),
      'País': uniqueEs, 'País (EN)': en, 'Continente': continente,
      'Consumo de carne': v != null ? `${kgStr} kg/persona/año` : 'Sin datos',
      [NUM_KEY]: v != null ? v : 'Sin datos',
      'Año de datos': dataYear ? String(dataYear) : 'Sin datos',
      'Fuente': v != null
        ? 'FAO — Food Balances (2025), vía Our World in Data'
        : 'Sin dato reciente en FAOSTAT',
      'Description': v != null
        ? `${uniqueEs} — ${kgStr} kg de carne por persona y año (${dataYear}) — ${continente}`
        : `${uniqueEs} — sin datos de consumo de carne — ${continente}`,
      'Superficie': continente,
      'Dato': v != null ? `${kgStr} kg/persona/año (${dataYear})` : 'Sin datos',
    };
    features.push({ type: 'Feature', properties: props, geometry: f.geometry });
  }

  // Registros de datos sin polígono en la base (Bermuda, Hong Kong, Macao…).
  const orphans = Object.values(byName).filter(r => !usedNames.has(r.name));
  if (orphans.length) {
    console.log(`Registros sin polígono (${orphans.length}): ${orphans.map(r => `${r.name} ${fmtKg(r.value)} (${r.year})`).join(' | ')}`);
  }

  features.sort((a, b) => {
    const va = Number(a.properties[NUM_KEY]), vb = Number(b.properties[NUM_KEY]);
    const aOk = Number.isFinite(va), bOk = Number.isFinite(vb);
    if (aOk && bOk) return vb - va;
    if (aOk) return -1;
    if (bOk) return 1;
    return 0;
  });

  const geo = { type: 'FeatureCollection', features };
  const geojsonText = JSON.stringify(geo);

  // ── Validaciones (AGENTS.md §6 + §3) ──
  const hexOk = features.every(f => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  const haloOk = features.every(f => f.properties._manaLabelStyle && f.properties._manaLabelStyle.haloWidth >= 2 && f.properties._manaLabelStyle.enabled === true);
  let coordsOk = true;
  const walk = c => {
    if (typeof c[0] === 'number') {
      if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) coordsOk = false;
    } else c.forEach(walk);
  };
  features.forEach(f => walk(f.geometry.coordinates));
  const names = new Set(features.map(f => f.properties._manaName));
  const borderOk = features.every(f => f.properties._manaBorderColor === '#FFFFFF');
  const withData = features.filter(f => Number.isFinite(Number(f.properties[NUM_KEY]))).length;

  const pairs = features
    .filter(f => Number.isFinite(Number(f.properties[NUM_KEY])))
    .map(f => ({ v: Number(f.properties[NUM_KEY]), hex: f.properties._manaColor }));
  const rho = spearmanRho(pairs.map(p => p.v), pairs.map(p => hexToLum(p.hex)));
  const span = hueSpanDegrees(pairs.map(p => hexToHue(p.hex)));

  console.log(`features: ${features.length} | matched: ${matched} | sin datos: ${sinDatos} | KB: ${(geojsonText.length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | coords: ${coordsOk} | uniqueNames: ${names.size === features.length} | whiteBorder: ${borderOk}`);
  console.log(`§3 rho(valor,luminancia)=${rho.toFixed(3)} (≤ -0.65 OK) | span tono=${span.toFixed(1)}° (≤ 60 OK)`);
  console.log(`Rango: ${fmtKg(lo)} — ${fmtKg(hi)} kg/persona/año`);

  const ranked = pairs.slice().sort((a, b) => b.v - a.v);
  console.log(`Top 5: ${ranked.slice(0, 5).map(p => {
    const f = features.find(x => x.properties[NUM_KEY] === p.v);
    return `${f.properties._manaName} ${fmtKg(p.v)} (${f.properties['Año de datos']})`;
  }).join(' | ')}`);
  console.log(`Bottom 5: ${ranked.slice(-5).reverse().map(p => {
    const f = features.find(x => x.properties[NUM_KEY] === p.v);
    return `${f.properties._manaName} ${fmtKg(p.v)} (${f.properties['Año de datos']})`;
  }).join(' | ')}`);

  const ok = hexOk && haloOk && coordsOk && names.size === features.length && borderOk &&
    rho <= -0.65 && span <= 60 && withData >= 150 && geojsonText.length <= 1048576;
  if (!ok) { console.error('VALIDATION FAILED'); process.exit(1); }

  if (!fs.existsSync(path.join(ROOT, 'data', 'maps'))) fs.mkdirSync(path.join(ROOT, 'data', 'maps'), { recursive: true });
  fs.writeFileSync(OUT, geojsonText, 'utf8');
  console.log('OK →', OUT);
}

main().catch(e => { console.error('Fatal', e); process.exit(1); });
