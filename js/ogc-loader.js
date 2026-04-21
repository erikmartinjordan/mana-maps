// ═══════════════════════════════════════════════════════
// js/ogc-loader.js — Servicios OGC unificados
// Auto-detección WMS/WFS/ArcGIS · Catálogo · Recientes
// ═══════════════════════════════════════════════════════

// --- Estado global OGC ---
const _wmsOverlays = [];  // { id, label, layer, visible }
let _wmsIdCounter = 0;
let _ogcCatalogOpen = false;
let _ogcRecentOpen = false;

function _hostnameFromURL(url) {
  try { return new URL(url).hostname; } catch(e) { return url.substring(0, 40); }
}

// ═══════════════════════════════════════════════════════
// CATÁLOGO DE SERVICIOS PRECONFIGURADOS
// ═══════════════════════════════════════════════════════
const OGC_CATALOG = [
  {
    category: 'ICGC (Catalunya)',
    services: [
      { name: 'Mapa topogràfic',   type: 'wms', url: 'https://geoserveis.icgc.cat/servei/catalunya/mapa-base/wms' },
      { name: 'Ortofotos',          type: 'wms', url: 'https://geoserveis.icgc.cat/servei/catalunya/ortofoto/wms' },
      { name: 'Municipis',          type: 'wfs', url: 'https://geoserveis.icgc.cat/servei/catalunya/divisions-administratives/wfs' },
    ]
  },
  {
    category: 'IGN (España)',
    services: [
      { name: 'Mapa base raster',  type: 'wms', url: 'https://www.ign.es/wms-inspire/mapa-raster' },
      { name: 'Ortoimágenes PNOA',  type: 'wms', url: 'https://www.ign.es/wms-inspire/pnoa-ma' },
      { name: 'Hidrografía',        type: 'wms', url: 'https://servicios.idee.es/wms-inspire/hidrografia' },
    ]
  },
  {
    category: 'INSPIRE (EU)',
    services: [
      { name: 'Catastro parcelas',  type: 'wms', url: 'https://ovc.catastro.meh.es/cartografia/INSPIRE/spadgcwms.aspx' },
    ]
  }
];

// ═══════════════════════════════════════════════════════
// DETECCIÓN AUTOMÁTICA DE TIPO
// ═══════════════════════════════════════════════════════
function detectServiceType(url) {
  if (!url) return 'unknown';
  const u = url.toLowerCase();
  if (u.includes('/rest/services/') || u.includes('/mapserver') || u.includes('/featureserver')) return 'arcgis';
  if (u.includes('/wfs') || u.includes('service=wfs')) return 'wfs';
  if (u.includes('/wms') || u.includes('service=wms')) return 'wms';
  return 'unknown';
}

// Actualizar badge de tipo en tiempo real
function _updateTypePill() {
  const input = document.getElementById('ogc-unified-input');
  const pill  = document.getElementById('ogc-type-pill');
  if (!input || !pill) return;

  const url = input.value.trim();
  if (!url) { pill.style.display = 'none'; return; }

  const type = detectServiceType(url);
  const labels = { wms: 'WMS', wfs: 'WFS', arcgis: 'ArcGIS', unknown: '?' };
  pill.textContent = labels[type];
  pill.setAttribute('data-type', type);
  pill.style.display = 'inline-block';
}

// Vincular eventos al cargar
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('ogc-unified-input');
  if (inp) {
    inp.addEventListener('input', _updateTypePill);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') loadUnifiedOGC(); });
  }
});

// ═══════════════════════════════════════════════════════
// CARGA UNIFICADA
// ═══════════════════════════════════════════════════════
async function loadUnifiedOGC() {
  const input = document.getElementById('ogc-unified-input');
  const btn   = document.getElementById('ogc-add-btn');
  const url   = input?.value.trim();

  if (!url) {
    manaAlert('Introduce una URL de servicio WMS, WFS o ArcGIS.', 'warning');
    input?.focus();
    return;
  }

  const type = detectServiceType(url);

  // Activar spinner
  btn?.classList.add('ogc-loading');

  try {
    switch (type) {
      case 'wms':    _loadWMS(url);                 break;
      case 'wfs':    await _loadWFS(url);           break;
      case 'arcgis': await _loadArcGIS(url);        break;
      default:
        showToast('Tipo no detectado \u2014 intentando WMS\u2026');
        _loadWMS(url);
    }

    _addOGCRecent(url, type);
    input.value = '';
    document.getElementById('ogc-type-pill').style.display = 'none';
  } catch (err) {
    console.error('Error cargando servicio OGC:', err);
    manaAlert('Error: ' + (err.message || 'servicio no disponible'), 'error');
  } finally {
    btn?.classList.remove('ogc-loading');
  }
}

