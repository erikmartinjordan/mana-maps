#!/usr/bin/env node
// ── gen-biggest-earthquakes-world.js ─
// Genera data/biggest-earthquakes-world.geojson a partir del catálogo FDSN
// del USGS Earthquake Hazards Program (ComCat): todos los eventos M≥8 desde
// 1700. Una feature Point por epicentro real, markerType emoji_warning,
// icono escalado por magnitud (_manaEmojiSize) y rampa monocromática roja
// ordenada por la magnitud (AGENTS.md §3).
//
// Uso:
//   node scripts/gen-biggest-earthquakes-world.js [--fetch]
//
// Sin --fetch usa el volcado crudo cacheado en
// ~/autopilot/strategy/data/biggest-earthquakes-world/usgs-m8-raw-1700.geojson.

'use strict';

const fs = require('fs');
const path = require('path');

const SLUG = 'biggest-earthquakes-world';
const USGS_URL =
  'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=8' +
  '&starttime=1700-01-01&endtime=2026-10-06&orderby=magnitude&limit=2000';
const RAW_CACHE = path.join(
  require('os').homedir(),
  'autopilot/strategy/data/biggest-earthquakes-world/usgs-m8-raw-1700.geojson'
);
const OUT_PATH = path.join(__dirname, '..', 'data', `${SLUG}.geojson`);

