// ── import-export.js ─ File import, export & drag-and-drop ──

// ── LAYER GROUP COUNTER ──
let _manaGroupCounter = 0;

// ── DRAG & DROP ──
(function () {
  const mapWrap = document.getElementById('map-wrap');
  const overlay = document.getElementById('drop-overlay');
  let dragCounter = 0;

  mapWrap.addEventListener('dragenter', e => {
    e.preventDefault(); dragCounter++;
    overlay.classList.add('active');
  });
  mapWrap.addEventListener('dragleave', e => {
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; overlay.classList.remove('active'); }
  });
  mapWrap.addEventListener('dragover', e => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
  });
  mapWrap.addEventListener('drop', async e => {
    e.preventDefault(); dragCounter = 0; overlay.classList.remove('active');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    await processFile(file);
  });
})();

// ── IMPORT ──
function importTrigger(accept) {
  document.querySelectorAll('.drop-menu').forEach(x => x.classList.remove('open'));
  const inp = document.getElementById('file-import');
  inp.accept = accept; inp.value = ''; inp.click();
}

async function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  await processFile(file);
}

// ── Derive a clean layer name from a filename ──
function layerNameFromFile(filename) {
  return filename
    .replace(/\.[^/.]+$/, '')          // strip extension
    .replace(/[_\-]+/g, ' ')           // dashes/underscores → spaces
    .replace(/\b\w/g, c => c.toUpperCase()); // title-case
}

async function processFile(file) {
  const name = file.name.toLowerCase();
  const layerName = layerNameFromFile(file.name);
  try {
    if (name.endsWith('.geojson') || name.endsWith('.json')) {
      loadGeoJSON(JSON.parse(await file.text()), layerName);
    } else if (name.endsWith('.kml')) {
      loadGeoJSON(kmlToGeoJSON(new DOMParser().parseFromString(await file.text(), 'text/xml')), layerName);
    } else if (name.endsWith('.kmz')) {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const kmlFile = Object.keys(zip.files).find(n => n.endsWith('.kml'));
      if (!kmlFile) throw new Error('No se encontr\u00F3 un .kml dentro del KMZ');
      loadGeoJSON(kmlToGeoJSON(new DOMParser().parseFromString(
        await zip.files[kmlFile].async('string'), 'text/xml'
      )), layerName);
    } else if (name.endsWith('.zip')) {
      const buf = await file.arrayBuffer();
      let geo;
      try { geo = await shp(buf); } catch (shpErr) {
        const zip = await JSZip.loadAsync(buf);
        const geoFile = Object.keys(zip.files).find(n => n.endsWith('.geojson') || n.endsWith('.json'));
        if (geoFile) { geo = JSON.parse(await zip.files[geoFile].async('string')); }
        else throw new Error('No se pudo leer el Shapefile. Aseg\u00FArate de que el .zip contiene .shp, .dbf y .prj.');
      }
      // For shapefiles: use the shapefile's internal name if available, else the zip filename
      if (Array.isArray(geo)) {
        geo.forEach(g => {
          const shpName = (g.fileName) ? layerNameFromFile(g.fileName) : layerName;
          loadGeoJSON(g, shpName);
        });
      } else {
        loadGeoJSON(geo, layerName);
      }
    } else {
      manaAlert('Formato no soportado.', 'warning');
    }
  } catch (err) { manaAlert('Error al importar: ' + err.message, 'error'); }
}

// ── Build attribute popup HTML ──
function buildAttrPopup(properties, geomType) {
  if (!properties || Object.keys(properties).length === 0) {
    return '<div class="attr-popup"><p class="attr-empty">Sin atributos</p></div>';
  }
  let html = '<div class="attr-popup"><table class="attr-table">';
  for (const [key, val] of Object.entries(properties)) {
    if (val === null || val === undefined || val === '') continue;
    // Skip internal/geometry fields
    if (key.startsWith('_') || key === 'bbox') continue;
    const safeKey = String(key).replace(/</g, '&lt;');
    let safeVal = String(val).replace(/</g, '&lt;');
    // Truncate very long values
    if (safeVal.length > 120) safeVal = safeVal.substring(0, 117) + '...';
    html += '<tr><td class="attr-key">' + safeKey + '</td><td class="attr-val">' + safeVal + '</td></tr>';
  }
  html += '</table></div>';
  return html;
}

