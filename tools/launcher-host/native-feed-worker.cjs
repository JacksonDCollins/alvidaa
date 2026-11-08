#!/usr/bin/env node
'use strict';
// On-TV polling worker: no listener, browser token, PC service or MQTT session.
const fs=require('node:fs');
const path=require('node:path');
const {createEngine}=require('./native-feed-engine.cjs');
const {createMedia,atomic}=require('./native-feed-images.cjs');
const {configuration:plexConfiguration,createPlex,merge:mergePlex}=require('./native-feed-plex.cjs');
const {configuration:autoConfiguration,createSession}=require('./native-plex-session.cjs');
function readJSON(file,limit){
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>limit)throw Error('Invalid worker input file');
 try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('Invalid worker JSON');}
}
function readCredentials(file){
 const resolved=fs.realpathSync(file);
 if(!resolved.includes(path.sep+'server'+path.sep+'keys'+path.sep))throw Error('Credentials must remain in server/keys');
 const stat=fs.lstatSync(file);if(!stat.isFile()||(stat.mode&0o077)!==0)throw Error('Private credential permissions required');
 const data=readJSON(file,16384),value=data.tmdb_token;
 if(typeof value!=='string'||value.length>4096||/[\r\n]/.test(value)||
    (value.trim()&&!value.trim().startsWith('eyJ')))throw Error('A private TMDB read token or explicit empty string is required');
 const automatic=autoConfiguration(data),mode=Object.hasOwn(data,'plex_auto')?(automatic?'automatic':'disabled'):'manual';
 return {token:value.trim(),plex:mode==='manual'?plexConfiguration(data):null,automatic,mode};
}
function readToken(file){return readCredentials(file).token;}
function renderableSnapshot(snapshot,render){
 const cache={...snapshot.cache};let recs={};
 try{const value=JSON.parse(cache['fmtv.recs']||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))recs=value;}catch{/* Discard damaged recommendation data. */}
 // Like upstream withImages(), do not advertise a personal title without local artwork.
 recs.picks=Array.isArray(recs.picks)?recs.picks.filter(p=>p&&(p.source!=='plex'||
  ['w1280','w780','w300','original'].some(size=>/^file:\/\/\/hisenseUI\/var\/local\/free-my-tv\/media\/[a-f0-9]{64}-raw\.(png|jpg)$/.test(render.images[size+':'+p.backdrop]||'')))):[];
 cache['fmtv.recs']=JSON.stringify(recs);
 return {...snapshot,cache,...render};
}
function start(options){
 const directory=path.resolve(options.directory),credentials=readCredentials(options.credentials),token=credentials.token;
 fs.mkdirSync(directory,{recursive:true,mode:0o755});
 const lockPath=process.env.ALVIDAA_NATIVE_FEED_LOCK_PATH;
 const descriptor=Number(process.env.ALVIDAA_NATIVE_FEED_LOCK_FD);
 if(!lockPath||!Number.isInteger(descriptor)||descriptor<3)throw Error('Start worker through native-image lock-run');
 const held=fs.fstatSync(descriptor),expected=fs.statSync(lockPath);
 if(!held.isFile()||held.dev!==expected.dev||held.ino!==expected.ino)throw Error('Worker lock descriptor was not inherited');
 const lock=lockPath+'.pid';
 atomic(lock,String(process.pid),0o600);
 const sessionSource=credentials.automatic?(options.sessionSource||createSession(credentials.automatic)):null;
 const engineFactory=options.engineFactory||createEngine,mediaFactory=options.mediaFactory||createMedia,plexFactory=options.plexFactory||createPlex;
 let account={state:sessionSource?'pending':'disabled'},accountSignature='',personal=null;
 let stopped=false,engine=null,media=null,context=null,signature='',lastRefresh=0,writing=null,polling=null;
 let imageBusy=false,imageAgain=false,lastPublished='',homeStamp='',render={images:{},media:{},imageFailures:0};
 let old={};try{old=readJSON(path.join(directory,'snapshot.json'),8*1024*1024);}catch{/* First start or damaged cache. */}
 if(old.version===1){
  render={images:old.images||{},media:old.media||{},imageFailures:old.imageFailures||0};
  if(credentials.mode!=='manual'){
   // Never hydrate a previous account from disk while automatic discovery is pending.
   old={...old,keyConfigured:!!token,plexConfigured:false,plexState:account.state,
    cache:{...old.cache,'fmtv.recs':mergePlex(old.cache&&old.cache['fmtv.recs'],[],!!token)}};
   atomic(path.join(directory,'snapshot.json'),JSON.stringify({...old,workerPid:process.pid}));
  }
 }
 function publish(){
  writing=null;if(stopped||!engine)return;
  try{
   const snapshot=renderableSnapshot(engine.snapshot(),render);
   if(sessionSource){snapshot.plexAutomatic=true;if(account.state!=='ready')snapshot.plexState=account.state;}
   const encoded=JSON.stringify({...snapshot,workerPid:process.pid});
   if(encoded!==lastPublished){atomic(path.join(directory,'snapshot.json'),encoded);lastPublished=encoded;}
  }
  catch{/* Preserve the last good snapshot on disk failures; keep local Home alive. */}
 }
 function schedule(){if(!stopped&&writing===null)writing=setTimeout(publish,200);}
 async function images(){
  if(stopped||!media||!engine)return;
  if(imageBusy){imageAgain=true;return;}
  imageBusy=true;imageAgain=false;
  const owner=media,current=engine,currentContext=context;
  try{
   const state=current.snapshot();
   const cache=state.keyConfigured||state.plexConfigured?state.cache:{...state.cache,'fmtv.recs':null};
   const value=await owner.update(currentContext,cache);
   if(!stopped&&media===owner&&value){render=value;owner.collect();schedule();}
  }catch{/* Retain previous usable image mappings on processing failures. */}
  finally{imageBusy=false;if(imageAgain&&!stopped)void images();}
 }
 function changed(){schedule();if(engine&&engine.snapshot().pending===0)void images();}
 function poll(){
  if(stopped)return;
  if(options.homePath){
   try{
    const st=fs.statSync(options.homePath),stamp=[st.ino,st.size,st.mtimeMs,st.ctimeMs].join(':');
    if(stamp!==homeStamp){
     if(!fs.readFileSync(options.homePath,'utf8').includes('ALVIDAA_FREE_MY_TV_WEB_PARITY_V2')){stop();return;}
     homeStamp=stamp;
    }
   }catch{stop();return;}
  }
  if(sessionSource){
   try{account=sessionSource.read();}catch{account={state:'unavailable'};}
   const nextAccount=account.state+':'+(account.signature||'');
   if(nextAccount!==accountSignature){
    // Revoke first, even if context parsing or replacement construction fails.
    if(personal)personal.stop();personal=null;
    if(engine)engine.stop();if(media)media.stop();media=null;
    accountSignature=nextAccount;signature='';imageAgain=false;schedule();
   }
  }
  try{
   const next=readJSON(path.join(directory,'context.json'),1024*1024);
   if(next.version!==1||!Array.isArray(next.apps)||next.apps.length>512||typeof next.zone!=='string'||next.zone.length>100||
      typeof next.prefs!=='string'||next.prefs.length>65536)throw Error('Invalid native context');
   const nextSignature=JSON.stringify(next);
   if(nextSignature!==signature){
    const cache=engine?engine.snapshot().cache:old.cache;
    // Context-only changes retain the old engine until construction succeeds.
    // Account changes above deliberately do not retain private recommendations.
    const privateConfig=sessionSource?(account.state==='ready'?account.credentials:null):credentials.plex;
    const plex=privateConfig?plexFactory(privateConfig):null;
    let replacement;
    try{replacement=engineFactory({token,plex,context:next,cache,onChange:changed});}
    catch(error){if(plex)plex.stop();throw error;}
    let owner;
    try{
     owner=mediaFactory({directory:options.mediaDirectory||path.join(directory,'media'),iconRoot:options.iconRoot,processor:options.processor,plex,
      previousImages:render.images,uriBase:'file:///hisenseUI/var/local/free-my-tv/media/',onChange:value=>{if(!stopped&&media===owner){render=value;schedule();}}});
    }catch(error){replacement.stop();throw error;}
    if(engine)engine.stop();if(media)media.stop();
    // Only a zone from the pinned public timezone catalogue reaches TZ. This
    // changes this worker's date calculations, never the TV's preferences.
    if(replacement.snapshot().locationKnown)process.env.TZ=next.zone;
    engine=replacement;personal=plex;context=next;signature=nextSignature;
    media=owner;lastRefresh=0;old={};imageAgain=true;
   }
   if(engine&&Date.now()-lastRefresh>=30000){
    lastRefresh=Date.now();engine.refresh();schedule();
    if(engine.snapshot().pending===0)void images();
   }
  }catch{/* A partially written context never replaces the last good one. */}
  polling=setTimeout(poll,1000);
 }
 function stop(){
  if(stopped)return;stopped=true;
  if(polling!==null)clearTimeout(polling);if(writing!==null)clearTimeout(writing);
  if(engine)engine.stop();if(media)media.stop();if(sessionSource)sessionSource.stop();
  try{if(fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);}catch{/* No longer our lock. */}
  if(options.onStop)options.onStop();
 }
 try{poll();}catch(error){stop();throw error;}
 return {stop};
}
if(require.main===module){
 const [directory,credentials,processor,iconRoot,mediaDirectory,homePath]=process.argv.slice(2);
 if(!directory||!credentials||!processor||!iconRoot){console.error('Usage: native-feed-worker.cjs state-dir private-key-file image-helper icon-root [media-dir] [home-file]');process.exit(2);}
 else try{
  const worker=start({directory,credentials,processor,iconRoot,mediaDirectory,homePath,onStop:()=>process.exit(0)});
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{worker.stop();process.exit(0);});
 }catch{console.error('Native feed worker could not start; check private configuration and worker ownership');process.exit(1);}
}
module.exports={start,readToken,readCredentials,readJSON,renderableSnapshot};
