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
const ART=/^\/library\/metadata\/[1-9][0-9]{0,9}\/(art|thumb)(\/[0-9]{1,16})?$/;
function serverOrigin(url){
 if(typeof url!=='string'||url.length>512)throw new Error('Invalid private Plex origin');
 let parsed;try{parsed=new URL(url);}catch{throw new Error('Invalid private Plex origin');}
 if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.plex.direct')||parsed.hostname.length>253||
    parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash||parsed.port==='0')throw Error('Plex requires its HTTPS plex.direct origin');
 return {origin:parsed.origin,hostname:parsed.hostname};
}
function configuration(value){
 const url=value.plex_url,token=value.plex_token;
 if((url===undefined||url==='')&&(token===undefined||token===''))return null;
 if(typeof token!=='string'||! /^[A-Za-z0-9._~-]{8,4096}$/.test(token))throw new Error('Invalid private Plex configuration');
 return {...serverOrigin(url),token};
}
function privateAddress(address){
 if(typeof address!=='string')return false;
 if(address.startsWith('::ffff:'))return privateAddress(address.slice(7));
 if(net.isIP(address)===6)return /^(fc|fd)/i.test(address);
 if(net.isIP(address)!==4)return false;
 const parts=address.split('.').map(Number);
 return parts[0]===10||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)||(parts[0]===192&&parts[1]===168);
}
function period(time){const hour=new Date(time).getHours();return hour>=5&&hour<12?0:hour>=12&&hour<18?1:2;}
function createPlex(config,options={}){
 // Revalidate even callers that did not come through the worker's credential reader.
 const checked=configuration({plex_url:config.origin,plex_token:config.token});
 const {origin,token,hostname:host}=checked;
 const get=options.get||https.get,lookup=options.lookup||dns.lookup,now=options.now||Date.now;
 const requests=new Set(),imageFailures=new Map();let stopped=false,inflight=null,attempt=null,state='pending',picks=[],refs=new Map();
 function localLookup(name,opts,done){
  if(name!==host){done(Error('Plex address rejected'));return;}
  lookup(name,{all:true,verbatim:true},(error,addresses)=>{
   if(error||!Array.isArray(addresses)){done(Error('Plex address unavailable'));return;}
   const allowed=addresses.filter(x=>privateAddress(x.address)&&[4,6].includes(x.family));
   if(!allowed.length){done(Error('Plex requires a LAN address'));return;}
   if(opts&&opts.all)done(null,allowed);else done(null,allowed[0].address,allowed[0].family);
  });
 }
 function request(path,image=false,signal){
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
    req=get(origin+path,{lookup:localLookup,rejectUnauthorized:true,headers:{
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
 async function json(path,signal){
  const raw=await request(path,false,signal);let body;
  try{body=JSON.parse(raw.toString('utf8')).MediaContainer;}catch{throw Error('Invalid Plex response');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Invalid Plex response');
  return body;
 }
 function text(value,limit){return typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,limit):'';}
 async function load(signal){
  const serverId=(await json('/identity',signal)).machineIdentifier;
  if(typeof serverId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(serverId)||(config.serverId&&config.serverId!==serverId))throw Error('Plex server identity mismatch');
  const sections=(await json('/library/sections',signal)).Directory;
  if(!Array.isArray(sections)||sections.length>16)throw Error('Plex library limit exceeded');
  const lists={movie:[],tv:[]},nextRefs=new Map();
  function imageRef(path){
   if(typeof path!=='string'||!ART.test(path))return null;
   const ref='/plex-'+digest(origin+'\n'+path)+'.jpg';nextRefs.set(ref,path);return ref;
  }
  for(const section of sections){
   const kind=section&&section.type==='movie'?'movie':section&&section.type==='show'?'tv':null;
   if(!kind||lists[kind].length>=8)continue;
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
     genre,minutes:Number.isSafeInteger(minutes)&&minutes>0&&minutes<=1440?minutes:0,
     seasons:Number.isSafeInteger(seasons)&&seasons>0&&seasons<=1000?seasons:0,
     app:'plex',meta:parts.join(' · '),detailed:true,source:'plex',
     plexTitle:{providerId:serverId,ratingKey:String(item.ratingKey)}};
    if([token,origin].some(secret=>JSON.stringify(pick).includes(secret)))continue;
    lists[kind].push(pick);if(lists[kind].length===8)break;
   }
  }
  const turn=Math.floor(now()/3600000),selected=[];
  for(const list of Object.values(lists))if(list.length)selected.push(list[turn%list.length]);
  return {selected,nextRefs};
 }
 function refresh(){
  if(stopped)return Promise.resolve();
  if(inflight)return inflight;
  const ttl=state==='ready'?6*3600000:5*60000,elapsed=attempt===null?Infinity:now()-attempt;
  if(attempt!==null&&elapsed>=0&&elapsed<ttl&&(state!=='ready'||period(now())===period(attempt)))return Promise.resolve();
  attempt=now();const controller=new AbortController();
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
   const widths={w300:300,w500:500,w780:780,w1280:1280,original:1920,poster:500};
   const width=Object.hasOwn(widths,size)?widths[size]:0;
   if(!width||!refs.has(ref)||stopped)return Promise.reject(Error('Unknown Plex image'));
   if((imageFailures.get(ref)||0)>now())return Promise.reject(Error('Plex artwork unavailable'));
   return request('/photo/:/transcode?width='+width+'&height='+(size==='poster'?750:Math.round(width*9/16))+'&minSize=1&url='+encodeURIComponent(refs.get(ref)),true)
    .catch(()=>{if(!stopped)imageFailures.set(ref,now()+5*60000);throw Error('Plex artwork unavailable');});
  },
  stop(){stopped=true;for(const cancel of [...requests])cancel();picks=[];refs.clear();imageFailures.clear();}
 };
}
function merge(cache,plexPicks,tmdbConfigured){
 let recs={};try{recs=JSON.parse(cache||'{}');}catch{/* No cached TMDB recommendations. */}
 if(!recs||typeof recs!=='object'||Array.isArray(recs))recs={};
 const base=tmdbConfigured&&Array.isArray(recs.picks)?recs.picks.filter(x=>x&&x.id>0&&x.source!=='plex'&&x.app!=='plex').slice(0,62):[];
 // Interleave personal library picks instead of replacing the public recommendations.
 for(let i=0;i<plexPicks.length;i++)base.splice(Math.min(1+i*2,base.length),0,plexPicks[i]);
 return JSON.stringify({...recs,picks:base});
}
module.exports={configuration,serverOrigin,privateAddress,createPlex,merge,IMAGE};
