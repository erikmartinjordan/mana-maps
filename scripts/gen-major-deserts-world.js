#!/usr/bin/env node
// ── gen-major-deserts-world.js ─
// Genera data/major-deserts-world.geojson con polígonos reales para los 15
// principales desiertos del mundo. ANTES el mapa usaba 15 features Point
// aproximados a mano, lo que incumple AGENTS.md §2/§9 (un área —país,
// desierto, región— nunca se representa con un punto: exige polígono real).
//
// Fuentes de geometría (AGENTS.md §2 «geometrías oficiales recortadas»):
//  • WWF Terrestrial Ecoregions of the World (Olson et al., 2001), servidas
//    por ArcGIS Online: ecorregiones del bioma «Deserts & Xeric Shrublands»
//    (bioma 13) + «Patagonian steppe» (bioma 8, clasificada como estepa
//    templada, pero es el desierto patagónico).
//  • Natural Earth 1:50m (land + antarctic ice shelves) para la Antártida.
// Por desierto: unión (turf.union) de sus ecorregiones, simplify con
// tolerancia 0.03° (con fallback si introduce kinks), redondeo a 3
// decimales y descarte de partes pequeñas (área ≥ max(25°², 40 % de la
// parte mayor)) para evitar etiquetas duplicadas — AGENTS.md §2.
//
// Requiere la devDependency @turf/turf.
// Uso: node scripts/gen-major-deserts-world.js

'use strict';

const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');

const OUT_PATH = path.join(__dirname, '..', 'data', 'major-deserts-world.geojson');

const TEOW_QUERY =
  'https://services5.arcgis.com/0AFsQflykfA9lXZn/arcgis/rest/services/' +
  'WWF_Terrestrial_Ecoregions_Of_The_World_official_teow/FeatureServer/0/query';
const NE_BASE =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';

const SIMPLIFY_TOLERANCE = 0.03; // grados (~3 km)
const MIN_PART_DEG2 = 25;        // umbral mínimo de partes (AGENTS.md §2)
const MIN_PART_SHARE = 0.4;      // 40 % de la parte mayor (AGENTS.md §2)
const COORD_DECIMALS = 3;        // ~110 m — reduce peso sin pérdida visible

// ── Selección de ecorregiones TEOW por desierto ─────────────────────
// { eco } selecciona todas las partes de la ecorregión; { eco, part }
// selecciona una sola parte por índice (Karakum/Kyzylkum: la ecorregión
// «Central Asian southern desert» viene ya partida en dos polígonos
// separados por el valle del Amu Darya: parte 1 = Karakum (oeste),
// parte 0 = Kyzylkum (este)).
const eco = (name, part = null) => ({ eco: name, part });

