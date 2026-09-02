#!/usr/bin/env node
// publish-largest-islands.js - Publica el mapa de islas más grandes en Firestore.
// Lee el GeoJSON pre-generado y lo sube a la colección maps.
'use strict';
const https=require('https'), fs=require('fs'), path=require('path');

const PROJECT_ID='mana-maps-pro-f2177';
const DATABASE='(default)';
const COLLECTION='maps';
const SLUG='largest-islands-world';
const DRY_RUN=process.argv.includes('--dry-run');

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
  console.log('No auth method available.');
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
function fsInt(v){return {integerValue:String(v)};}
function fsBool(v){return {booleanValue:!!v};}
function fsNum(v){return Number.isInteger(v)?fsInt(v):{doubleValue:v};}
function fsArr(arr){return {arrayValue:{values:arr.map(v=>(typeof v==='string')?fsStr(v):v)}};}
function fsNull(){return {nullValue:null};}
function fsMap(obj){const fields={}; for(const [k,v] of Object.entries(obj)){if(v===null||v===undefined) fields[k]=fsNull(); else if(typeof v==='string') fields[k]=fsStr(v); else if(typeof v==='number') fields[k]=fsNum(v); else if(typeof v==='boolean') fields[k]=fsBool(v); else if(Array.isArray(v)) fields[k]=fsArr(v); else if(typeof v==='object') fields[k]=fsMap(v); else fields[k]=fsStr(String(v));} return {mapValue:{fields}};}

function buildMapPreview(geo){
  let bbox=[180,90,-180,-90];
  function walk(coords){
    if(typeof coords[0]==='number'){
      const x=coords[0], y=coords[1];
      if(x<bbox[0]) bbox[0]=x; if(y<bbox[1]) bbox[1]=y; if(x>bbox[2]) bbox[2]=x; if(y>bbox[3]) bbox[3]=y;
    } else coords.forEach(walk);
  }
  geo.features.forEach(f=> walk(f.geometry.coordinates));
  const previewFeatures=geo.features.map(f=>{
    const g=f.geometry;
    let coords=[];
    if(g.type==='Polygon') coords=g.coordinates[0];
    else if(g.type==='MultiPolygon') coords=g.coordinates[0][0];
    if(!coords || coords.length<2) coords=[[0,0],[1,1]];
    const step=Math.max(1, Math.floor(coords.length/30));
    const samp=[];
    for(let i=0;i<coords.length;i+=step) samp.push(coords[i]);
    if(samp.length<2) samp.push(coords[coords.length-1]);
    return { geometry:{type:'LineString', coordinatesText: JSON.stringify(samp)}, color:f.properties._manaColor, emoji:null };
  });
  return {bbox, kind:'geometry', gridSize:8, cells:null, features:previewFeatures};
}

