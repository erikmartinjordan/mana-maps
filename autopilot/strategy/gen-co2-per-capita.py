#!/usr/bin/env python3
"""
gen-co2-per-capita.py — Genera el GeoJSON del mapa de emisiones de CO2 per capita.

Fuente: Our World in Data (OWID), basado en IEA / CDIAC / Global Carbon Project.
Datos: anuales, ultimo ano disponible por pais (2024 en la mayoria).
Geometria: Natural Earth 110m (countries.geo.json).

Uso:
  python3 autopilot/strategy/gen-co2-per-capita.py
  -> genera data/co2-per-capita-world.geojson
"""

import json
import math
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
REPO_DIR = os.path.dirname(BASE_DIR)

CO2_DATA = os.path.join(SCRIPT_DIR, 'data', 'co2-per-capita', 'co2-owid-raw.json')
COUNTRIES_GEO = os.path.join(SCRIPT_DIR, 'data', 'countries.geo.json')
OUTPUT = os.path.join(REPO_DIR, 'data', 'co2-per-capita-world.geojson')

# OWID country name -> Natural Earth name aliases
NAME_MAP = {
    # OWID name -> Natural Earth 110m name
    'United States': 'United States of America',
    'Czech Republic': 'Czech Republic',
    'Czechia': 'Czech Republic',
    'Dominican Republic': 'Dominican Republic',
    'Eq. Guinea': 'Equatorial Guinea',
    'Dem. Rep. Congo': 'Democratic Republic of the Congo',
    'Central African Rep.': 'Central African Republic',
    'S. Sudan': 'South Sudan',
    'Solomon Is.': 'Solomon Islands',
    'W. Sahara': 'Western Sahara',
    'eSwatini': 'Swaziland',
    'N. Cyprus': 'Northern Cyprus',
    'Somaliland': 'Somaliland',
    'Falkland Is.': 'Falkland Islands',
    'Brunei Darussalam': 'Brunei',
    'Cabo Verde': 'Cabo Verde',
    'Cape Verde': 'Cabo Verde',
    'Timor-Leste': 'East Timor',
    'Eswatini': 'Swaziland',
    'North Macedonia': 'Macedonia',
    'Bosnia and Herz.': 'Bosnia and Herzegovina',
    'Lao PDR': 'Laos',
    'Kyrgyz Republic': 'Kyrgyzstan',
    'Russian Federation': 'Russia',
    'Iran (Islamic Republic of)': 'Iran',
    'Korea (Rep.)': 'South Korea',
    'Korea (DPRK)': 'North Korea',
    'Venezuela (Bolivarian Republic of)': 'Venezuela',
    'Bolivia (Plurinational State of)': 'Bolivia',
    'Tanzania (United Republic of)': 'United Republic of Tanzania',
    'Moldova (Republic of)': 'Moldova',
    'Viet Nam': 'Vietnam',
    'Syrian Arab Republic': 'Syria',
    'Palestine': 'West Bank',
    'United Kingdom': 'United Kingdom',
    'Cote d\'Ivoire': 'Ivory Coast',
    'Dem. People\'s Rep. Korea': 'North Korea',
    'United States of America': 'United States of America',
    'Micronesia (Fed. Sts.)': 'Micronesia',
    'Congo': 'Republic of the Congo',
    'Democratic Republic of Congo': 'Democratic Republic of the Congo',
    'Republic of Congo': 'Republic of the Congo',
    'Bahamas': 'The Bahamas',
    'The Bahamas': 'The Bahamas',
    'Cape Verde': 'Cabo Verde',
    'Swaziland': 'Swaziland',
    'Ivory Coast': 'Ivory Coast',
    'West Bank': 'West Bank',
    'Macedonia': 'Macedonia',
    'Guinea-Bissau': 'Guinea Bissau',
    'Laos': 'Laos',
    'St. Vincent and the Grenadines': 'St. Vincent and the Grenadines',
    'French Southern and Antarctic Lands': 'French Southern and Antarctic Lands',
    'Falkland Islands': 'Falkland Islands',
    'St. Pierre and Miquelon': 'St. Pierre and Miquelon',
    'Sint Maarten (Dutch part)': 'Sint Maarten',
    'St. Martin (French part)': 'St. Martin',
    'Heard I. and McDonald Is.': 'Heard I. and McDonald Is.',
    'South Sudan': 'South Sudan',
    'New Caledonia': 'New Caledonia',
    'Turks and Caicos Is.': 'Turks and Caicos Is.',
    'Cayman Is.': 'Cayman Is.',
    'Isle of Man': 'Isle of Man',
    'Faeroe Is.': 'Faeroe Is.',
    'Channel Is.': 'Channel Is.',
    'Puerto Rico': 'Puerto Rico',
    'Hong Kong': 'Hong Kong',
    'Macao': 'Macao',
    'Bermuda': 'Bermuda',
    'British Virgin Is.': 'British Virgin Is.',
    'U.S. Virgin Is.': 'U.S. Virgin Is.',
    'Guam': 'Guam',
    'American Samoa': 'American Samoa',
    'Northern Mariana Is.': 'Northern Mariana Is.',
    'Fr. S. Antarctic Lands': 'French Southern and Antarctic Lands',
    'Antarctica': 'Antarctica',
    'Mayotte': 'Mayotte',
    'Reunion': 'Reunion',
    'Martinique': 'Martinique',
    'Guadeloupe': 'Guadeloupe',
    'French Guiana': 'French Guiana',
    'Curacao': 'Curacao',
    'Aruba': 'Aruba',
    'Sao Tome and Principe': 'Sao Tome and Principe',
    'Republic of Serbia': 'Republic of Serbia',
    'Serbia': 'Republic of Serbia',
    'Kosovo': 'Kosovo',
}

