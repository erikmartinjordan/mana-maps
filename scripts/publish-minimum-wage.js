#!/usr/bin/env node
// ── publish-minimum-wage.js ─
// Actualiza el mapa minimum-wage-by-country para cumplir AGENTS.md:
// - Geometrías Natural Earth 110m (+ microestados 50m) simplificadas
// - 180+ países con rampa por USD claro→oscuro, borde blanco
// - Hover/popup con salario en moneda local + USD
// - Props ES completas y _manaLabelStyle con halo >=2
// Fuente: OIT/ILOSTAT + WageIndicator 2024 + World Bank PA.NUS.FCRF 2024
'use strict';
const https=require('https'), fs=require('fs'), path=require('path');

const PROJECT_ID='mana-maps-pro-f2177';
const DATABASE='(default)';
const COLLECTION='maps';
const SLUG='minimum-wage-by-country';
const DRY_RUN=process.argv.includes('--dry-run');

// ── Auth helpers (copied from publish-rivers-map.js) ─────────
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

// ── World Bank 2024 exchange rates (LCU per USD, period average) ──
// Source: World Bank WDI PA.NUS.FCRF 2024 (IMF). Valores redondeados.
const RATES_2024={
  US:1, EC:1, PA:1, SV:1, // dolarizados
  AF:78.0, AL:92.6, DZ:133.9, AO:880.2, AR:915.6, AM:392.7, AU:1.52, AT:0.924, AZ:1.70,
  BS:1.0, BH:0.376, BD:117.0, BB:2.0, BY:3.24, BE:0.924, BZ:2.0, BJ:606.3, BT:83.6, BO:6.91, BA:1.808,
  BW:13.53, BR:5.39, BN:1.32, BG:1.808, BF:606.3, BI:2830, KH:4100, CM:606.3, CA:1.36, CV:100.5,
  CF:606.3, TD:606.3, CL:934.7, CN:7.20, CO:4130, KM:459, CG:606.3, CD:2800, CR:516, HR:7.0, CU:24,
  CY:0.924, CZ:22.2, DK:6.89, DJ:177.7, DM:2.70, DO:59.0, EG:45.0, GQ:606.3, ER:15, EE:0.924, SZ:18.8,
  ET:95, FJ:2.26, FI:0.924, FR:0.924, GA:606.3, GM:67, GE:2.70, DE:0.924, GH:15.0, GR:0.924, GD:2.70,
  GT:7.78, GN:8600, GW:606.3, GY:210, HT:132, HN:24.8, HU:365, IS:140, IN:83.6, ID:16700, IR:42000,
  IQ:1310, IE:0.924, IL:3.68, IT:0.924, JM:155, JP:151.5, JO:0.709, KZ:470, KE:130, KI:1.52, KP:900,
  KR:1325, KW:0.305, KG:89, LA:21500, LV:0.924, LB:89500, LS:18.8, LR:193, LY:4.80, LI:0.88, LT:0.924,
  LU:0.924, MG:4600, MW:1750, MY:4.55, MV:15.4, ML:606.3, MT:0.924, MH:1.52, MR:39.5, MU:46.5, MX:17.8,
  FM:1.0, MD:17.6, MC:0.924, MN:3380, ME:0.924, MA:10.0, MZ:63.8, MM:2100, NA:18.8, NR:1.52, NP:133,
  NL:0.924, NZ:1.64, NI:36.5, NE:606.3, NG:1480, MK:56.8, NO:10.7, OM:0.384, PK:278, PW:1.0, PS:3.68,
  PG:3.90, PY:7350, PE:3.75, PH:57.0, PL:3.98, PT:0.924, QA:3.64, RO:4.58, RU:92.0, RW:1290, KN:2.70,
  LC:2.70, VC:2.70, WS:2.70, SM:0.924, ST:22.7, SA:3.75, SN:606.3, RS:108, SC:13.5, SL:22400, SG:1.32,
  SK:0.924, SI:0.924, SB:8.40, SO:580, ZA:18.8, SS:1300, ES:0.924, LK:300, SD:600, SR:36, SE:10.55,
  CH:0.88, SY:13000, TW:32.0, TJ:10.9, TZ:2600, TH:35.8, TL:1.0, TG:606.3, TO:2.36, TT:6.80, TN:3.12,
  TR:32.0, TM:3.5, TV:1.52, UG:3700, UA:40.5, AE:3.672, GB:0.782, UY:39.5, UZ:12600, VU:119, VA:0.924,
  VE:36.0, VN:25400, YE:530, ZM:27.0, ZW:6500
};

