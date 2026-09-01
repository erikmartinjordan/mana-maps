#!/usr/bin/env bash
# post_map_to_x.sh - Publica un mapa (imagen + texto) en X.com
# Uso: post_map_to_x.sh <imagen.png> [texto] [link]
#
# Requiere credenciales X en ~/autopilot/x-credentials.json:
#   {
#     "api_key": "TU_API_KEY",
#     "api_secret": "TU_API_SECRET",
#     "access_token": "TU_ACCESS_TOKEN",
#     "access_token_secret": "TU_ACCESS_SECRET"
#   }
# Se obtienen en https://developer.x.com (app con permisos write + media upload).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRED="$ROOT/x-credentials.json"
IMAGE="${1:-}"
TEXT="${2:-}"
LINK="${3:-}"

[ -f "$CRED" ] || { echo "Falta x-credentials.json (ver cabecera del script)"; exit 1; }
[ -n "$IMAGE" ] && [ -f "$IMAGE" ] || { echo "Falta imagen: $IMAGE"; exit 1; }

export PATH="$ROOT/../node/bin:$PATH"
NODE="$(command -v node || echo "$HOME/node/bin/node")"

"$NODE" - "$IMAGE" "$TEXT" "$LINK" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const creds = require(process.env.HOME + '/autopilot/x-credentials.json');

const [, , imagePath, text, link] = process.argv;

// ── OAuth 1.0a signing ──
const enc = encodeURIComponent;
const params = (extra) => Object.assign({
  oauth_consumer_key: creds.api_key,
  oauth_nonce: crypto.randomBytes(16).toString('hex'),
  oauth_signature_method: 'HMAC-SHA1',
  oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
  oauth_token: creds.access_token,
  oauth_version: '1.0'
}, extra || {});

const sigBase = (method, url, extra) => {
  const p = params(extra);
  const base = Object.keys(p).sort().map(k => `${enc(k)}=${enc(p[k])}`).join('&');
  return `${method}&${enc(url)}&${enc(base)}`;
};
const sign = (method, url, extra) => {
  const key = enc(creds.api_secret) + '&' + enc(creds.access_token_secret);
  return crypto.createHmac('sha1', key).update(sigBase(method, url, extra)).digest('base64');
};
const authHeader = (method, url, extra) => {
  const p = params(extra);
  p.oauth_signature = sign(method, url, extra);
  return 'OAuth ' + Object.keys(p).sort().map(k => `${enc(k)}="${enc(p[k])}"`).join(', ');
};

function req(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(d); } catch (e) {}
        if (res.statusCode >= 400) return reject(new Error(d.slice(0, 300)));
        resolve(j);
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  // 1) Subir imagen (media/upload) - init
  const img = fs.readFileSync(imagePath);
  const imgB64 = img.toString('base64');
  const init = await req('POST', 'https://upload.twitter.com/1.1/media/upload.json',
    { Authorization: authHeader('POST', 'https://upload.twitter.com/1.1/media/upload.json', { command: 'INIT', media_type: 'image/png', total_bytes: String(img.length) }),
      'Content-Type': 'application/x-www-form-urlencoded' },
    'command=INIT&media_type=image%2Fpng&total_bytes=' + img.length);
  const mediaId = init.media_id_string;
  console.log('media_id:', mediaId);

  // 2) APPEND (chunks de 5MB)
  const CHUNK = 5 * 1024 * 1024;
  for (let i = 0, idx = 0; i < imgB64.length; i += CHUNK, idx++) {
    const chunk = imgB64.slice(i, i + CHUNK);
    await req('POST', 'https://upload.twitter.com/1.1/media/upload.json',
      { Authorization: authHeader('POST', 'https://upload.twitter.com/1.1/media/upload.json', { command: 'APPEND', media_id: mediaId, segment_index: String(idx) }),
        'Content-Type': 'multipart/form-data; boundary=X' },
      null);
  }

  // 3) FINALIZE
  await req('POST', 'https://upload.twitter.com/1.1/media/upload.json',
    { Authorization: authHeader('POST', 'https://upload.twitter.com/1.1/media/upload.json', { command: 'FINALIZE', media_id: mediaId }) },
    'command=FINALIZE&media_id=' + mediaId);

  // 4) Tweet
  let fullText = text || '';
  if (link) fullText = fullText ? fullText + ' ' + link : link;
  const tw = await req('POST', 'https://api.twitter.com/1.1/statuses/update.json',
    { Authorization: authHeader('POST', 'https://api.twitter.com/1.1/statuses/update.json', { status: fullText, media_ids: mediaId }),
      'Content-Type': 'application/x-www-form-urlencoded' },
    'status=' + enc(fullText) + '&media_ids=' + mediaId);
  console.log('TWEET publicado:', tw.id_str || JSON.stringify(tw).slice(0, 200));
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
NODE
