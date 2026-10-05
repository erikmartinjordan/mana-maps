#!/usr/bin/env node
// ── audit-gallery-quality.js ─
// Valida los mapas isPublished de Firestore contra AGENTS.md §Estándar de
// publicación y corrige en Firestore lo que se pueda de forma segura.
//
// Comprobaciones (BACKLOG 03-10 / 03-10 popups / 05-10 paleta §3):
//   1. dataSource y dataDate no vacíos
//   2. featureCount coherente con la longitud real de geojsonText.features
//   3. coordenadas dentro de ±180 (lon) / ±90 (lat)
//   4. colores hex válidos (_manaColor de cada feature)
//   5. tags presentes (array no vacío)
//   6. lang = 'es'
//   7. popups con información real (AGENTS.md §5): cada feature debe mostrar
//      datos concretos, no solo el nombre. Claves de estilo/internas
//      (_mana*, color, markerType, fillOpacity…) no cuentan como datos.
//   8. paleta semántica (AGENTS.md §3):
//      - Coropletas (legendKey + ≥5 pares numéricos no grises): rampa
//        secuencial monocromática (span de tono ≤ 60°), ordenada por el dato
//        de claro→oscuro (Spearman rho ≤ -0.65 entre valor y luminancia) y
//        borde blanco fino en los polígonos de datos.
//      - Resto de mapas: prohibida la paleta arcoíris (≥4 tonos saturados con
//        span > 150°). Fix automático con color semántico único por slug
//        (SEMANTIC_COLOR_BY_SLUG), patrón de la galería para colecciones.
//
// Correcciones automáticas seguras:
//   - lang distinto de 'es' o ausente → 'es'
//   - featureCount ausente o incoherente → recomputado del GeoJSON
//   - dataSource/dataDate/tags vacíos → tabla KNOWN_META (fuentes autoritativas)
//   - hex corto #RGB / #RGBA → #RRGGBB; rgb()/rgba() → #RRGGBB
//   - longitud fuera de ±180 → envuelta al rango (x±360)
//   - features sin datos de popup → completadas con POPUP_FIX_DATA (§5)
//   - coropleta fuera de norma §3 → rampa mono recomputada por cuantiles del
//     dato (se preserva el gris «sin datos» y el tono dominante existente) +
//     borde blanco fino
//   - colección con paleta arcoíris → color semántico único del slug
// Lo demás (latitud fuera de ±90, colores no convertibles, metadatos
// desconocidos, popups sin fix conocido, arcoíris sin slug en la tabla) se
// reporta como MANUAL y NO se toca.
//
// Uso:
//   node scripts/audit-gallery-quality.js [--dry-run] [--verbose]

'use strict';

const { getAccessToken, firestoreRequest, COLLECTION, fsStr, fsInt, fsArr } = require('./lib/publisher');

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');
const MAX_DOC_BYTES = 1024 * 1024; // Firestore limit 1 MiB

