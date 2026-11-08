'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {readCredentials,renderableSnapshot}=require('./native-feed-worker.cjs');
const {createMedia}=require('./native-feed-images.cjs');
const ref='/plex-'+'a'.repeat(64)+'.jpg',base='file:///hisenseUI/var/local/free-my-tv/media/';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
test('Plex credentials share only the existing mode-private server/keys configuration',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fmtv-plex-keys-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const keys=path.join(dir,'server/keys');fs.mkdirSync(keys,{recursive:true});const file=path.join(keys,'feed.json');
 const config={tmdb_token:'',plex_url:'https://192-168-50-20.server.plex.direct:32400',plex_token:'fake-plex-token'};
 fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});const value=readCredentials(file);
 assert.equal(value.token,'');assert.equal(value.plex.token,config.plex_token);
 fs.chmodSync(file,0o644);assert.throws(()=>readCredentials(file),/permissions/);fs.chmodSync(file,0o600);
 fs.writeFileSync(file,JSON.stringify({...config,plex_token:''}));assert.throws(()=>readCredentials(file));
 fs.writeFileSync(file,JSON.stringify({tmdb_token:'eyJ.existing-token'}));assert.equal(readCredentials(file).plex,null);
 const other=path.join(dir,'public.json');fs.copyFileSync(file,other);assert.throws(()=>readCredentials(other),/server\/keys/);
});
test('personal picks wait for local artwork; disabling removes them without modifying the raw engine snapshot',()=>{
 const pick={id:-1,source:'plex',backdrop:ref},publicPick={id:1,app:'netflix'};
 const snapshot={version:1,cache:{'fmtv.recs':JSON.stringify({picks:[publicPick,pick]})}};
 const render={images:{},media:{},imageFailures:0};
 assert.deepEqual(JSON.parse(renderableSnapshot(snapshot,render).cache['fmtv.recs']).picks,[publicPick]);
 render.images['w1280:'+ref]='https://untrusted.invalid/art.jpg';
 assert.deepEqual(JSON.parse(renderableSnapshot(snapshot,render).cache['fmtv.recs']).picks,[publicPick]);
 render.images['w1280:'+ref]=base+'b'.repeat(64)+'-raw.png';
 assert.equal(JSON.parse(renderableSnapshot(snapshot,render).cache['fmtv.recs']).picks.length,2);
 assert.equal(JSON.parse(snapshot.cache['fmtv.recs']).picks.length,2);
 for(const bad of ['broken','null','[]'])assert.deepEqual(JSON.parse(renderableSnapshot({cache:{'fmtv.recs':bad}},render).cache['fmtv.recs']).picks,[]);
});
test('Plex artwork uses only the authenticated private client and remains usable from verified local cache',{skip:!process.env.NATIVE_IMAGE_HELPER},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fmtv-plex-art-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const icons=path.join(dir,'icons');fs.mkdirSync(icons);let downloads=0,authorized=true;
 const cache=createMedia({directory:path.join(dir,'media'),iconRoot:icons,processor:process.env.NATIVE_IMAGE_HELPER,uriBase:base,
  plex:{ownsImage:value=>authorized&&value===ref,image:async(value,size)=>{assert.equal(value,ref);assert.ok(['w1280','w780','w300','original'].includes(size));downloads++;return png;}},
  download:async()=>{throw Error('Personal images must not reach TMDB');}});
 t.after(()=>cache.stop());const data={'fmtv.recs':JSON.stringify({picks:[{source:'plex',backdrop:ref}]})};
 const first=await cache.update({apps:[]},data);assert.equal(first.imageFailures,0);assert.equal(downloads,4);
 assert.ok(first.images['original:'+ref].startsWith(base));
 const again=await cache.update({apps:[]},data);assert.equal(again.imageFailures,0);assert.equal(downloads,4);
 authorized=false;const denied=await cache.update({apps:[]},data);assert.equal(denied.imageFailures,4);assert.equal(downloads,4,'even cached art requires fresh metadata authorization');
});
