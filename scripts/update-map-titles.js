#!/usr/bin/env node
// ── update-map-titles.js ─
// Normaliza los títulos de los mapas publicados a mayúscula de frase
// (solo la primera palabra y siglas/nombres propios en mayúscula).
// Uso: node scripts/update-map-titles.js [--dry-run]
'use strict';
const { getAccessToken, firestoreRequest, COLLECTION, fsStr } = require('./lib/publisher');

const DRY_RUN = process.argv.includes('--dry-run');

// slug -> título corregido (mayúscula de frase)
const TITLES = {
  'co2-per-capita-world': 'Emisiones de CO2 per cápita por país',
  'cobertura-forestal-por-pais': 'Cobertura forestal por país',
  'happiness-index-world': 'Índice de felicidad mundial por país',
  'world-happiness-world': 'Índice de felicidad mundial por país',
  'indice-desarrollo-humano-por-pais': 'Índice de desarrollo humano (IDH) por país',
  'life-expectancy-world': 'Esperanza de vida mundial por país',
  'minimum-wage-by-country': 'Salario mínimo por país',
  'nuclear-energy-world': 'Energía nuclear por país',
  'oceans-and-seas-world': 'Océanos y mares del mundo',
  'patrimonio-unesco-por-pais': 'Sitios patrimonio de la humanidad UNESCO por país',
  'submarine-fiber-cables': 'Cables de fibra óptica submarina',
};

async function main() {
  if (DRY_RUN) { for (const [s, t] of Object.entries(TITLES)) console.log(`${s} -> ${t}`); return; }
  const { token } = await getAccessToken();
  let ok = 0;
  for (const [slug, title] of Object.entries(TITLES)) {
    const fieldPaths = ['title', 'name'].map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const res = await firestoreRequest(token, 'PATCH', `/${COLLECTION}/${slug}?${fieldPaths}`, { fields: { title: fsStr(title), name: fsStr(title) } });
    const good = res.status === 200;
    if (good) ok++;
    console.log(`${good ? '✓' : '✗'} ${slug} -> "${title}" (${res.status})`);
  }
  console.log(`Títulos actualizados: ${ok}/${Object.keys(TITLES).length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
