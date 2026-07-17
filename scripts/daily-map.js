#!/usr/bin/env node
// Generates a GeoJSON FeatureCollection with mixed geometry types.
// Topic rotates by day of week (0=Sunday, 6=Saturday).
const day = new Date().getDay();

const topics = [
  // Sunday: Cultural Regions
  { name: 'Cultural Regions of the World', gen: genCulturalRegions },
  // Monday: Major Rivers
  { name: "World's Great Rivers", gen: genRivers },
  // Tuesday: Air Routes
  { name: 'Major International Air Routes', gen: genAirRoutes },
  // Wednesday: Mountain Ranges
  { name: 'Mountain Ranges & Peaks', gen: genMountains },
  // Thursday: Shipping Lanes
  { name: 'Global Shipping Routes', gen: genShipping },
  // Friday: Desert Regions
  { name: 'Deserts of the World', gen: genDeserts },
  // Saturday: Railway Journeys
  { name: 'Great Railway Journeys', gen: genRailways },
];

const topic = topics[day];
const features = topic.gen();
const fc = { type: 'FeatureCollection', features };
process.stdout.write(JSON.stringify(fc, null, 2));

// ─── HELPERS ────────────────────────────────────────────────
function point(lng, lat, props) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { markerType: 'circle', _manaMarkerType: 'circle', ...props } };
}
function line(coords, props) {
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { ...props } };
}
function polygon(coords, props) {
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: { ...props } };
}
function c(name, color, extra) { return { name, _manaName: name, color, _manaColor: color, ...extra }; }

// ─── RIVERS ─────────────────────────────────────────────────
function genRivers() {
  const f = [];
  // River basin polygon
  f.push(polygon([[-76,-8],[-70,-6],[-60,-4],[-50,-2],[-40,-4],[-30,-8],[-22,-14],[-16,-22],[-12,-30],[-6,-36],[0,-42],[6,-48],[10,-48],[8,-44],[2,-38],[-4,-32],[-10,-26],[-16,-20],[-22,-14],[-30,-8],[-40,-4],[-50,-2],[-60,-4],[-70,-6],[-76,-8]],
    c('Amazon Basin', '#22c55e', { fillOpacity: 0.07, _manaWeight: 1, markerType: undefined, _manaMarkerType: undefined })));
  // Rivers as lines with cities as points
  const rivers = [
    { name: 'Amazon River', color: '#22c55e', coords: [[-74,-12],[-70,-10],[-65,-8],[-60,-6],[-55,-4],[-50,-2],[-45,-4],[-40,-6],[-35,-8],[-30,-10],[-28,-12],[-26,-14],[-24,-16],[-20,-18],[-18,-20],[-16,-22],[-14,-24],[-12,-26],[-10,-28],[-8,-30],[-6,-32],[-4,-34],[-2,-36],[0,-38],[2,-40],[4,-42],[6,-44],[8,-46],[10,-48]] },
    { name: 'Nile River', color: '#0ea5e9', coords: [[31.6,-2],[32,-1],[32.5,0],[33,2],[33,4],[33.5,6],[34,8],[34.5,10],[35,12],[35.5,14],[36,16],[36.5,18],[37,20],[37.5,22],[38,24],[38,26],[37.5,28],[37,30],[36,32],[35,34],[34,36],[33,38],[32,40],[31.5,42],[31,44],[30.5,46],[30,48]] },
    { name: 'Mississippi River', color: '#3b82f6', coords: [[-90,29],[-91,30],[-92,31],[-93,32],[-94,33],[-95,34],[-96,35],[-97,36],[-98,37],[-99,38],[-100,39],[-101,40],[-102,41],[-103,42],[-104,43],[-105,44],[-106,45],[-107,46],[-108,47],[-109,48],[-110,49]] },
    { name: 'Yangtze River', color: '#f59e0b', coords: [[121,31],[120,31],[119,30],[118,30],[117,29],[116,29],[115,28],[114,28],[113,27],[112,27],[111,26],[110,26],[109,25],[108,25],[107,24],[106,24],[105,23],[104,23],[103,22],[102,22],[101,21],[100,21]] },
    { name: 'Danube River', color: '#8b5cf6', coords: [[29,45],[28,45],[27,44],[26,44],[25,44],[24,44],[23,44],[22,44],[21,44],[20,44],[19,44],[18,44],[17,44],[16,44],[15,44],[14,44],[13,44],[12,44],[11,44],[10,44],[9,44],[8,44],[7,44],[6,44],[5,44],[4,44],[3,44],[2,44],[1,44]] },
  ];
  for (const r of rivers) {
    f.push(line(r.coords, c(r.name, r.color, { _manaWeight: 3 })));
  }
  // Cities along rivers
  const cities = [
    { name: 'Manaus', lat: -3.1, lng: -60, color: '#22c55e' },
    { name: 'Belém', lat: -1.4, lng: -48.4, color: '#22c55e' },
    { name: 'Khartoum', lat: 15.5, lng: 32.5, color: '#0ea5e9' },
    { name: 'Cairo', lat: 30, lng: 31.2, color: '#0ea5e9' },
    { name: 'New Orleans', lat: 30, lng: -90, color: '#3b82f6' },
    { name: 'St. Louis', lat: 38.6, lng: -90.2, color: '#3b82f6' },
    { name: 'Shanghai', lat: 31.2, lng: 121.4, color: '#f59e0b' },
    { name: 'Nanjing', lat: 32, lng: 118.7, color: '#f59e0b' },
    { name: 'Vienna', lat: 48.2, lng: 16.3, color: '#8b5cf6' },
    { name: 'Budapest', lat: 47.5, lng: 19, color: '#8b5cf6' },
    { name: 'Belgrade', lat: 44.8, lng: 20.4, color: '#8b5cf6' },
    { name: 'Iquitos', lat: -3.7, lng: -73.2, color: '#22c55e' },
    { name: 'Minneapolis', lat: 45, lng: -93.2, color: '#3b82f6' },
    { name: 'Wuhan', lat: 30.5, lng: 114.3, color: '#f59e0b' },
    { name: 'Chongqing', lat: 29.5, lng: 106.5, color: '#f59e0b' },
    { name: 'Regensburg', lat: 49, lng: 12.1, color: '#8b5cf6' },
    { name: 'Bratislava', lat: 48.1, lng: 17.1, color: '#8b5cf6' },
    { name: 'Luxor', lat: 25.7, lng: 32.6, color: '#0ea5e9' },
    { name: 'Aswan', lat: 24.1, lng: 32.9, color: '#0ea5e9' },
    { name: 'Baton Rouge', lat: 30.4, lng: -91.1, color: '#3b82f6' },
  ];
  for (const p of cities) {
    f.push(point(p.lng, p.lat, c(p.name, p.color)));
  }
  return f;
}

