'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {start}=require('./native-feed-worker.cjs');
const {createEngine}=require('./native-feed-engine.cjs');
const {createPlex}=require('./native-feed-plex.cjs');
const helper=process.env.NATIVE_IMAGE_HELPER;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
test('real worker, canonical engine and image processor prepare personal cards and revoke them on logout',
 {skip:!helper,timeout:10000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fmtv-plex-pipeline-')),keys=path.join(dir,'server/keys');fs.mkdirSync(keys,{recursive:true});
 const credentials=path.join(keys,'feed.json'),lock=path.join(dir,'worker.lock'),snapshotFile=path.join(dir,'snapshot.json');
 fs.writeFileSync(credentials,JSON.stringify({tmdb_token:'eyJ.fixture',plex_auto:true,plex_server_id:'fixture-server'}),{mode:0o600});
 fs.writeFileSync(path.join(dir,'context.json'),JSON.stringify({version:1,zone:'Australia/Brisbane',language:'en-AU',prefs:'{"quotes":false}',apps:[{id:'app:1',title:'Netflix'},{id:'app:42',title:'Plex'}]}));
 const fd=fs.openSync(lock,'w'),oldPath=process.env.ALVIDAA_NATIVE_FEED_LOCK_PATH,oldFD=process.env.ALVIDAA_NATIVE_FEED_LOCK_FD;
 process.env.ALVIDAA_NATIVE_FEED_LOCK_PATH=lock;process.env.ALVIDAA_NATIVE_FEED_LOCK_FD=String(fd);
 let worker,downloads=0,clientStopped=false;
 t.after(()=>{if(worker)worker.stop();fs.closeSync(fd);if(oldPath===undefined)delete process.env.ALVIDAA_NATIVE_FEED_LOCK_PATH;else process.env.ALVIDAA_NATIVE_FEED_LOCK_PATH=oldPath;if(oldFD===undefined)delete process.env.ALVIDAA_NATIVE_FEED_LOCK_FD;else process.env.ALVIDAA_NATIVE_FEED_LOCK_FD=oldFD;fs.rmSync(dir,{recursive:true,force:true});});
 const ref='/plex-'+'a'.repeat(64)+'.jpg',pick={id:-1,kind:'movie',source:'plex',app:'plex',title:'Private movie',detailed:true,backdrop:ref,poster:ref,addedAt:100,plexTitle:{providerId:'fixture-server',ratingKey:'1'}};
 let account={state:'ready',signature:'active',credentials:{servers:[{origins:['https://app.fixture.plex.direct:32400'],token:'fake-server-token',serverId:'fixture-server'}]}};
 worker=start({directory:dir,credentials,processor:helper,iconRoot:dir,
  sessionSource:{read:()=>account,stop(){}},
  plexFactory:config=>createPlex(config,{clientFactory:server=>{
   assert.deepEqual(server.origins,account.credentials.servers[0].origins);assert.equal(server.token,'fake-server-token');let ready=false;
   return {refresh:async()=>{ready=true;},snapshot:()=>({state:clientStopped?'disabled':ready?'ready':'pending',picks:ready&&!clientStopped?[pick]:[]}),
    ownsImage:value=>ready&&!clientStopped&&value===ref,image:async()=>{assert.equal(clientStopped,false);downloads++;return png;},stop(){clientStopped=true;}};
  }}),
  engineFactory:options=>createEngine({...options,request:async url=>({status:200,body:{results:url.includes('/watch/providers/')?[{provider_id:8,provider_name:'Netflix'}]:[]}})})
 });
 const snapshot=()=>JSON.parse(fs.readFileSync(snapshotFile,'utf8'));
 const personal=value=>JSON.parse(value.cache['fmtv.recs']||'{"picks":[]}').picks.filter(p=>p.source==='plex');
 async function until(predicate){const deadline=Date.now()+5000;while(Date.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('Pipeline did not reach the expected state');}
 await until(()=>fs.existsSync(snapshotFile)&&personal(snapshot()).length===1);
 const ready=snapshot();assert.equal(downloads,2);assert.equal(ready.imageFailures,0);
 assert.match(ready.images['original:'+ref],/^file:/);
 assert.equal(new Set(['original','w1280','w780','w300'].map(size=>ready.images[size+':'+ref])).size,1);
 assert.equal(Object.keys(ready.images).filter(key=>key.includes('/plex-')).length,5);
 assert.ok(!JSON.stringify(ready).includes('fake-server-token'));assert.ok(!JSON.stringify(ready).includes('plex.direct'));
 account={state:'signed-out'};
 await until(()=>snapshot().plexState==='signed-out');
 const revoked=snapshot();assert.equal(personal(revoked).length,0);assert.deepEqual(revoked.images,{});assert.deepEqual(revoked.media,{});assert.equal(clientStopped,true);assert.equal(downloads,2);
});
