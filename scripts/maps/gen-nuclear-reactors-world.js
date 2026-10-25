#!/usr/bin/env node
// ── gen-nuclear-reactors-world.js ─
// Genera data/maps/nuclear-reactors-world.geojson a partir del extracto curado
// ~/autopilot/strategy/data/nuclear-reactors-world/sites-es.json
// (reactores y potencias netas: IAEA Power Reactor Information System — PRIS,
// consulta de octubre de 2026; coordenadas de cada central: GeoNuclearData
// 0.17.0, ODbL, cruzadas por el IAEAId de cada reactor).
// Una feature Point por central nuclear con reactores operativos (los grupos
// PRIS del mismo recinto se fusionan), markerType emoji_bulb, icono escalado
// por la potencia neta total del emplazamiento (_manaEmojiSize, escala
// logarítmica) y rampa monocromática ámbar ordenada por esa potencia
// (AGENTS.md §3). El popup resume todas las unidades del emplazamiento.
//
// Uso: node scripts/maps/gen-nuclear-reactors-world.js

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SLUG = 'nuclear-reactors-world';
const SRC_JSON = path.join(
  os.homedir(),
  'autopilot/strategy/data/nuclear-reactors-world/sites-es.json'
);
const OUT_PATH = path.join(__dirname, '..', '..', 'data', 'maps', `${SLUG}.geojson`);

const GROUP_NAME = 'Centrales nucleares por potencia operativa';
const GROUP_ID = 1;
const MARKER_TYPE = 'emoji_bulb';
const LEGEND_KEY = 'Potencia operativa (MW)';
const DATA_SOURCE =
  'IAEA Power Reactor Information System (PRIS), base de datos de reactores de ' +
  'potencia (consulta de octubre de 2026); coordenadas de cada central según ' +
  'GeoNuclearData 0.17.0 (ODbL), cruzadas con PRIS por el identificador IAEAId.';
const DATA_DATE = '2026-10-25';

function fmtEs(n, dec = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = Number(n).toFixed(dec);
  const [i, d] = s.split('.');
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return d ? `${ii},${d}` : ii;
}

function hslToHex(h, s, l) {
  const S = s / 100, L = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n) => L - a * Math.max(-1, Math.min(Math.min(k(n) - 3, 9 - k(n)), 1));
  const hx = (v) => Math.round(255 * v).toString(16).padStart(2, '0');
  return `#${hx(f(0))}${hx(f(8))}${hx(f(4))}`;
}

// Rampa monocromática ámbar (claro→oscuro) ordenada por la potencia.
function monoAmberRamp(steps = 8) {
  const HUE = 36;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const l = 88 - t * 58; // 88% → 30% luminosidad
    const s = 66 + t * 28; // 66% → 94% saturación
    out.push(hslToHex(HUE, s, l));
  }
  return out;
}

// El icono crece con la potencia neta del emplazamiento (log):
// 64 MW (Pevek) → 22 px; 6.478 MW (Bruce) → 66 px.
function emojiSizeForMW(v, min, max) {
  const lo = Math.log(min), hi = Math.log(max);
  const t = hi === lo ? 1 : (Math.log(v) - lo) / (hi - lo);
  return Math.round(22 + Math.max(0, Math.min(1, t)) * 44);
}

const TYPE_ES = {
  PWR: 'PWR (agua a presión)',
  BWR: 'BWR (agua en ebullición)',
  PHWR: 'PHWR (agua pesada)',
  LWGR: 'LWGR (grafito-agua ligera)',
  GCR: 'GCR (gas-grafito)',
  FBR: 'FBR (reproductor rápido)',
  HTGR: 'HTGR (alta temperatura)',
};

