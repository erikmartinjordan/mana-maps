#!/usr/bin/env node
// ── add-legend-keys.js ─
// Adds legendKey/legendTitle/legendFormat to coroplet maps so the
// gallery legend uses the declared numeric key instead of heuristics.
'use strict';
const https=require('https'), fs=require('fs'), path=require('path');

const PROJECT_ID='mana-maps-pro-f2177';
const DATABASE='(default)';
const COLLECTION='maps';
const DRY_RUN=process.argv.includes('--dry-run');

// ── Auth helpers (same as other publish scripts) ──
function loadADC(){
  const home=require('os').homedir();
  const candidates=[
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(home,'.config/gcloud/application_default_credentials.json'),
    ...(()=>{try{const d=path.join(home,'.config/gcloud/legacy_credentials'); if(fs.existsSync(d)) return fs.readdirSync(d).filter(x=>!x.startsWith('.')).map(x=>path.join(d,x,'adc.json')); }catch(_){} return[];})(),
  ].filter(Boolean);
  for(const p of candidates){const abs=path.resolve(p); if(!fs.existsSync(abs)) continue; try{const c=JSON.parse(fs.readFileSync(abs,'utf8')); if(c.type==='authorized_user'&&c.refresh_token) return c; if(c.type==='service_account'&&c.client_email&&c.private_key) return c;}catch(_){}}
  return null;
}
function loadServiceAccount(){
  const p=process.env.GOOGLE_APPLICATION_CREDENTIALS; if(!p) return null;
  const abs=path.resolve(p); if(!fs.existsSync(abs)) return null;
  const c=JSON.parse(fs.readFileSync(abs,'utf8'));
  if(c.type==='service_account'&&c.client_email&&c.private_key) return c; return null;
}
function httpsRequest(url,options,body){
  return new Promise((resolve,reject)=>{
    const u=new URL(url);
    const req=https.request({hostname:u.hostname,path:u.pathname+u.search,method:options.method||'GET',headers:options.headers||{}},res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(d)});}catch(e){resolve({status:res.statusCode,data:d,parseError:true});}});
    });
    req.on('error',reject); if(body) req.write(body); req.end();
  });
}
function getAccessTokenFromADC(adc){
  return new Promise((resolve,reject)=>{
    const postData=`client_id=${encodeURIComponent(adc.client_id)}&client_secret=${encodeURIComponent(adc.client_secret)}&refresh_token=${encodeURIComponent(adc.refresh_token)}&grant_type=refresh_token`;
    const req=https.request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(postData)}},res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{const p=JSON.parse(d); if(p.access_token) resolve(p.access_token); else reject(new Error('ADC token error: '+d));}catch(e){reject(e);}});
    });
    req.on('error',reject); req.write(postData); req.end();
  });
}
function getAccessTokenFromSA(sa){
  return new Promise((resolve,reject)=>{
    const now=Math.floor(Date.now()/1000);
    const payload={iss:sa.client_email,scope:'https://www.googleapis.com/auth/cloud-platform',aud:'https://oauth2.googleapis.com/token',exp:now+3600,iat:now};
    const header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
    const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signInput=`${header}.${body}`;
    const crypto=require('crypto'); const sign=crypto.createSign('RSA-SHA256'); sign.update(signInput);
    const signature=sign.sign(sa.private_key,'base64url');
    const jwt=`${signInput}.${signature}`;
    const postData=`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(jwt)}`;
    const req=https.request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(postData)}},res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{const p=JSON.parse(d); if(p.access_token) resolve(p.access_token); else reject(new Error('Token error: '+d));}catch(e){reject(e);}});
    });
    req.on('error',reject); req.write(postData); req.end();
  });
}
function loadPublisherCredentials(){
  const p=process.env.PUBLISHER_CREDENTIALS;
  if(p){const abs=path.resolve(p); if(fs.existsSync(abs)) return JSON.parse(fs.readFileSync(abs,'utf8'));}
  try{
    const home=require('os').homedir();
    const fallback=home+'/.publisher-credentials.json';
    const alt='/home/erik/autopilot/.publisher-credentials.json';
    for(const cand of [fallback,alt,'/Users/Erik/autopilot/.publisher-credentials.json','/Users/erik/autopilot/.publisher-credentials.json']){
      if(fs.existsSync(cand)) return JSON.parse(fs.readFileSync(cand,'utf8'));
    }
  }catch(_){}
  return null;
}
async function firebaseAuthSignIn(email,password,apiKey){
  const url=`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const body=JSON.stringify({email,password,returnSecureToken:true});
  const res=await httpsRequest(url,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},body);
  if(res.status!==200) throw new Error(`Firebase Auth sign-in failed (${res.status}): ${JSON.stringify(res.data)}`);
  return {idToken:res.data.idToken, uid:res.data.localId};
}
async function getAccessToken(){
  const sa=loadServiceAccount(); if(sa){console.log('Using service account.'); return {token:await getAccessTokenFromSA(sa),uid:null};}
  const pub=loadPublisherCredentials();
  if(pub&&pub.email&&pub.password&&pub.apiKey){
    console.log('Using Firebase Auth (publisher).');
    try{const r=await firebaseAuthSignIn(pub.email,pub.password,pub.apiKey); return {token:r.idToken,uid:r.uid};}catch(e){console.log('Publisher auth failed:',e.message,'-> trying ADC');}
  }
  const adc=loadADC();
  if(adc){try{console.log('Using ADC.'); return {token:await getAccessTokenFromADC(adc),uid:null};}catch(e){console.log('ADC failed:',e.message);}}
  console.log('ERROR: No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS or ~/.publisher-credentials.json');
  process.exit(1);
}

function firestoreRequest(token,method,urlPath,body){
  return new Promise((resolve,reject)=>{
    const url=`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE}/documents${urlPath}`;
    const u=new URL(url);
    const postData=body?JSON.stringify(body):null;
    const req=https.request({hostname:u.hostname,path:u.pathname+u.search,method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(postData?{'Content-Length':Buffer.byteLength(postData)}:{})}},res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(d)});}catch(e){resolve({status:res.statusCode,data:d,parseError:true});}});
    });
    req.on('error',reject); if(postData) req.write(postData); req.end();
  });
}
function fsStr(v){return v!=null?{stringValue:String(v)}:{stringValue:''};}

// ── Maps to update ──
const MAPS = [
  {
    slug: 'minimum-wage-by-country',
    legendKey: 'Salario mínimo USD anual',
    legendTitle: 'Salario mínimo (USD/año)',
    legendFormat: 'usd'
  },
  {
    slug: 'patrimonio-unesco-por-pais',
    legendKey: 'Sitios UNESCO',
    legendTitle: 'Sitios UNESCO por país',
    legendFormat: 'number'
  }
];

async function main(){
  console.log('Authenticating...');
  const {token}=await getAccessToken();
  
  for (const m of MAPS) {
    console.log(`\n=== ${m.slug} ===`);
    console.log(`  legendKey:   ${m.legendKey}`);
    console.log(`  legendTitle: ${m.legendTitle}`);
    console.log(`  legendFormat: ${m.legendFormat}`);
    
    // PATCH the document with only the legend fields
    const fields = {
      legendKey: fsStr(m.legendKey),
      legendTitle: fsStr(m.legendTitle),
      legendFormat: fsStr(m.legendFormat)
    };
    
    if (DRY_RUN) {
      console.log('  [DRY RUN] Would patch document.');
      continue;
    }
    
    // Use PATCH with updateMask to only touch the 3 legend fields
    const fieldPaths = 'updateMask.fieldPaths=legendKey&updateMask.fieldPaths=legendTitle&updateMask.fieldPaths=legendFormat';
    const res = await firestoreRequest(token, 'PATCH', `/${COLLECTION}/${m.slug}?${fieldPaths}`, { fields });
    
    if (res.status >= 400) {
      console.error(`  FAILED (${res.status}):`, JSON.stringify(res.data).slice(0, 600));
    } else {
      console.log(`  OK — document updated.`);
      // Verify
      const verify = await firestoreRequest(token, 'GET', `/${COLLECTION}/${m.slug}`);
      if (verify.status === 200) {
        const f = verify.data.fields || {};
        console.log(`  Verified: legendKey="${f.legendKey?.stringValue}", legendTitle="${f.legendTitle?.stringValue}", legendFormat="${f.legendFormat?.stringValue}"`);
      }
    }
  }
  
  console.log('\nDone.');
}

main().catch(e=>{console.error('Fatal',e); process.exit(1);});
