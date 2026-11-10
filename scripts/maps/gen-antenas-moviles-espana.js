#!/usr/bin/env node
// ── gen-antenas-moviles-espana.js ─
// Genera data/maps/antenas-moviles-espana.geojson con todas las estaciones de
// telefonía móvil de España registradas en Infoantenas (Ministerio para la
// Transformación Digital y de la Función Pública — VCTEL).
//
// Infoantenas sirve los datos por sectores (la capa GeoJSON acepta un bbox y
// devuelve como máximo 1.000 estaciones), así que este script recorre España
// con un quadtree adaptativo: cada celda que devuelve 1.000 registros se
// subdivide hasta que deja de topar con el límite. Después deduplica por
// emplazamiento + operador y agrupa por operador y provincia en features
// MultiPoint. El visor genérico de la galería se encarga de agrupar (cluster)
// esos puntos al alejar el zoom y de mostrarlos individualmente al acercarse:
// el GeoJSON no se precomprime ni se agrega a mano.
//
// Fuente: https://geoportal.minetur.gob.es/VCTEL/vcne.do
// Uso:
//   node scripts/maps/gen-antenas-moviles-espana.js [--refresh]
//
// La descarga cruda se cachea fuera del repo en
// ~/.cache/mana-maps/antenas-moviles-espana-raw.json (13 MB aprox.).

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const SLUG = 'antenas-moviles-espana';
const OUT_PATH = path.join(__dirname, '..', '..', 'data', 'maps', `${SLUG}.geojson`);
const CACHE_PATH = path.join(os.homedir(), '.cache', 'mana-maps', `${SLUG}-raw.json`);
const REFRESH = process.argv.includes('--refresh');

const ENDPOINT = 'https://geoportal.minetur.gob.es/VCTEL/infoantenasGeoJSON.do';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120 Safari/537.36';
const INITIAL_BBOX = [-20.0388, 27.0, 12.631, 53.8336];
const MIN_SPAN = 0.0015;
const MAX_DEPTH = 18;
const MAX_FEATURES_PER_REQUEST = 1000;

const DATA_SOURCE =
  'Ministerio para la Transformación Digital y de la Función Pública — ' +
  'Infoantenas, Servicio de Información sobre Instalaciones Radioeléctricas y ' +
  'Niveles de Exposición (VCTEL), https://geoportal.minetur.gob.es/VCTEL/vcne.do ' +
  '(consultado el 9 de noviembre de 2026).';
const DATA_DATE = '2026-11-09';

// Colores de marca de cada operador (categórico, no una rampa de volumen).
const BRAND_COLORS = {
  Vodafone: '#E60000',
  Movistar: '#0066CC',
  Orange: '#F57C00',
  Digi: '#2E7D32',
  Yoigo: '#7B1FA2',
  Otros: '#6B7280',
};

const PROVINCE_DISPLAY = {
  'ALICANTE/ALACANT': 'Alicante',
  'ARABA/ÁLAVA': 'Álava',
  'CASTELLÓN/CASTELLÓ': 'Castellón',
  'CORUÑA (A)': 'A Coruña',
  'PALMAS (LAS)': 'Las Palmas',
  'RIOJA (LA)': 'La Rioja',
  'VALENCIA/VALÈNCIA': 'Valencia',
  'ILLES BALEARS': 'Illes Balears',
  'BIZKAIA': 'Bizkaia',
  'GIPUZKOA': 'Gipuzkoa',
  'SANTA CRUZ DE TENERIFE': 'Santa Cruz de Tenerife',
  'CIUDAD REAL': 'Ciudad Real',
};

function fmt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function round(v, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

function labelStyle() {
  return {
    enabled: false,
    field: '_manaName',
    fontFamily: 'sans-serif',
    fontSize: 11,
    fontWeight: '600',
    color: '#0f172a',
    haloWidth: 3,
    haloColor: '#ffffff',
    opacity: 0.9,
    placement: 'auto',
  };
}

// ── Descarga adaptativa ──────────────────────────────────────────

function httpGet(url, tries = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': USER_AGENT, Referer: 'https://geoportal.minetur.gob.es/VCTEL/vcne.do' },
        timeout: 60000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
          const txt = Buffer.concat(chunks).toString('latin1');
          try {
            resolve(JSON.parse(txt));
          } catch (e) {
            reject(new Error('JSON inválido: ' + txt.slice(0, 120)));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', async (e) => {
      if (tries > 1) {
        await new Promise((r) => setTimeout(r, 900));
        try {
          resolve(await httpGet(url, tries - 1));
        } catch (e2) {
          reject(e2);
        }
      } else reject(e);
    });
  });
}

