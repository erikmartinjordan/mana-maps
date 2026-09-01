#!/usr/bin/env node
// ── patch-legends.js ─
// Añade legend genérica a los 10 docs curados en Firestore
// Sin inferencia: la galería solo pinta si doc.legend existe.
// Uso: node scripts/patch-legends.js [--dry-run]
'use strict';
const https=require('https'), fs=require('fs'), path=require('path');
const PROJECT_ID='mana-maps-pro-f2177';
const DATABASE='(default)';
const COLLECTION='maps';
const DRY_RUN=process.argv.includes('--dry-run');

function loadPublisherCredentials(){
  const p=process.env.PUBLISHER_CREDENTIALS;
  if(p){const abs=path.resolve(p); if(fs.existsSync(abs)) return JSON.parse(fs.readFileSync(abs,'utf8'));}
  try{
    const home=require('os').homedir();
    for(const cand of [home+'/.publisher-credentials.json','/home/erik/autopilot/.publisher-credentials.json']){
      if(fs.existsSync(cand)) return JSON.parse(fs.readFileSync(cand,'utf8'));
    }
  }catch(_){}
  return null;
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
async function firebaseAuthSignIn(email,password,apiKey){
  const url=`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const body=JSON.stringify({email,password,returnSecureToken:true});
  const res=await httpsRequest(url,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},body);
  if(res.status!==200) throw new Error(`Firebase Auth sign-in failed (${res.status}): ${JSON.stringify(res.data)}`);
  return {idToken:res.data.idToken, uid:res.data.localId};
}
async function getToken(){
  const pub=loadPublisherCredentials();
  if(!pub) throw new Error('no publisher creds');
  const r=await firebaseAuthSignIn(pub.email,pub.password,pub.apiKey);
  return r;
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

// ── Legends para los 10 mapas (colores y valores ya existentes) ──
const LEGENDS = {
  'longest-rivers-world': {
    title: 'Longitud del río',
    steps: [
      { v: 4444, c: '#E3F2FD', label: '4.444 km – Amur' },
      { v: 4700, c: '#BBDEFB', label: '4.700 km – Congo' },
      { v: 4880, c: '#90CAF9', label: '4.880 km – Paraná' },
      { v: 5410, c: '#64B5F6', label: '5.410 km – Ob-Irtysh' },
      { v: 5464, c: '#42A5F5', label: '5.464 km – Río Amarillo' },
      { v: 5539, c: '#2196F3', label: '5.539 km – Yenisei' },
      { v: 6275, c: '#1E88E5', label: '6.275 km – Misisipi' },
      { v: 6300, c: '#1976D2', label: '6.300 km – Yangtsé' },
      { v: 6400, c: '#1565C0', label: '6.400 km – Amazonas' },
      { v: 6650, c: '#0D47A1', label: '6.650 km – Nilo' }
    ]
  },
  'submarine-fiber-cables': {
    title: 'Año de puesta en servicio',
    steps: [
      { v: 2000, c: '#E3F2FD', label: '2000' },
      { v: 2002, c: '#D1E4F5', label: '2002' },
      { v: 2009, c: '#BFD6EE', label: '2009' },
      { v: 2010, c: '#AEC7E6', label: '2010' },
      { v: 2012, c: '#9CB9DE', label: '2012' },
      { v: 2016, c: '#8AABD7', label: '2016' },
      { v: 2017, c: '#789DCF', label: '2017' },
      { v: 2018, c: '#668EC7', label: '2018' },
      { v: 2020, c: '#5480C0', label: '2020' },
      { v: 2021, c: '#4372B8', label: '2021' },
      { v: 2022, c: '#3164B0', label: '2022' },
      { v: 2024, c: '#1F55A9', label: '2024' },
      { v: 2025, c: '#0D47A1', label: '2025' }
    ]
  },
  'minimum-wage-by-country': {
    title: 'Salario mínimo anual (USD)',
    steps: [
      { v: 0, c: '#d9d9d9', label: 'Sin dato' },
      { v: 2500, c: '#c6dbef', label: '< 5.000 $' },
      { v: 7500, c: '#6baed6', label: '5.000–10.000 $' },
      { v: 15000, c: '#4292c6', label: '10.000–20.000 $' },
      { v: 27500, c: '#2171b5', label: '20.000–35.000 $' },
      { v: 40000, c: '#08306b', label: '> 35.000 $' }
    ]
  },
  'oceans-and-seas-world': {
    title: 'Profundidad media',
    steps: [
      { v: 55, c: '#cfe3f0', label: '55 m' },      // Báltico
      { v: 90, c: '#dbeef8', label: '90 m' },      // Pérsico (representa grupo #dbeef8)
      { v: 1205, c: '#cfe3f0', label: '1.205 m' }, // Ártico
      { v: 3270, c: '#a5c8de', label: '3.270 m' }, // Antártico
      { v: 3646, c: '#78aac8', label: '3.646 m' }, // Atlántico
      { v: 3741, c: '#4d8cb0', label: '3.741 m' }, // Índico
      { v: 4280, c: '#22689a', label: '4.280 m' }  // Pacífico
    ]
  },
  'active-volcanoes-world': {
    title: 'Volcanes activos',
    steps: [
      { v: 86, c: '#d90429', label: 'Volcán activo (86)' }
    ]
  },
  'highest-peaks-per-continent': {
    title: 'Cumbres más altas',
    steps: [
      { v: 8849, c: '#1d4ed8', label: 'Cumbre (7 continentes)' }
    ]
  },
  'major-deserts-world': {
    title: 'Tipo de desierto',
    steps: [
      { v: 11, c: '#d97706', label: 'Cálido (11)' },
      { v: 4, c: '#7c3aed', label: 'Frío / Polar (4)' }
    ]
  },
  'worst-wildfires-world': {
    title: 'Incendios forestales',
    steps: [
      { v: 20, c: '#ff4500', label: 'Incendio extremo (20)' }
    ]
  },
  'arrecifes-de-coral-fosas-oceanicas-y-naufragios-famosos-3172026-1785478772912': {
    title: 'Categorías',
    steps: [
      { v: 1, c: '#0ea5e9', label: 'Fosa de las Marianas' },
      { v: 2, c: '#f59e0b', label: 'Titanic (3.800 m)' },
      { v: 3, c: '#ef4444', label: 'Bismarck (4.790 m)' },
      { v: 4, c: '#22c55e', label: 'Thistlegorm (30 m)' },
      { v: 5, c: '#a855f7', label: 'Deriva del Titanic' },
      { v: 6, c: '#ec4899', label: 'Arco de fosas' },
      { v: 7, c: '#14b8a6', label: 'Gran Barrera' },
      { v: 8, c: '#f97316', label: 'Triángulo de Coral' }
    ]
  },
  'ciudades-perdidas-y-ruinas-arqueologicas-fascinantes-3072026-1785391217436': {
    title: 'Sitios arqueológicos',
    steps: [
      { v: 1, c: '#0ea5e9', label: 'Machu Picchu' },
      { v: 2, c: '#f59e0b', label: 'Petra' },
      { v: 3, c: '#ef4444', label: 'Angkor Wat' },
      { v: 4, c: '#22c55e', label: 'Tikal' },
      { v: 5, c: '#a855f7', label: 'Dar al-Hajar' },
      { v: 6, c: '#ec4899', label: 'Kilwa Kisiwani' },
      { v: 7, c: '#14b8a6', label: 'Camino Inca' },
      { v: 8, c: '#f97316', label: 'Angkor (complejo)' }
    ]
  }
};

// Para océanos, deduplicar: originalmente 6 colores distintos pero 18 features; rampa debe ser 6 pasos claros.
// Simplificamos a 6 pasos ordenados por profundidad (usando colores reales):
LEGENDS['oceans-and-seas-world'] = {
  title: 'Profundidad media',
  steps: [
    { v: 55, c: '#dbeef8', label: '55 m' },
    { v: 1205, c: '#cfe3f0', label: '1.205 m' },
    { v: 3270, c: '#a5c8de', label: '3.270 m' },
    { v: 3646, c: '#78aac8', label: '3.646 m' },
    { v: 3741, c: '#4d8cb0', label: '3.741 m' },
    { v: 4280, c: '#22689a', label: '4.280 m' }
  ]
};

function legendToFirestore(legend){
  return {
    mapValue: {
      fields: {
        title: { stringValue: legend.title },
        steps: {
          arrayValue: {
            values: legend.steps.map(s => ({
              mapValue: { fields: { v: { doubleValue: s.v }, c: { stringValue: s.c }, label: { stringValue: s.label } } }
            }))
          }
        }
      }
    }
  };
}

async function main(){
  console.log('Patching legends for 10 mapas curados...');
  const auth = await getToken();
  const token = auth.idToken;
  const uid = auth.uid;
  console.log('Auth uid', uid);
  for(const slug of Object.keys(LEGENDS)){
    const legend = LEGENDS[slug];
    console.log(`\n--- ${slug} ---`);
    const existing = await firestoreRequest(token,'GET',`/${COLLECTION}/${slug}`);
    if(existing.status!==200){
      console.warn(`  not found ${slug}: ${existing.status} ${JSON.stringify(existing.data).slice(0,400)}`);
      continue;
    }
    const fields = existing.data.fields || {};
    // Parse geojsonText and inject legend
    let geojsonText = fields.geojsonText?.stringValue;
    let geo = null;
    try { geo = geojsonText ? JSON.parse(geojsonText) : null; } catch(e){ console.warn('  geo parse fail', e.message); }
    if(geo){
      geo.legend = legend;
      const newGeoText = JSON.stringify(geo);
      if(newGeoText.length>1048576){
        console.error('  new geo exceeds 1MiB, skipping geo update');
      } else {
        geojsonText = newGeoText;
      }
    }
    const patchFields = {
      legend: legendToFirestore(legend),
      geojsonText: { stringValue: geojsonText }
    };
    // Also keep updatedAt
    patchFields.updatedAtMs = { integerValue: String(Date.now()) };
    patchFields.updatedAt = { timestampValue: new Date().toISOString() };

    if(DRY_RUN){
      console.log(`  DRY RUN would patch legend "${legend.title}" steps=${legend.steps.length} geoSize=${(geojsonText.length/1024).toFixed(1)}KB`);
      continue;
    }
    const fieldPaths = Object.keys(patchFields).map(f=>`updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
    const res = await firestoreRequest(token,'PATCH',`/${COLLECTION}/${slug}?${fieldPaths}`,{fields: patchFields});
    if(res.status>=400){
      console.error(`  PATCH failed ${res.status} ${JSON.stringify(res.data).slice(0,800)}`);
      process.exitCode=1;
    } else {
      console.log(`  PATCH ok title="${legend.title}" steps=${legend.steps.length}`);
    }
    // Verify
    const verify = await firestoreRequest(token,'GET',`/${COLLECTION}/${slug}`);
    const hasLegend = !!verify.data.fields?.legend;
    const hasGeoLegend = (()=>{ try{ return !!JSON.parse(verify.data.fields?.geojsonText?.stringValue||'{}').legend; }catch(_){return false;}})();
    console.log(`  verify legend field: ${hasLegend}, geo.legend: ${hasGeoLegend}`);
  }
  console.log('\nDone.');
}
main().catch(e=>{console.error(e); process.exit(1);});