// ── Metadatos autoritativos de respaldo (solo se usan si el campo está vacío) ──
// Fuentes citadas según AGENTS.md y scripts de publicación del repo.
const KNOWN_META = {
  'active-volcanoes-world': {
    dataSource: 'Smithsonian Institution — Global Volcanism Program (volcano.si.edu). Geometrías: Natural Earth.',
    dataDate: '2026-01-01',
    tags: ['Naturaleza', 'Volcanes', 'Geología'],
  },
  'arrecifes-de-coral-fosas-oceanicas-y-naufragios-famosos-3172026-1785478772912': {
    dataSource: 'GEBCO / IHO (bathymetría y límites oceánicos). Geometrías: Natural Earth.',
    dataDate: '2024',
    tags: ['Naturaleza', 'Océanos'],
  },
  'ciudades-perdidas-y-ruinas-arqueologicas-fascinantes-3072026-1785391217436': {
    dataSource: 'UNESCO / Composición propia a partir de fuentes arqueológicas públicas.',
    dataDate: '2026',
    tags: ['Historia', 'Geografía'],
  },
  'fertility-rate-world': {
    dataSource: 'World Bank / UN Population Division (data.worldbank.org)',
    dataDate: '2024-01-01',
    tags: ['Demografía', 'Población', 'Geografía'],
  },
  'highest-peaks-per-continent': {
    dataSource: 'Natural Earth (geometrías) + elevaciones de picos según SRTM/USGS y Natural Earth.',
    dataDate: '2024-01-01',
    tags: ['Naturaleza', 'Montañas', 'Geografía'],
  },
  'indice-desarrollo-humano-por-pais': {
    dataSource: 'UNDP Human Development Report 2025 — Statistical Annex HDI Table (datos 2023). https://hdr.undp.org/data-center/human-development-index',
    dataDate: '2025-05-06',
    tags: ['Desarrollo', 'Economía', 'Geografía'],
  },
  'largest-islands-world': {
    dataSource: 'Natural Earth 50m (geometría de islas) + Wikipedia (superficie y población)',
    dataDate: '2026-09',
    tags: ['Geografía', 'Naturaleza', 'Islas', 'Océanos'],
  },
  'literacy-rate-world': {
    dataSource: 'UNESCO Institute for Statistics / World Bank — Literacy rate, adult total (% of people ages 15 and above). Indicator SE.ADT.LITR.ZS. https://data.worldbank.org/indicator/SE.ADT.LITR.ZS',
    dataDate: '2023-12-31',
    tags: ['Educación', 'Población', 'Desarrollo'],
  },
  'longest-rivers-world': {
    dataSource: 'Natural Earth 50m rivers_lake_centerlines (naturalearthdata.com)',
    dataDate: '2024-12-01',
    tags: ['Geografía', 'Hidrografía', 'Naturaleza'],
  },
  'major-deserts-world': {
    dataSource: 'Natural Earth (geometrías de desiertos) + datos climáticos de fuentes públicas.',
    dataDate: '2024-01-01',
    tags: ['Geografía', 'Naturaleza', 'Clima'],
  },
  'minimum-wage-by-country': {
    dataSource: 'OIT/ILOSTAT (statutory nominal gross monthly minimum wage, Dec 2024) + WageIndicator Minimum Wage Database Dec 2024 + Banco Mundial WDI PA.NUS.FCRF tipo de cambio oficial 2024 (LCU/USD)',
    dataDate: '2024-12-01',
    tags: ['Economía', 'Trabajo', 'Países'],
  },
  'oceans-and-seas-world': {
    dataSource: 'Natural Earth 1:50m geography marine polys (dominio público); límites IHO S-23',
    dataDate: '2024-01-01',
    tags: ['Geografía', 'Océanos', 'Naturaleza'],
  },
  'patrimonio-unesco-por-pais': {
    dataSource: 'UNESCO World Heritage Centre — IHP-WINS World Heritage Site List 2025 (DOI: 10.63253/qblhcalw). 1.248 sitios inscritos en 168 Estados Parte.',
    dataDate: '2025-07-24',
    tags: ['Cultura', 'Patrimonio', 'Países'],
  },
  'submarine-fiber-cables': {
    dataSource: 'TeleGeography Submarine Cable Map API v3 (https://www.submarinecablemap.com/)',
    dataDate: '2024-01-01',
    tags: ['Infraestructura', 'Tecnología', 'Geografía'],
  },
  'worst-wildfires-world': {
    dataSource: 'Global Fire Emissions Database (GFED) — Global Fire Emissions Database / NASA FIRMS',
    dataDate: '2024-01-01',
    tags: ['Naturaleza', 'Medio Ambiente'],
  },
  'happiness-index-world': {
    dataSource: 'World Happiness Report 2024 — Gallup World Poll (Ladder score, escala 0-10). https://worldhappiness.report/data',
    dataDate: '2024-03-20',
    tags: ['Bienestar', 'Geografía', 'Sociedad'],
  },
  'co2-per-capita-world': {
    dataSource: 'Our World in Data (OWID) / IEA / CDIAC / Global Carbon Project (ourworldindata.org)',
    dataDate: '2024-01-01',
    tags: ['Clima', 'Medio Ambiente', 'Geografía', 'Emisiones'],
  },
  'nuclear-energy-world': {
    dataSource: 'Our World in Data — Energy (Ember / Energy Institute Statistical Review 2025). Geometrías: Natural Earth 1:110m.',
    dataDate: '2025-12-31',
    tags: ['Energía', 'Nuclear', 'Cambio Climático', 'Infraestructura'],
  },
  'cobertura-forestal-por-pais': {
    dataSource: 'FAO Global Forest Resources Assessment (FRA) / Banco Mundial (indicador AG.LND.FRST.ZS). https://data.worldbank.org/indicator/AG.LND.FRST.ZS',
    dataDate: '2024-01-01',
    tags: ['Naturaleza', 'Medio Ambiente'],
  },
  'life-expectancy-world': {
    dataSource: 'World Bank / WHO — Life expectancy at birth, total (years). Indicator SP.DYN.LE00.IN. https://data.worldbank.org/indicator/SP.DYN.LE00.IN',
    dataDate: '2023-12-31',
    tags: ['Salud', 'Geografía', 'Demografía'],
  },
  'population-by-country': {
    dataSource: 'World Bank / UN World Population Prospects 2024 — Population, total (SP.POP.TOTL). https://data.worldbank.org/indicator/SP.POP.TOTL',
    dataDate: '2024-12-31',
    tags: ['Población', 'Geografía', 'Demografía'],
  },
  'bibliotecas-barcelona': {
    dataSource: 'Ajuntament de Barcelona / Generalitat de Catalunya',
    dataDate: '2026-09-29',
    tags: ['Cultura', 'Educación', 'Barcelona'],
  },
  'electricity-access-world': {
    dataSource: 'World Bank — Access to electricity (% of population) (EG.ELC.ACCS.ZS). https://data.worldbank.org/indicator/EG.ELC.ACCS.ZS',
    dataDate: '2022-12-31',
    tags: ['Energía', 'Geografía', 'Desarrollo'],
  },
  'internet-users-world': {
    dataSource: 'World Bank — Individuals using the Internet (% of population). Indicator IT.NET.USER.ZS. https://data.worldbank.org/indicator/IT.NET.USER.ZS',
    dataDate: '2024-12-31',
    tags: ['Tecnología', 'Conectividad', 'Desarrollo', 'Geografía'],
  },
  'women-in-parliament-world': {
    dataSource: 'World Bank — Proportion of seats held by women in national parliaments (%). Indicator SG.GEN.PARL.ZS. https://data.worldbank.org/indicator/SG.GEN.PARL.ZS',
    dataDate: '2025-12-31',
    tags: ['Política', 'Género', 'Sociedad', 'Geografía'],
  },
};

// ── Popups con información real (AGENTS.md §5) ────────────────────
// Cada feature debe mostrar datos concretos, no solo el nombre. Las claves
// de estilo/internas NO cuentan como datos de popup. POPUP_FIX_DATA contiene
// los datos autoritativos por feature (clave = _manaName/name exacto) para
// completar automáticamente los mapas que fallan el check §5.

const POPUP_NAME_KEYS = new Set(['name', 'Name', 'NAME', '_manaName']);
const POPUP_STYLE_KEYS = new Set([
  'color', 'markerType', 'fillOpacity', 'opacity', 'weight',
  'emoji', 'emojiSize', 'strokeColor', 'strokeWidth', 'dashArray',
]);

function isDenyPopupKey(k) {
  if (POPUP_NAME_KEYS.has(k)) return true;
  if (POPUP_STYLE_KEYS.has(k)) return true;
  // Internas Maña (_manaColor, _manaLabelStyle, _manaGroupId…): no son datos
  if (k.startsWith('_mana')) return true;
  return false;
}

function hasConcreteValue(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'boolean') return true;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).some(k => hasConcreteValue(v[k]));
  return false;
}

// Devuelve las claves de properties que cuentan como "datos concretos" de popup.
function concreteDataKeys(props) {
  if (!props || typeof props !== 'object') return [];
  const keys = [];
  for (const [k, v] of Object.entries(props)) {
    // Atributos de tabla del editor: sí cuentan como datos del popup
    if (k === '_manaProperties' && v && typeof v === 'object') {
      for (const [k2, v2] of Object.entries(v)) {
        if (!isDenyPopupKey(k2) && hasConcreteValue(v2)) keys.push(`_manaProperties.${k2}`);
      }
      continue;
    }
    if (isDenyPopupKey(k)) continue;
    if (hasConcreteValue(v)) keys.push(k);
  }
  return keys;
}