# Colors: sequential red ramp from light (low CO2) to dark (high CO2)
# 7 stops, evenly spaced
COLOR_STOPS = [
    (255, 245, 240),   # very light peach (near 0)
    (254, 210, 190),   # light salmon
    (252, 165, 140),   # salmon
    (239, 110, 90),    # coral
    (210, 60, 60),     # medium red
    (170, 30, 40),     # dark red
    (110, 10, 20),     # very dark red (max)
]

def interpolate_color(t):
    """t in [0,1] -> RGB tuple from COLOR_STOPS."""
    t = max(0.0, min(1.0, t))
    n = len(COLOR_STOPS) - 1
    idx = t * n
    i = min(int(idx), n - 1)
    frac = idx - i
    r = int(COLOR_STOPS[i][0] + frac * (COLOR_STOPS[i+1][0] - COLOR_STOPS[i][0]))
    g = int(COLOR_STOPS[i][1] + frac * (COLOR_STOPS[i+1][1] - COLOR_STOPS[i][1]))
    b = int(COLOR_STOPS[i][2] + frac * (COLOR_STOPS[i+1][2] - COLOR_STOPS[i][2]))
    return f'#{r:02x}{g:02x}{b:02x}'

def normalize(value, min_val, max_val):
    """Normalize to [0,1] using log scale for better distribution."""
    if max_val <= min_val:
        return 0.5
    # Use log scale since CO2 values have huge range (0.01 to 41)
    log_val = math.log1p(value)
    log_min = math.log1p(min_val)
    log_max = math.log1p(max_val)
    if log_max <= log_min:
        return 0.5
    return (log_val - log_min) / (log_max - log_min)

def load_co2_data():
    with open(CO2_DATA, 'r') as f:
        return json.load(f)

def load_countries_geo():
    with open(COUNTRIES_GEO, 'r') as f:
        return json.load(f)

def build_name_index(geojson):
    """Build index: NE name -> feature."""
    idx = {}
    for feat in geojson['features']:
        name = feat['properties'].get('name', '')
        idx[name] = feat
    return idx

def resolve_name(owid_name):
    """Resolve OWID name to Natural Earth name."""
    if owid_name in NAME_MAP:
        return NAME_MAP[owid_name]
    return owid_name

