// ── markers.js ─ 100-icon marker system ──

let drawColor = '#0ea5e9';
let markerType = 'circle';

function setDrawColor(color, el) {
  drawColor = color;
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
}

function setMarkerType(type, el) {
  markerType = type;
  document.querySelectorAll('#marker-row .marker-opt, .mk-modal-grid .mk-modal-btn').forEach(s => s.classList.remove('active'));
  if (el) el.classList.add('active');
  // Update the active state in the style panel row
  document.querySelectorAll('#marker-row .marker-opt').forEach(s => {
    s.classList.toggle('active', s.dataset.mtype === type);
  });
}

// ═══════════════════════════════════════════════════════════════
// ICON REGISTRY — 100 icons organized by category
// Each: { id, cat, label_es, label_en, path (24x24 viewBox) }
// ═══════════════════════════════════════════════════════════════
var MK = [
  // ── Basic shapes (rendered as full custom shapes) ──
  { id:'pin',      cat:'shape', es:'Pin',       en:'Pin',       shape:true },
  { id:'circle',   cat:'shape', es:'Círculo',   en:'Circle',    shape:true },
  { id:'square',   cat:'shape', es:'Cuadrado',  en:'Square',    shape:true },
  { id:'diamond',  cat:'shape', es:'Diamante',  en:'Diamond',   shape:true },
  { id:'triangle', cat:'shape', es:'Triángulo', en:'Triangle',  shape:true },
  { id:'star',     cat:'shape', es:'Estrella',  en:'Star',      shape:true },
  { id:'hexagon',  cat:'shape', es:'Hexágono',  en:'Hexagon',   shape:true },
  { id:'cross',    cat:'shape', es:'Cruz',      en:'Cross',     shape:true },
  { id:'drop',     cat:'shape', es:'Gota',      en:'Drop',      shape:true },
  { id:'flag',     cat:'shape', es:'Bandera',   en:'Flag',      shape:true },
  { id:'bolt',     cat:'shape', es:'Rayo',      en:'Bolt',      shape:true },
  { id:'heart',    cat:'shape', es:'Corazón',   en:'Heart',     shape:true },

  // ── Transport ──
  { id:'car',       cat:'transport', es:'Coche',      en:'Car',       p:'M5 11l1.5-4.5h11L19 11M3 15h18v-3a2 2 0 00-2-2H5a2 2 0 00-2 2v3zm3 3a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm12 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z' },
  { id:'bus',       cat:'transport', es:'Bus',        en:'Bus',       p:'M6 3h12a2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2zm0 9h12M8.5 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm7 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z' },
  { id:'train',     cat:'transport', es:'Tren',       en:'Train',     p:'M4 11V5a2 2 0 012-2h12a2 2 0 012 2v6M4 15h16M7 19l-2 2m12-2l2 2M9 11V7h6v4M9.5 16a.5.5 0 100-1 .5.5 0 000 1zm5 0a.5.5 0 100-1 .5.5 0 000 1z' },
  { id:'plane',     cat:'transport', es:'Avión',      en:'Plane',     p:'M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z' },
  { id:'ship',      cat:'transport', es:'Barco',      en:'Ship',      p:'M2 21c.6.5 1.2 1 2.5 1 2 0 2.5-1 4.5-1s2.5 1 4.5 1 2.5-1 4.5-1c1.3 0 1.9.5 2.5 1M4 17l1-7h14l1 7M12 3v7m-4 0h8' },
  { id:'bike',      cat:'transport', es:'Bici',       en:'Bike',      p:'M5.5 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm13 0a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM5.5 13.5l5-7h4l2 4.5m-6-4.5h4' },
  { id:'walk',      cat:'transport', es:'Peatón',     en:'Walk',      p:'M13.5 5.5a2 2 0 100-4 2 2 0 000 4zM10 23l1-7m3 7l-1.5-7L14 12l-3.5-2-2 4m9-2l-4-2' },
  { id:'anchor',    cat:'transport', es:'Ancla',      en:'Anchor',    p:'M12 8a2 2 0 100-4 2 2 0 000 4zm0 0v12m-5-3a5 5 0 0010 0M7 12h10' },
  { id:'parking',   cat:'transport', es:'Parking',    en:'Parking',   p:'M6 19V5h6a4 4 0 010 8H6' },
  { id:'fuel',      cat:'transport', es:'Gasolina',   en:'Fuel',      p:'M3 22V5a2 2 0 012-2h8a2 2 0 012 2v7h1a2 2 0 012 2v3a1 1 0 002 0v-6l-2-2V6l2.5-2M3 12h12' },

  // ── Places ──
  { id:'home',      cat:'places', es:'Casa',         en:'Home',      p:'M3 12l9-9 9 9M5 10v10h4v-6h6v6h4V10' },
  { id:'building',  cat:'places', es:'Edificio',     en:'Building',  p:'M3 21h18M5 21V7l8-4v18m0 0h6V11l-6-2' },
  { id:'hospital',  cat:'places', es:'Hospital',     en:'Hospital',  p:'M3 21V5a2 2 0 012-2h14a2 2 0 012 2v16M10 9h4m-2-2v4' },
  { id:'school',    cat:'places', es:'Escuela',      en:'School',    p:'M2 10l10-5 10 5-10 5zM6 12v5c0 2 2.7 3 6 3s6-1 6-3v-5' },
  { id:'church',    cat:'places', es:'Iglesia',      en:'Church',    p:'M12 2v4m-3 0h6M8 6v15H4L12 6l8 15h-4V6' },
  { id:'museum',    cat:'places', es:'Museo',        en:'Museum',    p:'M3 21h18M4 17h16M2 10l10-7 10 7M6 10v7m4-7v7m4-7v7m4-7v7' },
  { id:'hotel',     cat:'places', es:'Hotel',        en:'Hotel',     p:'M3 21V7m0 7h18M21 21V7M7 11V7m10 4V7' },
  { id:'shop',      cat:'places', es:'Tienda',       en:'Shop',      p:'M3 6l3-3h12l3 3M3 6v2c0 1.7 1.3 3 3 3s3-1.3 3-3 1.3 3 3 3 3-1.3 3-3 1.3 3 3 3 3-1.3 3-3M5 11v10h14V11' },
  { id:'bank',      cat:'places', es:'Banco',        en:'Bank',      p:'M2 20h20M4 17h16M2 10l10-7 10 7M6 10v7m3-7v7m3-7v7m3-7v7m3-7v7' },
  { id:'pharmacy',  cat:'places', es:'Farmacia',     en:'Pharmacy',  p:'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm7 5v8m-4-4h8' },
  { id:'police',    cat:'places', es:'Policía',      en:'Police',    p:'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
  { id:'fire',      cat:'places', es:'Bomberos',     en:'Fire',      p:'M12 22c-4 0-7-3-7-7 0-4 3-6 4-9 1 3 3 4 5 4 0-2-1-4-2-5 2 2 5 5 5 10 0 4-2 7-5 7z' },
  { id:'library',   cat:'places', es:'Biblioteca',   en:'Library',   p:'M4 19V5a2 2 0 012-2h8a2 2 0 012 2v14m-6 0V5m-6 0h12M16 5h2a2 2 0 012 2v10a2 2 0 01-2 2h-2' },
  { id:'cinema',    cat:'places', es:'Cine',         en:'Cinema',    p:'M4 8V4h16v4M2 8h20v12H2zm7 3v6l5-3z' },
  { id:'restaurant',cat:'places', es:'Restaurante',  en:'Restaurant', p:'M3 2v7c0 1.7 1.3 3 3 3h2v9m8 0V12h2c1.7 0 3-1.3 3-3V2m-4 0v7m4-7v7M10 2l1 7' },
  { id:'cafe',      cat:'places', es:'Cafetería',    en:'Cafe',      p:'M3 14c0 1.7 1.3 3 3 3h8c1.7 0 3-1.3 3-3M3 9h14v5M17 9h2a2 2 0 010 4h-2M5 21h10M8 17v4m4-4v4' },
  { id:'bar',       cat:'places', es:'Bar',          en:'Bar',       p:'M8 21h8m-4-4v4M5 3l7 8 7-8M5 3h14' },
  { id:'gym',       cat:'places', es:'Gimnasio',     en:'Gym',       p:'M2 12h2m16 0h2M6 8v8m12-8v8M6 12h12M4 10v4m16-4v4' },
  { id:'pool',      cat:'places', es:'Piscina',      en:'Pool',      p:'M2 16c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0M2 20c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0M12 12a3 3 0 100-6 3 3 0 000 6zm0 0v4' },

  // ── Nature & outdoor ──
  { id:'tree',      cat:'nature', es:'Árbol',        en:'Tree',      p:'M12 22v-7m0 0l-5 0c0-3 2-5 5-8 3 3 5 5 5 8h-5z' },
  { id:'mountain',  cat:'nature', es:'Montaña',      en:'Mountain',  p:'M3 20L9 8l4 5 3-3 5 10z' },
  { id:'water',     cat:'nature', es:'Agua',         en:'Water',     p:'M2 6c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0' },
  { id:'flower',    cat:'nature', es:'Flor',         en:'Flower',    p:'M12 16a4 4 0 100-8 4 4 0 000 8zm0 0v6m0-10c0-4-3-4-3-7a3 3 0 016 0c0 3-3 3-3 7z' },
  { id:'leaf',      cat:'nature', es:'Hoja',         en:'Leaf',      p:'M17 8C8 10 5.9 16.2 3.8 19.8M17 8c2-2 3-4 3-7-3 0-5 1-7 3M17 8c-2 4-6.5 8-10.2 10.8' },
  { id:'sun',       cat:'nature', es:'Sol',          en:'Sun',       p:'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2m0 18v2M4.2 4.2l1.4 1.4m12.8 12.8l1.4 1.4M1 12h2m18 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4' },
  { id:'moon',      cat:'nature', es:'Luna',         en:'Moon',      p:'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z' },
  { id:'cloud',     cat:'nature', es:'Nube',         en:'Cloud',     p:'M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z' },
  { id:'snow',      cat:'nature', es:'Nieve',        en:'Snow',      p:'M20 17.58A5 5 0 0018 8h-1.26A8 8 0 104 16.25M8 16h.01M8 20h.01M12 18h.01M12 22h.01M16 16h.01M16 20h.01' },
  { id:'camping',   cat:'nature', es:'Camping',      en:'Camping',   p:'M3 21l9-16 9 16H3zm9-16v3' },
  { id:'beach',     cat:'nature', es:'Playa',        en:'Beach',     p:'M18 4a3 3 0 00-3 3c0 2 3 6 3 6s3-4 3-6a3 3 0 00-3-3zM5 21l2-8h6l2 8M2 21h20' },
  { id:'fish',      cat:'nature', es:'Pez',          en:'Fish',      p:'M6.5 12c3-5 10-5 14 0-4 5-11 5-14 0zM2 12l3-3v6zM16.5 10.5a.5.5 0 100-1 .5.5 0 000 1z' },
  { id:'paw',       cat:'nature', es:'Huella',       en:'Paw',       p:'M12 17c-1.5 2.5-5 2.5-5 .5s3-3.5 5-3.5 5 1.5 5 3.5-3.5 2-5-.5zM8.5 8.5a2 2 0 100-4 2 2 0 000 4zm7 0a2 2 0 100-4 2 2 0 000 4zM6 13a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm12 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z' },

  // ── Activity ──
  { id:'camera',    cat:'activity', es:'Cámara',      en:'Camera',    p:'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z' },
  { id:'photo',     cat:'activity', es:'Foto',        en:'Photo',     p:'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm0 18l5-6 2.5 3L16 13l5 6M9.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z' },
  { id:'music',     cat:'activity', es:'Música',      en:'Music',     p:'M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z' },
  { id:'sport',     cat:'activity', es:'Deporte',     en:'Sport',     p:'M12 12a10 10 0 100-20 10 10 0 000 20zm0-20v20M2 12h20M4.93 4.93a14 14 0 010 14.14M19.07 4.93a14 14 0 000 14.14' },
  { id:'trophy',    cat:'activity', es:'Trofeo',      en:'Trophy',    p:'M8 21h8m-4-4v4M6 4h12v4a6 6 0 01-12 0V4zM6 8H3v1a3 3 0 003 3m12-4h3v1a3 3 0 01-3 3' },
  { id:'hiking',    cat:'activity', es:'Senderismo',  en:'Hiking',    p:'M14 4a2 2 0 100-4 2 2 0 000 4zM7 21l3-9m4 9l-1-6-3-3 1-4 4 2 3-2' },
  { id:'ski',       cat:'activity', es:'Esquí',       en:'Ski',       p:'M14.5 4.5a2 2 0 100-4 2 2 0 000 4zM6 21l11-4M11 14l-2 4m3-6l3-5-4-2-2 3M17 5l2.5 1' },
  { id:'bike2',     cat:'activity', es:'Ciclismo',    en:'Cycling',   p:'M5.5 20a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm13 0a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM5.5 16.5L9 9.5h4l3 4M12.5 5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z' },
  { id:'swim',      cat:'activity', es:'Nadar',       en:'Swim',      p:'M2 20c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0M14 11a3 3 0 100-6 3 3 0 000 6zm-6 5l5-5 4 3' },

  // ── Symbols & signage ──
  { id:'info',      cat:'symbol', es:'Info',          en:'Info',      p:'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4m0-4h.01' },
  { id:'warning',   cat:'symbol', es:'Aviso',         en:'Warning',   p:'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4m0 4h.01' },
  { id:'question',  cat:'symbol', es:'Pregunta',      en:'Question',  p:'M12 22a10 10 0 100-20 10 10 0 000 20zM9.09 9a3 3 0 015.83 1c0 2-3 3-3 3m.08 4h.01' },
  { id:'check',     cat:'symbol', es:'Check',         en:'Check',     p:'M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3' },
  { id:'xmark',     cat:'symbol', es:'Error',         en:'Error',     p:'M12 22a10 10 0 100-20 10 10 0 000 20zM15 9l-6 6m0-6l6 6' },
  { id:'prohibit',  cat:'symbol', es:'Prohibido',     en:'Prohibited', p:'M12 22a10 10 0 100-20 10 10 0 000 20zM4.93 4.93l14.14 14.14' },
  { id:'target',    cat:'symbol', es:'Objetivo',      en:'Target',    p:'M12 22a10 10 0 100-20 10 10 0 000 20zm0-4a6 6 0 100-12 6 6 0 000 12zm0-4a2 2 0 100-4 2 2 0 000 4z' },
  { id:'compass',   cat:'symbol', es:'Brújula',       en:'Compass',   p:'M12 22a10 10 0 100-20 10 10 0 000 20zM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36z' },
  { id:'eye',       cat:'symbol', es:'Vista',         en:'View',      p:'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z' },
  { id:'lock',      cat:'symbol', es:'Candado',       en:'Lock',      p:'M5 11h14a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2v-7a2 2 0 012-2zm2 0V7a5 5 0 0110 0v4' },
  { id:'key',       cat:'symbol', es:'Llave',         en:'Key',       p:'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.78 7.78 5.5 5.5 0 017.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4' },
  { id:'tag',       cat:'symbol', es:'Etiqueta',      en:'Tag',       p:'M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01' },
  { id:'bookmark',  cat:'symbol', es:'Marcador',      en:'Bookmark',  p:'M5 3h14a2 2 0 012 2v16l-9-5-9 5V5a2 2 0 012-2z' },
  { id:'link',      cat:'symbol', es:'Enlace',        en:'Link',      p:'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71' },
  { id:'clock',     cat:'symbol', es:'Reloj',         en:'Clock',     p:'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2' },
  { id:'calendar',  cat:'symbol', es:'Calendario',    en:'Calendar',  p:'M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zm3-2v4m8-4v4M3 10h18' },
  { id:'mail',      cat:'symbol', es:'Correo',        en:'Mail',      p:'M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm0 0l9 6 9-6' },
  { id:'phone',     cat:'symbol', es:'Teléfono',      en:'Phone',     p:'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.81.37 1.61.67 2.38a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.78.3 1.57.54 2.38.67A2 2 0 0122 16.92z' },
  { id:'wifi',      cat:'symbol', es:'WiFi',          en:'WiFi',      p:'M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01' },
  { id:'number',    cat:'symbol', es:'Número',        en:'Number',    p:'M4 9h16M4 15h16M10 3L8 21m8-18l-2 18' },

  // ── Arrows & markers ──
  { id:'arrowup',   cat:'arrow', es:'Flecha arriba',  en:'Arrow up',    p:'M12 19V5m-7 7l7-7 7 7' },
  { id:'arrowdown', cat:'arrow', es:'Flecha abajo',   en:'Arrow down',  p:'M12 5v14m7-7l-7 7-7-7' },
  { id:'arrowleft', cat:'arrow', es:'Flecha izq.',    en:'Arrow left',  p:'M19 12H5m7-7l-7 7 7 7' },
  { id:'arrowright',cat:'arrow', es:'Flecha der.',    en:'Arrow right', p:'M5 12h14m-7-7l7 7-7 7' },
  { id:'navigate',  cat:'arrow', es:'Navegar',        en:'Navigate',    p:'M3 11l19-9-9 19-2-8z' },
  { id:'cursor',    cat:'arrow', es:'Cursor',         en:'Cursor',      p:'M5 3l14 6-5.5 2.5L11 17z' },
  { id:'pin2',      cat:'arrow', es:'Chincheta',      en:'Thumbtack',   p:'M12 17v5m-5-8h10l-2-6h1V4H8v4h1l-2 6zm2-9V4m2 4V4' },
  { id:'mappin',    cat:'arrow', es:'Pin de mapa',    en:'Map pin',     p:'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z' },

  // ── Infrastructure ──
  { id:'tower',     cat:'infra', es:'Torre',          en:'Tower',     p:'M8 21l2-12M14 21l2-12M10 3h4l2 6H8l2-6zM6 21h12' },
  { id:'bridge',    cat:'infra', es:'Puente',         en:'Bridge',    p:'M2 17h20M4 17c0-4 3.6-7 8-7s8 3 8 7M7 17v-3m5-4v7m5-3v3' },
  { id:'windmill',  cat:'infra', es:'Molino',         en:'Windmill',  p:'M12 8V2L8 6l4 2zm0 0l6-2-2 6m-4-4l-6 2 2 6m4-4v14M8 22h8' },
  { id:'lighthouse',cat:'infra', es:'Faro',           en:'Lighthouse',p:'M10 22h4M12 2v2m0 2l3 14H9L12 6zm5-3l-2 1m-6-1l2 1M6 8l2 1m8-1l2 1' },
  { id:'dam',       cat:'infra', es:'Presa',          en:'Dam',       p:'M3 6h18v3c-2 0-3 1-3 3s1 3 3 3v3H3v-3c2 0 3-1 3-3s-1-3-3-3V6z' },
  { id:'antenna',   cat:'infra', es:'Antena',         en:'Antenna',   p:'M12 4v16m-6 2h12M8.5 7.5A5 5 0 0112 6a5 5 0 013.5 1.5M5.5 4.5a10 10 0 0113 0' },
  { id:'solar',     cat:'infra', es:'Solar',          en:'Solar',     p:'M2 22l4-8h12l4 8H2zm6-8l1-4h6l1 4m-8-4l1-4h4l1 4' },
  { id:'trash',     cat:'infra', es:'Residuos',       en:'Waste',     p:'M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2' },
  { id:'recycle',   cat:'infra', es:'Reciclaje',      en:'Recycle',   p:'M7 19l-4-4 4-4m14 4l-4 4-4-4m-2-6l4-4 4 4M12 3v5m5 7h4m-14 0H3' },
  { id:'bench',     cat:'infra', es:'Banco',          en:'Bench',     p:'M3 18v-4h18v4M5 14V9h14v5M7 18v3m10-3v3' },

  // ── Misc ──
  { id:'gift',      cat:'misc', es:'Regalo',          en:'Gift',      p:'M3 10h18v10H3zM3 10l9-5 9 5M12 5v15M7.5 5a2.5 2.5 0 010-5C10 0 12 5 12 5m0 0C12 5 14 0 16.5 0a2.5 2.5 0 010 5' },
  { id:'crown',     cat:'misc', es:'Corona',          en:'Crown',     p:'M2 18l3-12 5 6 2-8 2 8 5-6 3 12z' },
  { id:'feather',   cat:'misc', es:'Pluma',           en:'Feather',   p:'M20.24 12.24a6 6 0 00-8.49-8.49L5 10.5V19h8.5z' },
  { id:'scissors',  cat:'misc', es:'Tijeras',         en:'Scissors',  p:'M6 9a3 3 0 100-6 3 3 0 000 6zm0 12a3 3 0 100-6 3 3 0 000 6zM20 4L8.12 15.88m0-7.76L20 20' },
  { id:'wrench',    cat:'misc', es:'Herramienta',     en:'Tool',      p:'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94z' },
  { id:'paint',     cat:'misc', es:'Pintura',         en:'Paint',     p:'M19 3H5a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM12 11v5a2 2 0 01-4 0v-3' },
  { id:'edit',      cat:'misc', es:'Editar',          en:'Edit',      p:'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z' },
  { id:'layers',    cat:'misc', es:'Capas',           en:'Layers',    p:'M2 12l10 5 10-5M2 17l10 5 10-5M12 2L2 7l10 5 10-5z' },
  { id:'globe',     cat:'misc', es:'Globo',           en:'Globe',     p:'M12 22a10 10 0 100-20 10 10 0 000 20zM2 12h20M12 2a15 15 0 014 10 15 15 0 01-4 10 15 15 0 01-4-10A15 15 0 0112 2z' },
  { id:'zap',       cat:'misc', es:'Energía',         en:'Energy',    p:'M13 2L3 14h9l-1 8 10-12h-9z' },

  // ── Telecomunicaciones ──
  { id:'tower_telecom', cat:'telecom', es:'Torre telecomunicaciones', en:'Telecom tower',    p:'M12 2v20M8 22h8M6 6l6 6 6-6M4 10l8 8 8-8M12 8v2' },
  { id:'antenna2',      cat:'telecom', es:'Antena sectorial',  en:'Sector antenna',          p:'M12 2v18M8 22h8M9 2c0 3-3 5-6 6m9-6c0 3 3 5 6 6M12 2a2 2 0 100-4 2 2 0 000 4z' },
  { id:'satellite_dish',cat:'telecom', es:'Parabólica',        en:'Satellite dish',          p:'M4 18V9c0-3 2-6 6-8m8 17c3-2 6-5 6-8V4M2 20a16 16 0 0020-16M7 17a1.5 1.5 0 100-3 1.5 1.5 0 000 3z' },
  { id:'manhole',       cat:'telecom', es:'Arqueta',           en:'Manhole',                 p:'M4 4h16v16H4zM7 7h10v10H7zM4 12h3m10 0h3M12 4v3m0 10v3' },
  { id:'manhole2',      cat:'telecom', es:'Arqueta doble',      en:'Double manhole',          p:'M3 3h18v18H3zM6 6h12v12H6zM9 9h6v6H9zM3 12h3m12 0h3M12 3v3m0 12v3' },
  { id:'splice_box',    cat:'telecom', es:'Caja de empalme',   en:'Splice box',              p:'M4 7h16a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1zm0 4h16M2 11h1m18 0h1M7 7V5m10 2V5' },
  { id:'fiber',         cat:'telecom', es:'Fibra óptica',      en:'Fiber optic',             p:'M2 12c4-4 6 4 10 0s6-4 10 0M2 12a2 2 0 100-4 2 2 0 000 4zm20 0a2 2 0 100-4 2 2 0 000 4z' },
  { id:'cabinet',       cat:'telecom', es:'Armario de calle',  en:'Street cabinet',          p:'M5 3h14a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1zm7 0v18M4 10h16M9 6h1m4 0h1M9 14h1m4 0h1' },
  { id:'olt',           cat:'telecom', es:'OLT',               en:'OLT',                     p:'M3 6h18a1 1 0 011 1v4a1 1 0 01-1 1H3a1 1 0 01-1-1V7a1 1 0 011-1zm0 8h18a1 1 0 011 1v4a1 1 0 01-1 1H3a1 1 0 01-1-1v-4a1 1 0 011-1zM6 9h1m3 0h1m3 0h1M6 17h1m3 0h1m3 0h1' },
  { id:'router',        cat:'telecom', es:'Router',            en:'Router',                  p:'M4 9h16a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2v-6a2 2 0 012-2zm2 5a1 1 0 100-2 1 1 0 000 2zM12 3v6M8 5l4-2 4 2' },
  { id:'cable',         cat:'telecom', es:'Cable',             en:'Cable',                   p:'M4 4l4 4M12 2a2 2 0 110 4 2 2 0 010-4zM8 8c0 4 2 6 4 8s4 4 4 8M20 20l-4-4' },
  { id:'signal',        cat:'telecom', es:'Señal',             en:'Signal',                  p:'M12 20a1 1 0 100-2 1 1 0 000 2zm-4-4a5.66 5.66 0 018 0m-12-4a9.9 9.9 0 0116 0M1 8a14.14 14.14 0 0122 0' },
  { id:'pole',          cat:'telecom', es:'Poste',             en:'Pole',                    p:'M12 2v20M6 6h12M4 6v3m16-3v3M8 22h8M6 6l-2-4m14 4l2-4' },

];

// Category labels for the picker modal
var MK_CATS = {
  shape:     { es: 'Formas',          en: 'Shapes' },
  transport: { es: 'Transporte',      en: 'Transport' },
  places:    { es: 'Lugares',         en: 'Places' },
  nature:    { es: 'Naturaleza',      en: 'Nature' },
  activity:  { es: 'Actividades',     en: 'Activities' },
  symbol:    { es: 'Símbolos',        en: 'Symbols' },
  arrow:     { es: 'Flechas',         en: 'Arrows' },
  infra:     { es: 'Infraestructura', en: 'Infrastructure' },
  misc:      { es: 'Varios',          en: 'Miscellaneous' },
  telecom:   { es: 'Telecomunicaciones', en: 'Telecommunications' },
};

// Quick-access defaults (shown in compact row)
var MK_DEFAULTS = ['circle','pin','square','star','flag','heart'];

// ═══════════════════════════════════════════════════════════════
// MAKE MARKER ICON — renders colored map marker
// ═══════════════════════════════════════════════════════════════
function makeMarkerIcon(color, type) {
  var def = _mkFind(type);
  var svg, size = [24, 24], anchor = [12, 12], popup = [0, -14];

  // Basic shapes: custom full-shape SVGs
  if (def && def.shape) {
    return _mkShapeIcon(color, type);
  }

  // POI icons: colored circle + white icon path
  var path = def ? def.p : '';
  if (!path) return _mkShapeIcon(color, 'pin'); // fallback

  svg = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">'
    + '<circle cx="14" cy="14" r="13" fill="' + color + '" stroke="white" stroke-width="2"/>'
    + '<g transform="translate(4.5,4.5) scale(0.79)" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="' + path + '"/></g></svg>';
  size = [28, 28]; anchor = [14, 14]; popup = [0, -16];

  return L.divIcon({ html: svg, className: '', iconSize: size, iconAnchor: anchor, popupAnchor: popup });
}

// Renders basic shape icons (pin, circle, square, etc.)
function _mkShapeIcon(color, type) {
  var svg, size = [24,24], anchor = [12,12], popup = [0,-14];
  switch(type) {
    case 'pin':
      svg='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32"><path d="M12 0C7.13 0 3 4.13 3 9c0 7.25 9 23 9 23s9-15.75 9-23c0-4.87-4.13-9-9-9z" fill="'+color+'" stroke="white" stroke-width="1.5"/><circle cx="12" cy="9" r="3.5" fill="white"/></svg>';
      size=[24,32];anchor=[12,32];popup=[0,-28]; break;
    case 'circle':
      svg='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="'+color+'" stroke="white" stroke-width="2"/></svg>'; break;
    case 'square':
      svg='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" fill="'+color+'" stroke="white" stroke-width="2"/></svg>'; break;
    case 'diamond':
      svg='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" transform="rotate(45 12 12)" fill="'+color+'" stroke="white" stroke-width="2"/></svg>'; break;
    case 'triangle':
      svg='<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"><polygon points="12,3 22,21 2,21" fill="'+color+'" stroke="white" stroke-width="1.5"/></svg>';
      size=[26,26];anchor=[13,15]; break;
    case 'star':
      svg='<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"><polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9" fill="'+color+'" stroke="white" stroke-width="1.2"/></svg>';
      size=[26,26];anchor=[13,13]; break;
    case 'hexagon':
      svg='<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"><polygon points="12,2 21,7 21,17 12,22 3,17 3,7" fill="'+color+'" stroke="white" stroke-width="1.5"/></svg>';
      size=[26,26];anchor=[13,13]; break;
    case 'cross':
      svg='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" fill="'+color+'" stroke="white" stroke-width="1.2"/></svg>'; break;
    case 'drop':
      svg='<svg xmlns="http://www.w3.org/2000/svg" width="22" height="28" viewBox="0 0 22 28"><path d="M11 0C11 0 0 12 0 18a11 11 0 0022 0C22 12 11 0 11 0z" fill="'+color+'" stroke="white" stroke-width="1.5"/></svg>';
      size=[22,28];anchor=[11,28];popup=[0,-24]; break;
    case 'flag':
      svg='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="28" viewBox="0 0 24 28"><line x1="4" y1="2" x2="4" y2="27" stroke="white" stroke-width="3" stroke-linecap="round"/><line x1="4" y1="2" x2="4" y2="27" stroke="'+color+'" stroke-width="1.5" stroke-linecap="round"/><path d="M4 3L20 7L4 14Z" fill="'+color+'" stroke="white" stroke-width="1.2"/></svg>';
      size=[24,28];anchor=[4,27];popup=[8,-24]; break;
    case 'bolt':
      svg='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="26" viewBox="0 0 24 26"><polygon points="13,1 4,15 11,15 9,25 20,10 13,10" fill="'+color+'" stroke="white" stroke-width="1.3"/></svg>';
      size=[24,26];anchor=[12,13]; break;
    case 'heart':
      svg='<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"><path d="M12 21C12 21 3 14 3 8.5A4.5 4.5 0 017.5 4c1.74 0 3.41 1 4.5 2.09C13.09 5 14.76 4 16.5 4A4.5 4.5 0 0121 8.5C21 14 12 21 12 21z" fill="'+color+'" stroke="white" stroke-width="1.3"/></svg>';
      size=[26,26];anchor=[13,22]; break;
    default: return _mkShapeIcon(color,'pin');
  }
  return L.divIcon({ html:svg, className:'', iconSize:size, iconAnchor:anchor, popupAnchor:popup });
}

// ═══════════════════════════════════════════════════════════════
// PREVIEW SVG — for selectors (monochrome, small)
// ═══════════════════════════════════════════════════════════════
function mkPreviewSvg(type) {
  var def = _mkFind(type);
  if (!def) return '';
  if (def.shape) return _mkShapePreview(type);
  if (!def.p) return '';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + def.p + '"/></svg>';
}

function _mkShapePreview(type) {
  var map = {
    pin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="currentColor" stroke="none"/></svg>',
    circle:'<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="7"/></svg>',
    square:'<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>',
    diamond:'<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" transform="rotate(45 12 12)"/></svg>',
    triangle:'<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12,4 21,20 3,20"/></svg>',
    star:'<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9"/></svg>',
    hexagon:'<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12,3 20,7 20,17 12,21 4,17 4,7"/></svg>',
    cross:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg>',
    drop:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C12 2 4 11 4 16a8 8 0 0016 0C20 11 12 2 12 2z"/></svg>',
    flag:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="3" x2="5" y2="22"/><path d="M5 3L19 7L5 13Z" fill="currentColor" stroke="none"/></svg>',
    bolt:'<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="13,2 5,14 11,14 9,22 19,9 13,9"/></svg>',
    heart:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21C12 21 3 14 3 8.5A4.5 4.5 0 017.5 4c1.74 0 3.41 1 4.5 2.09C13.09 5 14.76 4 16.5 4A4.5 4.5 0 0121 8.5C21 14 12 21 12 21z"/></svg>',
  };
  return map[type] || '';
}

function _mkFind(type) {
  for (var i = 0; i < MK.length; i++) { if (MK[i].id === type) return MK[i]; }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// MARKER PICKER MODAL — full grid with categories
// ═══════════════════════════════════════════════════════════════
function openMarkerPicker(callback) {
  _mkClosePicker();

  var modal = document.createElement('div');
  modal.id = 'mk-picker-modal';
  modal.className = 'mk-modal-overlay';

  var titleId = 'mk-modal-title';
  var box = '<div class="mk-modal-box" role="dialog" aria-modal="true" aria-labelledby="' + titleId + '">';
  box += '<div class="mk-modal-header"><span id="' + titleId + '">' + (LANG==='en'?'Choose marker':'Elegir marcador') + '</span><button type="button" class="mk-modal-close" aria-label="' + (LANG==='en'?'Close marker picker':'Cerrar selector de marcadores') + '">×</button></div>';

  // Search
  box += '<input type="text" class="mk-modal-search" placeholder="' + (LANG==='en'?'Search...':'Buscar...') + '" oninput="_mkFilterPicker(this.value)">';

  // Grid by category
  box += '<div class="mk-modal-body" id="mk-modal-body">';
  var cats = Object.keys(MK_CATS);
  cats.forEach(function(cat) {
    var label = LANG === 'en' ? MK_CATS[cat].en : MK_CATS[cat].es;
    box += '<div class="mk-modal-cat" data-cat="' + cat + '">';
    box += '<div class="mk-modal-cat-label">' + label + '</div>';
    box += '<div class="mk-modal-grid">';
    MK.forEach(function(m) {
      if (m.cat !== cat) return;
      var title = LANG === 'en' ? m.en : m.es;
      var active = m.id === markerType ? ' active' : '';
      box += '<button type="button" class="mk-modal-btn' + active + '" data-id="' + m.id + '" data-label="' + title.toLowerCase() + '" title="' + title + '" onclick="_mkPick(\'' + m.id + '\')">'
        + mkPreviewSvg(m.id) + '</button>';
    });
    box += '</div></div>';
  });
  box += '</div></div>';

  modal.innerHTML = box;
  document.body.appendChild(modal);

  var search = modal.querySelector('.mk-modal-search');
  var closeBtn = modal.querySelector('.mk-modal-close');
  var focusable = function() {
    return modal.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])');
  };

  // Store callback
  window._mkPickerCallback = callback || function(id) {
    setMarkerType(id, null);
  };

  modal.addEventListener('click', function(e) {
    if (e.target === modal) _mkClosePicker();
  });
  closeBtn.addEventListener('click', _mkClosePicker);
  modal.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      _mkClosePicker();
      return;
    }
    if (e.key !== 'Tab') return;
    var nodes = focusable();
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  if (search) search.focus();
}

function _mkClosePicker() {
  var modal = document.getElementById('mk-picker-modal');
  if (modal) modal.remove();
}

function _mkPick(id) {
  if (window._mkPickerCallback) window._mkPickerCallback(id);
  _mkClosePicker();
}

function _mkFilterPicker(query) {
  var q = query.toLowerCase().trim();
  var body = document.getElementById('mk-modal-body');
  if (!body) return;
  body.querySelectorAll('.mk-modal-btn').forEach(function(btn) {
    var label = btn.dataset.label || '';
    var id = btn.dataset.id || '';
    btn.style.display = (!q || label.indexOf(q) >= 0 || id.indexOf(q) >= 0) ? '' : 'none';
  });
  // Hide empty categories
  body.querySelectorAll('.mk-modal-cat').forEach(function(cat) {
    var visible = cat.querySelectorAll('.mk-modal-btn:not([style*="display: none"])');
    cat.style.display = visible.length ? '' : 'none';
  });
}
