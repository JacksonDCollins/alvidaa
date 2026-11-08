'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {start,readCredentials}=require('./native-feed-worker.cjs');
const ref='/plex-'+'a'.repeat(64)+'.jpg';
const raw='file:///hisenseUI/var/local/free-my-tv/media/'+'b'.repeat(64)+'-raw.png';
const render={images:{['w1280:'+ref]:raw,['poster:'+ref]:raw,['original:'+ref]:raw},media:{[raw]:{src:raw,width:1,height:1}},imageFailures:0};
const immediate=()=>new Promise(resolve=>setImmediate(resolve));
test('worker revokes old-account cards before parsing context and never falls back to configured credentials',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fmtv-auto-worker-')),keys=path.join(dir,'server/keys');fs.mkdirSync(keys,{recursive:true});
 const credentials=path.join(keys,'feed.json'),lock=path.join(dir,'worker.lock');
 fs.writeFileSync(credentials,JSON.stringify({tmdb_token:'eyJ.fixture',plex_auto:true,plex_server_id:'fixture-server',plex_url:'https://server.plex.direct:32400',plex_token:'do-not-use-manual-token'}),{mode:0o600});
 const descriptor=fs.openSync(lock,'w'),oldPath=process.env.ALVIDAA_NATIVE_FEED_LOCK_PATH,oldFD=process.env.ALVIDAA_NATIVE_FEED_LOCK_FD;
 process.env.ALVIDAA_NATIVE_FEED_LOCK_PATH=lock;process.env.ALVIDAA_NATIVE_FEED_LOCK_FD=String(descriptor);
 let worker,sourceStopped=false;const clients=[],owners=[];
 t.after(()=>{if(worker)worker.stop();fs.closeSync(descriptor);if(oldPath===undefined)delete process.env.ALVIDAA_NATIVE_FEED_LOCK_PATH;else process.env.ALVIDAA_NATIVE_FEED_LOCK_PATH=oldPath;if(oldFD===undefined)delete process.env.ALVIDAA_NATIVE_FEED_LOCK_FD;else process.env.ALVIDAA_NATIVE_FEED_LOCK_FD=oldFD;fs.rmSync(dir,{recursive:true,force:true});});
 const context={version:1,zone:'',prefs:'{}',apps:[{id:'app:42',title:'Plex'}]},contextFile=path.join(dir,'context.json'),snapshotFile=path.join(dir,'snapshot.json');
 fs.writeFileSync(contextFile,JSON.stringify(context));
 fs.writeFileSync(snapshotFile,JSON.stringify({version:1,keyConfigured:true,cache:{'fmtv.recs':JSON.stringify({picks:[{id:-99,source:'plex',title:'Prior user',backdrop:ref}]})},...render}));
 const account=user=>({state:'ready',signature:user,credentials:{token:'fake-server-'+user}});let current=account('A');
 worker=start({directory:dir,credentials,processor:'unused',iconRoot:dir,
  sessionSource:{read:()=>current,stop:()=>{sourceStopped=true;}},
  plexFactory:config=>{assert.notEqual(config.token,'do-not-use-manual-token');const client={stopped:false,title:config.token.endsWith('A')?'A':'B',stop(){this.stopped=true;}};clients.push(client);return client;},
  engineFactory:({plex})=>({refresh(){},stop(){if(plex)plex.stop();},snapshot(){return {version:1,keyConfigured:true,plexConfigured:!!plex,pending:0,cache:{'fmtv.recs':JSON.stringify({picks:[{id:1,title:'Public',app:'netflix'},...(plex&&!plex.stopped?[{id:-1,source:'plex',title:plex.title,backdrop:ref}]:[])]})}};}}),
  mediaFactory:options=>{const owner={update:async()=>render,collect(){},stop(){},late:()=>options.onChange(render)};owners.push(owner);return owner;}
 });
 const snapshot=()=>JSON.parse(fs.readFileSync(snapshotFile,'utf8'));
 const titles=()=>JSON.parse(snapshot().cache['fmtv.recs']).picks.map(p=>p.title);
 const revoked=()=>{assert.deepEqual(snapshot().images,{});assert.deepEqual(snapshot().media,{});assert.ok(!JSON.stringify(snapshot()).includes(raw));};
 assert.deepEqual(titles(),[],'startup must clear persisted private picks before discovery publishes');revoked();
 await immediate();t.mock.timers.tick(200);assert.deepEqual(titles(),['Public','A']);
 current=account('B');fs.writeFileSync(contextFile,'broken');t.mock.timers.tick(800);await immediate();t.mock.timers.tick(200);
 assert.equal(clients[0].stopped,true);assert.deepEqual(titles(),['Public'],'context errors cannot retain old account data');revoked();
 owners[0].late();t.mock.timers.tick(200);assert.deepEqual(titles(),['Public'],'late cancelled image callbacks cannot revive private cards');revoked();
 fs.writeFileSync(contextFile,JSON.stringify(context));t.mock.timers.tick(600);await immediate();t.mock.timers.tick(200);assert.deepEqual(titles(),['Public','B']);
 current={state:'signed-out'};t.mock.timers.tick(800);await immediate();t.mock.timers.tick(200);assert.deepEqual(titles(),['Public']);assert.equal(snapshot().plexState,'signed-out');
 revoked();assert.equal(clients.length,2,'no manual or other cached account fallback on sign-out');assert.ok(!JSON.stringify(snapshot()).includes('fake-server'));
 worker.stop();assert.equal(sourceStopped,true);
 const config=JSON.parse(fs.readFileSync(credentials,'utf8'));config.plex_auto=false;fs.writeFileSync(credentials,JSON.stringify(config));
 assert.equal(readCredentials(credentials).plex,null,'explicitly disabled automatic mode must not reactivate an old manual token');
 for(const mode of ['disabled','manual']){
  if(mode==='manual')delete config.plex_auto;
  fs.writeFileSync(credentials,JSON.stringify(config));fs.writeFileSync(contextFile,'broken');
  fs.writeFileSync(snapshotFile,JSON.stringify({version:1,cache:{'fmtv.recs':JSON.stringify({picks:[{id:-1,source:'plex',backdrop:ref}]})},...render}));
  worker=start({directory:dir,credentials,processor:'unused',iconRoot:dir});
  assert.deepEqual(titles(),[],mode+' startup must not reuse persisted authorization');revoked();worker.stop();
 }
});
