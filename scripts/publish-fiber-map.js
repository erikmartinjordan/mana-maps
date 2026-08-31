#!/usr/bin/env node
// ── publish-fiber-map.js ─
// Publica el mapa de cables submarinos con rampa por año y gran círculo
// sin rectas >5° y con split antimeridiano.
// Carga GeoJSON desde data/submarine-fiber-cables.geojson (corregido) y lo
// publica en Firestore maps/submarine-fiber-cables.
//
// Uso:
//   node scripts/publish-fiber-map.js [--dry-run]

'use strict';
const https=require('https'), fs=require('fs'), path=require('path');

const PROJECT_ID='mana-maps-pro-f2177';
const DATABASE='(default)';
const COLLECTION='maps';
const SLUG='submarine-fiber-cables';
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
    for(const cand of [fallback,alt,'/Users/Erik/autopilot/.publisher-credentials.json']){
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
  console.log('Trying anonymous auth...');
  let apiKey=null;
  try{const pub2=loadPublisherCredentials(); if(pub2&&pub2.apiKey) apiKey=pub2.apiKey;}catch(_){}
  if(!apiKey){try{const fb=fs.readFileSync('js/firebase.js','utf8'); const m=fb.match(/apiKey:\s*["']([^"']+)["']/); if(m) apiKey=m[1];}catch(_){}}
  if(!apiKey){try{const home=require('os').homedir(); const pub3=JSON.parse(fs.readFileSync(home+'/autopilot/.publisher-credentials.json','utf8')); apiKey=pub3.apiKey;}catch(_){}}
  if(!apiKey){console.error('ERROR: No API_KEY'); process.exit(1);}
  const anon=await new Promise((resolve,reject)=>{
    const body=JSON.stringify({returnSecureToken:true});
    const req=https.request('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key='+apiKey,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{const j=JSON.parse(d); if(j.idToken) resolve(j); else reject(new Error('anon failed:'+d.slice(0,400)));}catch(e){reject(e);}});
    });
    req.on('error',reject); req.write(body); req.end();
  });
  console.log('Anonymous OK uid='+anon.localId);
  return {token:anon.idToken,uid:anon.localId};
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

