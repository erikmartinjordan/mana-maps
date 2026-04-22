// ── chat.js ─ AI-powered chat with function calling + enhanced fallback ──

// ═══════════════════════════════════════════════════════════════
// SETTINGS (persisted in localStorage)
// ═══════════════════════════════════════════════════════════════
const MANA_DEFAULTS = {
  provider: 'openai',
  apiKey: '',
  model: 'gpt-4o-mini',
  endpoint: 'https://api.openai.com/v1/chat/completions',
};

function manaSettings() {
  try {
    return Object.assign({}, MANA_DEFAULTS, JSON.parse(localStorage.getItem('mana_ai_settings') || '{}'));
  } catch { return { ...MANA_DEFAULTS }; }
}

function saveSettings(obj) {
  localStorage.setItem('mana_ai_settings', JSON.stringify(obj));
}

function hasAIKey() {
  return !!manaSettings().apiKey;
}

// ═══════════════════════════════════════════════════════════════
// GEOCODER
// ═══════════════════════════════════════════════════════════════
async function geocode(q) {
  const r = await fetch(
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q),
    { headers: { 'Accept-Language': 'es', 'User-Agent': 'ManaMaps/1.0' } }
  );
  return r.json();
}

async function reverseGeocode(lat, lng) {
  const r = await fetch(
    'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng,
    { headers: { 'Accept-Language': 'es', 'User-Agent': 'ManaMaps/1.0' } }
  );
  return r.json();
}

async function searchPlaces(q, limit) {
  limit = limit || 5;
  const r = await fetch(
    'https://nominatim.openstreetmap.org/search?format=json&limit=' + limit + '&q=' + encodeURIComponent(q),
    { headers: { 'Accept-Language': 'es', 'User-Agent': 'ManaMaps/1.0' } }
  );
  return r.json();
}

// ═══════════════════════════════════════════════════════════════
// COLOR MAP (name → hex)
// ═══════════════════════════════════════════════════════════════
const COLOR_MAP = {
  azul:'#0ea5e9', blue:'#0ea5e9', indigo:'#6366f1', índigo:'#6366f1',
  verde:'#10b981', green:'#10b981', menta:'#10b981',
  amarillo:'#f59e0b', yellow:'#f59e0b', dorado:'#f59e0b', naranja:'#f97316', orange:'#f97316',
  rojo:'#ef4444', red:'#ef4444', rosa:'#ec4899', pink:'#ec4899',
  púrpura:'#8b5cf6', morado:'#8b5cf6', violeta:'#8b5cf6', purple:'#8b5cf6',
  gris:'#64748b', pizarra:'#64748b', gray:'#64748b', negro:'#30363b', black:'#30363b',
};

function resolveColor(name) {
  if (!name) return drawColor;
  if (name.startsWith('#')) return name;
  return COLOR_MAP[name.toLowerCase()] || drawColor;
}

