// ── ogc-loader.js ─ WMS/WFS & ArcGIS Feature Service loader ──

// ═══════════════════════════════════════════════════════════════
// WMS OVERLAY TRACKING
// ═══════════════════════════════════════════════════════════════
const _wmsOverlays = [];  // { id, label, layer, visible }
let _wmsIdCounter = 0;

function _hostnameFromURL(url) {
  try { return new URL(url).hostname; } catch(e) { return url.substring(0, 40); }
}

// ═══════════════════════════════════════════════════════════════
// WMS / WFS LOADER
// ═══════════════════════════════════════════════════════════════
async function loadOGCService() {
  const input = document.getElementById('ogc-url-input');
  if (!input) return;
  const url = input.value.trim();
  if (!url) { manaAlert('Introduce una URL de servicio WMS o WFS.', 'warning'); return; }

  const isWFS = /wfs/i.test(url);

  if (isWFS) {
    await _loadWFS(url);
  } else {
    _loadWMS(url);
  }
  input.value = '';
}

async function _loadWFS(url) {
  showToast('Cargando WFS\u2026');
  try {
    // Build WFS GetFeature request
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

function _loadWMS(url) {
  try {
    // Extract layers param if present
    let layers = '';
    try {
      const parsed = new URL(url);
      if (parsed.searchParams.has('layers')) {
        layers = parsed.searchParams.get('layers');
        // Clean URL: remove layers param for the base
        parsed.searchParams.delete('layers');
      }
      // Also remove any request/service params to get clean base URL
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
  } catch (e) {
    manaAlert('Error WMS: ' + e.message, 'error');
  }
}

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


// ═══════════════════════════════════════════════════════════════
// ARCGIS FEATURE SERVICE LOADER
// ═══════════════════════════════════════════════════════════════
async function loadArcGISService() {
  const input = document.getElementById('arcgis-url-input');
  if (!input) return;
  let url = input.value.trim();
  if (!url) { manaAlert('Introduce una URL de ArcGIS Feature Service.', 'warning'); return; }

  // Ensure URL ends cleanly
  url = url.replace(/\/$/, '');

  showToast('Cargando ArcGIS\u2026');
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

      // Check if there are more records
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
    input.value = '';
  } catch (e) {
    manaAlert('Error ArcGIS: ' + e.message, 'error');
  }
}