// Datos concretos por feature para los mapas que fallan el check §5.
// Fuentes: GEBCO/IHO (arrecifes/fosas/pecios) y UNESCO/fuentes públicas
// (ciudades perdidas). Contenido en español según AGENTS.md.
const POPUP_FIX_DATA = {
  'arrecifes-de-coral-fosas-oceanicas-y-naufragios-famosos-3172026-1785478772912': {
    'Fosa de las Marianas (Challenger Deep)': {
      Tipo: 'Fosa oceánica',
      País: 'Guam (Estados Unidos)',
      'Profundidad (m)': 10935,
      Dato: '≈10.935 m de profundidad',
      Description: 'La fosa más profunda de los océanos, en la fosa de las Marianas, al sureste de Guam (océano Pacífico occidental).',
    },
    'Pecio del Titanic (3.800 m)': {
      Tipo: 'Pecio / naufragio',
      País: 'Atlántico Norte (Estados Unidos)',
      'Profundidad (m)': 3800,
      Año: 1912,
      Dato: '≈3.800 m de profundidad',
      Description: 'Transatlántico RMS Titanic, hundido el 15 de abril de 1912 tras chocar con un iceberg; el pecio yace a unos 3.800 m de profundidad en el Atlántico Norte.',
    },
    'Pecio del Bismarck (4.790 m)': {
      Tipo: 'Pecio / naufragio',
      País: 'Atlántico Norte',
      'Profundidad (m)': 4790,
      Año: 1941,
      Dato: '≈4.790 m de profundidad',
      Description: 'Acorazado alemán Bismarck, hundido en mayo de 1941 tras la Batalla del Atlántico Norte; el pecio yace a unos 4.790 m de profundidad.',
    },
    'Pecio del SS Thistlegorm (30 m)': {
      Tipo: 'Pecio / naufragio',
      País: 'Egipto (Mar Rojo)',
      'Profundidad (m)': 30,
      Año: 1941,
      Dato: '≈30 m de profundidad',
      Description: 'Buque mercante británico SS Thistlegorm, hundido en 1941 en el Mar Rojo durante la Segunda Guerra Mundial; uno de los pecios de buceo más famosos del mundo.',
    },
    'Deriva del Titanic': {
      Tipo: 'Línea (deriva)',
      Dato: 'Deriva en el Atlántico Norte',
      Description: 'Trayectoria de deriva asociada al pecio del Titanic en el Atlántico Norte.',
    },
    'Arco de fosas del Pacífico': {
      Tipo: 'Arco de fosas',
      Dato: 'Cadena de fosas abisales del Pacífico',
      Description: 'Arco de fosas abisales del Pacífico (Marianas, Tonga, Kermadec, Japón…), con las mayores profundidades del planeta.',
    },
    'Gran Barrera de Coral': {
      País: 'Australia',
      Tipo: 'Arrecife de coral',
      'Superficie (km²)': 344400,
      Superficie: '≈344.400 km²',
      Dato: 'Mayor sistema de arrecifes de coral del mundo',
      Description: 'El mayor sistema de arrecifes de coral del mundo, frente a la costa de Queensland (Australia).',
    },
    'Triángulo de Coral': {
      País: 'Indonesia, Malasia, Filipinas, Papúa Nueva Guinea, Timor Oriental, Islas Salomón',
      Tipo: 'Arrecife de coral',
      Dato: 'Máxima biodiversidad marina del planeta',
      Description: 'Región del sudeste asiático con la mayor biodiversidad marina del mundo, conocida como el Triángulo de Coral.',
    },
  },
  'ciudades-perdidas-y-ruinas-arqueologicas-fascinantes-3072026-1785391217436': {
    'Machu Picchu (Perú)': {
      País: 'Perú',
      Época: 'Imperio inca (siglo XV)',
      UNESCO: 'Sí (1983)',
      Dato: 'Ciudadela inca a ~2.430 m de altitud',
      Description: 'Ciudadela inca en los Andes peruanos, construida en el siglo XV; Patrimonio de la Humanidad desde 1983.',
    },
    'Petra (Jordania)': {
      País: 'Jordania',
      Época: 'Nabateos (siglos IV a.C.–II)',
      UNESCO: 'Sí (1985)',
      Dato: 'Capital nabatea excavada en roca',
      Description: 'Antigua ciudad nabatea excavada en roca arenisca, capital del reino de Nabatea; Patrimonio de la Humanidad desde 1985.',
    },
    'Angkor Wat (Camboya)': {
      País: 'Camboya',
      Época: 'Imperio jemer (siglo XII)',
      UNESCO: 'Sí (1992)',
      Dato: 'Mayor complejo religioso del mundo',
      Description: 'Templo jemer del siglo XII, núcleo del complejo de Angkor y mayor complejo religioso del mundo; Patrimonio de la Humanidad desde 1992.',
    },
    'Tikal (Guatemala)': {
      País: 'Guatemala',
      Época: 'Civilización maya (siglos II–IX)',
      UNESCO: 'Sí (1979)',
      Dato: 'Una de las grandes ciudades mayas',
      Description: 'Una de las grandes ciudades mayas de la selva petenera; Patrimonio de la Humanidad desde 1979.',
    },
    'Palacio de Dar al-Hajar (Yemen)': {
      País: 'Yemen',
      Época: 'Siglo XX (sobre estructuras más antiguas)',
      UNESCO: 'No',
      Dato: 'Palacio de roca en la meseta de Sanaa',
      Description: 'Palacio construido sobre un promontorio de roca en la meseta de Sanaa (Yemen), residencia del imam Yahya a inicios del siglo XX.',
    },
    'Kilwa Kisiwani (Tanzania)': {
      País: 'Tanzania',
      Época: 'Sultanes de Kilwa (siglos IX–XV)',
      UNESCO: 'Sí (1981)',
      Dato: 'Ciudad-estado swahili del Índico',
      Description: 'Antigua ciudad-estado swahili que dominó el comercio del océano Índico; Patrimonio de la Humanidad desde 1981.',
    },
    'Camino Inca': {
      País: 'Perú',
      Tipo: 'Red viaria',
      Época: 'Imperio inca',
      Dato: 'Red de caminos del Imperio inca',
      Description: 'Red de caminos del Imperio inca que conectaba Machu Picchu y otras ciudades andinas.',
    },
    'Angkor (complejo)': {
      País: 'Camboya',
      UNESCO: 'Sí (1992)',
      'Superficie (km²)': 400,
      Superficie: '≈400 km²',
      Dato: 'Zona arqueológica de ~400 km²',
      Description: 'Zona arqueológica de Angkor, con más de mil templos repartidos en unos 400 km²; Patrimonio de la Humanidad desde 1992.',
    },
  },
};

// ── Paleta semántica (AGENTS.md §3) ────────────────────────────────
// Si hay variable numérica: rampa secuencial monocromática ordenada por el
// dato (claro→oscuro). Nada de colores arbitrarios tipo arcoíris. En
// coropletas, borde blanco fino.
//
// Color semántico único por slug para colecciones que hoy usan paleta
// arcoíris (patrón de la galería: volcanes #d90429, incendios #ff4500,
// picos #1d4ed8…). Clave = slug Firestore.

