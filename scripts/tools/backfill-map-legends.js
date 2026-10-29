#!/usr/bin/env node
// ── backfill-map-legends.js ─
// Añade una leyenda numérica (legendKey/legendTitle/legendFormat) a los cuatro
// mapas publicados que aún no la tenían (auditoría 28-10) y, cuando hace falta,
// normaliza sus datos de popup para que la leyenda tenga sentido:
//
//   • largest-islands-world   → legendKey «superficie_km2» (ya numérico)
//   • longest-rivers-world    → legendKey «Longitud (km)» (ya numérico)
//   • major-deserts-world     → props al español (Continente, Superficie,
//                               Países, Tipo) + Superficie numérica en km² y
//                               rampa monocromática ordenada por el dato
//   • worst-wildfires-world   → «Superficie quemada (ha)» numérica,
//                               Deaths→Muertos, Year→Año, Location→País,
//                               grupo «Incendios forestales», emoji_fire
//                               escalado por superficie (_manaEmojiSize 22-66,
//                               logarítmico) y rampa monocromática
//
// Requisitos AGENTS.md §3 (rampa secuencial monocromática claro→oscuro
// ordenada por el dato) y §5 (popups con datos concretos). El script:
//   1. lee el documento de Firestore y su geojsonText,
//   2. transforma las propiedades (solo las claves indicadas),
//   3. valida hex, coordenadas, nombres únicos, haloWidth y escala de puntos,
//   4. escribe data/maps/<slug>.geojson en el repo,
//   5. PATCH en Firestore de los campos tocados y verificación posterior.
//
// Uso: node scripts/tools/backfill-map-legends.js [--dry-run]

'use strict';

const fs = require('fs');
const path = require('path');

const {
  getAccessToken, firestoreRequest, COLLECTION,
  fsStr, fsInt, fsMap, fsNull,
} = require('../lib/publisher');

const REPO = path.join(__dirname, '..', '..');
const DRY_RUN = process.argv.includes('--dry-run');

// ── Color: rampa monocromática claro→oscuro ──────────────────────────
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

// Misma rampa que scripts/tools/audit-gallery-quality.js (buildMonoRamp).
function buildMonoRamp(hue, steps = 9) {
  const ramp = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const l = 92 - t * 72; // 92 % → 20 %
    const s = 48 + t * 28; // 48 % → 76 %
    ramp.push(hslToHex(hue, s / 100, l / 100));
  }
  return ramp;
}

// Asigna la rampa por cuantiles (mismo criterio que la auditoría §3):
// valor menor → color más claro; valor mayor → más oscuro.
function assignRamp(features, valueKey, hue) {
  const ramp = buildMonoRamp(hue);
  const sorted = features
    .map(f => ({ f, v: Number(f.properties[valueKey]) }))
    .filter(x => Number.isFinite(x.v))
    .sort((a, b) => a.v - b.v);
  const n = sorted.length;
  sorted.forEach((x, idx) => {
    const t = n === 1 ? 1 : idx / (n - 1);
    const step = Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))));
    x.f.properties._manaColor = ramp[step];
  });
  return sorted;
}

// ── Parseo de datos de popup ─────────────────────────────────────────
function parseAreaKm2(raw) {
  if (typeof raw === 'number') return raw;
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/([\d.,]+)\s*(million|M)?/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(/million|M/i.test(m[2] || '') ? n * 1e6 : n);
}

