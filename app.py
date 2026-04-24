import os
from flask import Flask, send_from_directory, send_file

app = Flask(__name__, static_folder='.', static_url_path='')

# ── Landing ──
@app.route('/')
def landing():
    return send_file('index.html')

# ── Map editor ──
@app.route('/map')
@app.route('/map/')
def map_editor():
    return send_file('map/index.html')

# ── EN editor ──
@app.route('/en')
@app.route('/en/')
def en_editor():
    return send_file('en/index.html')

# ── About ──
@app.route('/about')
@app.route('/about/')
def about():
    return send_file('about/index.html')

# ── Changelog ──
@app.route('/changelog')
@app.route('/changelog/')
def changelog():
    return send_file('changelog/index.html')

# ── Open metrics ──
@app.route('/open')
@app.route('/open/')
def open_metrics():
    return send_file('open/index.html')

# ── Static files (CSS, JS, images, fonts) ──
@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('.', path)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    app.run(host='0.0.0.0', port=port)
