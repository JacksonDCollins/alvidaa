'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {readCredentials,renderableSnapshot}=require('./native-feed-worker.cjs');
const {createMedia}=require('./native-feed-images.cjs');
const ref='/plex-'+'a'.repeat(64)+'.jpg',base='file:///hisenseUI/var/local/free-my-tv/media/';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
test('automatic Plex ignores legacy server, URL and token overrides',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fmtv-plex-keys-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const keys=path.join(dir,'server/keys');fs.mkdirSync(keys,{recursive:true});const file=path.join(keys,'feed.json');
 const config={tmdb_token:'',plex_auto:true,plex_server_id:'fixture-server',plex_url:'ignored-url',plex_token:'ignored-token'};
 fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});const value=readCredentials(file);
 assert.equal(value.token,'');assert.deepEqual(value.automatic,{});assert.equal(Object.hasOwn(value,'plex'),false);
 fs.chmodSync(file,0o644);assert.throws(()=>readCredentials(file),/permissions/);fs.chmodSync(file,0o600);
 fs.writeFileSync(file,JSON.stringify({tmdb_token:'',plex_auto:true}));assert.deepEqual(readCredentials(file).automatic,{});
 fs.writeFileSync(file,JSON.stringify({tmdb_token:'eyJ.existing-token'}));assert.equal(readCredentials(file).automatic,null);
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
test('publication removes stale image mappings and orphan media while preserving current art and native icons',()=>{
 const current='/plex-'+'c'.repeat(64)+'.jpg',oldRaw=base+'b'.repeat(64)+'-raw.png',currentRaw=base+'d'.repeat(64)+'-raw.jpg';
 const publicRaw=base+'e'.repeat(64)+'-raw.jpg',iconRaw=base+'f'.repeat(64)+'-raw.png',lift=base+'f'.repeat(64)+'-logo.png';
 const icon='file:///hisenseUI/var/local/storeAppIcon/app.png',thumb=base+'d'.repeat(64)+'-thumb.png',orphan=base+'0'.repeat(64)+'-raw.jpg';
 const render={images:{['w1280:'+ref]:oldRaw,['original:'+ref]:oldRaw,['poster:'+ref]:oldRaw,['w1280:'+current]:currentRaw,'w780:/public.jpg':publicRaw},media:{
  [oldRaw]:{src:oldRaw},[orphan]:{src:orphan},[currentRaw]:{src:currentRaw,thumb},[thumb]:{src:thumb},[publicRaw]:{src:publicRaw},
  [icon]:{src:iconRaw,lift:{src:lift}},[iconRaw]:{src:iconRaw},[lift]:{src:lift}},imageFailures:1};
 const publicPick={id:1,backdrop:'/public.jpg'},snapshot={cache:{'fmtv.recs':JSON.stringify({picks:[publicPick,{id:-2,source:'plex',backdrop:current}]})}};
 const before=JSON.stringify({snapshot,render}),out=renderableSnapshot(snapshot,render);
 assert.deepEqual(Object.keys(out.images).sort(),['w1280:'+current,'w780:/public.jpg'].sort());
 for(const key of [currentRaw,thumb,publicRaw,icon,iconRaw,lift])assert.ok(out.media[key]);
 for(const key of [oldRaw,orphan])assert.ok(!out.media[key]);
 assert.equal(out.imageFailures,1);assert.equal(JSON.stringify({snapshot,render}),before);
 const disabled=renderableSnapshot({cache:{'fmtv.recs':JSON.stringify({picks:[publicPick]})}},render);
 assert.deepEqual(disabled.images,{'w780:/public.jpg':publicRaw});assert.ok(!disabled.media[currentRaw]);assert.ok(!disabled.media[thumb]);
 const damaged=renderableSnapshot({cache:{'fmtv.recs':'broken'}},render);
 assert.deepEqual(damaged.images,{});assert.deepEqual(Object.keys(damaged.media).sort(),[icon,iconRaw,lift].sort());
});
test('Plex artwork uses only the authenticated private client and remains usable from verified local cache',{skip:!process.env.NATIVE_IMAGE_HELPER},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fmtv-plex-art-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const icons=path.join(dir,'icons');fs.mkdirSync(icons);let downloads=0,authorized=true;
 const cache=createMedia({directory:path.join(dir,'media'),iconRoot:icons,processor:process.env.NATIVE_IMAGE_HELPER,uriBase:base,
  plex:{ownsImage:value=>authorized&&value===ref,image:async(value,size)=>{assert.equal(value,ref);assert.ok(['w1280','w780','w300','original','poster'].includes(size));downloads++;return png;}},
  download:async()=>{throw Error('Personal images must not reach TMDB');}});
 t.after(()=>cache.stop());const picks=[{source:'plex',backdrop:ref,poster:ref}],data={'fmtv.recs':JSON.stringify({picks})};
 const prepared=await cache.preparePlex(picks);assert.deepEqual(prepared.picks,picks);assert.equal(downloads,2);
 assert.equal(new Set(['w1280','w780','w300','original'].map(size=>prepared.render.images[size+':'+ref])).size,1,'one canonical original serves all backdrop sizes');
 const first=await cache.update({apps:[]},data);assert.equal(first.imageFailures,0);assert.equal(downloads,2);
 assert.ok(first.images['original:'+ref].startsWith(base));assert.ok(first.images['poster:'+ref].startsWith(base));
 const again=await cache.update({apps:[]},data);assert.equal(again.imageFailures,0);assert.equal(downloads,2);
 authorized=false;assert.deepEqual((await cache.preparePlex(picks)).picks,[]);
 const denied=await cache.update({apps:[]},data);assert.equal(denied.imageFailures,5);assert.equal(downloads,2,'even cached art requires fresh metadata authorization');
});
