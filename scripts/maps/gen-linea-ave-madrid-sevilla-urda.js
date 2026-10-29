#!/usr/bin/env node
// ── gen-linea-ave-madrid-sevilla-urda.js ──────────────────────────────────
// Genera data/maps/linea-ave-madrid-sevilla-urda.geojson a partir de la
// relación 1254828 de OpenStreetMap («AVE Madrid - Sevilla», route=train,
// service=high_speed). Une las 246 vías de la relación en una sola línea,
// calcula la distancia acumulada desde Madrid-Puerta de Atocha y marca el
// punto del accidente en el kilómetro 118, cerca de la estación de Urda.
//
// Fuente cruda: data/sources/linea-ave-madrid-sevilla-urda/
//   route-relation-1254828.json (Overpass API, out geom, consulta 2026-10-29).
//
// Uso: node scripts/maps/gen-linea-ave-madrid-sevilla-urda.js

'use strict';

const fs = require('fs');
const path = require('path');

const SLUG = 'linea-ave-madrid-sevilla-urda';
const ROOT = path.join(__dirname, '..', '..');
const SRC_PATH = path.join(ROOT, 'data', 'sources', SLUG, 'route-relation-1254828.json');
const OUT_PATH = path.join(ROOT, 'data', 'maps', `${SLUG}.geojson`);

const GROUP_LINE = { name: 'Línea de alta velocidad', id: 1 };
const GROUP_STATION = { name: 'Estaciones', id: 2 };
const GROUP_ACCIDENT = { name: 'Accidente', id: 3 };

const COLOR_LINE = '#30363b';
const COLOR_STATION = '#5f6670';
const COLOR_ACCIDENT = '#b42318';

const ATOCHA = { lon: -3.6895522, lat: 40.4053532, name: 'Madrid-Puerta de Atocha' };
const SANTA_JUSTA = { lon: -5.9748668, lat: 37.3921159, name: 'Sevilla-Santa Justa' };

const LABEL_STYLE = {
  enabled: true,
  field: '_manaName',
  fontFamily: 'monospace',
  fontSize: 12,
  fontWeight: '600',
  color: '#0f172a',
  haloWidth: 3,
  haloColor: '#ffffff',
  opacity: 0.95,
  placement: 'auto'
};

function haversineKm(a, b) {
  const R = 6371.0088;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function close(a, b, eps = 1e-6) {
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
}

function stitchWays(ways) {
  if (!ways.length) throw new Error('La relación no tiene vías con geometría');
  let path = ways[0].slice();
  for (let i = 1; i < ways.length; i++) {
    const w = ways[i];
    const last = path[path.length - 1];
    if (close(last, w[0])) {
      path = path.concat(w.slice(1));
    } else if (close(last, w[w.length - 1])) {
      path = path.concat(w.slice(0, -1).reverse());
    } else {
      throw new Error(`Hueco en la relación: la vía ${i} no conecta con la anterior`);
    }
  }
  return path;
}

function cumulativeKm(path) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + haversineKm(path[i - 1], path[i]));
  }
  return cum;
}

function pointAtKm(path, cum, targetKm) {
  if (targetKm <= 0) return path[0].slice();
  if (targetKm >= cum[cum.length - 1]) return path[path.length - 1].slice();
  for (let i = 1; i < path.length; i++) {
    if (cum[i] >= targetKm) {
      const span = cum[i] - cum[i - 1];
      const t = span > 0 ? (targetKm - cum[i - 1]) / span : 0;
      return [
        path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
        path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t
      ];
    }
  }
  return path[path.length - 1].slice();
}

function pointFeature(lon, lat, props) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: props
  };
}

