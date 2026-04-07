// ── markers.js ─ Draw style state & marker icon generation ──

let drawColor = '#0ea5e9';
let markerType = 'pin';

function setDrawColor(color, el) {
  drawColor = color;
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
}

function setMarkerType(type, el) {
  markerType = type;
  document.querySelectorAll('.marker-opt').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
}

function makeMarkerIcon(color, type) {
  let svg;
  if (type === 'circle') {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="${color}" stroke="white" stroke-width="2"/></svg>`;
  } else if (type === 'square') {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" fill="${color}" stroke="white" stroke-width="2"/></svg>`;
  } else if (type === 'star') {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"><polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9" fill="${color}" stroke="white" stroke-width="1.2"/></svg>`;
  } else {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32"><path d="M12 0C7.13 0 3 4.13 3 9c0 7.25 9 23 9 23s9-15.75 9-23c0-4.87-4.13-9-9-9z" fill="${color}" stroke="white" stroke-width="1.5"/><circle cx="12" cy="9" r="3.5" fill="white"/></svg>`;
  }
  const size = type === 'pin' ? [24, 32] : type === 'star' ? [26, 26] : [24, 24];
  const anchor = type === 'pin' ? [12, 32] : [12, 12];
  return L.divIcon({
    html: svg, className: '', iconSize: size, iconAnchor: anchor,
    popupAnchor: [0, type === 'pin' ? -28 : -14]
  });
}
