#!/usr/bin/env node
// ── gen-tourism-arrivals-world.js ─
// Genera data/maps/tourism-arrivals-world.geojson:
//   coropleta mundial «Países que más reciben turistas internacionales».
//
// Datos: data/sources/tourism-arrivals-world/un-tourism-arrivals.json
//   (UN Tourism/OMT — base de datos de estadísticas de turismo, indicador
//    INBD_TRIP_TOTL_TOTL_TOUR, descarga diciembre de 2025 + World Tourism
//    Barometer 2023 para destinos principales; último dato 2019-2024).
// Geometría: data/maps/population-by-country.geojson (polígonos oficiales ya
//   validados en la galería, 205 países/territorios).
//
// Rampa §3 AGENTS.md: secuencial monocromática ámbar (tono 35°), 9 pasos,
//   ordenada por el dato de claro→oscuro sobre escala log10 (la variable
//   abarca 4 órdenes de magnitud: 35 → 100.000.000). Borde blanco fino.
//   Países sin dato: gris neutro fuera de la rampa.
//
// Uso: node scripts/maps/gen-tourism-arrivals-world.js
'use strict';
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC_DATA = path.join(ROOT, 'data', 'sources', 'tourism-arrivals-world', 'un-tourism-arrivals.json');
const SRC_BASE = path.join(ROOT, 'data', 'maps', 'population-by-country.geojson');
const OUT = path.join(ROOT, 'data', 'maps', 'tourism-arrivals-world.geojson');

const GROUP_NAME = 'Turistas internacionales';
const GROUP_ID = 'turismo';
const NUM_KEY = 'Turistas internacionales (num)';
const HUE = 35;          // ámbar (sol/viajes); rampa mono §3
const RAMP_STEPS = 9;
const NO_DATA = '#d9d9d9';

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
const fmtInt = n => Math.round(n).toLocaleString('es-ES'); // «85.169.050»

function labelStyle() {
  return {
    enabled: true, fontSize: 11, fontFamily: 'DM Sans, sans-serif',
    fontWeight: '600', color: '#1e293b', haloWidth: 3, haloColor: '#FFFFFF',
    placement: 'point', field: '_manaName',
  };
}