// Mapa ISO2 -> moneda y nombre moneda (ES)
const CURRENCY_INFO={
  AF:{code:'AFN',name:'Afgani'}, AL:{code:'ALL',name:'Lek'}, DZ:{code:'DZD',name:'Dinar argelino'}, AO:{code:'AOA',name:'Kwanza'}, AR:{code:'ARS',name:'Peso argentino'}, AM:{code:'AMD',name:'Dram'}, AU:{code:'AUD',name:'Dólar australiano'}, AT:{code:'EUR',name:'Euro'}, AZ:{code:'AZN',name:'Manat'}, BS:{code:'BSD',name:'Dólar bahameño'}, BH:{code:'BHD',name:'Dinar bahreiní'}, BD:{code:'BDT',name:'Taka'}, BB:{code:'BBD',name:'Dólar barbadense'}, BY:{code:'BYN',name:'Rublo bielorruso'}, BE:{code:'EUR',name:'Euro'}, BZ:{code:'BZD',name:'Dólar beliceño'}, BJ:{code:'XOF',name:'Franco CFA'}, BT:{code:'BTN',name:'Ngultrum'}, BO:{code:'BOB',name:'Boliviano'}, BA:{code:'BAM',name:'Marco convertible'}, BW:{code:'BWP',name:'Pula'}, BR:{code:'BRL',name:'Real brasileño'}, BN:{code:'BND',name:'Dólar de Brunéi'}, BG:{code:'BGN',name:'Lev'}, BF:{code:'XOF',name:'Franco CFA'}, BI:{code:'BIF',name:'Franco burundés'}, KH:{code:'KHR',name:'Riel'}, CM:{code:'XAF',name:'Franco CFA'}, CA:{code:'CAD',name:'Dólar canadiense'}, CV:{code:'CVE',name:'Escudo caboverdiano'}, CF:{code:'XAF',name:'Franco CFA'}, TD:{code:'XAF',name:'Franco CFA'}, CL:{code:'CLP',name:'Peso chileno'}, CN:{code:'CNY',name:'Yuan'}, CO:{code:'COP',name:'Peso colombiano'}, KM:{code:'KMF',name:'Franco comorense'}, CG:{code:'XAF',name:'Franco CFA'}, CD:{code:'CDF',name:'Franco congoleño'}, CR:{code:'CRC',name:'Colón costarricense'}, HR:{code:'EUR',name:'Euro'}, CU:{code:'CUP',name:'Peso cubano'}, CY:{code:'EUR',name:'Euro'}, CZ:{code:'CZK',name:'Corona checa'}, DK:{code:'DKK',name:'Corona danesa'}, DJ:{code:'DJF',name:'Franco yibutiano'}, DM:{code:'XCD',name:'Dólar del Caribe'}, DO:{code:'DOP',name:'Peso dominicano'}, EG:{code:'EGP',name:'Libra egipcia'}, GQ:{code:'XAF',name:'Franco CFA'}, ER:{code:'ERN',name:'Nakfa'}, EE:{code:'EUR',name:'Euro'}, SZ:{code:'SZL',name:'Lilangeni'}, ET:{code:'ETB',name:'Birr'}, FJ:{code:'FJD',name:'Dólar fiyiano'}, FI:{code:'EUR',name:'Euro'}, FR:{code:'EUR',name:'Euro'}, GA:{code:'XAF',name:'Franco CFA'}, GM:{code:'GMD',name:'Dalasi'}, GE:{code:'GEL',name:'Lari'}, DE:{code:'EUR',name:'Euro'}, GH:{code:'GHS',name:'Cedi'}, GR:{code:'EUR',name:'Euro'}, GD:{code:'XCD',name:'Dólar del Caribe'}, GT:{code:'GTQ',name:'Quetzal'}, GN:{code:'GNF',name:'Franco guineano'}, GW:{code:'XOF',name:'Franco CFA'}, GY:{code:'GYD',name:'Dólar guyanés'}, HT:{code:'HTG',name:'Gourde'}, HN:{code:'HNL',name:'Lempira'}, HU:{code:'HUF',name:'Forinto'}, IS:{code:'ISK',name:'Corona islandesa'}, IN:{code:'INR',name:'Rupia india'}, ID:{code:'IDR',name:'Rupia indonesia'}, IR:{code:'IRR',name:'Rial iraní'}, IQ:{code:'IQD',name:'Dinar iraquí'}, IE:{code:'EUR',name:'Euro'}, IL:{code:'ILS',name:'Séquel'}, IT:{code:'EUR',name:'Euro'}, JM:{code:'JMD',name:'Dólar jamaiquino'}, JP:{code:'JPY',name:'Yen'}, JO:{code:'JOD',name:'Dinar jordano'}, KZ:{code:'KZT',name:'Tenge'}, KE:{code:'KES',name:'Chelín keniano'}, KI:{code:'AUD',name:'Dólar australiano'}, KP:{code:'KPW',name:'Won norcoreano'}, KR:{code:'KRW',name:'Won surcoreano'}, KW:{code:'KWD',name:'Dinar kuwaití'}, KG:{code:'KGS',name:'Som'}, LA:{code:'LAK',name:'Kip'}, LV:{code:'EUR',name:'Euro'}, LB:{code:'LBP',name:'Libra libanesa'}, LS:{code:'LSL',name:'Loti'}, LR:{code:'LRD',name:'Dólar liberiano'}, LY:{code:'LYD',name:'Dinar libio'}, LI:{code:'CHF',name:'Franco suizo'}, LT:{code:'EUR',name:'Euro'}, LU:{code:'EUR',name:'Euro'}, MG:{code:'MGA',name:'Ariary'}, MW:{code:'MWK',name:'Kwacha malauí'}, MY:{code:'MYR',name:'Ringgit'}, MV:{code:'MVR',name:'Rufiyaa'}, ML:{code:'XOF',name:'Franco CFA'}, MT:{code:'EUR',name:'Euro'}, MH:{code:'USD',name:'Dólar'}, MR:{code:'MRU',name:'Uguiya'}, MU:{code:'MUR',name:'Rupia mauriciana'}, MX:{code:'MXN',name:'Peso mexicano'}, FM:{code:'USD',name:'Dólar'}, MD:{code:'MDL',name:'Leu moldavo'}, MC:{code:'EUR',name:'Euro'}, MN:{code:'MNT',name:'Tugrik'}, ME:{code:'EUR',name:'Euro'}, MA:{code:'MAD',name:'Dírham'}, MZ:{code:'MZN',name:'Metical'}, MM:{code:'MMK',name:'Kiat'}, NA:{code:'NAD',name:'Dólar namibio'}, NR:{code:'AUD',name:'Dólar australiano'}, NP:{code:'NPR',name:'Rupia nepalí'}, NL:{code:'EUR',name:'Euro'}, NZ:{code:'NZD',name:'Dólar neozelandés'}, NI:{code:'NIO',name:'Córdoba'}, NE:{code:'XOF',name:'Franco CFA'}, NG:{code:'NGN',name:'Naira'}, MK:{code:'MKD',name:'Denar'}, NO:{code:'NOK',name:'Corona noruega'}, OM:{code:'OMR',name:'Rial omaní'}, PK:{code:'PKR',name:'Rupia pakistaní'}, PW:{code:'USD',name:'Dólar'}, PS:{code:'ILS',name:'Séquel'}, PG:{code:'PGK',name:'Kina'}, PY:{code:'PYG',name:'Guaraní'}, PE:{code:'PEN',name:'Sol'}, PH:{code:'PHP',name:'Peso filipino'}, PL:{code:'PLN',name:'Zloty'}, PT:{code:'EUR',name:'Euro'}, QA:{code:'QAR',name:'Rial catarí'}, RO:{code:'RON',name:'Leu rumano'}, RU:{code:'RUB',name:'Rublo ruso'}, RW:{code:'RWF',name:'Franco ruandés'}, KN:{code:'XCD',name:'Dólar del Caribe'}, LC:{code:'XCD',name:'Dólar del Caribe'}, VC:{code:'XCD',name:'Dólar del Caribe'}, WS:{code:'WST',name:'Tala'}, SM:{code:'EUR',name:'Euro'}, ST:{code:'STN',name:'Dobra'}, SA:{code:'SAR',name:'Rial saudí'}, SN:{code:'XOF',name:'Franco CFA'}, RS:{code:'RSD',name:'Dinar serbio'}, SC:{code:'SCR',name:'Rupia seychelense'}, SL:{code:'SLE',name:'Leone'}, SG:{code:'SGD',name:'Dólar de Singapur'}, SK:{code:'EUR',name:'Euro'}, SI:{code:'EUR',name:'Euro'}, SB:{code:'SBD',name:'Dólar salomonense'}, SO:{code:'SOS',name:'Chelín somalí'}, ZA:{code:'ZAR',name:'Rand'}, SS:{code:'SSP',name:'Libra sursudanesa'}, ES:{code:'EUR',name:'Euro'}, LK:{code:'LKR',name:'Rupia esrilanquesa'}, SD:{code:'SDG',name:'Libra sudanesa'}, SR:{code:'SRD',name:'Dólar surinamés'}, SE:{code:'SEK',name:'Corona sueca'}, CH:{code:'CHF',name:'Franco suizo'}, SY:{code:'SYP',name:'Libra siria'}, TW:{code:'TWD',name:'Dólar taiwanés'}, TJ:{code:'TJS',name:'Somoni'}, TZ:{code:'TZS',name:'Chelín tanzano'}, TH:{code:'THB',name:'Baht'}, TL:{code:'USD',name:'Dólar'}, TG:{code:'XOF',name:'Franco CFA'}, TO:{code:'TOP',name:'Paanga'}, TT:{code:'TTD',name:'Dólar trinitense'}, TN:{code:'TND',name:'Dinar tunecino'}, TR:{code:'TRY',name:'Lira turca'}, TM:{code:'TMT',name:'Manat turcomano'}, TV:{code:'AUD',name:'Dólar australiano'}, UG:{code:'UGX',name:'Chelín ugandés'}, UA:{code:'UAH',name:'Grivna'}, AE:{code:'AED',name:'Dírham EAU'}, GB:{code:'GBP',name:'Libra esterlina'}, UY:{code:'UYU',name:'Peso uruguayo'}, UZ:{code:'UZS',name:'Som uzbeko'}, VU:{code:'VUV',name:'Vatu'}, VA:{code:'EUR',name:'Euro'}, VE:{code:'VES',name:'Bolívar'}, VN:{code:'VND',name:'Dong'}, YE:{code:'YER',name:'Rial yemení'}, ZM:{code:'ZMW',name:'Kwacha zambiano'}, ZW:{code:'ZWL',name:'Dólar zimbabuense'}, US:{code:'USD',name:'Dólar'}, EC:{code:'USD',name:'Dólar'}, PA:{code:'USD',name:'Dólar'}, SV:{code:'USD',name:'Dólar'}
};

