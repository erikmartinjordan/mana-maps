#!/usr/bin/env node
// ── publish-antenas-moviles-espana.js ─
// Mapa puntual: todas las antenas de telefonía móvil de España por operador.
// Fuente: Infoantenas / VCTEL (Ministerio para la Transformación Digital y de
// la Función Pública), consultado el 9 de noviembre de 2026.
//
// El GeoJSON contiene los puntos reales (MultiPoint por operador y provincia).
// El visor de la galería los explota y aplica clustering genérico: al alejar
// el zoom se ven grupos con la silueta del logo de Maña y al acercarse se ven
// las antenas individuales. Este script solo publica el GeoJSON completo en
// `geoChunks` (supera 1 MiB) y una versión simplificada en `geojsonText` para
// landings, OG cards y auditoría.
'use strict';

const fs = require('fs');
const path = require('path');
const {
  getAccessToken,
  firestoreRequest,
  COLLECTION,
  fsStr,
  fsInt,
  fsBool,
  fsArr,
  fsNull,
  fsMap,
} = require('../lib/publisher');

const SLUG = 'antenas-moviles-espana';
const DETAIL_SLUG = SLUG + '-detalle'; // residuo del sistema de resumen anterior
const TITLE = 'Antenas de telefonía móvil en España por operador';
const DRY_RUN = process.argv.includes('--dry-run');
const MAX_DOC_BYTES = 1048576;
const CHUNK_BYTES = 700000;
const SIMPLIFY_DECIMALS = 2;
const PREVIEW_GRID = 28;

const DATA_SOURCE =
  'Ministerio para la Transformación Digital y de la Función Pública — ' +
  'Infoantenas, Servicio de Información sobre Instalaciones Radioeléctricas y ' +
  'Niveles de Exposición (VCTEL), https://geoportal.minetur.gob.es/VCTEL/vcne.do ' +
  '(consultado el 9 de noviembre de 2026).';
const DATA_DATE = '2026-11-09';

const DESCRIPTION =
  'Las 69.785 antenas registradas por Infoantenas en España, por operador y provincia. ' +
  'El color identifica al operador y cada punto es una antena; haz clic para ver el ' +
  'desglose. Fuente: VCTEL, 2026.';

function fmt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function round(v, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

function compactGeo(geo, decimals) {
  return {
    type: 'FeatureCollection',
    features: geo.features.map((f) => {
      const isPoint = f.geometry.type === 'Point';
      let geometry;
      if (isPoint) {
        geometry = {
          type: 'Point',
          coordinates: [
            round(f.geometry.coordinates[0], decimals),
            round(f.geometry.coordinates[1], decimals),
          ],
        };
      } else {
        const seen = new Set();
        const coords = [];
        for (const coord of f.geometry.coordinates) {
          const x = round(coord[0], decimals);
          const y = round(coord[1], decimals);
          const key = x + ',' + y;
          if (seen.has(key)) continue;
          seen.add(key);
          coords.push([x, y]);
        }
        geometry = { type: 'MultiPoint', coordinates: coords };
      }
      // `Antenas` y `Municipios` son totales provinciales y viven en los chunks
      // que usa el visor. En `geojsonText` (herramientas SEO/OG) se omiten para
      // no convertirlos en candidatos a leyenda numérica.
      const props = Object.assign({}, f.properties);
      delete props.Antenas;
      delete props.Municipios;
      delete props._manaPointInfo;
      return { type: 'Feature', properties: props, geometry };
    }),
  };
}

function chunkText(text, maxBytes) {
  const chunks = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const size = Buffer.byteLength(text[i], 'utf8');
    if (bytes + size > maxBytes) {
      chunks.push(text.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += size;
  }
  if (start < text.length) chunks.push(text.slice(start));
  return chunks;
}

function geoBBox(geo) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of geo.features) {
    const coords =
      f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const [x, y] of coords) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

function buildPreview(geo) {
  const bbox = geoBBox(geo);
  const [minX, minY, maxX, maxY] = bbox;
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const cells = new Map();

  for (const f of geo.features) {
    const color = f.properties._manaColor;
    const coords = f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const [lon, lat] of coords) {
      const x = Math.max(
        0,
        Math.min(PREVIEW_GRID - 1, Math.floor(((lon - minX) / spanX) * PREVIEW_GRID))
      );
      const y = Math.max(
        0,
        Math.min(PREVIEW_GRID - 1, Math.floor(((maxY - lat) / spanY) * PREVIEW_GRID))
      );
      const key = x + ':' + y;
      if (!cells.has(key)) cells.set(key, { x, y, n: 0, colors: new Map() });
      const cell = cells.get(key);
      cell.n++;
      cell.colors.set(color, (cell.colors.get(color) || 0) + 1);
    }
  }

  const out = [...cells.values()].map((cell) => {
    let bestColor = '#08306B';
    let best = -1;
    for (const [color, n] of cell.colors) {
      if (n > best) {
        best = n;
        bestColor = color;
      }
    }
    return { x: cell.x, y: cell.y, n: cell.n, c: bestColor };
  });

  return {
    bbox,
    kind: 'density-grid',
    gridSize: PREVIEW_GRID,
    cells: out,
    features: [],
  };
}

