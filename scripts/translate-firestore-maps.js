#!/usr/bin/env node
// ── translate-firestore-maps.js ─
// Traduce al español los títulos, descripciones y datos de los mapas en inglés
// almacenados en Firestore (colección 'maps').
//
// Autenticación (dos opciones):
//   1) GOOGLE_APPLICATION_CREDENTIALS → service account JSON
//   2) PUBLISHER_CREDENTIALS → archivo JSON con { email, password, apiKey, projectId }
//      (usa Firebase Auth Identity Toolkit para obtener un ID token)
//
// Uso:
//   node scripts/translate-firestore-maps.js [--dry-run]

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────────────────
const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Auth: Service Account OR Firebase Auth (publisher) ──────────
function loadServiceAccount() {
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credsPath) return null;
  const absPath = path.resolve(credsPath);
  if (!fs.existsSync(absPath)) {
    console.error(`WARN: Service account file not found: ${absPath}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function loadPublisherCredentials() {
  const credsPath = process.env.PUBLISHER_CREDENTIALS;
  if (!credsPath) return null;
  const absPath = path.resolve(credsPath);
  if (!fs.existsSync(absPath)) {
    console.error(`WARN: Publisher credentials file not found: ${absPath}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data, parseError: true }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Firebase Auth Identity Toolkit sign-in → returns idToken
async function firebaseAuthSignIn(email, password, apiKey) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const body = JSON.stringify({ email, password, returnSecureToken: true });
  const res = await httpsRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200) {
    throw new Error(`Firebase Auth sign-in failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
  return res.data.idToken;
}

// Service Account → Google OAuth2 access token
function getAccessTokenFromSA(sa) {
  return new Promise((resolve, reject) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };

    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signInput = `${header}.${body}`;

    const crypto = require('crypto');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signInput);
    const signature = sign.sign(sa.private_key, 'base64url');
    const jwt = `${signInput}.${signature}`;

    const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(jwt)}`;

    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) resolve(parsed.access_token);
          else reject(new Error('Token error: ' + data));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function getAccessToken() {
  // Try service account first
  const sa = loadServiceAccount();
  if (sa) {
    console.log('Using service account authentication.');
    return getAccessTokenFromSA(sa);
  }

  // Fall back to publisher Firebase Auth
  const pub = loadPublisherCredentials();
  if (pub && pub.email && pub.password && pub.apiKey) {
    console.log('Using Firebase Auth (publisher) authentication.');
    return firebaseAuthSignIn(pub.email, pub.password, pub.apiKey);
  }

  console.error('ERROR: No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS (service account) or PUBLISHER_CREDENTIALS (publisher email/password).');
  process.exit(1);
}

// ─── Firestore REST helpers ──────────────────────────────────────
function firestoreRequest(token, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents${urlPath}`;
    const parsedUrl = new URL(url);
    const postData = body ? JSON.stringify(body) : null;

    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data, parseError: true });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function getMapDoc(token, slug) {
  const path = `/${COLLECTION}/${slug}`;
  const res = await firestoreRequest(token, 'GET', path);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`GET ${slug} failed (${res.status}): ${JSON.stringify(res.data)}`);
  return res.data;
}

async function updateMapFields(token, slug, fields) {
  // Firestore REST PATCH with updateMask — each field path must be a separate query param
  const fieldPaths = Object.keys(fields).map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const urlPath = `/${COLLECTION}/${slug}?${fieldPaths}`;

  const body = { fields };
  const res = await firestoreRequest(token, 'PATCH', urlPath, body);
  if (res.status >= 400) {
    throw new Error(`UPDATE ${slug} failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

// ─── Firestore field value helpers ───────────────────────────────
function fsStr(v) { return v != null ? { stringValue: String(v) } : { stringValue: '' }; }
function fsInt(v) { return { integerValue: String(v) }; }
function fsBool(v) { return { booleanValue: !!v }; }
function fsArr(arr) { return { arrayValue: { values: arr.map(v => (typeof v === 'string') ? fsStr(v) : v) } }; }
function fsNull() { return { nullValue: null }; }
function fsMap(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) fields[k] = fsNull();
    else if (typeof v === 'string') fields[k] = fsStr(v);
    else if (typeof v === 'number') fields[k] = Number.isInteger(v) ? fsInt(v) : { doubleValue: v };
    else if (typeof v === 'boolean') fields[k] = fsBool(v);
    else if (Array.isArray(v)) fields[k] = fsArr(v);
    else if (typeof v === 'object') fields[k] = fsMap(v);
    else fields[k] = fsStr(String(v));
  }
  return { mapValue: { fields } };
}