// ─── AIR ROUTES ─────────────────────────────────────────────
function genAirRoutes() {
  const f = [];
  // Flight information region polygon (EUR)
  f.push(polygon([[-20,60],[-10,65],[0,70],[10,72],[20,74],[30,76],[40,78],[50,76],[60,74],[70,72],[80,70],[80,65],[70,60],[60,55],[50,50],[40,48],[30,46],[20,45],[10,44],[0,43],[-10,44],[-20,48],[-30,52],[-20,60]],
    c('EUR Flight Information Region', '#f59e0b', { fillOpacity: 0.06, _manaWeight: 1, markerType: undefined, _manaMarkerType: undefined })));
  const airports = [
    { name: 'New York (JFK)', lat: 40.6, lng: -73.7, color: '#0ea5e9' },
    { name: 'London (LHR)', lat: 51.5, lng: -0.4, color: '#0ea5e9' },
    { name: 'Tokyo (NRT)', lat: 35.7, lng: 140.3, color: '#0ea5e9' },
    { name: 'Dubai (DXB)', lat: 25.2, lng: 55.3, color: '#0ea5e9' },
    { name: 'Singapore (SIN)', lat: 1.3, lng: 103.9, color: '#0ea5e9' },
    { name: 'Sydney (SYD)', lat: -33.9, lng: 151.1, color: '#0ea5e9' },
    { name: 'São Paulo (GRU)', lat: -23.4, lng: -46.4, color: '#0ea5e9' },
    { name: 'Los Angeles (LAX)', lat: 34, lng: -118.4, color: '#0ea5e9' },
    { name: 'Paris (CDG)', lat: 49, lng: 2.5, color: '#0ea5e9' },
    { name: 'Beijing (PEK)', lat: 40, lng: 116.5, color: '#0ea5e9' },
    { name: 'Istanbul (IST)', lat: 41, lng: 28.7, color: '#0ea5e9' },
    { name: 'Doha (DOH)', lat: 25.2, lng: 51.5, color: '#0ea5e9' },
    { name: 'Hong Kong (HKG)', lat: 22.3, lng: 113.9, color: '#0ea5e9' },
    { name: 'San Francisco (SFO)', lat: 37.6, lng: -122.3, color: '#0ea5e9' },
    { name: 'Amsterdam (AMS)', lat: 52.3, lng: 4.7, color: '#0ea5e9' },
    { name: 'Bangkok (BKK)', lat: 13.7, lng: 100.7, color: '#0ea5e9' },
    { name: 'Johannesburg (JNB)', lat: -26.1, lng: 28.2, color: '#0ea5e9' },
    { name: 'Mexico City (MEX)', lat: 19.4, lng: -99.1, color: '#0ea5e9' },
    { name: 'Mumbai (BOM)', lat: 19, lng: 72.8, color: '#0ea5e9' },
    { name: 'Frankfurt (FRA)', lat: 50, lng: 8.5, color: '#0ea5e9' },
  ];
  // Routes between major hubs
  const routes = [
    ['New York (JFK)', 'London (LHR)', '#f59e0b'],
    ['London (LHR)', 'Dubai (DXB)', '#f59e0b'],
    ['Dubai (DXB)', 'Singapore (SIN)', '#f59e0b'],
    ['Tokyo (NRT)', 'Sydney (SYD)', '#f59e0b'],
    ['Los Angeles (LAX)', 'Tokyo (NRT)', '#f59e0b'],
    ['New York (JFK)', 'Los Angeles (LAX)', '#f59e0b'],
    ['São Paulo (GRU)', 'New York (JFK)', '#f59e0b'],
    ['Paris (CDG)', 'Beijing (PEK)', '#f59e0b'],
    ['Istanbul (IST)', 'Dubai (DXB)', '#f59e0b'],
    ['London (LHR)', 'Singapore (SIN)', '#f59e0b'],
    ['Amsterdam (AMS)', 'New York (JFK)', '#f59e0b'],
    ['Hong Kong (HKG)', 'San Francisco (SFO)', '#f59e0b'],
    ['Frankfurt (FRA)', 'Bangkok (BKK)', '#f59e0b'],
    ['Doha (DOH)', 'Johannesburg (JNB)', '#f59e0b'],
    ['Mumbai (BOM)', 'London (LHR)', '#f59e0b'],
    ['Mexico City (MEX)', 'Los Angeles (LAX)', '#f59e0b'],
    ['Tokyo (NRT)', 'Hong Kong (HKG)', '#f59e0b'],
    ['Sydney (SYD)', 'Singapore (SIN)', '#f59e0b'],
    ['Paris (CDG)', 'São Paulo (GRU)', '#f59e0b'],
    ['Beijing (PEK)', 'Tokyo (NRT)', '#f59e0b'],
  ];
  const apMap = {};
  for (const a of airports) apMap[a.name] = a;
  for (const [fromName, toName, col] of routes) {
    const a = apMap[fromName], b = apMap[toName];
    if (a && b) {
      f.push(line([[a.lng, a.lat], [b.lng, b.lat]], c(`${fromName} → ${toName}`, col, { _manaWeight: 1.5 })));
    }
  }
  for (const a of airports) f.push(point(a.lng, a.lat, c(a.name, a.color)));
  return f;
}

