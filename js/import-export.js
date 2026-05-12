// ── import-export.js ─ File import, export & drag-and-drop ──

// ── LAYER GROUP COUNTER ──

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
      if (!kmlFile) throw new Error(t('import_no_kml'));
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
        else throw new Error(t('import_shapefile_error'));
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
      manaAlert(t('import_format_error'), 'warning');
    }
  } catch (err) { manaAlert(t('import_error') + err.message, 'error'); }
}

// ── Build attribute popup HTML ──
function buildAttrPopup(properties, geomType) {
  if (!properties || Object.keys(properties).length === 0) {
    return '<div class="attr-popup"><p class="attr-empty">' + t('attr_no_attrs') + '</p></div>';
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

function cloneFeatureProperties(properties) {
  if (!properties || typeof properties !== 'object') return {};
  return { ...properties };
}

function loadGeoJSON(geo, groupName) {
  if (!geo) return;
  if (geo.type === 'Feature') geo = { type: 'FeatureCollection', features: [geo] };
  if (!geo.features) { manaAlert(t('geojson_invalid'), 'error'); return; }
  const featureCount = geo.features.length;
  const useChunkedImport = featureCount > 1200;
  const batchSize = 250;
  const importColor = drawColor;

  // Assign a unique group ID for this imported layer
  const groupId = ++_manaGroupCounter;
  const gName = groupName || geo.fileName || t('geom_imported_layer');
  // Register group in metadata registry
  registerGroupMeta(groupId, gName, importColor);
  if (geo.features && geo.features.length && geo.features[0].properties && geo.features[0].properties._manaGroupTags && _manaGroupMeta[groupId]) {
    _manaGroupMeta[groupId].tags = _normalizeManaTags(geo.features[0].properties._manaGroupTags);
    _manaGroupMeta[groupId].tagStyle = _normalizeManaTagStyle(geo.features[0].properties._manaGroupTagStyle);
  }

  const layer = L.geoJSON(null, {
    style: { color: importColor, weight: 2, fillOpacity: .18 },
    pointToLayer: (f, ll) => {
      const n = (f.properties && (f.properties.name || f.properties.Name || f.properties.NAME)) || t('geom_imported');
      const importedColor = (f.properties && (f.properties._manaColor || f.properties.color)) ? String(f.properties._manaColor || f.properties.color) : importColor;
      const importedMarkerType = (f.properties && (f.properties._manaMarkerType || f.properties.markerType)) ? String(f.properties._manaMarkerType || f.properties.markerType) : markerType;
      const icon = makeMarkerIcon(importedColor, importedMarkerType);
      const m = L.marker(ll, { icon });
      m._manaName = n; m._manaColor = importedColor;
      m._manaMarkerType = importedMarkerType;
      m._manaTags = _normalizeManaTags(f.properties && f.properties._manaTags);
      m._manaTagStyle = _normalizeManaTagStyle(f.properties && f.properties._manaTagStyle);
      m._manaGroupId = groupId;
      m._manaGroupName = gName;
      m._manaProperties = cloneFeatureProperties(f.properties);
      m.bindPopup(() => buildAttrPopup(f.properties, 'Point'), { maxWidth: 360, className: 'attr-popup-wrapper' });
      return m;
    },
    onEachFeature: (f, l) => {
      l._manaGroupId = groupId;
      l._manaGroupName = gName;
      l._manaProperties = cloneFeatureProperties(f.properties);
      l._manaTags = _normalizeManaTags(f.properties && f.properties._manaTags);
      l._manaTagStyle = _normalizeManaTagStyle(f.properties && f.properties._manaTagStyle);
      if (!(l instanceof L.Marker)) {
        const n = (f.properties && (f.properties.name || f.properties.Name || f.properties.NAME)) || '';
        if (n) l._manaName = n;
        l.bindPopup(() => buildAttrPopup(f.properties, f.geometry && f.geometry.type), { maxWidth: 360, className: 'attr-popup-wrapper' });
      }
    }
  });

  const finalizeImport = () => {
    // Add to map and register each layer in group meta
    layer.eachLayer(l => {
      drawnItems.addLayer(l);
      addLayerToGroupMeta(groupId, l);
    });

    const bounds = layer.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
    stats();
    if (typeof saveState === 'function') saveState();
    return layer;
  };

  if (!useChunkedImport) {
    layer.addData(geo);
    return Promise.resolve(finalizeImport());
  }

  manaAlert(t('importing_large_file'), 'info');
  return new Promise(resolve => {
    let idx = 0;
    const addChunk = () => {
      const end = Math.min(idx + batchSize, featureCount);
      for (; idx < end; idx++) layer.addData(geo.features[idx]);
      if (idx < featureCount) {
        requestAnimationFrame(addChunk);
      } else {
        resolve(finalizeImport());
      }
    };
    addChunk();
  });
}

// ── KML PARSER ──
function kmlToGeoJSON(xmlDoc) {
  const features = [];
  function readExtendedData(pm, props) {
    pm.querySelectorAll('ExtendedData Data').forEach(d => {
      const key = d.getAttribute('name');
      if (!key) return;
      const val = d.querySelector('value')?.textContent ?? '';
      props[key] = val;
    });
    pm.querySelectorAll('ExtendedData SchemaData SimpleData').forEach(d => {
      const key = d.getAttribute('name');
      if (!key) return;
      props[key] = d.textContent ?? '';
    });
  }
  xmlDoc.querySelectorAll('Placemark').forEach(pm => {
    const name = pm.querySelector('name')?.textContent || '';
    const props = { name };
    readExtendedData(pm, props);

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
  alpha = alpha || "ff";
  var r = hex.slice(1, 3), g = hex.slice(3, 5), b = hex.slice(5, 7);
  return alpha + b + g + r;
}

function exportAs(fmt) {
  document.querySelectorAll(".drop-menu").forEach(function(x) { x.classList.remove("open"); });
  var geo = getEnrichedGeoJSON();
  if (!geo.features.length) { manaAlert(t('export_no_elements'), "warning"); return; }
  var prefix = (typeof getProjectName === "function") ? getProjectName() : "mana-maps";
  if (fmt === "geojson") {
    // Strip internal _-prefixed keys from properties for clean GeoJSON export
    var cleanGeo = JSON.parse(JSON.stringify(geo));
    cleanGeo.features.forEach(function(f) {
      var p = f.properties || {};
      Object.keys(p).forEach(function(k) { if (k.charAt(0) === "_") delete p[k]; });
    });
    return dl(JSON.stringify(cleanGeo, null, 2), prefix + ".geojson", "application/json");
  }
  if (fmt === "csv") return exportCSV(geo, prefix);
  if (fmt === "kml") return exportKMZ(geo, prefix);
  if (fmt === "shapefile") return exportShapefile(geo, prefix);
}

function dl(content, filename, mime, isBlob) {
  var blob = isBlob ? content : new Blob([content], { type: mime });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 5000);
}

// ===================== CSV =====================
function exportCSV(geo, prefix) {
  prefix = prefix || "mana-maps";
  var allKeys = {};
  geo.features.forEach(function(f) {
    var p = f.properties || {};
    Object.keys(p).forEach(function(k) { if (k !== "color" && k.charAt(0) !== "_") allKeys[k] = true; });
  });
  var keys = Object.keys(allKeys);
  var header = ["id", "type", "latitude", "longitude"].concat(keys);
  var rows = [header.map(function(h) { return '"' + h + '"'; }).join(",")];
  geo.features.forEach(function(f, i) {
    var g = f.geometry, p = f.properties || {};
    var lat = "", lng = "";
    if (g.type === "Point") { lng = g.coordinates[0]; lat = g.coordinates[1]; }
    var row = [i + 1, g.type, lat, lng];
    keys.forEach(function(k) {
      var v = p[k]; if (v === null || v === undefined) v = "";
      row.push(v);
    });
    rows.push(row.map(function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(","));
  });
  dl(rows.join("\n"), prefix + ".csv", "text/csv");
}

// ===================== KML / KMZ =====================
function _coordsToKml(coords) {
  return coords.map(function(p) { return p[0] + "," + p[1] + ",0"; }).join(" ");
}

function _geomToKml(g) {
  if (!g) return "";
  switch (g.type) {
    case "Point":
      return "<Point><coordinates>" + g.coordinates[0] + "," + g.coordinates[1] + ",0</coordinates></Point>";
    case "MultiPoint":
      return "<MultiGeometry>" + g.coordinates.map(function(c) {
        return "<Point><coordinates>" + c[0] + "," + c[1] + ",0</coordinates></Point>";
      }).join("") + "</MultiGeometry>";
    case "LineString":
      return "<LineString><coordinates>" + _coordsToKml(g.coordinates) + "</coordinates></LineString>";
    case "MultiLineString":
      return "<MultiGeometry>" + g.coordinates.map(function(line) {
        return "<LineString><coordinates>" + _coordsToKml(line) + "</coordinates></LineString>";
      }).join("") + "</MultiGeometry>";
    case "Polygon":
      var outer = "<outerBoundaryIs><LinearRing><coordinates>" + _coordsToKml(g.coordinates[0]) + "</coordinates></LinearRing></outerBoundaryIs>";
      var inner = g.coordinates.slice(1).map(function(ring) {
        return "<innerBoundaryIs><LinearRing><coordinates>" + _coordsToKml(ring) + "</coordinates></LinearRing></innerBoundaryIs>";
      }).join("");
      return "<Polygon>" + outer + inner + "</Polygon>";
    case "MultiPolygon":
      return "<MultiGeometry>" + g.coordinates.map(function(poly) {
        var o = "<outerBoundaryIs><LinearRing><coordinates>" + _coordsToKml(poly[0]) + "</coordinates></LinearRing></outerBoundaryIs>";
        var inn = poly.slice(1).map(function(ring) {
          return "<innerBoundaryIs><LinearRing><coordinates>" + _coordsToKml(ring) + "</coordinates></LinearRing></innerBoundaryIs>";
        }).join("");
        return "<Polygon>" + o + inn + "</Polygon>";
      }).join("") + "</MultiGeometry>";
    default: return "";
  }
}

function geoToKML(geo) {
  var iconAssets = {};

  function _mkSvgForKmz(type, color) {
    var safeColor = /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : "#0ea5e9";
    var def = (typeof _mkFind === "function") ? _mkFind(type) : null;
    var safeType = def ? type : "pin";
    var shapeType = safeType;
    var isShape = !!(def && def.shape);

    if (isShape) {
      switch (shapeType) {
        case "pin":
          return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32"><path d="M12 0C7.13 0 3 4.13 3 9c0 7.25 9 23 9 23s9-15.75 9-23c0-4.87-4.13-9-9-9z" fill="' + safeColor + '" stroke="white" stroke-width="1.5"/><circle cx="12" cy="9" r="3.5" fill="white"/></svg>';
        case "circle":
          return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="' + safeColor + '" stroke="white" stroke-width="2"/></svg>';
        case "square":
          return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" fill="' + safeColor + '" stroke="white" stroke-width="2"/></svg>';
        case "diamond":
          return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" transform="rotate(45 12 12)" fill="' + safeColor + '" stroke="white" stroke-width="2"/></svg>';
        case "triangle":
          return '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"><polygon points="12,3 22,21 2,21" fill="' + safeColor + '" stroke="white" stroke-width="1.5"/></svg>';
        case "star":
          return '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"><polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9" fill="' + safeColor + '" stroke="white" stroke-width="1.2"/></svg>';
        case "hexagon":
          return '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"><polygon points="12,2 21,7 21,17 12,22 3,17 3,7" fill="' + safeColor + '" stroke="white" stroke-width="1.5"/></svg>';
        case "cross":
          return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" fill="' + safeColor + '" stroke="white" stroke-width="1.2"/></svg>';
        case "drop":
          return '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="28" viewBox="0 0 22 28"><path d="M11 0C11 0 0 12 0 18a11 11 0 0022 0C22 12 11 0 11 0z" fill="' + safeColor + '" stroke="white" stroke-width="1.5"/></svg>';
        case "flag":
          return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="28" viewBox="0 0 24 28"><line x1="4" y1="2" x2="4" y2="27" stroke="white" stroke-width="3" stroke-linecap="round"/><line x1="4" y1="2" x2="4" y2="27" stroke="' + safeColor + '" stroke-width="1.5" stroke-linecap="round"/><path d="M4 3L20 7L4 14Z" fill="' + safeColor + '" stroke="white" stroke-width="1.2"/></svg>';
        case "bolt":
          return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="26" viewBox="0 0 24 26"><polygon points="13,1 4,15 11,15 9,25 20,10 13,10" fill="' + safeColor + '" stroke="white" stroke-width="1.3"/></svg>';
        case "heart":
          return '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"><path d="M12 21C12 21 3 14 3 8.5A4.5 4.5 0 017.5 4c1.74 0 3.41 1 4.5 2.09C13.09 5 14.76 4 16.5 4A4.5 4.5 0 0121 8.5C21 14 12 21 12 21z" fill="' + safeColor + '" stroke="white" stroke-width="1.3"/></svg>';
        default:
          return _mkSvgForKmz("pin", safeColor);
      }
    }

    var path = (def && def.p) ? def.p : "";
    if (!path) return _mkSvgForKmz("pin", safeColor);
    return '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><circle cx="14" cy="14" r="13" fill="' + safeColor + '" stroke="white" stroke-width="2"/><g transform="translate(4.5,4.5) scale(0.79)" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + path + '"/></g></svg>';
  }

  function _extractSvgSize(svg) {
    var widthMatch = /width="([0-9.]+)"/i.exec(svg || "");
    var heightMatch = /height="([0-9.]+)"/i.exec(svg || "");
    var width = widthMatch ? Math.max(16, Math.round(parseFloat(widthMatch[1]) || 28)) : 28;
    var height = heightMatch ? Math.max(16, Math.round(parseFloat(heightMatch[1]) || 28)) : 28;
    return { width: width, height: height };
  }

  function markerTypeToKmzIcon(type, color) {
    var colorKey = (color || "#0ea5e9").replace("#", "").toLowerCase();
    var typeKey = (type || "pin").replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "pin";
    var fileName = "icons/" + typeKey + "-" + colorKey + ".png";
    if (!iconAssets[fileName]) {
      var svg = _mkSvgForKmz(type, color);
      var size = _extractSvgSize(svg);
      iconAssets[fileName] = { svg: svg, width: size.width, height: size.height };
    }
    return fileName;
  }
  var parts = [];
  geo.features.forEach(function(f, i) {
    var g = f.geometry;
    var name = (f.properties && f.properties.name) || (t('geom_element') + " " + (i + 1));
    var hex = (f.properties && f.properties.color) || "#0ea5e9";
    var kmlColor = hexToKmlColor(hex);
    var fillColor = "66" + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);
    var sid = "s" + i;
    var isPoint = (g.type === "Point" || g.type === "MultiPoint");
    var markerTypeValue = (f.properties && f.properties.markerType) || "pin";
    var markerHref = markerTypeToKmzIcon(markerTypeValue, hex);
    var style = isPoint
      ? '<Style id="' + sid + '"><IconStyle><scale>1.1</scale><Icon><href>' + markerHref + '</href></Icon></IconStyle></Style>'
      : '<Style id="' + sid + '"><LineStyle><color>' + kmlColor + '</color><width>2</width></LineStyle><PolyStyle><color>' + fillColor + '</color></PolyStyle></Style>';

    var extData = "";
    var descTag = "";
    var props = f.properties || {};
    var propKeys = Object.keys(props).filter(function(k) { return k !== "name" && k.charAt(0) !== "_"; });
    if (propKeys.length) {
      extData = "<ExtendedData>" + propKeys.map(function(k) {
        var v = props[k]; if (v === null || v === undefined) v = "";
        return '<Data name="' + k.replace(/&/g,"&amp;").replace(/"/g,"&quot;") + '"><value>' + String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;") + '</value></Data>';
      }).join("") + "</ExtendedData>";

      // Build styled HTML description table
      var rows = propKeys.map(function(k, ri) {
        var v = props[k];
        if (v === null || v === undefined) v = "";
        var esc = function(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); };
        var bg = ri % 2 === 0 ? "#f8fafc" : "#ffffff";
        return '<tr style="background:' + bg + ';">'
          + '<td style="padding:6px 12px;font-weight:600;color:#334155;border-bottom:1px solid #e2e8f0;white-space:nowrap;">' + esc(k) + '</td>'
          + '<td style="padding:6px 12px;color:#475569;border-bottom:1px solid #e2e8f0;word-break:break-word;">' + esc(v) + '</td>'
          + '</tr>';
      }).join("");

      descTag = '<description><![CDATA['
        + '<div style="font-family:\'Segoe UI\',system-ui,-apple-system,sans-serif;max-width:420px;">'
        + '<div style="background:linear-gradient(135deg,' + hex + ',' + hex + 'dd);padding:12px 16px;border-radius:10px 10px 0 0;">'
        + '<span style="font-size:15px;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.2);">' + name.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '</span>'
        + '</div>'
        + '<table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;overflow:hidden;">'
        + rows
        + '</table>'
        + '<div style="text-align:right;padding:6px 10px 2px;font-size:10px;color:#94a3b8;">Ma\u00f1a Maps</div>'
        + '</div>'
        + ']]></description>';
    }

    var geomTag = _geomToKml(g);
    if (geomTag) {
      parts.push(style + "\n<Placemark><name>" + name.replace(/&/g,"&amp;").replace(/</g,"&lt;") + "</name><styleUrl>#" + sid + "</styleUrl>" + descTag + extData + geomTag + "</Placemark>");
    }
  });
  return {
    kml: '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Ma\u00f1a Maps</name>\n' + parts.join("\n") + "\n</Document></kml>",
    iconAssets: iconAssets
  };
}

async function _svgAssetToPngBytes(asset) {
  var svg = (asset && asset.svg) ? asset.svg : "";
  if (!svg) return null;
  var width = Math.max(16, Number(asset.width) || 28);
  var height = Math.max(16, Number(asset.height) || 28);

  return new Promise(function(resolve) {
    try {
      var img = new Image();
      var svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      var url = URL.createObjectURL(svgBlob);
      img.onload = function() {
        try {
          var canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          var ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(url);
          canvas.toBlob(async function(blob) {
            if (!blob) { resolve(null); return; }
            var buffer = await blob.arrayBuffer();
            resolve(new Uint8Array(buffer));
          }, "image/png");
        } catch (_err) {
          URL.revokeObjectURL(url);
          resolve(null);
        }
      };
      img.onerror = function() {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    } catch (_e) {
      resolve(null);
    }
  });
}

async function exportKMZ(geo, prefix) {
  prefix = prefix || "mana-maps";
  var kmzData = geoToKML(geo);
  var zip = new JSZip();
  zip.file("doc.kml", kmzData.kml);
  var iconPaths = Object.keys(kmzData.iconAssets || {});
  for (var i = 0; i < iconPaths.length; i++) {
    var path = iconPaths[i];
    var asset = kmzData.iconAssets[path];
    if (asset && asset.svg) {
      var pngBytes = await _svgAssetToPngBytes(asset);
      if (pngBytes) zip.file(path, pngBytes);
    } else if (typeof asset === "string") {
      zip.file(path, asset);
    }
  }
  var blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  dl(blob, prefix + ".kmz", "application/vnd.google-earth.kmz", true);
}

// ===================== SHAPEFILE =====================
function _flattenFeatures(features) {
  var out = [];
  features.forEach(function(f) {
    var g = f.geometry, p = f.properties;
    if (g.type === "MultiPoint") {
      g.coordinates.forEach(function(c) { out.push({ type: "Feature", properties: p, geometry: { type: "Point", coordinates: c } }); });
    } else if (g.type === "MultiLineString") {
      g.coordinates.forEach(function(line) { out.push({ type: "Feature", properties: p, geometry: { type: "LineString", coordinates: line } }); });
    } else if (g.type === "MultiPolygon") {
      g.coordinates.forEach(function(poly) { out.push({ type: "Feature", properties: p, geometry: { type: "Polygon", coordinates: poly } }); });
    } else {
      out.push(f);
    }
  });
  return out;
}

function _shpHeader(fileLen, shapeType, bb) {
  var hdr = new ArrayBuffer(100);
  var dv = new DataView(hdr);
  dv.setInt32(0, 9994, false);
  dv.setInt32(24, fileLen / 2, false);
  dv.setInt32(28, 1000, true);
  dv.setInt32(32, shapeType, true);
  dv.setFloat64(36, bb.xmin, true);
  dv.setFloat64(44, bb.ymin, true);
  dv.setFloat64(52, bb.xmax, true);
  dv.setFloat64(60, bb.ymax, true);
  return hdr;
}

function _calcBbox(feats, fn) {
  var xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
  feats.forEach(function(f) {
    fn(f).forEach(function(c) {
      if (c[0] < xmin) xmin = c[0]; if (c[0] > xmax) xmax = c[0];
      if (c[1] < ymin) ymin = c[1]; if (c[1] > ymax) ymax = c[1];
    });
  });
  return { xmin: xmin, ymin: ymin, xmax: xmax, ymax: ymax };
}

function _collectFields(feats) {
  var fields = [{ name: "NAME", width: 80 }];
  var seen = { name: 1, Name: 1, NAME: 1, color: 1, _skip: 1 };
  feats.forEach(function(f) {
    Object.keys(f.properties || {}).forEach(function(k) {
      if (seen[k] || k.charAt(0) === '_') return; seen[k] = 1;
      var maxW = 10;
      feats.forEach(function(f2) {
        var v = (f2.properties || {})[k];
        if (v !== null && v !== undefined) { var l = String(v).length; if (l > maxW) maxW = l; }
      });
      fields.push({ name: k.substring(0, 10).toUpperCase(), width: Math.min(Math.max(maxW, 10), 254) });
    });
  });
  return fields;
}

function _buildDBF(feats, fields) {
  var n = feats.length, nf = fields.length;
  var hs = 32 + nf * 32 + 1;
  var rs = 1; fields.forEach(function(fd) { rs += fd.width; });
  var buf = new ArrayBuffer(hs + n * rs);
  var dv = new DataView(buf);
  var enc = new TextEncoder();
  dv.setUint8(0, 3);
  dv.setInt32(4, n, true);
  dv.setUint16(8, hs, true);
  dv.setUint16(10, rs, true);
  fields.forEach(function(fd, fi) {
    var off = 32 + fi * 32;
    var nb = enc.encode(fd.name.substring(0, 10));
    for (var j = 0; j < nb.length && j < 11; j++) dv.setUint8(off + j, nb[j]);
    dv.setUint8(off + 11, 67);
    dv.setUint8(off + 16, fd.width);
  });
  dv.setUint8(hs - 1, 13);
  feats.forEach(function(f, ri) {
    var off = hs + ri * rs;
    dv.setUint8(off, 32);
    var pos = off + 1;
    fields.forEach(function(fd) {
      var p = f.properties || {};
      var val = "";
      if (fd.name === "NAME") val = p.name || p.Name || p.NAME || "";
      else {
        // Find original key (case-insensitive match)
        var origKey = Object.keys(p).find(function(k) { return k.substring(0,10).toUpperCase() === fd.name; });
        if (origKey) { var v = p[origKey]; val = (v !== null && v !== undefined) ? String(v) : ""; }
      }
      val = val.substring(0, fd.width);
      var vb = enc.encode(val);
      for (var j = 0; j < vb.length && j < fd.width; j++) dv.setUint8(pos + j, vb[j]);
      pos += fd.width;
    });
  });
  return buf;
}

function _buildPointShp(feats) {
  var bb = _calcBbox(feats, function(f) { return [f.geometry.coordinates]; });
  var recSize = 28; // header(8) + shpType(4) + x(8) + y(8)
  var fileLen = 100 + feats.length * recSize;
  var shp = new ArrayBuffer(fileLen);
  var shx = new ArrayBuffer(100 + feats.length * 8);
  var sd = new DataView(shp), xd = new DataView(shx);
  var h1 = _shpHeader(fileLen, 1, bb);
  new Uint8Array(shp).set(new Uint8Array(h1));
  var h2 = _shpHeader(100 + feats.length * 8, 1, bb);
  new Uint8Array(shx).set(new Uint8Array(h2));
  feats.forEach(function(f, i) {
    var off = 100 + i * recSize;
    sd.setInt32(off, i + 1, false);
    sd.setInt32(off + 4, 10, false); // content len in 16-bit words: 20/2=10
    sd.setInt32(off + 8, 1, true);
    sd.setFloat64(off + 12, f.geometry.coordinates[0], true);
    sd.setFloat64(off + 20, f.geometry.coordinates[1], true);
    xd.setInt32(100 + i * 8, off / 2, false);
    xd.setInt32(100 + i * 8 + 4, 10, false);
  });
  return { shp: shp, shx: shx };
}

function _buildPolyShp(feats, shapeType) {
  var bb = _calcBbox(feats, function(f) {
    var c = f.geometry.coordinates;
    return shapeType === 5 ? c[0] : c;
  });
  var recs = feats.map(function(f) {
    var rings = shapeType === 5 ? f.geometry.coordinates : [f.geometry.coordinates];
    var nParts = rings.length;
    var nPts = rings.reduce(function(s, r) { return s + r.length; }, 0);
    return { rings: rings, nParts: nParts, nPts: nPts, contentSize: 44 + nParts * 4 + nPts * 16 };
  });
  var fileLen = 100;
  recs.forEach(function(r) { fileLen += 8 + r.contentSize; });
  var shp = new ArrayBuffer(fileLen);
  var shx = new ArrayBuffer(100 + feats.length * 8);
  var sd = new DataView(shp), xd = new DataView(shx);
  new Uint8Array(shp).set(new Uint8Array(_shpHeader(fileLen, shapeType, bb)));
  new Uint8Array(shx).set(new Uint8Array(_shpHeader(100 + feats.length * 8, shapeType, bb)));
  var off = 100;
  recs.forEach(function(rec, i) {
    sd.setInt32(off, i + 1, false);
    sd.setInt32(off + 4, rec.contentSize / 2, false);
    var co = off + 8;
    sd.setInt32(co, shapeType, true); co += 4;
    var rxn = Infinity, ryn = Infinity, rxx = -Infinity, ryx = -Infinity;
    rec.rings.forEach(function(r) { r.forEach(function(p) {
      if (p[0]<rxn) rxn=p[0]; if (p[0]>rxx) rxx=p[0];
      if (p[1]<ryn) ryn=p[1]; if (p[1]>ryx) ryx=p[1];
    }); });
    sd.setFloat64(co, rxn, true); co+=8;
    sd.setFloat64(co, ryn, true); co+=8;
    sd.setFloat64(co, rxx, true); co+=8;
    sd.setFloat64(co, ryx, true); co+=8;
    sd.setInt32(co, rec.nParts, true); co+=4;
    sd.setInt32(co, rec.nPts, true); co+=4;
    var ptIdx = 0;
    rec.rings.forEach(function(ring) { sd.setInt32(co, ptIdx, true); co+=4; ptIdx += ring.length; });
    rec.rings.forEach(function(ring) { ring.forEach(function(p) {
      sd.setFloat64(co, p[0], true); co+=8;
      sd.setFloat64(co, p[1], true); co+=8;
    }); });
    xd.setInt32(100 + i * 8, off / 2, false);
    xd.setInt32(100 + i * 8 + 4, rec.contentSize / 2, false);
    off += 8 + rec.contentSize;
  });
  return { shp: shp, shx: shx };
}

var SHP_PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

async function exportShapefile(geo, prefix) {
  prefix = prefix || "mana-maps";
  var flat = _flattenFeatures(geo.features);
  var pts = flat.filter(function(f) { return f.geometry.type === "Point"; });
  var lns = flat.filter(function(f) { return f.geometry.type === "LineString"; });
  var pgs = flat.filter(function(f) { return f.geometry.type === "Polygon"; });
  var zip = new JSZip();
  if (pts.length) {
    var ps = _buildPointShp(pts), pf = _collectFields(pts);
    zip.file("points.shp", ps.shp); zip.file("points.shx", ps.shx);
    zip.file("points.dbf", _buildDBF(pts, pf)); zip.file("points.prj", SHP_PRJ);
  }
  if (lns.length) {
    var ls = _buildPolyShp(lns, 3), lf = _collectFields(lns);
    zip.file("lines.shp", ls.shp); zip.file("lines.shx", ls.shx);
    zip.file("lines.dbf", _buildDBF(lns, lf)); zip.file("lines.prj", SHP_PRJ);
  }
  if (pgs.length) {
    var gs = _buildPolyShp(pgs, 5), gf = _collectFields(pgs);
    zip.file("polygons.shp", gs.shp); zip.file("polygons.shx", gs.shx);
    zip.file("polygons.dbf", _buildDBF(pgs, gf)); zip.file("polygons.prj", SHP_PRJ);
  }
  if (!pts.length && !lns.length && !pgs.length) {
    manaAlert("No hay geometr\u00EDas exportables.", "warning"); return;
  }
  var blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  dl(blob, prefix + ".zip", "application/zip", true);
}
