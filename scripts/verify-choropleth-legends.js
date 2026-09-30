#!/usr/bin/env node
// Verificación offline: la rampa de leyenda se puede construir con legendKey.
'use strict';
const { getAccessToken, firestoreRequest } = require('./lib/publisher');

function pv(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(pv);
  if ('mapValue' in v) {
    const o = {};
    for (const [k, fv] of Object.entries(v.mapValue.fields || {})) o[k] = pv(fv);
    return o;
  }
  return v;
}
function plain(doc) {
  const o = {};
  for (const [k, v] of Object.entries(doc.fields || {})) o[k] = pv(v);
  return o;
}
function parseLegendNumber(raw) {
  if (raw == null) return NaN;
  if (typeof raw === 'number') return isFinite(raw) ? raw : NaN;
  const s = String(raw);
  let m = s.replace(/[^\d.,\-]/g, '');
  if (m === '') return NaN;
  let num;
  if (/^0[.,]\d+$/.test(m)) num = parseFloat(m.replace(',', '.'));
  else if (m.indexOf(',') !== -1) num = parseFloat(m.replace(/\./g, '').replace(',', '.'));
  else if (/^\d{1,3}(\.\d{3})+$/.test(m)) num = parseFloat(m.replace(/\./g, ''));
  else num = parseFloat(m);
  return isFinite(num) ? num : NaN;
}
function formatLegendValue(v, fmt) {
  if (fmt === 'year') return String(Math.round(v));
  if (fmt === 'meters') return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' m';
  if (fmt === 'usd') return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' $';
  const rounded = Math.round(v * 100) / 100;
  const parts = String(rounded).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return parts.join(',');
}

// Coropletas / mapas con rampa numérica por color (los del BACKLOG + ríos/islas).
const TARGETS = [
  'indice-desarrollo-humano-por-pais',
  'world-happiness-world',
  'happiness-index-world',
  'co2-per-capita-world',
  'nuclear-energy-world',
  'life-expectancy-world',
  'population-by-country',
  'electricity-access-world',
  'cobertura-forestal-por-pais',
  'fertility-rate-world',
  'minimum-wage-by-country',
  'patrimonio-unesco-por-pais',
  'bibliotecas-barcelona',
  'longest-rivers-world',
  'largest-islands-world',
];

async function main() {
  const { token } = await getAccessToken();
  let fail = 0;
  for (const slug of TARGETS) {
    const res = await firestoreRequest(token, 'GET', `/maps/${slug}`);
    if (res.status !== 200) { console.error(`✗ ${slug}: HTTP ${res.status}`); fail++; continue; }
    const m = plain(res.data);
    if (!m.legendKey) { console.error(`✗ ${slug}: sin legendKey`); fail++; continue; }
    let geo;
    try { geo = JSON.parse(m.geojsonText || '{}'); } catch (e) { console.error(`✗ ${slug}: geojson inválido`); fail++; continue; }
    const colors = {};
    for (const f of (geo.features || [])) {
      const p = f.properties || {};
      const c = p._manaColor || p.color;
      const v = parseLegendNumber(p[m.legendKey]);
      if (!c || !isFinite(v)) continue;
      if (!colors[c]) colors[c] = { v, c };
    }
    const steps = Object.keys(colors).map(k => colors[k]).sort((a, b) => a.v - b.v);
    if (steps.length < 3) {
      console.error(`✗ ${slug}: rampa insuficiente (${steps.length} pasos) con legendKey=${m.legendKey}`);
      fail++;
      continue;
    }
    const title = m.legendTitle || m.legendKey;
    const fmt = m.legendFormat || 'number';
    const lo = formatLegendValue(steps[0].v, fmt);
    const hi = formatLegendValue(steps[steps.length - 1].v, fmt);
    console.log(`✓ ${slug}`);
    console.log(`   legendKey=${JSON.stringify(m.legendKey)} title=${JSON.stringify(title)} format=${JSON.stringify(fmt)}`);
    console.log(`   ramp steps=${steps.length} scale=${lo} → ${hi}`);
    console.log(`   colors=${steps.slice(0, 5).map(s => s.c).join(' ')}${steps.length > 5 ? ' …' : ''}`);
  }
  if (fail) { console.error(`\n${fail} choropleths failed legend build`); process.exit(1); }
  console.log(`\nAll ${TARGETS.length} choropleth legends build correctly.`);
}

main().catch(e => { console.error(e); process.exit(1); });