// ═══════════════════════════════════════════════════════════════
// TOOL FUNCTIONS (callable by AI or regex)
// ═══════════════════════════════════════════════════════════════
const toolActions = {
  async add_point({ place, color, name }) {
    const res = await geocode(place);
    if (!res.length) return { ok: false, msg: 'No encontré «' + place + '».' };
    const ll = [+res[0].lat, +res[0].lon];
    const c = resolveColor(color);
    const icon = makeMarkerIcon(c, markerType);
    const m = L.marker(ll, { icon }).addTo(drawnItems);
    const label = name || res[0].display_name.split(',')[0];
    m._manaName = label; m._manaColor = c;
    m.bindPopup('<strong>' + label + '</strong>');
    map.setView(ll, 13); stats();
    return { ok: true, msg: 'Punto añadido en **' + label + '** ✓', coords: ll };
  },

  async draw_line({ from, to, color }) {
    const [r1, r2] = await Promise.all([geocode(from), geocode(to)]);
    if (!r1.length || !r2.length) return { ok: false, msg: 'No pude encontrar uno de los lugares.' };
    const ll1 = [+r1[0].lat, +r1[0].lon], ll2 = [+r2[0].lat, +r2[0].lon];
    const c = resolveColor(color);
    const line = L.polyline([ll1, ll2], { color: c, weight: 3 }).addTo(drawnItems);
    line._manaName = from + ' → ' + to;
    map.fitBounds(line.getBounds(), { padding: [40, 40] }); stats();
    return { ok: true, msg: 'Línea de **' + from + '** a **' + to + '** ✓' };
  },

  async draw_polygon({ place, color, radius_km }) {
    const res = await geocode(place);
    if (!res.length) return { ok: false, msg: 'No encontré «' + place + '».' };
    const lat = +res[0].lat, lng = +res[0].lon;
    const r = (radius_km || 5) * 1000;
    const c = resolveColor(color);
    const circle = L.circle([lat, lng], { radius: r, color: c, weight: 2, fillOpacity: .15 }).addTo(drawnItems);
    circle._manaName = place + ' (' + (radius_km || 5) + ' km)';
    map.fitBounds(circle.getBounds()); stats();
    return { ok: true, msg: 'Área de ' + (radius_km || 5) + ' km alrededor de **' + place + '** ✓' };
  },

  async center_map({ place, zoom }) {
    const res = await geocode(place);
    if (!res.length) return { ok: false, msg: 'No encontré ese lugar.' };
    map.setView([+res[0].lat, +res[0].lon], zoom || 12);
    return { ok: true, msg: 'Centrado en **' + place + '** ✓' };
  },

  async search_places({ query, limit }) {
    const res = await searchPlaces(query, limit || 5);
    if (!res.length) return { ok: false, msg: 'Sin resultados para «' + query + '».' };
    const items = res.map((r, i) => (i + 1) + '. ' + r.display_name.substring(0, 80));
    return { ok: true, msg: 'Resultados:\n' + items.join('\n'), results: res };
  },

  async get_location_info({ place }) {
    const res = await geocode(place);
    if (!res.length) return { ok: false, msg: 'No encontré ese lugar.' };
    const r = res[0];
    return { ok: true, msg: '**' + r.display_name + '**\nLat: ' + (+r.lat).toFixed(5) + ', Lng: ' + (+r.lon).toFixed(5) + '\nTipo: ' + (r.type || r.class || '-') };
  },

  set_baselayer({ type }) {
    const t = type.toLowerCase();
    if (t.includes('sat')) { setBaseLayer('satellite'); return { ok: true, msg: 'Vista satélite ✓' }; }
    if (t.includes('glob') || t.includes('3d')) { setBaseLayer('globe'); return { ok: true, msg: 'Globo 3D ✓ — arrastra para rotar' }; }
    setBaseLayer('map'); return { ok: true, msg: 'Vista de mapa ✓' };
  },

  clear_map() {
    drawnItems.clearLayers(); stats();
    return { ok: true, msg: 'Mapa limpiado ✓' };
  },

  zoom({ direction, level }) {
    if (level) map.setZoom(level);
    else if (direction === 'in') map.zoomIn(2);
    else map.zoomOut(2);
    return { ok: true, msg: 'Zoom ' + (direction || 'nivel ' + level) + ' ✓' };
  },

  measure_distance() {
    setTool('ruler');
    return { ok: true, msg: 'Herramienta de medición activada — clic para medir, doble clic para terminar.' };
  },

  set_draw_tool({ tool }) {
    const t = tool.toLowerCase();
    if (t.includes('punto') || t === 'point') setTool('point');
    else if (t.includes('lín') || t.includes('line')) setTool('line');
    else if (t.includes('polí') || t.includes('polygon')) setTool('polygon');
    else if (t.includes('regla') || t.includes('ruler') || t.includes('medir')) setTool('ruler');
    return { ok: true, msg: 'Herramienta de ' + tool + ' activada ✓' };
  },

  set_color({ color }) {
    const c = resolveColor(color);
    drawColor = c;
    document.querySelectorAll('.color-swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.color === c);
    });
    return { ok: true, msg: 'Color cambiado a <span style="color:' + c + ';font-weight:700">' + color + '</span> ✓' };
  },

  set_marker_type({ type }) {
    const t = type.toLowerCase();
    let mt = 'pin';
    if (t.includes('círc') || t.includes('circ')) mt = 'circle';
    else if (t.includes('cuad') || t.includes('square')) mt = 'square';
    else if (t.includes('estre') || t.includes('star')) mt = 'star';
    setMarkerType(mt, document.querySelector('.marker-opt[data-mtype="' + mt + '"]'));
    return { ok: true, msg: 'Marcador cambiado a ' + mt + ' ✓' };
  },

  get_map_info() {
    let pts = 0, lns = 0, pols = 0;
    drawnItems.eachLayer(l => {
      if (l instanceof L.Marker) pts++;
      else if (l instanceof L.Polygon) pols++;
      else if (l instanceof L.Polyline) lns++;
    });
    const c = map.getCenter();
    return {
      ok: true,
      msg: '**Estado del mapa:**\n' +
        '• Centro: ' + c.lat.toFixed(4) + ', ' + c.lng.toFixed(4) + '\n' +
        '• Zoom: ' + map.getZoom() + '\n' +
        '• Puntos: ' + pts + ' | Líneas: ' + lns + ' | Polígonos: ' + pols + '\n' +
        '• Capa base: ' + activeBase
    };
  },

  export_map({ format }) {
    const fmt = (format || 'geojson').toLowerCase();
    exportAs(fmt.includes('csv') ? 'csv' : fmt.includes('kml') ? 'kml' : fmt.includes('shp') ? 'shapefile' : 'geojson');
    return { ok: true, msg: 'Exportando como ' + fmt + '… ✓' };
  },

  async add_multiple_points({ places, color }) {
    const c = resolveColor(color);
    let added = 0;
    for (const place of places) {
      const res = await geocode(place);
      if (res.length) {
        const ll = [+res[0].lat, +res[0].lon];
        const icon = makeMarkerIcon(c, markerType);
        const m = L.marker(ll, { icon }).addTo(drawnItems);
        m._manaName = res[0].display_name.split(',')[0]; m._manaColor = c;
        m.bindPopup('<strong>' + m._manaName + '</strong>');
        added++;
      }
    }
    map.fitBounds(drawnItems.getBounds(), { padding: [30, 30], maxZoom: 12 }); stats();
    return { ok: true, msg: added + ' de ' + places.length + ' puntos añadidos ✓' };
  },

  async draw_route({ from, to, color }) {
    // Use OSRM for routing
    const [r1, r2] = await Promise.all([geocode(from), geocode(to)]);
    if (!r1.length || !r2.length) return { ok: false, msg: 'No pude encontrar uno de los lugares.' };
    const c1 = r1[0], c2 = r2[0];
    try {
      const url = 'https://router.project-osrm.org/route/v1/driving/' +
        c1.lon + ',' + c1.lat + ';' + c2.lon + ',' + c2.lat + '?overview=full&geometries=geojson';
      const resp = await fetch(url);
      const data = await resp.json();
      if (data.routes && data.routes.length) {
        const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        const clr = resolveColor(color);
        const line = L.polyline(coords, { color: clr, weight: 4, opacity: .8 }).addTo(drawnItems);
        line._manaName = from + ' → ' + to + ' (ruta)';
        const dist = (data.routes[0].distance / 1000).toFixed(1);
        const dur = Math.round(data.routes[0].duration / 60);
        map.fitBounds(line.getBounds(), { padding: [40, 40] }); stats();
        return { ok: true, msg: 'Ruta de **' + from + '** a **' + to + '**\n📏 ' + dist + ' km · ⏱ ' + dur + ' min ✓' };
      }
    } catch (e) {}
    // Fallback to straight line
    return toolActions.draw_line({ from, to, color });
  },

  help() {
    return { ok: true, msg:
      '**Comandos disponibles:**\n\n' +
      '📍 *"añade un punto en Barcelona"*\n' +
      '📍 *"marca Madrid, Sevilla y Valencia"*\n' +
      '🔵 *"color rojo"* / *"color #ff6600"*\n' +
      '📐 *"dibuja línea de A a B"*\n' +
      '🛣️ *"ruta de Madrid a Barcelona"*\n' +
      '⭕ *"dibuja un área de 10km en París"*\n' +
      '🔍 *"busca museos en Roma"*\n' +
      'ℹ️ *"info de Tokio"*\n' +
      '🗺️ *"satélite"* / *"mapa"* / *"globo 3D"*\n' +
      '📏 *"mide distancia"*\n' +
      '🗑️ *"borra todo"*\n' +
      '💾 *"exporta como GeoJSON"*\n' +
      '📊 *"estado del mapa"*\n\n' +
      'Con clave API configurada: escribe cualquier cosa en lenguaje natural.'
    };
  }
};

