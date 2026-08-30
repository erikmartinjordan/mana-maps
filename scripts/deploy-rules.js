#!/usr/bin/env node
// ── deploy-rules.js ─ Deploy Firestore security rules via REST API

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'mana-maps-pro-f2177';

function loadPublisherCredentials() {
  const candidates = [
    process.env.PUBLISHER_CREDENTIALS,
    path.join(require('os').homedir(), '.publisher-credentials.json'),
    '/home/erik/autopilot/.publisher-credentials.json',
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const abs = path.resolve(p);
      if (fs.existsSync(abs)) return JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (_) {}
  }
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

async function getAccessToken() {
  // Try ADC first (gcloud auth)
  const home = require('os').homedir();
  const adcPath = path.join(home, '.config/gcloud/application_default_credentials.json');
  if (fs.existsSync(adcPath)) {
    const adc = JSON.parse(fs.readFileSync(adcPath, 'utf8'));
    if (adc.refresh_token) {
      console.log('Using ADC credentials...');
      const postData = `client_id=${encodeURIComponent(adc.client_id)}&client_secret=${encodeURIComponent(adc.client_secret)}&refresh_token=${encodeURIComponent(adc.refresh_token)}&grant_type=refresh_token`;
      const res = await new Promise((resolve, reject) => {
        const req = https.request('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
      });
      if (res.access_token) return res.access_token;
    }
  }
  
  // Try service account
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    const sa = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
    if (sa.type === 'service_account' && sa.private_key) {
      console.log('Using service account...');
      const now = Math.floor(Date.now() / 1000);
      const payload = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now };
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const signInput = `${header}.${body}`;
      const crypto = require('crypto');
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(signInput);
      const signature = sign.sign(sa.private_key, 'base64url');
      const jwt = `${signInput}.${signature}`;
      const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(jwt)}`;
      const res = await new Promise((resolve, reject) => {
        const req = https.request('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
      });
      if (res.access_token) return res.access_token;
    }
  }

  // Try publisher credentials for Firebase Auth token
  const pub = loadPublisherCredentials();
  if (pub && pub.email && pub.password && pub.apiKey) {
    console.log('Trying Firebase Auth (publisher)...');
    const body = JSON.stringify({ email: pub.email, password: pub.password, returnSecureToken: true });
    const res = await httpsRequest(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${pub.apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      body
    );
    if (res.status === 200 && res.data.idToken) return res.data.idToken;
  }

  console.error('ERROR: No credentials found for deploying rules.');
  process.exit(1);
}

async function main() {
  const token = await getAccessToken();
  console.log('Access token obtained.');

  // Read the rules file
  const rulesPath = path.join(__dirname, '..', 'firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf8');
  
  // The rules content needs to be sent as a string in the request body
  const requestBody = {
    source: {
      files: [{
        name: 'firestore.rules',
        content: rulesContent
      }]
    }
  };
  
  console.log('Deploying rules...');
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/securityRules:deploy`;
  const body = JSON.stringify(requestBody);
  const res = await httpsRequest(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);
  
  console.log('Status:', res.status);
  if (res.status >= 400) {
    console.error('Error:', JSON.stringify(res.data).substring(0, 500));
    process.exit(1);
  }
  console.log('Rules deployed successfully!');
  console.log(JSON.stringify(res.data).substring(0, 200));
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
