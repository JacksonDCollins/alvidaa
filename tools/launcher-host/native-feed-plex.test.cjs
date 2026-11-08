'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {configuration,privateAddress,createPlex,merge}=require('./native-feed-plex.cjs');
const ORIGIN='https://192-168-50-20.0123456789abcdef.plex.direct:32400',TOKEN='fake-plex-test-token';
const config=()=>configuration({plex_url:ORIGIN,plex_token:TOKEN});
function fixture(options={}){
 const calls=[];let destroyed=0;
 const lookup=(_name,_opts,done)=>done(null,[{address:options.address||'192.168.50.20',family:4}]);
 const get=(url,opts,callback)=>{
  calls.push({url,opts});const req=new EventEmitter();req.destroy=()=>{req.dead=true;destroyed++;};
  queueMicrotask(()=>opts.lookup(new URL(url).hostname,{all:true},error=>{
   if(req.dead)return;if(error){req.emit('error',error);return;}
   if(options.hang)return;
   const u=new URL(url),res=new EventEmitter();res.destroy=()=>{res.dead=true;destroyed++;};
   res.statusCode=options.status||200;res.headers=options.headers||{};
   const section=u.pathname==='/library/sections';
   const kind=u.pathname.includes('/1/')?'movie':'show';
   const body=u.pathname==='/identity'?{MediaContainer:options.identity||{machineIdentifier:'fixture-server'}}:options.body?options.body(u):{MediaContainer:section?{Directory:[{key:'1',type:'movie'},{key:'2',type:'show'}]}:{Metadata:
    Array.from({length:8},(_,i)=>({ratingKey:String((kind==='movie'?100:200)+i),type:kind,title:kind+' '+i,
     art:'/library/metadata/'+(100+i)+'/art/1700000000',thumb:'/library/metadata/'+(100+i)+'/thumb/1700000000',
     duration:5400000,childCount:3,Genre:[{tag:'Drama'}]}))}};
   callback(res);if(res.dead)return;
   const bytes=options.bytes||Buffer.from(JSON.stringify(body));
   res.emit('data',bytes);if(!res.dead)res.emit('end');
  }));return req;
 };
 const client=createPlex({...config(),serverId:options.serverId},{get,lookup,now:options.now||(()=>0),timeoutMs:options.timeoutMs||1000,refreshTimeoutMs:options.refreshTimeoutMs||1000});
 return {client,calls,destroyed:()=>destroyed};
}
test('private Plex configuration requires an exact HTTPS origin and header-safe token',()=>{
 assert.equal(configuration({}),null);assert.equal(configuration({plex_url:'',plex_token:''}),null);
 assert.equal(config().origin,ORIGIN);
 for(const url of ['http://192.168.50.20:32400','https://example.com','https://plex.direct.evil.test',ORIGIN+'/library',ORIGIN+'?x=1',ORIGIN+'#x',ORIGIN.replace('https://','https://user:pass@')])assert.throws(()=>configuration({plex_url:url,plex_token:TOKEN}));
 for(const token of ['',TOKEN+'\r\nX-Evil: 1','a'.repeat(4097)])assert.throws(()=>configuration({plex_url:ORIGIN,plex_token:token}));
 for(const ip of ['10.1.2.3','172.16.0.2','172.31.255.254','192.168.50.20','fd00::1','::ffff:192.168.1.2'])assert.equal(privateAddress(ip),true,ip);
 for(const ip of ['127.0.0.1','169.254.169.254','8.8.8.8','172.32.0.1','::1','fe80::1','2001:4860:4860::8888','bad'])assert.equal(privateAddress(ip),false,ip);
});
test('canonical library selection rotates one of the newest eight per kind and publishes no private URL/token',async t=>{
 let clock=0;const f=fixture({now:()=>clock});t.after(()=>f.client.stop());
 await f.client.refresh();const state=f.client.snapshot();
 assert.equal(state.state,'ready');assert.deepEqual(state.picks.map(x=>x.id),[-100,-200]);
 assert.ok(state.picks.every(x=>x.source==='plex'&&x.app==='plex'&&x.detailed&&x.backdrop.startsWith('/plex-')));
 assert.equal(state.picks[0].minutes,90);assert.equal(state.picks[1].seasons,3);
 assert.ok(!JSON.stringify(state).includes(TOKEN));assert.ok(!JSON.stringify(state).includes('plex.direct'));
 assert.equal(f.calls.length,4);
 assert.deepEqual(state.picks[0].plexTitle,{providerId:'fixture-server',ratingKey:'100'});
 for(const call of f.calls){assert.equal(call.opts.rejectUnauthorized,true);assert.equal(call.opts.headers['X-Plex-Token'],TOKEN);assert.ok(!call.url.includes(TOKEN));}
 await f.client.refresh();assert.equal(f.calls.length,4,'cached refresh must not poll the server');
 clock=6*3600000;await f.client.refresh();assert.deepEqual(f.client.snapshot().picks.map(x=>x.id),[-106,-206]);
});
test('Plex refreshes at local day-period boundaries and after clock rollback, and rejects the wrong server',async t=>{
 let clock=new Date(2030,0,1,4,59).getTime();const f=fixture({now:()=>clock});t.after(()=>f.client.stop());
 await f.client.refresh();assert.equal(f.calls.length,4);
 clock+=60000;await f.client.refresh();assert.equal(f.calls.length,8);
 clock+=60000;await f.client.refresh();assert.equal(f.calls.length,8);
 clock-=180000;await f.client.refresh();assert.equal(f.calls.length,12);
 const wrong=fixture({serverId:'different-server'});t.after(()=>wrong.client.stop());await wrong.client.refresh();
 assert.equal(wrong.client.snapshot().state,'unavailable');assert.equal(wrong.calls.length,1);
});
test('Plex transport rejects public DNS, redirects, excessive bodies and credential reflection',async t=>{
 for(const options of [{address:'8.8.8.8'},{status:302},{status:401},{headers:{'content-length':3*1024*1024}},
  {bytes:Buffer.alloc(2*1024*1024+1)},{bytes:Buffer.from('invalid json')},{identity:{echo:TOKEN}}]){
  const f=fixture(options);t.after(()=>f.client.stop());await f.client.refresh();
  assert.equal(f.client.snapshot().state,'unavailable');assert.deepEqual(f.client.snapshot().picks,[]);assert.equal(f.calls.length,1);
  assert.ok(f.destroyed()>0||options.bytes);
 }
});
test('malformed sections and oversized metadata do not become browser data',async t=>{
 for(const body of [()=>({MediaContainer:{Directory:new Array(17).fill({key:'1',type:'movie'})}}),
  ()=>({MediaContainer:{Directory:[{key:'../account',type:'movie'}]}}),
  u=>({MediaContainer:u.pathname==='/library/sections'?{Directory:[{key:'1',type:'movie'}]}:{Metadata:new Array(9).fill({})}})]){
  const f=fixture({body});t.after(()=>f.client.stop());await f.client.refresh();assert.equal(f.client.snapshot().state,'unavailable');
 }
 const f=fixture({body:u=>({MediaContainer:u.pathname==='/library/sections'?{Directory:[{key:'1',type:'movie'}]}:{Metadata:[
  {ratingKey:'1',title:'Bad remote image',art:'https://example.com/secret'},
  {ratingKey:'2',title:'Bad traversal',art:'/library/metadata/2/art/../secret'},
  {ratingKey:'NaN',title:'Bad identifier',art:'/library/metadata/3/art/1'}]}})});
 t.after(()=>f.client.stop());await f.client.refresh();assert.equal(f.client.snapshot().state,'ready');assert.deepEqual(f.client.snapshot().picks,[]);
});
test('only artwork learned from authenticated library metadata can be fetched',async t=>{
 const f=fixture();t.after(()=>f.client.stop());
 await assert.rejects(f.client.image('/plex-'+ 'a'.repeat(64)+'.jpg','w1280'),/Unknown/);assert.equal(f.calls.length,0);
 await f.client.refresh();const ref=f.client.snapshot().picks[0].backdrop;
 assert.equal(f.client.ownsImage(ref),true);await f.client.image(ref,'original');
 const url=new URL(f.calls.at(-1).url);assert.equal(url.pathname,'/photo/:/transcode');assert.equal(url.searchParams.get('width'),'1920');
 assert.equal(url.searchParams.get('url'),'/library/metadata/100/art/1700000000');assert.ok(!url.href.includes(TOKEN));
 await f.client.image(f.client.snapshot().picks[0].poster,'poster');
 const portrait=new URL(f.calls.at(-1).url);assert.equal(portrait.searchParams.get('width'),'500');assert.equal(portrait.searchParams.get('height'),'750');
 for(const size of ['w9999','__proto__','constructor'])await assert.rejects(f.client.image(ref,size),/Unknown/);
 f.client.stop();assert.equal(f.client.ownsImage(ref),false);await assert.rejects(f.client.image(ref,'w300'),/Unknown/);
});
test('failed refresh removes personal picks and stop aborts in-flight requests',async()=>{
 const f=fixture({hang:true});const pending=f.client.refresh();await new Promise(r=>setImmediate(r));f.client.stop();await pending;
 assert.ok(f.destroyed()>0);assert.deepEqual(f.client.snapshot().picks,[]);
 const timeout=fixture({hang:true,refreshTimeoutMs:10});await timeout.client.refresh();assert.equal(timeout.client.snapshot().state,'unavailable');timeout.client.stop();
});
test('merged snapshots never resurrect persisted personal picks after disconnect',()=>{
 const old={picks:[{id:1,app:'netflix'},{id:-2,app:'plex',source:'plex'}],stamp:'native:AU00000000000'};
 assert.deepEqual(JSON.parse(merge(JSON.stringify(old),[],true)).picks,[{id:1,app:'netflix'}]);
 assert.deepEqual(JSON.parse(merge(JSON.stringify(old),[],false)).picks,[]);
 assert.deepEqual(JSON.parse(merge('null',[{id:-3,kind:'movie',app:'plex',source:'plex'}],false)).picks,[{id:-3,kind:'movie',app:'plex',source:'plex'}]);
});
test('canonical merging interleaves each trending kind before fresh titles and keeps the pool at 24',()=>{
 const personal=[{id:-1,kind:'movie',source:'plex',app:'plex'},{id:-2,kind:'tv',source:'plex',app:'plex'}];
 const base=Array.from({length:24},(_,i)=>({id:i+1,kind:i%2?'tv':'movie',app:'netflix',nativeTrending:true}));
 const merged=JSON.parse(merge(JSON.stringify({picks:base,plexPoolVersion:1}),personal,true)).picks;
 assert.equal(merged.length,24);assert.deepEqual(merged.slice(0,6).map(p=>p.id),[1,2,-1,-2,3,4]);assert.equal(merged.at(-1).id,22);
 const uneven=[base[0],base[1],base[2],base[4],{...base[6],nativeTrending:false},{...base[7],nativeTrending:false}];
 assert.deepEqual(JSON.parse(merge(JSON.stringify({picks:uneven,plexPoolVersion:1}),personal,true)).picks.map(p=>p.id),[1,2,-1,-2,3,5,7,8]);
 assert.deepEqual(JSON.parse(merge(JSON.stringify({picks:[base[0],base[2]],plexPoolVersion:1}),[personal[1]],true)).picks.map(p=>p.id),[1,-2,3]);
});
test('sleeping servers have bounded metadata and artwork retries, not continuous polling',async t=>{
 let clock=0;const options={now:()=>clock},f=fixture(options);t.after(()=>f.client.stop());
 await f.client.refresh();const ref=f.client.snapshot().picks[0].backdrop;options.status=503;
 await assert.rejects(f.client.image(ref,'w1280'),/artwork unavailable/);const count=f.calls.length;
 await assert.rejects(f.client.image(ref,'w300'),/artwork unavailable/);assert.equal(f.calls.length,count);
 clock=6*3600000;await f.client.refresh();assert.equal(f.client.snapshot().state,'unavailable');
 assert.deepEqual(f.client.snapshot().picks,[]);assert.equal(f.client.ownsImage(ref),false);
 const failed=f.calls.length;await f.client.refresh();assert.equal(f.calls.length,failed);
 options.status=200;clock+=5*60000;await f.client.refresh();assert.equal(f.client.snapshot().state,'ready');
});
test('feed engine permits Plex without TMDB, and never contacts Plex without its installed app',async()=>{
 const {createEngine}=require('./native-feed-engine.cjs');
 for(const installed of [true,false]){
  let calls=0,stopped=false;
  const plex={refresh:async()=>{calls++;},snapshot:()=>({state:'ready',picks:[{id:-1,source:'plex',app:'plex',kind:'movie',title:'Library',detailed:true}]}),stop:()=>{stopped=true;}};
  const engine=createEngine({token:'',plex,context:{zone:'',prefs:'{"quotes":false}',apps:installed?[{id:'app:7',title:'Plex'}]:[]},request:async()=>{throw Error('No public feed request expected');}});
  engine.refresh();await new Promise(r=>setImmediate(r));const state=engine.snapshot();
  assert.equal(calls,installed?1:0);assert.equal(state.keyConfigured,false);assert.equal(state.plexConfigured,installed);
  assert.equal(JSON.parse(state.cache['fmtv.recs']).picks.length,installed?1:0);assert.equal(state.pending,0);
  engine.stop();assert.equal(stopped,true);
 }
});