function main() {
  if (!fs.existsSync(SRC_DATA)) { console.error('ERROR: falta', SRC_DATA); process.exit(1); }
  if (!fs.existsSync(SRC_BASE)) { console.error('ERROR: falta', SRC_BASE); process.exit(1); }
  const records = JSON.parse(fs.readFileSync(SRC_DATA, 'utf8')).records;
  const base = JSON.parse(fs.readFileSync(SRC_BASE, 'utf8'));

  // Índice por nombre ES y EN (y alias mínimos si hicieran falta)
  const byEs = new Map(), byEn = new Map();
  for (const r of records) {
    if (byEs.has(r.es)) console.warn('WARN: nombre ES duplicado en datos:', r.es);
    byEs.set(r.es, r);
    if (r.en && !byEn.has(r.en)) byEn.set(r.en, r);
  }

  const ramp = buildMonoRamp(HUE, RAMP_STEPS);
  const features = [];
  const usedCodes = new Set();
  let sinDatos = 0;

  for (const f of base.features) {
    const p = f.properties || {};
    const es = p['País'], en = p['País (EN)'], continente = p['Continente'] || '';
    const rec = byEs.get(es) || byEn.get(en) || null;
    const props = {
      _manaName: es,
      name: es,
      _manaGroupName: GROUP_NAME,
      _manaGroupId: GROUP_ID,
      _manaLabelStyle: labelStyle(),
      'País': es,
      'País (EN)': en || es,
      'Continente': continente,
    };

    if (rec) {
      usedCodes.add(String(rec.code));
      // Rampa log: 35 → 100.000.000 abarca 4 órdenes de magnitud.
      const v = rec.arrivals;
      const logs = records.map(r => Math.log10(Math.max(r.arrivals, 1)));
      const lo = Math.min(...logs), hi = Math.max(...logs);
      const t = hi === lo ? 1 : (Math.log10(Math.max(v, 1)) - lo) / (hi - lo);
      const step = Math.max(0, Math.min(RAMP_STEPS - 1, Math.round(t * (RAMP_STEPS - 1))));
      props._manaColor = ramp[step];
      props._manaFillOpacity = 0.82;
      props._manaWeight = 0.7;
      props._manaBorderColor = '#FFFFFF';
      props[NUM_KEY] = v;
      props['Turistas internacionales'] = `${fmtInt(v)} turistas`;
      props['Año'] = rec.year;
      props['Fuente'] = rec.source === 'World Tourism Barometer 2024'
        ? 'UN Tourism — World Tourism Barometer 2024'
        : 'UN Tourism — base de datos de estadísticas de turismo';
      props['Dato'] = `${fmtInt(v)} turistas (${rec.year})`;
      props['Description'] = `${es} — ${fmtInt(v)} turistas internacionales (${rec.year}) — ${continente}`;
    } else {
      sinDatos++;
      props._manaColor = NO_DATA;
      props._manaFillOpacity = 0.5;
      props._manaWeight = 0.7;
      props._manaBorderColor = '#FFFFFF';
      props[NUM_KEY] = 'Sin datos';
      props['Turistas internacionales'] = 'Sin datos';
      props['Año'] = null;
      props['Fuente'] = 'Sin dato reciente en la base de UN Tourism';
      props['Dato'] = 'Sin datos';
      props['Description'] = `${es} — sin datos de turistas internacionales — ${continente}`;
    }
    features.push({ type: 'Feature', properties: props, geometry: f.geometry });
  }

  // Registros de datos sin polígono en la base (p. ej. Hong Kong, Macao)
  const huerfanos = records.filter(r => !usedCodes.has(String(r.code)));
  if (huerfanos.length) {
    console.log('Registros sin polígono en la base (no se mapean):', huerfanos.map(r => `${r.es} (${fmtInt(r.arrivals)})`).join(', '));
  }

  const geo = { type: 'FeatureCollection', features };
  const text = JSON.stringify(geo);

  // ── Validaciones (AGENTS.md §6) ──
  const hexOk = features.every(f => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  const haloOk = features.every(f => f.properties._manaLabelStyle.haloWidth >= 2 && f.properties._manaLabelStyle.enabled === true);
  let coordsOk = true;
  const walk = c => {
    if (typeof c[0] === 'number') {
      if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) coordsOk = false;
    } else c.forEach(walk);
  };
  features.forEach(f => walk(f.geometry.coordinates));
  const names = new Set(features.map(f => f.properties._manaName));
  const withData = features.filter(f => Number.isFinite(Number(f.properties[NUM_KEY]))).length;

  // Rampa ordenada por el dato (claro→oscuro, Spearman < 0 en luminancia)
  function hexToLum(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const pairs = features
    .map(f => ({ v: Number(f.properties[NUM_KEY]), l: hexToLum(f.properties._manaColor) }))
    .filter(p => Number.isFinite(p.v));
  const rhoCheck = (() => {
    const rank = a => {
      const s = a.map((x, i) => ({ x, i })).sort((p, q) => p.x - q.x);
      const r = new Array(a.length);
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
    const rv = rank(pairs.map(p => p.v)), rl = rank(pairs.map(p => p.l));
    const n = rv.length, mean = a => a.reduce((x, y) => x + y, 0) / n;
    const mv = mean(rv), ml = mean(rl);
    let num = 0, dv = 0, dl = 0;
    for (let i = 0; i < n; i++) {
      num += (rv[i] - mv) * (rl[i] - ml);
      dv += (rv[i] - mv) ** 2; dl += (rl[i] - ml) ** 2;
    }
    return (dv && dl) ? num / Math.sqrt(dv * dl) : 0;
  })();
  const hues = pairs.map(p => {
    const hex = features.find(f => Number(f.properties[NUM_KEY]) === p.v).properties._manaColor;
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return 0;
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return h * 360;
  });
  const hs = hues.slice().sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 0; i < hs.length - 1; i++) maxGap = Math.max(maxGap, hs[i + 1] - hs[i]);
  maxGap = Math.max(maxGap, (hs[0] + 360) - hs[hs.length - 1]);
  const hueSpan = 360 - maxGap;

  console.log(`features: ${features.length} | con datos: ${withData} | sin datos: ${sinDatos} | KB: ${(text.length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | coords: ${coordsOk} | uniqueNames: ${names.size === features.length}`);
  console.log(`§3 rho(valor,luminancia)=${rhoCheck.toFixed(3)} (≤ -0.65 OK) | span tono=${hueSpan.toFixed(1)}° (≤ 60 OK)`);
  console.log(`top 5: ${features
    .filter(f => Number.isFinite(Number(f.properties[NUM_KEY])))
    .sort((a, b) => b.properties[NUM_KEY] - a.properties[NUM_KEY])
    .slice(0, 5)
    .map(f => `${f.properties._manaName} ${fmtInt(f.properties[NUM_KEY])}`)
    .join(' | ')}`);

  const ok = hexOk && haloOk && coordsOk && names.size === features.length &&
    rhoCheck <= -0.65 && hueSpan <= 60 && text.length <= 1048576;
  if (!ok) { console.error('VALIDATION FAILED'); process.exit(1); }

  fs.writeFileSync(OUT, text, 'utf8');
  console.log('OK →', OUT);
}

main();