const NOTES = {
  Bruce: 'Es el mayor complejo nuclear del mundo: ocho reactores Candu repartidos entre Bruce A y Bruce B.',
  Hongyanhe: 'Es la mayor central nuclear de China, con seis reactores PWR en la costa de Liaoning.',
  Tianwan: 'Combina tecnología rusa VVER y china CPR-1000 en la costa del mar Amarillo.',
  Qinshan: 'Fue la primera central nuclear de China y hoy es el emplazamiento con más unidades del país (nueve).',
  Zaporizhzhia: 'Es la mayor central nuclear de Europa, con seis reactores VVER de 950 MW netos.',
  Gravelines: 'Es la mayor central nuclear de Francia y una de las mayores de Europa occidental.',
  Barakah: 'Es la primera central nuclear de los Emiratos Árabes Unidos y del mundo árabe.',
  Taishan: 'Alberga los dos reactores más potentes del mundo: 1.660 MW netos cada uno.',
  Olkiluoto: 'Su reactor OL3, de 1.600 MW netos, es el más potente de Europa.',
  Vogtle: 'Es la mayor central nuclear de Estados Unidos y la primera del país con reactores AP1000.',
  Kozloduy: 'Es la única central nuclear de Bulgaria y produce cerca de un tercio de su electricidad.',
  Temelin: 'Es la mayor central nuclear de la República Checa, con dos reactores VVER de 1.000 MW.',
  Borssele: 'Es la única central nuclear de los Países Bajos y una de las más antiguas de Europa.',
  Koeberg: 'Es la única central nuclear de África y la más meridional del mundo.',
  'Laguna Verde': 'Es la única central nuclear de México y la primera de América Latina.',
  Atucha: 'Es la única central nuclear de Argentina con reactores de agua pesada.',
  Angra: 'Es la única central nuclear de Brasil, en la costa de Río de Janeiro.',
  Cernavoda: 'Es la única central nuclear de Rumanía y usa reactores Candu de agua pesada.',
  Krsko: 'Es la única central nuclear de Eslovenia y suministra electricidad también a Croacia.',
  Armenia: 'Es la única central nuclear de Armenia y una de las pocas del Cáucaso.',
  Bushehr: 'Es la única central nuclear de Irán y la primera de Oriente Medio.',
  Chasnupp: 'Es una de las dos centrales nucleares de Pakistán, con reactores chinos CNP-300.',
};

function unitListFor(units) {
  return units
    .map((u) => `${u.name} (${fmtEs(u.netMW)} MW, ${u.gridYear || '—'})`)
    .join('; ');
}

function buildFeatures(data) {
  const sites = data.sites.slice().sort((a, b) => b.totalMW - a.totalMW || a.name.localeCompare(b.name));
  const capacities = sites.map((s) => s.totalMW);
  const ramp = monoAmberRamp(8);
  const minMW = capacities[capacities.length - 1];
  const maxMW = capacities[0];

  function colorForMW(mw) {
    const below = capacities.filter((v) => v <= mw).length;
    const t = capacities.length <= 1 ? 1 : (below - 1) / (capacities.length - 1);
    const idx = Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))));
    return ramp[idx];
  }

  return sites.map((s) => {
    const mwTxt = `${fmtEs(s.totalMW)} MW`;
    const typeTxt = s.types.map((t) => TYPE_ES[t] || t).join(' / ');
    const unitsTxt = unitListFor(s.units);
    const note = NOTES[s.name] || '';
    const description = [
      `${s.name} (${s.country}) suma ${s.unitCount} ${s.unitCount === 1 ? 'reactor operativo' : 'reactores operativos'} ` +
        `con una potencia neta de ${mwTxt}. ` +
        (s.firstYear
          ? `El primero se conectó a la red en ${s.firstYear}` +
            (s.lastYear && s.lastYear !== s.firstYear ? ` y el último en ${s.lastYear}` : '') +
            '. '
          : '') +
        `Tecnología: ${typeTxt}.`,
      note,
    ].filter(Boolean).join(' ');

    return {
      type: 'Feature',
      properties: {
        _manaName: s.name,
        name: s.name,
        _manaColor: colorForMW(s.totalMW),
        _manaFillOpacity: 0.9,
        _manaWeight: 1.2,
        _manaBorderColor: '#ffffff',
        _manaGeometryType: 'point',
        _manaGroupName: GROUP_NAME,
        _manaGroupId: GROUP_ID,
        markerType: MARKER_TYPE,
        _manaMarkerType: MARKER_TYPE,
        _manaEmojiSize: emojiSizeForMW(s.totalMW, minMW, maxMW),
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
        'Potencia operativa (MW)': s.totalMW,
        Reactores: s.unitCount,
        País: s.country,
        Tipo: typeTxt,
        Unidades: unitsTxt,
        'Primera conexión': s.firstYear,
        'Última conexión': s.lastYear,
        Dato: `${s.unitCount} reactores · ${mwTxt} · ${s.country}`,
        Description: description,
      },
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    };
  });
}