// ═══════════════════════════════════════════════════════════════
// AI FUNCTION DEFINITIONS (OpenAI tool format)
// ═══════════════════════════════════════════════════════════════
const AI_TOOLS = [
  { type:'function', function:{ name:'add_point', description:'Añade un marcador/punto en un lugar del mapa', parameters:{ type:'object', properties:{ place:{type:'string',description:'Nombre del lugar'}, color:{type:'string',description:'Color (nombre o hex)'}, name:{type:'string',description:'Etiqueta opcional'}}, required:['place']}}},
  { type:'function', function:{ name:'draw_line', description:'Dibuja una línea recta entre dos lugares', parameters:{ type:'object', properties:{ from:{type:'string'}, to:{type:'string'}, color:{type:'string'}}, required:['from','to']}}},
  { type:'function', function:{ name:'draw_route', description:'Calcula y dibuja la ruta por carretera entre dos lugares, mostrando distancia y tiempo', parameters:{ type:'object', properties:{ from:{type:'string'}, to:{type:'string'}, color:{type:'string'}}, required:['from','to']}}},
  { type:'function', function:{ name:'draw_polygon', description:'Dibuja un área circular alrededor de un lugar', parameters:{ type:'object', properties:{ place:{type:'string'}, color:{type:'string'}, radius_km:{type:'number',description:'Radio en kilómetros'}}, required:['place']}}},
  { type:'function', function:{ name:'center_map', description:'Centra el mapa en un lugar', parameters:{ type:'object', properties:{ place:{type:'string'}, zoom:{type:'number'}}, required:['place']}}},
  { type:'function', function:{ name:'search_places', description:'Busca lugares por texto', parameters:{ type:'object', properties:{ query:{type:'string'}, limit:{type:'number'}}, required:['query']}}},
  { type:'function', function:{ name:'get_location_info', description:'Obtiene info y coordenadas de un lugar', parameters:{ type:'object', properties:{ place:{type:'string'}}, required:['place']}}},
  { type:'function', function:{ name:'set_baselayer', description:'Cambia el tipo de mapa base (map/satellite/globe)', parameters:{ type:'object', properties:{ type:{type:'string',enum:['map','satellite','globe']}}, required:['type']}}},
  { type:'function', function:{ name:'clear_map', description:'Borra todos los elementos del mapa', parameters:{ type:'object', properties:{}}}},
  { type:'function', function:{ name:'zoom', description:'Controla el zoom del mapa', parameters:{ type:'object', properties:{ direction:{type:'string',enum:['in','out']}, level:{type:'number'}}, required:[]}}},
  { type:'function', function:{ name:'measure_distance', description:'Activa la herramienta de medición', parameters:{ type:'object', properties:{}}}},
  { type:'function', function:{ name:'set_draw_tool', description:'Activa una herramienta de dibujo', parameters:{ type:'object', properties:{ tool:{type:'string',enum:['point','line','polygon','ruler']}}, required:['tool']}}},
  { type:'function', function:{ name:'set_color', description:'Cambia el color de dibujo', parameters:{ type:'object', properties:{ color:{type:'string'}}, required:['color']}}},
  { type:'function', function:{ name:'set_marker_type', description:'Cambia el tipo de marcador', parameters:{ type:'object', properties:{ type:{type:'string',enum:['pin','circle','square','star']}}, required:['type']}}},
  { type:'function', function:{ name:'get_map_info', description:'Obtiene el estado actual del mapa', parameters:{ type:'object', properties:{}}}},
  { type:'function', function:{ name:'export_map', description:'Exporta el mapa en un formato', parameters:{ type:'object', properties:{ format:{type:'string',enum:['geojson','csv','kml','shapefile']}}, required:['format']}}},
  { type:'function', function:{ name:'add_multiple_points', description:'Añade varios puntos a la vez', parameters:{ type:'object', properties:{ places:{type:'array',items:{type:'string'},description:'Lista de lugares'}, color:{type:'string'}}, required:['places']}}},
];

