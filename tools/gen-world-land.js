// Generates js/world-land.js — a compact world land path in canonical
// (lon*10000, mercatorY(lat)*10000) integer coordinates for preview backgrounds.
// Source: Natural Earth 110m land polygons (GeoJSON). Usage:
//   node tools/gen-world-land.js <path/to/ne_110m_land.geojson>
const fs = require('fs');
const geoPath = process.argv[2] || '/var/folders/mj/87d56wh11nn1hcjjtl_hjk7h0000gn/T/opencode/ne_110m_land.geojson';
const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));

const MAX_LAT = 85.051129;
function mercY(lat) {
  const c = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + c / 2));
}

function perpDistSq(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) { const ex = p[0] - a[0], ey = p[1] - a[1]; return ex * ex + ey * ey; }
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = a[0] + t * dx - p[0], py = a[1] + t * dy - p[1];
  return px * px + py * py;
}

function douglasPeucker(points, tolSq) {
  const n = points.length;
  if (n <= 2) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDistSq(points[i], points[first], points[last]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolSq && idx > 0) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// Simplification tolerance in (degree, degree) space. Scale latitude by ~1.4 to
// roughly account for the larger vertical extent at high latitudes in practice.
const TOL = 0.35;
let subpaths = [];
let totalPts = 0;

for (const f of geo.features) {
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      const pts = ring.map(c => [c[0], c[1]]);
      if (pts.length < 4) continue;
      const simplified = douglasPeucker(pts, TOL * TOL);
      const projected = simplified.map(c => [c[0] * 10000, mercY(c[1]) * 10000]);
      if (projected.length < 4) continue;
      // close ring
      const d = projected.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ' ' + p[1]).join('') + ' Z';
      subpaths.push(d);
      totalPts += projected.length;
    }
  }
}

// drop tiny rings (islands smaller than threshold area in projected space)
function ringArea(sub) {
  const nums = sub.match(/-?\d+/g).map(Number);
  if (!nums || nums.length < 6) return 0;
  let area = 0;
  for (let i = 0; i < nums.length - 2; i += 2) {
    const x1 = nums[i], y1 = nums[i + 1], x2 = nums[i + 2], y2 = nums[i + 3];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}
subpaths = subpaths.filter(s => ringArea(s) > 250000);

const path = subpaths.join('');
console.log('simplified points:', totalPts, 'subpaths:', subpaths.length);
console.log('path length (chars):', path.length, 'approx KB:', (path.length / 1024).toFixed(1));

const js = '// ── world-land.js ─ simplified world land path for stylized preview backgrounds ──\n' +
  '// Canonical coordinates: lon*10000, mercatorY(lat)*10000. Rendered by map-preview.js\n' +
  '// via a shared <path id="mana-land-path"> referenced with <use>.\n' +
  '// Regenerate with: node tools/gen-world-land.js <ne_110m_land.geojson>\n' +
  'window.WORLD_LAND_PATH = "' + path + '";\n';
fs.writeFileSync('js/world-land.js', js);
console.log('written js/world-land.js');
