#!/usr/bin/env node
// audit-gallery.js — ver AGENTS.md, solo lectura Firestore
'use strict';
const https=require('https');
const PROJECT='mana-maps-pro-f2177';
function get(url){return new Promise((res,rej)=>{https.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){res(d)}})}).on('error',rej)})}
async function main(){
  const url='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents/maps?pageSize=50';
  const data=await get(url);
  const docs=(data.documents||[]);
  console.log('MAPS',docs.length);
  for(const d of docs){
    const id=d.name.split('/').pop();
    const f=d.fields||{};
    const pub=f.isPublished&&f.isPublished.booleanValue;
    const title=(f.title&&f.title.stringValue)||(f.name&&f.name.stringValue)||id;
    const gt=(f.geojsonText&&f.geojsonText.stringValue)||'';
    let feats=0; try{feats=gt?JSON.parse(gt).features.length:0}catch(e){}
    const tags=f.tags&&f.tags.arrayValue? (f.tags.arrayValue.values||[]).map(v=>v.stringValue).join(','):'';
    const src=f.dataSource&&f.dataSource.stringValue||'';
    console.log([id,pub,feats,tags||'-',src?src.slice(0,30):'-',title.slice(0,40)].join(' | '));
    if(pub && gt){
      try{
        const geo=JSON.parse(gt);
        const bad=geo.features.filter(x=>!x.properties._manaLabelStyle||x.properties._manaLabelStyle.haloWidth<2).length;
        if(bad) console.log('  WARN '+id+' '+bad+' features sin halo>=2');
      }catch(e){}
    }
  }
}
main();
