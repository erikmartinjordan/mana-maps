#!/usr/bin/env node
// ── publish-unesco-heritage.js ─
// Mapa coroplético: Sitios Patrimonio de la Humanidad UNESCO por país
// Fuente: UNESCO World Heritage Centre — IHP-WINS 2025 (1.248 sitios)
// Rampa secuencial monocromática azul claro→oscuro por número de sitios
// Geometrías Natural Earth 110m + 50m simplificadas
'use strict';
const https=require('https'), fs=require('fs'), path=require('path');

const PROJECT_ID='mana-maps-pro-f2177';
const DATABASE='(default)';
const COLLECTION='maps';
const SLUG='patrimonio-unesco-por-pais';
const DRY_RUN=process.argv.includes('--dry-run');

// ── Auth helpers (copied from publish-minimum-wage.js) ─────────
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

function fetchJson(url){
  return new Promise((resolve,reject)=>{
    https.get(url, res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(e);}});
    }).on('error',reject);
  });
}

// ── UNESCO country name → Natural Earth ADMIN name mapping ──
const UNESCO_TO_NE={
  'United States of America':'United States of America',
  'United Kingdom of Great Britain and Northern Ireland':'United Kingdom',
  'Russian Federation':'Russia',
  'Iran (Islamic Republic of)':'Iran',
  'Türkiye':'Turkey',
  'Republic of Korea':'South Korea',
  "Democratic People's Republic of Korea":'North Korea',
  'Viet Nam':'Vietnam',
  'Lao People\'s Democratic Republic':'Laos',
  'Syrian Arab Republic':'Syria',
  'Czechia':'Czech Republic',
  'North Macedonia':'Macedonia',
  'Eswatini':'eSwatini',
  'Côte d\'Ivoire':"Côte d'Ivoire",
  'Bolivia (Plurinational State of)':'Bolivia',
  'Venezuela (Bolivarian Republic of)':'Venezuela',
  'Tanzania, United Republic of':'Tanzania',
  'Moldova, Republic of':'Moldova',
  'Cabo Verde':'Cape Verde',
  'Micronesia (Federated States of)':'Micronesia',
  'Brunei Darussalam':'Brunei',
  'Timor-Leste':'East Timor',
  'Equatorial Guinea':'Equatorial Guinea',
  'Central African Republic':'Central African Republic',
  'Congo':'Republic of the Congo',
  'Democratic Republic of the Congo':'Democratic Republic of the Congo',
  'Eritrea':'Eritrea',
  'Somalia':'Somalia',
  'South Sudan':'South Sudan',
  'The Gambia':'Gambia',
  'Tuvalu':'Tuvalu',
  'Nauru':'Nauru',
  'Palau':'Palau',
  'Saint Kitts and Nevis':'Saint Kitts and Nevis',
  'Antigua and Barbuda':'Antigua and Barbuda',
  'Saint Vincent and the Grenadines':'Saint Vincent and the Grenadines',
  'Trinidad and Tobago':'Trinidad and Tobago',
  'Saint Lucia':'Saint Lucia',
  'Dominica':'Dominica',
  'Grenada':'Grenada',
  'Barbados':'Barbados',
  'São Tomé and Príncipe':'São Tomé and Príncipe',
  'Seychelles':'Seychelles',
  'Comoros':'Comoros',
  'Mauritius':'Mauritius',
  'Cuba':'Cuba',
  'Jamaica':'Jamaica',
  'Haiti':'Haiti',
  'Dominican Republic':'Dominican Republic',
  'Bahamas':'Bahamas',
  'Belize':'Belize',
  'Guatemala':'Guatemala',
  'Honduras':'Honduras',
  'El Salvador':'El Salvador',
  'Nicaragua':'Nicaragua',
  'Costa Rica':'Costa Rica',
  'Panama':'Panama',
  'Guyana':'Guyana',
  'Suriname':'Suriname',
  'Liberia':'Liberia',
  'Sierra Leone':'Sierra Leone',
  'Guinea-Bissau':'Guinea-Bissau',
  'Guinea':'Guinea',
  'Ghana':'Ghana',
  'Togo':'Togo',
  'Benin':'Benin',
  'Niger':'Niger',
  'Chad':'Chad',
  'Cameroon':'Cameroon',
  'Nigeria':'Nigeria',
  'Gabon':'Gabon',
  'Republic of the Congo':'Republic of the Congo',
  'Uganda':'Uganda',
  'Rwanda':'Rwanda',
  'Burundi':'Burundi',
  'Malawi':'Malawi',
  'Zambia':'Zambia',
  'Zimbabwe':'Zimbabwe',
  'Mozambique':'Mozambique',
  'Madagascar':'Madagascar',
  'Angola':'Angola',
  'Namibia':'Namibia',
  'Botswana':'Botswana',
  'Lesotho':'Lesotho',
  'Turkmenistan':'Turkmenistan',
  'Kyrgyzstan':'Kyrgyzstan',
  'Tajikistan':'Tajikistan',
  'Kazakhstan':'Kazakhstan',
  'Uzbekistan':'Uzbekistan',
  'Afghanistan':'Afghanistan',
  'Myanmar':'Myanmar',
  'Cambodia':'Cambodia',
  'Thailand':'Thailand',
  'Malaysia':'Malaysia',
  'Philippines':'Philippines',
  'Indonesia':'Indonesia',
  'Singapore':'Singapore',
  'Mongolia':'Mongolia',
  'Brunei Darussalam':'Brunei',
  'Papua New Guinea':'Papua New Guinea',
  'Fiji':'Fiji',
  'Solomon Islands':'Solomon Islands',
  'Vanuatu':'Vanuatu',
  'Samoa':'Samoa',
  'Tonga':'Tonga',
  'Marshall Islands':'Marshall Islands',
  'Kiribati':'Kiribati',
  'Niue':'Niue',
  'Cook Islands':'Cook Islands',
};

