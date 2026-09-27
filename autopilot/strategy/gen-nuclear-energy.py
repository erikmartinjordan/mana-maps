#!/usr/bin/env python3
"""Genera el GeoJSON del mapa de energía nuclear mundial.

Fuente: Our World in Data (OWID) energy dataset
  - nuclear_electricity: generación eléctrica nuclear en TWh
  - nuclear_elec_per_capita: generación per cápita en kWh
  - nuclear_share_elec: % de electricidad de origen nuclear
  Datos 2025 (último año disponible).
Geometrías: Natural Earth 1:110m (countries.geo.json del repo).

Salida: ../../data/nuclear-energy-world.geojson
"""

import csv
import json
import os
import sys

# ── Rutas ─────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, 'data', 'nuclear-energy-world')
GEO_PATH = os.path.join(SCRIPT_DIR, 'data', 'countries.geo.json')
OUT_PATH = os.path.join(os.path.dirname(SCRIPT_DIR), '..', 'data', 'nuclear-energy-world.geojson')

YEAR = 2025  # último año con datos completos

# ── Mapeo OWID → GeoJSON country names ────────────────────────────
NAME_MAP = {
    'Czechia': 'Czech Republic',
    'United States': 'United States of America',
    'North Macedonia': 'Macedonia',
    'Congo': 'Republic of the Congo',
    'Democratic Republic of Congo': 'Democratic Republic of the Congo',
    "Cote d'Ivoire": 'Ivory Coast',
    'Eswatini': 'Swaziland',
    'Serbia': 'Republic of Serbia',
    'Palestine': 'West Bank',
    'Turkey': 'Turkey',
    'Timor-Leste': 'East Timor',
    'Guinea-Bissau': 'Guinea Bissau',
}

# Entidades no-país a excluir
EXCLUDE = {
    'American Samoa', 'Aruba', 'Bermuda', 'British Virgin Islands',
    'Cayman Islands', 'Faroe Islands', 'Gibraltar', 'Guam', 'Hong Kong',
    'Macao', 'Montserrat', 'Niue', 'Puerto Rico', 'Saint Helena',
    'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Pierre and Miquelon',
    'Saint Vincent and the Grenad Islands', 'Samoa', 'Sint Maarten',
    'Solomon Islands', 'Tokelau', 'Turks and Caicos Islands',
    'United States Virgin Islands',
    # Agregados regionales
    'ASEAN (Ember)', 'Africa (EI)', 'Africa (Ember)', 'Asia Pacific (EI)',
    'CIS (EI)', 'Central America (EI)', 'EU (Ember)', 'Eastern Africa (EI)',
    'Europe (EI)', 'G7 (Ember)', 'G20 (Ember)', 'Latin America and Caribbean (Ember)',
    'Middle Africa (EI)', 'Middle East (EI)', 'Middle East (Ember)',
    'Non-OECD (EI)', 'North America (EI)', 'OECD (EI)', 'OECD (Ember)',
    'Oceania (Ember)', 'South and Central America (EI)',
    'USSR', 'Western Africa (EI)',
}