function parseFireHa(raw) {
  if (typeof raw === 'number') return raw;
  const s = String(raw || '').replace(/,/g, '').trim();
  const m = s.match(/([\d.]+)\s*(M)?\s*ha/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.round(/M/i.test(m[2] || '') ? n * 1e6 : n);
}

function parseDeaths(raw) {
  const m = String(raw == null ? '' : raw).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function formatEs(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

const CONTINENTS_ES = {
  Africa: 'África', Asia: 'Asia', Europe: 'Europa', Oceania: 'Oceanía',
  'North America': 'Norteamérica', 'South America': 'Sudamérica', Antarctica: 'Antártida',
  África: 'África', Oceanía: 'Oceanía', Norteamérica: 'Norteamérica',
  Sudamérica: 'Sudamérica', Antártida: 'Antártida',
};

const COUNTRIES_ES = {
  Algeria: 'Argelia', Egypt: 'Egipto', Libya: 'Libia', Mali: 'Malí', Niger: 'Níger',
  Chad: 'Chad', Sudan: 'Sudán', Morocco: 'Marruecos', Tunisia: 'Túnez',
  'Saudi Arabia': 'Arabia Saudí', Yemen: 'Yemen', Oman: 'Omán',
  UAE: 'Emiratos Árabes Unidos', Qatar: 'Catar', Kuwait: 'Kuwait', Iraq: 'Irak',
  China: 'China', Mongolia: 'Mongolia',
  Botswana: 'Botsuana', Namibia: 'Namibia', 'South Africa': 'Sudáfrica',
  Argentina: 'Argentina', Chile: 'Chile', Australia: 'Australia',
  Syria: 'Siria', Jordan: 'Jordania',
  'United States': 'Estados Unidos', Mexico: 'México',
  Turkmenistan: 'Turkmenistán', Uzbekistan: 'Uzbekistán', Kazakhstan: 'Kazajistán',
  India: 'India', Pakistan: 'Pakistán',
  'Antarctica (international territory)': 'Antártida (territorio internacional)',
};

function translateCountries(raw) {
  return String(raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => COUNTRIES_ES[s] || s)
    .join(', ');
}

// ── Transformaciones por mapa ────────────────────────────────────────
function setLegend(fields, key, title, format = 'number') {
  fields.legendKey = fsStr(key);
  fields.legendTitle = fsStr(title);
  fields.legendFormat = fsStr(format);
}

const TRANSFORMS = {
  'largest-islands-world': {
    touchGeo: false,
    transform() { /* los props ya son numéricos (superficie_km2) */ },
    applyLegend(fields) { setLegend(fields, 'superficie_km2', 'Superficie (km²)'); },
  },

  'longest-rivers-world': {
    touchGeo: false,
    transform() { /* los props ya son numéricos (Longitud (km)) */ },
    applyLegend(fields) { setLegend(fields, 'Longitud (km)', 'Longitud (km)'); },
  },

  'major-deserts-world': {
    touchGeo: true,
    transform(geo) {
      for (const f of geo.features) {
        const p = f.properties;
        if ('Continent' in p) {
          p.Continente = CONTINENTS_ES[p.Continent] || p.Continent;
          delete p.Continent;
        }
        if ('Area' in p) {
          p.Superficie = parseAreaKm2(p.Area);
          delete p.Area;
        }
        if ('Countries' in p) {
          p.Países = translateCountries(p.Countries);
          delete p.Countries;
        }
        if ('Type' in p) { p.Tipo = p.Type; delete p.Type; }
        p.Dato = `${formatEs(p.Superficie)} km²`;
        // Un único grupo para que la leyenda cubra todo el rango del dato;
        // el tipo (cálido/frío) se conserva en el popup («Tipo»).
        p._manaGroupName = 'Desiertos';
        p._manaGroupId = 1;
      }
      assignRamp(geo.features, 'Superficie', 32); // naranja (#d97706 ≈ 32°)
    },
    applyLegend(fields) { setLegend(fields, 'Superficie', 'Superficie (km²)'); },
  },

  'worst-wildfires-world': {
    touchGeo: true,
    transform(geo) {
      const areas = [];
      for (const f of geo.features) {
        const p = f.properties;
        if ('Area' in p) {
          p['Superficie quemada (ha)'] = parseFireHa(p.Area);
          delete p.Area;
        }
        if ('Deaths' in p) { p.Muertos = parseDeaths(p.Deaths); delete p.Deaths; }
        if ('Year' in p) { p.Año = String(p.Year); delete p.Year; }
        if ('Location' in p) { p.País = p.Location; delete p.Location; }
        p.Dato = `${formatEs(p['Superficie quemada (ha)'])} ha quemadas`;
        p._manaGroupName = 'Incendios forestales';
        p._manaGroupId = 1;
        areas.push(p['Superficie quemada (ha)']);
      }
      // Emoji escalado 22–66 de forma logarítmica por superficie quemada.
      const vals = areas.filter(v => Number.isFinite(v) && v > 0);
      const lo = Math.log(Math.min(...vals));
      const hi = Math.log(Math.max(...vals));
      for (const f of geo.features) {
        const v = f.properties['Superficie quemada (ha)'];
        const t = hi === lo ? 0.5 : (Math.log(v) - lo) / (hi - lo);
        f.properties._manaEmojiSize = Math.round(22 + t * 44);
      }
      assignRamp(geo.features, 'Superficie quemada (ha)', 16); // rojo (#ff4500 ≈ 16°)
    },
    applyLegend(fields) { setLegend(fields, 'Superficie quemada (ha)', 'Superficie quemada (ha)'); },
  },
};

// ── Preview para las tarjetas / mapa compartido ──────────────────────
function buildMapPreview(geo) {
  let bbox = [180, 90, -180, -90];
  function walk(coords) {
    if (typeof coords[0] === 'number') {
      const x = coords[0], y = coords[1];
      if (x < bbox[0]) bbox[0] = x; if (y < bbox[1]) bbox[1] = y;
      if (x > bbox[2]) bbox[2] = x; if (y > bbox[3]) bbox[3] = y;
    } else coords.forEach(walk);
  }
  geo.features.forEach(f => walk(f.geometry.coordinates));

  function sampleRing(ring, maxPts) {
    if (!ring || ring.length <= maxPts) return ring;
    const step = Math.ceil(ring.length / maxPts);
    const out = [];
    for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
    if (out[out.length - 1] !== ring[ring.length - 1]) out.push(ring[ring.length - 1]);
    return out;
  }

  const features = geo.features.map(f => {
    const g = f.geometry;
    const props = f.properties || {};
    let geom;
    if (g.type === 'Polygon') {
      geom = { type: 'Polygon', coordinatesText: JSON.stringify(g.coordinates.map(r => sampleRing(r, 80))) };
    } else if (g.type === 'MultiPolygon') {
      geom = { type: 'MultiPolygon', coordinatesText: JSON.stringify(g.coordinates.map(poly => poly.map(r => sampleRing(r, 80)))) };
    } else {
      geom = { type: g.type, coordinatesText: JSON.stringify(g.coordinates) };
    }
    const entry = { geometry: geom, color: props._manaColor, emoji: null, fillOpacity: null };
    const mt = props._manaMarkerType || props.markerType || '';
    if (mt === 'emoji_fire') entry.emoji = '🔥';
    if (typeof props._manaFillOpacity === 'number') entry.fillOpacity = props._manaFillOpacity;
    return entry;
  });
  return { bbox, kind: 'geometry', gridSize: null, cells: null, features };
}

// ── Validación previa (AGENTS.md §Estándar de publicación) ───────────
function validate(slug, geo, expectedCount) {
  const errors = [];
  if (!geo || !Array.isArray(geo.features)) errors.push('geojson sin features');
  if (geo.features.length !== expectedCount) errors.push(`featureCount ${geo.features.length} ≠ ${expectedCount}`);
  for (const f of geo.features) {
    const p = f.properties || {};
    if (!/^#[0-9a-fA-F]{6}$/.test(p._manaColor || '')) errors.push(`${p._manaName}: color no hex`);
    if (!p._manaLabelStyle || !(p._manaLabelStyle.haloWidth >= 2)) errors.push(`${p._manaName}: haloWidth < 2`);
    let ok = true;
    (function walk(c) {
      if (typeof c[0] === 'number') {
        if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) ok = false;
      } else c.forEach(walk);
    })(f.geometry.coordinates);
    if (!ok) errors.push(`${p._manaName}: coordenadas fuera de rango`);
    if (f.geometry.type === 'Point') {
      if (!p._manaEmojiSize) errors.push(`${p._manaName}: sin _manaEmojiSize`);
      if (!(p.markerType && p.markerType === p._manaMarkerType)) errors.push(`${p._manaName}: markerType incoherente`);
    }
  }
  const names = new Set(geo.features.map(f => f.properties._manaName));
  if (names.size !== geo.features.length) errors.push('nombres duplicados');
  const text = JSON.stringify(geo);
  if (text.length > 1024 * 1024) errors.push(`geojsonText ${(text.length / 1024).toFixed(1)} KB > 1 MiB`);
  return { errors, text };
}

// ── Simulación de buildLegendForKey (js/gallery-page.js) ─────────────
// Comprueba que la leyenda se renderiza (≥3 colores distintos en un grupo) y
// devuelve el rango formateado.
function simulateLegend(geo, legendKey) {
  const groups = {};
  for (const f of geo.features) {
    const p = f.properties || {};
    if (!p._manaColor) continue;
    const v = Number(p[legendKey]);
    if (!Number.isFinite(v) || v === 0) continue;
    const g = p._manaGroupName || 'Datos';
    if (!groups[g]) groups[g] = { colors: {}, min: Infinity, max: -Infinity };
    groups[g].colors[p._manaColor] = (groups[g].colors[p._manaColor] || 0) + 1;
    if (v < groups[g].min) groups[g].min = v;
    if (v > groups[g].max) groups[g].max = v;
  }
  for (const g of Object.keys(groups)) {
    const b = groups[g];
    const n = Object.keys(b.colors).length;
    if (n >= 3) return { group: g, steps: n, min: b.min, max: b.max };
  }
  return null;
}

function fsMapPreview(preview) {
  return fsMap({
    bbox: { arrayValue: { values: preview.bbox.map(v => ({ doubleValue: v })) } },
    kind: fsStr(preview.kind),
    gridSize: fsNull(),
    cells: fsNull(),
    features: {
      arrayValue: {
        values: preview.features.map(pf => fsMap({
          geometry: fsMap({ type: fsStr(pf.geometry.type), coordinatesText: fsStr(pf.geometry.coordinatesText) }),
          color: fsStr(pf.color),
          emoji: pf.emoji ? fsStr(pf.emoji) : fsNull(),
          fillOpacity: typeof pf.fillOpacity === 'number' ? { doubleValue: pf.fillOpacity } : fsNull(),
        })),
      },
    },
  });
}

function localGeoPath(slug) {
  return path.join(REPO, 'data', 'maps', `${slug}.geojson`);
}

function writeLocalGeo(slug, geo) {
  const p = localGeoPath(slug);
  const out = JSON.stringify(geo, null, 1) + '\n';
  fs.writeFileSync(p, out);
  return p;
}

async function main() {
  const slugs = Object.keys(TRANSFORMS);
  const { token } = await getAccessToken();

  for (const slug of slugs) {
    const cfg = TRANSFORMS[slug];
    console.log(`\n── ${slug} ──`);
    const res = await firestoreRequest(token, 'GET', `/${COLLECTION}/${slug}`);
    if (res.status !== 200) { console.error(`  ERROR: no existe (${res.status})`); process.exitCode = 1; continue; }
    const fields = res.data.fields || {};
    const geo = JSON.parse(fields.geojsonText?.stringValue || '{}');
    const expected = Number(fields.featureCount?.integerValue || geo.features.length);

    cfg.transform(geo);

    const { errors, text } = validate(slug, geo, expected);
    if (errors.length) {
      console.error('  VALIDACIÓN FALLIDA:\n   - ' + errors.join('\n   - '));
      process.exitCode = 1;
      continue;
    }

    const patch = { updatedAtMs: fsInt(Date.now()), updatedAt: { timestampValue: new Date().toISOString() } };
    cfg.applyLegend(patch);
    if (cfg.touchGeo) {
      patch.geojsonText = fsStr(text);
      patch.featureCount = fsInt(geo.features.length);
      patch.mapPreview = fsMapPreview(buildMapPreview(geo));
    }

    const legendCheck = simulateLegend(geo, patch.legendKey.stringValue);
    if (!legendCheck) {
      console.error(`  LEYENDA NO RENDERIZA: grupo sin ≥3 colores para «${patch.legendKey.stringValue}»`);
      process.exitCode = 1;
      continue;
    }
    console.log(`  features ${geo.features.length} | ${(text.length / 1024).toFixed(1)} KB`);
    console.log(`  leyenda «${patch.legendTitle.stringValue}»: ${legendCheck.steps} pasos, ${formatEs(legendCheck.min)} → ${formatEs(legendCheck.max)} (grupo ${legendCheck.group})`);

    if (cfg.touchGeo) {
      const p = writeLocalGeo(slug, geo);
      console.log(`  repo: ${path.relative(REPO, p)} actualizado`);
    }

    if (DRY_RUN) { console.log('  DRY RUN: sin escritura en Firestore'); continue; }

    const mask = Object.keys(patch).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const up = await firestoreRequest(token, 'PATCH', `/${COLLECTION}/${slug}?${mask}`, { fields: patch });
    if (up.status >= 400) {
      console.error(`  ERROR PATCH ${up.status}: ${JSON.stringify(up.data).slice(0, 500)}`);
      process.exitCode = 1;
      continue;
    }
    console.log('  Firestore actualizado');
  }

  // Verificación posterior: leer y comprobar legendKey + leyenda.
  if (!DRY_RUN) {
    console.log('\n── Verificación ──');
    for (const slug of slugs) {
      const res = await firestoreRequest(token, 'GET', `/${COLLECTION}/${slug}`);
      const f = res.data?.fields || {};
      const geo = JSON.parse(f.geojsonText?.stringValue || '{}');
      const key = f.legendKey?.stringValue;
      const chk = key ? simulateLegend(geo, key) : null;
      console.log(`${slug}: legendKey=${key || 'FALTA'} | ${chk ? `${formatEs(chk.min)} → ${formatEs(chk.max)} (${chk.steps} pasos)` : 'SIN LEYENDA'}`);
      if (!chk) process.exitCode = 1;
    }
  }
}

main().catch(e => { console.error('Fatal', e); process.exit(1); });