function main() {
  if (!fs.existsSync(SRC_PATH)) {
    throw new Error(`No existe la fuente cruda: ${SRC_PATH}`);
  }
  const raw = JSON.parse(fs.readFileSync(SRC_PATH, 'utf8'));
  const relation = (raw.elements || []).find((e) => e.type === 'relation' && e.id === 1254828);
  if (!relation) throw new Error('No se encontró la relación 1254828 en la fuente cruda');

  const ways = relation.members
    .filter((m) => m.type === 'way' && Array.isArray(m.geometry) && m.geometry.length > 1)
    .map((m) => m.geometry.map((p) => [p.lon, p.lat]));

  const line = stitchWays(ways);
  const cum = cumulativeKm(line);
  const totalKm = cum[cum.length - 1];
  const accident = pointAtKm(line, cum, 118);

  const features = [
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: line },
      properties: {
        name: 'Línea de alta velocidad Madrid-Sevilla',
        _manaName: 'Línea de alta velocidad Madrid-Sevilla',
        _manaColor: COLOR_LINE,
        _manaFillOpacity: 0.9,
        _manaWeight: 3.5,
        _manaBorderColor: '#ffffff',
        _manaGeometryType: 'line',
        _manaGroupName: GROUP_LINE.name,
        _manaGroupId: GROUP_LINE.id,
        _manaLabelStyle: LABEL_STYLE,
        Tipo: 'Línea de alta velocidad',
        Dato: '471 km de vía entre Madrid y Sevilla',
        'Longitud (km)': 471,
        'Longitud calculada (km)': Number(totalKm.toFixed(1)),
        Inauguración: '1992',
        Operador: 'Adif / Renfe',
        Description: `Corredor de alta velocidad que conecta Madrid-Puerta de Atocha con Sevilla-Santa Justa. La geometría procede de las ${ways.length} vías de la relación 1254828 de OpenStreetMap; la distancia acumulada calculada es de ${totalKm.toFixed(1)} km.`
      }
    },
    pointFeature(ATOCHA.lon, ATOCHA.lat, {
      name: ATOCHA.name,
      _manaName: ATOCHA.name,
      markerType: 'emoji_train',
      _manaMarkerType: 'emoji_train',
      _manaColor: COLOR_STATION,
      _manaEmojiSize: 24,
      _manaFillOpacity: 1,
      _manaWeight: 1,
      _manaBorderColor: '#ffffff',
      _manaGeometryType: 'point',
      _manaGroupName: GROUP_STATION.name,
      _manaGroupId: GROUP_STATION.id,
      _manaLabelStyle: { ...LABEL_STYLE, fontSize: 11 },
      Tipo: 'Estación',
      Dato: 'Origen del corredor',
      Description: 'Estación de Madrid-Puerta de Atocha. Los dos trenes implicados en el accidente salieron de aquí el 28 de octubre de 2026.'
    }),
    pointFeature(SANTA_JUSTA.lon, SANTA_JUSTA.lat, {
      name: SANTA_JUSTA.name,
      _manaName: SANTA_JUSTA.name,
      markerType: 'emoji_train',
      _manaMarkerType: 'emoji_train',
      _manaColor: COLOR_STATION,
      _manaEmojiSize: 24,
      _manaFillOpacity: 1,
      _manaWeight: 1,
      _manaBorderColor: '#ffffff',
      _manaGeometryType: 'point',
      _manaGroupName: GROUP_STATION.name,
      _manaGroupId: GROUP_STATION.id,
      _manaLabelStyle: { ...LABEL_STYLE, fontSize: 11 },
      Tipo: 'Estación',
      Dato: 'Destino del corredor',
      Description: 'Estación de Sevilla-Santa Justa, final de la línea de alta velocidad Madrid-Sevilla.'
    }),
    pointFeature(accident[0], accident[1], {
      name: 'Accidente de Urda',
      _manaName: 'Accidente de Urda',
      markerType: 'emoji_collision',
      _manaMarkerType: 'emoji_collision',
      _manaColor: COLOR_ACCIDENT,
      _manaEmojiSize: 48,
      _manaFillOpacity: 1,
      _manaWeight: 1,
      _manaBorderColor: '#ffffff',
      _manaGeometryType: 'point',
      _manaGroupName: GROUP_ACCIDENT.name,
      _manaGroupId: GROUP_ACCIDENT.id,
      _manaLabelStyle: { ...LABEL_STYLE, fontSize: 12 },
      Tipo: 'Accidente',
      Dato: 'Colisión por alcance a las 8:53 del 28 de octubre de 2026',
      Fecha: '28 de octubre de 2026',
      Hora: '8:53',
      Kilómetro: 118,
      Fallecidos: '68 (provisional)',
      Heridos: 'Más de 180 atendidos',
      Trenes: 'AVE de Renfe (2080) e Iryo (6076)',
      Description: 'Un AVE de Renfe embistió por detrás a un tren de Iryo detenido en la vía, a la altura de la estación de Urda (Toledo). El balance provisional es de 68 fallecidos. La investigación apunta a una orden del centro de control de Adif tras un fallo del sistema LZB.'
    })
  ];

  const geo = {
    type: 'FeatureCollection',
    name: 'Línea de alta velocidad Madrid-Sevilla y accidente de Urda',
    features
  };

  // ── Validación previa ──────────────────────────────────────────────────
  const names = features.map((f) => f.properties._manaName);
  if (new Set(names).size !== names.length) throw new Error('Nombres duplicados');
  for (const f of features) {
    const p = f.properties;
    if (!/^#[0-9a-fA-F]{6}$/.test(p._manaColor)) throw new Error(`Color inválido en ${p._manaName}`);
    if (!p._manaLabelStyle || p._manaLabelStyle.haloWidth < 2) throw new Error(`LabelStyle incompleto en ${p._manaName}`);
    if (!p._manaGroupName || !Number.isInteger(p._manaGroupId)) throw new Error(`Grupo incompleto en ${p._manaName}`);
    const walk = (c) => {
      if (typeof c[0] === 'number') {
        if (c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) throw new Error(`Coordenada fuera de rango en ${p._manaName}`);
      } else c.forEach(walk);
    };
    walk(f.geometry.coordinates);
  }
  if (line.length < 2) throw new Error('La línea no tiene suficientes puntos');
  if (features.filter((f) => f.geometry.type === 'Point').length !== 3) throw new Error('Se esperaban tres puntos');
  const accidentFeature = features.find((f) => f.properties.Tipo === 'Accidente');
  if (!accidentFeature) throw new Error('Falta el punto del accidente');
  const distToLine = Math.min(...line.map((p) => haversineKm(p, accidentFeature.geometry.coordinates)));
  if (distToLine > 0.05) throw new Error('El punto del accidente no está sobre la línea');

  fs.writeFileSync(OUT_PATH, JSON.stringify(geo));
  console.log(`OK ${OUT_PATH}`);
  console.log(`  features: ${features.length} · puntos: ${line.length} · longitud: ${totalKm.toFixed(2)} km`);
  console.log(`  accidente: ${accident[1].toFixed(6)}, ${accident[0].toFixed(6)} (km 118)`);
  console.log(`  tamaño GeoJSON: ${(JSON.stringify(geo).length / 1024).toFixed(1)} KB`);
}

main();