// ── Nombres en español por id de evento USGS ───────────────────────
// Criterio: minúsculas tipo oración (solo primera palabra y nombres propios
// en mayúscula). Se evitan palabras de área (islas, penínsulas, mares…) en
// el nombre para no confundir la auditoría §2 (entidad-área con punto).
const NAME_BY_EID = {
  official19600522191120_30: 'Terremoto de Valdivia de 1960 (Chile)',
  official19640328033616_30: 'Terremoto del Príncipe William Sound de 1964 (Alaska)',
  official20041226005853450_30: 'Terremoto del Índico de 2004 (Sumatra)',
  official20110311054624120_30: 'Terremoto de Tōhoku de 2011 (Japón)',
  official17000127050000000: 'Terremoto de Cascadia de 1700',
  official19521104165830_30: 'Terremoto de Kamchatka de 1952',
  us6000qw60: 'Terremoto de Kamchatka de 2025',
  official19060131153610_30: 'Terremoto de Ecuador y Colombia de 1906',
  official20100227063411530_30: 'Terremoto del Maule de 2010 (Chile)',
  official19650204050122_30: 'Terremoto de Aleutianas de 1965',
  official19460401122901_30: 'Terremoto de Unimak de 1946 (Alaska)',
  official19500815140934_30: 'Terremoto de Assam y Tíbet de 1950',
  official20120411083836720_20: 'Terremoto de Wharton de 2012',
  official20050328160936530_30: 'Terremoto de Singkil de 2005 (Indonesia)',
  official19570309142233_30: 'Terremoto de Atka de 1957 (Alaska)',
  official18430208145000000: 'Terremoto de Guadalupe de 1843',
  official19221111043251_30: 'Terremoto de Vallenar de 1922 (Chile)',
  official19380201190422_30: 'Terremoto de Banda de 1938',
  official19631013051759_30: 'Terremoto de Kuriles de 1963',
  official19230203160150_30: 'Terremoto de Kamchatka de 1923',
  official20010623203314130_33: 'Terremoto de Atico de 2001 (Perú)',
  official19330302173100_30: 'Terremoto de Sanriku de 1933 (Japón)',
  official20070912111026830_34: 'Terremoto de Bengkulu de 2007 (Indonesia)',
  iscgem16957865: 'Terremoto de Bulnay de 1905 (Mongolia)',
  iscgem913230: 'Terremoto de Mindanao de 1918 (Filipinas)',
  us20003k7a: 'Terremoto de Illapel de 2015 (Chile)',
  usp000exfn: 'Terremoto de Kuriles de 2006',
  iscgem16957912: 'Terremoto de Aleutianas de 1906',
  official19581106225809_30: 'Terremoto de Kuriles de 1958',
  iscgem898698: 'Terremoto de Shikotan de 1946',
  iscgem694739: 'Terremoto de Sumba de 1977 (Indonesia)',
  usp0006kdp: 'Terremoto de Shikotan de 1994 (Rusia)',
  usb000h4jh: 'Terremoto de Ojotsk de 2013',
  iscgem912519: 'Terremoto de Hualien de 1920 (Taiwán)',
  official19381110201849000_35: 'Terremoto de Semidi de 1938 (Alaska)',
  ak0219neiszm: 'Terremoto de Chignik de 2021 (Alaska)',
  iscgem805430: 'Terremoto al este de Hokkaido de 1969 (Japón)',
  iscgem913483: 'Terremoto de Kermadec de 1917 (Nueva Zelanda)',
  iscgem901374: 'Terremoto de Huacho de 1940 (Perú)',
  iscgemsup16957911: 'Terremoto de Valparaíso de 1906 (Chile)',
  iscgem821946: 'Terremoto de Tokachi de 1968 (Japón)',
  iscgem896170: 'Terremoto de Antofagasta de 1950 (Chile)',
  iscgem861299: 'Terremoto de Ceram de 1965',
  iscgem16957943: 'Terremoto de Sumatra de 1907',
  usp0006dzc: 'Terremoto de Reyes de 1994 (Bolivia)',
  us1000gcii: 'Terremoto de Fiyi de 2018',
  us2000ahv0: 'Terremoto de Tehuantepec de 2017 (México)',
  usp000jhjb: 'Réplica de Wharton de 2012',
  usc000nzvd: 'Terremoto de Iquique de 2014 (Chile)',
  official18990904002200000: 'Terremoto de Yakutat de 1899 (Alaska, primer gran sismo)',
  official18990910214100000: 'Terremoto de Yakutat de 1899 (Alaska, sismo principal)',
  official20030925195006360_27: 'Terremoto de Tokachi de 2003 (Japón)',
  iscgem913984: 'Terremoto de Biak de 1914 (Indonesia)',
  iscgem912783: 'Terremoto de Papúa Nueva Guinea de 1919',
  iscgem910911: 'Terremoto de Mindanao de 1924 (Filipinas)',
  us6000f53e: 'Terremoto de Sandwich del Sur de 2021',
  us7000dflf: 'Terremoto de Kermadec de 2021 (Nueva Zelanda)',
  iscgem912773: 'Terremoto de Tonga de 1919',
  iscgem913260: 'Terremoto de Kuriles de 1918',
  iscgem908171: 'Terremoto de Sandwich del Sur de 1929',
  iscgem899647: 'Terremoto de Tōankai de 1944 (Japón)',
  iscgem887636: 'Terremoto del Altái mongol de 1957',
  iscgem899789: 'Terremoto de Illapel de 1943 (Chile)',
  iscgem899220: 'Terremoto de Makrán de 1945',
  iscgem16958079: 'Terremoto de Taiwán de 1910',
  iscgem900444: 'Terremoto de Minas de Marcona de 1942 (Perú)',
  iscgem782684: 'Terremoto de Bougainville de 1971',
  usp0008hzd: 'Terremoto de Balleny de 1998',
  usp000f83m: 'Terremoto de Salomón de 2007',
  iscgem906183: 'Terremoto de Jalisco de 1932 (México)',
  iscgem902275: 'Terremoto de Célebes de 1939 (Indonesia)',
  iscgem892540: 'Terremoto de Tokachi de 1952 (Japón)',
  iscgem17294492: 'Terremoto de Banda de 1963',
  iscgem879106: 'Predecesor del terremoto de Valdivia de 1960 (Cañete, Chile)',
  iscgem842581: 'Terremoto de Paramonga de 1966 (Perú)',
  usp000db93: 'Terremoto de Tasmania de 2004',
  usp000f2ab: 'Terremoto de Kuriles de 2007',
  usp000h1ys: 'Terremoto de Samoa de 2009',
  iscgem912618: 'Terremoto de Vanuatu de 1920',
  official19960217055930550_33: 'Terremoto de Biak de 1996 (Indonesia)',
  iscgem901083: 'Terremoto de Hyūganada de 1941 (Japón)',
  iscgem16958130: 'Terremoto de Kemin de 1911 (Kirguistán)',
  official19890523105446320_10: 'Terremoto de la dorsal Macquarie de 1989',
  iscgem913362: 'Terremoto de Diego de Almagro de 1918 (Chile)',
  cent19030104050700000: 'Terremoto profundo de Tonga de 1903',
  usp0002ccz: 'Terremoto de Valparaíso de 1985 (Chile)',
  iscgem900536: 'Terremoto de la dorsal del Sudoeste de la India de 1942',
  iscgem913548: 'Terremoto de Samoa y Tonga de 1917',
  iscgem904745: 'Terremoto de Bihar y Nepal de 1934',
  usp000714t: 'Terremoto de Antofagasta de 1995 (Chile)',
  iscgem16957920: 'Terremoto de Papúa Nueva Guinea de 1906',
  iscgem765501: 'Terremoto de Mindanao de 1972 (Filipinas)',
  usp00074vc: 'Terremoto de Colima-Jalisco de 1995 (México)',
  iscgem794176: 'Terremoto profundo de Perú de 1970',
  iscgem782181: 'Terremoto de Nueva Bretaña de 1971',
  usp000eg5g: 'Terremoto de Tonga de 2006',
  usp0000ee7: 'Terremoto de Kermadec de 1976 (Nueva Zelanda)',
  usp000a3qq: 'Terremoto de Nueva Irlanda de 2000',
  usp0002jwe: 'Terremoto de Michoacán de 1985 (México)',
  official19490822040118000_10: 'Terremoto de Haida Gwaii de 1949 (Canadá)',
  usp000fjta: 'Terremoto de San Vicente de Cañete de 2007 (Perú)',
  us60003sc0: 'Terremoto de Navarro de 2019 (Perú)',
  usp0002tmu: 'Terremoto de Atka de 1986 (Alaska)',
  usc000f1s0: 'Terremoto de Santa Cruz de 2013',
};

