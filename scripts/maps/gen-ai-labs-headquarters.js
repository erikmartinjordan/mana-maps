#!/usr/bin/env node
// ── gen-ai-labs-headquarters.js ─
// Mapa puntual: sedes centrales de 20 laboratorios de IA.
// Fuente: páginas corporativas y Wikipedia (consultadas en noviembre de 2026).
// Coordenadas a nivel de sede o ciudad; color por región.
'use strict';
const fs = require('fs');
const path = require('path');

const SLUG = 'ai-labs-headquarters';
const OUT = path.join(__dirname, '..', '..', 'data', 'maps', `${SLUG}.geojson`);

const REGIONS = {
  america: { name: 'América', color: '#f08a5d' },
  europe: { name: 'Europa', color: '#e8b86d' },
  asia: { name: 'Asia', color: '#6fb3b8' },
};

const LABS = [
  { name: 'Anthropic', city: 'San Francisco', country: 'Estados Unidos', region: 'america', founded: 2021, model: 'Claude', lat: 37.7873, lon: -122.3966 },
  { name: 'OpenAI', city: 'San Francisco', country: 'Estados Unidos', region: 'america', founded: 2015, model: 'GPT', lat: 37.7701, lon: -122.3890 },
  { name: 'Meta AI', city: 'Menlo Park', country: 'Estados Unidos', region: 'america', founded: 2013, model: 'Llama', lat: 37.4848, lon: -122.1484 },
  { name: 'Microsoft AI', city: 'Redmond', country: 'Estados Unidos', region: 'america', founded: 2023, model: 'Copilot', lat: 47.6396, lon: -122.1280 },
  { name: 'xAI (SpaceXAI)', city: 'Palo Alto', country: 'Estados Unidos', region: 'america', founded: 2023, model: 'Grok', lat: 37.4375, lon: -122.1477 },
  { name: 'Cohere', city: 'Toronto', country: 'Canadá', region: 'america', founded: 2019, model: 'Command', lat: 43.6505, lon: -79.3910 },
  { name: 'Hugging Face', city: 'Nueva York', country: 'Estados Unidos', region: 'america', founded: 2016, model: 'Transformers', lat: 40.7033, lon: -73.9880 },
  { name: 'Perplexity AI', city: 'San Francisco', country: 'Estados Unidos', region: 'america', founded: 2022, model: 'Perplexity', lat: 37.7638, lon: -122.4320 },
  { name: 'Inflection AI', city: 'Palo Alto', country: 'Estados Unidos', region: 'america', founded: 2022, model: 'Pi', lat: 37.4449, lon: -122.1635 },
  { name: 'Google DeepMind', city: 'Londres', country: 'Reino Unido', region: 'europe', founded: 2010, model: 'Gemini', lat: 51.5155, lon: -0.1055 },
  { name: 'Mistral AI', city: 'París', country: 'Francia', region: 'europe', founded: 2023, model: 'Mistral', lat: 48.8566, lon: 2.3522 },
  { name: 'Stability AI', city: 'Londres', country: 'Reino Unido', region: 'europe', founded: 2019, model: 'Stable Diffusion', lat: 51.5074, lon: -0.1278 },
  { name: 'Aleph Alpha', city: 'Heidelberg', country: 'Alemania', region: 'europe', founded: 2019, model: 'Luminous', lat: 49.3988, lon: 8.6724 },
  { name: 'AI21 Labs', city: 'Tel Aviv', country: 'Israel', region: 'asia', founded: 2017, model: 'Jamba', lat: 32.0853, lon: 34.7818 },
  { name: 'DeepSeek', city: 'Hangzhou', country: 'China', region: 'asia', founded: 2023, model: 'DeepSeek', lat: 30.2741, lon: 120.1551 },
  { name: 'Alibaba (Qwen)', city: 'Hangzhou', country: 'China', region: 'asia', founded: 1999, model: 'Qwen', lat: 30.2800, lon: 120.0600 },
  { name: 'Baidu (ERNIE)', city: 'Pekín', country: 'China', region: 'asia', founded: 2000, model: 'ERNIE', lat: 39.9042, lon: 116.4074 },
  { name: 'Moonshot AI', city: 'Pekín', country: 'China', region: 'asia', founded: 2023, model: 'Kimi', lat: 39.9800, lon: 116.4800 },
  { name: 'Sakana AI', city: 'Tokio', country: 'Japón', region: 'asia', founded: 2023, model: 'Sakana', lat: 35.6762, lon: 139.6503 },
  { name: 'Naver (HyperCLOVA X)', city: 'Seongnam', country: 'Corea del Sur', region: 'asia', founded: 1999, model: 'HyperCLOVA X', lat: 37.4449, lon: 127.1389 },
];

const labelStyle = {
  enabled: true,
  field: '_manaName',
  fontFamily: 'DM Sans, sans-serif',
  fontSize: 11,
  fontWeight: '600',
  color: '#1e293b',
  haloWidth: 3,
  haloColor: '#FFFFFF',
  opacity: 0.95,
  placement: 'auto',
};

function buildFeature(lab) {
  const region = REGIONS[lab.region];
  if (!region) throw new Error(`Región desconocida: ${lab.region}`);
  return {
    type: 'Feature',
    properties: {
      _manaName: lab.name,
      name: lab.name,
      _manaColor: region.color,
      _manaFillOpacity: 0.95,
      _manaWeight: 1.2,
      _manaBorderColor: '#FFFFFF',
      _manaGeometryType: 'point',
      _manaGroupName: region.name,
      _manaGroupId: lab.region,
      markerType: 'circle',
      _manaMarkerType: 'circle',
      _manaLabelStyle: labelStyle,
      Empresa: lab.name,
      Ciudad: lab.city,
      País: lab.country,
      Región: region.name,
      Fundación: lab.founded,
      Modelo: lab.model,
      Dato: `${lab.city} (${lab.country})`,
      Description: `${lab.name} — ${lab.city} (${lab.country}). Fundada en ${lab.founded}. Modelo: ${lab.model}.`,
    },
    geometry: {
      type: 'Point',
      coordinates: [lab.lon, lab.lat],
    },
  };
}

const geo = {
  type: 'FeatureCollection',
  name: 'Sedes de los laboratorios de IA',
  features: LABS.map(buildFeature),
};

const names = new Set(geo.features.map(f => f.properties._manaName));
const coordsOk = geo.features.every(f => {
  const [lon, lat] = f.geometry.coordinates;
  return lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
});
const colorsOk = geo.features.every(f => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
const labelsOk = geo.features.every(f => f.properties._manaLabelStyle && f.properties._manaLabelStyle.haloWidth >= 2);
const markersOk = geo.features.every(f => f.properties.markerType === 'circle' && f.properties._manaMarkerType === 'circle');
const regionsOk = geo.features.every(f => f.properties._manaColor === REGIONS[f.properties._manaGroupId].color);

if (names.size !== geo.features.length) throw new Error('Nombres duplicados');
if (!coordsOk) throw new Error('Coordenadas fuera de rango');
if (!colorsOk) throw new Error('Colores hex inválidos');
if (!labelsOk) throw new Error('LabelStyle incompleto');
if (!markersOk) throw new Error('MarkerType inválido');
if (!regionsOk) throw new Error('Color de región incoherente');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(geo, null, 2) + '\n');
console.log(`OK: ${geo.features.length} sedes → ${path.relative(process.cwd(), OUT)}`);
for (const [id, r] of Object.entries(REGIONS)) {
  console.log(`  ${r.name}: ${geo.features.filter(f => f.properties._manaGroupId === id).length} · ${r.color}`);
}
