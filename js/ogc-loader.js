// ── ogc-loader.js ─ WMS / WFS / ArcGIS loader ──────────────────

const _wmsServices = [];
let _wmsIdCounter = 0;
let _ogcCatalogOpen = false;

function _host(url) {
  try { return new URL(url).hostname; } catch(e) { return url.substring(0,30); }
}

// ── CATÁLOGO ────────────────────────────────────────────────────
const OGC_CATALOG = [
  { section: 'ICGC · Catalunya' },
  { name: 'Topogràfic',             type: 'wms', url: 'https://geoserveis.icgc.cat/servei/catalunya/mapa-base/wms' },
  { name: 'Ortofotos',              type: 'wms', url: 'https://geoserveis.icgc.cat/servei/catalunya/ortofoto/wms' },
  { name: 'Geològic 1:50 000',      type: 'wms', url: 'https://geoserveis.icgc.cat/servei/catalunya/mapa-geologic/wms' },
  { name: 'Municipis de Catalunya',  type: 'wfs', url: 'https://geoserveis.icgc.cat/servei/catalunya/divisions-administratives/wfs' },
  { section: 'IGN · España' },
  { name: 'Mapa raster',            type: 'wms', url: 'https://www.ign.es/wms-inspire/mapa-raster' },
  { name: 'PNOA Ortoimágenes',      type: 'wms', url: 'https://www.ign.es/wms-inspire/pnoa-ma' },
  { name: 'Hidrografía',            type: 'wms', url: 'https://servicios.idee.es/wms-inspire/hidrografia' },
  { section: 'Otros' },
  { name: 'Catastro INSPIRE',       type: 'wms', url: 'https://ovc.catastro.meh.es/cartografia/INSPIRE/spadgcwms.aspx' },
];

// ── DETECCIÓN DE TIPO ───────────────────────────────────────────
function _detectType(url) {
  var u = (url || '').toLowerCase();
  if (u.includes('/rest/services/') || u.includes('/mapserver') || u.includes('/featureserver')) return 'arcgis';
  if (u.includes('/wfs') || u.includes('service=wfs')) return 'wfs';
  return 'wms';
}

// ── ENTRY POINT — se dispara con Enter ──────────────────────────
async function loadUnifiedOGC() {
  var input = document.getElementById('ogc-url-input');
  if (!input) return;
  var url = input.value.trim();
  if (!url) return;

  // Feedback visual en el input
  input.disabled = true;
  input.classList.add('ogc-loading');

  try {
    var type = _detectType(url);
    if (type === 'wfs')         await _loadWFS(url);
    else if (type === 'arcgis') await _loadArcGIS(url);
    else                        await _loadWMS(url);
    input.value = '';
  } catch (e) {
    console.error('OGC:', e);
    manaAlert('Error: ' + e.message, 'error');
  } finally {
    input.disabled = false;
    input.classList.remove('ogc-loading');
    input.focus();
  }
}

// Enter para cargar
document.addEventListener('DOMContentLoaded', function() {
  var inp = document.getElementById('ogc-url-input');
  if (inp) inp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); loadUnifiedOGC(); }
  });
});

// ═════════════════════════════════════════════════════════════════
// WMS — GetCapabilities → checkboxes de capas
// ═════════════════════════════════════════════════════════════════
async function _loadWMS(url) {
  showToast(LANG==='en'?'Connecting WMS…':'Conectando WMS…');

  var baseUrl = url.split('?')[0];
  var requestedLayers = '';
  try {
    var p = new URL(url);
    requestedLayers = p.searchParams.get('layers') || '';
    baseUrl = p.origin + p.pathname;
  } catch(e) {}

  if (requestedLayers) {
    _addDirectWMS(baseUrl, requestedLayers, requestedLayers);
    showToast(LANG==='en'?'WMS added ✓':'WMS añadido ✓');
    if (typeof saveState === 'function') saveState();
    return;
  }

  // GetCapabilities
  var capsUrl = baseUrl + '?service=WMS&request=GetCapabilities';
  var text;
  try {
    var resp = await fetch(capsUrl);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    text = await resp.text();
  } catch(e) {
    try {
      var resp2 = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(capsUrl));
      if (!resp2.ok) throw new Error('Proxy HTTP ' + resp2.status);
      text = await resp2.text();
    } catch(e2) {
      throw new Error('No se pudo conectar al WMS (posible CORS)');
    }
  }

  var xml = new DOMParser().parseFromString(text, 'text/xml');
  var layers = [];
  xml.querySelectorAll('Layer > Layer').forEach(function(el) {
    var name  = el.querySelector(':scope > Name');
    var title = el.querySelector(':scope > Title');
    if (name && name.textContent) {
      layers.push({ name: name.textContent, title: (title ? title.textContent : name.textContent) });
    }
  });

  if (!layers.length) {
    _addDirectWMS(baseUrl, '', _host(url));
    showToast(LANG==='en'?'WMS added (no layer list)':'WMS añadido (sin lista de capas)');
    return;
  }

  var svc = { id: ++_wmsIdCounter, baseUrl: baseUrl, hostname: _host(url), layers: layers, activeLayers: {} };
  _wmsServices.push(svc);
  _toggleWMSCap(svc.id, layers[0].name, true);
  _renderWMSPanel();
  showToast(layers.length + (LANG==='en'?' WMS layers available':' capas WMS disponibles'));
  if (typeof saveState === 'function') saveState();
}

