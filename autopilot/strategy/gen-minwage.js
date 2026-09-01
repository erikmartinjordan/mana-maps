#!/usr/bin/env node
// gen-minwage.js - Genera el mapa choropleth de salario mínimo por país
// en el formato MANA_LOCAL_MAPS de la galería de Maña Maps.
const fs = require('fs');
const path = require('path');

const DATA = '/Users/Erik/autopilot/strategy/data';
const REPO = '/Users/Erik/autopilot/workspaces/mana-maps';
const GEO = JSON.parse(fs.readFileSync(path.join(DATA, 'countries.geo.json'), 'utf8'));
const WAGE = JSON.parse(fs.readFileSync(path.join(DATA, 'minimum-wage.json'), 'utf8'));

// Normalización de nombres para unir países (GeoJSON name ↔ Wikipedia country)
const ALIASES = {
  'United States of America': 'United States', 'United States': 'United States',
  'Russia': 'Russia', 'United Kingdom': 'United Kingdom', 'UK': 'United Kingdom',
  'South Korea': 'South Korea', 'Republic of Korea': 'South Korea', 'South Korea':
    'South Korea', 'North Korea': 'North Korea', 'Tanzania': 'Tanzania',
  'Venezuela': 'Venezuela', 'Bolivia': 'Bolivia', 'Iran': 'Iran', 'Vietnam': 'Vietnam',
  'Laos': 'Laos', 'Syria': 'Syria', 'Czechia': 'Czech Republic',
  'Czech Republic': 'Czech Republic', 'Côte d\'Ivoire': 'Ivory Coast',
  'Ivory Coast': 'Ivory Coast', 'Republic of the Congo': 'Congo',
  'Democratic Republic of the Congo': 'DR Congo', 'DR Congo': 'DR Congo',
  'Congo': 'Republic of the Congo', 'Republic of Congo': 'Republic of the Congo',
  'Myanmar': 'Myanmar', 'Burma': 'Myanmar', 'Macedonia': 'North Macedonia',
  'North Macedonia': 'North Macedonia', 'Cape Verde': 'Cape Verde',
  'Eswatini': 'Eswatini', 'Swaziland': 'Eswatini', 'eSwatini': 'Eswatini',
  'The Gambia': 'Gambia', 'Gambia': 'Gambia', 'Bahamas': 'The Bahamas',
  'The Bahamas': 'The Bahamas', 'United Arab Emirates': 'United Arab Emirates',
  'Timor-Leste': 'Timor-Leste', 'East Timor': 'Timor-Leste',
  'Bosnia and Herzegovina': 'Bosnia and Herzegovina', 'S\u00e3o Tom\u00e9 and Pr\u00edncipe': 'Sao Tome and Principe',
  'Sao Tome and Principe': 'Sao Tome and Principe',
  'Federated States of Micronesia': 'Micronesia', 'Micronesia': 'Micronesia',
  'Solomon Islands': 'Solomon Islands', 'Saint Kitts and Nevis': 'Saint Kitts and Nevis',
  'Saint Vincent and the Grenadines': 'Saint Vincent and the Grenadines',
  'Antigua and Barbuda': 'Antigua and Barbuda', 'Trinidad and Tobago': 'Trinidad and Tobago',
  'Papua New Guinea': 'Papua New Guinea', 'El Salvador': 'El Salvador',
  'Costa Rica': 'Costa Rica', 'Dominican Republic': 'Dominican Republic',
  'Kosovo': 'Kosovo', 'Palestine': 'Palestine', 'Palestinian territories': 'Palestine',
  'Western Sahara': 'Western Sahara', 'Somaliland': 'Somaliland',
  'Northern Cyprus': 'Northern Cyprus', 'South Sudan': 'South Sudan',
  'Central African Republic': 'Central African Republic',
  'Equatorial Guinea': 'Equatorial Guinea', 'Guinea-Bissau': 'Guinea-Bissau',
  'Burkina Faso': 'Burkina Faso', 'Sierra Leone': 'Sierra Leone',
  'New Zealand': 'New Zealand', 'Hong Kong': 'Hong Kong', 'Macao': 'Macao',
  'Puerto Rico': 'Puerto Rico', 'Greenland': 'Greenland', 'French Guiana': 'French Guiana',
  'Guadeloupe': 'Guadeloupe', 'Martinique': 'Martinique', 'R\u00e9union': 'Reunion',
  'Mayotte': 'Mayotte', 'Saint Martin': 'Saint Martin', 'Saint-Barth\u00e9lemy': 'Saint Barthelemy',
  'Cura\u00e7ao': 'Curacao', 'Aruba': 'Aruba', 'Sint Maarten': 'Sint Maarten',
  'Kyrgyzstan': 'Kyrgyzstan', 'Kazakhstan': 'Kazakhstan', 'Turkmenistan': 'Turkmenistan',
  'Tajikistan': 'Tajikistan', 'Uzbekistan': 'Uzbekistan', 'Georgia': 'Georgia',
  'Moldova': 'Moldova', 'Belarus': 'Belarus', 'Ukraine': 'Ukraine',
  'Slovakia': 'Slovakia', 'Slovenia': 'Slovenia', 'Croatia': 'Croatia',
  'Serbia': 'Serbia', 'Montenegro': 'Montenegro', 'Albania': 'Albania',
  'Turkey': 'Turkey', 'Israel': 'Israel', 'Jordan': 'Jordan', 'Lebanon': 'Lebanon',
  'Iraq': 'Iraq', 'Saudi Arabia': 'Saudi Arabia', 'Yemen': 'Yemen',
  'Oman': 'Oman', 'Qatar': 'Qatar', 'Bahrain': 'Bahrain', 'Kuwait': 'Kuwait',
  'Afghanistan': 'Afghanistan', 'Pakistan': 'Pakistan', 'India': 'India',
  'Nepal': 'Nepal', 'Bhutan': 'Bhutan', 'Bangladesh': 'Bangladesh',
  'Sri Lanka': 'Sri Lanka', 'Maldives': 'Maldives', 'Indonesia': 'Indonesia',
  'Malaysia': 'Malaysia', 'Singapore': 'Singapore', 'Thailand': 'Thailand',
  'Cambodia': 'Cambodia', 'Philippines': 'Philippines', 'Mongolia': 'Mongolia',
  'China': 'China', 'Japan': 'Japan', 'Taiwan': 'Taiwan',
  'Fiji': 'Fiji', 'Samoa': 'Samoa', 'Vanuatu': 'Vanuatu', 'Tonga': 'Tonga',
  'Nauru': 'Nauru', 'Tuvalu': 'Tuvalu', 'Kiribati': 'Kiribati',
  'Marshall Islands': 'Marshall Islands', 'Palau': 'Palau',
  'Chile': 'Chile', 'Argentina': 'Argentina', 'Brazil': 'Brazil',
  'Paraguay': 'Paraguay', 'Uruguay': 'Uruguay', 'Guyana': 'Guyana',
  'Suriname': 'Suriname', 'Peru': 'Peru', 'Ecuador': 'Ecuador',
  'Colombia': 'Colombia', 'Venezuela': 'Venezuela', 'Panama': 'Panama',
  'Nicaragua': 'Nicaragua', 'Honduras': 'Honduras', 'Guatemala': 'Guatemala',
  'Belize': 'Belize', 'Mexico': 'Mexico', 'Cuba': 'Cuba', 'Jamaica': 'Jamaica',
  'Haiti': 'Haiti', 'Barbados': 'Barbados', 'Dominica': 'Dominica',
  'Grenada': 'Grenada', 'Saint Lucia': 'Saint Lucia',
  'Egypt': 'Egypt', 'Libya': 'Libya', 'Tunisia': 'Tunisia', 'Algeria': 'Algeria',
  'Morocco': 'Morocco', 'Mauritania': 'Mauritania', 'Mali': 'Mali', 'Niger': 'Niger',
  'Chad': 'Chad', 'Sudan': 'Sudan', 'Eritrea': 'Eritrea', 'Djibouti': 'Djibouti',
  'Ethiopia': 'Ethiopia', 'Somalia': 'Somalia', 'Kenya': 'Kenya',
  'Uganda': 'Uganda', 'Rwanda': 'Rwanda', 'Burundi': 'Burundi',
  'Tanzania': 'Tanzania', 'Mozambique': 'Mozambique', 'Malawi': 'Malawi',
  'Zambia': 'Zambia', 'Zimbabwe': 'Zimbabwe', 'Botswana': 'Botswana',
  'Namibia': 'Namibia', 'South Africa': 'South Africa', 'Lesotho': 'Lesotho',
  'Angola': 'Angola', 'Cameroon': 'Cameroon', 'Nigeria': 'Nigeria',
  'Benin': 'Benin', 'Togo': 'Togo', 'Ghana': 'Ghana', 'Senegal': 'Senegal',
  'Guinea': 'Guinea', 'Liberia': 'Liberia', 'Sierra Leone': 'Sierra Leone',
  'Madagascar': 'Madagascar', 'Mauritius': 'Mauritius', 'Comoros': 'Comoros',
  'Seychelles': 'Seychelles', 'Gabon': 'Gabon', 'Congo': 'Republic of the Congo',
  'Azerbaijan': 'Azerbaijan', 'Armenia': 'Armenia', 'Switzerland': 'Switzerland',
  'Norway': 'Norway', 'Iceland': 'Iceland', 'Liechtenstein': 'Liechtenstein',
  'Monaco': 'Monaco', 'San Marino': 'San Marino', 'Vatican': 'Vatican City',
  'Luxembourg': 'Luxembourg', 'Netherlands': 'Netherlands',
  'Ireland': 'Ireland', 'Austria': 'Austria', 'Denmark': 'Denmark',
  'Sweden': 'Sweden', 'Finland': 'Finland', 'Portugal': 'Portugal',
  'Spain': 'Spain', 'France': 'France', 'Germany': 'Germany',
  'Italy': 'Italy', 'Greece': 'Greece', 'Hungary': 'Hungary',
  'Romania': 'Romania', 'Bulgaria': 'Bulgaria', 'Poland': 'Poland',
  'Estonia': 'Estonia', 'Latvia': 'Latvia', 'Lithuania': 'Lithuania',
  'Cyprus': 'Cyprus', 'Malta': 'Malta', 'Belgium': 'Belgium',
  'Canada': 'Canada', 'Australia': 'Australia', 'New Zealand': 'New Zealand',
  'Papua New Guinea': 'Papua New Guinea', 'Fiji': 'Fiji',
  'Marshall Islands': 'Marshall Islands', 'Solomon Islands': 'Solomon Islands',
  'Vanuatu': 'Vanuatu', 'Samoa': 'Samoa', 'Tonga': 'Tonga', 'Kiribati': 'Kiribati',
  'Tuvalu': 'Tuvalu', 'Nauru': 'Nauru', 'Palau': 'Palau',
};