const SYSTEM_PROMPT = `Eres Maña AI, el asistente inteligente de Maña Maps — una aplicación web de mapas interactivos.

Tu rol es ayudar al usuario a interactuar con el mapa usando lenguaje natural. Puedes:
- Añadir puntos, líneas, rutas y áreas en el mapa
- Buscar lugares y obtener información geográfica
- Cambiar el estilo del mapa (satélite, globo 3D, colores, marcadores)
- Medir distancias, exportar datos, y más

Reglas:
- Responde SIEMPRE en español
- Sé conciso y útil
- Usa las funciones disponibles para ejecutar acciones en el mapa
- Si el usuario pide algo que no puedes hacer con las funciones, explícalo amablemente
- Puedes encadenar varias funciones si es necesario (ej: cambiar color + añadir punto)
- Cuando el usuario mencione colores, usa los nombres: azul, rojo, verde, amarillo, rosa, púrpura, naranja, negro, gris
- Para rutas entre ciudades usa draw_route (incluye distancia y tiempo)
- Para líneas rectas simples usa draw_line`;

// ═══════════════════════════════════════════════════════════════
// CHAT HISTORY
// ═══════════════════════════════════════════════════════════════
let chatHistory = [{ role: 'system', content: SYSTEM_PROMPT }];

// ═══════════════════════════════════════════════════════════════
// CHAT UI
// ═══════════════════════════════════════════════════════════════
function addMsg(text, isUser) {
  const wrap = document.createElement('div');
  if (!isUser) {
    const lbl = document.createElement('div');
    lbl.className = 'msg-label';
    lbl.textContent = 'Maña AI';
    wrap.appendChild(lbl);
  }
  const el = document.createElement('div');
  el.className = 'msg ' + (isUser ? 'user' : 'bot');
  el.innerHTML = formatMsg(text);
  wrap.appendChild(el);
  const msgs = document.getElementById('chat-messages');
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
  return el;
}

