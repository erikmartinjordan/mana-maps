#!/usr/bin/env node
// ── scripts/update-legend-fields.js ─
// Completa legendKey/legendTitle/legendFormat en coropletas de Firestore
// que no los tenían o los tenían rotos (BACKLOG: legendKey coropletas).
'use strict';
const { getAccessToken, firestoreRequest, fsStr, fsNull } = require('./lib/publisher');

// Mapas con rampa de color por valor numérico que faltaban o estaban rotos.
const UPDATES = [
  {
    slug: 'longest-rivers-world',
    reason: 'rampa azul por Longitud (km); sin legendKey',
    fields: {
      legendKey: fsStr('Longitud (km)'),
      legendTitle: fsStr('Longitud del río (km)'),
      legendFormat: fsStr('number'),
    },
  },
  {
    slug: 'largest-islands-world',
    reason: 'rampa azul por superficie_km2; sin legendKey',
    fields: {
      legendKey: fsStr('superficie_km2'),
      legendTitle: fsStr('Superficie (km²)'),
      legendFormat: fsStr('number'),
    },
  },
  {
    slug: 'oceans-and-seas-world',
    reason: 'legendKey="Profundidad media" no existe en las features (sin dato numérico) — se limpia',
    fields: {
      legendKey: fsNull(),
      legendTitle: fsNull(),
      legendFormat: fsNull(),
    },
  },
  {
    slug: 'world-happiness-world',
    reason: 'legendFormat no reconocido ("{value} puntos") — se normaliza a number',
    fields: {
      legendFormat: fsStr('number'),
    },
  },
];

async function main() {
  const { token } = await getAccessToken();
  let ok = 0, fail = 0;

  for (const u of UPDATES) {
    const existing = await firestoreRequest(token, 'GET', `/maps/${u.slug}`);
    if (existing.status !== 200) {
      console.error(`✗ ${u.slug}: no existe (${existing.status})`);
      fail++;
      continue;
    }
    const fieldPaths = Object.keys(u.fields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const res = await firestoreRequest(token, 'PATCH', `/maps/${u.slug}?${fieldPaths}`, { fields: u.fields });
    if (res.status >= 400) {
      console.error(`✗ ${u.slug}: PATCH failed ${res.status}`, JSON.stringify(res.data).slice(0, 300));
      fail++;
      continue;
    }
    const verify = await firestoreRequest(token, 'GET', `/maps/${u.slug}`);
    const f = (verify.data && verify.data.fields) || {};
    const g = k => (f[k] && ('stringValue' in f[k] ? f[k].stringValue : 'nullValue' in f[k] ? null : f[k]));
    console.log(`✓ ${u.slug} — ${u.reason}`);
    console.log(`   legendKey=${JSON.stringify(g('legendKey'))} legendTitle=${JSON.stringify(g('legendTitle'))} legendFormat=${JSON.stringify(g('legendFormat'))}`);
    ok++;
  }

  console.log(`\nDone: ${ok} updated, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
