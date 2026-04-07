// ── chat.js ─ Chat interface & geocoder ──

// ── GEOCODER ──
async function geocode(q) {
  const r = await fetch(
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q),
    { headers: { 'Accept-Language': 'es', 'User-Agent': 'ManaMaps/1.0' } }
  );
  return r.json();
}

// ── CHAT UI ──
function addMsg(text, isUser) {
  const wrap = document.createElement('div');
  if (!isUser) {
    const lbl = document.createElement('div');
    lbl.className = 'msg-label';
    lbl.textContent = 'Ma\u00F1a AI';
    wrap.appendChild(lbl);
  }
  const el = document.createElement('div');
  el.className = 'msg ' + (isUser ? 'user' : 'bot');
  el.innerHTML = text;
  wrap.appendChild(el);
  const msgs = document.getElementById('chat-messages');
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
  return el;
}

// ── COMMAND PROCESSOR ──
async function processCmd(raw) {
  const cmd = raw.toLowerCase().trim();

  if (/borra(r)? (todo|el mapa|todo el mapa)/.test(cmd) || cmd === 'limpiar') {
    drawnItems.clearLayers(); stats();
    return 'Mapa limpiado \u2713';
  }

  const centerM = cmd.match(/centra(r)? (?:el mapa )?en (.+)/);
  if (centerM) {
    const res = await geocode(centerM[2]);
    if (res.length) { map.setView([+res[0].lat, +res[0].lon], 12); return 'Centrado en <strong>' + centerM[2] + '</strong> \u2713'; }
    return 'No encontr\u00E9 ese lugar.';
  }

  const ptM = cmd.match(/(?:dibuja|a\u00f1ade|pon|marca|agrega) (?:un )?punto (?:en|sobre|de) (.+)/);
  if (ptM) {
    const res = await geocode(ptM[1]);
    if (res.length) {
      const ll = [+res[0].lat, +res[0].lon];
      const icon = makeMarkerIcon(drawColor, markerType);
      const m = L.marker(ll, { icon }).addTo(drawnItems);
      m._manaName = ptM[1]; m._manaColor = drawColor;
      m.bindPopup('<strong>' + ptM[1] + '</strong>');
      map.setView(ll, 12); stats();
      return 'Punto en <strong>' + res[0].display_name.split(',')[0] + '</strong> \u2713';
    }
    return 'No encontr\u00E9 \u00AB' + ptM[1] + '\u00BB.';
  }

  const lineM = cmd.match(/(?:dibuja|traza) (?:una )?l[i\u00ed]nea (?:entre|de) (.+?) (?:y|a|hasta) (.+)/);
  if (lineM) {
    const [r1, r2] = await Promise.all([geocode(lineM[1]), geocode(lineM[2])]);
    if (r1.length && r2.length) {
      const ll1 = [+r1[0].lat, +r1[0].lon], ll2 = [+r2[0].lat, +r2[0].lon];
      const line = L.polyline([ll1, ll2], { color: drawColor, weight: 2 }).addTo(drawnItems);
      map.fitBounds(line.getBounds()); stats();
      return 'L\u00EDnea entre <strong>' + lineM[1] + '</strong> y <strong>' + lineM[2] + '</strong> \u2713';
    }
    return 'No pude encontrar uno de los lugares.';
  }

  if (/sat[e\u00e9]lite/.test(cmd)) { setBaseLayer('satellite'); return 'Vista sat\u00E9lite activada \u2713'; }
  if (/globo|3d|esfera|tierra|planet/.test(cmd)) { setBaseLayer('globe'); return 'Vista de globo 3D activada \u2014 arrastra para rotar \u2713'; }
  if (/mapa|callejero/.test(cmd)) { setBaseLayer('map'); return 'Vista de mapa activada \u2713'; }
  if (/mide|distancia|regla/.test(cmd)) { setTool('ruler'); return 'Herramienta de medici\u00F3n activada \u2014 clic para medir, doble clic para terminar.'; }
  if (/acerca|zoom in/.test(cmd)) { map.zoomIn(); return 'Zoom aumentado \u2713'; }
  if (/aleja|zoom out/.test(cmd)) { map.zoomOut(); return 'Zoom reducido \u2713'; }

  return 'No entend\u00ED ese comando. Prueba con <em>"dibuja un punto en Madrid"</em>, <em>"sat\u00E9lite"</em> o <em>"mide distancia"</em>.';
}

// ── SEND MESSAGE ──
async function sendMsg() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  addMsg(text, true);
  const bot = addMsg('<em>Procesando\u2026</em>', false);
  bot.innerHTML = await processCmd(text);
}

document.getElementById('chat-send').onclick = sendMsg;

document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
});

document.getElementById('chat-input').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 100) + 'px';
});