const SEMANTIC_COLOR_BY_SLUG = {
  'arrecifes-de-coral-fosas-oceanicas-y-naufragios-famosos-3172026-1785478772912': '#0369a1',
  'ciudades-perdidas-y-ruinas-arqueologicas-fascinantes-3072026-1785391217436': '#b45309',
};

// Umbrales §3
const PALETTE = {
  MIN_PAIRS: 5,            // pares (valor, color) no grises para evaluar coropleta
  HUE_SPAN_MAX: 60,        // grados: span de tono aceptado como monocromática
  RHO_ORDERED_MAX: -0.65,  // Spearman(value, luminancia): ≤ esto = claro→oscuro
  RAINBOW_MIN_HUES: 4,     // tonos saturados mínimos para considerar arcoíris
  RAINBOW_MIN_SPAN: 150,   // grados de span para considerar arcoíris
  NEAR_GRAY_SAT: 0.12,     // saturación máxima para tratar un color como «sin datos»
  RAMP_STEPS: 9,
};

// Parseo numérico al estilo de js/gallery-page.js (legado europeo y US).
function parseLegendNumber(raw) {
  if (raw == null) return NaN;
  if (typeof raw === 'number') return isFinite(raw) ? raw : NaN;
  const s = String(raw);
  const m = s.replace(/[^\d.,\-]/g, '');
  if (m === '') return NaN;
  let num;
  if (m.indexOf(',') !== -1) {
    num = parseFloat(m.replace(/\./g, '').replace(',', '.'));
  } else if (/^\d{1,3}(\.\d{3})+$/.test(m) && !/\.\d{1,2}$/.test(m)) {
    num = parseFloat(m.replace(/\./g, ''));
  } else {
    num = parseFloat(m);
  }
  return isFinite(num) ? num : NaN;
}

// Hex #RRGGBB → { h (0-360), s (0-1), l (0-1) }
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s, l };
}

// HSL (h 0-360, s/l 0-100) → #RRGGBB
function hslToHex(h, s, l) {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const ll = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0, g = 0, b = 0;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const hx = n => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

// ¿Color casi gris («sin datos» / neutro)? No entra en rampa ni en arcoíris.
function isNearGray(hex, satMax = PALETTE.NEAR_GRAY_SAT) {
  const { s } = hexToHsl(hex);
  return s <= satMax;
}

// Span circular de tonos (grados, 0-360). hues = array de grados.
// Todos los tonos iguales → 0 (no 360).
function hueSpanDegrees(hues) {
  if (!hues || hues.length < 2) return 0;
  const hs = hues.slice().sort((a, b) => a - b);
  if (hs[hs.length - 1] === hs[0]) return 0;
  let maxGap = 0;
  for (let i = 0; i < hs.length - 1; i++) {
    maxGap = Math.max(maxGap, hs[i + 1] - hs[i]);
  }
  maxGap = Math.max(maxGap, (hs[0] + 360) - hs[hs.length - 1]);
  return 360 - maxGap;
}

// Spearman con media de rangos para empates.
function spearmanRho(xs, ys) {
  const n = xs.length;
  if (n < 3) return 0;
  const rank = arr => {
    const s = arr.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
    const r = new Array(arr.length);
    let i = 0;
    while (i < s.length) {
      let j = i;
      while (j + 1 < s.length && s[j + 1].x === s[i].x) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[s[k].i] = avg;
      i = j + 1;
    }
    return r;
  };
  const rv = rank(xs), rl = rank(ys);
  const mean = a => a.reduce((x, y) => x + y, 0) / n;
  const mv = mean(rv), ml = mean(rl);
  let num = 0, dv = 0, dl = 0;
  for (let i = 0; i < n; i++) {
    num += (rv[i] - mv) * (rl[i] - ml);
    dv += (rv[i] - mv) ** 2;
    dl += (rl[i] - ml) ** 2;
  }
  return (dv && dl) ? num / Math.sqrt(dv * dl) : 0;
}

// Tono dominante (mediana circular) de los colores saturados.
function dominantHue(hexList) {
  const hues = hexList
    .filter(c => { const { s, l } = hexToHsl(c); return s > 0.15 && l > 0.05 && l < 0.95; })
    .map(c => hexToHsl(c).h);
  if (!hues.length) return 210; // azul por defecto
  const hs = hues.slice().sort((a, b) => a - b);
  // Mediana circular aproximada: alinear alrededor del primer elemento
  const base = hs[0];
  const shifted = hs.map(h => (h - base + 360) % 360).sort((a, b) => a - b);
  const med = shifted[Math.floor(shifted.length / 2)];
  return (base + med) % 360;
}

// Rampa secuencial monocromática claro→oscuro en un tono.
function buildMonoRamp(hue, steps = PALETTE.RAMP_STEPS) {
  const ramp = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const l = 92 - t * 72;   // 92% → 20%
    const s = 48 + t * 28;   // 48% → 76%
    ramp.push(hslToHex(hue, s, l));
  }
  return ramp;
}

// ¿Geometría de polígono (coropleta candidata a borde blanco)?
function isPolygonGeom(geom) {
  return !!geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon');
}

// Borde blanco fino presente y claro en una feature de coropleta.
function hasWhiteThinBorder(props) {
  const border = props._manaBorderColor;
  if (border == null || border === '') return false;
  const { hex, ok } = normalizeHexColor(border);
  if (!ok || !hex) return false;
  const { l, s } = hexToHsl(hex);
  if (s > 0.25 || l < 0.7) return false; // debe ser claro y poco saturado
  const w = Number(props._manaWeight);
  return !Number.isFinite(w) || w <= 2;
}

