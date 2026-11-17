# deepest-lakes-world — fuentes

Lagos más profundos del mundo según la lista de Wikipedia «List of lakes by
depth» (consultada el 17-11-2026): 39 lagos con profundidad máxima superior a
400 m.

## Qué se versiona

- `wiki.json`: volcado de la página de Wikipedia con la tabla de profundidades
  (de aquí salen nombre, país, profundidad máxima y coordenadas).

La geometría de los lagos **no** se versiona: el GeoJSON de Natural Earth 10m
pesa 4,8 MB, por encima del límite de 3 MB por archivo de
`scripts/tools/check-repo-hygiene.js`. Se descarga al generar el mapa.

## Cómo regenerar la geometría

```bash
curl -sSLo /tmp/ne_10m_lakes.geojson \
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson
```

El fichero de Natural Earth tiene 1.355 lagos y solo cubre **24 de los 39**
lagos del censo (los demás son demasiado pequeños para la escala 1:10m o no son
lagos para Natural Earth: el Caspio figura como mar y el Vostok es subglaciar).
Nombres con los que aparecen en Natural Earth:

| Censo | Natural Earth |
| --- | --- |
| Baikal | Lake Baikal |
| Tanganyika | Lake Tanganyika |
| Viedma | Lago Viedma |
| O'Higgins-San Martín | Lago San Martín |
| Argentino | Lago Argentino |
| Malawi | Lake Malawi |
| Issyk Kul | Issyk-Kul |
| Great Slave | Great Slave Lake |
| General Carrera-Buenos Aires | Lago Buenos Aires |
| Toba | Danau Toba |
| Tahoe | Lake Tahoe |
| Kivu | Lake Kivu |
| Nahuel Huapi | Lago Nahuel Huapí |
| Hauroko | Lake Hauroko |
| Chelan | Lake Chelan |
| Mjøsa | Mjøsa |
| Van | Lake Van |
| Great Bear | Great Bear Lake |
| Manapouri | Lake Manapouri |
| Como | Lago di Como |
| Te Anau | Lake Te Anau |
| Khantayskoye | Ozero Khantayskoye / Khantayskoye Reservoir |
| Wakatipu | Lake Wakatipu |
| Superior | Lake Superior |

Sin polígono en Natural Earth 10m: Caspian Sea, Vostok, Crater, Matano,
Hornindalsvatnet, Quesnel, Sarez, Salvatnet, Cochrane/Pueyrredón, Tinn, Adams,
Poso, Fagnano, Tazawa y Grey. Para esos quince hay que buscar la geometría en
OSM/Wikidata antes de generar el mapa.

## Fuente

- Wikipedia — [List of lakes by depth](https://en.wikipedia.org/wiki/List_of_lakes_by_depth).
- Natural Earth — [ne_10m_lakes](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-lakes/).
