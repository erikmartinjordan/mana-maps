'use strict';

// ── country-names-en-es.js ───────────────────────────────────────
// Diccionario EN → ES de países y territorios usado por los generadores de
// mapas y por la auditoría (AGENTS.md §4: contenido visible en español).
// Solo incluye los nombres cuya etiqueta española difiere del inglés: las
// formas idénticas (Chile, China, Argentina…) no necesitan traducción.
// Las claves extra (United States, Czechia, West Bank, Ivory Coast…) son
// alias de las fuentes OWID/Ember/Natural Earth para casar etiquetas.

const COUNTRY_NAMES_EN_ES = {
  "Afghanistan": "Afganistán",
  "Algeria": "Argelia",
  "Antigua and Barbuda": "Antigua y Barbuda",
  "Azerbaijan": "Azerbaiyán",
  "Bahrain": "Baréin",
  "Bangladesh": "Bangladés",
  "Belarus": "Bielorrusia",
  "Belgium": "Bélgica",
  "Belize": "Belice",
  "Benin": "Benín",
  "Bermuda": "Bermudas",
  "Bhutan": "Bután",
  "Bosnia and Herzegovina": "Bosnia y Herzegovina",
  "Botswana": "Botsuana",
  "Brazil": "Brasil",
  "Brunei": "Brunéi",
  "Burma": "Birmania",
  "Cambodia": "Camboya",
  "Cameroon": "Camerún",
  "Canada": "Canadá",
  "Cape Verde": "Cabo Verde",
  "Central African Republic": "República Centroafricana",
  "Comoros": "Comoras",
  "Congo": "República del Congo",
  "Côte d'Ivoire": "Costa de Marfil",
  "Croatia": "Croacia",
  "Curaçao": "Curazao",
  "Cyprus": "Chipre",
  "Czech Republic": "República Checa",
  "Czechia": "República Checa",
  "Democratic Republic of Congo": "República Democrática del Congo",
  "Democratic Republic of the Congo": "República Democrática del Congo",
  "Denmark": "Dinamarca",
  "Djibouti": "Yibuti",
  "Dominican Republic": "República Dominicana",
  "East Timor": "Timor Oriental",
  "Egypt": "Egipto",
  "Equatorial Guinea": "Guinea Ecuatorial",
  "eSwatini": "Suazilandia",
  "Ethiopia": "Etiopía",
  "Falkland Islands": "Islas Malvinas",
  "Federated States of Micronesia": "Estados Federados de Micronesia",
  "Fiji": "Fiyi",
  "Finland": "Finlandia",
  "France": "Francia",
  "French Southern and Antarctic Lands": "Tierras Australes y Antárticas Francesas",
  "Gabon": "Gabón",
  "Germany": "Alemania",
  "Greece": "Grecia",
  "Greenland": "Groenlandia",
  "Grenada": "Granada",
  "Guinea-Bissau": "Guinea-Bisáu",
  "Haiti": "Haití",
  "Hungary": "Hungría",
  "Iceland": "Islandia",
  "Iran": "Irán",
  "Iraq": "Irak",
  "Ireland": "Irlanda",
  "Italy": "Italia",
  "Ivory Coast": "Costa de Marfil",
  "Japan": "Japón",
  "Jordan": "Jordania",
  "Kazakhstan": "Kazajistán",
  "Kenya": "Kenia",
  "Kyrgyzstan": "Kirguistán",
  "Latvia": "Letonia",
  "Lebanon": "Líbano",
  "Lesotho": "Lesoto",
  "Libya": "Libia",
  "Lithuania": "Lituania",
  "Luxembourg": "Luxemburgo",
  "Macedonia": "Macedonia del Norte",
  "Malawi": "Malaui",
  "Malaysia": "Malasia",
  "Maldives": "Maldivas",
  "Mali": "Malí",
  "Marshall Islands": "Islas Marshall",
  "Mauritius": "Mauricio",
  "Mexico": "México",
  "Moldova": "Moldavia",
  "Monaco": "Mónaco",
  "Morocco": "Marruecos",
  "Myanmar": "Birmania",
  "Netherlands": "Países Bajos",
  "New Caledonia": "Nueva Caledonia",
  "New Zealand": "Nueva Zelanda",
  "Niger": "Níger",
  "North Korea": "Corea del Norte",
  "North Macedonia": "Macedonia del Norte",
  "Northern Cyprus": "República Turca del Norte de Chipre",
  "Norway": "Noruega",
  "Oman": "Omán",
  "Pakistan": "Pakistán",
  "Palau": "Palaos",
  "Palestine": "Palestina",
  "Panama": "Panamá",
  "Papua New Guinea": "Papúa Nueva Guinea",
  "Peru": "Perú",
  "Philippines": "Filipinas",
  "Poland": "Polonia",
  "Qatar": "Catar",
  "Republic of Serbia": "Serbia",
  "Republic of the Congo": "República del Congo",
  "Romania": "Rumania",
  "Russia": "Rusia",
  "Rwanda": "Ruanda",
  "Saint Kitts and Nevis": "San Cristóbal y Nieves",
  "Saint Lucia": "Santa Lucía",
  "Saint Vincent and the Grenadines": "San Vicente y las Granadinas",
  "São Tomé and Principe": "Santo Tomé y Príncipe",
  "São Tomé and Príncipe": "Santo Tomé y Príncipe",
  "Saudi Arabia": "Arabia Saudita",
  "Sierra Leone": "Sierra Leona",
  "Singapore": "Singapur",
  "Slovakia": "Eslovaquia",
  "Slovenia": "Eslovenia",
  "Solomon Islands": "Islas Salomón",
  "Somaliland": "Somalilandia",
  "South Africa": "Sudáfrica",
  "South Korea": "Corea del Sur",
  "South Sudan": "Sudán del Sur",
  "Spain": "España",
  "Sudan": "Sudán",
  "Suriname": "Surinam",
  "Swaziland": "Suazilandia",
  "Sweden": "Suecia",
  "Switzerland": "Suiza",
  "Syria": "Siria",
  "Taiwan": "República de China",
  "Tajikistan": "Tayikistán",
  "Thailand": "Tailandia",
  "The Bahamas": "Bahamas",
  "Timor-Leste": "Timor Oriental",
  "Trinidad and Tobago": "Trinidad y Tobago",
  "Tunisia": "Túnez",
  "Turkey": "Turquía",
  "Turkiye": "Turquía",
  "Turkmenistan": "Turkmenistán",
  "Ukraine": "Ucrania",
  "United Arab Emirates": "Emiratos Árabes Unidos",
  "United Kingdom": "Reino Unido",
  "United Republic of Tanzania": "Tanzania",
  "United States": "Estados Unidos",
  "United States of America": "Estados Unidos",
  "Uzbekistan": "Uzbekistán",
  "Vatican": "Ciudad del Vaticano",
  "Vatican City": "Ciudad del Vaticano",
  "West Bank": "Palestina",
  "Western Sahara": "Sahara Occidental",
  "Zimbabwe": "Zimbabue",
};