async function main(){
  // Read pre-generated GeoJSON
  const geoPath='/home/erik/autopilot/strategy/data/largest-islands-world.geojson';
  if(!fs.existsSync(geoPath)){console.error('GeoJSON not found:',geoPath); process.exit(1);}
  const geo=JSON.parse(fs.readFileSync(geoPath,'utf8'));
  const geojsonText=JSON.stringify(geo);
  console.log(`GeoJSON ${(geojsonText.length/1024).toFixed(1)} KB, features ${geo.features.length}`);
  if(geojsonText.length>1048576){ console.error('ERROR >1MiB'); process.exit(1); }

  // Validate
  const hexOk=geo.features.every(f=>/^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  console.log('hex valid:', hexOk);
  const haloOk=geo.features.every(f=>f.properties._manaLabelStyle && f.properties._manaLabelStyle.haloWidth>=2);
  console.log('haloWidth >=2:', haloOk);
  const coordsOk=geo.features.every(f=>{
    let ok=true;
    function walk(c){ if(typeof c[0]==='number'){ if(c[0]<-180||c[0]>180||c[1]<-90||c[1]>90) ok=false; } else c.forEach(walk); }
    walk(f.geometry.coordinates); return ok;
  });
  console.log('coords within ±180/±90:', coordsOk);
  const dupNames=new Set(geo.features.map(f=>f.properties._manaName));
  console.log('unique names:', dupNames.size===geo.features.length);

  const preview=buildMapPreview(geo);
  const now=Date.now();
  const serverNow={timestampValue:new Date().toISOString()};
  const docFields={
    id:fsStr(SLUG), slug:fsStr(SLUG),
    title:fsStr('Las islas más grandes del mundo'),
    name:fsStr('Las islas más grandes del mundo'),
    description:fsStr('Las 22 islas más grandes del planeta ordenadas por superficie. Groenlandia, con más de 2 millones de km², es casi 5 veces más grande que Madagascar, la cuarta isla más grande.'),
    lang:fsStr('es'),
    featureCount:fsInt(geo.features.length),
    mapPreview:fsMap({
      bbox:{arrayValue:{values:preview.bbox.map(v=>fsNum(v))}},
      kind:fsStr('geometry'),
      gridSize:fsInt(8),
      cells:fsNull(),
      features:{arrayValue:{values:preview.features.map(pf=>fsMap({
        geometry:fsMap({type:fsStr('LineString'),coordinatesText:fsStr(pf.geometry.coordinatesText)}),
        color:fsStr(pf.color),
        emoji:fsNull()
      }))}}
    }),
    visibility:fsStr('public'), shareMode:fsStr('view'), allowPublicEdit:fsBool(false), isPublished:fsBool(true),
    shareUrl:fsStr(`https://maña.com/gallery/?slug=${SLUG}`),
    geojsonText:fsStr(geojsonText), geojsonChunked:fsNull(),
    dataSource:fsStr('Natural Earth 50m (geometría de islas) + Wikipedia (superficie y población)'),
    dataDate:fsStr('2026-09'),
    tags:fsArr(['Geografía','Islas','Naturaleza','Mundo']),
    authorHandle:fsStr('maña-maps'), createdBy:fsStr('maña-maps'), ownerUid:fsStr('maña-maps'),
    createdAtMs:fsInt(now), updatedAtMs:fsInt(now), createdAt:serverNow, updatedAt:serverNow,
    views:fsInt(0), likes:fsInt(0)
  };

  if(DRY_RUN){
    console.log('\n=== DRY RUN ===');
    fs.writeFileSync(path.join(__dirname,'..','data','largest-islands-world.geojson'), geojsonText);
    console.log('GeoJSON guardado en data/largest-islands-world.geojson');
    return;
  }

  console.log('Authenticating...');
  const {token,uid}=await getAccessToken();
  if(uid){ docFields.createdBy=fsStr(uid); docFields.ownerUid=fsStr(uid); }
  console.log(`Checking /maps/${SLUG}...`);
  const existing=await firestoreRequest(token,'GET',`/${COLLECTION}/${SLUG}`);
  if(existing.status===200){
    console.log('Updating document...');
    const fieldPaths=Object.keys(docFields).map(f=>`updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const res=await firestoreRequest(token,'PATCH',`/${COLLECTION}/${SLUG}?${fieldPaths}`,{fields:docFields});
    if(res.status>=400){console.error('Update failed',res.status, JSON.stringify(res.data).slice(0,600)); process.exit(1);}
    console.log('Updated!');
  } else {
    console.log('Creating...');
    const res=await firestoreRequest(token,'POST',`/${COLLECTION}?documentId=${SLUG}`,{fields:docFields});
    if(res.status>=400){console.error('Create failed',res.status, JSON.stringify(res.data).slice(0,600)); process.exit(1);}
    console.log('Created!');
  }
  const verify=await firestoreRequest(token,'GET',`/${COLLECTION}/${SLUG}`);
  if(verify.status===200){
    console.log(`✓ isPublished ${verify.data.fields?.isPublished?.booleanValue}, featureCount ${verify.data.fields?.featureCount?.integerValue}`);
    console.log(`✓ Gallery https://maña.com/gallery/?slug=${SLUG}`);
  }
}
main().catch(e=>{console.error('Fatal',e); process.exit(1);});
