#!/usr/bin/env node
// ── audit-gallery-quality.js ─
// Valida los mapas isPublished de Firestore contra AGENTS.md §Estándar de
// publicación y corrige en Firestore lo que se pueda de forma segura.
//
// Comprobaciones (BACKLOG 03-10 / 03-10 popups / 05-10 paleta §3 / 06-10 puntos):
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
//   9. mapas de puntos (AGENTS.md §Mapas puntuales con iconos): cada feature
//      Point debe tener name/_manaName, markerType y _manaMarkerType con id
//      válido del catálogo js/markers.js, _manaEmojiSize o Area para escalar
//      el icono, _manaGroupName y _manaGroupId. Nunca se representa un área
//      (país, desierto, región…) con un punto: eso exige polígono real §2.
//  10. deriva de metadatos SEO: los mapas isPublished de Firestore deben
//      coincidir exactamente con el itemListElement/numberOfItems del JSON-LD
//      CollectionPage de gallery/index.html y con las URLs de mapa de
//      sitemap.xml. Lista faltantes/sobrantes/duplicados y falla (exit 1) si
//      hay desajuste. Acepta landings /gallery/<slug>/ y /gallery/?slug=<slug>.
//  11. cobertura de landings y OG cards: cada mapa isPublished debe tener
//      gallery/<slug>/index.html (que además debe contener su slug) y
//      og-cards/<slug>.png no vacío. Lista los faltantes y falla (exit 1).
//      Los que falten se generan con `node scripts/tools/generate-map-landings.js`.
//  12. metadatos de cada landing: gallery/<slug>/index.html debe tener
//      <title> propio (no vacío, no genérico y único entre landings), meta
//      description no vacía, canonical cuyo slug sea el del mapa y un JSON-LD
//      Dataset válido. Lista los fallos y falla (exit 1).
//  13. higiene de metadatos: la description de Firestore debe tener entre 60 y
//      200 caracteres y ser única entre mapas, y dataDate debe estar en ISO
//      8601 (YYYY o YYYY-MM-DD). Lista los fallos y falla (exit 1); las
//      descripciones se recortan/amplían y dataDate se normaliza cuando hay
//      una conversión inequívoca.
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
//   - Point: sincronizar markerType/_manaMarkerType cuando uno es válido;
//     añadir _manaEmojiSize por defecto si falta escala; completar
//     _manaGroupName/_manaGroupId
//   - description fuera de 60–200 caracteres o duplicada → recorte por frase
//     (≤200) o ampliación con el título del mapa (≥60), garantizando unicidad
//   - dataDate no ISO → YYYY-MM al día 1, rangos de años al 31-12 del año
//     final y fechas ISO con hora a su fecha; el resto se reporta como MANUAL
// Lo demás (latitud fuera de ±90, colores no convertibles, metadatos
// desconocidos, popups sin fix conocido, arcoíris sin slug en la tabla,
// marker id inválido sin equivalente, área representada con punto) se
// reporta como MANUAL y NO se toca.
//
// Uso:
//   node scripts/tools/audit-gallery-quality.js [--dry-run] [--verbose]

'use strict';

const fs = require('fs');

