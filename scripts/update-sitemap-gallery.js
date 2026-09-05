#!/usr/bin/env node
// ── update-sitemap-gallery.js ─
// Consulta los mapas publicados en Firestore y añade sus URLs individuales
// al sitemap.xml con priority 0.6 y changefreq weekly.
//
// Uso:
//   node scripts/update-sitemap-gallery.js [--dry-run]
//
// El script es idempotente: si ya existen entradas para un slug, las reemplaza.

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'mana-maps-pro-f2177';
const DATABASE = '(default)';
const COLLECTION = 'maps';
const SITE_BASE = 'https://xn--maa-8ma.com';
const SITEMAP_PATH = path.join(__dirname, '..', 'sitemap.xml');
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Auth helpers (reuse from homogeneize-gallery.js) ──────────────
function loadServiceAccount() {
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credsPath) return null;
  const absPath = path.resolve(credsPath);
  if (!fs.existsSync(absPath)) return null;
  const creds = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  if (creds.type === 'service_account' && creds.client_email && creds.private_key) return creds;
  return null;
}

function loadPublisherCredentials() {
  const credsPath = process.env.PUBLISHER_CREDENTIALS;
  if (credsPath) {
    const absPath = path.resolve(credsPath);
    if (fs.existsSync(absPath)) return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  }
  try {
    const home = require('os').homedir();
    for (const cand of [home + '/.publisher-credentials.json', '/home/erik/autopilot/.publisher-credentials.json', '/Users/Erik/autopilot/.publisher-credentials.json']) {
      if (fs.existsSync(cand)) return JSON.parse(fs.readFileSync(cand, 'utf8'));
    }
  } catch (_) {}
  return null;
}

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data, parseError: true }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function firebaseAuthSignIn(email, password, apiKey) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const body = JSON.stringify({ email, password, returnSecureToken: true });
  const res = await httpsRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200) throw new Error(`Firebase Auth sign-in failed (${res.status}): ${JSON.stringify(res.data)}`);
  return res.data.idToken;
}

async function getAccessToken() {
  const sa = loadServiceAccount();
  if (sa) {
    console.log('Using service account authentication.');
    const crypto = require('crypto');
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now };
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signInput = `${header}.${body}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signInput);
    const signature = sign.sign(sa.private_key, 'base64url');
    const jwt = `${signInput}.${signature}`;
    const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(jwt)}`;
    return new Promise((resolve, reject) => {
      const req = https.request('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          const parsed = JSON.parse(data);
          if (parsed.access_token) resolve(parsed.access_token);
          else reject(new Error('Token error: ' + data));
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  const pub = loadPublisherCredentials();
  if (pub && pub.email && pub.password && pub.apiKey) {
    console.log('Using Firebase Auth (publisher) authentication.');
    return firebaseAuthSignIn(pub.email, pub.password, pub.apiKey);
  }

  console.error('ERROR: No credentials found.');
  process.exit(1);
}

// ─── Firestore REST helpers ──────────────────────────────────────
function firestoreRequest(token, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents${urlPath}`;
    const parsedUrl = new URL(url);
    const postData = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data, parseError: true }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function extractField(doc, fieldName) {
  if (!doc || !doc.fields || !doc.fields[fieldName]) return null;
  const f = doc.fields[fieldName];
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('booleanValue' in f) return f.booleanValue;
  if ('arrayValue' in f) return (f.arrayValue.values || []).map(v => {
    if ('stringValue' in v) return v.stringValue;
    return v;
  });
  return null;
}

// ─── Sitemap XML helpers ────────────────────────────────────────

/** Build a <url> entry for a gallery map */
function buildMapUrlEntry(slug) {
  return [
    '  <url>',
    `    <loc>${SITE_BASE}/gallery/?slug=${slug}</loc>`,
    '    <changefreq>weekly</changefreq>',
    '    <priority>0.6</priority>',
    '  </url>'
  ].join('\n');
}

/** Regex to match a gallery map <url> block in the sitemap */
const MAP_URL_REGEX = /  <url>\n    <loc>https:\/\/xn--maa-8ma\.com\/gallery\/\?slug=[^<]+<\/loc>\n    <changefreq>[^<]*<\/changefreq>\n    <priority>[^<]*<\/priority>\n  <\/url>\n?/g;

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== update-sitemap-gallery.js ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  // 1. Get access token and list published maps
  const token = await getAccessToken();
  console.log('Access token obtained.');

  const res = await firestoreRequest(token, 'GET', `/${COLLECTION}?pageSize=100`);
  if (res.status !== 200) throw new Error(`List maps failed (${res.status}): ${JSON.stringify(res.data)}`);

  const docs = res.data.documents || [];
  const publishedSlugs = [];

  for (const doc of docs) {
    const id = doc.name.split('/').pop();
    const isPublished = extractField(doc, 'isPublished');
    if (isPublished === true) {
      publishedSlugs.push(id);
    }
  }

  publishedSlugs.sort();
  console.log(`Found ${publishedSlugs.length} published maps in Firestore:\n`);
  for (const slug of publishedSlugs) {
    console.log(`  - ${slug}`);
  }
  console.log('');

  // 2. Read current sitemap
  let sitemap = fs.readFileSync(SITEMAP_PATH, 'utf8');

  // 3. Remove any existing gallery map entries
  const cleaned = sitemap.replace(MAP_URL_REGEX, '');

  // 4. Build new map entries
  const newEntries = publishedSlugs.map(buildMapUrlEntry).join('\n');

  // 5. Insert new entries before </urlset>
  const updated = cleaned.replace('</urlset>', newEntries + '\n</urlset>');

  // 6. Write back
  if (DRY_RUN) {
    console.log('DRY RUN — would write the following sitemap:\n');
    console.log(updated);
  } else {
    fs.writeFileSync(SITEMAP_PATH, updated, 'utf8');
    console.log(`✓ Updated sitemap.xml with ${publishedSlugs.length} gallery map entries.`);
  }

  console.log('\n=== Done ===\n');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