// Devuelve la etiqueta española de un topónimo inglés, o null si no es un
// país/territorio del diccionario (incluye los que no cambian de nombre).
function toSpanishCountryName(name) {
  if (typeof name !== 'string') return null;
  const key = name.trim();
  if (!key) return null;
  return Object.prototype.hasOwnProperty.call(COUNTRY_NAMES_EN_ES, key)
    ? COUNTRY_NAMES_EN_ES[key]
    : null;
}

// Campos visibles que deben estar en español. «name» es la etiqueta fuente de
// Natural Earth (en inglés) en la mayoría de coropletas, así que solo se
// revisa cuando la feature no tiene otra etiqueta visible.
const VISIBLE_LABEL_FIELDS = ['_manaName', 'País'];

function findEnglishToponyms(props) {
  if (!props || typeof props !== 'object') return [];
  const found = [];
  const hasVisible = VISIBLE_LABEL_FIELDS.some((f) => typeof props[f] === 'string' && props[f].trim());
  const fields = hasVisible ? VISIBLE_LABEL_FIELDS : ['name'];
  for (const field of fields) {
    const value = props[field];
    const es = toSpanishCountryName(value);
    if (es && es !== value.trim()) found.push({ field, value, spanish: es });
  }
  return found;
}

module.exports = {
  COUNTRY_NAMES_EN_ES,
  VISIBLE_LABEL_FIELDS,
  toSpanishCountryName,
  findEnglishToponyms,
};