function validate(geo, label, opts = {}) {
  const requireCounts = opts.requireCounts !== false;
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
  const popupKeys = ['Operador', 'Provincia', 'Dato', 'Description'];
  if (requireCounts) popupKeys.push('Antenas', 'Municipios');
  const popupOk = f.every((x) => popupKeys.every((k) => x.properties[k] != null && x.properties[k] !== ''));
  const coordsOk = f.every((x) => {
    const c = x.geometry.coordinates;
    const list = x.geometry.type === 'Point' ? [c] : c;
    return (
      Array.isArray(list) &&
      list.length > 0 &&
      list.every(
        ([lon, lat]) => lon >= -20.1 && lon <= 12.7 && lat >= 26.9 && lat <= 53.9
      )
    );
  });
  const names = new Set(f.map((x) => x.properties._manaName));
  const namesOk = names.size === f.length;
  const countsOk = !requireCounts || f.every(
    (x) => Number.isInteger(x.properties.Antenas) && x.properties.Antenas > 0
  );
  const pointCount = (g) => (g.type === 'Point' ? 1 : g.coordinates.length);
  const points = f.reduce((s, x) => s + pointCount(x.geometry), 0);
  console.log(
    `${label}: ${f.length} features · ${fmt(points)} puntos · ` +
      `hex ${hexOk} · label ${labelOk} · grupo ${groupOk} · popups ${popupOk} · ` +
      `coords ${coordsOk} · nombres ${namesOk} · conteos ${countsOk}`
  );
  if (!hexOk || !labelOk || !groupOk || !popupOk || !coordsOk || !namesOk || !countsOk) {
    console.error('VALIDACIÓN FALLIDA:', label);
    process.exit(1);
  }
}

function legendSteps(geo) {
  const totals = {};
  const colors = {};
  for (const f of geo.features) {
    const p = f.properties;
    totals[p.Operador] = (totals[p.Operador] || 0) + p.Antenas;
    colors[p.Operador] = colors[p.Operador] || p._manaColor;
  }
  const order = Object.keys(totals)
    .filter((b) => b !== 'Otros')
    .sort((a, b) => totals[b] - totals[a]);
  if (totals.Otros) order.push('Otros');
  return order.map((brand) => ({
    label: `${brand} · ${fmt(totals[brand])}`,
    color: colors[brand],
  }));
}

async function upsertMapDoc(token, slug, fields) {
  const existing = await firestoreRequest(token, 'GET', `/${COLLECTION}/${slug}`);
  if (existing.status === 200) {
    const fieldPaths = Object.keys(fields)
      .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
      .join('&');
    const res = await firestoreRequest(
      token,
      'PATCH',
      `/${COLLECTION}/${slug}?${fieldPaths}`,
      { fields }
    );
    if (res.status >= 400) {
      throw new Error(`Update ${slug} failed ${res.status}: ${JSON.stringify(res.data).slice(0, 600)}`);
    }
    return 'updated';
  }
  const res = await firestoreRequest(
    token,
    'POST',
    `/${COLLECTION}?documentId=${slug}`,
    { fields }
  );
  if (res.status >= 400) {
    throw new Error(`Create ${slug} failed ${res.status}: ${JSON.stringify(res.data).slice(0, 600)}`);
  }
  return 'created';
}

async function syncChunks(token, docId, collection, text, chunkCount) {
  const chunks = chunkText(text, CHUNK_BYTES);
  if (chunks.length !== chunkCount) {
    throw new Error(`${collection}: chunkCount ${chunkCount} ≠ chunks reales ${chunks.length}`);
  }
  for (let i = 0; i < chunks.length; i++) {
    const res = await firestoreRequest(
      token,
      'PATCH',
      `/${COLLECTION}/${docId}/${collection}/${i}`,
      { fields: { index: fsInt(i), text: fsStr(chunks[i]) } }
    );
    if (res.status >= 400) {
      throw new Error(`${collection}/${i} failed ${res.status}: ${JSON.stringify(res.data).slice(0, 400)}`);
    }
  }
  const list = await firestoreRequest(
    token,
    'GET',
    `/${COLLECTION}/${docId}/${collection}?pageSize=200`
  );
  if (list.status === 200 && Array.isArray(list.data.documents)) {
    for (const doc of list.data.documents) {
      const id = String(doc.name || '').split('/').pop();
      if (!/^\d+$/.test(id) || Number(id) >= chunks.length) {
        await firestoreRequest(token, 'DELETE', `/${COLLECTION}/${docId}/${collection}/${id}`);
      }
    }
  }
  return chunks;
}

