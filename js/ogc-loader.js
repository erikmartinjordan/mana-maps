// ── ogc-loader.js ─ WMS/WFS & ArcGIS Feature Service loader ──

// ═══════════════════════════════════════════════════════════════
// WMS OVERLAY TRACKING
// ═══════════════════════════════════════════════════════════════
const _wmsOverlays = [];  // { id, label, layer, visible }
let _wmsIdCounter = 0;
let _ogcCatalogOpen = false;

function _hostnameFromURL(url) {
  try { return new URL(url).hostname; } catch(e) { return url.substring(0, 40); }
}

// ═══════════════════════════════════════════════════════════════
// CATÁLOGO DE SERVICIOS PRECONFIGURADOS
// URLs completas y testeadas para cada servicio
// ═══════════════════════════════════════════════════════════════
const OGC_CATALOG = [
  { section: 'ICGC · Catalunya' },
  { name: 'Mapa topogràfic',        type: 'wms', url: 'https://geoserveis.icgc.cat/servei/catalunya/mapa-base/wms' },
  { name: 'Ortofotos',              type: 'wms', url: 'https://geoserveis.icgc.cat/servei/catalunya/ortofoto/wms' },
  { name: 'Mapa geològic 1:50.000', type: 'wms', url: 'https://geoserveis.icgc.cat/servei/catalunya/mapa-geologic/wms' },
  { section: 'IGN · España' },
  { name: 'Mapa base raster',       type: 'wms', url: 'https://www.ign.es/wms-inspire/mapa-raster' },
  { name: 'Ortoimágenes PNOA',      type: 'wms', url: 'https://www.ign.es/wms-inspire/pnoa-ma' },
  { name: 'Hidrografía',            type: 'wms', url: 'https://servicios.idee.es/wms-inspire/hidrografia' },
  { section: 'INSPIRE · EU' },
  { name: 'Catastro parcelas',      type: 'wms', url: 'https://ovc.catastro.meh.es/cartografia/INSPIRE/spadgcwms.aspx' },
];

// ═══════════════════════════════════════════════════════════════
// DETECCIÓN AUTOMÁTICA DE TIPO
// ═══════════════════════════════════════════════════════════════
function detectServiceType(url) {
  if (!url) return 'unknown';
  const u = url.toLowerCase();
  if (u.includes('/rest/services/') || u.includes('/mapserver') || u.includes('/featureserver')) return 'arcgis';
  if (u.includes('/wfs') || u.includes('service=wfs')) return 'wfs';
  if (u.includes('/wms') || u.includes('service=wms')) return 'wms';
  return 'unknown';
}

