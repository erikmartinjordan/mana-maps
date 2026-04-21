// ── persistence.js ─ localStorage persistence, auto-save, share via URL hash ──

// ═══════════════════════════════════════════════════════════════
// SAVE STATE
// ═══════════════════════════════════════════════════════════════
function saveState() {
  try {
    const geo = getEnrichedGeoJSON();
    // Also store style info per feature
    const layers = [];
    drawnItems.eachLayer(l => layers.push(l));
    geo.features.forEach((f, i) => {
      const l = layers[i];
      if (!l) return;
      f.properties._manaName = l._manaName || f.properties.name || '';
      f.properties._manaColor = (l instanceof L.Marker) ? (l._manaColor || '#0ea5e9') : (l.options.color || '#0ea5e9');
      if (!(l instanceof L.Marker)) {
        f.properties._manaWeight = l.options.weight || 2;
        f.properties._manaOpacity = l.options.opacity || 1;
      }
      if (l._manaGroupId) f.properties._manaGroupId = l._manaGroupId;
      if (l._manaGroupName) f.properties._manaGroupName = l._manaGroupName;
    });
    localStorage.setItem('mana-maps-state', JSON.stringify(geo));
    _flashSavePill();
  } catch (e) {
    console.warn('saveState error:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// RESTORE STATE
// ═══════════════════════════════════════════════════════════════
function restoreState() {
  try {
    const raw = localStorage.getItem('mana-maps-state');
    if (!raw) return;
    const geo = JSON.parse(raw);
    if (!geo || !geo.features || !geo.features.length) return;
    _importRestoredGeoJSON(geo);
    // P1.5: Show discreet toast on restore
    setTimeout(() => {
      if (typeof showToast === 'function') showToast('Mapa restaurat de la sessi\u00F3 anterior');
    }, 500);
  } catch (e) {
    console.warn('restoreState error:', e);
  }
}


// Build clean user attributes from saved properties (filtering internal keys)
function _extractUserAttrs(props) {
  var attrs = {};
  for (var k in props) {
    if (k.charAt(0) === '_' || k === 'color' || k === 'bbox' || k === 'name' || k === 'Name' || k === 'NAME') continue;
    if (props[k] !== null && props[k] !== undefined) attrs[k] = props[k];
  }
  return Object.keys(attrs).length ? attrs : null;
}

function _importRestoredGeoJSON(geo) {
  if (!geo || !geo.features) return;

  // Group features by _manaGroupName for grouped import
  const groups = {};
  const ungrouped = [];

  geo.features.forEach(f => {
    const props = f.properties || {};
    if (props._manaGroupName) {
      const gn = props._manaGroupName;
      if (!groups[gn]) groups[gn] = [];
      groups[gn].push(f);
    } else {
      ungrouped.push(f);
    }
  });

  // Import grouped features via loadGeoJSON
  for (const gn in groups) {
    const fc = { type: 'FeatureCollection', features: groups[gn] };
    // Set drawColor from first feature
    const firstColor = groups[gn][0].properties._manaColor || '#0ea5e9';
    const savedColor = drawColor;
    drawColor = firstColor;
    loadGeoJSON(fc, gn);
    drawColor = savedColor;
  }

  // Import ungrouped features individually
  ungrouped.forEach(f => {
    const props = f.properties || {};
    const color = props._manaColor || props.color || '#0ea5e9';
    const name = props._manaName || props.name || 'Elemento';
    const g = f.geometry;
    if (!g) return;

    if (g.type === 'Point') {
      const ll = [g.coordinates[1], g.coordinates[0]];
      const icon = makeMarkerIcon(color, markerType);
      const m = L.marker(ll, { icon }).addTo(drawnItems);
      m._manaName = name;
      m._manaColor = color;
      const ptAttrs = _extractUserAttrs(props);
      if (ptAttrs) m._manaProperties = ptAttrs;
      m.bindPopup('<strong>' + name + '</strong>');
    } else if (g.type === 'LineString') {
      const lls = g.coordinates.map(c => [c[1], c[0]]);
      const weight = props._manaWeight || 2;
      const opacity = props._manaOpacity || 1;
      const line = L.polyline(lls, { color: color, weight: weight, opacity: opacity, fillOpacity: opacity * 0.3 }).addTo(drawnItems);
      line._manaName = name;
      const lnAttrs = _extractUserAttrs(props);
      if (lnAttrs) line._manaProperties = lnAttrs;
    } else if (g.type === 'Polygon') {
      const lls = g.coordinates[0].map(c => [c[1], c[0]]);
      const weight = props._manaWeight || 2;
      const opacity = props._manaOpacity || 1;
      const poly = L.polygon(lls, { color: color, weight: weight, opacity: opacity, fillOpacity: opacity * 0.3 }).addTo(drawnItems);
      poly._manaName = name;
      const pgAttrs = _extractUserAttrs(props);
      if (pgAttrs) poly._manaProperties = pgAttrs;
    }
  });

  stats();
}


// ═══════════════════════════════════════════════════════════════
// AUTO-SAVE PILL FLASH
// ═══════════════════════════════════════════════════════════════
let _savePillTimer = null;

function _flashSavePill() {
  const pill = document.getElementById('autosave-pill');
  if (!pill) return;
  pill.textContent = 'Guardado \u2713';
  pill.classList.add('flash');
  if (_savePillTimer) clearTimeout(_savePillTimer);
  _savePillTimer = setTimeout(() => {
    pill.classList.remove('flash');
    pill.textContent = 'Auto-guardado';
  }, 1500);
}


// ═══════════════════════════════════════════════════════════════
// SHARE MAP VIA URL HASH
// ═══════════════════════════════════════════════════════════════
function shareMapURL() {
  try {
    const geo = getEnrichedGeoJSON();
    if (!geo.features.length) {
      manaAlert('No hay elementos para compartir.', 'warning');
      return;
    }
    const encoded = encodeURIComponent(JSON.stringify(geo));
    window.location.hash = '#map=' + encoded;
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      showToast('Enlace copiado \u2713');
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Enlace copiado \u2713');
    });
  } catch (e) {
    manaAlert('Error al generar el enlace: ' + e.message, 'error');
  }
}

function restoreFromHash() {
  try {
    const hash = window.location.hash;
    if (!hash.startsWith('#map=')) return false;
    const encoded = hash.substring(5);
    const geo = JSON.parse(decodeURIComponent(encoded));
    if (geo && geo.features && geo.features.length) {
      _importRestoredGeoJSON(geo);
      // Clear hash so it doesn't persist on refresh (state is in localStorage now)
      return true;
    }
  } catch (e) {
    console.warn('restoreFromHash error:', e);
  }
  return false;
}




// ═══════════════════════════════════════════════════════════════
// P1.5: CLEAR SAVED DATA
// ═══════════════════════════════════════════════════════════════
function clearSavedData() {
  localStorage.removeItem('mana-maps-state');
  showToast('Dades guardades eliminades \u2713');
}

// ═══════════════════════════════════════════════════════════════
// P3.11: PROJECT NAME FOR EXPORTS
// ═══════════════════════════════════════════════════════════════
function getProjectName() {
  return localStorage.getItem('mana-project-name') || 'mana-maps';
}

function setProjectName(name) {
  const clean = name.trim().replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '-') || 'mana-maps';
  localStorage.setItem('mana-project-name', clean);
  const input = document.getElementById('project-name-input');
  if (input) input.value = clean;
  showToast('Nom del projecte: ' + clean);
}

// ═══════════════════════════════════════════════════════════════
// INIT: restore from URL hash first, then localStorage
// ═══════════════════════════════════════════════════════════════
(function initPersistence() {
  const restoredFromHash = restoreFromHash();
  if (!restoredFromHash) {
    restoreState();
  }
})();