// Notas cortas (español) para los eventos más conocidos — el «ángulo» del mapa.
const NOTE_BY_EID = {
  official19600522191120_30:
    'Es el terremoto más potente jamás registrado por instrumentos. Generó un tsunami que cruzó el Pacífico hasta Japón.',
  official19640328033616_30:
    'El «Viernes Santo» de Alaska: el sismo más potente registrado en América del Norte, con tsunami local.',
  official20041226005853450_30:
    'Desencadenó el tsunami del océano Índico del 26 de diciembre de 2004, uno de los desastres naturales más mortíferos de la historia.',
  official20110311054624120_30:
    'Provocó el accidente nuclear de Fukushima y un tsunami devastador en la costa japonesa.',
  official17000127050000000:
    'Sismo histórico de la zona de subducción de Cascadia; su tsunami llegó hasta Japón y quedó registrado en crónicas locales.',
  official19521104165830_30:
    'Generó un tsunami transpacífico que alcanzó Hawái y la costa oeste de Estados Unidos.',
  us6000qw60:
    'Sismo de 2025 en la península de Kamchatka; generó avisos de tsunami en todo el Pacífico.',
  official20100227063411530_30:
    'Uno de los terremotos más largos jamás registrados (más de 3 minutos); generó un tsunami en el Pacífico.',
  official19650204050122_30:
    'Epicentro en las Rat Islands (Aleutianas); generó un tsunami que se propagó por todo el Pacífico.',
  official19500815140934_30:
    'Uno de los terremotos continentales más potentes del siglo XX, en la zona tectónica entre Assam y el Tíbet.',
  official18990904002200000:
    'Primer gran sismo de la secuencia de Yakutat Bay de 1899 (Alaska), registrada por mareógrafos y observadores de la época.',
  official18990910214100000:
    'Sismo principal de la secuencia de Yakutat Bay de 1899 (Alaska): levantó y hundió tierras costeras de forma medible.',
  iscgem879106:
    'El sismo previo al gran terremoto de Valdivia del 22 de mayo de 1960: muchos lo sintieron como el «terremoto» y no anticiparon el de 9,5 que vino al día siguiente.',
  usp000jhjb:
    'Réplica gigante de la secuencia de Wharton de 2012, con mecanismo de falla inversa en la corteza oceánica.',
  official19890523105446320_10:
    'Sismo profundo en la dorsal de Macquarie, al sur de Nueva Zelanda.',
  cent19030104050700000:
    'Sismo profundo en Tonga (≈400 km): uno de los registros históricos más profundos del catálogo USGS.',
  usp0008hzd: 'Sismo oceánico profundo en las islas Balleny, al sur del círculo polar antártico.',
};

const GROUP_NAME = 'Terremotos de magnitud ≥ 8';
const GROUP_ID = 1;
const MARKER_TYPE = 'emoji_warning';
const DATA_SOURCE =
  'USGS Earthquake Hazards Program — catálogo ComCat/FDSN (earthquake.usgs.gov), eventos de magnitud ≥ 8 desde 1700.';
