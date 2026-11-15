# Fuentes — housing-price-spain

- `provincias.json`: valor tasado medio de vivienda libre (€/m²) de las 52
  provincias y ciudades autónomas y su variación anual del último trimestre
  publicado (2026 T2). Extraído de la Tabla 1 del Boletín estadístico del
  Ministerio de Vivienda y Agenda Urbana (Estadística de Valor Tasado de la
  Vivienda, ETDP):
  <https://apps.fomento.gob.es/BoletinOnline2/sedal/35101000.XLS> (consultado el
  2026-11-15). El CSV equivalente en datos abiertos
  (`VDP006_01.csv`, <https://datos.gob.es/catalogo/e05233601-valor-tasado-de-la-vivienda>)
  no incluye Asturias, Madrid, Murcia ni Navarra por ser comunidades
  uniprovinciales, así que se usa el boletín oficial completo.
- `nuts3-es-2021.geojson`: límites provinciales oficiales de Eurostat GISCO,
  NUTS-3 2021 a escala 1:3M en EPSG:4326, filtrados a España
  (<https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_03M_2021_4326_LEVL_3.geojson>).
  Las Islas Canarias se agrupan en sus dos provincias (Las Palmas: ES704,
  ES705 y ES708; Santa Cruz de Tenerife: ES703, ES706, ES707 y ES709) y las
  Islas Baleares en una (ES531, ES532 y ES533).

`node scripts/maps/gen-housing-price-spain.js` combina ambos ficheros y genera
`data/maps/housing-price-spain.geojson`.