function loadGeoJSON(geo, groupName) {
  if (!geo) return;
  if (geo.type === 'Feature') geo = { type: 'FeatureCollection', features: [geo] };
  if (!geo.features) { manaAlert('GeoJSON no v\u00E1lido.', 'error'); return; }

  // Assign a unique group ID for this imported layer
  const groupId = ++_manaGroupCounter;
  const gName = groupName || geo.fileName || 'Capa importada';
  // Register group in metadata registry
  registerGroupMeta(groupId, gName, drawColor);

  const layer = L.geoJSON(geo, {
    style: { color: drawColor, weight: 2, fillOpacity: .18 },
    pointToLayer: (f, ll) => {
      const n = (f.properties && (f.properties.name || f.properties.Name || f.properties.NAME)) || 'Importado';
      const icon = makeMarkerIcon(drawColor, markerType);
      const m = L.marker(ll, { icon });
      m._manaName = n; m._manaColor = drawColor;
      m._manaGroupId = groupId;
      m._manaGroupName = gName;
      m._manaProperties = f.properties || {};
      m.bindPopup(buildAttrPopup(f.properties, 'Point'), { maxWidth: 360, className: 'attr-popup-wrapper' });
      return m;
    },
    onEachFeature: (f, l) => {
      l._manaGroupId = groupId;
      l._manaGroupName = gName;
      l._manaProperties = f.properties || {};
      if (!(l instanceof L.Marker)) {
        const n = (f.properties && (f.properties.name || f.properties.Name || f.properties.NAME)) || '';
        if (n) l._manaName = n;
        l.bindPopup(buildAttrPopup(f.properties, f.geometry && f.geometry.type), { maxWidth: 360, className: 'attr-popup-wrapper' });
      }
    }
  });

  // Add to map and register each layer in group meta
  layer.eachLayer(l => {
    drawnItems.addLayer(l);
    addLayerToGroupMeta(groupId, l);
  });

  const bounds = layer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
  stats();
  if (typeof saveState === 'function') saveState();
}

// ── KML PARSER ──
function kmlToGeoJSON(xmlDoc) {
  const features = [];
  xmlDoc.querySelectorAll('Placemark').forEach(pm => {
    const name = pm.querySelector('name')?.textContent || '';
    const props = { name };

    const pt = pm.querySelector('Point coordinates');
    if (pt) {
      const [lng, lat] = pt.textContent.trim().split(',').map(Number);
      features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [lng, lat] } });
      return;
    }
    const ls = pm.querySelector('LineString coordinates');
    if (ls) {
      const coords = ls.textContent.trim().split(/\s+/).map(c => {
        const [lng, lat] = c.split(',').map(Number); return [lng, lat];
      });
      features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });
      return;
    }
    const pg = pm.querySelector('Polygon outerBoundaryIs LinearRing coordinates');
    if (pg) {
      const coords = pg.textContent.trim().split(/\s+/).map(c => {
        const [lng, lat] = c.split(',').map(Number); return [lng, lat];
      });
      features.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [coords] } });
    }
  });
  return { type: 'FeatureCollection', features };
}

// ── EXPORT ──
function hexToKmlColor(hex, alpha) {
  alpha = alpha || 'ff';
  const r = hex.slice(1, 3), g = hex.slice(3, 5), b = hex.slice(5, 7);
  return alpha + b + g + r;
}

function exportAs(fmt) {
  document.querySelectorAll('.drop-menu').forEach(x => x.classList.remove('open'));
  const geo = getEnrichedGeoJSON();
  if (!geo.features.length) { manaAlert('No hay elementos para exportar.', 'warning'); return; }
  if (fmt === 'geojson') return dl(JSON.stringify(geo, null, 2), 'mana-maps.geojson', 'application/json');
  if (fmt === 'csv') return exportCSV(geo);
  if (fmt === 'kml') return exportKMZ(geo);
  if (fmt === 'shapefile') return exportShapefile(geo);
}