// ─── MOUNTAINS ──────────────────────────────────────────────
function genMountains() {
  const f = [];
  // Everest Base Camp trek (line)
  f.push(line([[86.7,27.7],[86.8,27.8],[86.85,27.85],[86.9,27.88],[86.92,27.9],[86.95,27.92],[86.98,27.95],[86.9,27.98]],
    c('Everest Base Camp Trek', '#f59e0b', { _manaWeight: 2.5 })));
  const ranges = [
    { name: 'Himalayas', color: '#8b5cf6', coords: [[73,35],[75,36],[78,37],[80,38],[82,38],[85,38],[87,37],[90,36],[92,35],[95,34],[98,33],[100,32]] },
    { name: 'Andes', color: '#22c55e', coords: [[-78,10],[-76,8],[-74,6],[-72,4],[-70,2],[-68,0],[-66,-2],[-64,-4],[-62,-6],[-60,-8],[-58,-10],[-56,-12],[-54,-14],[-52,-16],[-50,-18],[-48,-20],[-46,-22],[-44,-24],[-42,-26],[-40,-28],[-38,-30],[-36,-32],[-34,-34],[-32,-36],[-30,-38],[-28,-40],[-26,-42],[-24,-44],[-22,-46],[-20,-48]] },
    { name: 'Alps', color: '#0ea5e9', coords: [[6,44],[7,45],[8,46],[9,47],[10,47],[11,47],[12,46],[13,46],[14,46],[15,46],[16,46],[17,45]] },
    { name: 'Rockies', color: '#f59e0b', coords: [[-130,60],[-128,58],[-126,56],[-124,54],[-122,52],[-120,50],[-118,48],[-116,46],[-114,44],[-112,42],[-110,40],[-108,38],[-106,36],[-104,34]] },
    { name: 'Caucasus', color: '#ef4444', coords: [[40,41],[42,42],[44,43],[46,43],[48,42],[50,41],[52,40]] },
  ];
  for (const r of ranges) {
    f.push(polygon(r.coords, { ...c(r.name, r.color), fillOpacity: 0.15, _manaWeight: 1.5, markerType: undefined, _manaMarkerType: undefined }));
  }
  const peaks = [
    { name: 'Everest — 8,848m', lat: 27.9, lng: 86.9, color: '#8b5cf6' },
    { name: 'K2 — 8,611m', lat: 35.8, lng: 76.5, color: '#8b5cf6' },
    { name: 'Aconcagua — 6,961m', lat: -32.6, lng: -70, color: '#22c55e' },
    { name: 'Denali — 6,190m', lat: 63, lng: -151, color: '#f59e0b' },
    { name: 'Mont Blanc — 4,809m', lat: 45.8, lng: 6.8, color: '#0ea5e9' },
    { name: 'Elbrus — 5,642m', lat: 43.3, lng: 42.4, color: '#ef4444' },
    { name: 'Kilimanjaro — 5,895m', lat: -3.1, lng: 37.3, color: '#22c55e' },
    { name: 'Matterhorn — 4,478m', lat: 45.9, lng: 7.6, color: '#0ea5e9' },
    { name: 'Fuji — 3,776m', lat: 35.3, lng: 138.7, color: '#f59e0b' },
    { name: 'Mauna Kea — 4,207m', lat: 19.8, lng: -155.4, color: '#0ea5e9' },
    { name: 'Vinson Massif — 4,892m', lat: -78.5, lng: -85.6, color: '#22c55e' },
    { name: 'Kangchenjunga — 8,586m', lat: 27.7, lng: 88.1, color: '#8b5cf6' },
    { name: 'Makalu — 8,485m', lat: 27.8, lng: 87, color: '#8b5cf6' },
    { name: 'Cho Oyu — 8,188m', lat: 28.1, lng: 86.6, color: '#8b5cf6' },
    { name: 'Dhaulagiri — 8,167m', lat: 28.7, lng: 83.5, color: '#8b5cf6' },
  ];
  for (const p of peaks) f.push(point(p.lng, p.lat, c(p.name, p.color)));
  return f;
}