function formatMsg(text) {
  // Simple markdown-like formatting
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function showTyping() {
  const wrap = document.createElement('div');
  wrap.id = 'typing-indicator';
  const lbl = document.createElement('div');
  lbl.className = 'msg-label';
  lbl.textContent = 'Maña AI';
  wrap.appendChild(lbl);
  const el = document.createElement('div');
  el.className = 'msg bot typing';
  el.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  wrap.appendChild(el);
  const msgs = document.getElementById('chat-messages');
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
  return wrap;
}

function removeTyping() {
  const t = document.getElementById('typing-indicator');
  if (t) t.remove();
}

// ═══════════════════════════════════════════════════════════════
// ENHANCED REGEX FALLBACK (when no API key)
// ═══════════════════════════════════════════════════════════════
async function processRegex(cmd) {
  const c = cmd.toLowerCase().trim();

  // Help
  if (/^(ayuda|help|comandos|\?)$/.test(c)) return toolActions.help();

  // Clear
  if (/borra(r)? (todo|el mapa|todo el mapa)/.test(c) || c === 'limpiar' || c === 'clear') return toolActions.clear_map();

  // Map info
  if (/estado|info del mapa|status|resumen/.test(c)) return toolActions.get_map_info();

  // Base layers
  if (/sat[eé]lite/.test(c)) return toolActions.set_baselayer({ type: 'satellite' });
  if (/globo|3d|esfera|tierra|planet/.test(c)) return toolActions.set_baselayer({ type: 'globe' });
  if (/^mapa$|callejero|carto/.test(c)) return toolActions.set_baselayer({ type: 'map' });

  // Color
  const colorM = c.match(/^(?:color|cambiar? color(?: a)?)\s+(.+)/);
  if (colorM) return toolActions.set_color({ color: colorM[1].trim() });

  // Marker type
  const markerM = c.match(/marcador\s+(pin|c[ií]rculo|cuadrado|estrella|circle|square|star)/i);
  if (markerM) return toolActions.set_marker_type({ type: markerM[1] });

  // Tools
  if (/mide|distancia|regla|ruler/.test(c)) return toolActions.measure_distance();
  if (/herramienta (de )?punto|activar? punto/.test(c)) return toolActions.set_draw_tool({ tool: 'punto' });
  if (/herramienta (de )?l[ií]nea|activar? l[ií]nea/.test(c)) return toolActions.set_draw_tool({ tool: 'línea' });
  if (/herramienta (de )?pol[ií]gono|activar? pol[ií]gono/.test(c)) return toolActions.set_draw_tool({ tool: 'polígono' });

  // Zoom
  if (/acerca|zoom in|más cerca/.test(c)) return toolActions.zoom({ direction: 'in' });
  if (/aleja|zoom out|más lejos/.test(c)) return toolActions.zoom({ direction: 'out' });

  // Export
  const expM = c.match(/export(?:a|ar)\s+(?:como\s+)?(.+)/i);
  if (expM) return toolActions.export_map({ format: expM[1].trim() });

  // Route
  const routeM = c.match(/ruta\s+(?:de\s+)?(.+?)\s+(?:a|hasta)\s+(.+)/i);
  if (routeM) return toolActions.draw_route({ from: routeM[1], to: routeM[2] });

  // Center
  const centerM = c.match(/centra(?:r)?(?:\s+(?:el\s+)?mapa)?\s+(?:en\s+)?(.+)/);
  if (centerM) return toolActions.center_map({ place: centerM[1] });

  // Multiple points
  const multiM = c.match(/(?:marca|pon|añade|dibuja)\s+(?:puntos?\s+(?:en\s+)?)?(.+,\s*.+)/i);
  if (multiM) {
    const places = multiM[1].split(/\s*[,y]\s*/).map(s => s.trim()).filter(Boolean);
    if (places.length > 1) return toolActions.add_multiple_points({ places });
  }

  // Draw area/polygon
  const areaM = c.match(/(?:dibuja|traza|crea)\s+(?:un\s+)?(?:área|zona|círculo|radio)\s+(?:de\s+)?(\d+)\s*km\s+(?:en|alrededor de|sobre)\s+(.+)/i);
  if (areaM) return toolActions.draw_polygon({ place: areaM[2], radius_km: +areaM[1] });
  const area2M = c.match(/(?:dibuja|traza|crea)\s+(?:un\s+)?(?:área|zona|polígono)\s+(?:en|sobre|de)\s+(.+)/i);
  if (area2M) return toolActions.draw_polygon({ place: area2M[1] });

  // Draw line
  const lineM = c.match(/(?:dibuja|traza)\s+(?:una?\s+)?l[ií]nea\s+(?:entre|de)\s+(.+?)\s+(?:y|a|hasta)\s+(.+)/i);
  if (lineM) return toolActions.draw_line({ from: lineM[1], to: lineM[2] });

  // Add point
  const ptM = c.match(/(?:dibuja|añade|pon|marca|agrega|punto)\s+(?:un\s+)?(?:punto\s+)?(?:en|sobre|de)\s+(.+)/i);
  if (ptM) return toolActions.add_point({ place: ptM[1] });

  // Search places
  const searchM = c.match(/(?:busca|encuentra|search)\s+(.+)/i);
  if (searchM) return toolActions.search_places({ query: searchM[1] });

  // Location info
  const infoM = c.match(/(?:info(?:rmación)?|datos|dónde|donde)\s+(?:de|sobre|está)?\s*(.+)/i);
  if (infoM) return toolActions.get_location_info({ place: infoM[1] });

  // Fallback: try as place name to add point
  if (c.length > 2 && c.length < 60 && !/[?!¿¡]/.test(c)) {
    const res = await geocode(c);
    if (res.length) {
      return toolActions.add_point({ place: c });
    }
  }

  return {
    ok: false,
    msg: 'No entendí ese comando. Escribe **ayuda** para ver los comandos disponibles, o configura una clave API para chat con IA.'
  };
}

// ═══════════════════════════════════════════════════════════════
// AI CHAT (OpenAI-compatible with function calling)
// ═══════════════════════════════════════════════════════════════
async function processAI(userText) {
  const settings = manaSettings();

  // P1.3: Update system prompt with current map state
  const mapContext = typeof getCurrentGeoJSON === 'function' ? JSON.stringify(getCurrentGeoJSON()) : '{}';
  const dynamicSystem = SYSTEM_PROMPT + '\n\nEl mapa actual contiene: ' + mapContext + '. Pots fer refer\u00E8ncia a elements existents.';
  chatHistory[0] = { role: 'system', content: dynamicSystem };

  chatHistory.push({ role: 'user', content: userText });

  // Keep history manageable (last 20 messages + system)
  if (chatHistory.length > 22) {
    chatHistory = [chatHistory[0], ...chatHistory.slice(-20)];
  }

  try {
    let response = await callAI(settings, chatHistory);
    let msg = response.choices[0].message;

    // Handle tool calls (may be multiple rounds)
    let rounds = 0;
    while (msg.tool_calls && msg.tool_calls.length && rounds < 5) {
      rounds++;
      chatHistory.push(msg);

      for (const tc of msg.tool_calls) {
        const fn = tc.function.name;
        const args = JSON.parse(tc.function.arguments || '{}');
        let result;
        if (toolActions[fn]) {
          result = await toolActions[fn](args);
        } else {
          result = { ok: false, msg: 'Función no reconocida: ' + fn };
        }
        chatHistory.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result)
        });
      }

      response = await callAI(settings, chatHistory);
      msg = response.choices[0].message;
    }

    const reply = msg.content || 'Hecho ✓';
    chatHistory.push({ role: 'assistant', content: reply });
    return { ok: true, msg: reply };

  } catch (err) {
    console.error('AI Error:', err);
    // Fallback to regex on API error
    chatHistory.pop(); // remove failed user message
    const fallback = await processRegex(userText);
    const errDetail = err.message || String(err);
    fallback.msg = '⚠️ ' + errDetail + '\n\nUsando modo local:\n' + fallback.msg;
    return fallback;
  }
}

