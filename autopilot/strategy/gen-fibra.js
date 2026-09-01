#!/usr/bin/env node
// Genera el mapa mundial de cables submarinos para la galería de Maña Maps.
const fs = require('fs');
const path = require('path');

const ROOT = '/home/erik/autopilot';
const DATA = path.join(ROOT, 'strategy/data');
const REPO = path.join(ROOT, 'workspaces/mana-maps');
const GEO = JSON.parse(fs.readFileSync(path.join(DATA, 'countries.geo.json'), 'utf8'));
const CABLES = JSON.parse(fs.readFileSync(path.join(DATA, 'fibra-submarina.json'), 'utf8'));

const ALIASES = {
  'United States of America': 'United States', 'USA': 'United States',
  'UK': 'United Kingdom', 'Congo, Dem. Rep.': 'Democratic Republic of the Congo',
  'Congo, Rep.': 'Republic of the Congo', 'Côte d’Ivoire': "Côte d'Ivoire",
  'Taiwan': 'Taiwan', 'Hong Kong': 'Hong Kong', 'Guam': 'Guam',
  'American Samoa': 'American Samoa', 'Cape Verde': 'Cape Verde',
  'Tanzania': 'United Republic of Tanzania', "Côte d'Ivoire": 'Ivory Coast'
};
const norm = (name) => ALIASES[name] || name;
const geoNames = new Set(GEO.features.map(f => norm(f.properties && f.properties.name)));
// countries.geo.json is a 110m political layer and intentionally omits some
// small landing-point entities; keep them in the coverage audit as valid.
const knownLandingEntities = new Set(['Singapore', 'Gibraltar', 'Cape Verde', 'American Samoa', 'Guam', 'Hong Kong']);
const hasGeography = name => geoNames.has(norm(name)) || knownLandingEntities.has(name);

// Cinco tramos: la longitud permite comparar el alcance físico de cada sistema.
const buckets = [
  { max: 7000, color: '#a7f3d0', label: '< 7,000 km' },
  { max: 11000, color: '#5eead4', label: '7,000–10,999 km' },
  { max: 15000, color: '#22d3ee', label: '11,000–14,999 km' },
  { max: 20000, color: '#38bdf8', label: '15,000–19,999 km' },
  { max: Infinity, color: '#2563eb', label: '20,000+ km' }
];
const bucketFor = km => buckets.find(b => km < b.max) || buckets[buckets.length - 1];

let matched = 0;
const allCountries = new Set();
const features = CABLES.cables.map((cable, index) => {
  cable.countries.forEach(country => allCountries.add(norm(country)));
  const missing = cable.countries.filter(country => !hasGeography(country));
  if (!missing.length) matched++;
  const bucket = bucketFor(cable.length_km);
  return {
    type: 'Feature',
    id: cable.id,
    properties: {
      _manaName: cable.name,
      name: cable.name,
      _manaColor: bucket.color,
      _manaWeight: 2.5,
      _manaOpacity: 0.9,
      _manaGeometryType: 'line',
      _manaGroupName: 'Submarine fiber optic cables',
      _manaGroupId: 1,
      cable_length_km: cable.length_km,
      cable_length_bucket: bucket.label,
      ready_for_service: cable.rfs_year,
      landing_points: cable.landing_points,
      countries: cable.countries.join(' · '),
      data_source: cable.source,
      route_note: 'Approximate line connecting published landing points'
    },
    geometry: { type: 'LineString', coordinates: cable.route }
  };
});

console.log('cables en dataset:', CABLES.cables.length);
console.log('cables cuyos países tienen geometría:', matched);
console.log('cobertura de países/entidades de aterrizaje:', `${allCountries.size - new Set([...allCountries].filter(c => !hasGeography(c))).size}/${allCountries.size}`);
console.log('fuera de countries.geo.json (entidades reconocidas aparte):', [...allCountries].filter(c => !hasGeography(c)).join(', ') || 'ninguno');

const slug = 'submarine-fiber-cables';
const geojson = { type: 'FeatureCollection', features };
const map = {
  id: slug, slug,
  title: 'The Internet Runs Underwater',
  name: 'The Internet Runs Underwater',
  createdBy: 'maña-maps', ownerUid: 'maña-maps', authorHandle: '', lang: 'en',
  featureCount: features.length, visibility: 'public', shareMode: 'view',
  allowPublicEdit: false, isPublished: true,
  description: 'Major submarine fiber-optic cables and their published landing-point connections.',
  dataSource: CABLES._source, dataDate: CABLES._date,
  geojsonText: JSON.stringify(geojson), geojsonChunked: null,
  createdAtMs: Date.now(), updatedAtMs: Date.now(), views: 0, likes: 0
};
const out = path.join(REPO, 'data/gallery-fibra.js');
fs.writeFileSync(out, 'window.MANA_FIBRA_MAP = ' + JSON.stringify(map) + ';\n');
console.log('escrito:', out, `(${Math.round(map.geojsonText.length / 1024)} KB)`);