# ── Cargar datos OWID ────────────────────────────────────────────
def load_owid_data():
    raw_path = os.path.join(DATA_DIR, 'owid-energy-raw.csv')
    countries = {}
    with open(raw_path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            country = row.get('country', '')
            year = row.get('year', '')
            if not year or int(year) != YEAR:
                continue
            if country in EXCLUDE:
                continue
            mapped = NAME_MAP.get(country, country)
            nuc_elec = row.get('nuclear_electricity', '')
            nuc_per_cap = row.get('nuclear_elec_per_capita', '')
            nuc_share = row.get('nuclear_share_elec', '')
            total_elec = row.get('electricity_generation', '')
            countries[mapped] = {
                'country_owid': country,
                'nuclear_electricity': float(nuc_elec) if nuc_elec else 0,
                'nuclear_elec_per_capita': float(nuc_per_cap) if nuc_per_cap else 0,
                'nuclear_share_elec': float(nuc_share) if nuc_share else 0,
                'total_electricity': float(total_elec) if total_elec else 0,
            }
    return countries


# ── Cargar geometrías ────────────────────────────────────────────
def load_geometries():
    with open(GEO_PATH, 'r') as f:
        data = json.load(f)
    return {f['properties']['name']: f for f in data['features']}


# ── Paleta secuencial (verde nuclear →ámbar) ──────────────────────
def twh_to_color(twh):
    """Convierte TWh de generación nuclear a color de la rampa.

    Rampa: crema (#FFF8E1) para 0 → verde bosque (#1B5E20) para max.
    """
    breakpoints = [
        (0,    '#FFF8E1'),   # crema claro
        (10,   '#C8E6C9'),   # verde claro
        (50,   '#66BB6A'),   # verde medio
        (100,  '#2E7D32'),   # verde oscuro
        (200,  '#1B5E20'),   # verde bosque
        (500,  '#0D3B0D'),   # verde muy oscuro
    ]
    for i in range(len(breakpoints) - 1):
        t1, c1 = breakpoints[i]
        t2, c2 = breakpoints[i + 1]
        if twh <= t2:
            t = (twh - t1) / (t2 - t1) if t2 != t1 else 0
            r1, g1, b1 = int(c1[1:3], 16), int(c1[3:5], 16), int(c1[5:7], 16)
            r2, g2, b2 = int(c2[1:3], 16), int(c2[3:5], 16), int(c2[5:7], 16)
            r = int(r1 + t * (r2 - r1))
            g = int(g1 + t * (g2 - g1))
            b = int(b1 + t * (b2 - b1))
            return f'#{r:02x}{g:02x}{b:02x}'
    return breakpoints[-1][1]


def format_number(n):
    """Formatea números con separadores de miles."""
    if n >= 1000:
        return f'{n:,.0f}'.replace(',', '.')
    elif n >= 1:
        return f'{n:.1f}'
    else:
        return f'{n:.2f}'


# ── Construir features ───────────────────────────────────────────
def build_features(owid, geos):
    features = []
    used_names = set()

    for geo_name, geo_feat in geos.items():
        data = owid.get(geo_name)
        if not data or data['nuclear_electricity'] <= 0:
            continue

        es_name = geo_name  # ya están en inglés; el mapa muestra datos en español

        if geo_name in used_names:
            continue
        used_names.add(geo_name)

        twh = data['nuclear_electricity']
        per_cap = data['nuclear_elec_per_capita']
        share = data['nuclear_share_elec']
        total = data['total_electricity']

        color = twh_to_color(twh)

        feature = {
            'type': 'Feature',
            'properties': {
                '_manaName': geo_name,
                'name': data['country_owid'],
                '_manaColor': color,
                '_manaFillOpacity': 0.85,
                '_manaBorderColor': '#ffffff',
                '_manaWeight': 1.5,
                '_manaGroupName': 'Energía Nuclear',
                '_manaGroupId': 'nuclear',
                '_manaGeometryType': 'polygon',
                '_manaLabelStyle': {
                    'enabled': True,
                    'field': '_manaName',
                    'fontFamily': 'DM Sans, sans-serif',
                    'fontSize': 11,
                    'fontWeight': '700',
                    'color': '#0f172a',
                    'haloWidth': 3,
                    'haloColor': '#ffffff',
                    'opacity': 0.95,
                    'placement': 'auto'
                },
                'Generación nuclear (TWh)': round(twh, 1),
                'Per cápita (kWh)': round(per_cap, 1),
                'Share eléctrico (%)': round(share, 1),
                'Electricidad total (TWh)': round(total, 1) if total else None,
                'Dato': f'{format_number(twh)} TWh',
                'Superficie': f'{format_number(per_cap)} kWh/hab',
                'Description': (
                    f'{geo_name}: {format_number(twh)} TWh de electricidad nuclear '
                    f'({share:.1f}% de su producción eléctrica total), '
                    f'{format_number(per_cap)} kWh por habitante.'
                ),
            },
            'geometry': geo_feat['geometry'],
        }
        features.append(feature)

    # Ordenar por TWh descendente para la leyenda
    features.sort(key=lambda f: -f['properties']['Generación nuclear (TWh)'])
    return features


# ── Main ──────────────────────────────────────────────────────────
def main():
    print('Cargando datos OWID...')
    owid = load_owid_data()
    print(f'  {len(owid)} países con datos nucleares en {YEAR}')

    print('Cargando geometrías Natural Earth...')
    geos = load_geometries()
    print(f'  {len(geos)} geometrías')

    features = build_features(owid, geos)
    print(f'  {len(features)} features construidas')

    geojson = {
        'type': 'FeatureCollection',
        'features': features
    }

    # Validaciones
    names = [f['properties']['_manaName'] for f in features]
    assert len(names) == len(set(names)), f'Nombres duplicados: {[n for n in names if names.count(n) > 1]}'

    for f in features:
        props = f['properties']
        assert props['_manaColor'].startswith('#'), f"Color inválido: {props['_manaColor']}"
        assert len(props['_manaColor']) == 7, f"Color hex inválido: {props['_manaColor']}"
        ls = props['_manaLabelStyle']
        assert ls['haloWidth'] >= 2, f"haloWidth < 2 en {props['_manaName']}"
        assert ls['enabled'] is True
        assert ls['field'] == '_manaName'

    # Coordenadas dentro de ±180/±90
    for f in features:
        geom = f['geometry']
        coords_list = []
        if geom['type'] == 'Polygon':
            coords_list = geom['coordinates']
        elif geom['type'] == 'MultiPolygon':
            for poly in geom['coordinates']:
                coords_list.extend(poly)
        for ring in coords_list:
            for lon, lat in ring:
                assert -180 <= lon <= 180, f"Lon fuera de rango: {lon}"
                assert -90 <= lat <= 90, f"Lat fuera de rango: {lat}"

    geojson_text = json.dumps(geojson)
    size_kb = len(geojson_text) / 1024
    print(f'Tamaño GeoJSON: {size_kb:.1f} KB')
    assert len(geojson_text) < 1048576, f'GeoJSON excede 1 MiB: {len(geojson_text)} bytes'

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w') as f:
        f.write(geojson_text)
    print(f'Guardado en {OUT_PATH}')
    print(f'featureCount: {len(features)}')

    # Resumen de los 10 principales
    print('\nTop 10 productores de energía nuclear (2025):')
    for i, feat in enumerate(features[:10], 1):
        p = feat['properties']
        print(f'  {i}. {p["_manaName"]}: {p["Generación nuclear (TWh)"]} TWh ({p["Share eléctrico (%)"]:.1f}%)')

    return geojson


if __name__ == '__main__':
    main()