def format_co2(value):
    """Format CO2 value for display."""
    if value < 1:
        return f'{value:.2f} t/persona'
    elif value < 10:
        return f'{value:.1f} t/persona'
    else:
        return f'{value:.0f} t/persona'

def get_region(country_name):
    """Rough region assignment for grouping."""
    african = ['Nigeria', 'Ethiopia', 'Egypt', 'DR Congo', 'Tanzania', 'South Africa',
               'Kenya', 'Uganda', 'Algeria', 'Sudan', 'Morocco', 'Angola', 'Mozambique',
               'Ghana', 'Madagascar', 'Cameroon', 'Ivory Coast', 'Niger', 'Mali',
               'Burkina Faso', 'Malawi', 'Zambia', 'Senegal', 'Chad', 'Somalia',
               'Zimbabwe', 'Guinea', 'Rwanda', 'Benin', 'Burundi', 'Tunisia',
               'South Sudan', 'Togo', 'Sierra Leone', 'Libya', 'Congo', 'Liberia',
               'Central African Rep.', 'Mauritania', 'Eritrea', 'Namibia', 'Gambia',
               'Botswana', 'Gabon', 'Lesotho', 'Guinea-Bissau', 'Eq. Guinea',
               'Mauritius', 'Eswatini', 'Djibouti', 'Falkland Is.', 'Western Sahara',
               'Sao Tome and Principe', 'Seychelles', 'Reunion', 'Mayotte']
    asian = ['China', 'India', 'Indonesia', 'Pakistan', 'Bangladesh', 'Japan',
             'Philippines', 'Vietnam', 'Turkey', 'Iran', 'Thailand', 'Myanmar',
             'South Korea', 'Iraq', 'Afghanistan', 'Saudi Arabia', 'Uzbekistan',
             'Malaysia', 'Nepal', 'North Korea', 'Taiwan', 'Sri Lanka', 'Kazakhstan',
             'Syria', 'Cambodia', 'Jordan', 'Azerbaijan', 'United Arab Emirates',
             'Tajikistan', 'Israel', 'Laos', 'Kyrgyzstan', 'Turkmenistan', 'Singapore',
             'Oman', 'Palestine', 'Kuwait', 'Georgia', 'Mongolia', 'Armenia',
             'Qatar', 'Bahrain', 'East Timor', 'Brunei', 'Bhutan', 'Macau',
             'Hong Kong', 'Lebanon', 'Yemen']
    european = ['Russia', 'Germany', 'United Kingdom', 'France', 'Italy', 'Spain',
                'Ukraine', 'Poland', 'Romania', 'Netherlands', 'Belgium', 'Czech Rep.',
                'Greece', 'Portugal', 'Sweden', 'Hungary', 'Belarus', 'Austria',
                'Serbia', 'Switzerland', 'Bulgaria', 'Denmark', 'Slovakia', 'Finland',
                'Norway', 'Ireland', 'Croatia', 'Moldova', 'Bosnia and Herz.',
                'Albania', 'North Macedonia', 'Slovenia', 'Montenegro', 'Kosovo',
                'Estonia', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Iceland',
                'Cyprus', 'Andorra', 'Monaco', 'San Marino', 'Liechtenstein',
                'Faeroe Is.', 'Isle of Man', 'Channel Is.', 'Gibraltar', 'N. Cyprus',
                'Vatican']
    n_america = ['United States of America', 'Canada', 'Mexico', 'Guatemala', 'Honduras',
                 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama', 'Cuba', 'Jamaica',
                 'Haiti', 'Dominican Rep.', 'Trinidad and Tobago', 'Belize', 'Bahamas',
                 'Barbados', 'Saint Lucia', 'Grenada', 'Saint Vincent and the Grenadines',
                 'Antigua and Barbuda', 'Dominica', 'Saint Kitts and Nevis',
                 'Puerto Rico', 'Bermuda', 'Cayman Is.', 'Turks and Caicos Is.',
                 'British Virgin Is.', 'U.S. Virgin Is.', 'Guam', 'American Samoa',
                 'Northern Mariana Is.', 'Greenland', 'Saint Pierre and Miquelon',
                 'Aruba', 'Curacao', 'Sint Maarten', 'Saint Martin', 'Martinique',
                 'Guadeloupe', 'French Guiana']
    s_america = ['Brazil', 'Colombia', 'Argentina', 'Peru', 'Venezuela', 'Chile',
                 'Ecuador', 'Bolivia', 'Paraguay', 'Uruguay', 'Guyana', 'Suriname']
    oceania = ['Australia', 'New Zealand', 'Papua New Guinea', 'Fiji',
               'Solomon Islands', 'Vanuatu', 'Samoa', 'Tonga', 'Micronesia',
               'Kiribati', 'Marshall Islands', 'Palau', 'Nauru', 'Tuvalu',
               'New Caledonia']

    if country_name in african: return 'Africa'
    if country_name in asian: return 'Asia'
    if country_name in european: return 'Europa'
    if country_name in n_america: return 'N. America'
    if country_name in s_america: return 'S. America'
    if country_name in oceania: return 'Oceania'
    return 'Otros'