const DESERTS = [
  {
    name: 'Sahara',
    groupName: 'Desiertos cálidos', groupId: 1, type: 'Cálido', color: '#d97706',
    continent: 'África', area: '9.2 million km²',
    countries: 'Algeria, Egypt, Libya, Mali, Niger, Chad, Sudan, Morocco, Tunisia',
    description: 'Sahara: El desierto cálido más grande de la Tierra. Cubre la mayor parte del norte de África. Temperaturas extremas que pueden superar los 50 °C. Hogar de asentamientos oásiticos dispersos.',
    sources: [
      eco('Sahara desert'),
      eco('North Saharan steppe and woodlands'),
      eco('South Saharan steppe and woodlands'),
      eco('West Saharan montane xeric woodlands'),
      eco('East Saharan montane xeric woodlands'),
      eco('Tibesti-Jebel Uweinat montane xeric woodlands'),
    ],
  },
  {
    name: 'Desierto arábigo',
    groupName: 'Desiertos cálidos', groupId: 1, type: 'Cálido', color: '#d97706',
    continent: 'Asia', area: '2.3 million km²',
    countries: 'Saudi Arabia, Yemen, Oman, UAE, Qatar, Kuwait, Iraq',
    description: "Desierto arábigo: Incluye el Rub' al Khali (El Cuarto Vacío), la mayor masa de arena continua de la Tierra. Rico en reservas de petróleo.",
    sources: [
      eco('Arabian Desert and East Sahero-Arabian xeric shrublands'),
      eco('Arabian Peninsula coastal fog desert'),
      eco('Gulf of Oman desert and semi-desert'),
      eco('Persian Gulf desert and semi-desert'),
    ],
  },
  {
    name: 'Desierto de Gobi',
    groupName: 'Desiertos fríos', groupId: 2, type: 'Frío', color: '#7c3aed',
    continent: 'Asia', area: '1.3 million km²',
    countries: 'China, Mongolia',
    description: 'Desierto de Gobi: Un desierto frío que se extiende por el sur de Mongolia y el norte de China. Parte de la antigua Ruta de la Seda. Famoso por descubrimientos de fósiles de dinosaurios.',
    sources: [
      eco('Alashan Plateau semi-desert'),
      eco('Gobi Lakes Valley desert steppe'),
      eco('Great Lakes Basin desert steppe'),
      eco('Eastern Gobi desert steppe'),
    ],
  },
  {
    name: 'Desierto del Kalahari',
    groupName: 'Desiertos cálidos', groupId: 1, type: 'Cálido', color: '#d97706',
    continent: 'África', area: '900,000 km²',
    countries: 'Botswana, Namibia, South Africa',
    description: 'Desierto del Kalahari: Una sabana semiárida y arenosa que cubre gran parte de Botsuana. Hogar del pueblo San y una diversa fauna silvestre que incluye suricatas y chacales pardos.',
    sources: [eco('Kalahari xeric savanna')],
  },
  {
    name: 'Desierto patagónico',
    groupName: 'Desiertos fríos', groupId: 2, type: 'Frío', color: '#7c3aed',
    continent: 'Sudamérica', area: '673,000 km²',
    countries: 'Argentina, Chile',
    description: 'Desierto patagónico: El desierto más grande de las Américas. Formado por la sombra pluviométrica de los Andes. Rico en fósiles de dinosaurios y fauna esteparia.',
    sources: [eco('Patagonian steppe')],
  },
  {
    name: 'Gran Desierto de Victoria',
    groupName: 'Desiertos cálidos', groupId: 1, type: 'Cálido', color: '#d97706',
    continent: 'Oceania', area: '348,750 km²',
    countries: 'Australia',
    description: 'Gran Desierto de Victoria: El desierto más grande de Australia. Presenta dunas de arena, praderas y lagos salados. Una área silvestre protegida.',
    sources: [eco('Great Victoria desert')],
  },
  {
    name: 'Desierto sirio',
    groupName: 'Desiertos cálidos', groupId: 1, type: 'Cálido', color: '#d97706',
    continent: 'Asia', area: '500,000 km²',
    countries: 'Syria, Jordan, Iraq, Saudi Arabia',
    description: 'Desierto sirio: Un meseta estéril que conecta la Media Luna Fértil. Históricamente vital como ruta de caravanas que conectaba Mesopotamia con el Mediterráneo.',
    sources: [eco('Mesopotamian shrub desert')],
  },
  {
    name: 'Gran Cuenca',
    groupName: 'Desiertos fríos', groupId: 2, type: 'Frío', color: '#7c3aed',
    continent: 'Norteamérica', area: '492,000 km²',
    countries: 'United States',
    description: 'Gran Cuenca: El desierto más grande de EE.UU. Nombrado por las cuencas endorreicas. Presenta estepa de artemisa y el Gran Lago Salado.',
    sources: [eco('Great Basin shrub steppe')],
  },
  {
    name: 'Desierto de Chihuahua',
    groupName: 'Desiertos cálidos', groupId: 1, type: 'Cálido', color: '#d97706',
    continent: 'Norteamérica', area: '450,000 km²',
    countries: 'Mexico, United States',
    description: 'Desierto de Chihuahua: El desierto con mayor diversidad biológica de Norteamérica. Conocido por sus agaves, yucas y el hábitat del lobo mexicano.',
    sources: [eco('Chihuahuan desert')],
  },
  {
    name: 'Desierto de Kara-Kum',
    groupName: 'Desiertos cálidos', groupId: 1, type: 'Cálido', color: '#d97706',
    continent: 'Asia', area: '350,000 km²',
    countries: 'Turkmenistan',
    description: 'Desierto de Kara-Kum: Cubre el 70% de Turkmenistán. Hogar del cráter de gas de Darvaza, la "Puerta del Infierno", ardiendo desde 1971.',
    sources: [eco('Central Asian southern desert', 1)],
  },
  {
    name: 'Desierto de Kyzyl-Kum',
    groupName: 'Desiertos cálidos', groupId: 1, type: 'Cálido', color: '#d97706',
    continent: 'Asia', area: '298,000 km²',
    countries: 'Uzbekistan, Kazakhstan, Turkmenistan',
    description: 'Desierto de Kyzyl-Kum: Ubicado entre los ríos Amu Daria y Syr Daria. El antiguo templo zoroástrico de fuego de Chilpyk se erige en su interior.',
    sources: [eco('Central Asian southern desert', 0)],
  },
  {
    name: 'Desierto de Thar',
    groupName: 'Desiertos cálidos', groupId: 1, type: 'Cálido', color: '#d97706',
    continent: 'Asia', area: '200,000 km²',
    countries: 'India, Pakistan',
    description: 'Desierto de Thar: El desierto más densamente poblado del mundo. Rico patrimonio cultural con festivales vibrantes y textiles coloridos.',
    sources: [eco('Thar desert')],
  },
  {
    name: 'Desierto de Sonora',
    groupName: 'Desiertos cálidos', groupId: 1, type: 'Cálido', color: '#d97706',
    continent: 'Norteamérica', area: '310,000 km²',
    countries: 'Mexico, United States',
    description: 'Desierto de Sonora: Conocido por sus icónicos cactus saguaro. Se extiende por Arizona, California y Sonora. Dos temporadas de lluvias sustentan una rica biodiversidad.',
    sources: [eco('Sonoran desert')],
  },
  {
    name: 'Desierto antártico',
    groupName: 'Desiertos fríos', groupId: 2, type: 'Frío', color: '#7c3aed',
    continent: 'Antártida', area: '14.2 million km²',
    countries: 'Antarctica (international territory)',
    description: 'Desierto antártico: El desierto más grande de la Tierra por superficie. Recibe menos de 50 mm de precipitación al año. 98% cubierto por una capa de hielo de 2.160 m de espesor medio.',
    sources: [{ neAntarctica: true }],
  },
  {
    name: 'Desierto de Simpson',
    groupName: 'Desiertos cálidos', groupId: 1, type: 'Cálido', color: '#d97706',
    continent: 'Oceanía', area: '176,500 km²',
    countries: 'Australia',
    description: 'Desierto de Simpson: Famoso por sus largas dunas de arena paralelas, las dunas paralelas más largas del mundo. Nombrado en honor a Alfred Simpson.',
    sources: [eco('Simpson desert')],
  },
];

