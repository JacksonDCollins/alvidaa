'use strict';
// Adapted from simbasjungles/free-my-tv Recs.java, ed6be1ecaa98804c383fa021cdb648fd80f061f3.
// Copyright (c) 2026 Free My TV contributors. MIT: third-party/free-my-tv/LICENSE.
// Private worker only: never publish server addresses, credentials or authenticated URLs.
const https=require('node:https');
const dns=require('node:dns');
const net=require('node:net');
const crypto=require('node:crypto');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const IMAGE=/^\/plex-[a-f0-9]{64}\.jpg$/;
const TOKEN=/^[A-Za-z0-9._~-]{8,4096}$/;
const ART=/^\/library\/metadata\/[1-9][0-9]{0,9}\/(art|thumb)(\/[0-9]{1,16})?$/;
function serverOrigin(url){
 if(typeof url!=='string'||url.length>512)throw new Error('Invalid private Plex origin');
 let parsed;try{parsed=new URL(url);}catch{throw new Error('Invalid private Plex origin');}
 if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.plex.direct')||parsed.hostname.length>253||
    parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash||parsed.port==='0')throw Error('Plex requires its HTTPS plex.direct origin');
 return {origin:parsed.origin,hostname:parsed.hostname};
}
function createPlex(config,options={}){
 if(config.servers)return createLibraries(config.servers,options);
 // Revalidate even callers that did not come through the worker's credential reader.
 const candidates=config.origins||[config.origin];
 if(!Array.isArray(candidates)||!candidates.length||candidates.length>8)throw Error('Invalid Plex connections');
 const hosts=new Map(candidates.map(value=>{const checked=serverOrigin(value);return [checked.origin,checked.hostname];}));
 const origins=[...hosts.keys()];
 const {token}=config;
 if(typeof token!=='string'||!TOKEN.test(token))throw new Error('Invalid private Plex token');
 let origin=null;
 const get=options.get||https.get,lookup=options.lookup||dns.lookup,now=options.now||Date.now;
 const requests=new Set(),imageFailures=new Map();let stopped=false,inflight=null,state='pending',picks=[],refs=new Map();
 function request(path,image=false,signal,target=origin){
  const host=hosts.get(target);if(!host)return Promise.reject(Error('Unknown Plex connection'));
  function plexLookup(name,opts,done){
   if(name!==host){done(Error('Plex address rejected'));return;}
   lookup(name,{all:true,verbatim:true},(error,addresses)=>{
    if(error||!Array.isArray(addresses)){done(Error('Plex address unavailable'));return;}
    const allowed=addresses.filter(x=>[4,6].includes(x.family)&&net.isIP(x.address)===x.family);
    if(!allowed.length){done(Error('Plex address unavailable'));return;}
    if(opts&&opts.all)done(null,allowed);else done(null,allowed[0].address,allowed[0].family);
   });
  }
  if(stopped)return Promise.reject(Error('Plex stopped'));
  return new Promise((resolve,reject)=>{
   let req,res,done=false,length=0;const chunks=[],limit=image?8*1024*1024:2*1024*1024;
   const cancel=()=>finish(Error('Plex request cancelled'));
   const timer=setTimeout(()=>finish(Error('Plex request timed out')),options.timeoutMs||10000);
   function finish(error,bytes){
    if(done)return;done=true;clearTimeout(timer);requests.delete(cancel);
    if(signal)signal.removeEventListener('abort',cancel);
    if(error){if(res)res.destroy();if(req)req.destroy();reject(error);}else resolve(bytes);
   }
   requests.add(cancel);
   if(signal){signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();return;}}
   try{
    req=get(target+path,{lookup:plexLookup,rejectUnauthorized:true,headers:{
     Accept:image?'image/jpeg,image/png':'application/json','Accept-Encoding':'identity','X-Plex-Token':token,
     'User-Agent':'alvidaa-free-my-tv/native'
    }},response=>{
     res=response;if(done){res.destroy();return;}
     res.on('error',()=>finish(Error('Plex response failed')));
     res.on('aborted',()=>finish(Error('Plex response interrupted')));
     // No redirects, including same-origin redirects. Never forward the token.
     if(res.statusCode!==200){finish(Error('Plex HTTP request failed'));return;}
     if(Number(res.headers&&res.headers['content-length'])>limit){finish(Error('Plex response too large'));return;}
     res.on('data',chunk=>{length+=chunk.length;if(length>limit){finish(Error('Plex response too large'));return;}chunks.push(chunk);});
     res.on('end',()=>{const bytes=Buffer.concat(chunks);finish(bytes.includes(Buffer.from(token))?Error('Credential-bearing Plex response'):null,bytes);});
    });
    req.on('error',()=>finish(Error('Plex request failed')));
    if(done)req.destroy();
   }catch{finish(Error('Plex request failed'));}
  });
 }
 async function json(path,signal,target=origin){
  const raw=await request(path,false,signal,target);let body;
  try{body=JSON.parse(raw.toString('utf8')).MediaContainer;}catch{throw Error('Invalid Plex response');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid Plex response');
  return body;
 }
 function text(value,limit){return typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,limit):'';}
 async function load(signal){
  const turn=Math.trunc(now()/3600000);
  let serverId;
  for(const candidate of new Set([origin,...origins].filter(Boolean))){
   try{
    const id=(await json('/identity',signal,candidate)).machineIdentifier;
    if(typeof id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(id)||(config.serverId&&config.serverId!==id))throw Error('Plex server identity mismatch');
    origin=candidate;serverId=id;break;
   }catch{if(stopped||signal.aborted)throw Error('Plex connection cancelled');}
  }
  if(!serverId)throw Error('No authenticated Plex connection');
  const sections=(await json('/library/sections',signal)).Directory;
  if(!Array.isArray(sections)||sections.length>16)throw Error('Plex library limit exceeded');
  const lists={movie:[],tv:[]},nextRefs=new Map();
  function imageRef(path){
   if(typeof path!=='string'||!ART.test(path))return null;
   const ref='/plex-'+digest(serverId+'\n'+origin+'\n'+path)+'.jpg';nextRefs.set(ref,path);return ref;
  }
  for(const kind of ['movie','tv']){
   try{for(const section of sections){
   if(!section||section.type!==(kind==='movie'?'movie':'show')||(!options.allCandidates&&lists[kind].length>=8))continue;
   if(!/^[1-9][0-9]{0,9}$/.test(String(section.key)))throw Error('Invalid Plex section');
   const result=await json('/library/sections/'+section.key+'/all?sort=addedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=8',signal);
   const items=result.Metadata||[];
   if(!Array.isArray(items)||items.length>8)throw Error('Plex item limit exceeded');
   for(const item of items){
    if(!item||!/^[1-9][0-9]{0,9}$/.test(String(item.ratingKey))||Number(item.ratingKey)>2147483647)continue;
    const title=text(item.title,512),backdrop=imageRef(item.art);
    if(!title||!backdrop)continue;
    const genre=text(item.Genre&&item.Genre[0]&&item.Genre[0].tag,80),parts=[];
    if(kind==='tv')parts.push('Series');if(genre)parts.push(genre);parts.push('Plex');
    const minutes=Math.floor(Number(item.duration)/60000),seasons=Number(item.childCount);
    const pick={id:-Number(item.ratingKey),kind,title,backdrop,poster:imageRef(item.thumb),logo:null,
     ...(options.allCandidates?{addedAt:Number.isSafeInteger(item.addedAt)&&item.addedAt>=0?item.addedAt:0}:{}),
     genre,minutes:Number.isSafeInteger(minutes)&&minutes>0?minutes:0,
     seasons:Number.isSafeInteger(seasons)&&seasons>0?seasons:0,
     app:'plex',meta:parts.join(' · '),detailed:true,source:'plex',
     plexTitle:{providerId:serverId,ratingKey:String(item.ratingKey)}};
    if([token,origin].some(secret=>JSON.stringify(pick).includes(secret)))continue;
    lists[kind].push(pick);if(!options.allCandidates&&lists[kind].length===8)break;
   }
  }
   }catch(error){if(kind==='movie'||signal.aborted||stopped)throw error;lists.tv=[];}
  }
  const selected=[];
  for(const list of Object.values(lists))if(list.length){
   if(options.allCandidates)selected.push(...list);
   else selected.push(list[((turn%list.length)+list.length)%list.length]);
  }
  return {selected,nextRefs};
 }
 function refresh(){
  if(stopped)return Promise.resolve();
  if(inflight)return inflight;
  // The canonical recommendation-list refresh owns scheduling, not this client.
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),options.refreshTimeoutMs||30000);
  inflight=load(controller.signal).then(result=>{
   if(!stopped){picks=result.selected;refs=result.nextRefs;imageFailures.clear();state='ready';}
  }).catch(()=>{if(!stopped){picks=[];refs.clear();state='unavailable';}})
   .finally(()=>{clearTimeout(timer);inflight=null;});
  return inflight;
 }
 return {
  refresh,
  snapshot(){return {state,picks:picks.map(x=>({...x}))};},
  ownsImage(ref){return !stopped&&refs.has(ref);},
  image(ref,size){
   const widths={w300:1920,w500:1920,w780:1920,w1280:1920,original:1920,poster:500};
   const width=Object.hasOwn(widths,size)?widths[size]:0;
   if(!width||!refs.has(ref)||stopped)return Promise.reject(Error('Unknown Plex image'));
   if((imageFailures.get(ref)||0)>now())return Promise.reject(Error('Plex artwork unavailable'));
   return request('/photo/:/transcode?width='+width+'&height='+(size==='poster'?750:Math.round(width*9/16))+'&minSize=1&url='+encodeURIComponent(refs.get(ref)),true)
    .catch(()=>{if(!stopped)imageFailures.set(ref,now()+5*60000);throw Error('Plex artwork unavailable');});
  },
  stop(){stopped=true;for(const cancel of [...requests])cancel();picks=[];refs.clear();imageFailures.clear();}
 };
}
function createLibraries(servers,options){
 if(!Array.isArray(servers)||!servers.length||servers.length>64||new Set(servers.map(s=>s.serverId)).size!==servers.length||
    servers.some(s=>typeof s.serverId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(s.serverId)))throw Error('Invalid Plex servers');
 const factory=options.clientFactory||createPlex,now=options.now||Date.now;
 let stopped=false,inflight=null,state='pending',picks=[],owners=new Map(),current=[],loading=[];
 function refresh(){
  if(stopped)return Promise.resolve();if(inflight)return inflight;
  const next=[],active=new Set();let index=0,expired=false;
  const timer=setTimeout(()=>{expired=true;for(const client of active)client.stop();},options.refreshTimeoutMs||30000);
  async function run(){
   while(!stopped&&!expired&&index<servers.length){
    const config=servers[index++];let client;
    try{
     client=factory(config,{...options,allCandidates:true});loading.push(client);active.add(client);
     await client.refresh();
     if(!stopped&&client.snapshot().state==='ready')next.push({client,serverId:config.serverId,picks:client.snapshot().picks});
    }catch{/* Other servers can still contribute. */}
    finally{if(client)active.delete(client);}
   }
  }
  inflight=Promise.all(Array.from({length:Math.min(4,servers.length)},run)).then(()=>{
   if(stopped)return;
   const routes=new Map(),selected=[],turn=Math.trunc(now()/3600000);
   for(const kind of ['movie','tv']){
    const candidates=next.flatMap(entry=>entry.picks.filter(p=>p.kind===kind).map(p=>({pick:p,entry})));
    candidates.sort((a,b)=>(b.pick.addedAt||0)-(a.pick.addedAt||0)||a.entry.serverId.localeCompare(b.entry.serverId)||String(a.pick.plexTitle.ratingKey).localeCompare(String(b.pick.plexTitle.ratingKey)));
    const seen=new Set(),recent=candidates.filter(({pick,entry})=>{const key=entry.serverId+':'+pick.plexTitle.ratingKey;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,8);
    if(!recent.length)continue;
    const {pick,entry}=recent[((turn%recent.length)+recent.length)%recent.length];
    const {addedAt,...value}=pick;
    // Server-local rating keys can collide; keep browser IDs numeric and negative.
    value.id=-(parseInt(digest(entry.serverId+'\n'+kind+'\n'+pick.plexTitle.ratingKey).slice(0,12),16)+1);
    selected.push(value);
    for(const ref of [value.backdrop,value.poster])if(ref)routes.set(ref,entry.client);
   }
   for(const client of current)client.stop();
   const keep=new Set(routes.values());for(const client of loading)if(!keep.has(client))client.stop();
   current=[...keep];owners=routes;picks=selected;state=next.length?'ready':'unavailable';
  }).finally(()=>{clearTimeout(timer);loading=[];inflight=null;});
  return inflight;
 }
 return {refresh,snapshot:()=>({state,picks:picks.map(p=>({...p}))}),
  ownsImage:ref=>!stopped&&owners.has(ref)&&owners.get(ref).ownsImage(ref),
  image:(ref,size)=>!stopped&&owners.has(ref)?owners.get(ref).image(ref,size):Promise.reject(Error('Unknown Plex image')),
  stop(){stopped=true;for(const client of [...current,...loading])client.stop();current=[];owners.clear();picks=[];}
 };
}
function merge(cache,plexPicks,tmdbConfigured){
 let recs={};try{recs=JSON.parse(cache||'{}');}catch{/* No cached TMDB recommendations. */}
 if(!recs||typeof recs!=='object'||Array.isArray(recs))recs={};
 if(!tmdbConfigured)plexPicks=[];
 const base=tmdbConfigured&&Array.isArray(recs.picks)?recs.picks.filter(x=>x&&x.id>0&&x.source!=='plex'&&x.app!=='plex').slice(0,24):[];
 if(!plexPicks.length){
  // A serialized mixed pool has dropped public tail entries at the cap. Refill
  // on restart/account change rather than treating that shortened pool as fresh.
  if(Array.isArray(recs.picks)&&recs.picks.some(p=>p&&(p.source==='plex'||p.app==='plex'||p.id<0))){recs.listAt=0;recs.stamp='';}
  return JSON.stringify({...recs,picks:base});
 }
 // Canonical order: interleave Plex into each trending kind, alternate kinds,
 // then fill with new releases. Old unannotated caches are refreshed by dataSource.
 const hot=base.filter(p=>recs.plexPoolVersion!==1||p.nativeTrending),fresh=base.filter(p=>recs.plexPoolVersion===1&&!p.nativeTrending);
 const kinds=['movie','tv'].map(kind=>{
  const list=hot.filter(p=>p.kind===kind),personal=plexPicks.find(p=>p.kind===kind);
  if(personal)list.splice(Math.min(1,list.length),0,personal);return list;
 });
 const out=[],seen=new Set();function add(p){if(!p||out.length>=24)return;const key=p.kind+':'+p.id;if(!seen.has(key)){seen.add(key);out.push(p);}}
 for(let i=0;i<Math.max(kinds[0].length,kinds[1].length)&&out.length<24;i++){add(kinds[0][i]);add(kinds[1][i]);}
 fresh.forEach(add);
 return JSON.stringify({...recs,picks:out});
}
module.exports={serverOrigin,createPlex,merge,IMAGE,TOKEN};