const DATA_DATE = '2026-10-06';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fmtEs(n, dec = 1) {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = Number(n).toFixed(dec).replace(/\.0+$/, dec === 1 ? '' : '');
  return s.replace('.', ',');
}

function eventId(props) {
  const url = props.url || '';
  return url ? url.replace(/\/$/, '').split('/').pop() : `${props.net || ''}${props.code || ''}`;
}

// Rampa monocromática roja (claro→oscuro) por cuantiles de magnitud.
function monoRedRamp(steps = 6) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const l = 88 - t * 62;  // 88% → 26% luminosidad
    const s = 55 + t * 30;  // 55% → 85% saturación
    // hsl(0, s, l) → hex
    const c = (1 - Math.abs(2 * (l / 100) - 1)) * (s / 100);
    const x = c * (1 - Math.abs(((0 / 60) % 2) - 1));
    const m = l / 100 - c / 2;
    const r = Math.round((c + m) * 255);
    const g = Math.round((x + m) * 255);
    const b = Math.round((0 + m) * 255);
    const hx = (v) => v.toString(16).padStart(2, '0');
    out.push(`#${hx(r)}${hx(g)}${hx(b)}`);
  }
  return out;
}

function emojiSizeForMag(mag) {
  // 8.0 → 22 px ; 9.5 → 66 px (escala por magnitud, rango soportado 22-66)
  const t = Math.max(0, Math.min(1, (mag - 8) / 1.5));
  return Math.round(22 + t * 44);
}

function buildFeatures(raw) {
  const feats = raw.features || [];
  const sorted = feats.slice().sort((a, b) => (b.properties.mag || 0) - (a.properties.mag || 0));
  const mags = sorted.map((f) => f.properties.mag).filter((m) => Number.isFinite(m));
  const ramp = monoRedRamp(6);

  // Cuantiles de magnitud → paso de rampa (claro = menos potente)
  function colorForMag(mag) {
    const below = mags.filter((m) => m <= mag).length;
    const t = mags.length <= 1 ? 1 : (below - 1) / (mags.length - 1);
    const idx = Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))));
    return ramp[idx];
  }

  const out = [];
  const seenNames = new Set();
  for (const f of sorted) {
    const p = f.properties || {};
    const coords = (f.geometry && f.geometry.coordinates) || [];
    const lon = coords[0], lat = coords[1], depth = coords[2];
    const mag = p.mag;
    const eid = eventId(p);
    let name = NAME_BY_EID[eid] || null;
    if (!name) {
      // Fallback: «Sismo de {año} — {lugar USGS}» (sin traducir el lugar)
      const year = p.time ? new Date(p.time).getUTCFullYear() : '';
      name = `Sismo de ${year} — ${p.place || 'epicentro desconocido'}`;
    }
    let unique = name, dup = 2;
    while (seenNames.has(unique)) { unique = `${name} (${dup})`; dup++; }
    seenNames.add(unique);

    const year = p.time ? new Date(p.time).getUTCFullYear() : null;
    const dateIso = p.time ? new Date(p.time).toISOString().slice(0, 10) : null;
    const dateEs = dateIso
      ? `${Number(dateIso.slice(8, 10))} de ${MESES[Number(dateIso.slice(5, 7)) - 1]} de ${dateIso.slice(0, 4)}`
      : '—';
    const depthTxt = Number.isFinite(depth) ? `${fmtEs(depth, 1)} km` : 'desconocida';
    const magTxt = fmtEs(mag, 1);
    const tsunami = p.tsunami ? 'Sí' : 'No';
    const note = NOTE_BY_EID[eid] || '';
    const description =
      `Terremoto de magnitud ${magTxt} con epicentro real cerca de ${p.place || 'la zona registrada'}. ` +
      `Profundidad focal: ${depthTxt}. Fecha: ${dateEs}. Tsunami: ${tsunami}.` +
      (note ? ' ' + note : '');

    out.push({
      type: 'Feature',
      properties: {
        _manaName: unique,
        name: unique,
        _manaColor: colorForMag(mag),
        _manaFillOpacity: 0.9,
        _manaWeight: 1.2,
        _manaBorderColor: '#ffffff',
        _manaGeometryType: 'point',
        _manaGroupName: GROUP_NAME,
        _manaGroupId: GROUP_ID,
        markerType: MARKER_TYPE,
        _manaMarkerType: MARKER_TYPE,
        _manaEmojiSize: emojiSizeForMag(mag),
        _manaLabelStyle: {
          enabled: true,
          field: '_manaName',
          fontFamily: 'monospace',
          fontSize: 10,
          fontWeight: '600',
          color: '#0f172a',
          haloWidth: 3,
          haloColor: '#ffffff',
          opacity: 0.9,
          placement: 'auto',
        },
        // Datos concretos de popup (AGENTS.md §5) — claves en español
        Magnitud: mag,
        'Profundidad (km)': Number.isFinite(depth) ? depth : null,
        Año: year,
        Fecha: dateIso,
        'Lugar (USGS)': p.place || '—',
        Tsunami: tsunami,
        'Código USGS': eid,
        Dato: `M ${magTxt} · ${depthTxt} · ${year || '—'}`,
        Description: description,
      },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    });
  }
  return out;
}