// Análisis §3 de un mapa. Devuelve:
//   { issues, manual, recolor }  recolor = [{ feature, color?, borderColor?, weight? }]
// a aplicar sobre las features. No muta el GeoJSON: el caller aplica.
function auditSemanticPalette(map, geo) {
  const issues = [];
  const manual = [];
  const recolor = []; // { feature, color, border?, weight? }
  const features = (geo && geo.features) || [];
  if (!features.length) return { issues, manual, recolor, kind: 'empty' };

  // ── Recolección de colores válidos por feature ──
  const colored = []; // { feature, props, hex, hsl, value? }
  for (const feature of features) {
    const props = feature.properties || {};
    const raw = props._manaColor;
    if (raw == null || raw === '') continue;
    const { hex, ok } = normalizeHexColor(raw);
    if (!ok || !hex) continue; // ya reportado por check 4
    colored.push({ feature, props, hex, hsl: hexToHsl(hex) });
  }
  if (colored.length < 2) return { issues, manual, recolor, kind: 'sparse' };

  const dataColors = colored.filter(c => !isNearGray(c.hex));

  // ── ¿Coropleta? legendKey + pares numéricos no grises ──
  const legendKey = map.legendKey || null;
  const pairs = []; // { feature, props, value, hex, hsl }
  if (legendKey) {
    for (const c of dataColors) {
      const v = parseLegendNumber(c.props[legendKey]);
      if (isFinite(v)) pairs.push({ ...c, value: v });
    }
  }

  // Clave numérica inferida para rampas mono sin legendKey (p. ej. ríos/islas)
  let inferredKey = null;
  const spanAll = hueSpanDegrees(dataColors.map(c => c.hsl.h));
  if (!legendKey && dataColors.length >= PALETTE.MIN_PAIRS && spanAll <= PALETTE.HUE_SPAN_MAX) {
    const candidates = new Map();
    for (const c of dataColors) {
      for (const [k, v] of Object.entries(c.props)) {
        if (k.startsWith('_mana') || k === 'color') continue;
        const nv = parseLegendNumber(v);
        if (!isFinite(nv)) continue;
        candidates.set(k, (candidates.get(k) || 0) + 1);
      }
    }
    const minCount = Math.ceil(dataColors.length * 0.8);
    let best = null;
    for (const [k, count] of candidates) {
      if (count < minCount) continue;
      const xs = [], ys = [];
      for (const c of dataColors) {
        const v = parseLegendNumber(c.props[k]);
        if (!isFinite(v)) continue;
        xs.push(v); ys.push(c.hsl.l);
      }
      if (xs.length < PALETTE.MIN_PAIRS) continue;
      const rho = spearmanRho(xs, ys);
      if (!best || Math.abs(rho) > Math.abs(best.rho)) best = { key: k, rho, xs, ys };
    }
    if (best && Math.abs(best.rho) >= Math.abs(PALETTE.RHO_ORDERED_MAX)) {
      inferredKey = best.key;
      for (const c of dataColors) {
        const v = parseLegendNumber(c.props[inferredKey]);
        if (isFinite(v)) pairs.push({ ...c, value: v });
      }
    }
  }

  const isChoropleth = pairs.length >= PALETTE.MIN_PAIRS;
  const keyName = legendKey || inferredKey;

  // Span de tonos SOLO sobre las features evaluadas: en coropletas, los pares
  // del dato (no los marcadores categóricos que pueda haber en el mismo mapa);
  // en el resto, todas las features de datos.
  const evalColors = isChoropleth ? pairs : dataColors;
  const span = hueSpanDegrees(evalColors.map(c => c.hsl.h));
  const saturated = evalColors.filter(c => c.hsl.s > 0.25 && c.hsl.l > 0.05 && c.hsl.l < 0.95);
  const satHueCount = new Set(saturated.map(c => Math.round(c.hsl.h / 15))).size; // bins de 15°

  if (isChoropleth) {
    // 1) Monocromática (sobre los pares del dato)
    if (span > PALETTE.HUE_SPAN_MAX) {
      issues.push(`§3 coropleta no monocromática (span tono ${span.toFixed(1)}° > ${PALETTE.HUE_SPAN_MAX}°)`);
    }
    // 2) Ordenada por el dato de claro→oscuro
    const xs = pairs.map(p => p.value), ys = pairs.map(p => p.hsl.l);
    const rho = spearmanRho(xs, ys);
    if (!(rho <= PALETTE.RHO_ORDERED_MAX)) {
      const dir = rho > 0.3 ? 'inversa (oscuro→claro)' : 'no monótona';
      issues.push(`§3 rampa ${dir} por «${keyName}» (rho=${rho.toFixed(3)})`);
    }
    // 3) Borde blanco fino en polígonos de datos
    let borderBad = 0;
    for (const p of pairs) {
      if (!isPolygonGeom(p.feature.geometry)) continue;
      if (!hasWhiteThinBorder(p.props)) borderBad++;
    }
    if (borderBad) issues.push(`§3 ${borderBad} polígonos de coropleta sin borde blanco fino`);

    // Fix: recomputar rampa mono por cuantiles del dato
    const needRamp = span > PALETTE.HUE_SPAN_MAX || !(rho <= PALETTE.RHO_ORDERED_MAX);
    if (needRamp) {
      const hue = span <= PALETTE.HUE_SPAN_MAX ? dominantHue(pairs.map(p => p.hex)) : 210;
      const ramp = buildMonoRamp(hue);
      const sorted = pairs.slice().sort((a, b) => a.value - b.value);
      const n = sorted.length;
      sorted.forEach((p, idx) => {
        // Cuantiles: posición relativa en la distribución del dato
        const t = n === 1 ? 1 : idx / (n - 1);
        const step = Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))));
        recolor.push({ feature: p.feature, color: ramp[step] });
      });
      // Grises se preservan (sin datos); el resto de features no evaluadas se
      // dejan tal cual salvo que también caigan en el fix de arcoíris.
    }
    if (borderBad) {
      for (const p of pairs) {
        if (!isPolygonGeom(p.feature.geometry)) continue;
        if (hasWhiteThinBorder(p.props)) continue;
        recolor.push({ feature: p.feature, color: null, borderColor: '#ffffff', weight: 1 });
      }
    }
    return { issues, manual, recolor, kind: 'choropleth', rho, span, pairs: pairs.length, keyName };
  }

  // ── Sin variable numérica: prohibido arcoíris ──
  // Arcoíris = varios tonos saturados distintos (bins de 15°) con span amplio.
  // Un solo tono (o dos categóricos) no es arcoíris.
  const isRainbow = satHueCount >= PALETTE.RAINBOW_MIN_HUES && span > PALETTE.RAINBOW_MIN_SPAN;
  if (isRainbow) {
    const fixColor = SEMANTIC_COLOR_BY_SLUG[map.id];
    issues.push(`§3 paleta arcoíris (${satHueCount} tonos saturados, span ${span.toFixed(1)}°)`);
    if (fixColor) {
      for (const c of colored) {
        if (c.hex.toLowerCase() === fixColor.toLowerCase()) continue;
        recolor.push({ feature: c.feature, color: fixColor });
      }
    } else {
      manual.push('paleta arcoíris sin color semántico en SEMANTIC_COLOR_BY_SLUG');
    }
    return { issues, manual, recolor, kind: 'rainbow', span, fixColor: fixColor || null };
  }

  return { issues, manual, recolor, kind: 'ok', span };
}

// ── Helpers ──────────────────────────────────────────────────────