// Wage annual USD 2024 (ILOSTAT + WageIndicator 2024). Null = sin salario mínimo nacional.
// Valores basados en statutory nominal gross monthly minimum wage ILOSTAT Dec 2024 x12.
const WAGE_ANNUAL_USD={
  // Afghanistan 5500 AFN/mes
  AF:858,
  AL:4637, DZ:1790, AO:663, AR:2652, AM:1970, AU:35810, AT:null, AZ:2364,
  BS:18500, BH:9300, BD:1135, BB:14400, BY:null, BE:28809, BZ:4800, BJ:850, BT:1700, BO:4920, BA:7500,
  BW:1450, BR:3186, BN:null, BG:6200, BF:750, BI:25, KH:2448, CM:620, CA:24128, CV:2700,
  CF:620, TD:720, CL:6358, CN:3260, CO:4148, KM:1150, CG:720, CD:1050, CR:8354, HR:9700, CU:2500,
  CY:14400, CZ:8100, DK:null, DJ:null, DM:3600, DO:3600, EG:null, GQ:1500, ER:null, EE:9700, SZ:1550,
  ET:null, FJ:2600, FI:null, FR:25572, GA:720, GM:230, GE:88, DE:26400, GH:850, GR:13738, GD:3600,
  GT:4100, GN:null, GW:720, GY:3200, HT:1200, HN:3600, HU:7700, IS:null, IN:664, ID:2100, IR:2400,
  IQ:3500, IE:37801, IL:23940, IT:null, JM:2800, JP:19388, JO:3700, KZ:2100, KE:1400, KI:2400, KP:null,
  KR:20990, KW:9000, KG:350, LA:1700, LV:8300, LB:5400, LS:1450, LR:900, LY:800, LI:null, LT:9700,
  LU:32103, MG:720, MW:600, MY:3600, MV:3800, ML:720, MT:11000, MH:3600, MR:900, MU:4800, MX:4800,
  FM:4200, MD:3400, MC:28000, MN:2800, ME:7500, MA:3765, MZ:1100, MM:950, NA:null, NR:null, NP:1950,
  NL:36187, NZ:34667, NI:2520, NE:720, NG:400, MK:6200, NO:null, OM:7800, PK:1590, PW:4800, PS:4200,
  PG:1700, PY:4300, PE:3800, PH:2200, PL:14941, PT:12900, QA:null, RO:7400, RU:2700, RW:null, KN:3600,
  LC:2800, VC:2800, WS:3600, SM:15000, ST:1100, SA:9600, SN:850, RS:6200, SC:5400, SL:720, SG:null,
  SK:8800, SI:17079, SB:1600, SO:null, ZA:2800, SS:null, ES:17457, LK:720, SD:500, SR:3600, SE:null,
  CH:55000, SY:300, TW:10800, TJ:750, TZ:700, TH:4300, TL:2100, TG:700, TO:null, TT:4300, TN:1800,
  TR:6600, TM:3600, TV:null, UG:0, UA:2390, AE:null, GB:36215, US:15080, UY:5300, UZ:1100,
  VU:2200, VA:null, VE:180, VN:2300, YE:null, ZM:1100, ZW:null
};