function extractField(doc, fieldName) {
  if (!doc || !doc.fields || !doc.fields[fieldName]) return null;
  const f = doc.fields[fieldName];
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('booleanValue' in f) return f.booleanValue;
  if ('doubleValue' in f) return f.doubleValue;
  if ('arrayValue' in f) return (f.arrayValue.values || []).map(v => {
    if ('stringValue' in v) return v.stringValue;
    if ('mapValue' in v) return v.mapValue.fields;
    return v;
  });
  if ('mapValue' in f) return f.mapValue.fields;
  return null;
}

function extractFirestoreMap(obj) {
  // Recursively convert Firestore map fields to plain JS objects
  if (!obj) return obj;
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if ('stringValue' in v) result[k] = v.stringValue;
    else if ('integerValue' in v) result[k] = Number(v.integerValue);
    else if ('booleanValue' in v) result[k] = v.booleanValue;
    else if ('doubleValue' in v) result[k] = v.doubleValue;
    else if ('arrayValue' in v) result[k] = (v.arrayValue.values || []).map(item => {
      if ('stringValue' in item) return item.stringValue;
      if ('mapValue' in item) return extractFirestoreMap(item.mapValue.fields);
      return item;
    });
    else if ('mapValue' in v) result[k] = extractFirestoreMap(v.mapValue.fields);
    else if ('nullValue' in v) result[k] = null;
    else result[k] = v;
  }
  return result;
}

// ─── Traducciones ───────────────────────────────────────────────