// ── Descargas ───────────────────────────────────────────────────────

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url.slice(0, 120)}`);
  return res.json();
}

const teowCache = new Map();

async function fetchTeowEco(name) {
  if (teowCache.has(name)) return teowCache.get(name);
  const url =
    `${TEOW_QUERY}?where=${encodeURIComponent(`ECO_NAME='${name}'`)}` +
    '&outFields=ECO_NAME&returnGeometry=true&outSR=4326&f=geojson';
  const fc = await fetchJson(url);
  const feats = (fc.features || []).filter(f => f.geometry);
  if (!feats.length) throw new Error(`TEOW: sin geometría para «${name}»`);
  teowCache.set(name, feats);
  return feats;
}

async function fetchAntarctica() {
  const land = await fetchJson(`${NE_BASE}ne_50m_land.geojson`);
  const shelves = await fetchJson(`${NE_BASE}ne_50m_antarctic_ice_shelves_polys.geojson`);
  const polys = [];
  const pushParts = (geom) => {
    if (!geom) return;
    if (geom.type === 'Polygon') polys.push(turf.polygon(geom.coordinates));
    else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach(r => polys.push(turf.polygon(r)));
    }
  };
  // Tierra firme al sur de 60° S (la Antártida en Natural Earth es una parte
  // separada del MultiPolygon de land; se filtra por latitud máxima).
  for (const f of land.features || []) {
    const g = f.geometry || {};
    const parts = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const rings of parts) {
      let maxLat = -90;
      for (const ring of rings) for (const c of ring) maxLat = Math.max(maxLat, c[1]);
      if (maxLat < -60) pushParts({ type: 'Polygon', coordinates: rings });
    }
  }
  // Plataformas de hielo flotantes (parte de la superficie del desierto
  // antártico: la cifra de 14,2 M km² las incluye).
  for (const f of shelves.features || []) pushParts(f.geometry);
  if (polys.length < 2) throw new Error('Natural Earth: sin geometría antártica');
  // Simplifica cada pieza ANTES de unir: son polígonos simples (sin
  // autocontactos), simplify no introduce kinks y la unión pesa menos.
  const simplified = polys.map(p => ({
    type: 'Feature', properties: {},
    geometry: simplifySafe(p.geometry, null),
  }));
  return turf.union(turf.featureCollection(simplified));
}

// ── Procesado de geometría (AGENTS.md §2) ───────────────────────────

// Área planar en grados² (heurística de tamaño, como en AGENTS.md §2).
function ringAreaDeg2(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a / 2);
}

// Área planar de una parte (array de anillos; exterior − huecos) en grados².
function partAreaDeg2(rings) {
  let a = ringAreaDeg2(rings[0]);
  for (let i = 1; i < rings.length; i++) a -= ringAreaDeg2(rings[i]);
  return Math.abs(a);
}

function toParts(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

function fromParts(parts) {
  if (!parts.length) return null;
  if (parts.length === 1) return { type: 'Polygon', coordinates: parts[0] };
  return { type: 'MultiPolygon', coordinates: parts };
}

// Área total (grados²) de una geometría sumando sus partes.
function totalAreaDeg2(geom) {
  return toParts(geom).reduce((s, p) => s + partAreaDeg2(p), 0);
}

function roundCoords(obj, dec = COORD_DECIMALS) {
  if (typeof obj === 'number') return Math.round(obj * 10 ** dec) / 10 ** dec;
  if (Array.isArray(obj)) return obj.map(roundCoords);
  return obj;
}

// Descarta partes pequeñas: conserva solo las de área ≥ max(25°², 40 % de
// la parte mayor) para evitar etiquetas duplicadas (AGENTS.md §2).
function dropSmallParts(geom, log) {
  const parts = toParts(geom);
  if (parts.length <= 1) return geom;
  const areas = parts.map(partAreaDeg2);
  const max = Math.max(...areas);
  const threshold = Math.max(MIN_PART_DEG2, MIN_PART_SHARE * max);
  let kept = parts.filter((_, i) => areas[i] >= threshold);
  if (!kept.length) {
    // Nunca se descarta el desierto entero: conserva la parte mayor.
    kept = [parts[areas.indexOf(max)]];
  }
  const dropped = parts.length - kept.length;
  if (dropped && log) {
    const droppedArea = areas.filter(a => a < threshold).reduce((s, a) => s + a, 0);
    log(`    partes descartadas: ${dropped} (≤ ${threshold.toFixed(1)}°², total ${droppedArea.toFixed(2)}°²)`);
  }
  return fromParts(kept);
}

// Simplifica con tolerancia fija; si introduce kinks (autointersecciones
// nuevas respecto de la geometría original —las ecorregiones de TEOW pueden
// tocarse en vértices compartidos), reintenta con tolerancia menor y
// finalmente devuelve la geometría original. Siempre devuelve una
// geometría (Polygon/MultiPolygon), nunca un Feature.
function simplifySafe(geomIn, log) {
  const geom = geomIn.type === 'Feature' ? geomIn.geometry : geomIn;
  let baseKinks = 0;
  try { baseKinks = turf.kinks(geom).features.length; } catch (_) { /* ignore */ }
  for (const tol of [SIMPLIFY_TOLERANCE, SIMPLIFY_TOLERANCE / 3, SIMPLIFY_TOLERANCE / 10]) {
    try {
      const s = turf.simplify(geom, { tolerance: tol, highQuality: false, mutate: false });
      const out = s.type === 'Feature' ? s.geometry : s;
      const k = turf.kinks(out).features.length;
      if (k <= baseKinks) return out;
      if (log) log(`    simplify ${tol}° introduce kinks (${k} > ${baseKinks}); se reintenta`);
    } catch (e) {
      if (log) log(`    simplify ${tol}° falla (${e.message.slice(0, 60)})`);
    }
  }
  return geom;
}

// Une ecorregiones, simplifica, redondea y limpia partes pequeñas.
// La simplificación se aplica a cada ecorregión ANTES de unir: cada una es
// un polígono simple (sin autocontactos), simplify no introduce kinks y el
// resultado unionado pesa mucho menos que simplificar la unión completa.
async function buildDesertGeometry(sources, log) {
  let geom;
  if (sources[0] && sources[0].neAntarctica) {
    geom = await fetchAntarctica();
  } else {
    const polys = [];
    for (const src of sources) {
      const feats = await fetchTeowEco(src.eco);
      const chosen = src.part == null ? feats : [feats[src.part]];
      if (!chosen || !chosen[0]) {
        throw new Error(`TEOW: parte ${src.part} inexistente en «${src.eco}» (${feats.length} partes)`);
      }
      for (const f of chosen) {
        polys.push({ type: 'Feature', properties: {}, geometry: simplifySafe(f.geometry, log) });
      }
    }
    geom = polys.length === 1
      ? polys[0].geometry
      : turf.union(turf.featureCollection(polys));
  }
  if (geom.type === 'Feature') geom = geom.geometry;
  geom = dropSmallParts(geom, log);
  geom = roundCoords(geom);
  return geom;
}

// ── Propiedades de cada feature ─────────────────────────────────────
// Se conservan los datos de popup ya publicados (Continente, Superficie,
// Países, Tipo y Description) y se actualiza lo necesario para polígonos:
// _manaGeometryType 'polygon', sin markerType (los desiertos son áreas,
// no puntos), fillOpacity/borde blanco fino y labelStyle centrado.
function buildProperties(d) {
  return {
    _manaName: d.name,
    name: d.name,
    _manaColor: d.color,
    _manaFillOpacity: 0.85,
    _manaBorderColor: '#FFFFFF',
    _manaWeight: 1,
    _manaOpacity: 1,
    _manaGroupName: d.groupName,
    _manaGroupId: d.groupId,
    _manaGeometryType: 'polygon',
    _manaLabelStyle: {
      enabled: true,
      field: 'name',
      fontFamily: 'DM Mono, monospace',
      fontSize: 11,
      color: '#ffffff',
      fontWeight: 'bold',
      fontStyle: 'normal',
      haloColor: '#000000',
      haloWidth: 3,
      opacity: 1,
      offsetX: 0,
      offsetY: 0,
      placement: 'point',
    },
    Continent: d.continent,
    Area: d.area,
    Countries: d.countries,
    Type: d.type,
    Description: d.description,
  };
}

// ── Validaciones previas (AGENTS.md §Estándar de publicación) ───────

function validate(geo) {
  const errors = [];
  if (geo.features.length !== 15) errors.push(`features=${geo.features.length} ≠ 15`);
  const names = new Set();
  for (const f of geo.features) {
    const p = f.properties;
    const name = p._manaName || p.name;
    if (!name) errors.push('feature sin nombre');
    if (names.has(name)) errors.push(`nombre duplicado: ${name}`);
    names.add(name);
    if (!/^#[0-9a-fA-F]{6}$/.test(p._manaColor)) errors.push(`${name}: color no hex`);
    if (!p._manaLabelStyle || !(p._manaLabelStyle.haloWidth >= 2)) {
      errors.push(`${name}: _manaLabelStyle sin haloWidth>=2`);
    }
    const t = f.geometry && f.geometry.type;
    if (t !== 'Polygon' && t !== 'MultiPolygon') errors.push(`${name}: geometría ${t}, se exige polígono`);
    (function walk(c) {
      if (typeof c[0] === 'number') {
        if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) errors.push(`${name}: coord fuera de rango`);
      } else c.forEach(walk);
    })(f.geometry.coordinates);
    if (!p.Continent || !p.Area || !p.Countries || !p.Description) {
      errors.push(`${name}: popup sin datos concretos (§5)`);
    }
  }
  const geojsonText = JSON.stringify(geo);
  if (Buffer.byteLength(geojsonText, 'utf8') > 1024 * 1024) {
    errors.push(`geojsonText >1 MiB (${Buffer.byteLength(geojsonText, 'utf8')} bytes)`);
  }
  return errors;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('=== gen-major-deserts-world.js ===\n');
  const features = [];
  for (const d of DESERTS) {
    const t0 = Date.now();
    const geom = await buildDesertGeometry(d.sources, console.log);
    const parts = toParts(geom).length;
    const pts = (function count(c) {
      return typeof c[0] === 'number' ? 1 : c.reduce((s, x) => s + count(x), 0);
    })(geom.coordinates);
    const deg2 = totalAreaDeg2(geom);
    const kb = (Buffer.byteLength(JSON.stringify(geom), 'utf8') / 1024).toFixed(1);
    console.log(
      `  ${d.name}: ${geom.type}, ${parts} parte(s), ${pts} pts, ` +
      `${deg2.toFixed(1)}°², ${kb} KB, ${Date.now() - t0} ms`
    );
    features.push({ type: 'Feature', properties: buildProperties(d), geometry: geom });
  }

  const geo = { type: 'FeatureCollection', features };
  const errors = validate(geo);
  if (errors.length) {
    console.error('\n✗ Validación fallida:');
    for (const e of errors) console.error('  -', e);
    process.exit(1);
  }

  const geojsonText = JSON.stringify(geo);
  console.log(`\n✓ 15 features válidas | ${(Buffer.byteLength(geojsonText, 'utf8') / 1024).toFixed(1)} KiB`);
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geo, null, 1) + '\n');
  console.log(`✓ escrito ${path.relative(process.cwd(), OUT_PATH)}`);
}

if (require.main === module) {
  main().catch(e => { console.error('Fatal:', e); process.exit(1); });
}

module.exports = { DESERTS, validate, buildDesertGeometry };
