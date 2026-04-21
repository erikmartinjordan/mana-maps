// ── undo-redo.js ─ Undo/Redo with GeoJSON snapshots ──

const UNDO_LIMIT = 50;
let undoStack = [];
let redoStack = [];

// ── Take a snapshot of current map state ──
function _takeSnapshot() {
  const snapshot = { features: [], groups: {} };
  drawnItems.eachLayer(l => {
    const f = l.toGeoJSON();
    f.properties._manaName = l._manaName || '';
    f.properties._manaColor = (l instanceof L.Marker) ? (l._manaColor || '#0ea5e9') : (l.options.color || '#0ea5e9');
    if (!(l instanceof L.Marker)) {
      f.properties._manaWeight = l.options.weight || 2;
      f.properties._manaOpacity = l.options.opacity || 1;
    }
    if (l._manaGroupId) {
      f.properties._manaGroupId = l._manaGroupId;
      f.properties._manaGroupName = l._manaGroupName || '';
    }
    if (l._manaProperties) f.properties._manaProperties = l._manaProperties;
    snapshot.features.push(f);
  });
  // Save group meta names so we can restore them
  for (const gid in _manaGroupMeta) {
    snapshot.groups[gid] = {
      name: _manaGroupMeta[gid].name,
      color: _manaGroupMeta[gid].color,
    };
  }
  return JSON.stringify(snapshot);
}

// ── Restore a snapshot to the map ──
function _restoreSnapshot(json) {
  const snapshot = JSON.parse(json);
  // Clear current map
  drawnItems.clearLayers();
  for (const gid in _manaGroupMeta) delete _manaGroupMeta[gid];

  // Rebuild layers from snapshot
  const groups = {};
  snapshot.features.forEach(f => {
    const props = f.properties || {};
    const color = props._manaColor || '#0ea5e9';
    const name = props._manaName || 'Elemento';
    const g = f.geometry;
    if (!g) return;

    let layer;
    if (g.type === 'Point') {
      const ll = [g.coordinates[1], g.coordinates[0]];
      const icon = makeMarkerIcon(color, markerType);
      layer = L.marker(ll, { icon }).addTo(drawnItems);
      layer._manaName = name;
      layer._manaColor = color;
      layer.bindPopup('<strong>' + name + '</strong>');
    } else if (g.type === 'LineString') {
      const lls = g.coordinates.map(c => [c[1], c[0]]);
      const weight = props._manaWeight || 2;
      const opacity = props._manaOpacity || 1;
      layer = L.polyline(lls, { color, weight, opacity, fillOpacity: opacity * 0.3 }).addTo(drawnItems);
      layer._manaName = name;
    } else if (g.type === 'Polygon') {
      const lls = g.coordinates[0].map(c => [c[1], c[0]]);
      const weight = props._manaWeight || 2;
      const opacity = props._manaOpacity || 1;
      layer = L.polygon(lls, { color, weight, opacity, fillOpacity: opacity * 0.3 }).addTo(drawnItems);
      layer._manaName = name;
    }

    // Restore _manaProperties for all layers (grouped and ungrouped)
    if (layer && props._manaProperties) {
      layer._manaProperties = props._manaProperties;
    }

    if (layer && props._manaGroupId) {
      layer._manaGroupId = props._manaGroupId;
      layer._manaGroupName = props._manaGroupName || '';
      // Register in group meta
      const gid = props._manaGroupId;
      if (!_manaGroupMeta[gid]) {
        const gInfo = snapshot.groups[gid] || {};
        registerGroupMeta(gid, gInfo.name || props._manaGroupName || 'Capa', gInfo.color || color);
      }
      addLayerToGroupMeta(gid, layer);
    }
  });
  stats();
  if (typeof saveState === 'function') saveState();
}

// ── Push current state to undo stack ──
function pushUndo() {
  const snap = _takeSnapshot();
  undoStack.push(snap);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack = [];
  _updateUndoRedoUI();
}

// ── Undo: restore previous state ──
function undo() {
  if (!undoStack.length) return;
  // Save current state to redo
  redoStack.push(_takeSnapshot());
  const prev = undoStack.pop();
  _restoreSnapshot(prev);
  _updateUndoRedoUI();
  showToast('Deshacer \u2713');
}

// ── Redo: restore next state ──
function redo() {
  if (!redoStack.length) return;
  // Save current state to undo
  undoStack.push(_takeSnapshot());
  const next = redoStack.pop();
  _restoreSnapshot(next);
  _updateUndoRedoUI();
  showToast('Rehacer \u2713');
}

// ── Update button states ──
function _updateUndoRedoUI() {
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  if (btnUndo) {
    btnUndo.disabled = !undoStack.length;
    btnUndo.classList.toggle('disabled', !undoStack.length);
    btnUndo.title = undoStack.length ? 'Deshacer (Ctrl+Z) — ' + undoStack.length + ' pasos' : 'Nada que deshacer';
  }
  if (btnRedo) {
    btnRedo.disabled = !redoStack.length;
    btnRedo.classList.toggle('disabled', !redoStack.length);
    btnRedo.title = redoStack.length ? 'Rehacer (Ctrl+Y) — ' + redoStack.length + ' pasos' : 'Nada que rehacer';
  }
}

// ── Keyboard shortcuts ──
document.addEventListener('keydown', e => {
  // Ctrl+Z or Cmd+Z → Undo
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    // Don't capture if focus is in an input/textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    e.preventDefault();
    undo();
  }
  // Ctrl+Y or Cmd+Shift+Z → Redo
  if (((e.ctrlKey || e.metaKey) && e.key === 'y') ||
      ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey)) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    e.preventDefault();
    redo();
  }
});

// ── Init UI on load ──
document.addEventListener('DOMContentLoaded', _updateUndoRedoUI);
