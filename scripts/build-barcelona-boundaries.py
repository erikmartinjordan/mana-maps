#!/usr/bin/env python3
# ── build-barcelona-boundaries.py ─
# Genera data/barcelona-boundaries.geojson con los 10 distritos de Barcelona y
# el límite municipal (disolución de los distritos), a partir de la cartografía
# oficial del Ayuntamiento de Barcelona (dataset 20170706-districtes-barris).
#
# Uso: python3 scripts/build-barcelona-boundaries.py
import json
import urllib.request

from shapely import wkt
from shapely.geometry import mapping
from shapely.ops import unary_union

SOURCE_URL = (
    'https://opendata-ajuntament.barcelona.cat/data/dataset/808daafa-d9ce-48c0-925a-fa5afdb1ed41'
    '/resource/5f8974a7-7937-4b50-acbc-89204d570df9/download'
)
OUT = 'data/barcelona-boundaries.geojson'
TOLERANCE = 0.00003  # ~3 m: bordes entre distritos bien encajados

DISTRICT_LABEL_STYLE = {
    'enabled': True,
    'field': '_manaName',
    'fontFamily': 'monospace',
    'fontSize': 11,
    'fontWeight': 'bold',
    'color': '#1e293b',
    'haloWidth': 2,
    'haloColor': '#ffffff',
    'opacity': 0.92,
    'placement': 'auto',
}


def round_geom(geom, ndigits=5):
    return json.loads(json.dumps(mapping(geom)), parse_float=lambda v: round(float(v), ndigits))


def main():
    with urllib.request.urlopen(SOURCE_URL) as res:
        records = json.load(res)

    features = []
    geometries = []
    for r in records:
        geom = wkt.loads(r['geometria_wgs84'])
        if not geom.is_valid:
            geom = geom.buffer(0)
        geom = geom.simplify(TOLERANCE, preserve_topology=True)
        geometries.append(geom)
        features.append({
            'type': 'Feature',
            'properties': {
                '_manaName': r['nom_districte'],
                'name': r['nom_districte'],
                # Colour is assigned by the publisher from the library count.
                '_manaColor': '#dbeafe',
                '_manaFillOpacity': 0.55,
                '_manaWeight': 1.4,
                '_manaBorderColor': '#334155',
                '_manaGroupName': 'Distritos de Barcelona',
                '_manaGroupId': 2,
                '_manaGeometryType': 'polygon',
                '_manaLabelStyle': DISTRICT_LABEL_STYLE,
                'Distrito': r['nom_districte'],
                'Description': 'Distrito de %s (Barcelona).' % r['nom_districte'],
            },
            'geometry': round_geom(geom),
        })

    city = unary_union(geometries).simplify(TOLERANCE * 1.5, preserve_topology=True)
    features.append({
        'type': 'Feature',
        'properties': {
            '_manaName': 'Barcelona',
            'name': 'Barcelona',
            '_manaColor': '#0f172a',
            '_manaFillOpacity': 0.0,
            '_manaWeight': 3,
            '_manaBorderColor': '#0f172a',
            '_manaGroupName': 'Límite de Barcelona',
            '_manaGroupId': 3,
            '_manaGeometryType': 'polygon',
            '_manaLabelStyle': {
                'enabled': False,
                'field': '_manaName',
                'fontFamily': 'monospace',
                'fontSize': 13,
                'fontWeight': 'bold',
                'color': '#0f172a',
                'haloWidth': 3,
                'haloColor': '#ffffff',
                'opacity': 1,
                'placement': 'auto',
            },
            'Ciudad': 'Barcelona',
            'Description': 'Término municipal de Barcelona.',
        },
        'geometry': round_geom(city),
    })

    fc = {'type': 'FeatureCollection', 'features': features}
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(fc, fh, ensure_ascii=False, separators=(',', ':'))

    size = len(json.dumps(fc, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
    print('Wrote %s: %d features, %.1f KB' % (OUT, len(features), size / 1024))


if __name__ == '__main__':
    main()