function geojsonUrl(bbox) {
  const b = bbox.map((v) => v.toFixed(6)).join(',');
  return `${ENDPOINT}?idCapa=null&bbox=${b}&zoom=7`;
}

function legalOperator(cod) {
  return String(cod || '').split(' - ')[0].trim();
}

async function fetchAll() {
  const rows = new Map();
  let requests = 0;
  let cappedAtMinSpan = 0;

  function addFeatures(features) {
    for (const f of features || []) {
      const p = f.properties || {};
      const id = String(p.Gis_ID || '').trim();
      const cod = String(p.Gis_Codigo || '').trim();
      const op = legalOperator(cod);
      if (!id || !op) continue;
      const key = id + '|' + op;
      if (rows.has(key)) continue;
      const lat = Number(p.Gis_Latitud);
      const lng = Number(p.Gis_Longitud);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      rows.set(key, { id, op, lat, lng, addr: p['Dirección'] || '', cod });
    }
  }

  async function fetchCell(bbox, depth) {
    const data = await httpGet(geojsonUrl(bbox));
    requests++;
    const n = Array.isArray(data.features) ? data.features.length : 0;
    const w = bbox[2] - bbox[0];
    const h = bbox[3] - bbox[1];
    if (n >= MAX_FEATURES_PER_REQUEST && depth < MAX_DEPTH && w > MIN_SPAN && h > MIN_SPAN) {
      const mx = (bbox[0] + bbox[2]) / 2;
      const my = (bbox[1] + bbox[3]) / 2;
      const kids = [
        [bbox[0], bbox[1], mx, my],
        [mx, bbox[1], bbox[2], my],
        [bbox[0], my, mx, bbox[3]],
        [mx, my, bbox[2], bbox[3]],
      ];
      for (const k of kids) await fetchCell(k, depth + 1);
    } else {
      if (n >= MAX_FEATURES_PER_REQUEST) cappedAtMinSpan++;
      addFeatures(data.features);
    }
  }

  const seeds = [];
  const NX = 4;
  const NY = 3;
  for (let ix = 0; ix < NX; ix++) {
    for (let iy = 0; iy < NY; iy++) {
      const x0 = INITIAL_BBOX[0] + ((INITIAL_BBOX[2] - INITIAL_BBOX[0]) * ix) / NX;
      const x1 = INITIAL_BBOX[0] + ((INITIAL_BBOX[2] - INITIAL_BBOX[0]) * (ix + 1)) / NX;
      const y0 = INITIAL_BBOX[1] + ((INITIAL_BBOX[3] - INITIAL_BBOX[1]) * iy) / NY;
      const y1 = INITIAL_BBOX[1] + ((INITIAL_BBOX[3] - INITIAL_BBOX[1]) * (iy + 1)) / NY;
      seeds.push([x0, y0, x1, y1]);
    }
  }

  let idx = 0;
  const workers = new Array(4).fill(0).map(async () => {
    while (idx < seeds.length) {
      const seed = seeds[idx++];
      await fetchCell(seed, 0);
    }
  });
  await Promise.all(workers);

  const out = [...rows.values()];
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(out));
  console.log(`Descarga: ${requests} peticiones · ${out.length} registros · caché ${CACHE_PATH}`);
  if (cappedAtMinSpan) {
    console.warn(`AVISO: ${cappedAtMinSpan} celdas siguen topando con 1.000 registros al tamaño mínimo.`);
  }
  return out;
}

function loadRows() {
  if (!REFRESH && fs.existsSync(CACHE_PATH)) {
    console.log('Usando caché', CACHE_PATH);
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  }
  return fetchAll();
}

// ── Normalización ────────────────────────────────────────────────