const norm = (s) => {
  if (!s) return '';
  s = s.trim();
  if (ALIASES[s]) return ALIASES[s];
  return s;
};

// Construir lookup por país. Conservamos también los países con salario
// None (sin mínimo legal nacional) para pintarlos en gris con nota.
const wageMap = {};
const noWage = new Set();
for (const w of WAGE) {
  const n = norm(w.country);
  if (w.annual_usd == null || w.annual_usd <= 0) {
    noWage.add(n);
    continue;
  }
  wageMap[n] = w.annual_usd;
}

// Tramos de color (choropleth): 5 tramos de salario anual US$
// <1000, 1000-4000, 4000-10000, 10000-20000, >20000
const buckets = [
  { max: 1000, color: '#fee5d9', label: '< $1,000' },
  { max: 4000, color: '#fcae91', label: '$1K–4K' },
  { max: 10000, color: '#fb6a4a', label: '$4K–10K' },
  { max: 20000, color: '#de2d26', label: '$10K–20K' },
  { max: Infinity, color: '#a50f15', label: '> $20K' },
];
const colorFor = (v) => buckets.find((b) => v < b.max).color;

const features = [];
let matched = 0, unmatched = 0, noWageCount = 0;
const missing = [];
for (const f of GEO.features) {
  const name = f.properties && f.properties.name;
  const n = norm(name);
  let wage = wageMap[n];
  const no = noWage.has(n);
  if (wage == null && !no) {
    missing.push(name);
    unmatched++;
    continue;
  }
  if (no) noWageCount++;
  if (wage != null) matched++;
  f.properties._manaName = name;
  f.properties.name = name;
  if (wage != null) {
    const bucket = buckets.find((b) => wage < b.max);
    f.properties._manaColor = bucket.color;
    f.properties.minimum_wage_annual_usd = wage;
    f.properties.minimum_wage_bucket = bucket.label;
  } else {
    f.properties._manaColor = '#d9d9d9';
    f.properties.minimum_wage_annual_usd = null;
    f.properties.minimum_wage_bucket = 'No national minimum wage';
  }
  f.properties._manaFillOpacity = 0.85;
  f.properties._manaGeometryType = 'polygon';
  features.push(f);
}
console.log('paises con geometria:', GEO.features.length);
console.log('unidos con salario:', matched);
console.log('sin minimo nacional (gris):', noWageCount);
console.log('sin salario (excluidos):', unmatched, missing.slice(0, 12).join(', '));

// Añadir países con salario pero sin geometría (puntos) para no perderlos
let pointAdded = 0;
for (const [n, wage] of Object.entries(wageMap)) {
  if (features.some((f) => f.properties.name === n)) continue;
  pointAdded++;
}

const slug = 'minimum-wage-by-country';
const map = {
  id: slug,
  slug: slug,
  title: 'Minimum Wage by Country',
  name: 'Minimum Wage by Country',
  createdBy: 'maña-maps',
  ownerUid: 'maña-maps',
  authorHandle: '',
  lang: 'en',
  featureCount: features.length,
  visibility: 'public',
  shareMode: 'view',
  allowPublicEdit: false,
  isPublished: true,
  geojsonText: JSON.stringify({ type: 'FeatureCollection', features }),
  geojsonChunked: null,
  createdAtMs: Date.now(),
  updatedAtMs: Date.now(),
  views: 0,
  likes: 0,
};

const outPath = path.join(REPO, 'data/gallery-minwage.js');
fs.writeFileSync(outPath, 'window.MANA_MINWAGE_MAP = ' + JSON.stringify(map) + ';\n');
console.log('escrito:', outPath);
console.log('tamaño GeoJSON:', Math.round(map.geojsonText.length / 1024), 'KB');