async function loadRaw(fetchFresh) {
  if (!fetchFresh && fs.existsSync(RAW_CACHE)) {
    console.log('Usando volcado USGS cacheado:', RAW_CACHE);
    return JSON.parse(fs.readFileSync(RAW_CACHE, 'utf8'));
  }
  console.log('Descargando catálogo USGS FDSN…');
  const res = await fetch(USGS_URL);
  if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
  const data = await res.json();
  fs.mkdirSync(path.dirname(RAW_CACHE), { recursive: true });
  fs.writeFileSync(RAW_CACHE, JSON.stringify(data));
  console.log('Volcado guardado en', RAW_CACHE);
  return data;
}

async function main() {
  const fetchFresh = process.argv.includes('--fetch');
  const raw = await loadRaw(fetchFresh);
  const features = buildFeatures(raw);
  const geo = { type: 'FeatureCollection', features };

  // ── Validaciones AGENTS.md ──
  const hexOk = features.every((f) => /^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  const haloOk = features.every((f) => f.properties._manaLabelStyle && f.properties._manaLabelStyle.haloWidth >= 2);
  const markerOk = features.every((f) => f.properties.markerType === MARKER_TYPE && f.properties._manaMarkerType === MARKER_TYPE);
  const scaleOk = features.every((f) => Number.isFinite(f.properties._manaEmojiSize) && f.properties._manaEmojiSize >= 22 && f.properties._manaEmojiSize <= 66);
  const coordsOk = features.every((f) => {
    const [x, y] = f.geometry.coordinates;
    return x >= -180 && x <= 180 && y >= -90 && y <= 90;
  });
  const names = new Set(features.map((f) => f.properties._manaName));
  const uniqueOk = names.size === features.length;
  const popupOk = features.every((f) =>
    ['Magnitud', 'Año', 'Dato', 'Description'].every((k) => f.properties[k] != null && f.properties[k] !== '')
  );
  const magsOk = features.every((f) => Number.isFinite(f.properties.Magnitud) && f.properties.Magnitud >= 8);
  // Palabras de área prohibidas en el nombre (auditoría §2 del repo)
  const AREA_RE = /(?:^|\s)(?:desiertos?|pa[ií]ses?|regi[oó]ns?|islas?|oc[eé]anos?|mar de|mares?|lagos?|bosques?|glaciares?|pen[ií]nsulas?|archipi[eé]lagos?|deltas?|arrecifes?)\b/i;
  const areaNameOk = features.every((f) => !AREA_RE.test(f.properties._manaName));

  console.log(`features: ${features.length} | KB: ${(JSON.stringify(geo).length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | marker: ${markerOk} | escala: ${scaleOk}`);
  console.log(`coords: ${coordsOk} | nombres únicos: ${uniqueOk} | popups: ${popupOk} | M≥8: ${magsOk} | sin palabras de área: ${areaNameOk}`);
  const magVals = features.map((f) => f.properties.Magnitud);
  console.log(`magnitud: min ${fmtEs(Math.min(...magVals))} max ${fmtEs(Math.max(...magVals))}`);
  if (!hexOk || !haloOk || !markerOk || !scaleOk || !coordsOk || !uniqueOk || !popupOk || !magsOk || !areaNameOk) {
    console.error('VALIDATION FAILED');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geo));
  console.log('GeoJSON guardado en', OUT_PATH);

  // Resumen de los 10 más potentes (hook del mapa)
  console.log('\nTop 10:');
  for (const f of features.slice(0, 10)) {
    console.log(`  M${fmtEs(f.properties.Magnitud)} ${f.properties.Año} ${f.properties._manaName}`);
  }
}

main().catch((e) => { console.error('Fatal', e); process.exit(1); });
