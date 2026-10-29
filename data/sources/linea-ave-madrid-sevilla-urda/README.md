# Línea de alta velocidad Madrid-Sevilla

Fuente: OpenStreetMap, relación [1254828](https://www.openstreetmap.org/relation/1254828)
«AVE Madrid - Sevilla» (`route=train`, `service=high_speed`, operador Renfe).
Consulta: 29 de octubre de 2026 (Overpass API).

El archivo `route-relation-1254828.json` es la respuesta cruda de Overpass
(`out geom`) y conserva la geometría de las 246 vías que componen la relación.
El generador `scripts/maps/gen-linea-ave-madrid-sevilla-urda.js` las une en una
sola línea, calcula la distancia acumulada desde Madrid-Puerta de Atocha y
sitúa el punto del accidente en el kilómetro 118.

Datos del accidente: Ministerio de Transportes, Gobierno de Castilla-La Mancha
y RTVE (28-29 de octubre de 2026). El punto se marca a la altura de la estación
de Urda, en el término municipal de Urda (Toledo).

Licencia de la geometría: © OpenStreetMap contributors, ODbL 1.0.
