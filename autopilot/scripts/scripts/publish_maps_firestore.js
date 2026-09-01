#!/usr/bin/env node
// publish_maps_firestore.js - Publica los mapas locales en Firestore (maps)
// Usa credenciales de la cuenta publisher (email/password) via REST.
// Uso: node publish_maps_firestore.js <email> <password> <projectId> [apiKey]
const https = require('https');
const fs = require('fs');
const path = require('path');

const EMAIL = process.argv[2];
const PASSWORD = process.argv[3];
const PROJECT_ID = process.argv[4];
const API_KEY = process.argv[5];
const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');

if (!EMAIL || !PASSWORD || !PROJECT_ID) {
  console.error('uso: publish_maps_firestore.js <email> <password> <projectId> [apiKey]');
  process.exit(1);
}

function req(method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        let j = null; try { j = JSON.parse(d); } catch (e) {}
        if (res.statusCode >= 400) return reject(new Error(res.statusCode + ' ' + ((j && (j.error && j.error.message)) || d).slice(0, 300)));
        resolve(j || d);
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function login() {
  const r = await req('POST', `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, { email: EMAIL, password: PASSWORD, returnSecureToken: true });
  return { idToken: r.idToken, uid: r.localId };
}

const esc = (s) => s ? String(s) : '';

function docFields(map, uid, geo) {
  return {
    fields: {
      title: { stringValue: esc(map.title || map.name) },
      name: { stringValue: esc(map.name || map.title) },
      description: { stringValue: esc(map.description || '') },
      createdBy: { stringValue: uid },
      authorHandle: { stringValue: esc(map.authorHandle || '') },
      lang: { stringValue: esc(map.lang || 'en') },
      geojsonText: { stringValue: map.geojsonText },
      shareMode: { stringValue: 'view' },
      allowPublicEdit: { booleanValue: false },
      featureCount: { integerValue: geo.features.length },
      isPublished: { booleanValue: true },
      public: { booleanValue: true },
      likes: { integerValue: 0 },
      views: { integerValue: 0 },
      createdAtMs: { integerValue: map.createdAtMs || Date.now() },
      updatedAtMs: { integerValue: Date.now() }
    }
  };
}

async function publish(idToken, slug, body) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/maps/${slug}`;
  const r = await req('PATCH', url, body, { Authorization: 'Bearer ' + idToken });
  console.log('PUBLISHED maps/' + slug);
  return r;
}

(async () => {
  const { idToken, uid } = await login();
  console.log('auth OK uid=' + uid);
  const files = fs.readdirSync(DATA).filter((f) => /^gallery-.*\.js$/.test(f));
  let n = 0;
  for (const file of files) {
    const code = fs.readFileSync(path.join(DATA, file), 'utf8');
    const g = code.match(/window\.\w+\s*=\s*(\{[\s\S]*?\});?\s*$/);
    if (!g) continue;
    try {
      const map = Function('"use strict"; return (' + g[1] + ');')();
      const slug = map.slug || map.id || file.replace(/^gallery-|\.js$/g, '');
      if (slug === 'worst-wildfires-world') { console.log('skip (ya publicado)', slug); continue; }
      const geo = JSON.parse(map.geojsonText);
      await publish(idToken, slug, docFields(map, uid, geo));
      n++;
    } catch (e) {
      console.error('skip', file, e.message);
    }
  }
  console.log('FIN publicados:', n);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