async function main(){
  const geoPath=path.join(__dirname,'..','data','submarine-fiber-cables.geojson');
  if(!fs.existsSync(geoPath)){console.error('No geojson at',geoPath); process.exit(1);}
  const geo=JSON.parse(fs.readFileSync(geoPath,'utf8'));
  console.log(`Loaded ${geo.features.length} features`);
  const geojsonText=JSON.stringify(geo);
  console.log(`GeoJSON size ${(geojsonText.length/1024).toFixed(1)} KB`);
  if(geojsonText.length>1048576){console.error('ERROR exceeds 1MiB'); process.exit(1);}
  // Validation
  const colors=new Set(geo.features.map(f=>f.properties._manaColor));
  console.log(`Distinct colors: ${colors.size} ${Array.from(colors).join(', ')}`);
  const years=geo.features.map(f=>f.properties['Año']).filter(Boolean);
  console.log(`Years range ${Math.min(...years)}-${Math.max(...years)}`);
  let maxJump=0;
  for(const f of geo.features){
    const g=f.geometry;
    const lines=g.type==='LineString'?[g.coordinates]:g.coordinates;
    for(const line of lines){
      for(let i=1;i<line.length;i++){
        const dlon=Math.abs(line[i][0]-line[i-1][0]); const dlat=Math.abs(line[i][1]-line[i-1][1]);
        const wd=dlon>180?360-dlon:dlon;
        maxJump=Math.max(maxJump, Math.max(wd,dlat));
      }
    }
  }
  console.log(`maxJump wrapped ${maxJump.toFixed(2)} (must be <5)`);
  if(maxJump>5){console.error('ERROR maxJump >5'); process.exit(1);}
  // Build preview similar to rivers
  let bbox=[180,90,-180,-90];
  for(const f of geo.features){
    const g=f.geometry;
    const lines=g.type==='LineString'?[g.coordinates]:g.coordinates;
    for(const line of lines){for(const c of line){ if(c[0]<bbox[0]) bbox[0]=c[0]; if(c[1]<bbox[1]) bbox[1]=c[1]; if(c[0]>bbox[2]) bbox[2]=c[0]; if(c[1]>bbox[3]) bbox[3]=c[1]; }}
  }
  const previewFeatures=geo.features.map(f=>{
    const g=f.geometry;
    // preview: take first line for MultiLineString
    const coords=g.type==='LineString'?g.coordinates:g.coordinates[0];
    const maxPrev=40; const step=Math.max(1, Math.floor(coords.length/maxPrev));
    const simplified=[]; for(let i=0;i<coords.length;i+=step) simplified.push(coords[i]);
    if(simplified.length<2) simplified.push(coords[coords.length-1]);
    return {geometry:{type:'LineString',coordinatesText:JSON.stringify(simplified)}, color:f.properties._manaColor, emoji:null};
  });
  const preview={bbox,kind:'geometry',gridSize:8,cells:null,features:previewFeatures};
  const now=Date.now();
  const serverNow={timestampValue:new Date().toISOString()};
  const docFields={
    id:fsStr(SLUG), slug:fsStr(SLUG),
    title:fsStr('Cables de Fibra Óptica Submarina'),
    name:fsStr('Cables de Fibra Óptica Submarina'),
    description:fsStr('Principales cables de fibra óptica submarina y sus puntos de aterrizaje publicados. Los colores indican el año de puesta en servicio: claro antiguo → oscuro reciente. Trazado por gran círculo.'),
    lang:fsStr('es'),
    featureCount:fsInt(geo.features.length),
    mapPreview:fsMap({
      bbox:{arrayValue:{values:preview.bbox.map(v=>fsNum(v))}},
      kind:fsStr('geometry'),
      gridSize:fsInt(8),
      cells:fsNull(),
      features:{arrayValue:{values:previewFeatures.map(pf=>fsMap({
        geometry:fsMap({type:fsStr('LineString'),coordinatesText:fsStr(pf.geometry.coordinatesText)}),
        color:fsStr(pf.color),
        emoji:fsNull()
      }))}}
    }),
    visibility:fsStr('public'), shareMode:fsStr('view'), allowPublicEdit:fsBool(false), isPublished:fsBool(true),
    shareUrl:fsStr(`https://maña.com/gallery/?slug=${SLUG}`),
    geojsonText:fsStr(geojsonText), geojsonChunked:fsNull(),
    dataSource:fsStr('TeleGeography / submarinecablemap.com (puntos de aterrizaje oficiales) — trazado interpolado por gran círculo; GEBCO/NOAA para contexto oceánico'),
    dataDate:fsStr('2026-08-16'),
    tags:fsArr(['Infraestructura','Tecnología','Conectividad']),
    authorHandle:fsStr('maña-maps'), createdBy:fsStr('maña-maps'), ownerUid:fsStr('maña-maps'),
    createdAtMs:fsInt(now), updatedAtMs:fsInt(now), createdAt:serverNow, updatedAt:serverNow,
    views:fsInt(0), likes:fsInt(0)
  };
  if(DRY_RUN){
    console.log('\n=== DRY RUN — not publishing ===');
    console.log(`Would publish ${geo.features.length} features, ${(geojsonText.length/1024).toFixed(1)} KB`);
    return;
  }
  console.log('Authenticating...');
  const {token,uid}=await getAccessToken();
  if(uid){docFields.createdBy=fsStr(uid); docFields.ownerUid=fsStr(uid);}
  console.log(`Checking if /maps/${SLUG} exists...`);
  const existing=await firestoreRequest(token,'GET',`/${COLLECTION}/${SLUG}`);
  if(existing.status===200){
    console.log('Document exists. Updating...');
    const fieldPaths=Object.keys(docFields).map(f=>`updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const urlPath=`/${COLLECTION}/${SLUG}?${fieldPaths}`;
    const res=await firestoreRequest(token,'PATCH',urlPath,{fields:docFields});
    if(res.status>=400){console.error('Update failed:',res.status,JSON.stringify(res.data).substring(0,600)); process.exit(1);}
    console.log('Updated successfully!');
  } else {
    console.log('Creating new document...');
    const res=await firestoreRequest(token,'POST',`/${COLLECTION}?documentId=${SLUG}`,{fields:docFields});
    if(res.status>=400){console.error('Create failed:',res.status,JSON.stringify(res.data).substring(0,600)); process.exit(1);}
    console.log('Created successfully!');
  }
  console.log('Verifying...');
  const verify=await firestoreRequest(token,'GET',`/${COLLECTION}/${SLUG}`);
  if(verify.status===200){
    const isPublished=verify.data.fields?.isPublished?.booleanValue;
    const fc=verify.data.fields?.featureCount?.integerValue;
    console.log(`✓ isPublished: ${isPublished}, featureCount: ${fc}`);
    console.log(`✓ Gallery URL: https://maña.com/gallery/?slug=${SLUG}`);
  } else console.error('Verification failed',verify.status);
}
main().catch(e=>{console.error('Fatal',e); process.exit(1);});
