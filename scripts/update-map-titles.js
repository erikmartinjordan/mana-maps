#!/usr/bin/env node
// ── update-map-titles.js ─
// Unifica los títulos de TODOS los mapas publicados de la galería a
// minúsculas tipo oración en español (solo la primera palabra y los
// nombres propios en mayúscula). NUNCA Title Case.
// Actualiza `title` y `name` en Firestore (maps/<slug>).
// Uso: node scripts/update-map-titles.js [--dry-run]
'use strict';
const { getAccessToken, firestoreRequest, COLLECTION, fsStr } = require('./lib/publisher');

const DRY_RUN = process.argv.includes('--dry-run');

// slug -> título canónico (minúsculas tipo oración, español)
// Fuente de verdad para Firestore, JSON-LD CollectionPage y landings.
const TITLES = {
  'active-volcanoes-world': 'Volcanes activos del mundo',
  'arrecifes-de-coral-fosas-oceanicas-y-naufragios-famosos-3172026-1785478772912': 'Arrecifes de coral, fosas oceánicas y naufragios famosos',
  'bibliotecas-barcelona': 'Bibliotecas públicas de Barcelona',
  'ciudades-perdidas-y-ruinas-arqueologicas-fascinantes-3072026-1785391217436': 'Ciudades perdidas y ruinas arqueológicas',
  'co2-per-capita-world': 'Emisiones de CO2 per cápita por país',
  'co2-total-emissions-world': 'Países que más emiten CO2 (totales)',
  'cobertura-forestal-por-pais': 'Cobertura forestal por país',
  'electricity-access-world': 'Acceso a electricidad mundial',
  'fertility-rate-world': 'Tasa de fertilidad mundial',
  'gdp-per-capita-world': 'PIB per cápita mundial por país',
  'happiness-index-world': 'Índice de felicidad mundial por país',
  'highest-peaks-per-continent': 'Punto más alto de cada continente',
  'indice-desarrollo-humano-por-pais': 'Índice de desarrollo humano (IDH) por país',
  'internet-users-world': 'Usuarios de internet mundial por país',
  'largest-islands-world': 'Las islas más grandes del mundo',
  'life-expectancy-world': 'Esperanza de vida mundial por país',
  'literacy-rate-world': 'Alfabetización mundial por país',
  'longest-rivers-world': 'Los 10 ríos más largos del mundo',
  'major-deserts-world': 'Principales desiertos del mundo',
  'minimum-wage-by-country': 'Salario mínimo por país',
  'nuclear-energy-world': 'Energía nuclear por país',
  'oceans-and-seas-world': 'Océanos y mares del mundo',
  'patrimonio-unesco-por-pais': 'Sitios patrimonio de la humanidad UNESCO por país',
  'population-by-country': 'Países por población total',
  'submarine-fiber-cables': 'Cables de fibra óptica submarina',
  'world-happiness-world': 'Índice de felicidad mundial por país',
  'worst-wildfires-world': 'Los peores incendios forestales del mundo',
};

async function main() {
  if (DRY_RUN) {
    for (const [s, t] of Object.entries(TITLES)) console.log(`${s} -> ${t}`);
    console.log(`(dry-run) ${Object.keys(TITLES).length} títulos`);
    return;
  }
  const { token } = await getAccessToken();
  let ok = 0, fail = 0;
  for (const [slug, title] of Object.entries(TITLES)) {
    const fieldPaths = ['title', 'name'].map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const res = await firestoreRequest(token, 'PATCH', `/${COLLECTION}/${slug}?${fieldPaths}`, {
      fields: { title: fsStr(title), name: fsStr(title) }
    });
    const good = res.status === 200;
    if (good) ok++; else fail++;
    console.log(`${good ? '✓' : '✗'} ${slug} -> "${title}" (${res.status})`);
  }
  console.log(`Títulos actualizados: ${ok}/${Object.keys(TITLES).length}` + (fail ? ` (${fail} fallos)` : ''));
  if (fail) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