// ═══════════════════════════════════════════════════════
// RECIENTES (localStorage)
// ═══════════════════════════════════════════════════════
const OGC_RECENT_KEY = 'mana-ogc-recent';
const OGC_RECENT_MAX = 5;

function _getOGCRecent() {
  try { return JSON.parse(localStorage.getItem(OGC_RECENT_KEY)) || []; }
  catch { return []; }
}
function _saveOGCRecent(list) {
  localStorage.setItem(OGC_RECENT_KEY, JSON.stringify(list));
}
function _addOGCRecent(url, type) {
  let recent = _getOGCRecent().filter(r => r.url !== url);
  recent.unshift({ url, type, ts: Date.now() });
  if (recent.length > OGC_RECENT_MAX) recent = recent.slice(0, OGC_RECENT_MAX);
  _saveOGCRecent(recent);
  if (_ogcRecentOpen) _renderOGCRecent();
}
function _removeOGCRecent(url) {
  _saveOGCRecent(_getOGCRecent().filter(r => r.url !== url));
  _renderOGCRecent();
}

// ═══════════════════════════════════════════════════════
// RENDER CATÁLOGO
// ═══════════════════════════════════════════════════════
function _renderOGCCatalog() {
  const el = document.getElementById('ogc-catalog-dropdown');
  if (!el) return;

  let html = '';
  OGC_CATALOG.forEach(cat => {
    html += '<div class="ogc-catalog-section">' + cat.category + '</div>';
    cat.services.forEach(s => {
      html += '<div class="ogc-catalog-item" onclick="_loadFromCatalog(\'' + s.url + '\',\'' + s.type + '\')" title="' + s.url + '">' +
        '<span class="ogc-catalog-item-name">' + s.name + '</span>' +
        '<span class="ogc-catalog-item-badge ' + s.type + '">' + s.type.toUpperCase() + '</span>' +
        '</div>';
    });
  });
  el.innerHTML = html;
}

function _loadFromCatalog(url, type) {
  const input = document.getElementById('ogc-unified-input');
  if (input) { input.value = url; _updateTypePill(); }
  toggleOGCCatalog();
  loadUnifiedOGC();
}

function toggleOGCCatalog() {
  const el    = document.getElementById('ogc-catalog-dropdown');
  const chips = document.querySelectorAll('.ogc-action-chip');
  if (!el) return;

  _ogcCatalogOpen = !_ogcCatalogOpen;
  if (_ogcCatalogOpen) {
    if (_ogcRecentOpen) toggleOGCRecent();
    _renderOGCCatalog();
    el.style.display = 'block';
    chips[0]?.classList.add('active');
  } else {
    el.style.display = 'none';
    chips[0]?.classList.remove('active');
  }
}

// ═══════════════════════════════════════════════════════
// RENDER RECIENTES
// ═══════════════════════════════════════════════════════
function _renderOGCRecent() {
  const el = document.getElementById('ogc-recent-dropdown');
  if (!el) return;

  const recent = _getOGCRecent();
  if (recent.length === 0) {
    el.innerHTML = '<div class="ogc-recent-empty">No hay servicios recientes</div>';
    return;
  }

  let html = '';
  recent.forEach(r => {
    const badge = (r.type || 'unknown').toUpperCase();
    html += '<div class="ogc-recent-item" onclick="_loadFromCatalog(\'' + r.url + '\',\'' + r.type + '\')">' +
      '<span class="ogc-catalog-item-badge ' + (r.type || '') + '">' + badge + '</span>' +
      '<span class="ogc-recent-item-url" title="' + r.url + '">' + r.url + '</span>' +
      '<button class="ogc-recent-item-del" onclick="event.stopPropagation();_removeOGCRecent(\'' + r.url + '\')" title="Eliminar">&times;</button>' +
      '</div>';
  });
  el.innerHTML = html;
}

function toggleOGCRecent() {
  const el    = document.getElementById('ogc-recent-dropdown');
  const chips = document.querySelectorAll('.ogc-action-chip');
  if (!el) return;

  _ogcRecentOpen = !_ogcRecentOpen;
  if (_ogcRecentOpen) {
    if (_ogcCatalogOpen) toggleOGCCatalog();
    _renderOGCRecent();
    el.style.display = 'block';
    chips[1]?.classList.add('active');
  } else {
    el.style.display = 'none';
    chips[1]?.classList.remove('active');
  }
}