async function callAI(settings, messages) {
  const headers = { 'Content-Type': 'application/json' };

  // All providers use Bearer auth
  headers['Authorization'] = 'Bearer ' + settings.apiKey;

  const body = {
    model: settings.model,
    messages: messages,
    tools: AI_TOOLS,
    tool_choice: 'auto',
    temperature: 0.3,
    max_tokens: 1024,
  };

  // Groq: disable parallel tool calls (not supported on all models)
  if (settings.provider === 'groq') {
    body.parallel_tool_calls = false;
  }

  const resp = await fetch(settings.endpoint, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error('API ' + resp.status + ': ' + errText.substring(0, 200));
  }

  return resp.json();
}

// ═══════════════════════════════════════════════════════════════
// SEND MESSAGE
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// CHAT INPUT HISTORY (↑ / ↓ navigation)
// ═══════════════════════════════════════════════════════════════
const CHAT_HISTORY_MAX = 50;
let _sentHistory = [];
let _historyIdx = -1;
let _historyDraft = '';

try {
  const stored = JSON.parse(localStorage.getItem('mana-chat-history') || '[]');
  if (Array.isArray(stored)) _sentHistory = stored.slice(-CHAT_HISTORY_MAX);
} catch(e) {}

function _saveChatHistory() {
  try { localStorage.setItem('mana-chat-history', JSON.stringify(_sentHistory)); } catch(e) {}
}