function brandOf(cod) {
  const op = legalOperator(cod).toUpperCase();
  if (op.startsWith('TELEFONICA MOVILES')) return 'Movistar';
  if (op.startsWith('VODAFONE ESPA')) return 'Vodafone';
  if (op.startsWith('ORANGE ESPAGNE') || op.startsWith('RETEVISION MOVIL')) return 'Orange';
  if (op.startsWith('XFERA M')) return 'Yoigo';
  if (op.startsWith('DS MOBILE NETWORKS')) return 'Digi';
  return 'Otros';
}

function provinceOf(addr) {
  const parts = String(addr || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1].toUpperCase() : 'DESCONOCIDA';
}

function provinceDisplay(raw) {
  if (PROVINCE_DISPLAY[raw]) return PROVINCE_DISPLAY[raw];
  return raw
    .toLowerCase()
    .replace(/(^|\s)([a-záéíóúüñ])/g, (m, sp, c) => sp + c.toUpperCase());
}

function municipalityOf(addr) {
  const s = String(addr || '').trim();
  const lastDot = s.lastIndexOf('. ');
  const tail = lastDot >= 0 ? s.slice(lastDot + 2) : s;
  const comma = tail.indexOf(',');
  return (comma >= 0 ? tail.slice(0, comma) : tail).trim();
}

function addressParts(addr) {
  const s = String(addr || '').trim();
  const lastDot = s.lastIndexOf('. ');
  const head = lastDot >= 0 ? s.slice(0, lastDot).trim() : s;
  const tail = lastDot >= 0 ? s.slice(lastDot + 2) : s;
  const parts = tail.split(',').map((p) => p.trim()).filter(Boolean);
  return {
    street: head,
    municipality: parts[0] || '',
    province: parts.length ? parts[parts.length - 1] : '',
  };
}

// ── Construcción del GeoJSON ─────────────────────────────────────