const MAP_TRANSLATIONS = {
  'worst-wildfires-world': {
    title: 'Los peores incendios forestales del mundo',
    description: 'Los incendios forestales más devastadores de la historia registrada, por superficie quemada e impacto humano.',
    lang: 'es',
    featureTranslations: {
      _manaName: {
        '2023 Canadian Wildfires': 'Incendios canadienses de 2023',
        '2024 Pantanal Wildfires': 'Incendios del Pantanal de 2024',
        '2019-20 Australian Bushfires': 'Incendios australianos de 2019-2020',
        '2023 Maui Wildfires': 'Incendios de Maui de 2023',
        '2024 Smokehouse Creek Fire': 'Incendio de Smokehouse Creek de 2024',
        '2025 Los Angeles Wildfires': 'Incendios de Los Ángeles de 2025',
        '2023 Chilean Wildfires': 'Incendios chilenos de 2023',
        '2021 Turkey Wildfires': 'Incendios de Turquía de 2021',
        '2021 Greece Wildfires': 'Incendios de Grecia de 2021',
        '2022 European Wildfires': 'Incendios europeos de 2022',
        '2023 Siberian Wildfires': 'Incendios siberianos de 2023',
        '2019 Amazon Wildfires': 'Incendios amazónicos de 2019',
        '2018 Camp Fire': 'Incendio Camp Fire de 2018',
        '2009 Black Saturday': 'Sábado Negro de 2009',
        '2018 Attica Wildfires': 'Incendios de Ática de 2018',
        '2024 Bolivia Wildfires': 'Incendios de Bolivia de 2024',
        '2025 Iberian Wildfires': 'Incendios ibéricos de 2025',
        '2023 Algeria Wildfires': 'Incendios de Argelia de 2023',
        '2024 Amazon Drought Wildfires': 'Incendios por sequía amazónica de 2024',
        '2024 Colombia Wildfires': 'Incendios de Colombia de 2024',
      },
      name: {
        '2023 Canadian Wildfires': 'Incendios canadienses de 2023',
        '2024 Pantanal Wildfires': 'Incendios del Pantanal de 2024',
        '2019-20 Australian Bushfires': 'Incendios australianos de 2019-2020',
        '2023 Maui Wildfires': 'Incendios de Maui de 2023',
        '2024 Smokehouse Creek Fire': 'Incendio de Smokehouse Creek de 2024',
        '2025 Los Angeles Wildfires': 'Incendios de Los Ángeles de 2025',
        '2023 Chilean Wildfires': 'Incendios chilenos de 2023',
        '2021 Turkey Wildfires': 'Incendios de Turquía de 2021',
        '2021 Greece Wildfires': 'Incendios de Grecia de 2021',
        '2022 European Wildfires': 'Incendios europeos de 2022',
        '2023 Siberian Wildfires': 'Incendios siberianos de 2023',
        '2019 Amazon Wildfires': 'Incendios amazónicos de 2019',
        '2018 Camp Fire': 'Incendio Camp Fire de 2018',
        '2009 Black Saturday': 'Sábado Negro de 2009',
        '2018 Attica Wildfires': 'Incendios de Ática de 2018',
        '2024 Bolivia Wildfires': 'Incendios de Bolivia de 2024',
        '2025 Iberian Wildfires': 'Incendios ibéricos de 2025',
        '2023 Algeria Wildfires': 'Incendios de Argelia de 2023',
        '2024 Amazon Drought Wildfires': 'Incendios por sequía amazónica de 2024',
        '2024 Colombia Wildfires': 'Incendios de Colombia de 2024',
      },
      Location: {
        'Canada': 'Canadá',
        'Brazil': 'Brasil',
        'Australia': 'Australia',
        'Hawaii, USA': 'Hawái, EE.UU.',
        'Texas, USA': 'Texas, EE.UU.',
        'California, USA': 'California, EE.UU.',
        'Chile': 'Chile',
        'Turkey': 'Turquía',
        'Greece': 'Grecia',
        'Europe (Portugal, Spain, France)': 'Europa (Portugal, España, Francia)',
        'Siberia, Russia': 'Siberia, Rusia',
        'Amazon, Brazil': 'Amazonia, Brasil',
        'Victoria, Australia': 'Victoria, Australia',
        'Attica, Greece': 'Ática, Grecia',
        'Bolivia': 'Bolivia',
        'Spain/Portugal': 'España/Portugal',
        'Algeria': 'Argelia',
        'Colombia': 'Colombia',
      },
      Deaths: {},  // Keep numeric values as-is
      Area: {},    // Keep as-is
      Year: {},    // Keep as-is
      Description: {
        'Record-breaking fire season across all 13 provinces. Massive smoke plumes reached Europe and the US. Over 200,000 people evacuated.': 'Temporada de incendios récord en las 13 provincias. Enormes columnas de humo alcanzaron Europa y EE.UU. Más de 200.000 personas evacuadas.',
        'Unprecedented fires devastated the world\'s largest tropical wetland. Devastating impact on jaguar populations and unique biodiversity.': 'Incendios sin precedentes devastaron el mayor humedal tropical del mundo. Impacto devastador en las poblaciones de jaguares y la biodiversidad única.',
        'Known as Black Summer. Killed or displaced nearly 3 billion animals. Smoke circled the globe. An estimated 445 people died from smoke inhalation.': 'Conocido como el Verano Negro. Mató o desplazó a casi 3.000 millones de animales. El humo dio la vuelta al mundo. Se estima que 445 personas murieron por inhalación de humo.',
        'Deadliest US wildfire in over a century. The historic town of Lahaina was nearly destroyed. Winds from Hurricane Dora fueled the flames.': 'El incendio forestal más mortífero en EE.UU. en más de un siglo. La histórica ciudad de Lahaina fue casi destruida. Vientos del huracán Dora alimentaron las llamas.',
        'Largest wildfire in Texas history. Burned across the Panhandle in extreme drought and high winds. Caused massive livestock losses.': 'El mayor incendio forestal en la historia de Texas. Arrasó el Panhandle con sequía extrema y vientos fuertes. Causó enormes pérdidas de ganado.',
        'Major firestorm in the LA basin. Driven by extreme Santa Ana winds and prolonged drought. Extensive destruction of urban areas and hillside communities.': 'Gran tormenta de fuego en la cuenca de Los Ángeles. Impulsada por vientos Santa Ana extremos y sequía prolongada. Destrucción extensa de zonas urbanas y comunidades en las colinas.',
        'Record heatwave and drought created conditions for massive fires in the Biobío and Araucanía regions. Destroyed hundreds of homes.': 'Ola de calor récord y sequía crearon condiciones para incendios masivos en las regiones del Biobío y la Araucanía. Destruyeron cientos de viviendas.',
        'Worst wildfires in modern Turkish history. Intense heatwave with temperatures above 45°C. Coastal resorts evacuated. Tourism severely impacted.': 'Peores incendios forestales en la historia moderna de Turquía. Intensa ola de calor con temperaturas superiores a 45 °C. Estaciones costeras evacuadas. Turismo gravemente afectado.',
        'Devastating fires on Evia island and the Peloponnese. Prime Minister called it a \'natural disaster of unprecedented proportions\'. Ancient olive groves destroyed.': 'Incendios devastadores en la isla de Evia y el Peloponeso. El primer ministro lo calificó de "desastre natural de proporciones sin precedentes". Antiguos olivares destruidos.',
        'Europe\'s worst fire season. Record temperatures of 47°C in Portugal. France saw massive fires in Gironde. UK hit 40°C for the first time.': 'La peor temporada de incendios en Europa. Temperaturas récord de 47 °C en Portugal. Francia sufrió incendios masivos en Gironde. El Reino Unido alcanzó los 40 °C por primera vez.',
        'Massive boreal forest fires in the Sakha Republic and Irkutsk regions. Released record amounts of carbon. Permafrost thaw accelerated by the fires.': 'Incendios masivos de bosque boreal en la República de Sajá y las regiones de Irkutsk. Liberaron cantidades récord de carbono. El deshielo del permafrost se aceleró por los incendios.',
        'Global outcry as fires raged across the \'lungs of the planet\'. São Paulo went dark in the afternoon from smoke. International aid was offered.': 'Indignación mundial cuando los incendios arrasaron los "pulmones del planeta". São Paulo quedó a oscuras por la tarde a causa del humo. Se ofreció ayuda internacional.',
        'Most destructive wildfire in California history. The town of Paradise was completely destroyed. Entire communities vanished in hours.': 'El incendio forestal más destructivo en la historia de California. La ciudad de Paradise fue completamente destruida. Comunidades enteras desaparecieron en horas.',
        'Australia\'s deadliest natural disaster of the modern era. Temperatures reached 46.4°C. Fire tornadoes formed. Whole towns were incinerated.': 'La catástrofe natural más mortal de Australia en la era moderna. Las temperaturas alcanzaron los 46,4 °C. Se formaron tornados de fuego. Pueblos enteros fueron incinerados.',
        'Second-deadliest wildfire of the 21st century. Victims trapped by the sea near Mati resort. Many drowned trying to escape the flames.': 'El segundo incendio forestal más mortal del siglo XXI. Víctimas atrapadas por el mar cerca del complejo de Mati. Muchos se ahogaron intentando escapar de las llamas.',
        'Unprecedented fires in the Santa Cruz and Beni regions. Smoke plumes visible from space. State of emergency declared. Wildlife rescue efforts overwhelmed.': 'Incendios sin precedentes en las regiones de Santa Cruz y Beni. Columnas de humo visibles desde el espacio. Estado de emergencia declarado. Esfuerzos de rescate de fauna silvestre abrumados.',
        'Severe fires across the Iberian Peninsula. Intense heatwave and dry conditions. Affected natural parks in Spain and central Portugal.': 'Incendios severos en toda la península ibérica. Intensa ola de calor y condiciones secas. Afectaron parques naturales en España y centro de Portugal.',
        'Deadly wildfires in Kabylie and Bejaia regions. Entire villages evacuated. Strong winds spread flames rapidly through mountainous terrain.': 'Incendios mortales en las regiones de Cabilia y Bejaia. Aldeas enteras evacuadas. Vientos fuertes propagaron las llamas rápidamente por el terreno montañoso.',
        'Severe drought in the Amazon basin led to widespread fires. River levels at historic lows. Manaus choked under thick smoke for weeks.': 'Sequía severa en la cuenca amazónica provocó incendios generalizados. Niveles de los ríos en mínimos históricos. Manaus sofocada bajo humo denso durante semanas.',
        'Numerous fires in the Andes and Amazon regions. Bogotá declared a disaster. The El Niño phenomenon exacerbated the dry conditions.': 'Numerosos incendios en las regiones andinas y amazónicas. Bogotá declaró desastre. El fenómeno de El Niño agravó las condiciones de sequía.',
      },
    }
  },

  'active-volcanoes-world': {
    title: 'Volcanes activos del mundo',
    description: 'Volcanes activos con erupciones del Holoceno o históricas alrededor del planeta.',
    lang: 'es',
    featureTranslations: {
      // Volcano names are proper nouns — keep as-is
      _manaName: {},
      name: {},
      Country: {
        'USA (Hawaii)': 'EE.UU. (Hawái)',
        'USA (Washington)': 'EE.UU. (Washington)',
        'USA (California)': 'EE.UU. (California)',
        'USA (Wyoming)': 'EE.UU. (Wyoming)',
        'USA (Alaska)': 'EE.UU. (Alaska)',
        'USA (Aleutians)': 'EE.UU. (Islas Aleutianas)',
        'Mexico': 'México',
        'Guatemala': 'Guatemala',
        'Costa Rica': 'Costa Rica',
        'Nicaragua': 'Nicaragua',
        'Colombia': 'Colombia',
        'Ecuador': 'Ecuador',
        'Peru': 'Perú',
        'Chile': 'Chile',
        'Iceland': 'Islandia',
        'Italy': 'Italia',
        'Greece': 'Grecia',
        'DR Congo': 'Rep. Dem. del Congo',
        'Ethiopia': 'Etiopía',
        'Tanzania': 'Tanzania',
        'Cameroon': 'Camerún',
        'Réunion': 'Reunión',
        'Spain (Canary Is.)': 'España (Islas Canarias)',
        'Spain (La Palma)': 'España (La Palma)',
        'Yemen': 'Yemen',
        'Saudi Arabia': 'Arabia Saudita',
        'Russia (Kamchatka)': 'Rusia (Kamchatka)',
        'Russia (Kuril Is.)': 'Rusia (Islas Kuriles)',
        'Japan': 'Japón',
        'Philippines': 'Filipinas',
        'Indonesia (Java)': 'Indonesia (Java)',
        'Indonesia (Sunda Strait)': 'Estrecho de la Sonda, Indonesia',
        'Indonesia (Sumatra)': 'Indonesia (Sumatra)',
        'Indonesia (Bali)': 'Indonesia (Bali)',
        'Indonesia (Lombok)': 'Indonesia (Lombok)',
        'Indonesia (Halmahera)': 'Indonesia (Halmahera)',
        'Indonesia (Sangihe)': 'Indonesia (Sangihe)',
        'New Zealand': 'Nueva Zelanda',
        'Papua New Guinea': 'Papúa Nueva Guinea',
        'Vanuatu': 'Vanuatu',
        'Antarctica': 'Antártida',
      },
      Type: {
        'Shield volcano': 'Volcán en escudo',
        'Stratovolcano': 'Estratovolcán',
        'Caldera': 'Caldera',
        'Lava dome': 'Domo de lava',
        'Complex volcano': 'Volcán complejo',
        'Subglacial volcano': 'Volcán subglacial',
        'Somma volcano': 'Volcán Somma',
        'Volcanic field': 'Campo volcánico',
        'Fissure vent': 'Fisura volcánica',
        'Lava cone': 'Cono de lava',
      },
      Description: {},  // Descriptions are dynamically generated; translate at runtime
      Last_Eruption: {},
      Elevation: {},
    }
  },

  'highest-peaks-per-continent': {
    title: 'Punto más alto de cada continente',
    description: 'La montaña más alta de cada uno de los siete continentes — el reto de las Siete Cumbres.',
    lang: 'es',
    featureTranslations: {
      _manaName: {},  // Proper nouns
      name: {},
      Continent: {
        'Asia': 'Asia',
        'South America': 'Sudamérica',
        'North America': 'Norteamérica',
        'Africa': 'África',
        'Europe': 'Europa',
        'Oceania': 'Oceanía',
        'Antarctica': 'Antártida',
      },
      Country: {
        'Nepal / China': 'Nepal / China',
        'Argentina': 'Argentina',
        'USA (Alaska)': 'EE.UU. (Alaska)',
        'Tanzania': 'Tanzania',
        'Russia': 'Rusia',
        'Indonesia (Papua)': 'Indonesia (Papúa)',
        'Antarctica': 'Antártida',
      },
      Range: {
        'Himalayas': 'Himalaya',
        'Andes': 'Andes',
        'Alaska Range': 'Cordillera de Alaska',
        'Kilimanjaro': 'Kilimanjaro',
        'Caucasus Mountains': 'Montañas del Cáucaso',
        'Maoke Mountains': 'Montañas Maoke',
        'Sentinel Range': 'Cordillera Sentinel',
      },
      Description: {
        'Mount Everest (Nepal / China), 8,849 m. The highest point on Earth. First summited by Edmund Hillary and Tenzing Norgay in 1953.': 'Monte Everest (Nepal / China), 8.849 m. El punto más alto de la Tierra. Fue escalado por primera vez por Edmund Hillary y Tenzing Norgay en 1953.',
        'Aconcagua (Argentina), 6,961 m. The highest peak outside Asia and the tallest in the Western Hemisphere.': 'Aconcagua (Argentina), 6.961 m. El pico más alto fuera de Asia y el más elevado del hemisferio occidental.',
        'Denali (USA, Alaska), 6,190 m. The highest peak in North America, formerly known as Mount McKinley.': 'Denali (EE.UU., Alaska), 6.190 m. El pico más alto de Norteamérica, conocido anteriormente como monte McKinley.',
        'Kilimanjaro (Tanzania), 5,895 m. Africa\'s tallest mountain and the world\'s highest free-standing volcano.': 'Kilimanjaro (Tanzania), 5.895 m. La montaña más alta de África y el volcán independiente más alto del mundo.',
        'Mount Elbrus (Russia), 5,642 m. The highest peak in Europe, a dormant double-peaked stratovolcano in the Caucasus.': 'Monte Elbrus (Rusia), 5.642 m. El pico más alto de Europa, un estratovolcán dormido de doble cima en el Cáucaso.',
        'Puncak Jaya (Indonesia), 4,884 m. The highest summit in Oceania and one of the Seven Summits.': 'Puncak Jaya (Indonesia), 4.884 m. La cima más alta de Oceanía y una de las Siete Cumbres.',
        'Vinson Massif (Antarctica), 4,892 m. The highest peak in Antarctica, located in the remote Sentinel Range.': 'Macizo Vinson (Antártida), 4.892 m. El pico más alto de la Antártida, ubicado en la remota cordillera Sentinel.',
      },
    }
  },

  'major-deserts-world': {
    title: 'Principales desiertos del mundo',
    description: 'Los 15 desiertos más grandes del planeta, desde el Sahara hasta la Antártida, con superficie y datos clave.',
    lang: 'es',
    featureTranslations: {
      _manaName: {
        'Sahara': 'Sahara',
        'Arabian Desert': 'Desierto arábigo',
        'Gobi Desert': 'Desierto de Gobi',
        'Kalahari Desert': 'Desierto del Kalahari',
        'Patagonian Desert': 'Desierto patagónico',
        'Great Victoria Desert': 'Gran Desierto de Victoria',
        'Syrian Desert': 'Desierto sirio',
        'Great Basin Desert': 'Gran Cuenca',
        'Chihuahuan Desert': 'Desierto de Chihuahua',
        'Karakum Desert': 'Desierto de Kara-Kum',
        'Kyzylkum Desert': 'Desierto de Kyzyl-Kum',
        'Thar Desert': 'Desierto de Thar',
        'Sonoran Desert': 'Desierto de Sonora',
        'Antarctic Desert': 'Desierto antártico',
        'Simpson Desert': 'Desierto de Simpson',
      },
      name: {
        'Sahara': 'Sahara',
        'Arabian Desert': 'Desierto arábigo',
        'Gobi Desert': 'Desierto de Gobi',
        'Kalahari Desert': 'Desierto del Kalahari',
        'Patagonian Desert': 'Desierto patagónico',
        'Great Victoria Desert': 'Gran Desierto de Victoria',
        'Syrian Desert': 'Desierto sirio',
        'Great Basin Desert': 'Gran Cuenca',
        'Chihuahuan Desert': 'Desierto de Chihuahua',
        'Karakum Desert': 'Desierto de Kara-Kum',
        'Kyzylkum Desert': 'Desierto de Kyzyl-Kum',
        'Thar Desert': 'Desierto de Thar',
        'Sonoran Desert': 'Desierto de Sonora',
        'Antarctic Desert': 'Desierto antártico',
        'Simpson Desert': 'Desierto de Simpson',
      },
      Continent: {
        'Africa': 'África',
        'Asia': 'Asia',
        'South America': 'Sudamérica',
        'Australia': 'Australia',
        'North America': 'Norteamérica',
        'Antarctica': 'Antártida',
      },
      Type: {
        'Hot': 'Cálido',
        'Cold': 'Frío',
      },
      Countries: {},  // Keep as-is (proper nouns of countries)
      Area: {},        // Keep as-is (numeric)
      Description: {
        'The largest hot desert on Earth. Covers most of North Africa. Extreme temperatures can exceed 50°C. Home to sparse oasis settlements.': 'El desierto cálido más grande de la Tierra. Cubre la mayor parte del norte de África. Temperaturas extremas que pueden superar los 50 °C. Hogar de asentamientos oásiticos dispersos.',
        'Includes the Rub\' al Khali (Empty Quarter), the largest contiguous sand body on Earth. Rich in petroleum reserves.': 'Incluye el Rub\' al Khali (El Cuarto Vacío), la mayor masa de arena continua de la Tierra. Rico en reservas de petróleo.',
        'A cold desert spanning southern Mongolia and northern China. Part of the ancient Silk Road. Famous for dinosaur fossil discoveries.': 'Un desierto frío que se extiende por el sur de Mongolia y el norte de China. Parte de la antigua Ruta de la Seda. Famoso por descubrimientos de fósiles de dinosaurios.',
        'A semi-arid sandy savanna covering much of Botswana. Home to the San people and diverse wildlife including meerkats and brown hyenas.': 'Una sabana semiárida y arenosa que cubre gran parte de Botsuana. Hogar del pueblo San y una diversa fauna silvestre que incluye suricatas y chacales pardos.',
        'The largest desert in the Americas. Formed by the Andes rain shadow. Rich in dinosaur fossils and steppe wildlife.': 'El desierto más grande de las Américas. Formado por la sombra pluviométrica de los Andes. Rico en fósiles de dinosaurios y fauna esteparia.',
        'Australia\'s largest desert. Features sand dunes, grasslands, and salt lakes. A protected wilderness area.': 'El desierto más grande de Australia. Presenta dunas de arena, praderas y lagos salados. Una área silvestre protegida.',
        'A barren plateau bridging the Fertile Crescent. Historically vital as a caravan route connecting Mesopotamia to the Mediterranean.': 'Un meseta estéril que conecta la Media Luna Fértil. Históricamente vital como ruta de caravanas que conectaba Mesopotamia con el Mediterráneo.',
        'The largest desert in the US. Named for the enclosed drainage basins. Features sagebrush steppe and Great Salt Lake.': 'El desierto más grande de EE.UU. Nombrado por las cuencas endorreicas. Presenta estepa de artemisa y el Gran Lago Salado.',
        'The most biologically diverse desert in North America. Known for agave, yucca, and the Mexican wolf habitat.': 'El desierto con mayor biodiversidad biológica de Norteamérica. Conocido por sus agaves, yucas y el hábitat del lobo mexicano.',
        'Covers 70% of Turkmenistan. Home to the Darvaza gas crater, the \'Door to Hell,\' burning since 1971.': 'Cubre el 70% de Turkmenistán. Hogar del cráter de gas de Darvaza, la "Puerta del Infierno", ardiendo desde 1971.',
        'Located between the Amu Darya and Syr Darya rivers. The ancient Zoroastrian fire temple of Chilpyk stands in its midst.': 'Ubicado entre los ríos Amu Daria y Syr Daria. El antiguo templo zoroástrico de fuego de Chilpyk se erige en su interior.',
        'The most densely populated desert in the world. Rich cultural heritage with vibrant festivals and colorful textiles.': 'El desierto más densamente poblado del mundo. Rico patrimonio cultural con festivales vibrantes y textiles coloridos.',
        'Known for its iconic saguaro cacti. Spans Arizona, California, and Sonora. Two rainy seasons support rich biodiversity.': 'Conocido por sus icónicos cactus saguaro. Se extiende por Arizona, California y Sonora. Dos temporadas de lluvias sustentan una rica biodiversidad.',
        'The largest desert on Earth by area. Receives less than 50mm of precipitation per year. 98% covered by ice sheet averaging 2,160 m thick.': 'El desierto más grande de la Tierra por superficie. Recibe menos de 50 mm de precipitación al año. 98% cubierto por una capa de hielo de 2.160 m de espesor medio.',
        'Famous for its long parallel sand dunes, the longest parallel dunes on Earth. Named after Alfred Simpson.': 'Famoso por sus largas dunas de arena paralelas, las dunas paralelas más largas del mundo. Nombrado en honor a Alfred Simpson.',
      },
    }
  },

  'minimum-wage-by-country': {
    title: 'Salario Mínimo por País',
    description: 'Comparación del salario mínimo anual en dólares de 162 países del mundo, con datos del Banco Mundial.',
    lang: 'es',
    featureTranslations: {},  // Country names are proper nouns; already in Spanish
  },

  'submarine-fiber-cables': {
    title: 'Cables de Fibra Óptica Submarina',
    description: 'Principales cables de fibra óptica submarina y sus puntos de aterrizaje publicados. Los colores indican el año de puesta en servicio.',
    lang: 'es',
    featureTranslations: {},  // Cable names are proper nouns; _countriesES already exists
  },
};