function _pushChatHistory(text) {
  if (!text) return;
  // Avoid duplicating the last entry
  if (_sentHistory.length && _sentHistory[_sentHistory.length - 1] === text) return;
  _sentHistory.push(text);
  if (_sentHistory.length > CHAT_HISTORY_MAX) _sentHistory.shift();
  _historyIdx = -1;
  _historyDraft = '';
  _saveChatHistory();
}

// ═══════════════════════════════════════════════════════════════
// SEND MESSAGE
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// P2.7: CLICKABLE CHAT SUGGESTIONS
// ═══════════════════════════════════════════════════════════════
function sendChatSuggestion(text) {
  const input = document.getElementById('chat-input');
  input.value = text;
  sendMsg();
}

let chatBusy = false;

async function sendMsg() {
  if (chatBusy) return;
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  _pushChatHistory(text);
  input.value = '';
  input.style.height = 'auto';
  addMsg(text, true);

  chatBusy = true;
  const typing = showTyping();

  let result;
  if (hasAIKey()) {
    result = await processAI(text);
  } else {
    result = await processRegex(text);
    // If regex couldn't handle it and no API key → show upsell
    if (!result.ok && typeof showUpsell === 'function') {
      removeTyping();
      chatBusy = false;
      showUpsell();
      return;
    }
  }

  removeTyping();
  chatBusy = false;
  addMsg(result.msg, false);
}