// ─── SHIPPING ───────────────────────────────────────────────
function genShipping() {
  const f = [];
  // Suez Canal transit zone polygon
  f.push(polygon([[32.5,31.5],[33,31.5],[33.5,31],[33.5,30.5],[33,30],[32.5,30],[32,30.5],[32,31],[32.5,31.5]],
    c('Suez Canal Transit Zone', '#f59e0b', { fillOpacity: 0.08, _manaWeight: 1.5, markerType: undefined, _manaMarkerType: undefined })));
  const ports = [
    { name: 'Shanghai', lat: 31.2, lng: 121.4, color: '#0ea5e9' },
    { name: 'Singapore', lat: 1.2, lng: 103.8, color: '#0ea5e9' },
    { name: 'Rotterdam', lat: 51.9, lng: 4.4, color: '#0ea5e9' },
    { name: 'Dubai', lat: 25.2, lng: 55.2, color: '#0ea5e9' },
    { name: 'Busan', lat: 35.1, lng: 129, color: '#0ea5e9' },
    { name: 'Hamburg', lat: 53.5, lng: 9.9, color: '#0ea5e9' },
    { name: 'Los Angeles', lat: 33.7, lng: -118.2, color: '#0ea5e9' },
    { name: 'Hong Kong', lat: 22.3, lng: 114.1, color: '#0ea5e9' },
    { name: 'Antwerp', lat: 51.2, lng: 4.4, color: '#0ea5e9' },
    { name: 'Qingdao', lat: 36, lng: 120.3, color: '#0ea5e9' },
    { name: 'Mumbai', lat: 18.9, lng: 72.8, color: '#0ea5e9' },
    { name: 'Colón (Panama)', lat: 9.3, lng: -79.9, color: '#0ea5e9' },
    { name: 'Port Said', lat: 31.2, lng: 32.3, color: '#0ea5e9' },
    { name: 'Valencia', lat: 39.4, lng: -0.3, color: '#0ea5e9' },
    { name: 'New York/New Jersey', lat: 40.7, lng: -74, color: '#0ea5e9' },
    { name: 'Marseille', lat: 43.3, lng: 5.3, color: '#0ea5e9' },
    { name: ' Santos', lat: -23.9, lng: -46.3, color: '#0ea5e9' },
    { name: 'Colombo', lat: 6.9, lng: 79.8, color: '#0ea5e9' },
  ];
  const routes = [
    ['Shanghai', 'Singapore', '#3b82f6'],
    ['Singapore', 'Dubai', '#3b82f6'],
    ['Dubai', 'Rotterdam', '#3b82f6'],
    ['Shanghai', 'Los Angeles', '#3b82f6'],
    ['Rotterdam', 'New York/New Jersey', '#3b82f6'],
    ['Busan', 'Los Angeles', '#3b82f6'],
    ['Singapore', 'Mumbai', '#3b82f6'],
    ['Mumbai', 'Port Said', '#3b82f6'],
    ['Port Said', 'Valencia', '#3b82f6'],
    ['Hong Kong', 'Singapore', '#3b82f6'],
    ['Qingdao', 'Shanghai', '#3b82f6'],
    ['Colón (Panama)', 'Los Angeles', '#3b82f6'],
    ['Santos', 'Colón (Panama)', '#3b82f6'],
    ['Valencia', 'Antwerp', '#3b82f6'],
    ['Colombo', 'Mumbai', '#3b82f6'],
    ['Marseille', 'Port Said', '#3b82f6'],
    ['Hamburg', 'Rotterdam', '#3b82f6'],
  ];
  const pMap = {};
  for (const p of ports) pMap[p.name] = p;
  for (const [fromName, toName, col] of routes) {
    const a = pMap[fromName], b = pMap[toName];
    if (a && b) {
      f.push(line([[a.lng, a.lat], [b.lng, b.lat]], c(`${fromName} → ${toName}`, col, { _manaWeight: 1.5 })));
    }
  }
  for (const p of ports) f.push(point(p.lng, p.lat, c(p.name, p.color)));
  return f;
}