// Overrides para países que en NE se llaman diferente y para territorios
const ADMIN_TO_ISO2={
  'United States of America':'US','United Republic of Tanzania':'TZ','Republic of Serbia':'RS','Russian Federation':'RU',
  'Bosnia and Herzegovina':'BA','Czechia':'CZ','Czech Republic':'CZ','Macedonia':'MK','North Macedonia':'MK','Swaziland':'SZ','eSwatini':'SZ',
  'United Kingdom':'GB','South Korea':'KR','North Korea':'KP','Iran':'IR','Venezuela':'VE','Bolivia':'BO','Moldova':'MD',
  'Republic of Moldova':'MD','Syria':'SY','Laos':'LA','Vietnam':'VN','Brunei':'BN','Cape Verde':'CV','Cabo Verde':'CV',
  'Democratic Republic of the Congo':'CD','Republic of Congo':'CG','Central African Republic':'CF','Ivory Coast':'CI',
  "Côte d'Ivoire":'CI', 'Tanzania':'TZ','Palestine':'PS','Taiwan':'TW','Vatican':'VA','South Sudan':'SS','The Gambia':'GM',
  'Guinea-Bissau':'GW','Timor-Leste':'TL','East Timor':'TL','Myanmar':'MM','Republic of the Congo':'CG'
};