function _addDirectWMS(baseUrl, layers, label) {
  var tl = L.tileLayer.wms(baseUrl, { layers: layers, format: 'image/png', transparent: true, attribution: _host(baseUrl) }).addTo(map);
  var svc = { id: ++_wmsIdCounter, baseUrl: baseUrl, hostname: label, layers: [{ name: layers, title: label }], activeLayers: {} };
  svc.activeLayers[layers] = tl;
  _wmsServices.push(svc);
  _renderWMSPanel();
}

function _toggleWMSCap(svcId, layerName, forceOn) {
  var svc = _wmsServices.find(function(s) { return s.id === svcId; });
  if (!svc) return;
  if (svc.activeLayers[layerName] && !forceOn) {
    map.removeLayer(svc.activeLayers[layerName]);
    delete svc.activeLayers[layerName];
  } else if (!svc.activeLayers[layerName]) {
    var tl = L.tileLayer.wms(svc.baseUrl, { layers: layerName, format: 'image/png', transparent: true, attribution: svc.hostname }).addTo(map);
    svc.activeLayers[layerName] = tl;
  }
  _renderWMSPanel();
}

function _removeWMSService(svcId) {
  var idx = _wmsServices.findIndex(function(s) { return s.id === svcId; });
  if (idx === -1) return;
  var svc = _wmsServices[idx];
  Object.keys(svc.activeLayers).forEach(function(k) { if (map.hasLayer(svc.activeLayers[k])) map.removeLayer(svc.activeLayers[k]); });
  _wmsServices.splice(idx, 1);
  _renderWMSPanel();
  showToast(LANG==='en'?'Service removed':'Servicio eliminado');
}