// ─── DESERTS ────────────────────────────────────────────────
function genDeserts() {
  const f = [];
  // Trans-Saharan trade route (line)
  f.push(line([[-3,16.7],[0,18],[2,19],[5,20],[8,21],[10,22],[12,23],[15,24],[18,24.5],[20,25],[22,26],[25,26.5],[28,27],[30,28],[31.2,30]],
    c('Trans-Saharan Trade Route', '#f59e0b', { _manaWeight: 2 })));
  const deserts = [
    { name: 'Sahara Desert', color: '#f59e0b', coords: [[-5,35],[0,37],[5,38],[10,38],[15,37],[20,36],[25,35],[30,34],[35,33],[40,32],[45,31],[50,30],[55,28],[60,27],[65,26],[70,25],[75,24],[80,23],[85,22],[90,21],[95,20],[100,19],[105,18],[110,17],[115,16],[120,15],[125,14],[125,12],[120,11],[115,12],[110,13],[105,14],[100,15],[95,16],[90,17],[85,18],[80,19],[75,20],[70,21],[65,22],[60,23],[55,24],[50,25],[45,26],[40,27],[35,28],[30,29],[25,30],[20,31],[15,32],[10,33],[5,34],[0,35],[-5,35]] },
    { name: 'Gobi Desert', color: '#ef4444', coords: [[100,45],[105,46],[110,47],[115,48],[120,47],[125,46],[125,45],[120,44],[115,43],[110,42],[105,41],[100,42],[95,43],[100,45]] },
    { name: 'Arabian Desert', color: '#f59e0b', coords: [[35,30],[40,32],[45,32],[50,30],[55,28],[60,25],[60,22],[55,20],[50,18],[45,17],[40,18],[35,20],[30,22],[30,25],[35,30]] },
    { name: 'Kalahari Desert', color: '#22c55e', coords: [[15,-20],[18,-18],[22,-18],[26,-20],[28,-22],[28,-24],[26,-26],[22,-28],[18,-28],[15,-26],[14,-24],[15,-20]] },
    { name: 'Atacama Desert', color: '#8b5cf6', coords: [[-72,-18],[-70,-18],[-68,-20],[-68,-22],[-70,-24],[-72,-24],[-74,-22],[-74,-20],[-72,-18]] },
    { name: 'Great Victoria Desert', color: '#f59e0b', coords: [[130,-26],[133,-25],[136,-26],[138,-28],[136,-30],[133,-31],[130,-30],[128,-28],[130,-26]] },
    { name: 'Mojave Desert', color: '#0ea5e9', coords: [[-119,37],[-117,37],[-115,36],[-114,35],[-115,34],[-117,33],[-119,33],[-120,34],[-119,37]] },
  ];
  for (const d of deserts) {
    f.push(polygon(d.coords, { ...c(d.name, d.color), fillOpacity: 0.12, _manaWeight: 1.5, markerType: undefined, _manaMarkerType: undefined }));
  }
  const oases = [
    { name: 'Cairo', lat: 30, lng: 31.2, color: '#f59e0b' },
    { name: 'Timbuktu', lat: 16.7, lng: -3, color: '#f59e0b' },
    { name: 'Riyadh', lat: 24.6, lng: 46.7, color: '#f59e0b' },
    { name: 'Ulaanbaatar', lat: 47.9, lng: 106.9, color: '#ef4444' },
    { name: 'Gaborone', lat: -24.6, lng: 25.9, color: '#22c55e' },
    { name: 'Calama', lat: -22.4, lng: -68.9, color: '#8b5cf6' },
    { name: 'Alice Springs', lat: -23.7, lng: 133.8, color: '#f59e0b' },
    { name: 'Las Vegas', lat: 36.1, lng: -115.1, color: '#0ea5e9' },
    { name: 'Kharga Oasis', lat: 25.4, lng: 30.5, color: '#f59e0b' },
    { name: 'Siwa Oasis', lat: 29.2, lng: 25.5, color: '#f59e0b' },
    { name: 'Muscat', lat: 23.5, lng: 58.5, color: '#f59e0b' },
    { name: 'Jodhpur', lat: 26.2, lng: 73, color: '#f59e0b' },
    { name: 'Dakhla Oasis', lat: 25.5, lng: 29, color: '#f59e0b' },
    { name: 'Doha', lat: 25.2, lng: 51.5, color: '#f59e0b' },
    { name: 'Kumtag Desert (Dunhuang)', lat: 40.1, lng: 94.6, color: '#ef4444' },
  ];
  for (const o of oases) f.push(point(o.lng, o.lat, c(o.name, o.color)));
  return f;
}