// ═══════════════════════════════════════════════════════════════
// CARGA UNIFICADA (entry point)
// ═══════════════════════════════════════════════════════════════
async function loadUnifiedOGC() {
  var input = document.getElementById('ogc-url-input');
  var btn   = document.getElementById('ogc-add-btn');
  if (!input) return;
  var url = input.value.trim();
  if (!url) { manaAlert('Introduce una URL de servicio WMS, WFS o ArcGIS.', 'warning'); return; }

  var type = detectServiceType(url);

  // Spinner
  if (btn) { btn.disabled = true; btn.textContent = 'Cargando…'; }

  try {
    if (type === 'wfs')         await _loadWFS(url);
    else if (type === 'arcgis') await _loadArcGIS(url);
    else                        _loadWMS(url);

    input.value = '';
  } catch (err) {
    console.error('OGC error:', err);
    manaAlert('Error: ' + (err.message || 'No se pudo cargar el servicio'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Añadir'; }
  }
}

// Bind Enter key
document.addEventListener('DOMContentLoaded', function() {
  var inp = document.getElementById('ogc-url-input');
  if (inp) inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') loadUnifiedOGC(); });
});

// ═══════════════════════════════════════════════════════════════
// WMS LOADER (tile overlay — works well)
// ═══════════════════════════════════════════════════════════════
function _loadWMS(url) {
  try {
    var layers = '';
    try {
      var parsed = new URL(url);
      if (parsed.searchParams.has('layers')) {
        layers = parsed.searchParams.get('layers');
        parsed.searchParams.delete('layers');
      }
      parsed.searchParams.delete('request');
      parsed.searchParams.delete('service');
      parsed.searchParams.delete('version');
    } catch(e) {}

    var wmsLayer = L.tileLayer.wms(url.split('?')[0], {
      layers: layers,
      format: 'image/png',
      transparent: true,
      attribution: _hostnameFromURL(url),
    }).addTo(map);

    var id = ++_wmsIdCounter;
    var label = _hostnameFromURL(url) + (layers ? ' (' + layers + ')' : '');
    _wmsOverlays.push({ id: id, label: label, layer: wmsLayer, visible: true });
    _renderWMSLayers();
    showToast('WMS añadido ✓');
    if (typeof saveState === 'function') saveState();
  } catch (e) {
    manaAlert('Error WMS: ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
// WFS LOADER — robusto: intenta múltiples formatos y proxy CORS
// ═══════════════════════════════════════════════════════════════
async function _loadWFS(url) {
  showToast('Cargando WFS…');

  // Si la URL ya tiene request=GetFeature completo, usarla tal cual
  if (url.toLowerCase().includes('request=getfeature')) {
    return await _fetchWFS(url);
  }

  // Construir petición GetFeature con distintos formatos
  var base = url.split('?')[0];
  var sep = '?';

  // Lista de combinaciones a intentar (formato salida)
  var attempts = [
    base + sep + 'service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json&count=2000',
    base + sep + 'service=WFS&version=1.1.0&request=GetFeature&outputFormat=application/json&maxFeatures=2000',
    base + sep + 'service=WFS&version=2.0.0&request=GetFeature&outputFormat=geojson&count=2000',
  ];

  var lastError = null;
  for (var i = 0; i < attempts.length; i++) {
    try {
      await _fetchWFS(attempts[i]);
      return; // Éxito
    } catch(e) {
      lastError = e;
      console.warn('WFS intento ' + (i+1) + ' falló:', e.message);
    }
  }

  // Si todo falló, intentar vía proxy CORS
  try {
    var proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(attempts[0]);
    await _fetchWFS(proxyUrl);
    return;
  } catch(e) {
    console.warn('WFS proxy CORS también falló:', e.message);
  }

  // Error final con mensaje útil
  throw new Error(
    'No se pudo cargar el WFS. Posibles causas:\n' +
    '• El servidor bloquea peticiones del navegador (CORS)\n' +
    '• El servicio requiere parámetros adicionales (typeNames)\n' +
    '• Formato de salida no soportado\n\n' +
    'Último error: ' + (lastError ? lastError.message : 'desconocido')
  );
}

async function _fetchWFS(fetchUrl) {
  var resp = await fetch(fetchUrl);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);

  var text = await resp.text();

  // Comprobar si es XML de error (muchos WFS devuelven XML cuando falla)
  if (text.trim().startsWith('<') && (text.includes('ExceptionReport') || text.includes('ServiceException'))) {
    // Extraer mensaje de error del XML
    var match = text.match(/<(?:ows:)?ExceptionText>([\s\S]*?)<\/(?:ows:)?ExceptionText>/);
    if (!match) match = text.match(/<ServiceException[^>]*>([\s\S]*?)<\/ServiceException>/);
    var xmlErr = match ? match[1].trim() : 'El servidor devolvió un error XML';
    throw new Error(xmlErr);
  }

  // Intentar parsear como JSON
  var geo;
  try {
    geo = JSON.parse(text);
  } catch(e) {
    throw new Error('La respuesta no es JSON válido (posiblemente GML/XML)');
  }

  if (!geo.features || !geo.features.length) {
    throw new Error('El servicio no devolvió features');
  }

  var label = _hostnameFromURL(fetchUrl);
  loadGeoJSON(geo, 'WFS: ' + label);
  showToast(geo.features.length + ' features WFS cargados ✓');
  if (typeof saveState === 'function') saveState();
}

// ═══════════════════════════════════════════════════════════════
// ARCGIS FEATURE SERVICE LOADER
// ═══════════════════════════════════════════════════════════════
async function _loadArcGIS(url) {
  showToast('Cargando ArcGIS…');
  url = url.replace(/\/$/, '');

  var allFeatures = [];
  var offset = 0;
  var limit = 1000;
  var hasMore = true;

  try {
    while (hasMore) {
      var sep = url.includes('?') ? '&' : '?';
      var fetchUrl = url + '/query' + sep +
        'where=1%3D1&outFields=*&f=geojson' +
        '&resultOffset=' + offset +
        '&resultRecordCount=' + limit;

      var resp = await fetch(fetchUrl);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();

      if (data.features && data.features.length) {
        allFeatures.push.apply(allFeatures, data.features);
        offset += data.features.length;
      }

      if (data.exceededTransferLimit === true && data.features && data.features.length === limit) {
        hasMore = true;
        showToast('Cargando ArcGIS… (' + allFeatures.length + ' elementos)');
      } else {
        hasMore = false;
      }
    }

    if (!allFeatures.length) {
      manaAlert('El servicio ArcGIS no devolvió datos.', 'warning');
      return;
    }

    var fc = { type: 'FeatureCollection', features: allFeatures };
    var label = _hostnameFromURL(url);
    loadGeoJSON(fc, 'ArcGIS: ' + label);
    showToast(allFeatures.length + ' elementos cargados ✓');
    if (typeof saveState === 'function') saveState();
  } catch (e) {
    manaAlert('Error ArcGIS: ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
// WMS OVERLAY MANAGEMENT
// ═══════════════════════════════════════════════════════════════
function toggleWMSLayer(id) {
  var item = _wmsOverlays.find(function(w) { return w.id === id; });
  if (!item) return;
  if (item.visible) {
    map.removeLayer(item.layer);
    item.visible = false;
  } else {
    item.layer.addTo(map);
    item.visible = true;
  }
  _renderWMSLayers();
}

function removeWMSLayer(id) {
  var idx = _wmsOverlays.findIndex(function(w) { return w.id === id; });
  if (idx === -1) return;
  var item = _wmsOverlays[idx];
  if (map.hasLayer(item.layer)) map.removeLayer(item.layer);
  _wmsOverlays.splice(idx, 1);
  _renderWMSLayers();
  showToast('Capa WMS eliminada');
}

function _renderWMSLayers() {
  var container = document.getElementById('wms-layer-list');
  if (!container) return;
  if (!_wmsOverlays.length) { container.innerHTML = ''; return; }
  container.innerHTML = _wmsOverlays.map(function(w) {
    var eyeIcon = w.visible
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22"/></svg>';
    return '<div class="wms-layer-item">' +
      '<button class="wms-eye-btn' + (w.visible ? '' : ' off') + '" onclick="toggleWMSLayer(' + w.id + ')" title="Mostrar/ocultar">' + eyeIcon + '</button>' +
      '<span class="wms-layer-label">' + w.label + '</span>' +
      '<button class="wms-remove-btn" onclick="removeWMSLayer(' + w.id + ')" title="Eliminar">&times;</button>' +
      '</div>';
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// CATÁLOGO — render y toggle
// ═══════════════════════════════════════════════════════════════
function toggleOGCCatalog() {
  var el = document.getElementById('ogc-catalog-list');
  var arrow = document.getElementById('ogc-catalog-arrow');
  if (!el) return;
  _ogcCatalogOpen = !_ogcCatalogOpen;
  if (_ogcCatalogOpen) {
    _renderOGCCatalog();
    el.style.display = 'block';
    if (arrow) arrow.style.transform = 'rotate(90deg)';
  } else {
    el.style.display = 'none';
    if (arrow) arrow.style.transform = '';
  }
}

function _renderOGCCatalog() {
  var el = document.getElementById('ogc-catalog-list');
  if (!el) return;
  var html = '';
  OGC_CATALOG.forEach(function(item) {
    if (item.section) {
      html += '<div class="ogc-cat-section">' + item.section + '</div>';
    } else {
      var badge = item.type === 'wms'
        ? '<span class="ogc-cat-badge ogc-cat-wms">WMS</span>'
        : item.type === 'wfs'
        ? '<span class="ogc-cat-badge ogc-cat-wfs">WFS</span>'
        : '<span class="ogc-cat-badge">???</span>';
      html += '<div class="ogc-cat-item" onclick="loadFromCatalog(\'' + item.url + '\')" title="' + item.url + '">' +
        '<span class="ogc-cat-name">' + item.name + '</span>' + badge + '</div>';
    }
  });
  el.innerHTML = html;
}

function loadFromCatalog(url) {
  var input = document.getElementById('ogc-url-input');
  if (input) input.value = url;
  toggleOGCCatalog();
  loadUnifiedOGC();
}

// ═══════════════════════════════════════════════════════════════
// BACKWARD COMPAT
// ═══════════════════════════════════════════════════════════════
function loadOGCService() { loadUnifiedOGC(); }
function loadArcGISService() { loadUnifiedOGC(); }