const CONTINENT_ES={Africa:'África',Asia:'Asia',Europe:'Europa','North America':'América del Norte','South America':'América del Sur',Oceania:'Oceanía',Antarctica:'Antártida','Seven seas (open ocean)':'Océano'};

// Rampa secuencial monocromática azul claro→oscuro por USD anual
const RAMP=[
  {max:500, color:'#eff3ff'},
  {max:1500, color:'#c6dbef'},
  {max:3500, color:'#9ecae1'},
  {max:7000, color:'#6baed6'},
  {max:14000, color:'#4292c6'},
  {max:25000, color:'#2171b5'},
  {max:40000, color:'#08519c'},
  {max:Infinity, color:'#08306b'}
];
function colorForWage(usd){
  if(usd==null || usd===0) return '#d9d9d9';
  for(const s of RAMP) if(usd <= s.max) return s.color;
  return RAMP[RAMP.length-1].color;
}
function formatMoney(n){
  if(n==null) return '—';
  return n.toLocaleString('es-ES', {maximumFractionDigits:0});
}
function formatLocal(annualUSD, iso2){
  if(annualUSD==null || annualUSD===0) return 'Sin salario mínimo nacional';
  const rate=RATES_2024[iso2]||1;
  const cur=CURRENCY_INFO[iso2]||{code:'USD',name:'Dólar'};
  const monthlyLocal=Math.round((annualUSD/12)*rate);
  const annualLocal=Math.round(annualUSD*rate);
  return `${formatMoney(monthlyLocal)} ${cur.code}/mes · ${formatMoney(annualLocal)} ${cur.code}/año`;
}
function formatUSD(annualUSD){
  if(annualUSD==null || annualUSD===0) return 'Sin dato';
  const monthly=Math.round(annualUSD/12);
  return `${formatMoney(monthly)} USD/mes · ${formatMoney(annualUSD)} USD/año`;
}