// ─── RAILWAYS ───────────────────────────────────────────────
function genRailways() {
  const f = [];
  // Siberian railway corridor polygon
  f.push(polygon([[30,50],[40,52],[50,54],[60,56],[70,58],[80,60],[90,62],[100,64],[110,66],[120,68],[130,70],[140,72],[150,74],[160,76],[170,78],[180,80],[180,78],[170,76],[160,74],[150,72],[140,70],[130,68],[120,66],[110,64],[100,62],[90,60],[80,58],[70,56],[60,54],[50,52],[40,50],[30,50]],
    c('Trans-Siberian Corridor', '#ef4444', { fillOpacity: 0.06, _manaWeight: 1, markerType: undefined, _manaMarkerType: undefined })));
  const railways = [
    { name: 'Trans-Siberian Railway', color: '#ef4444', coords: [[37.6,55.7],[40,56],[44,57],[48,58],[52,59],[56,60],[60,61],[64,62],[68,63],[72,64],[76,65],[80,66],[84,67],[88,68],[92,69],[96,70],[100,71],[104,72],[108,73],[112,74],[116,75],[120,76],[124,77],[128,78],[132,79],[133,80]] },
    { name: 'Orient Express', color: '#8b5cf6', coords: [[2.3,48.8],[3.5,48.5],[5,48],[7,47],[8.5,47],[10,46],[11,46],[12.5,46],[14,46],[15.5,46],[17,46],[18.5,46],[20,45.5],[21,45],[22.5,44],[24,44],[25.5,44],[27,43.5],[28,43],[28.9,41]] },
    { name: 'Shinkansen (Tokaido)', color: '#0ea5e9', coords: [[139.7,35.6],[139,35.5],[138,35],[137,35],[136,35],[135,35],[134,34.8],[133,34.6],[132,34.5],[131,34.4],[130,34.2],[129,34.2],[128,34]] },
    { name: 'Channel Tunnel (Eurostar)', color: '#3b82f6', coords: [[-0.1,51.5],[0,51.5],[0.5,51.4],[1,51.2],[1.5,51],[2,50.8],[2.5,50.6],[3,50.4],[3.5,50.2],[4,50],[4.5,49.8],[5,49.6],[5.5,49.4],[6,49.2],[6.5,49],[7,48.9],[7.5,48.8],[8,48.9],[8.5,49],[9,49.2]] },
    { name: 'Indian Pacific Railway', color: '#f59e0b', coords: [[138.5,-35],[138,-34],[137,-33],[136,-32],[135,-31],[134,-30],[133,-29],[132,-28],[131,-27],[130,-26],[129,-25],[128,-24],[127,-23],[126,-22],[125,-21],[124,-20],[123,-19],[122,-18],[121,-17],[120,-16],[119,-15],[118,-14],[117,-13],[116,-12],[115,-10]] },
    { name: 'California Zephyr', color: '#22c55e', coords: [[-73.9,40.7],[-74.5,40.5],[-75,40],[-76,39.5],[-77,39],[-78,38.5],[-79,38],[-80,37.5],[-81,37],[-82,36.5],[-83,36],[-84,35.5],[-85,35],[-86,34.5],[-87,34],[-88,33.5],[-89,33],[-90,32.5],[-91,32],[-92,31.5],[-93,31],[-94,30.5]] },
  ];
  for (const r of railways) {
    f.push(line(r.coords, c(r.name, r.color, { _manaWeight: 2.5 })));
  }
  const stations = [
    { name: 'Moscow', lat: 55.7, lng: 37.6, color: '#ef4444' },
    { name: 'Vladivostok', lat: 43.1, lng: 131.8, color: '#ef4444' },
    { name: 'Paris', lat: 48.8, lng: 2.3, color: '#8b5cf6' },
    { name: 'Istanbul', lat: 41, lng: 28.9, color: '#8b5cf6' },
    { name: 'Tokyo', lat: 35.6, lng: 139.7, color: '#0ea5e9' },
    { name: 'Osaka', lat: 34.6, lng: 135.5, color: '#0ea5e9' },
    { name: 'London', lat: 51.5, lng: -0.1, color: '#3b82f6' },
    { name: 'Brussels', lat: 50.8, lng: 4.3, color: '#3b82f6' },
    { name: 'Sydney', lat: -33.8, lng: 151.2, color: '#f59e0b' },
    { name: 'Perth', lat: -31.9, lng: 115.8, color: '#f59e0b' },
    { name: 'New York', lat: 40.7, lng: -73.9, color: '#22c55e' },
    { name: 'San Francisco', lat: 37.7, lng: -122.4, color: '#22c55e' },
    { name: 'Yekaterinburg', lat: 56.8, lng: 60.6, color: '#ef4444' },
    { name: 'Irkutsk', lat: 52.3, lng: 104.3, color: '#ef4444' },
    { name: 'Munich', lat: 48.1, lng: 11.5, color: '#8b5cf6' },
    { name: 'Budapest', lat: 47.5, lng: 19, color: '#8b5cf6' },
    { name: 'Kyoto', lat: 35, lng: 135.7, color: '#0ea5e9' },
    { name: 'Lille', lat: 50.6, lng: 3, color: '#3b82f6' },
    { name: 'Adelaide', lat: -34.9, lng: 138.6, color: '#f59e0b' },
    { name: 'Denver', lat: 39.7, lng: -104.9, color: '#22c55e' },
  ];
  for (const s of stations) f.push(point(s.lng, s.lat, c(s.name, s.color)));
  return f;
}