function dl(content, filename, mime, isBlob) {
  isBlob = isBlob || false;
  const blob = isBlob ? content : new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

function exportCSV(geo) {
  const rows = [['id', 'type', 'name', 'longitude', 'latitude', 'coordinates']];
  geo.features.forEach((f, i) => {
    const g = f.geometry, p = f.properties || {};
    const name = p.name || p.title || ('Elemento ' + (i + 1));
    if (g.type === 'Point') rows.push([i + 1, 'Point', name, g.coordinates[0], g.coordinates[1], '']);
    else rows.push([i + 1, g.type, name, '', '', JSON.stringify(g.coordinates)]);
  });
  dl(rows.map(r => r.map(v => ('"' + String(v).replace(/"/g, '""') + '"')).join(',')).join('\n'),
    'mana-maps.csv', 'text/csv');
}

function geoToKML(geo) {
  const parts = geo.features.map(function(f, i) {
    const g = f.geometry;
    const name = (f.properties && f.properties.name) || ('Elemento ' + (i + 1));
    const hex = (f.properties && f.properties.color) || '#0ea5e9';
    const kmlColor = hexToKmlColor(hex);
    const fillColor = '66' + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);
    const styleId = 'style' + i;
    let styleTag = '';

    if (g.type === 'Point') {
      styleTag = '<Style id="' + styleId + '"><IconStyle><color>' + kmlColor + '</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle><LabelStyle><scale>0.8</scale></LabelStyle></Style>';
    } else {
      styleTag = '<Style id="' + styleId + '"><LineStyle><color>' + kmlColor + '</color><width>2</width></LineStyle><PolyStyle><color>' + fillColor + '</color></PolyStyle></Style>';
    }

    let geomTag = '';
    if (g.type === 'Point') {
      geomTag = '<Point><coordinates>' + g.coordinates[0] + ',' + g.coordinates[1] + ',0</coordinates></Point>';
    } else if (g.type === 'LineString') {
      const c = g.coordinates.map(function(p) { return p[0] + ',' + p[1] + ',0'; }).join(' ');
      geomTag = '<LineString><coordinates>' + c + '</coordinates></LineString>';
    } else if (g.type === 'Polygon') {
      const c = g.coordinates[0].map(function(p) { return p[0] + ',' + p[1] + ',0'; }).join(' ');
      geomTag = '<Polygon><outerBoundaryIs><LinearRing><coordinates>' + c + '</coordinates></LinearRing></outerBoundaryIs></Polygon>';
    }
    return styleTag + '\n<Placemark><name>' + name + '</name><styleUrl>#' + styleId + '</styleUrl>' + geomTag + '</Placemark>';
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Ma\u00F1a Maps</name>\n' + parts.join('\n') + '\n</Document></kml>';
}

async function exportKMZ(geo) {
  const kml = geoToKML(geo);
  const zip = new JSZip();
  zip.file('doc.kml', kml);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  dl(blob, 'mana-maps.kmz', 'application/vnd.google-earth.kmz', true);
}

async function exportShapefile(geo) {
  const points = geo.features.filter(f => f.geometry.type === 'Point');
  const lines = geo.features.filter(f => f.geometry.type === 'LineString');
  const polygons = geo.features.filter(f => f.geometry.type === 'Polygon');
  const zip = new JSZip();
  const prj = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

  function w32le(v) { const b = new ArrayBuffer(4); new DataView(b).setInt32(0, v, true); return b; }
  function w32be(v) { const b = new ArrayBuffer(4); new DataView(b).setInt32(0, v, false); return b; }
  function wdbl(v) { const b = new ArrayBuffer(8); new DataView(b).setFloat64(0, v, true); return b; }
  function concat(...bs) {
    const t = bs.reduce((s, b) => s + b.byteLength, 0);
    const o = new Uint8Array(t); let f = 0;
    bs.forEach(b => { o.set(new Uint8Array(b), f); f += b.byteLength; });
    return o.buffer;
  }

  function buildPointShp(feats) {
    const recs = feats.map((f, i) => {
      const [x, y] = f.geometry.coordinates;
      const c = concat(w32le(1), wdbl(x), wdbl(y));
      return concat(w32be(i + 1), w32be(c.byteLength / 2), c);
    });
    const cLen = recs.reduce((s, r) => s + r.byteLength, 0);
    const fLen = 100 + cLen;
    const hdr = new ArrayBuffer(100);
    const dv = new DataView(hdr);
    dv.setInt32(0, 9994, false);
    dv.setInt32(24, fLen / 2, false);
    dv.setInt32(28, 1000, true);
    dv.setInt32(32, 1, true);
    return concat(hdr, ...recs);
  }

  function buildDBF(feats) {
    const recs = feats.map((f, i) => {
      const name = (f.properties && (f.properties.name || f.properties.title)) || ('Elem ' + (i + 1));
      return name.substring(0, 50).padEnd(50, ' ');
    });
    const n = recs.length, fl = 50, hs = 32 + 32 + 1, rs = 1 + fl;
    const buf = new ArrayBuffer(hs + n * rs);
    const dv = new DataView(buf);
    dv.setUint8(0, 3); dv.setUint16(8, hs, true); dv.setUint16(10, rs, true); dv.setInt32(4, n, true);
    const enc = new TextEncoder();
    enc.encode('NAME      ').forEach((b, i) => dv.setUint8(32 + i, b));
    dv.setUint8(32 + 11, 67); dv.setUint8(32 + 16, fl); dv.setUint8(32 + 32, 13);
    recs.forEach((r, i) => {
      const o = hs + i * rs; dv.setUint8(o, 32);
      enc.encode(r).forEach((b, j) => dv.setUint8(o + 1 + j, b));
    });
    return buf;
  }

  if (points.length) {
    zip.file('puntos.shp', buildPointShp(points));
    zip.file('puntos.dbf', buildDBF(points));
    zip.file('puntos.prj', prj);
  }
  if (lines.length)
    zip.file('lineas.geojson', JSON.stringify({ type: 'FeatureCollection', features: lines }, null, 2));
  if (polygons.length)
    zip.file('poligonos.geojson', JSON.stringify({ type: 'FeatureCollection', features: polygons }, null, 2));

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  dl(blob, 'mana-maps-shp.zip', 'application/zip', true);
}