function extractField(doc, fieldName) {
  if (!doc || !doc.fields || !doc.fields[fieldName]) return null;
  const f = doc.fields[fieldName];
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return Number(f.doubleValue);
  if ('booleanValue' in f) return f.booleanValue;
  if ('nullValue' in f) return null;
  if ('timestampValue' in f) return f.timestampValue;
  if ('arrayValue' in f) {
    return (f.arrayValue.values || []).map(v => {
      if ('stringValue' in v) return v.stringValue;
      if ('integerValue' in v) return Number(v.integerValue);
      if ('doubleValue' in v) return Number(v.doubleValue);
      if ('booleanValue' in v) return v.booleanValue;
      return null;
    });
  }
  if ('mapValue' in f) {
    const out = {};
    for (const [k, v] of Object.entries(f.mapValue.fields || {})) out[k] = extractField({ fields: { [k]: v } }, k);
    return out;
  }
  return null;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const HEX3_RE = /^#[0-9a-fA-F]{3}$/;
const HEX4_RE = /^#[0-9a-fA-F]{4}$/;
const RGB_RE = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i;

// Normaliza un color a #RRGGBB. Devuelve { hex, ok, fixable }
function normalizeHexColor(value) {
  if (value == null || value === '') return { hex: null, ok: false, fixable: false };
  const s = String(value).trim();
  if (HEX_RE.test(s)) return { hex: s.toLowerCase(), ok: true, fixable: false };
  if (HEX3_RE.test(s)) {
    const r = s[1], g = s[2], b = s[3];
    return { hex: `#${r}${r}${g}${g}${b}${b}`.toLowerCase(), ok: false, fixable: true };
  }
  if (HEX4_RE.test(s)) {
    const r = s[1], g = s[2], b = s[3];
    return { hex: `#${r}${r}${g}${g}${b}${b}`.toLowerCase(), ok: false, fixable: true };
  }
  const m = s.match(RGB_RE);
  if (m) {
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (r > 255 || g > 255 || b > 255) return { hex: null, ok: false, fixable: false };
    const hx = n => n.toString(16).padStart(2, '0');
    return { hex: `#${hx(r)}${hx(g)}${hx(b)}`, ok: false, fixable: true };
  }
  return { hex: null, ok: false, fixable: false };
}

// Recorre coordenadas. Aplica fix de longitud (wrap ±180) si applyFix.
// Devuelve { lonOut, latOut, applied }
function auditCoordinates(geom, applyFix) {
  let lonOut = 0, latOut = 0, applied = 0;
  if (!geom || !geom.coordinates) return { lonOut, latOut, applied };
  const walk = c => {
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      let x = c[0], y = c[1];
      if (x < -180 || x > 180) {
        lonOut++;
        if (applyFix) {
          // Wrap al rango [-180, 180]
          x = ((x + 180) % 360 + 360) % 360 - 180;
          c[0] = x;
          applied++;
        }
      }
      if (y < -90 || y > 90) latOut++;
    } else if (Array.isArray(c)) {
      c.forEach(walk);
    }
  };
  walk(geom.coordinates);
  return { lonOut, latOut, applied };
}