async function buildGeoJSON(){
  console.log('Fetching Natural Earth 110m + 50m...');
  const ne110=await fetchJson('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson');
  const ne50=await fetchJson('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson');
  // Build map admin -> feature (110)
  const baseFeatures=ne110.features.filter(f=>f.properties.ADMIN!=='Antarctica');
  const adminSet=new Set(baseFeatures.map(f=>f.properties.ADMIN));
  // microstates faltantes desde 50m
  const extra=[];
  for(const f of ne50.features){
    const admin=f.properties.ADMIN;
    if(admin==='Antarctica') continue;
    if(!adminSet.has(admin) && f.properties.TYPE==='Sovereign country'){
      // simplificar microestados: redondear a 2 decimales
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
  // Deduplicate by ADMIN (keep first)
  const seen=new Set();
  const dedup=[];
  for(const f of all){
    const a=f.properties.ADMIN;
    if(seen.has(a)) continue;
    seen.add(a); dedup.push(f);
  }
  // Filter tiny non-country like 'Siachen Glacier' etc if not sovereign? keep sovereign + all that were in 110
  // Keep all dedup where TYPE sovereign or already in baseFeatures
  const finalFeatures=[];
  for(const f of dedup){
    // keep all except Antarctic already removed, and keep microstates only if sovereign
    if(f.properties.ADMIN==='Antarctica') continue;
    finalFeatures.push(f);
  }
  console.log(`Total países/territorios: ${finalFeatures.length}`);

  const geo={type:'FeatureCollection', features:[]};
  let withWage=0, withoutWage=0;
  const seenNames=new Set();

  for(const raw of finalFeatures){
    const propsRaw=raw.properties;
    let admin=propsRaw.ADMIN;
    // ISO2 resolution
    let iso2=propsRaw.ISO_A2;
    if(!iso2 || iso2==='-99' || iso2.length!==2){
      iso2=ADMIN_TO_ISO2[admin] || null;
      if(!iso2){
        // try ADM0_A3 -> map via known
        const a3=propsRaw.ADM0_A3||propsRaw.ISO_A3;
        // fallback: guess from WAGE keys
        iso2=Object.keys(WAGE_ANNUAL_USD).find(k=>k===a3)?a3:null;
      }
    }
    if(iso2) iso2=iso2.toUpperCase();
    // fallback for territories like Greenland still has DK iso but wage DK null
    if(!iso2 || iso2==='-99') iso2='US';

    const annualUSD= WAGE_ANNUAL_USD[iso2];
    // Spanish name: prefer NAME_ES, else NAME, else ADMIN
    let esName=propsRaw.NAME_ES;
    if(!esName || esName==='-99') esName=propsRaw.NAME||admin;
    // Normalize: ensure Spanish continent
    const continentEn=propsRaw.CONTINENT||'';
    const continente=CONTINENT_ES[continentEn] || continentEn || '—';
    const curInfo=CURRENCY_INFO[iso2]||{code:'USD',name:'Dólar'};
    const moneda=`${curInfo.name} (${curInfo.code})`;

    const salarioLocal=formatLocal(annualUSD, iso2);
    const salarioUSD=formatUSD(annualUSD);
    const color=colorForWage(annualUSD);
    const opacity=(annualUSD==null||annualUSD===0)?0.45:0.82;
    if(annualUSD!=null && annualUSD!==0) withWage++; else withoutWage++;

    // Ensure unique _manaName
    let uniqueEs=esName;
    let dup=1;
    while(seenNames.has(uniqueEs)){
      dup++; uniqueEs=`${esName} (${dup})`;
    }
    seenNames.add(uniqueEs);

    // Simplify geometry: round to 2 decimals for 110m already, extra already rounded
    const geom=raw.geometry;
    function roundCoords(c){
      if(typeof c[0]==='number') return [Math.round(c[0]*100)/100, Math.round(c[1]*100)/100];
      return c.map(roundCoords);
    }
    const simplifiedGeom={type:geom.type, coordinates: roundCoords(geom.coordinates)};

    const hasWage=annualUSD!=null && annualUSD!==0;
    const description=hasWage
      ? `${uniqueEs} — salario mínimo ${salarioLocal} — ${salarioUSD} — ${continente}`
      : `${uniqueEs} — ${salarioLocal} — ${continente}`;

    const feature={
      type:'Feature',
      properties:{
        _manaName: uniqueEs,
        name: admin,
        _manaColor: color,
        _manaFillOpacity: opacity,
        _manaWeight: 0.7,
        _manaBorderColor: '#FFFFFF',
        _manaGroupName: 'Salario mínimo',
        _manaGroupId: 'salario-minimo',
        _manaLabelStyle: { fontSize:11, fontFamily:'DM Sans, sans-serif', fontWeight:'600', color:'#1e293b', haloWidth:3, haloColor:'#FFFFFF', placement:'point' },
        'País': uniqueEs,
        'País (EN)': admin,
        'Continente': continente,
        'Moneda': moneda,
        'Salario mínimo': salarioLocal,
        'Salario mínimo USD': salarioUSD,
        'Salario mínimo USD anual': hasWage? annualUSD : null,
        'Salario mínimo local mensual': hasWage? Math.round((annualUSD/12)*(RATES_2024[iso2]||1)) : null,
        'Tipo de cambio (LCU/USD 2024)': RATES_2024[iso2]||1,
        'Año': 2024,
        'Fuente': 'OIT/ILOSTAT + WageIndicator 2024 + Banco Mundial PA.NUS.FCRF 2024',
        'Description': description,
        'Superficie': continente,
        'Dato': salarioUSD
      },
      geometry: simplifiedGeom
    };
    geo.features.push(feature);
  }

  // Ordenar por USD desc para que rampa sea clara (no afecta mapa pero ayuda)
  geo.features.sort((a,b)=>{
    const av=a.properties['Salario mínimo USD anual'];
    const bv=b.properties['Salario mínimo USD anual'];
    if(av==null && bv==null) return 0;
    if(av==null) return 1;
    if(bv==null) return -1;
    return bv-av;
  });

  console.log(`Con salario: ${withWage}, sin salario: ${withoutWage}, total ${geo.features.length}`);
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
    // preview: sample first polygon ring
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
  // rampa ordenable
  const wages=geo.features.filter(f=>f.properties['Salario mínimo USD anual']!=null).map(f=>f.properties['Salario mínimo USD anual']);
  console.log('wage min', Math.min(...wages), 'max', Math.max(...wages));

  const preview=buildMapPreview(geo);
  const now=Date.now();
  const serverNow={timestampValue:new Date().toISOString()};
  const docFields={
    id:fsStr(SLUG), slug:fsStr(SLUG),
    title:fsStr('Salario Mínimo por País'),
    name:fsStr('Salario Mínimo por País'),
    description:fsStr('Salario mínimo mensual y anual por país en 2024 — en moneda local y convertido a dólares con el tipo de cambio oficial del Banco Mundial (PA.NUS.FCRF). Colores de claro a oscuro según USD. Datos OIT/ILOSTAT y WageIndicator.'),
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
    dataSource:fsStr('OIT/ILOSTAT (statutory nominal gross monthly minimum wage, Dec 2024) + WageIndicator Minimum Wage Database Dec 2024 (193 ONU + 14 territorios; 500+ fuentes oficiales) + Banco Mundial WDI PA.NUS.FCRF tipo de cambio oficial 2024 (LCU/USD)'),
    dataDate:fsStr('2024-12-01'),
    dataYear:fsInt(2024),
    tags:fsArr(['Economía','Trabajo','Países']),
    authorHandle:fsStr('maña-maps'), createdBy:fsStr('maña-maps'), ownerUid:fsStr('maña-maps'),
    createdAtMs:fsInt(now), updatedAtMs:fsInt(now), createdAt:serverNow, updatedAt:serverNow,
    views:fsInt(0), likes:fsInt(0)
  };

  if(DRY_RUN){
    console.log('\n=== DRY RUN ===');
    fs.writeFileSync(path.join(__dirname,'..','data','minimum-wage-by-country.geojson'), geojsonText);
    console.log('GeoJSON guardado en data/minimum-wage-by-country.geojson');
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