const CONTINENT_ES={Africa:'África',Asia:'Asia',Europe:'Europa','North America':'América del Norte','South America':'América del Sur',Oceania:'Oceanía',Antarctica:'Antártida','Seven seas (open ocean)':'Océano'};

// Rampa secuencial monocromática azul claro→oscuro por número de sitios UNESCO
const RAMP=[
  {max:0, color:'#d9d9d9'},
  {max:2, color:'#eff6ff'},
  {max:5, color:'#bfdbfe'},
  {max:10, color:'#93c5fd'},
  {max:18, color:'#60a5fa'},
  {max:30, color:'#3b82f6'},
  {max:45, color:'#2563eb'},
  {max:Infinity, color:'#1e3a8a'}
];
function colorForCount(n){
  if(n===0) return '#d9d9d9';
  for(const s of RAMP) if(n <= s.max) return s.color;
  return RAMP[RAMP.length-1].color;
}

function parseCSV(text){
  // Handle multiline CSV: continuation lines don't start with a digit
  const rawLines=text.replace(/^\uFEFF/,'').split('\n').map(l=>l.replace(/\r$/,''));
  // Merge continuation lines into previous record
  const merged=[];
  for(const line of rawLines){
    if(!line.trim()) continue;
    // Header line or data line starting with digit -> new record
    if(merged.length===0 || /^\d+,/.test(line)){
      merged.push(line);
    } else {
      merged[merged.length-1]+='\n'+line;
    }
  }
  if(merged.length<2) return [];
  // Parse header
  function splitFields(line){
    const fields=[]; let f=''; let q=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){if(q&&i+1<line.length&&line[i+1]==='"'){f+='"';i++;continue;} q=!q;continue;}
      if(ch===','&&!q){fields.push(f);f='';continue;}
      f+=ch;
    }
    fields.push(f); return fields;
  }
  const headers=splitFields(merged[0]).map(h=>h.trim());
  const rows=[];
  for(let i=1;i<merged.length;i++){
    const vals=splitFields(merged[i]);
    const obj={};
    for(let j=0;j<headers.length;j++) obj[headers[j]]=(vals[j]||'').trim();
    rows.push(obj);
  }
  return rows;
}

function fetchUrl(url, maxRedirects=5){
  return new Promise((resolve,reject)=>{
    https.get(url, res=>{
      if((res.statusCode===301||res.statusCode===302)&&res.headers.location&&maxRedirects>0){
        return fetchUrl(res.headers.location,maxRedirects-1).then(resolve,reject);
      }
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d));
    }).on('error',reject);
  });
}

async function loadUNESCOData(){
  // Download latest CSV from UNESCO IHP-WINS
  const csvUrl='https://ihpwinsdata.blob.core.windows.net/data/resources/2f46f6b2-45f9-402b-ace9-1e02c9c97a3d/whc-sites-2025.csv';
  console.log('Downloading UNESCO WHC data...');
  const csvText=await fetchUrl(csvUrl);
  const records=parseCSV(csvText);
  console.log(`UNESCO sites loaded: ${records.length}`);

  // Count by country
  const countByCountry={};
  const culturalByCountry={};
  const naturalByCountry={};
  const mixedByCountry={};
  for(const r of records){
    const country=r.states_name_en||'';
    if(!country) continue;
    countByCountry[country]=(countByCountry[country]||0)+1;
    const cat=r.category||'Cultural';
    if(cat==='Cultural') culturalByCountry[country]=(culturalByCountry[country]||0)+1;
    else if(cat==='Natural') naturalByCountry[country]=(naturalByCountry[country]||0)+1;
    else if(cat==='Mixed') mixedByCountry[country]=(mixedByCountry[country]||0)+1;
  }
  return {countByCountry, culturalByCountry, naturalByCountry, mixedByCountry};
}