document.getElementById('chat-send').onclick = sendMsg;

document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); return; }

  // ↑ / ↓ history navigation
  if (e.key === 'ArrowUp' && !_sentHistory.length) return;
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    if (_historyIdx === -1) _historyDraft = input.value;
    if (_historyIdx < _sentHistory.length - 1) {
      _historyIdx++;
      input.value = _sentHistory[_sentHistory.length - 1 - _historyIdx];
    }
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    if (_historyIdx > 0) {
      _historyIdx--;
      input.value = _sentHistory[_sentHistory.length - 1 - _historyIdx];
    } else if (_historyIdx === 0) {
      _historyIdx = -1;
      input.value = _historyDraft;
    }
    return;
  }
});

document.getElementById('chat-input').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 100) + 'px';
  // Reset history navigation when user types
  _historyIdx = -1;
});

// ═══════════════════════════════════════════════════════════════
// SETTINGS MODAL
// ═══════════════════════════════════════════════════════════════
function openAISettings() {
  const s = manaSettings();
  // If no key configured, show upsell first
  if (!s.apiKey && typeof showUpsell === 'function') {
    showUpsell();
    return;
  }
  document.getElementById('ai-provider').value = s.provider;
  document.getElementById('ai-key').value = s.apiKey;
  document.getElementById('ai-model').value = s.model;
  document.getElementById('ai-endpoint').value = s.endpoint;
  toggleEndpointField(s.provider);
  document.getElementById('ai-settings-modal').classList.add('open');
}

function closeAISettings() {
  document.getElementById('ai-settings-modal').classList.remove('open');
}

function saveAISettings() {
  const provider = document.getElementById('ai-provider').value;
  const apiKey = document.getElementById('ai-key').value.trim();
  const model = document.getElementById('ai-model').value.trim();
  const endpoint = document.getElementById('ai-endpoint').value.trim();
  saveSettings({ provider, apiKey, model, endpoint });
  closeAISettings();
  updateAIBadge();
  if (apiKey) {
    addMsg('✓ IA configurada con **' + provider + '** / ' + model + '. Ya puedes escribir en lenguaje natural.', false);
  }
  // Update pro indicator
  if (typeof updateProIndicator === 'function') updateProIndicator();
}

function toggleEndpointField(provider) {
  const row = document.getElementById('ai-endpoint-row');
  const endpointInput = document.getElementById('ai-endpoint');
  const modelInput = document.getElementById('ai-model');
  if (provider === 'openai') {
    row.style.display = 'none';
    endpointInput.value = 'https://api.openai.com/v1/chat/completions';
    modelInput.placeholder = 'gpt-4o-mini';
  } else if (provider === 'groq') {
    row.style.display = 'none';
    endpointInput.value = 'https://api.groq.com/openai/v1/chat/completions';
    modelInput.placeholder = 'llama-3.3-70b-versatile';
    if (!modelInput.value || modelInput.value.startsWith('gpt')) modelInput.value = 'llama-3.3-70b-versatile';
  } else if (provider === 'together') {
    row.style.display = 'none';
    endpointInput.value = 'https://api.together.xyz/v1/chat/completions';
    modelInput.placeholder = 'meta-llama/Llama-3-70b-chat-hf';
    if (!modelInput.value || modelInput.value.startsWith('gpt')) modelInput.value = 'meta-llama/Llama-3-70b-chat-hf';
  } else {
    row.style.display = 'block';
    endpointInput.placeholder = 'https://your-api.com/v1/chat/completions';
  }
}

function updateAIBadge() {
  const badge = document.getElementById('ai-status-badge');
  if (badge) badge.classList.toggle('active', hasAIKey());
}

// Init badge on load
document.addEventListener('DOMContentLoaded', updateAIBadge);
setTimeout(updateAIBadge, 100);