function buildGeo(rows) {
  const totals = {};
  const groups = new Map();

  for (const r of rows) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
    const brand = brandOf(r.cod || r.op);
    const prov = provinceDisplay(provinceOf(r.addr));
    totals[brand] = (totals[brand] || 0) + 1;
    const key = brand + '\u0000' + prov;
    if (!groups.has(key)) groups.set(key, { brand, prov, rows: [] });
    groups.get(key).rows.push(r);
  }

  const order = Object.keys(totals)
    .filter((b) => b !== 'Otros')
    .sort((a, b) => totals[b] - totals[a]);
  if (totals.Otros) order.push('Otros');

  const features = [];
  for (const brand of order) {
    const items = [...groups.values()]
      .filter((g) => g.brand === brand)
      .sort((a, b) => a.prov.localeCompare(b.prov, 'es'));
    for (const g of items) {
      const coords = [];
      const munis = new Set();
      const muniList = [];
      const muniIndex = new Map();
      const pointInfo = [];
      for (const r of g.rows) {
        const parts = addressParts(r.addr);
        const muniKey = parts.municipality || '';
        if (muniKey && !muniIndex.has(muniKey)) {
          muniIndex.set(muniKey, muniList.length);
          muniList.push(muniKey);
        }
        if (muniKey) munis.add(muniKey.toUpperCase());
        coords.push([round(r.lng, 4), round(r.lat, 4)]);
        pointInfo.push([
          String(r.id || ''),
          parts.street || '',
          muniKey && muniIndex.has(muniKey) ? muniIndex.get(muniKey) : -1,
        ]);
      }
      const n = g.rows.length;
      features.push({
        type: 'Feature',
        properties: {
          _manaName: `${brand} · ${g.prov}`,
          name: `${brand} · ${g.prov}`,
          _manaColor: BRAND_COLORS[brand] || '#6B7280',
          _manaFillOpacity: 0.9,
          _manaBorderColor: '#ffffff',
          _manaWeight: 0.5,
          _manaGeometryType: 'multipoint',
          _manaGroupName: 'Antenas por operador',
          _manaGroupId: order.indexOf(brand) + 1,
          _manaOpacity: 0.85,
          _manaLabelStyle: labelStyle(),
          // El visor explota cada MultiPoint en puntos individuales para el
          // clustering; esta marca permite ocultar los totales provinciales
          // en el popup de una antena concreta.
          _manaAggregate: true,
          // Información por estación (paralela a geometry.coordinates): el
          // visor la usa para el popup de cada antena individual.
          _manaPointInfo: { m: muniList, p: pointInfo },
          Operador: brand,
          Provincia: g.prov,
          Antenas: n,
          Municipios: munis.size,
          Dato: `${fmt(n)} antenas · ${munis.size} municipios`,
          Description:
            `Estaciones de telefonía móvil de ${brand} registradas en la provincia de ${g.prov}. ` +
            'Fuente: Infoantenas (Ministerio para la Transformación Digital).',
        },
        geometry: { type: 'MultiPoint', coordinates: coords },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

// ── Validación ──────────────────────────────────────────────────

function validate(geo, expectedRecords) {
  const f = geo.features;
  const hexOk = f.every((x) => /^#[0-9a-fA-F]{6}$/.test(x.properties._manaColor));
  const labelOk = f.every(
    (x) => x.properties._manaLabelStyle && x.properties._manaLabelStyle.haloWidth >= 2
  );
  const groupOk = f.every(
    (x) =>
      x.properties._manaGroupName &&
      Number.isFinite(Number(x.properties._manaGroupId))
  );
  const popupKeys = ['Operador', 'Provincia', 'Antenas', 'Municipios', 'Dato', 'Description'];
  const popupOk = f.every((x) => popupKeys.every((k) => x.properties[k] != null && x.properties[k] !== ''));
  const coordsOk = f.every(
    (x) =>
      Array.isArray(x.geometry.coordinates) &&
      x.geometry.coordinates.length > 0 &&
      x.geometry.coordinates.every(
        ([lon, lat]) => lon >= -20.1 && lon <= 12.7 && lat >= 26.9 && lat <= 53.9
      )
  );
  const names = new Set(f.map((x) => x.properties._manaName));
  const namesOk = names.size === f.length;
  const countOk = f.every((x) => Number.isInteger(x.properties.Antenas) && x.properties.Antenas > 0);
  const total = f.reduce((s, x) => s + x.properties.Antenas, 0);
  const totalOk = total === expectedRecords;
  const points = f.reduce((s, x) => s + x.geometry.coordinates.length, 0);

  console.log(`features: ${f.length} | puntos: ${fmt(points)} | registros: ${fmt(total)}`);
  console.log(`hex: ${hexOk} | labelStyle: ${labelOk} | grupo: ${groupOk} | popups: ${popupOk}`);
  console.log(`coords: ${coordsOk} | nombres únicos: ${namesOk} | conteos: ${countOk} | total: ${totalOk}`);

  if (!hexOk || !labelOk || !groupOk || !popupOk || !coordsOk || !namesOk || !countOk || !totalOk) {
    console.error('VALIDACIÓN FALLIDA');
    process.exit(1);
  }
  return points;
}

// ── Main ────────────────────────────────────────────────────────

function main() {
  const rows = loadRows();
  if (!rows.length) {
    console.error('ERROR: no se han obtenido registros.');
    process.exit(1);
  }
  const geo = buildGeo(rows);
  const points = validate(geo, rows.length);

  const text = JSON.stringify(geo);
  const bytes = Buffer.byteLength(text, 'utf8');
  console.log(`GeoJSON: ${(bytes / 1024).toFixed(0)} KB (${bytes} bytes) · ${SLUG}`);
  if (bytes > 6 * 1024 * 1024) {
    console.error('ERROR: GeoJSON demasiado grande (>6 MiB).');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, text);
  console.log('Guardado en', OUT_PATH);

  console.log('\nResumen por operador:');
  const byBrand = {};
  for (const x of geo.features) {
    const p = x.properties;
    if (!byBrand[p.Operador]) byBrand[p.Operador] = { n: 0, provs: 0, points: 0 };
    byBrand[p.Operador].n += p.Antenas;
    byBrand[p.Operador].provs++;
    byBrand[p.Operador].points += x.geometry.coordinates.length;
  }
  for (const [brand, v] of Object.entries(byBrand)) {
    console.log(
      `  ${brand}: ${fmt(v.n)} antenas · ${v.provs} provincias · ${fmt(v.points)} puntos`
    );
  }
  console.log(`\ndataSource: ${DATA_SOURCE}`);
  console.log(`dataDate: ${DATA_DATE} · puntos totales: ${fmt(points)}`);
}

main();