async function buildGeoJSON(){
  const {countByCountry, culturalByCountry, naturalByCountry, mixedByCountry}=await loadUNESCOData();

  console.log('Fetching Natural Earth 110m + 50m...');
  const ne110=await fetchJson('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson');
  const ne50=await fetchJson('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson');

  const baseFeatures=ne110.features.filter(f=>f.properties.ADMIN!=='Antarctica');
  const adminSet=new Set(baseFeatures.map(f=>f.properties.ADMIN));

  // Microstates from 50m
  const extra=[];
  for(const f of ne50.features){
    const admin=f.properties.ADMIN;
    if(admin==='Antarctica') continue;
    if(!adminSet.has(admin) && f.properties.TYPE==='Sovereign country'){
      const g=JSON.parse(JSON.stringify(f.geometry));
      function rnd(c){
        if(typeof c[0]==='number') return [Math.round(c[0]*100)/100, Math.round(c[1]*100)/100];
        return c.map(rnd);
      }
      g.coordinates=rnd(g.coordinates);
      extra.push({type:'Feature', properties:f.properties, geometry:g});
    }
  }
  console.log(`Base 110m: ${baseFeatures.length}, extra microestados 50m: ${extra.length}`);
  const all=[...baseFeatures, ...extra];

  // Deduplicate by ADMIN
  const seen=new Set();
  const dedup=[];
  for(const f of all){
    const a=f.properties.ADMIN;
    if(seen.has(a)) continue;
    seen.add(a); dedup.push(f);
  }

  const geo={type:'FeatureCollection', features:[]};
  const seenNames=new Set();

  for(const raw of dedup){
    const propsRaw=raw.properties;
    const admin=propsRaw.ADMIN;
    if(admin==='Antarctica') continue;

    // Find UNESCO country name for this NE admin
    let unescoCountry=null;
    let totalSites=0;
    // Try exact match first
    if(countByCountry[admin]) {
      unescoCountry=admin;
      totalSites=countByCountry[admin];
    } else {
      // Try reverse mapping
      for(const [unescoName, neName] of Object.entries(UNESCO_TO_NE)){
        if(neName===admin && countByCountry[unescoName]){
          unescoCountry=unescoName;
          totalSites=countByCountry[unescoName];
          break;
        }
      }
    }

    // If no match, try partial matching
    if(!unescoCountry){
      for(const [unescoName, count] of Object.entries(countByCountry)){
        const mapped=UNESCO_TO_NE[unescoName];
        if(mapped && mapped===admin){
          unescoCountry=unescoName;
          totalSites=count;
          break;
        }
      }
    }

    const cultural=culturalByCountry[unescoCountry]||0;
    const natural=naturalByCountry[unescoCountry]||0;
    const mixed=mixedByCountry[unescoCountry]||0;

    // Spanish name: prefer NAME_ES, else NAME, else ADMIN
    let esName=propsRaw.NAME_ES;
    if(!esName || esName==='-99') esName=propsRaw.NAME||admin;

    const continentEn=propsRaw.CONTINENT||'';
    const continente=CONTINENT_ES[continentEn] || continentEn || '—';

    // Ensure unique _manaName
    let uniqueEs=esName;
    let dup=1;
    while(seenNames.has(uniqueEs)){
      dup++; uniqueEs=`${esName} (${dup})`;
    }
    seenNames.add(uniqueEs);

    const color=colorForCount(totalSites);
    const opacity=totalSites===0?0.45:0.82;

    // Simplify geometry
    const geom=raw.geometry;
    function roundCoords(c){
      if(typeof c[0]==='number') return [Math.round(c[0]*100)/100, Math.round(c[1]*100)/100];
      return c.map(roundCoords);
    }
    const simplifiedGeom={type:geom.type, coordinates: roundCoords(geom.coordinates)};

    const catBreakdown=[`${cultural} culturales`, `${natural} naturales`, `${mixed} mixtos`].join(', ');
    const description=totalSites>0
      ? `${uniqueEs} — ${totalSites} sitio${totalSites!==1?'s':''} UNESCO (${catBreakdown}) — ${continente}`
      : `${uniqueEs} — Sin sitios UNESCO inscritos — ${continente}`;

    const feature={
      type:'Feature',
      properties:{
        _manaName: uniqueEs,
        name: admin,
        _manaColor: color,
        _manaFillOpacity: opacity,
        _manaWeight: 0.7,
        _manaBorderColor: '#FFFFFF',
        _manaGroupName: 'Patrimonio UNESCO',
        _manaGroupId: 'patrimonio-unesco',
        _manaLabelStyle: { fontSize:11, fontFamily:'DM Sans, sans-serif', fontWeight:'600', color:'#1e293b', haloWidth:3, haloColor:'#FFFFFF', placement:'point' },
        'País': uniqueEs,
        'País (EN)': admin,
        'Continente': continente,
        'Sitios UNESCO': totalSites,
        'Culturales': cultural,
        'Naturales': natural,
        'Mixtos': mixed,
        'Categorías': catBreakdown,
        'Año': 2025,
        'Fuente': 'UNESCO World Heritage Centre — IHP-WINS 2025',
        'Description': description,
        'Superficie': continente,
        'Dato': `${totalSites} sitio${totalSites!==1?'s':''}`
      },
      geometry: simplifiedGeom
    };
    geo.features.push(feature);
  }

  // Sort by count desc
  geo.features.sort((a,b)=>b.properties['Sitios UNESCO']-a.properties['Sitios UNESCO']);

  const totalSites=geo.features.reduce((s,f)=>s+f.properties['Sitios UNESCO'],0);
  console.log(`Features: ${geo.features.length}, total UNESCO sites: ${totalSites}`);
  return geo;
}

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
  const geo=await buildGeoJSON();
  const geojsonText=JSON.stringify(geo);
  console.log(`GeoJSON ${(geojsonText.length/1024).toFixed(1)} KB, features ${geo.features.length}`);
  if(geojsonText.length>1048576){ console.error('ERROR >1MiB'); process.exit(1); }

  // Validaciones AGENTS.md
  const hexOk=geo.features.every(f=>/^#[0-9a-fA-F]{6}$/.test(f.properties._manaColor));
  console.log('hex valid', hexOk);
  const haloOk=geo.features.every(f=>f.properties._manaLabelStyle.haloWidth>=2);
  console.log('haloWidth >=2', haloOk);
  const coordsOk=geo.features.every(f=>{
    let ok=true;
    function walk(c){ if(typeof c[0]==='number'){ if(c[0]<-180||c[0]>180||c[1]<-90||c[1]>90) ok=false; } else c.forEach(walk); }
    walk(f.geometry.coordinates); return ok;
  });
  console.log('coords within ±180/±90', coordsOk);
  const dupNames=new Set(geo.features.map(f=>f.properties._manaName));
  console.log('unique names', dupNames.size===geo.features.length);
  const counts=geo.features.map(f=>f.properties['Sitios UNESCO']);
  console.log('sites min', Math.min(...counts), 'max', Math.max(...counts));

  // Save intermediate data
  const dataDir=path.join(__dirname,'..','strategy','data','unesco-world-heritage');
  if(!fs.existsSync(dataDir)) fs.mkdirSync(dataDir,{recursive:true});
  fs.writeFileSync(path.join(dataDir,'patrimonio-unesco-por-pais.json'), JSON.stringify({
    _source:'UNESCO World Heritage Centre — IHP-WINS 2025',
    _date:'2025-07-24',
    countries:geo.features.map(f=>({name:f.properties['País'], sites:f.properties['Sitios UNESCO'], cultural:f.properties['Culturales'], natural:f.properties['Naturales'], mixed:f.properties['Mixtos']})).filter(f=>f.sites>0)
  },null,2));

  const preview=buildMapPreview(geo);
  const now=Date.now();
  const serverNow={timestampValue:new Date().toISOString()};
  const docFields={
    id:fsStr(SLUG), slug:fsStr(SLUG),
    title:fsStr('Sitios Patrimonio de la Humanidad UNESCO por País'),
    name:fsStr('Sitios Patrimonio de la Humanidad UNESCO por País'),
    description:fsStr('Número de sitios del Patrimonio de la Humanidad de la UNESCO inscritos por país (1.248 sitios en 168 países). Colores de claro a oscuro según cantidad. Datos oficiales UNESCO IHP-WINS 2025.'),
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
    dataSource:fsStr('UNESCO World Heritage Centre — IHP-WINS World Heritage Site List 2025 (DOI: 10.63253/qblhcalw). 1.248 sitios inscritos en 168 Estados Parte.'),
    dataDate:fsStr('2025-07-24'),
    dataYear:fsInt(2025),
    tags:fsArr(['Cultura','Patrimonio','Países']),
    authorHandle:fsStr('maña-maps'), createdBy:fsStr('maña-maps'), ownerUid:fsStr('maña-maps'),
    createdAtMs:fsInt(now), updatedAtMs:fsInt(now), createdAt:serverNow, updatedAt:serverNow,
    views:fsInt(0), likes:fsInt(0)
  };

  if(DRY_RUN){
    console.log('\n=== DRY RUN ===');
    fs.writeFileSync(path.join(__dirname,'..','data','patrimonio-unesco-por-pais.geojson'), geojsonText);
    console.log('GeoJSON guardado en data/patrimonio-unesco-por-pais.geojson');
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