function _renderWMSPanel() {
  var el = document.getElementById('wms-layer-list');
  if (!el) return;
  if (!_wmsServices.length) { el.innerHTML = ''; return; }
  var html = '';
  _wmsServices.forEach(function(svc) {
    var n = Object.keys(svc.activeLayers).length;
    html += '<div class="wms-svc">';
    html += '<div class="wms-svc-header"><span class="wms-svc-name">' + svc.hostname + '</span>';
    html += '<span class="wms-svc-count">' + n + '/' + svc.layers.length + '</span>';
    html += '<button class="wms-svc-del" onclick="_removeWMSService(' + svc.id + ')" title="Eliminar">&times;</button></div>';
    svc.layers.slice(0, 12).forEach(function(l) {
      var on = !!svc.activeLayers[l.name];
      html += '<label class="wms-layer-check"><input type="checkbox" ' + (on ? 'checked' : '') +
        ' onchange="_toggleWMSCap(' + svc.id + ',\'' + l.name.replace(/'/g, "\\'") + '\')"><span class="wms-layer-name">' + l.title + '</span></label>';
    });
    if (svc.layers.length > 12) html += '<div class="wms-more">+ ' + (svc.layers.length - 12) + ' capas m\u00e1s</div>';
    html += '</div>';
  });
  el.innerHTML = html;
}

// ═════════════════════════════════════════════════════════════════
// WFS — múltiples intentos + proxy CORS
// ═════════════════════════════════════════════════════════════════
async function _loadWFS(url) {
  showToast(LANG==='en'?'Loading WFS…':'Cargando WFS…');

  if (url.toLowerCase().includes('request=getfeature')) return await _fetchWFS(url);

  var base = url.split('?')[0];
  var attempts = [
    base + '?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json&count=2000',
    base + '?service=WFS&version=1.1.0&request=GetFeature&outputFormat=application/json&maxFeatures=2000',
    base + '?service=WFS&version=2.0.0&request=GetFeature&outputFormat=geojson&count=2000',
  ];

  var lastErr;
  for (var i = 0; i < attempts.length; i++) {
    try { await _fetchWFS(attempts[i]); return; } catch(e) { lastErr = e; }
  }
  // Proxy CORS
  try { await _fetchWFS('https://api.allorigins.win/raw?url=' + encodeURIComponent(attempts[0])); return; } catch(e) {}

  throw new Error('WFS no accesible. ' + (lastErr ? lastErr.message : 'CORS o par\u00e1metros'));
}

async function _fetchWFS(fetchUrl) {
  var resp = await fetch(fetchUrl);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  var text = await resp.text();
  if (text.trim().charAt(0) === '<' && text.indexOf('Exception') > -1) {
    var m = text.match(/<(?:ows:)?ExceptionText>([\s\S]*?)<\/(?:ows:)?ExceptionText>/);
    throw new Error(m ? m[1].trim() : 'Error XML del servidor');
  }
  var geo;
  try { geo = JSON.parse(text); } catch(e) { throw new Error('Respuesta no es JSON'); }
  if (!geo.features || !geo.features.length) throw new Error('Sin features');
  loadGeoJSON(geo, 'WFS: ' + _host(fetchUrl));
  showToast(geo.features.length + ' features WFS ✓');
  if (typeof saveState === 'function') saveState();
}

// ═════════════════════════════════════════════════════════════════
// ArcGIS
// ═════════════════════════════════════════════════════════════════
async function _loadArcGIS(url) {
  showToast(LANG==='en'?'Loading ArcGIS…':'Cargando ArcGIS…');
  url = url.replace(/\/$/, '');
  var all = [], offset = 0, limit = 1000, more = true;
  while (more) {
    var sep = url.includes('?') ? '&' : '?';
    var r = await fetch(url + '/query' + sep + 'where=1%3D1&outFields=*&f=geojson&resultOffset=' + offset + '&resultRecordCount=' + limit);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var d = await r.json();
    if (d.features && d.features.length) { all.push.apply(all, d.features); offset += d.features.length; }
    more = d.exceededTransferLimit === true && d.features && d.features.length === limit;
    if (more) showToast('ArcGIS\u2026 ' + all.length);
  }
  if (!all.length) { manaAlert(LANG==='en'?'No data.':'Sin datos.', 'warning'); return; }
  loadGeoJSON({ type: 'FeatureCollection', features: all }, 'ArcGIS: ' + _host(url));
  showToast(all.length + (LANG==='en'?' elements ✓':' elementos ✓'));
  if (typeof saveState === 'function') saveState();
}

// ── CATÁLOGO ────────────────────────────────────────────────────
function toggleOGCCatalog() {
  var el = document.getElementById('ogc-catalog-list');
  var arrow = document.getElementById('ogc-cat-chevron');
  if (!el) return;
  _ogcCatalogOpen = !_ogcCatalogOpen;
  el.style.display = _ogcCatalogOpen ? 'block' : 'none';
  if (arrow) arrow.classList.toggle('open', _ogcCatalogOpen);
  if (_ogcCatalogOpen && !el.innerHTML) _renderCatalog();
}

function _renderCatalog() {
  var el = document.getElementById('ogc-catalog-list');
  if (!el) return;
  var h = '';
  OGC_CATALOG.forEach(function(item) {
    if (item.section) {
      h += '<div class="ogc-cat-hd">' + item.section + '</div>';
    } else {
      h += '<button class="tool-btn ogc-cat-btn" onclick="loadFromCatalog(\'' + item.url + '\')" title="' + item.url + '">';
      h += '<span class="ogc-cat-badge ogc-badge-' + item.type + '">' + item.type.toUpperCase() + '</span>';
      h += '<span class="btn-label">' + item.name + '</span>';
      h += '</button>';
    }
  });
  el.innerHTML = h;
}

function loadFromCatalog(url) {
  var inp = document.getElementById('ogc-url-input');
  if (inp) inp.value = url;
  if (_ogcCatalogOpen) toggleOGCCatalog();
  loadUnifiedOGC();
}

// ── BACKWARD COMPAT ─────────────────────────────────────────────
function loadOGCService() { loadUnifiedOGC(); }
function loadArcGISService() { loadUnifiedOGC(); }
var _wmsOverlays = [];
function toggleWMSLayer() {}
function removeWMSLayer() {}
function _renderWMSLayers() { _renderWMSPanel(); }
