# highest-airports-world — fuentes

Censo de aeropuertos con vuelos regulares de pasajeros a 3.000 m o más de
altitud. Datos consultados el 17-11-2026.

## Qué se versiona

- `airports.json`: extracto curado del censo (26 aeropuertos) con altitud,
  coordenadas, longitud de pista y descripción.
- `infoboxes.json`: fichas de Wikipedia usadas para pista y apertura cuando
  OurAirports no las recoge.
- `wiki.json`: volcado de la lista de Wikipedia «List of highest airports».
- `airports.csv` y `runways.csv`: extractos de OurAirports **filtrados** a los
  26 `iata_code` del censo y sus 32 pistas (mismas columnas que el original).

No se versionan los CSV completos de OurAirports (`airports.csv` 12,2 MB y
`runways.csv` 3,8 MB): superan el límite de 3 MB por archivo de
`scripts/tools/check-repo-hygiene.js` y engordan el repo con 86.368 aeródromos
y 48.430 pistas de los que solo se usan 26 y 32.

## Cómo regenerar los extractos

```bash
curl -sSLo /tmp/ourairports-airports.csv https://davidmegginson.github.io/ourairports-data/airports.csv
curl -sSLo /tmp/ourairports-runways.csv https://davidmegginson.github.io/ourairports-data/runways.csv
```

Después filtra por los `iata` de `airports.json` (`airports.csv`, columna
`iata_code`) y por los `ident` resultantes (`runways.csv`, columna
`airport_ident`), conservando la cabecera.

## Fuentes

- Wikipedia — [List of highest airports](https://en.wikipedia.org/wiki/List_of_highest_airports).
- OurAirports — [airports.csv](https://davidmegginson.github.io/ourairports-data/airports.csv)
  y [runways.csv](https://davidmegginson.github.io/ourairports-data/runways.csv).