async function readChunks(token, docId, collection, chunkCount) {
  let raw = '';
  for (let i = 0; i < chunkCount; i++) {
    const res = await firestoreRequest(
      token,
      'GET',
      `/${COLLECTION}/${docId}/${collection}/${i}`
    );
    if (res.status !== 200) throw new Error(`${collection}/${i} read ${res.status}`);
    raw += res.data.fields?.text?.stringValue || '';
  }
  return raw;
}

async function deleteDocWithChunks(token, slug) {
  const list = await firestoreRequest(token, 'GET', `/${COLLECTION}/${slug}/geoChunks?pageSize=200`);
  if (list.status === 200 && Array.isArray(list.data.documents)) {
    for (const doc of list.data.documents) {
      const id = String(doc.name || '').split('/').pop();
      await firestoreRequest(token, 'DELETE', `/${COLLECTION}/${slug}/geoChunks/${id}`);
    }
  }
  await firestoreRequest(token, 'DELETE', `/${COLLECTION}/${slug}`);
}

async function main() {
  const geoPath = path.join(__dirname, '..', '..', 'data', 'maps', `${SLUG}.geojson`);
  if (!fs.existsSync(geoPath)) {
    console.error('ERROR: no existe', geoPath);
    process.exit(1);
  }
  const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
  validate(geo, 'completo');

  const simplified = compactGeo(geo, SIMPLIFY_DECIMALS);
  validate(simplified, `simplificado (${SIMPLIFY_DECIMALS} decimales)`, { requireCounts: false });

  const fullText = JSON.stringify(geo);
  const simplifiedText = JSON.stringify(simplified);
  const fullBytes = Buffer.byteLength(fullText, 'utf8');
  const simplifiedBytes = Buffer.byteLength(simplifiedText, 'utf8');
  const chunks = chunkText(fullText, CHUNK_BYTES);

  console.log(
    `completo ${(fullBytes / 1024).toFixed(0)} KB (${chunks.length} chunks) · ` +
      `geojsonText ${(simplifiedBytes / 1024).toFixed(0)} KB`
  );
  if (simplifiedBytes > MAX_DOC_BYTES) {
    console.error('ERROR: geojsonText simplificado > 1 MiB');
    process.exit(1);
  }

  const totalRecords = geo.features.reduce((s, f) => s + f.properties.Antenas, 0);
  const preview = buildPreview(geo);
  const previewBytes = Buffer.byteLength(JSON.stringify(preview), 'utf8');
  console.log(`mapPreview ${(previewBytes / 1024).toFixed(0)} KB · ${preview.cells.length} celdas`);
  if (previewBytes > 200000) {
    console.error('ERROR: mapPreview demasiado grande');
    process.exit(1);
  }

  const now = Date.now();
  const serverNow = { timestampValue: new Date().toISOString() };
  const steps = legendSteps(geo);

  const fields = {
    id: fsStr(SLUG),
    slug: fsStr(SLUG),
    title: fsStr(TITLE),
    name: fsStr(TITLE),
    description: fsStr(DESCRIPTION),
    lang: fsStr('es'),
    featureCount: fsInt(geo.features.length),
    sourceRecords: fsInt(totalRecords),
    mapPreview: fsMap({
      bbox: { arrayValue: { values: preview.bbox.map((v) => ({ doubleValue: v })) } },
      kind: fsStr(preview.kind),
      gridSize: fsInt(preview.gridSize),
      cells: {
        arrayValue: {
          values: preview.cells.map((cell) =>
            fsMap({
              x: fsInt(cell.x),
              y: fsInt(cell.y),
              n: fsInt(cell.n),
              c: fsStr(cell.c),
            })
          ),
        },
      },
      features: { arrayValue: { values: [] } },
    }),
    visibility: fsStr('public'),
    shareMode: fsStr('view'),
    allowPublicEdit: fsBool(false),
    isPublished: fsBool(true),
    shareUrl: fsStr(`https://xn--maa-8ma.com/gallery/?slug=${SLUG}`),
    geojsonText: fsStr(simplifiedText),
    geojsonChunked: fsMap({ collection: 'geoChunks', chunkCount: chunks.length }),
    geojsonDetailChunked: fsNull(),
    dataSource: fsStr(DATA_SOURCE),
    dataDate: fsStr(DATA_DATE),
    dataYear: fsInt(2026),
    tags: fsArr(['Telecomunicaciones', 'España', 'Infraestructura']),
    legendKey: fsStr('Operador'),
    legendTitle: fsStr('Operador'),
    legendFormat: fsStr('category'),
    legend: fsMap({ steps: steps.map((s) => ({ label: s.label, color: s.color })) }),
    authorHandle: fsStr('maña-maps'),
    createdBy: fsStr('maña-maps'),
    ownerUid: fsStr('maña-maps'),
    createdAtMs: fsInt(now),
    updatedAtMs: fsInt(now),
    createdAt: serverNow,
    updatedAt: serverNow,
    views: fsInt(0),
    likes: fsInt(0),
  };

  if (DRY_RUN) {
    console.log('\n=== DRY RUN ===');
    for (const key of Object.keys(fields)) {
      const v = fields[key];
      if ('stringValue' in v) {
        console.log(
          `  ${key}: "${v.stringValue.substring(0, 140)}${v.stringValue.length > 140 ? '…' : ''}"`
        );
      } else if ('integerValue' in v) console.log(`  ${key}: ${v.integerValue}`);
      else if ('booleanValue' in v) console.log(`  ${key}: ${v.booleanValue}`);
      else if ('nullValue' in v) console.log(`  ${key}: null`);
      else if ('mapValue' in v) console.log(`  ${key}: [map]`);
      else if ('arrayValue' in v) console.log(`  ${key}: [array ${v.arrayValue.values.length}]`);
    }
    console.log(`  legend: ${steps.map((s) => s.label).join(' | ')}`);
    return;
  }

  console.log('Autenticando…');
  const { token, uid } = await getAccessToken();
  if (uid) {
    fields.createdBy = fsStr(uid);
    fields.ownerUid = fsStr(uid);
  }

  console.log(`Comprobando /${COLLECTION}/${SLUG}…`);
  console.log('Guardando documento…', await upsertMapDoc(token, SLUG, fields));

  console.log(`Escribiendo ${chunks.length} chunks…`);
  await syncChunks(token, SLUG, 'geoChunks', fullText, chunks.length);

  console.log('Verificando…');
  const verify = await firestoreRequest(token, 'GET', `/${COLLECTION}/${SLUG}`);
  if (verify.status !== 200) {
    console.error('VERIFY FAILED', verify.status, JSON.stringify(verify.data).slice(0, 400));
    process.exit(1);
  }
  const vf = verify.data.fields || {};
  const published = vf.isPublished?.booleanValue;
  const featureCount = Number(vf.featureCount?.integerValue);
  const chunkCount = Number(vf.geojsonChunked?.mapValue?.fields?.chunkCount?.integerValue || 0);
  const geoText = vf.geojsonText?.stringValue || '';
  let textFeatures = 0;
  try {
    textFeatures = JSON.parse(geoText).features.length;
  } catch (_) {
    textFeatures = -1;
  }
  let fullFeatures = 0;
  let fullPoints = 0;
  if (chunkCount) {
    const parsed = JSON.parse(await readChunks(token, SLUG, 'geoChunks', chunkCount));
    fullFeatures = parsed.features.length;
    fullPoints = parsed.features.reduce(
      (s, f) => s + (f.geometry.type === 'Point' ? 1 : f.geometry.coordinates.length),
      0
    );
  }

  console.log(`✓ isPublished ${published}`);
  console.log(`✓ featureCount ${featureCount} (geojsonText ${textFeatures}, chunks ${fullFeatures})`);
  console.log(`✓ puntos completos ${fmt(fullPoints)} · chunks ${chunkCount}`);
  console.log(`✓ title: ${vf.title?.stringValue}`);
  console.log(`✓ legendKey: ${vf.legendKey?.stringValue} · ${vf.legendFormat?.stringValue}`);
  console.log(`✓ dataSource: ${vf.dataSource?.stringValue}`);
  console.log(`✓ geojsonText KB: ${(Buffer.byteLength(geoText, 'utf8') / 1024).toFixed(1)}`);
  console.log(`✓ https://xn--maa-8ma.com/gallery/?slug=${SLUG}`);

  if (!published || featureCount !== geo.features.length || textFeatures !== featureCount) {
    console.error('VERIFY MISMATCH');
    process.exit(1);
  }
  if (chunkCount && fullFeatures !== featureCount) {
    console.error('VERIFY CHUNKS MISMATCH');
    process.exit(1);
  }

  // Limpieza del documento oculto del sistema de resumen anterior.
  try {
    await deleteDocWithChunks(token, DETAIL_SLUG);
    console.log('✓ Residuo de resumen anterior eliminado');
  } catch (e) {
    console.warn('No se pudo limpiar el residuo de resumen:', e.message);
  }
}

main().catch((e) => {
  console.error('Fatal', e);
  process.exit(1);
});