def build_geojson(co2_data, countries_geo):
    """Build the final FeatureCollection."""
    ne_index = build_name_index(countries_geo)
    
    # Filter CO2 data to only countries with geometry matches
    matched = []
    unmatched = []
    for entry in co2_data:
        owid_name = entry['country']
        ne_name = resolve_name(owid_name)
        if ne_name in ne_index:
            matched.append({**entry, 'ne_name': ne_name})
        else:
            unmatched.append(owid_name)
    
    if unmatched:
        print(f'WARNING: {len(unmatched)} countries without geometry:', file=sys.stderr)
        for u in unmatched[:20]:
            print(f'  - {u}', file=sys.stderr)
    
    # Find min/max for normalization
    values = [m['co2_per_capita'] for m in matched]
    min_val = min(values)
    max_val = max(values)
    print(f'CO2 range: {min_val:.3f} - {max_val:.3f} t/persona')
    print(f'Matched countries: {len(matched)}')
    
    features = []
    seen_names = set()
    
    for entry in matched:
        ne_name = entry['ne_name']
        co2 = entry['co2_per_capita']
        year = entry['year']
        country = entry['country']
        pop = entry['population']
        
        # Skip duplicates
        if ne_name in seen_names:
            continue
        seen_names.add(ne_name)
        
        # Get geometry from Natural Earth
        ne_feat = ne_index[ne_name]
        geometry = ne_feat['geometry']
        
        # Normalize color
        t = normalize(co2, min_val, max_val)
        color = interpolate_color(t)
        
        region = get_region(country)
        
        # Format population
        if pop >= 1e9:
            pop_str = f'{pop/1e9:.2f} mil M'
        elif pop >= 1e6:
            pop_str = f'{pop/1e6:.1f} M'
        elif pop >= 1e3:
            pop_str = f'{pop/1e3:.0f} K'
        else:
            pop_str = str(int(pop))
        
        # Determine label font size based on geometry complexity
        geom_type = geometry['type']
        if geom_type == 'MultiPolygon':
            total_coords = sum(len(ring) for poly in geometry['coordinates'] for ring in poly)
        elif geom_type == 'Polygon':
            total_coords = len(geometry['coordinates'][0]) if geometry['coordinates'] else 0
        else:
            total_coords = 0
        
        # Smaller countries get smaller labels
        label_size = 10 if total_coords > 200 else 11
        
        # Skip very small features (islands etc) from label to avoid clutter
        skip_label = total_coords < 10
        
        props = {
            '_manaName': ne_name,
            'name': country,
            '_manaColor': color,
            '_manaFillOpacity': 0.85,
            '_manaWeight': 0.7,
            '_manaBorderColor': '#FFFFFF',
            '_manaGroupName': 'CO2 per capita',
            '_manaGroupId': 'co2-per-capita',
            '_manaLabelStyle': {
                'enabled': not skip_label,
                'fontSize': label_size,
                'fontFamily': 'DM Sans, sans-serif',
                'fontWeight': '600',
                'color': '#1e293b',
                'haloWidth': 3,
                'haloColor': '#FFFFFF',
                'placement': 'point',
                'field': '_manaName'
            },
            'País': country,
            'Emisiones CO2 per cápita': format_co2(co2),
            'Emisiones CO2 per cápita (num)': co2,
            'Año': year,
            'Población': pop_str,
            'Región': region,
            'Superficie': region,
            'Dato': format_co2(co2),
            'Description': f'{country} — {format_co2(co2)} — {year}'
        }
        
        features.append({
            'type': 'Feature',
            'properties': props,
            'geometry': geometry
        })
    
    # Sort features by CO2 value (lowest first) for better rendering
    features.sort(key=lambda f: f['properties']['Emisiones CO2 per cápita (num)'])
    
    collection = {
        'type': 'FeatureCollection',
        'name': 'co2-per-capita-world',
        'features': features
    }
    
    return collection