// Nombre que denota entidad-área (idéntico al de audit-gallery-quality.js §9).
const AREA_RE = /(?:^|\s)(?:desiertos?|pa[ií]ses?|regi[oó]ns?|islas?|oc[eé]anos?|mar de|mares?|lagos?|bosques?|glaciares?|pen[ií]nsulas?|archipi[eé]lagos?|deltas?|arrecifes?|fiordos?)\b/i;

function main() {
  if (!fs.existsSync(SRC_JSON)) {
    console.error('ERROR: no existe el extracto', SRC_JSON);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'));
  const features = buildFeatures(data);
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
    ['Potencia operativa (MW)', 'Reactores', 'País', 'Tipo', 'Unidades', 'Dato', 'Description'].every((k) => f.properties[k] != null && f.properties[k] !== '')
  );
  const powerOk = features.every((f) => Number.isFinite(f.properties['Potencia operativa (MW)']) && f.properties['Potencia operativa (MW)'] > 0);
  const areaNameOk = features.every((f) => !AREA_RE.test(f.properties._manaName));
  const countOk = features.length === data.siteCount && features.reduce((a, f) => a + f.properties.Reactores, 0) === data.reactorCount;
  // Ordenadas de mayor a menor potencia → color oscuro primero: R no decreciente.
  const rampOrdered = (() => {
    const rs = features.map((f) => parseInt(f.properties._manaColor.slice(1, 3), 16));
    let nonDec = 0;
    for (let i = 1; i < rs.length; i++) if (rs[i] >= rs[i - 1]) nonDec++;
    return nonDec >= rs.length - 2;
  })();

  console.log(`features: ${features.length} | reactores: ${features.reduce((a, f) => a + f.properties.Reactores, 0)} | KB: ${(JSON.stringify(geo).length / 1024).toFixed(1)}`);
  console.log(`hex: ${hexOk} | halo: ${haloOk} | marker: ${markerOk} | escala: ${scaleOk}`);
  console.log(`coords: ${coordsOk} | nombres únicos: ${uniqueOk} | popups: ${popupOk} | potencia: ${powerOk} | sin palabras de área: ${areaNameOk} | rampa ordenada: ${rampOrdered} | conteos: ${countOk}`);
  const ws = features.map((f) => f.properties['Potencia operativa (MW)']);
  console.log(`potencia por central: min ${fmtEs(Math.min(...ws))} MW · max ${fmtEs(Math.max(...ws))} MW`);
  if (!hexOk || !haloOk || !markerOk || !scaleOk || !coordsOk || !uniqueOk || !popupOk || !powerOk || !areaNameOk || !rampOrdered || !countOk) {
    console.error('VALIDATION FAILED');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(geo));
  console.log('GeoJSON guardado en', OUT_PATH);

  console.log('\nTop 10:');
  for (const f of features.slice(0, 10)) {
    console.log(`  ${fmtEs(f.properties['Potencia operativa (MW)'])} MW · ${f.properties.Reactores} reactores — ${f.properties._manaName} (${f.properties.País})`);
  }
}

main();