// ─── Translate description for volcanoes (dynamic pattern) ───────
function translateVolcanoDescription(volcanoName, country, type, elevation, lastEruption) {
  const countryEs = MAP_TRANSLATIONS['active-volcanoes-world'].featureTranslations.Country[country] || country;
  const typeEs = MAP_TRANSLATIONS['active-volcanoes-world'].featureTranslations.Type[type] || type;
  return `${volcanoName} (${countryEs}), ${typeEs} de ${elevation} m de altitud. Última erupción registrada en ${lastEruption}.`;
}

// ─── Translate a GeoJSON feature's properties ────────────────────
function translateFeatureProperties(props, translations) {
  if (!props || !translations) return props;
  const result = { ...props };
  for (const [key, mapping] of Object.entries(translations)) {
    if (key === '_manaName' || key === 'name') {
      const val = result[key] || result['name'] || result['_manaName'];
      if (val && mapping[val]) {
        result[key] = mapping[val];
        // Keep _manaName and name in sync
        if (key === '_manaName' && result['name']) result['name'] = mapping[val] || result['name'];
        if (key === 'name' && result['_manaName']) result['_manaName'] = mapping[val] || result['_manaName'];
      }
    } else if (result[key] && mapping[result[key]]) {
      result[key] = mapping[result[key]];
    }
  }
  return result;
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== translate-firestore-maps.js ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);
  console.log(`Project: ${PROJECT_ID}\n`);

  const token = await getAccessToken();
  console.log('Access token obtained.\n');

  let totalUpdated = 0;
  let totalErrors = 0;

  for (const [slug, translation] of Object.entries(MAP_TRANSLATIONS)) {
    console.log(`── ${slug} ──`);

    // 1. Get current document
    let doc;
    try {
      doc = await getMapDoc(token, slug);
    } catch (e) {
      console.error(`  ERROR reading: ${e.message}`);
      totalErrors++;
      continue;
    }
    if (!doc) {
      console.log('  SKIP: document not found');
      continue;
    }

    // 2. Build update payload
    const updateFields = {};

    // Title
    if (translation.title) {
      updateFields.title = fsStr(translation.title);
    }

    // Description
    if (translation.description) {
      updateFields.description = fsStr(translation.description);
    }

    // Language
    if (translation.lang) {
      updateFields.lang = fsStr(translation.lang);
    }

    // GeoJSON feature translations (requires updating geojsonText)
    const currentGeoText = extractField(doc, 'geojsonText');
    if (currentGeoText && translation.featureTranslations && Object.keys(translation.featureTranslations).length > 0) {
      try {
        const geo = JSON.parse(currentGeoText);
        if (geo && geo.features) {
          let changed = false;
          geo.features.forEach(feature => {
            if (!feature.properties) return;
            const originalProps = JSON.stringify(feature.properties);
            feature.properties = translateFeatureProperties(feature.properties, translation.featureTranslations);
            // For volcano descriptions: regenerate dynamically
            if (slug === 'active-volcanoes-world' && feature.properties._manaName) {
              const country = feature.properties.Country || '';
              const type = feature.properties.Type || '';
              const elevation = feature.properties.Elevation || '';
              const lastEruption = feature.properties.Last_Eruption || '';
              const volcName = feature.properties._manaName;
              feature.properties.Description = translateVolcanoDescription(volcName, country, type, elevation, lastEruption);
            }
            if (JSON.stringify(feature.properties) !== originalProps) changed = true;
          });
          if (changed) {
            const newGeoText = JSON.stringify(geo);
            updateFields.geojsonText = fsStr(newGeoText);
          }
        }
      } catch (e) {
        console.warn(`  WARN: Could not parse/translate geojsonText: ${e.message}`);
      }
    }

    // Also update mapPreview with translated names
    const currentPreview = extractField(doc, 'mapPreview');
    if (currentPreview && translation.featureTranslations && Object.keys(translation.featureTranslations).length > 0) {
      // mapPreview doesn't contain names, only geometry + color, so skip
    }

    if (Object.keys(updateFields).length === 0) {
      console.log('  SKIP: no changes needed');
      continue;
    }

    console.log(`  Fields to update: ${Object.keys(updateFields).join(', ')}`);

    if (DRY_RUN) {
      console.log('  DRY RUN — skipping write');
      totalUpdated++;
      continue;
    }

    // 3. Write update
    try {
      await updateMapFields(token, slug, updateFields);
      console.log('  UPDATED ✓');
      totalUpdated++;
    } catch (e) {
      console.error(`  ERROR updating: ${e.message}`);
      totalErrors++;
    }
  }

  console.log(`\n=== Done: ${totalUpdated} updated, ${totalErrors} errors ===\n`);
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