// ═══════════════════════════════════════════════════════
// WMS LOADER
// ═══════════════════════════════════════════════════════
function _loadWMS(url) {
  try {
    // Extract layers param if present
    let layers = '';
    try {
      const parsed = new URL(url);
      if (parsed.searchParams.has('layers')) {
        layers = parsed.searchParams.get('layers');
        parsed.searchParams.delete('layers');
      }
      parsed.searchParams.delete('request');
      parsed.searchParams.delete('service');
      parsed.searchParams.delete('version');
    } catch(e) {}

    const wmsLayer = L.tileLayer.wms(url.split('?')[0], {
      layers: layers,
      format: 'image/png',
      transparent: true,
      attribution: _hostnameFromURL(url),
    }).addTo(map);

    const id = ++_wmsIdCounter;
    const label = _hostnameFromURL(url) + (layers ? ' (' + layers + ')' : '');
    _wmsOverlays.push({ id: id, label: label, layer: wmsLayer, visible: true });
    _renderWMSLayers();
    showToast('WMS a\u00F1adido \u2713');
    if (typeof saveState === 'function') saveState();
  } catch (e) {
    manaAlert('Error WMS: ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════
// WFS LOADER
// ═══════════════════════════════════════════════════════
async function _loadWFS(url) {
  showToast('Cargando WFS\u2026');
  try {
    let fetchUrl = url;
    if (!url.includes('request=')) {
      const sep = url.includes('?') ? '&' : '?';
      fetchUrl = url + sep + 'service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json&count=1000';
    }
    const resp = await fetch(fetchUrl);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const geo = await resp.json();
    const label = _hostnameFromURL(url);
    loadGeoJSON(geo, 'WFS: ' + label);
    showToast('WFS cargado \u2713');
    if (typeof saveState === 'function') saveState();
  } catch (e) {
    manaAlert('Error WFS: ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════
// ARCGIS FEATURE SERVICE LOADER
// ═══════════════════════════════════════════════════════
async function _loadArcGIS(url) {
  showToast('Cargando ArcGIS\u2026');
  url = url.replace(/\/$/, '');

  const allFeatures = [];
  let offset = 0;
  const limit = 1000;
  let hasMore = true;

  try {
    while (hasMore) {
      const sep = url.includes('?') ? '&' : '?';
      const fetchUrl = url + '/query' + sep +
        'where=1%3D1&outFields=*&f=geojson' +
        '&resultOffset=' + offset +
        '&resultRecordCount=' + limit;

      const resp = await fetch(fetchUrl);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();

      if (data.features && data.features.length) {
        allFeatures.push(...data.features);
        offset += data.features.length;
      }

      if (data.exceededTransferLimit === true && data.features && data.features.length === limit) {
        hasMore = true;
        showToast('Cargando ArcGIS\u2026 (' + allFeatures.length + ' elementos)');
      } else {
        hasMore = false;
      }
    }

    if (!allFeatures.length) {
      manaAlert('El servicio ArcGIS no devolvi\u00F3 datos.', 'warning');
      return;
    }

    const fc = { type: 'FeatureCollection', features: allFeatures };
    const label = _hostnameFromURL(url);
    loadGeoJSON(fc, 'ArcGIS: ' + label);
    showToast(allFeatures.length + ' elementos cargados \u2713');
    if (typeof saveState === 'function') saveState();
  } catch (e) {
    manaAlert('Error ArcGIS: ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════
// WMS OVERLAY MANAGEMENT
// ═══════════════════════════════════════════════════════
function toggleWMSLayer(id) {
  const item = _wmsOverlays.find(w => w.id === id);
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
  const idx = _wmsOverlays.findIndex(w => w.id === id);
  if (idx === -1) return;
  const item = _wmsOverlays[idx];
  if (map.hasLayer(item.layer)) map.removeLayer(item.layer);
  _wmsOverlays.splice(idx, 1);
  _renderWMSLayers();
  showToast('Capa WMS eliminada');
}

function _renderWMSLayers() {
  const container = document.getElementById('wms-layer-list');
  if (!container) return;
  if (!_wmsOverlays.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = _wmsOverlays.map(w => {
    const eyeIcon = w.visible
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22"/></svg>';
    return '<div class="wms-layer-item">' +
      '<button class="wms-eye-btn' + (w.visible ? '' : ' off') + '" onclick="toggleWMSLayer(' + w.id + ')" title="Mostrar/ocultar">' + eyeIcon + '</button>' +
      '<span class="wms-layer-label">' + w.label + '</span>' +
      '<button class="wms-remove-btn" onclick="removeWMSLayer(' + w.id + ')" title="Eliminar">&times;</button>' +
      '</div>';
  }).join('');
}


// ═══════════════════════════════════════════════════════
// BACKWARD COMPAT — old functions used by persistence.js
// ═══════════════════════════════════════════════════════
function loadOGCService() { loadUnifiedOGC(); }
function loadArcGISService() {
  const input = document.getElementById('arcgis-url-input');
  if (input && input.value.trim()) {
    _loadArcGIS(input.value.trim());
    input.value = '';
  } else {
    loadUnifiedOGC();
  }
}