// ── Auditoría de un mapa ─────────────────────────────────────────
// Devuelve { issues, fixes, manual, geo } — fixes = campos Firestore a actualizar
function auditMap(map) {
  const issues = [];   // descripción de cada problema
  const fixes = {};    // campoFirestore -> valor Firestore (fsStr/fsInt/fsArr)
  const manual = [];   // problemas que requieren intervención manual
  let geo = null;

  // 1+5+6. dataSource / dataDate / tags / lang (campos de documento)
  const known = KNOWN_META[map.id] || {};

  if (!map.dataSource) {
    if (known.dataSource) {
      issues.push('dataSource vacío');
      fixes.dataSource = fsStr(known.dataSource);
    } else {
      issues.push('dataSource vacío (sin meta conocida)');
      manual.push('dataSource');
    }
  }
  if (!map.dataDate) {
    if (known.dataDate) {
      issues.push('dataDate vacío');
      fixes.dataDate = fsStr(known.dataDate);
    } else {
      issues.push('dataDate vacío (sin meta conocida)');
      manual.push('dataDate');
    }
  }
  if (!Array.isArray(map.tags) || map.tags.length === 0) {
    if (known.tags && known.tags.length) {
      issues.push('tags vacías');
      fixes.tags = fsArr(known.tags);
    } else {
      issues.push('tags vacías (sin meta conocida)');
      manual.push('tags');
    }
  }
  if (map.lang !== 'es') {
    issues.push(`lang=${JSON.stringify(map.lang)} (se exige 'es')`);
    fixes.lang = fsStr('es');
  }

  // GeoJSON
  if (!map.geojsonText) {
    manual.push('geojsonText ausente');
    issues.push('geojsonText ausente');
    return { issues, fixes, manual, geo: null };
  }
  try {
    geo = JSON.parse(map.geojsonText);
  } catch (e) {
    issues.push(`geojsonText inválido: ${e.message}`);
    manual.push('geojsonText inválido');
    return { issues, fixes, manual, geo: null };
  }
  if (!geo.features || !Array.isArray(geo.features) || geo.features.length === 0) {
    issues.push('geojsonText sin features');
    manual.push('geojsonText sin features');
    return { issues, fixes, manual, geo };
  }

  // 2. featureCount coherente
  const actual = geo.features.length;
  if (map.featureCount !== actual) {
    issues.push(`featureCount=${map.featureCount} ≠ features=${actual}`);
    fixes.featureCount = fsInt(actual);
  }

  // 3+4. coordenadas y colores por feature
  let lonBad = 0, latBad = 0, colorBad = 0, colorFixed = 0, colorMissing = 0, coordFixed = 0;
  const colorSamples = [];
  let featuresTouched = 0;

  // 7. popups con información real (AGENTS.md §5)
  const popupFixTable = POPUP_FIX_DATA[map.id] || {};
  let popupMissing = 0, popupFixed = 0;
  const popupMissingNames = [];
  const popupFixedNames = [];

  for (const feature of geo.features) {
    const props = feature.properties || (feature.properties = {});

    const coord = auditCoordinates(feature.geometry, true);
    lonBad += coord.lonOut;
    latBad += coord.latOut;
    coordFixed += coord.applied;
    if (coord.lonOut || coord.latOut) featuresTouched++;

    // _manaColor
    if (props._manaColor == null || props._manaColor === '') {
      colorMissing++;
    } else {
      const { hex, ok, fixable } = normalizeHexColor(props._manaColor);
      if (!ok) {
        if (fixable && hex) {
          props._manaColor = hex;
          colorFixed++;
          featuresTouched++;
        } else {
          colorBad++;
          if (colorSamples.length < 3) colorSamples.push(String(props._manaColor));
        }
      }
    }

    // §5 popups: cada feature debe mostrar datos concretos, no solo el nombre.
    // Si falta, se completan los datos desde POPUP_FIX_DATA (solo añade claves
    // ausentes/vacías; no sobreescribe datos ya presentes).
    if (concreteDataKeys(props).length === 0) {
      const fname = props._manaName || props.name || props.Name || props.NAME || '';
      const addProps = popupFixTable[fname];
      if (addProps && Object.keys(addProps).length) {
        for (const [k, v] of Object.entries(addProps)) {
          if (!hasConcreteValue(props[k])) props[k] = v;
        }
        if (concreteDataKeys(props).length > 0) {
          popupFixed++;
          popupFixedNames.push(fname || '(sin nombre)');
          featuresTouched++;
        } else {
          popupMissing++;
          if (popupMissingNames.length < 5) popupMissingNames.push(fname || '(sin nombre)');
        }
      } else {
        popupMissing++;
        if (popupMissingNames.length < 5) popupMissingNames.push(fname || '(sin nombre)');
      }
    }
  }

  if (lonBad) {
    issues.push(`${lonBad} coords lon fuera de ±180`);
    if (coordFixed < lonBad) manual.push('longitud no envoluble');
  }
  if (latBad) {
    issues.push(`${latBad} coords lat fuera de ±90`);
    manual.push('latitud fuera de rango (geometría)');
  }
  if (colorFixed) issues.push(`${colorFixed} colores hex normalizados`);
  if (colorBad) {
    issues.push(`${colorBad} colores no hex válidos${colorSamples.length ? ` (${colorSamples.join(', ')})` : ''}`);
    manual.push('colores no convertibles');
  }
  if (colorMissing === actual) {
    issues.push('ninguna feature tiene _manaColor');
    manual.push('_manaColor ausente en todas las features');
  }
  if (popupFixed) {
    issues.push(`${popupFixed} features sin datos de popup completadas (§5)`);
  }
  if (popupMissing) {
    issues.push(`${popupMissing} features sin datos concretos en el popup (solo nombre/estilo)${popupMissingNames.length ? ` — ej: ${popupMissingNames.join(' | ')}` : ''}`);
    manual.push('popups sin datos concretos (§5, sin fix en POPUP_FIX_DATA)');
  }

  // 8. Paleta semántica (AGENTS.md §3): rampa mono ordenada por el dato en
  // coropletas; sin arcoíris en el resto. Se ejecuta tras normalizar hex.
  const palette = auditSemanticPalette(map, geo);
  let paletteFixed = 0;
  if (palette.issues.length) issues.push(...palette.issues);
  if (palette.manual.length) manual.push(...palette.manual);
  for (const fix of palette.recolor) {
    const props = fix.feature.properties || (fix.feature.properties = {});
    if (fix.color) {
      const prev = props._manaColor;
      if (String(prev).toLowerCase() !== fix.color.toLowerCase()) {
        props._manaColor = fix.color;
        // Sincronizar la clave legada `color` si existía (renderer usa _manaColor
        // con coalesce sobre `color`).
        if (typeof props.color === 'string') props.color = fix.color;
        paletteFixed++;
        featuresTouched++;
      }
    }
    if (fix.borderColor) {
      if (String(props._manaBorderColor || '').toLowerCase() !== fix.borderColor.toLowerCase()) {
        props._manaBorderColor = fix.borderColor;
        paletteFixed++;
        featuresTouched++;
      }
    }
    if (fix.weight != null && Number(props._manaWeight) !== fix.weight) {
      props._manaWeight = fix.weight;
      paletteFixed++;
      featuresTouched++;
    }
  }
  if (paletteFixed) {
    issues.push(`§3 paleta corregida en ${paletteFixed} props (rampa/borde/color semántico)`);
  }

  // geojsonText necesita re-serializarse si se tocó coords/colores/popups/paleta
  const geoDirty = coordFixed > 0 || colorFixed > 0 || popupFixed > 0 || paletteFixed > 0;
  if (geoDirty) {
    const newGeoText = JSON.stringify(geo);
    const newSize = Buffer.byteLength(newGeoText, 'utf8');
    if (newSize > MAX_DOC_BYTES) {
      manual.push(`geojsonText resultante >1MiB (${newSize})`);
      issues.push(`geojsonText >1MiB tras fixes (${newSize})`);
    } else {
      fixes.geojsonText = fsStr(newGeoText);
    }
  }

  return { issues, fixes, manual, geo, dirty: geoDirty, popupFixed, popupMissing, paletteFixed, paletteKind: palette.kind };
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== audit-gallery-quality.js ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  let auth = await getAccessToken();
  if (!auth || !auth.token) {
    console.error('ERROR: no access token');
    process.exit(1);
  }
  console.log(`Access token obtained (uid=${auth.uid || 'anon'}).`);

  async function fsReq(method, urlPath, body) {
    let lastRes = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      lastRes = await firestoreRequest(auth.token, method, urlPath, body);
      if (lastRes.status === 401 && attempt < 5) {
        console.log(`  ${method} ${urlPath.slice(0, 60)} → 401, re-auth + retry ${attempt}...`);
        await new Promise(r => setTimeout(r, attempt * 1000));
        auth = await getAccessToken();
        if (!auth || !auth.token) throw new Error('re-auth failed: no token');
        continue;
      }
      return lastRes;
    }
    return lastRes;
  }

  async function listAllMaps() {
    const docs = [];
    let pageToken = '';
    let pages = 0;
    do {
      const url = `/${COLLECTION}?pageSize=100` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const res = await fsReq('GET', url);
      if (res.status !== 200) {
        throw new Error(`List maps failed (${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
      }
      docs.push(...(res.data.documents || []));
      pageToken = res.data.nextPageToken || '';
      pages++;
    } while (pageToken && pages < 20);
    return docs.map(doc => {
      const id = doc.name.split('/').pop();
      return {
        id,
        title: extractField(doc, 'title') || extractField(doc, 'name') || '',
        isPublished: extractField(doc, 'isPublished'),
        lang: extractField(doc, 'lang'),
        dataSource: extractField(doc, 'dataSource'),
        dataDate: extractField(doc, 'dataDate'),
        tags: extractField(doc, 'tags'),
        featureCount: extractField(doc, 'featureCount'),
        legendKey: extractField(doc, 'legendKey'),
        geojsonText: extractField(doc, 'geojsonText') || '',
        rawDoc: doc,
      };
    });
  }

  const allMaps = await listAllMaps();
  const published = allMaps.filter(m => m.isPublished === true);
  console.log(`Found ${allMaps.length} docs, ${published.length} published.\n`);

  console.log('SLUG | ISSUES');
  console.log('-----|-------');

  let mapsAudited = 0, mapsOk = 0, mapsFixed = 0, mapsManual = 0, errors = 0;
  let popupFixedTotal = 0, popupMissingTotal = 0, paletteFixedTotal = 0;
  const manualList = [];

  for (const map of published) {
    mapsAudited++;
    const { issues, fixes, manual, popupFixed = 0, popupMissing = 0, paletteFixed = 0 } = auditMap(map);
    popupFixedTotal += popupFixed;
    popupMissingTotal += popupMissing;
    paletteFixedTotal += paletteFixed;

    if (issues.length === 0) {
      console.log(`${map.id} | OK`);
      mapsOk++;
      continue;
    }

    const fixKeys = Object.keys(fixes);
    const status = manual.length > 0 ? 'MANUAL' : (fixKeys.length > 0 ? 'FIX' : 'REPORT');
    console.log(`${map.id} | ${status}: ${issues.join('; ')}`);
    if (VERBOSE) {
      if (fixKeys.length) console.log(`  fixes: ${fixKeys.join(', ')}`);
      if (manual.length) console.log(`  manual: ${manual.join(', ')}`);
    }

    if (manual.length > 0) {
      mapsManual++;
      manualList.push({ slug: map.id, issues, manual });
    }

    if (fixKeys.length === 0) {
      errors += manual.length > 0 ? 1 : 0;
      continue;
    }

    if (DRY_RUN) {
      mapsFixed++;
      continue;
    }

    // PATCH con updateMask de los campos a corregir
    const mask = fixKeys.map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    const urlPath = `/${COLLECTION}/${map.id}?${mask}`;
    const res = await fsReq('PATCH', urlPath, { fields: fixes });
    if (res.status >= 400) {
      console.error(`  ✗ UPDATE failed (${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
      errors++;
    } else {
      console.log(`  ✓ Updated: ${fixKeys.join(', ')}`);
      mapsFixed++;
      // Verificación post-update de los campos corregidos
      const verify = await fsReq('GET', `/${COLLECTION}/${map.id}`);
      if (verify.status === 200 && verify.data && verify.data.fields) {
        const vLang = extractField(verify.data, 'lang');
        const vDs = extractField(verify.data, 'dataSource');
        const vDd = extractField(verify.data, 'dataDate');
        const vTags = extractField(verify.data, 'tags');
        const vFc = extractField(verify.data, 'featureCount');
        const vGeo = extractField(verify.data, 'geojsonText') || '';
        let verifyIssues = [];
        if (fixes.lang && vLang !== 'es') verifyIssues.push(`lang=${vLang}`);
        if (fixes.dataSource && !vDs) verifyIssues.push('dataSource sigue vacío');
        if (fixes.dataDate && !vDd) verifyIssues.push('dataDate sigue vacío');
        if (fixes.tags && (!Array.isArray(vTags) || vTags.length === 0)) verifyIssues.push('tags siguen vacías');
        if (fixes.featureCount) {
          try {
            const n = (JSON.parse(vGeo).features || []).length;
            if (vFc !== n) verifyIssues.push(`featureCount=${vFc} ≠ ${n}`);
          } catch (_) { verifyIssues.push('geojson no parseable tras update'); }
        }
        if (fixes.geojsonText) {
          try {
            const g = JSON.parse(vGeo);
            let bad = 0;
            let popupBad = 0;
            const popupFixTable = POPUP_FIX_DATA[map.id] || {};
            for (const f of g.features || []) {
              const p = f.properties || {};
              if (p._manaColor && !HEX_RE.test(String(p._manaColor))) bad++;
              const c = auditCoordinates(f.geometry, false);
              if (c.lonOut || c.latOut) bad++;
              // §5: tras el fix, toda feature debe tener datos concretos de popup
              // (las que tenían fix conocido) o al menos las que no fallaban.
              if (concreteDataKeys(p).length === 0) {
                const fname = p._manaName || p.name || '';
                if (popupFixTable[fname]) popupBad++;
              }
            }
            if (bad) verifyIssues.push(`${bad} features aún con coords/colores inválidos`);
            if (popupBad) verifyIssues.push(`${popupBad} features aún sin datos de popup tras fix (§5)`);
            // §3: re-evaluar la paleta semántica tras el fix
            if (fixes.geojsonText && map.id) {
              const paletteAfter = auditSemanticPalette({ id: map.id, legendKey: extractField(verify.data, 'legendKey') }, g);
              if (paletteAfter.issues.length) {
                verifyIssues.push(`§3 aún incumple: ${paletteAfter.issues.join('; ')}`);
              }
            }
          } catch (_) { verifyIssues.push('geojson parse error'); }
        }
        if (verifyIssues.length) {
          console.error(`  ✗ Verify FAILED: ${verifyIssues.join('; ')}`);
          errors++;
        } else {
          console.log(`  ✓ Verify OK`);
        }
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Published maps audited: ${mapsAudited}`);
  console.log(`Maps OK: ${mapsOk}`);
  console.log(`Maps fixed (or would fix in dry-run): ${mapsFixed}`);
  console.log(`Maps with manual issues: ${mapsManual}`);
  console.log(`Popups (AGENTS.md §5): ${popupFixedTotal} features completadas, ${popupMissingTotal} aún sin datos concretos`);
  console.log(`Paleta (AGENTS.md §3): ${paletteFixedTotal} props corregidas (rampa/borde/color semántico)`);
  console.log(`Errors: ${errors}`);
  if (manualList.length) {
    console.log(`\nManual follow-up needed:`);
    for (const m of manualList) {
      console.log(`  - ${m.slug}: ${m.manual.join(', ')} (${m.issues.join('; ')})`);
    }
  }
  console.log('');

  process.exit(errors > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
}

// Exportación de funciones puras para tests/verificación (no ejecuta main).
module.exports = {
  KNOWN_META,
  POPUP_FIX_DATA,
  SEMANTIC_COLOR_BY_SLUG,
  PALETTE,
  extractField,
  normalizeHexColor,
  auditCoordinates,
  concreteDataKeys,
  hasConcreteValue,
  isDenyPopupKey,
  auditMap,
  auditSemanticPalette,
  parseLegendNumber,
  hexToHsl,
  hslToHex,
  isNearGray,
  hueSpanDegrees,
  spearmanRho,
  dominantHue,
  buildMonoRamp,
  hasWhiteThinBorder,
  HEX_RE,
};