// ─── CULTURAL REGIONS ───────────────────────────────────────
function genCulturalRegions() {
  const f = [];
  // Silk Road trade route (line)
  f.push(line([[2.1,41.3],[5,41],[8,40.5],[12,40],[15,39.5],[18,39],[20,38.5],[22,38],[25,37.5],[28,37],[30,36.5],[32,36],[35,35.5],[38,35],[40,34.5],[42,34],[45,33.5],[48,33],[50,32.5],[52,32],[55,31.5],[58,31],[60,30.5],[62,30],[65,29.5],[68,29],[70,28.5],[72,28],[75,27.5],[78,27],[80,26.5],[82,26],[85,25.5],[88,25],[90,24.5],[92,24],[95,23.5],[98,23],[100,22.5],[102,22],[104,21.5],[106,21],[108,20.5],[110,20],[112,19.5],[114,19],[116,18.5],[118,18],[120,17.5],[121.4,31.2]],
    c('Silk Road Trade Route', '#f59e0b', { _manaWeight: 2.5 })));
  const regions = [
    { name: 'Mediterranean Basin', color: '#0ea5e9', coords: [[-5,43],[0,44],[5,45],[10,46],[15,47],[20,47],[25,46],[30,44],[35,42],[38,40],[38,38],[35,36],[30,35],[25,34],[20,35],[15,36],[10,37],[5,38],[0,39],[-5,40],[-10,41],[-15,42],[-20,43],[-5,43]] },
    { name: 'Mesoamerica', color: '#22c55e', coords: [[-98,20],[-95,22],[-92,24],[-90,25],[-88,24],[-85,22],[-83,20],[-82,18],[-83,16],[-85,14],[-88,13],[-90,14],[-92,15],[-95,16],[-98,17],[-100,18],[-98,20]] },
    { name: 'Silk Road Region', color: '#f59e0b', coords: [[80,40],[85,42],[90,43],[95,44],[100,45],[105,44],[110,43],[115,42],[120,40],[120,38],[115,37],[110,36],[105,35],[100,34],[95,33],[90,32],[85,33],[80,35],[80,40]] },
    { name: 'Nordic Countries', color: '#8b5cf6', coords: [[5,60],[10,62],[15,64],[20,66],[25,68],[30,70],[35,72],[40,74],[45,76],[50,78],[55,80],[60,82],[65,84],[70,86],[70,84],[65,82],[60,80],[55,78],[50,76],[45,74],[40,72],[35,70],[30,68],[25,66],[20,64],[15,62],[10,60],[5,60]] },
    { name: 'Southeast Asian Maritime', color: '#ef4444', coords: [[100,10],[105,12],[110,14],[115,16],[120,18],[125,18],[130,16],[132,14],[130,12],[125,10],[120,8],[115,6],[110,4],[105,2],[100,0],[95,-2],[100,2],[100,10]] },
    { name: 'Sahara & Sahel', color: '#f59e0b', coords: [[-5,35],[0,37],[5,38],[10,38],[15,37],[20,36],[25,35],[30,34],[35,33],[40,32],[45,31],[50,30],[55,28],[60,27],[65,26],[70,25],[75,24],[80,23],[85,22],[90,21],[95,20],[100,19],[105,18],[110,17],[115,16],[120,15],[125,14],[125,12],[120,11],[115,12],[110,13],[105,14],[100,15],[95,16],[90,17],[85,18],[80,19],[75,20],[70,21],[65,22],[60,23],[55,24],[50,25],[45,26],[40,27],[35,28],[30,29],[25,30],[20,31],[15,32],[10,33],[5,34],[0,35],[-5,35]] },
    { name: 'Indus Valley & Ganges Plain', color: '#22c55e', coords: [[68,35],[72,36],[76,37],[80,38],[84,37],[88,36],[90,34],[90,32],[88,30],[86,28],[84,26],[82,24],[80,22],[78,20],[76,18],[74,17],[72,18],[70,20],[68,22],[66,24],[65,26],[65,28],[68,30],[68,35]] },
  ];
  for (const r of regions) {
    f.push(polygon(r.coords, { ...c(r.name, r.color), fillOpacity: 0.1, _manaWeight: 1.5, markerType: undefined, _manaMarkerType: undefined }));
  }
  const cities = [
    { name: 'Barcelona', lat: 41.3, lng: 2.1, color: '#0ea5e9' },
    { name: 'Athens', lat: 37.9, lng: 23.7, color: '#0ea5e9' },
    { name: 'Rome', lat: 41.9, lng: 12.4, color: '#0ea5e9' },
    { name: 'Mexico City', lat: 19.4, lng: -99.1, color: '#22c55e' },
    { name: 'Samarkand', lat: 39.6, lng: 66.9, color: '#f59e0b' },
    { name: 'Bukhara', lat: 39.7, lng: 64.4, color: '#f59e0b' },
    { name: 'Stockholm', lat: 59.3, lng: 18, color: '#8b5cf6' },
    { name: 'Oslo', lat: 59.9, lng: 10.7, color: '#8b5cf6' },
    { name: 'Bangkok', lat: 13.7, lng: 100.5, color: '#ef4444' },
    { name: 'Manila', lat: 14.5, lng: 121, color: '#ef4444' },
    { name: 'Timbuktu', lat: 16.7, lng: -3, color: '#f59e0b' },
    { name: 'Fez', lat: 34, lng: -5, color: '#f59e0b' },
    { name: 'Varanasi', lat: 25.3, lng: 83, color: '#22c55e' },
    { name: 'Jaipur', lat: 26.9, lng: 75.8, color: '#22c55e' },
    { name: 'Istanbul', lat: 41, lng: 28.9, color: '#0ea5e9' },
    { name: 'Valletta', lat: 35.9, lng: 14.5, color: '#0ea5e9' },
    { name: 'Dubrovnik', lat: 42.6, lng: 18.1, color: '#0ea5e9' },
  ];
  for (const p of cities) f.push(point(p.lng, p.lat, c(p.name, p.color)));
  return f;
}