def main():
    print('Loading CO2 data...')
    co2_data = load_co2_data()
    print(f'  {len(co2_data)} countries in dataset')
    
    print('Loading country geometries...')
    countries_geo = load_countries_geo()
    print(f'  {len(countries_geo["features"])} geometries')
    
    print('Building GeoJSON...')
    geojson = build_geojson(co2_data, countries_geo)
    
    # Validate
    print(f'\nValidation:')
    print(f'  Features: {len(geojson["features"])}')
    
    # Check coordinates within bounds
    coord_errors = 0
    for feat in geojson['features']:
        geom = feat['geometry']
        coords_list = []
        if geom['type'] == 'Polygon':
            coords_list = geom['coordinates'][0]
        elif geom['type'] == 'MultiPolygon':
            for poly in geom['coordinates']:
                coords_list.extend(poly[0])
        for c in coords_list:
            if abs(c[0]) > 180 or abs(c[1]) > 90:
                coord_errors += 1
    print(f'  Coordinate errors: {coord_errors}')
    
    # Check for duplicate names
    names = [f['properties']['_manaName'] for f in geojson['features']]
    dupes = [n for n in names if names.count(n) > 1]
    print(f'  Duplicate names: {len(set(dupes))}')
    
    # Check hex colors
    import re
    hex_pattern = re.compile(r'^#[0-9a-f]{6}$')
    bad_colors = [f['properties']['_manaName'] for f in geojson['features'] 
                  if not hex_pattern.match(f['properties']['_manaColor'])]
    print(f'  Invalid colors: {len(bad_colors)}')
    
    # Check labelStyles
    missing_labels = [f['properties']['_manaName'] for f in geojson['features']
                      if '_manaLabelStyle' not in f['properties']]
    print(f'  Missing labelStyles: {len(missing_labels)}')
    
    # CO2 stats
    vals = [f['properties']['Emisiones CO2 per cápita (num)'] for f in geojson['features']]
    print(f'\n  Min: {min(vals):.3f} t/persona')
    print(f'  Max: {max(vals):.3f} t/persona')
    print(f'  Median: {sorted(vals)[len(vals)//2]:.3f} t/persona')
    
    # Top 5 and bottom 5
    sorted_feats = sorted(geojson['features'], 
                          key=lambda f: f['properties']['Emisiones CO2 per cápita (num)'],
                          reverse=True)
    print(f'\n  Top 5 emisores:')
    for f in sorted_feats[:5]:
        p = f['properties']
        print(f"    {p['País']}: {p['Emisiones CO2 per cápita']}")
    print(f'  Bottom 5:')
    for f in sorted_feats[-5:]:
        p = f['properties']
        print(f"    {p['País']}: {p['Emisiones CO2 per cápita']}")
    
    # Write output
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, 'w') as f:
        json.dump(geojson, f, ensure_ascii=False)
    
    size_kb = os.path.getsize(OUTPUT) / 1024
    print(f'\nOutput: {OUTPUT}')
    print(f'Size: {size_kb:.1f} KB')
    if os.path.getsize(OUTPUT) > 1048576:
        print('WARNING: Exceeds 1 MiB Firestore limit!')
        sys.exit(1)
    
    print('\nDone!')

if __name__ == '__main__':
    main()
