#!/usr/bin/env node
// Audit legendKey/legendTitle/legendFormat on all published Firestore maps
'use strict';
const { getAccessToken, firestoreRequest, PROJECT_ID } = require('./lib/publisher');

function parseFirestoreValue(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(parseFirestoreValue);
  if ('mapValue' in v) {
    const o = {};
    for (const [k, fv] of Object.entries(v.mapValue.fields || {})) o[k] = parseFirestoreValue(fv);
    return o;
  }
  return v;
}

function docToPlain(doc) {
  const fields = (doc.fields || {});
  const o = { _name: doc.name };
  for (const [k, v] of Object.entries(fields)) o[k] = parseFirestoreValue(v);
  return o;
}

function isChoroplethLike(item) {
  const t = (item.title || item.name || '').toLowerCase();
  const tags = Array.isArray(item.tags) ? item.tags.join(' ').toLowerCase() : '';
  // Heurística: mapas coropléticos por país / variables numéricas
  const hints = ['coropl', 'por país', 'por pais', 'mundial', 'world', 'índice', 'indice', 'tasa', 'emisiones', 'población', 'poblacion', 'esperanza', 'electricidad', 'forestal', 'fertilidad', 'felicidad', 'desarrollo', 'nuclear', 'co2', 'salario', 'mínimo', 'minimo', 'patrimonio', 'unesco', 'alfabetiz'];
  const hay = t + ' ' + tags;
  return hints.some(h => hay.includes(h));
}

function numericKeysInGeo(geoText, sample = 40) {
  try {
    const geo = typeof geoText === 'string' ? JSON.parse(geoText) : geoText;
    if (!geo || !geo.features || !geo.features.length) return { keys: {}, error: 'no features' };
    const acc = {};
    const feats = geo.features.slice(0, sample);
    for (const f of feats) {
      const p = (f && f.properties) || {};
      for (const [k, v] of Object.entries(p)) {
        if (k.startsWith('_')) continue;
        if (typeof v === 'number' && isFinite(v)) {
          acc[k] = acc[k] || { type: 'number', min: v, max: v, count: 0 };
          acc[k].min = Math.min(acc[k].min, v);
          acc[k].max = Math.max(acc[k].max, v);
          acc[k].count++;
        } else if (typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.replace(/\./g, (m, i) => (v.split('.')[1] && v.split('.')[1].length === 3 && /^\d{1,3}$/.test(v.split('.')[0]) ? ',' : m)))) {
          // loose numeric string — skip complex; try simpler
        }
      }
    }
    return { keys: acc, featureCount: geo.features.length };
  } catch (e) {
    return { keys: {}, error: String(e.message || e) };
  }
}

function parseNumLoose(raw) {
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

function checkLegendKeyInGeo(geoText, legendKey) {
  try {
    const geo = typeof geoText === 'string' ? JSON.parse(geoText) : geoText;
    if (!geo || !geo.features) return { ok: false, reason: 'no geo' };
    let hits = 0, total = 0;
    const colors = {};
    for (const f of geo.features.slice(0, 200)) {
      total++;
      const p = f.properties || {};
      const v = parseNumLoose(p[legendKey]);
      const c = p._manaColor || p.color;
      if (isFinite(v) && c) {
        hits++;
        if (!colors[c]) colors[c] = { v, c };
      }
    }
    const steps = Object.keys(colors).length;
    return { ok: hits >= 3 && steps >= 3, hits, total, steps, distinctColors: steps };
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  }
}

async function main() {
  const { token } = await getAccessToken();
  console.log('Auth OK, listing maps...');
  let pageToken = null;
  const all = [];
  do {
    const q = `?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await firestoreRequest(token, 'GET', `/maps${q}`);
    if (res.status !== 200) { console.error('List failed', res.status, res.data); process.exit(1); }
    for (const d of (res.data.documents || [])) all.push(docToPlain(d));
    pageToken = res.data.nextPageToken || null;
  } while (pageToken);

  const published = all.filter(m => m.isPublished === true);
  console.log(`Total docs: ${all.length}, published: ${published.length}\n`);

  const rows = [];
  for (const m of published) {
    const slug = m.slug || m.id || (m._name || '').split('/').pop();
    const has = {
      legendKey: m.legendKey != null && m.legendKey !== '',
      legendTitle: m.legendTitle != null && m.legendTitle !== '',
      legendFormat: m.legendFormat != null && m.legendFormat !== '',
    };
    const title = m.title || m.name || slug;
    const tags = Array.isArray(m.tags) ? m.tags.join(',') : '';
    let legendCheck = null;
    let numericKeys = null;
    if (m.geojsonText) {
      if (has.legendKey) legendCheck = checkLegendKeyInGeo(m.geojsonText, m.legendKey);
      numericKeys = numericKeysInGeo(m.geojsonText);
    }
    const choropleth = isChoroplethLike({ title, tags });
    const missing = Object.entries(has).filter(([, v]) => !v).map(([k]) => k);
    rows.push({ slug, title, tags, choropleth, has, missing, legendKey: m.legendKey || null, legendTitle: m.legendTitle || null, legendFormat: m.legendFormat || null, legendCheck, numericKeyList: numericKeys && !numericKeys.error ? Object.keys(numericKeys.keys) : null, featureCount: m.featureCount });
  }

  rows.sort((a, b) => {
    if (a.missing.length !== b.missing.length) return b.missing.length - a.missing.length;
    return a.slug.localeCompare(b.slug);
  });

  console.log('=== PUBLISHED MAPS AUDIT ===');
  for (const r of rows) {
    const flag = r.missing.length ? 'MISSING' : (r.legendCheck && !r.legendCheck.ok ? 'KEY-FAIL' : 'OK');
    console.log(`\n[${flag}] ${r.slug}`);
    console.log(`  title: ${r.title}`);
    console.log(`  tags: ${r.tags} | choroplethLike: ${r.choropleth} | features: ${r.featureCount}`);
    console.log(`  legendKey=${JSON.stringify(r.legendKey)} legendTitle=${JSON.stringify(r.legendTitle)} legendFormat=${JSON.stringify(r.legendFormat)}`);
    if (r.missing.length) console.log(`  missing: ${r.missing.join(', ')}`);
    if (r.legendCheck) console.log(`  legendKey check: ok=${r.legendCheck.ok} hits=${r.legendCheck.hits}/${r.legendCheck.total} steps=${r.legendCheck.steps} ${r.legendCheck.reason || ''}`);
    if (r.numericKeyList) console.log(`  numeric keys in geo: ${r.numericKeyList.slice(0, 25).join(' | ')}${r.numericKeyList.length > 25 ? ' ...' : ''}`);
  }

  const needUpdate = rows.filter(r => r.missing.length || (r.legendCheck && !r.legendCheck.ok));
  console.log(`\n=== SUMMARY: ${needUpdate.length} maps need attention of ${rows.length} published ===`);
  for (const r of needUpdate) console.log(` - ${r.slug}: missing=${r.missing.join(',') || '-'} keyFail=${r.legendCheck && !r.legendCheck.ok ? 'yes' : 'no'}`);
}

main().catch(e => { console.error(e); process.exit(1); });