const { getAccessToken, firestoreRequest, COLLECTION, fsStr, fsInt, fsArr } = require('../lib/publisher');

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
  'gdp-per-capita-world': {
    dataSource: 'World Bank (vía Our World in Data) — GDP per capita (current US$). Indicator NY.GDP.PCAP.CD. https://data.worldbank.org/indicator/NY.GDP.PCAP.CD',
    dataDate: '2025-12-31',
    tags: ['Economía', 'Desarrollo', 'Geografía'],
  },
  'renewable-energy-world': {
    dataSource: 'World Bank — Renewable electricity output (% of total electricity output). Indicator EG.ELC.RNEW.ZS. https://data.worldbank.org/indicator/EG.ELC.RNEW.ZS',
    dataDate: '2021-12-31',
    tags: ['Energía', 'Medio Ambiente', 'Tecnología'],
  },
  'infant-mortality-world': {
    dataSource: 'World Bank / UN IGME — Mortality rate, infant (per 1,000 live births). Indicator SP.DYN.IMRT.IN. https://data.worldbank.org/indicator/SP.DYN.IMRT.IN',
    dataDate: '2024-12-31',
    tags: ['Salud', 'Demografía', 'Geografía'],
  },
  'gini-index-world': {
    dataSource: 'World Bank — Poverty and Inequality Platform (PIP, 2026), vía Our World in Data (ourworldindata.org/grapher/gini-coefficient-wb): Gini coefficient, ingreso/consumo tras impuestos y transferencias. Geometrías: Natural Earth 110m/50m.',
    dataDate: '2025-12-31',
    tags: ['Economía', 'Desigualdad', 'Geografía'],
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

// ── Mapas de puntos (AGENTS.md §Mapas puntuales con iconos) ────────
// Check 9 (BACKLOG 06-10): features Point con icono deben cumplir el
// estándar de entidades puntuales reales (picos, volcanes, incendios,
// cráteres, lugares extremos…). Requisitos por feature:
//   - name/_manaName
//   - markerType y _manaMarkerType con id válido del catálogo js/markers.js
//     (replicado en js/vector-renderer.js y js/globe.js)
//   - _manaEmojiSize o clave Area para escalar el icono
//   - _manaGroupName y _manaGroupId
//   - Nunca representar un área (país, desierto, región…) con un punto:
//     eso exige polígono real (AGENTS.md §2).

// Ids válidos del catálogo js/markers.js. Se parsea en runtime para no
// duplicar la lista (~190 ids); fallback mínimo si el fichero no existe.
function loadMarkerCatalogIds() {
  const fsMod = require('fs');
  const pathMod = require('path');
  const p = pathMod.join(__dirname, '..', '..', 'js', 'markers.js');
  try {
    if (fsMod.existsSync(p)) {
      const src = fsMod.readFileSync(p, 'utf8');
      const ids = new Set();
      for (const m of src.matchAll(/id:\s*'([^']+)'/g)) ids.add(m[1]);
      if (ids.size >= 50) return ids;
    }
  } catch (_) { /* ignore */ }
  // Fallback mínimo (shapes + emojis habituales del catálogo)
  return new Set([
    'pin', 'circle', 'square', 'diamond', 'triangle', 'star', 'hexagon', 'cross', 'drop', 'flag', 'bolt', 'heart',
    'emoji_pin', 'emoji_star', 'emoji_heart', 'emoji_mountain', 'emoji_fire', 'emoji_collision', 'emoji_water', 'emoji_library',
    'emoji_sun', 'emoji_tree', 'emoji_beach', 'emoji_warning', 'emoji_info', 'emoji_home',
  ]);
}

const MARKER_IDS = loadMarkerCatalogIds();
const POINT_DEFAULT_EMOJI_SIZE = 40;

// Nombre que denota entidad-área (país, desierto, región, isla, océano…).
// Si una feature Point coincide, representa un área con un punto (prohibido §2).
const AREA_ENTITY_NAME_RE = new RegExp(
  '(?:^|\\s)(?:' +
    'desiertos?|deserts?|sahara|gobi|kalahari|atacama|taklamakan|sahel|patagonia|namib|' +
    'pa[ií]ses?|countries|regi[oó]ns?|regions?|' +
    'islas?|islands?|oc[eé]anos?|oceans?|' +
    'mar de|mares?|seas?|lagos?|lakes?|' +
    'bosques?|forests?|glaciares?|glaciers?|' +
    'cordilleras?|sierras?|mesetas?|sabanas?|tundras?|taigas?|praderas?|steppes?|' +
    'pen[ií]nsulas?|peninsulas?|archipi[eé]lagos?|archipelagos?|deltas?|arrecifes?|reefs?' +
  ')\\b', 'i');

// Topónimos reales que el regex anterior detectaría como área (falsos
// positivos): «Lagos» (Nigeria) es una ciudad, no el plural de «lago», y
// «Prairie Island» es una central nuclear (Minnesota), no una isla. Se compara
// el primer token, así que la excepción cubre variantes con sufijo.
const AREA_ENTITY_NAME_EXCEPTIONS = new Set(['lagos', 'prairie']);

function isAreaEntityName(name) {
  if (!name || typeof name !== 'string') return false;
  // Excepciones: topónimos reales homónimos de un área (p. ej. «Lagos», la
  // ciudad de Nigeria, que coincide con el plural de «lago»). Se compara el
  // primer token para cubrir variantes como «Lagos (Nigeria)».
  const first = name.trim().split(/[\s(,]/)[0].toLowerCase();
  if (AREA_ENTITY_NAME_EXCEPTIONS.has(first)) return false;
  return AREA_ENTITY_NAME_RE.test(name);
}

// ¿La feature Point tiene clave de escala del icono (_manaEmojiSize o Area)?
function hasMarkerScale(props) {
  if (!props) return false;
  if (props._manaEmojiSize != null && props._manaEmojiSize !== '') return true;
  if (props.Area != null && props.Area !== '') return true;
  return false;
}

// Check de solo lectura (para verificación post-update). Devuelve los fallos
// auto-fixables de una feature Point (no incluye «área con punto», que es
// MANUAL y permanece tras un fix parcial).
function pointFeatureVerifyFails(props, markerIds = MARKER_IDS) {
  const fails = [];
  const name = props._manaName || props.name || props.Name || props.NAME || '';
  if (!name) fails.push('sin nombre');
  const mt = props.markerType != null && props.markerType !== '' ? String(props.markerType) : null;
  const mmt = props._manaMarkerType != null && props._manaMarkerType !== '' ? String(props._manaMarkerType) : null;
  if (!((mt && markerIds.has(mt)) || (mmt && markerIds.has(mmt)))) fails.push('marker id');
  if (!hasMarkerScale(props)) fails.push('escala');
  if (props._manaGroupName == null || props._manaGroupName === '') fails.push('grupo');
  const gid = props._manaGroupId;
  if (gid == null || gid === '' || !Number.isFinite(Number(gid))) fails.push('groupId');
  return fails;
}

// Auditoría de una feature Point. Aplica fixes seguros sobre `props`
// (mutación) y devuelve { issues, manual, fixed }:
//   - issues: problemas detectados (los auto-fixados van con «(fix aplicado)»)
//   - manual: fallos sin fix seguro (id inválido, área con punto…)
//   - fixed: nº de props corregidas
function auditPointFeature(props, markerIds = MARKER_IDS) {
  const issues = [];
  const manual = [];
  let fixed = 0;

  const name = props._manaName || props.name || props.Name || props.NAME || '';

  // name / _manaName (uno debe existir; se sincroniza el otro)
  if (!name) {
    issues.push('Point sin name/_manaName');
    manual.push('point sin nombre');
  } else {
    if (props._manaName == null || props._manaName === '') {
      if (props.name) { props._manaName = props.name; fixed++; }
    }
    if (props.name == null || props.name === '') {
      if (props._manaName) { props.name = props._manaName; fixed++; }
    }
  }

  // markerType / _manaMarkerType con id válido del catálogo js/markers.js
  const rawMt = props.markerType;
  const rawMmt = props._manaMarkerType;
  const mt = rawMt != null && rawMt !== '' ? String(rawMt) : null;
  const mmt = rawMmt != null && rawMmt !== '' ? String(rawMmt) : null;
  const mtOk = mt != null && markerIds.has(mt);
  const mmtOk = mmt != null && markerIds.has(mmt);

  if (mtOk && mmtOk) {
    if (mt !== mmt) { props.markerType = mmt; fixed++; }
  } else if (mtOk && !mmtOk) {
    props._manaMarkerType = mt;
    fixed++;
    issues.push(`_manaMarkerType ausente/inválido (fix: ← markerType=${mt})`);
  } else if (!mtOk && mmtOk) {
    props.markerType = mmt;
    fixed++;
    issues.push(`markerType ausente/inválido (fix: ← _manaMarkerType=${mmt})`);
  } else if (mt != null || mmt != null) {
    const bad = [];
    if (!mtOk) bad.push(`markerType=${JSON.stringify(rawMt)}`);
    if (!mmtOk) bad.push(`_manaMarkerType=${JSON.stringify(rawMmt)}`);
    issues.push(`marker id no válido (${bad.join(', ')}; exige id del catálogo js/markers.js)`);
    manual.push('marker id inválido');
  } else {
    issues.push('markerType/_manaMarkerType ausentes');
    manual.push('marker ausente');
  }

  // _manaEmojiSize o Area para escalar el icono
  if (!hasMarkerScale(props)) {
    props._manaEmojiSize = POINT_DEFAULT_EMOJI_SIZE;
    fixed++;
    issues.push(`sin _manaEmojiSize/Area (fix: _manaEmojiSize=${POINT_DEFAULT_EMOJI_SIZE})`);
  }

  // _manaGroupName / _manaGroupId
  if (props._manaGroupName == null || props._manaGroupName === '') {
    props._manaGroupName = 'Puntos';
    fixed++;
    issues.push('_manaGroupName ausente (fix: «Puntos»)');
  }
  const gidRaw = props._manaGroupId;
  if (gidRaw == null || gidRaw === '' || !Number.isFinite(Number(gidRaw))) {
    props._manaGroupId = 1;
    fixed++;
    issues.push('_manaGroupId ausente/no numérico (fix: 1)');
  }

  // Área representada con punto (prohibido §2: exige polígono real)
  if (name && isAreaEntityName(name)) {
    issues.push(`área representada con punto: «${name}» (AGENTS.md §2 exige polígono real)`);
    manual.push('área con punto (sin fix seguro)');
  }

  return { issues, manual, fixed };
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

  // 9. Mapas de puntos (AGENTS.md §Mapas puntuales con iconos): marker id
  // válido del catálogo js/markers.js, _manaEmojiSize/Area para escala,
  // _manaGroupName/_manaGroupId, name/_manaName, y nunca áreas con puntos.
  let pointFixed = 0;
  let pointManualCount = 0;
  const pointManualSet = new Set();
  const pointManualSamples = [];
  for (const feature of geo.features) {
    if (!feature.geometry || feature.geometry.type !== 'Point') continue;
    const props = feature.properties || (feature.properties = {});
    const r = auditPointFeature(props, MARKER_IDS);
    if (r.fixed) {
      pointFixed += r.fixed;
      featuresTouched++;
    }
    if (r.manual.length) {
      pointManualCount++;
      const fname = props._manaName || props.name || props.Name || props.NAME || '(sin nombre)';
      if (pointManualSamples.length < 3) {
        pointManualSamples.push(`${fname}: ${r.manual[0]}`);
      }
      for (const m of r.manual) pointManualSet.add(m);
    }
  }
  if (pointFixed) {
    issues.push(`§9 ${pointFixed} props de puntos corregidas (marker/escala/grupo)`);
  }
  if (pointManualCount) {
    issues.push(`§9 ${pointManualCount} features Point con fallos no auto-fixables (${[...pointManualSet].join(', ')})${pointManualSamples.length ? ` — ej: ${pointManualSamples.join(' | ')}` : ''}`);
    manual.push(...pointManualSet);
  }

  // geojsonText necesita re-serializarse si se tocó coords/colores/popups/paleta/puntos
  const geoDirty = coordFixed > 0 || colorFixed > 0 || popupFixed > 0 || paletteFixed > 0 || pointFixed > 0;
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

  return { issues, fixes, manual, geo, dirty: geoDirty, popupFixed, popupMissing, paletteFixed, paletteKind: palette.kind, pointFixed, pointManualCount };
}

// ── Deriva de metadatos SEO (check 10) ───────────────────────────
// La galería se sirve desde Firestore, pero el JSON-LD CollectionPage y el
// sitemap.xml son ficheros estáticos: cada mapa publicado debe aparecer en
// ambos (y ninguno despublicado debe quedarse). Este check detecta la deriva
// antes de desplegar.

const GALLERY_HTML_PATH = require('path').join(__dirname, '..', '..', 'gallery', 'index.html');
const SITEMAP_XML_PATH = require('path').join(__dirname, '..', '..', 'sitemap.xml');

// Extrae el slug de una URL de mapa de la galería. Soporta las dos formas
// usadas en el repo:
//   https://maña.com/gallery/?slug=<slug>
//   https://maña.com/gallery/<slug>/
function slugFromGalleryUrl(url) {
  if (!url) return '';
  const s = String(url).trim();
  const query = s.match(/\/gallery\/?\?(?:[^#]*&)?slug=([^&#]+)/i);
  if (query) {
    try { return decodeURIComponent(query[1]); } catch (_) { return query[1]; }
  }
  const landing = s.match(/\/gallery\/([^/?#]+)\/?(?:[?#].*)?$/i);
  if (landing) {
    try { return decodeURIComponent(landing[1]); } catch (_) { return landing[1]; }
  }
  return '';
}

// Lee el JSON-LD CollectionPage (script#ld-collection) de gallery/index.html.
// Devuelve { found, error, numberOfItems, itemCount, slugs, duplicates,
// positionsOk }.
function parseCollectionLd(html) {
  const result = {
    found: false,
    error: null,
    numberOfItems: null,
    itemCount: 0,
    slugs: [],
    invalidItems: 0,
    duplicates: [],
    positionsOk: true,
  };
  if (!html || typeof html !== 'string') {
    result.error = 'HTML de la galería vacío';
    return result;
  }
  const m = html.match(/<script[^>]*\bid=["']ld-collection["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) {
    result.error = 'no se encontró <script id="ld-collection">';
    return result;
  }
  let json;
  try {
    json = JSON.parse(m[1]);
  } catch (e) {
    result.error = `JSON-LD inválido: ${e.message}`;
    return result;
  }
  result.found = true;
  const main = json.mainEntity || {};
  result.numberOfItems = Number.isFinite(Number(main.numberOfItems)) ? Number(main.numberOfItems) : null;
  const items = Array.isArray(main.itemListElement) ? main.itemListElement : [];
  result.itemCount = items.length;
  for (const it of items) {
    const slug = slugFromGalleryUrl(it && it.url);
    if (slug) result.slugs.push(slug);
    else result.invalidItems++;
  }
  const seen = new Set();
  const dup = new Set();
  for (const s of result.slugs) {
    if (seen.has(s)) dup.add(s);
    seen.add(s);
  }
  result.duplicates = [...dup].sort();
  result.positionsOk = items.every((it, i) => Number(it && it.position) === i + 1);
  return result;
}

// Extrae los slugs de mapa de sitemap.xml (landings /gallery/<slug>/ o
// /gallery/?slug=<slug>), ignorando la URL raíz /gallery/.
function parseSitemapGallerySlugs(xml) {
  const slugs = [];
  if (!xml || typeof xml !== 'string') return slugs;
  for (const m of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    const slug = slugFromGalleryUrl(m[1]);
    if (slug) slugs.push(slug);
  }
  return slugs;
}

function diffSlugs(expected, actual) {
  const exp = new Set(expected);
  const act = new Set(actual);
  return {
    missing: [...exp].filter(s => !act.has(s)).sort(),
    extra: [...act].filter(s => !exp.has(s)).sort(),
  };
}

function duplicatesOf(list) {
  const seen = new Set();
  const dup = new Set();
  for (const s of list) {
    if (seen.has(s)) dup.add(s);
    seen.add(s);
  }
  return [...dup].sort();
}

// Compara la lista de slugs publicados (Firestore) con el JSON-LD y el
// sitemap. Devuelve { issues, published, collection, sitemap } donde cada
// issue es una línea legible; cualquier issue hace fallar la auditoría.
function auditSeoMetadata(publishedSlugs, { galleryHtml = '', sitemapXml = '' } = {}) {
  const issues = [];
  const published = [...new Set((publishedSlugs || []).filter(Boolean))].sort();
  const collection = parseCollectionLd(galleryHtml);
  const sitemapSlugs = parseSitemapGallerySlugs(sitemapXml);
  const sitemap = {
    slugs: sitemapSlugs,
    duplicates: duplicatesOf(sitemapSlugs),
  };

  // JSON-LD CollectionPage
  if (!collection.found) {
    issues.push(`JSON-LD CollectionPage: ${collection.error}`);
  } else {
    if (collection.numberOfItems == null) {
      issues.push('JSON-LD CollectionPage: numberOfItems ausente o no numérico');
    } else if (collection.numberOfItems !== collection.itemCount) {
      issues.push(`JSON-LD CollectionPage: numberOfItems=${collection.numberOfItems} ≠ itemListElement=${collection.itemCount}`);
    }
    if (collection.numberOfItems !== published.length) {
      issues.push(`JSON-LD CollectionPage: numberOfItems=${collection.numberOfItems} ≠ publicados en Firestore=${published.length}`);
    }
    if (collection.invalidItems) {
      issues.push(`JSON-LD CollectionPage: ${collection.invalidItems} itemListElement sin URL de mapa válida`);
    }
    if (collection.duplicates.length) {
      issues.push(`JSON-LD CollectionPage: slugs duplicados (${collection.duplicates.join(', ')})`);
    }
    if (!collection.positionsOk) {
      issues.push('JSON-LD CollectionPage: posiciones de itemListElement no consecutivas desde 1');
    }
    const d = diffSlugs(published, collection.slugs);
    if (d.missing.length) {
      issues.push(`JSON-LD CollectionPage: faltan ${d.missing.length} publicados (${d.missing.join(', ')})`);
    }
    if (d.extra.length) {
      issues.push(`JSON-LD CollectionPage: sobran ${d.extra.length} no publicados o inexistentes (${d.extra.join(', ')})`);
    }
  }

  // sitemap.xml
  if (sitemapSlugs.length === 0) {
    issues.push('sitemap.xml: no contiene ninguna URL de mapa (/gallery/<slug>/ o /gallery/?slug=)');
  } else {
    if (sitemap.duplicates.length) {
      issues.push(`sitemap.xml: slugs duplicados (${sitemap.duplicates.join(', ')})`);
    }
    const d = diffSlugs(published, sitemapSlugs);
    if (d.missing.length) {
      issues.push(`sitemap.xml: faltan ${d.missing.length} publicados (${d.missing.join(', ')})`);
    }
    if (d.extra.length) {
      issues.push(`sitemap.xml: sobran ${d.extra.length} no publicados o inexistentes (${d.extra.join(', ')})`);
    }
  }

  return { issues, published, collection, sitemap };
}

// ── Cobertura de landings y OG cards (check 11) ───────────────────
// Las landings estáticas gallery/<slug>/index.html y las tarjetas
// og-cards/<slug>.png se generan con scripts/generate-map-landings.js. Si un
// mapa se publica en Firestore pero no se regeneran, su landing y su OG card
// nunca llegan al repo: este check lo detecta antes del deploy.

const GALLERY_DIR_PATH = require('path').join(__dirname, '..', '..', 'gallery');
const OG_CARDS_DIR_PATH = require('path').join(__dirname, '..', '..', 'og-cards');

function auditLandingCoverage(publishedSlugs, {
  galleryDir = GALLERY_DIR_PATH,
  ogCardsDir = OG_CARDS_DIR_PATH,
} = {}) {
  const issues = [];
  const missingLandings = [];
  const landingsWithoutSlug = [];
  const missingOgCards = [];
  const orphanLandings = [];
  const orphanOgCards = [];
  const published = [...new Set((publishedSlugs || []).filter(Boolean))].sort();
  const publishedSet = new Set(published);

  for (const slug of published) {
    // Un slug con separadores no puede mapear a un directorio del repo.
    if (slug === '.' || slug === '..' || /[\\/]/.test(slug)) {
      issues.push(`slug inválido para landing/OG card: ${JSON.stringify(slug)}`);
      continue;
    }

    const landingPath = require('path').join(galleryDir, slug, 'index.html');
    if (!fs.existsSync(landingPath)) {
      missingLandings.push(slug);
    } else {
      let html = null;
      try {
        html = fs.readFileSync(landingPath, 'utf8');
      } catch (e) {
        issues.push(`no se pudo leer gallery/${slug}/index.html: ${e.message}`);
      }
      if (html !== null && !html.includes(slug)) landingsWithoutSlug.push(slug);
    }

    const ogPath = require('path').join(ogCardsDir, `${slug}.png`);
    let ogStat = null;
    try { ogStat = fs.existsSync(ogPath) ? fs.statSync(ogPath) : null; } catch (_) { ogStat = null; }
    if (!ogStat || !ogStat.isFile() || ogStat.size === 0) missingOgCards.push(slug);
  }

  if (missingLandings.length) {
    issues.push(`faltan ${missingLandings.length} landings gallery/<slug>/index.html (${missingLandings.join(', ')})`);
  }
  if (landingsWithoutSlug.length) {
    issues.push(`${landingsWithoutSlug.length} landings no contienen su slug (${landingsWithoutSlug.join(', ')})`);
  }
  if (missingOgCards.length) {
    issues.push(`faltan ${missingOgCards.length} OG cards og-cards/<slug>.png (${missingOgCards.join(', ')})`);
  }

  // Los mapas despublicados no deben dejar landings ni OG cards huérfanas:
  // el generador las retira, pero una ejecución antigua o un cambio manual
  // pueden dejarlas accesibles y desincronizadas con Firestore.
  const pathMod = require('path');
  try {
    if (fs.existsSync(galleryDir)) {
      for (const entry of fs.readdirSync(galleryDir)) {
        if (publishedSet.has(entry)) continue;
        let stat = null;
        try { stat = fs.statSync(pathMod.join(galleryDir, entry)); } catch (_) { stat = null; }
        if (stat && stat.isDirectory()) orphanLandings.push(entry);
      }
    }
  } catch (e) {
    issues.push(`no se pudo revisar gallery/ en busca de landings huérfanas: ${e.message}`);
  }
  try {
    if (fs.existsSync(ogCardsDir)) {
      for (const entry of fs.readdirSync(ogCardsDir)) {
        if (!/\.png$/i.test(entry)) continue;
        const slug = entry.slice(0, -4);
        if (publishedSet.has(slug)) continue;
        let stat = null;
        try { stat = fs.statSync(pathMod.join(ogCardsDir, entry)); } catch (_) { stat = null; }
        if (stat && stat.isFile()) orphanOgCards.push(slug);
      }
    }
  } catch (e) {
    issues.push(`no se pudo revisar og-cards/ en busca de tarjetas huérfanas: ${e.message}`);
  }
  orphanLandings.sort();
  orphanOgCards.sort();
  if (orphanLandings.length) {
    issues.push(`sobran ${orphanLandings.length} landings de mapas no publicados (${orphanLandings.join(', ')})`);
  }
  if (orphanOgCards.length) {
    issues.push(`sobran ${orphanOgCards.length} OG cards de mapas no publicados (${orphanOgCards.join(', ')})`);
  }

  return {
    issues,
    published,
    missingLandings,
    landingsWithoutSlug,
    missingOgCards,
    orphanLandings,
    orphanOgCards,
  };
}

// ── Metadatos de las landings (check 12) ──────────────────────────
// Cada landing estática es una página SEO independiente: necesita un título
// propio (no el genérico de la galería ni repetido entre mapas), una meta
// description con contenido, un canonical que apunte a su propio slug y un
// JSON-LD Dataset. Si el generador cambia o una landing se copia a mano, este
// check lo detecta antes del deploy.

// Títulos que no identifican ningún mapa: el de la galería y variantes.
const GENERIC_LANDING_TITLES = new Set([
  'maña maps',
  'maña maps galería',
  'maña maps — galería',
  'maña maps - galería',
  'maña maps gallery',
  'maña maps — gallery',
  'maña maps - gallery',
  'galería',
  'galeria',
  'gallery',
  'mapa',
]);

function decodeHtmlEntities(value) {
  return String(value == null ? '' : value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

// Atributos de una etiqueta HTML (<meta …>, <link …>) a un objeto en minúsculas.
function parseHtmlAttrs(tag) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g;
  let m;
  while ((m = re.exec(tag))) {
    attrs[m[1].toLowerCase()] = decodeHtmlEntities(m[2] != null ? m[2] : (m[3] != null ? m[3] : m[4]));
  }
  return attrs;
}

function hasDatasetType(value) {
  if (!value) return false;
  if (Array.isArray(value)) return value.some(hasDatasetType);
  if (typeof value === 'string') return value === 'Dataset';
  if (typeof value === 'object') {
    if (Array.isArray(value['@graph'])) return value['@graph'].some(hasDatasetType);
    if (value['@type'] === 'Dataset') return true;
    if (Array.isArray(value['@type'])) return value['@type'].includes('Dataset');
  }
  return false;
}

// Extrae los metadatos SEO de una landing: { title, description, canonical,
// dataset, jsonLdErrors }.
function parseLandingMetadata(html) {
  const out = { title: '', description: '', canonical: '', dataset: false, jsonLdErrors: [] };
  if (!html || typeof html !== 'string') return out;

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) out.title = decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, ' ').trim();

  const description = [];
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseHtmlAttrs(m[0]);
    if ((attrs.name || '').toLowerCase() === 'description') description.push(attrs.content || '');
  }
  out.description = description.find(v => String(v).trim()) || '';

  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseHtmlAttrs(m[0]);
    const rels = String(attrs.rel || '').toLowerCase().split(/\s+/);
    if (rels.includes('canonical')) {
      out.canonical = attrs.href || '';
      break;
    }
  }

  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let json;
    try {
      json = JSON.parse(m[1]);
    } catch (e) {
      out.jsonLdErrors.push(`JSON-LD inválido: ${e.message}`);
      continue;
    }
    if (hasDatasetType(json)) out.dataset = true;
  }

  return out;
}

// Quita el sufijo de marca del <title> para decidir si es genérico.
function landingTitleIsGeneric(title) {
  const base = String(title || '')
    .replace(/\s*[—–-]\s*maña maps\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return !base || GENERIC_LANDING_TITLES.has(base);
}

function auditLandingMetadata(publishedSlugs, { galleryDir = GALLERY_DIR_PATH } = {}) {
  const issues = [];
  const published = [...new Set((publishedSlugs || []).filter(Boolean))].sort();
  const details = {};
  const missingLandings = [];
  const missingTitle = [];
  const genericTitle = [];
  const missingDescription = [];
  const missingCanonical = [];
  const wrongCanonical = [];
  const missingDataset = [];
  const invalidJsonLd = [];
  const titlesBySlug = new Map();

  for (const slug of published) {
    if (slug === '.' || slug === '..' || /[\\/]/.test(slug)) {
      issues.push(`slug inválido para metadatos de landing: ${JSON.stringify(slug)}`);
      continue;
    }

    const landingPath = require('path').join(galleryDir, slug, 'index.html');
    let html = null;
    try {
      html = fs.readFileSync(landingPath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') {
        missingLandings.push(slug);
      } else {
        issues.push(`no se pudo leer gallery/${slug}/index.html: ${e.message}`);
      }
      continue;
    }

    const meta = parseLandingMetadata(html);
    details[slug] = meta;
    if (meta.title) titlesBySlug.set(slug, meta.title);

    if (!meta.title) {
      missingTitle.push(slug);
    } else if (landingTitleIsGeneric(meta.title)) {
      genericTitle.push(slug);
    }
    if (!String(meta.description || '').trim()) missingDescription.push(slug);
    if (!meta.canonical) {
      missingCanonical.push(slug);
    } else {
      const canonicalSlug = slugFromGalleryUrl(meta.canonical);
      if (canonicalSlug !== slug) wrongCanonical.push({ slug, href: meta.canonical, canonicalSlug });
    }
    if (meta.jsonLdErrors.length) invalidJsonLd.push({ slug, errors: meta.jsonLdErrors });
    if (!meta.dataset) missingDataset.push(slug);
  }

  // Títulos repetidos entre landings: no son «propios» aunque no sean genéricos.
  const byTitle = new Map();
  for (const [slug, title] of titlesBySlug) {
    const key = title.toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, { title, slugs: [] });
    byTitle.get(key).slugs.push(slug);
  }
  const duplicateTitles = [...byTitle.values()]
    .filter(g => g.slugs.length > 1)
    .map(g => ({ title: g.title, slugs: g.slugs.sort() }))
    .sort((a, b) => a.title.localeCompare(b.title));

  if (missingLandings.length) {
    issues.push(`faltan ${missingLandings.length} landings gallery/<slug>/index.html (${missingLandings.join(', ')})`);
  }
  if (missingTitle.length) {
    issues.push(`${missingTitle.length} landings sin <title> (${missingTitle.join(', ')})`);
  }
  if (genericTitle.length) {
    issues.push(`${genericTitle.length} landings con <title> genérico (${genericTitle.join(', ')})`);
  }
  if (duplicateTitles.length) {
    for (const d of duplicateTitles) {
      issues.push(`títulos de landing duplicados: "${d.title}" (${d.slugs.join(', ')})`);
    }
  }
  if (missingDescription.length) {
    issues.push(`${missingDescription.length} landings sin meta description (${missingDescription.join(', ')})`);
  }
  if (missingCanonical.length) {
    issues.push(`${missingCanonical.length} landings sin canonical (${missingCanonical.join(', ')})`);
  }
  for (const c of wrongCanonical) {
    const found = c.canonicalSlug ? `apunta a ${c.canonicalSlug}` : 'sin slug de mapa';
    issues.push(`canonical incorrecto en ${c.slug} (${found}: ${c.href})`);
  }
  if (invalidJsonLd.length) {
    for (const j of invalidJsonLd) {
      issues.push(`JSON-LD inválido en ${j.slug} (${j.errors.join('; ')})`);
    }
  }
  if (missingDataset.length) {
    issues.push(`${missingDataset.length} landings sin JSON-LD Dataset (${missingDataset.join(', ')})`);
  }

  return {
    issues,
    published,
    details,
    missingLandings,
    missingTitle,
    genericTitle,
    duplicateTitles,
    missingDescription,
    missingCanonical,
    wrongCanonical,
    missingDataset,
    invalidJsonLd,
  };
}

// ── Higiene de metadatos (check 13) ───────────────────────────────
// La description alimenta la tarjeta y la landing de cada mapa, y dataDate se
// muestra como fuente. Una descripción demasiado corta no aporta contexto, una
// demasiado larga se corta en la UI y dos descripciones idénticas restan
// credibilidad SEO. dataDate debe poder ordenarse y compararse: ISO 8601
// (YYYY o YYYY-MM-DD).

const DESCRIPTION_MIN_LEN = 60;
const DESCRIPTION_MAX_LEN = 200;
const ISO_YEAR_RE = /^\d{4}$/;

function textLength(value) {
  return [...String(value == null ? '' : value)].length;
}

function normalizeDescription(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function isValidDescription(value) {
  const len = textLength(normalizeDescription(value));
  return len >= DESCRIPTION_MIN_LEN && len <= DESCRIPTION_MAX_LEN;
}

// YYYY o YYYY-MM-DD, comprobando que la fecha existe en el calendario.
function isValidIsoDataDate(value) {
  const s = String(value == null ? '' : value).trim();
  if (ISO_YEAR_RE.test(s)) return true;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

// Normaliza a ISO 8601 los formatos habituales del repo. Devuelve null si no
// hay una conversión inequívoca (p. ej. texto libre), que se reporta MANUAL.
function normalizeDataDate(value) {
  const s = String(value == null ? '' : value).trim();
  if (isValidIsoDataDate(s)) return s;

  // YYYY-MM → primer día del mes.
  let m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const candidate = `${m[1]}-${m[2]}-01`;
    if (isValidIsoDataDate(candidate)) return candidate;
    return null;
  }

  // Rango de años (2024-2025, 1991-2020) → último día del año final.
  m = s.match(/^(\d{4})[-/](\d{4})$/);
  if (m && Number(m[2]) >= Number(m[1])) return `${m[2]}-12-31`;

  // ISO con hora (2025-01-01T00:00:00Z) → solo la fecha.
  m = s.match(/^(\d{4}-\d{2}-\d{2})[T ]/);
  if (m && isValidIsoDataDate(m[1])) return m[1];

  return null;
}

// Recorta a max caracteres por límite de frase; si la primera frase ya es
// demasiado larga, corta en palabra completa y cierra con punto.
function shortenDescription(value, max = DESCRIPTION_MAX_LEN) {
  const clean = normalizeDescription(value);
  if (textLength(clean) <= max) return clean;

  // Solo son límites de frase los signos seguidos de espacio o final: así no
  // se parte «PM2.5», «NY.GDP.PCAP.CD» ni los decimales con punto.
  const sentences = [];
  const boundaryRe = /[.!?]+(?:["»”’']+)?(?=\s|$)/g;
  let start = 0;
  let match;
  while ((match = boundaryRe.exec(clean))) {
    const end = match.index + match[0].length;
    const sentence = clean.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
  }
  const tail = clean.slice(start).trim();
  if (tail) sentences.push(tail);

  let acc = '';
  for (const sentence of sentences) {
    const candidate = acc ? `${acc} ${sentence}` : sentence;
    if (textLength(candidate) > max) break;
    acc = candidate;
  }
  if (textLength(acc) >= DESCRIPTION_MIN_LEN && /[.!?]$/.test(acc)) return acc;

  // Corte de emergencia en palabra completa, sin dejar un token a medias.
  let cut = [...clean].slice(0, max - 1).join('');
  cut = cut.replace(/\s+\S*$/, '').replace(/[\s,;:—–-]+$/, '').trim();
  if (!cut) cut = [...clean].slice(0, max - 1).join('').trim();
  const openParens = (cut.match(/\(/g) || []).length;
  const closeParens = (cut.match(/\)/g) || []).length;
  if (openParens > closeParens) cut += ')'.repeat(openParens - closeParens);
  if (!/[.!?]$/.test(cut)) cut = cut.replace(/["»”’']+$/, '') + '.';
  return cut;
}

// Amplía una descripción ausente o demasiado corta con el título del mapa,
// que es único, para que supere el mínimo sin inventar datos.
function expandDescription(value, map, max = DESCRIPTION_MAX_LEN) {
  const base = normalizeDescription(value);
  if (textLength(base) >= DESCRIPTION_MIN_LEN) return shortenDescription(base, max);
  const title = normalizeDescription(map && (map.title || map.name || map.id)) || 'este mapa';
  let out = base ? `${base} Mapa de ${title}.` : `Mapa de ${title}.`;
  if (textLength(out) < DESCRIPTION_MIN_LEN) {
    out += ' Datos citados en la ficha del mapa, parte de la galería de Maña Maps.';
  }
  return shortenDescription(out, max);
}

// Audita description (60–200, única) y dataDate (ISO 8601) de los mapas
// publicados. Devuelve { issues, fixes, details, manual }:
//   - issues: líneas legibles, una por incidencia
//   - fixes: { slug: { description?, dataDate? } } para PATCH en Firestore
//   - details: { slug: { description, dataDate, issues } } valores tras el fix
//   - manual: incidencias sin corrección inequívoca
function auditMetadataHygiene(maps) {
  const issues = [];
  const fixes = {};
  const details = {};
  const manual = [];
  const list = (Array.isArray(maps) ? maps : [])
    .filter(m => m && m.id)
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  // 1) Validación individual de description y dataDate.
  for (const map of list) {
    const rawDesc = normalizeDescription(map.description);
    const rawDate = String(map.dataDate == null ? '' : map.dataDate).trim();
    const localIssues = [];
    let description = rawDesc;
    let dataDate = rawDate;
    let dateManual = false;
    const fix = {};

    if (!rawDesc) {
      localIssues.push('description ausente');
      description = expandDescription('', map);
      fix.description = description;
    } else if (textLength(rawDesc) < DESCRIPTION_MIN_LEN) {
      localIssues.push(`description demasiado corta (${textLength(rawDesc)} < ${DESCRIPTION_MIN_LEN} caracteres)`);
      description = expandDescription(rawDesc, map);
      fix.description = description;
    } else if (textLength(rawDesc) > DESCRIPTION_MAX_LEN) {
      localIssues.push(`description demasiado larga (${textLength(rawDesc)} > ${DESCRIPTION_MAX_LEN} caracteres)`);
      description = shortenDescription(rawDesc, DESCRIPTION_MAX_LEN);
      fix.description = description;
    }

    if (!isValidIsoDataDate(rawDate)) {
      const normalized = normalizeDataDate(rawDate);
      if (normalized) {
        dataDate = normalized;
        localIssues.push(`dataDate no ISO 8601 (${rawDate}) → ${normalized}`);
        fix.dataDate = normalized;
      } else {
        dateManual = true;
        localIssues.push(`dataDate no ISO 8601 sin normalización segura (${rawDate})`);
      }
    }

    details[map.id] = { description, dataDate, issues: localIssues };
    if (Object.keys(fix).length) fixes[map.id] = fix;
    if (dateManual) manual.push({ slug: map.id, issues: localIssues });
    for (const issue of localIssues) issues.push(`${map.id}: ${issue}`);
  }

  // 2) Unicidad: tras los recortes puede haber descripciones repetidas. Se
  // prefija el título (y el slug como último recurso) a las posteriores.
  const byDescription = new Map();
  for (const map of list) {
    const desc = details[map.id].description;
    const key = desc.toLowerCase();
    if (!byDescription.has(key)) byDescription.set(key, []);
    byDescription.get(key).push(map);
  }
  for (const group of byDescription.values()) {
    if (group.length < 2) continue;
    for (const map of group.slice(1)) {
      const title = normalizeDescription(map.title || map.name || map.id) || map.id;
      let candidate = shortenDescription(`${title}. ${details[map.id].description}`, DESCRIPTION_MAX_LEN);
      if (candidate.toLowerCase() === details[group[0].id].description.toLowerCase()) {
        candidate = shortenDescription(`${title} (${map.id}). ${details[map.id].description}`, DESCRIPTION_MAX_LEN);
      }
      details[map.id].description = candidate;
      details[map.id].issues.push('description duplicada');
      issues.push(`${map.id}: description duplicada`);
      fixes[map.id] = Object.assign({}, fixes[map.id], { description: candidate });
    }
  }

  // 3) Verificación final: cualquier valor que siga fuera de norma es MANUAL.
  for (const map of list) {
    const finalDesc = details[map.id].description;
    if (!isValidDescription(finalDesc)) {
      const msg = `description final fuera de rango (${textLength(finalDesc)} caracteres)`;
      details[map.id].issues.push(msg);
      issues.push(`${map.id}: ${msg}`);
      if (!manual.some(m => m.slug === map.id)) manual.push({ slug: map.id, issues: details[map.id].issues });
      delete fixes[map.id];
    }
  }

  return { issues, fixes, details, manual };
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
        description: extractField(doc, 'description'),
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

  // 10. Deriva de metadatos SEO (Firestore ↔ JSON-LD CollectionPage ↔ sitemap).
  let seo = null;
  try {
    const fsMod = require('fs');
    seo = auditSeoMetadata(published.map(m => m.id), {
      galleryHtml: fsMod.readFileSync(GALLERY_HTML_PATH, 'utf8'),
      sitemapXml: fsMod.readFileSync(SITEMAP_XML_PATH, 'utf8'),
    });
  } catch (e) {
    seo = { issues: [`no se pudieron leer gallery/index.html o sitemap.xml: ${e.message}`] };
  }
  console.log('SEO DRIFT | ISSUES');
  console.log('----------|-------');
  if (seo.issues.length === 0) {
    console.log(`OK: ${published.length} publicados sincronizados con JSON-LD CollectionPage y sitemap.xml`);
  } else {
    for (const issue of seo.issues) console.log(`DRIFT: ${issue}`);
  }
  console.log('');

  // 11. Cobertura de landings estáticas y OG cards.
  let coverage = null;
  try {
    coverage = auditLandingCoverage(published.map(m => m.id));
  } catch (e) {
    coverage = { issues: [`no se pudieron comprobar landings/OG cards: ${e.message}`] };
  }
  console.log('LANDINGS / OG | ISSUES');
  console.log('--------------|-------');
  if (coverage.issues.length === 0) {
    console.log(`OK: ${published.length} publicados con landing /gallery/<slug>/ y OG card /og-cards/<slug>.png`);
  } else {
    for (const issue of coverage.issues) console.log(`FALTA: ${issue}`);
  }
  console.log('');

  // 12. Metadatos SEO de cada landing (title, description, canonical, Dataset).
  let landingMeta = null;
  try {
    landingMeta = auditLandingMetadata(published.map(m => m.id));
  } catch (e) {
    landingMeta = { issues: [`no se pudieron comprobar los metadatos de las landings: ${e.message}`] };
  }
  console.log('LANDING META | ISSUES');
  console.log('-------------|-------');
  if (landingMeta.issues.length === 0) {
    console.log(`OK: ${published.length} landings con title propio, meta description, canonical y JSON-LD Dataset`);
  } else {
    for (const issue of landingMeta.issues) console.log(`META: ${issue}`);
  }
  console.log('');

  // 13. Higiene de metadatos: description 60–200 única y dataDate ISO 8601.
  let hygiene = null;
  try {
    hygiene = auditMetadataHygiene(published);
  } catch (e) {
    hygiene = {
      issues: [`no se pudo auditar la higiene de metadatos: ${e.message}`],
      fixes: {}, details: {}, manual: [],
    };
  }
  console.log('METADATA HYGIENE | ISSUES');
  console.log('-----------------|-------');
  if (hygiene.issues.length === 0) {
    console.log(`OK: ${published.length} descripciones de ${DESCRIPTION_MIN_LEN}–${DESCRIPTION_MAX_LEN} caracteres, únicas, y dataDate en ISO 8601`);
  } else {
    for (const issue of hygiene.issues) console.log(`HYGIENE: ${issue}`);
  }
  console.log('');

  let hygieneErrors = hygiene.manual.length;
  let hygieneFixed = 0;
  const hygieneFixSlugs = Object.keys(hygiene.fixes || {}).sort();
  for (const slug of hygieneFixSlugs) {
    const fix = hygiene.fixes[slug];
    const map = published.find(m => m.id === slug) || {};
    const summary = Object.keys(fix)
      .map(k => `${k}: ${JSON.stringify(map[k])} → ${JSON.stringify(fix[k])}`)
      .join(', ');
    if (DRY_RUN) {
      console.log(`FIX (dry-run) ${slug}: ${summary}`);
      hygieneFixed++;
      continue;
    }
    const mask = Object.keys(fix).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    const fields = {};
    for (const [key, value] of Object.entries(fix)) fields[key] = fsStr(value);
    const res = await fsReq('PATCH', `/${COLLECTION}/${slug}?${mask}`, { fields });
    if (res.status >= 400) {
      console.error(`  ✗ HYGIENE UPDATE failed ${slug} (${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
      hygieneErrors++;
      continue;
    }
    const verify = await fsReq('GET', `/${COLLECTION}/${slug}`);
    const vDesc = verify.status === 200 ? extractField(verify.data, 'description') : null;
    const vDate = verify.status === 200 ? extractField(verify.data, 'dataDate') : null;
    const bad = [];
    if (fix.description !== undefined && vDesc !== fix.description) bad.push('description no coincide');
    if (fix.dataDate !== undefined && vDate !== fix.dataDate) bad.push('dataDate no coincide');
    if (bad.length) {
      console.error(`  ✗ HYGIENE Verify FAILED ${slug}: ${bad.join('; ')}`);
      hygieneErrors++;
    } else {
      console.log(`  ✓ HYGIENE Updated ${slug}: ${summary}`);
      hygieneFixed++;
    }
  }
  if (DRY_RUN) hygieneErrors += hygieneFixSlugs.length;

  console.log('SLUG | ISSUES');
  console.log('-----|-------');

  let mapsAudited = 0, mapsOk = 0, mapsFixed = 0, mapsManual = 0, errors = seo.issues.length + coverage.issues.length + landingMeta.issues.length + hygieneErrors;
  let popupFixedTotal = 0, popupMissingTotal = 0, paletteFixedTotal = 0;
  let pointFixedTotal = 0, pointManualTotal = 0;
  const manualList = [];

  for (const map of published) {
    mapsAudited++;
    const { issues, fixes, manual, popupFixed = 0, popupMissing = 0, paletteFixed = 0, pointFixed = 0, pointManualCount = 0 } = auditMap(map);
    popupFixedTotal += popupFixed;
    popupMissingTotal += popupMissing;
    paletteFixedTotal += paletteFixed;
    pointFixedTotal += pointFixed;
    pointManualTotal += pointManualCount;

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
            let pointBad = 0;
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
              // §9: tras el fix, toda feature Point debe cumplir lo auto-fixable
              // (nombre, marker id válido, escala, grupo). «Área con punto» es
              // MANUAL y no bloquea la verificación.
              if (f.geometry && f.geometry.type === 'Point') {
                const vf = pointFeatureVerifyFails(p, MARKER_IDS);
                if (vf.length) pointBad++;
              }
            }
            if (bad) verifyIssues.push(`${bad} features aún con coords/colores inválidos`);
            if (popupBad) verifyIssues.push(`${popupBad} features aún sin datos de popup tras fix (§5)`);
            if (pointBad) verifyIssues.push(`${pointBad} features Point aún incumplen lo auto-fixable (§9)`);
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
  console.log(`Puntos (AGENTS.md §9): ${pointFixedTotal} props corregidas (marker/escala/grupo), ${pointManualTotal} features con fallos no auto-fixables`);
  console.log(`Deriva SEO (check 10): ${seo.issues.length === 0 ? 'OK' : `${seo.issues.length} desajustes entre Firestore, JSON-LD y sitemap`}`);
  console.log(`Cobertura landings/OG (check 11): ${coverage.issues.length === 0 ? 'OK' : `${coverage.issues.length} incidencias`}`);
  console.log(`Metadatos landings (check 12): ${landingMeta.issues.length === 0 ? 'OK' : `${landingMeta.issues.length} incidencias`}`);
  console.log(`Higiene metadatos (check 13): ${hygiene.issues.length === 0 && hygieneErrors === 0 ? 'OK' : `${hygiene.issues.length} incidencias, ${hygieneFixed} mapa(s) corregido(s), ${hygiene.manual.length} manual(es)`}`);
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
  MARKER_IDS,
  POINT_DEFAULT_EMOJI_SIZE,
  AREA_ENTITY_NAME_RE,
  loadMarkerCatalogIds,
  isAreaEntityName,
  hasMarkerScale,
  pointFeatureVerifyFails,
  auditPointFeature,
  extractField,
  normalizeHexColor,
  auditCoordinates,
  concreteDataKeys,
  hasConcreteValue,
  isDenyPopupKey,
  auditMap,
  auditSemanticPalette,
  slugFromGalleryUrl,
  parseCollectionLd,
  parseSitemapGallerySlugs,
  diffSlugs,
  duplicatesOf,
  auditSeoMetadata,
  GALLERY_HTML_PATH,
  SITEMAP_XML_PATH,
  auditLandingCoverage,
  parseLandingMetadata,
  auditLandingMetadata,
  landingTitleIsGeneric,
  decodeHtmlEntities,
  hasDatasetType,
  GALLERY_DIR_PATH,
  OG_CARDS_DIR_PATH,
  DESCRIPTION_MIN_LEN,
  DESCRIPTION_MAX_LEN,
  textLength,
  normalizeDescription,
  isValidDescription,
  isValidIsoDataDate,
  normalizeDataDate,
  shortenDescription,
  expandDescription,
  auditMetadataHygiene,
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
