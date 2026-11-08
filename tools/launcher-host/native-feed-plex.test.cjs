'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {serverOrigin,createPlex,merge}=require('./native-feed-plex.cjs');
const ORIGIN='https://192-168-50-20.0123456789abcdef.plex.direct:32400',TOKEN='fake-plex-test-token';
const config=()=>({...serverOrigin(ORIGIN),token:TOKEN});
function fixture(options={}){
 const calls=[];let destroyed=0;
 const lookup=(_name,_opts,done)=>done(null,[{address:options.address||'192.168.50.20',family:4}]);
 const get=(url,opts,callback)=>{
  calls.push({url,opts});const req=new EventEmitter();req.destroy=()=>{req.dead=true;destroyed++;};
  queueMicrotask(()=>opts.lookup(new URL(url).hostname,{all:true},error=>{
   if(req.dead)return;if(error){req.emit('error',error);return;}
   if(options.hang)return;
   const u=new URL(url);if(u.origin===options.failedOrigin){req.emit('error',Error('Unavailable app connection'));return;}
   const res=new EventEmitter();res.destroy=()=>{res.dead=true;destroyed++;};
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
 const client=createPlex({...config(),origins:options.origins,serverId:options.serverId},{get,lookup,now:options.now||(()=>0),timeoutMs:options.timeoutMs||1000,refreshTimeoutMs:options.refreshTimeoutMs||1000});
 return {client,calls,destroyed:()=>destroyed};
}
test('private Plex transport requires an exact HTTPS origin and header-safe token',()=>{
 assert.throws(()=>createPlex({}));
 assert.equal(config().origin,ORIGIN);
 for(const url of ['http://192.168.50.20:32400','https://example.com','https://plex.direct.evil.test',ORIGIN+'/library',ORIGIN+'?x=1',ORIGIN+'#x',ORIGIN.replace('https://','https://user:pass@')])assert.throws(()=>createPlex({origin:url,token:TOKEN}));
 for(const token of ['',TOKEN+'\r\nX-Evil: 1','a'.repeat(4097)])assert.throws(()=>createPlex({origin:ORIGIN,token}));
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
 await f.client.refresh();assert.equal(f.calls.length,8,'only the owning recommendation list decides when to refresh');
 clock=6*3600000;await f.client.refresh();assert.deepEqual(f.client.snapshot().picks.map(x=>x.id),[-106,-206]);
 clock=-3600000;await f.client.refresh();assert.deepEqual(f.client.snapshot().picks.map(x=>x.id),[-107,-207],'canonical floorMod also handles a backward clock before the epoch');
});
test('Plex obeys explicit list refresh requests and rejects the wrong server',async t=>{
 let clock=new Date(2030,0,1,4,59).getTime();const f=fixture({now:()=>clock});t.after(()=>f.client.stop());
 await f.client.refresh();assert.equal(f.calls.length,4);
 clock+=60000;await f.client.refresh();assert.equal(f.calls.length,8);
 clock+=60000;await f.client.refresh();assert.equal(f.calls.length,12);
 clock-=180000;await f.client.refresh();assert.equal(f.calls.length,16);
 const wrong=fixture({serverId:'different-server'});t.after(()=>wrong.client.stop());await wrong.client.refresh();
 assert.equal(wrong.client.snapshot().state,'unavailable');assert.equal(wrong.calls.length,1);
});
test('canonical transport permits remote Plex DNS but rejects redirects, excessive bodies and credential reflection',async t=>{
 const remote=fixture({address:'203.0.113.7'});t.after(()=>remote.client.stop());await remote.client.refresh();assert.equal(remote.client.snapshot().state,'ready');
 for(const options of [{status:302},{status:401},{headers:{'content-length':3*1024*1024}},
  {bytes:Buffer.alloc(2*1024*1024+1)},{bytes:Buffer.from('invalid json')},{identity:{echo:TOKEN}}]){
  const f=fixture(options);t.after(()=>f.client.stop());await f.client.refresh();
  assert.equal(f.client.snapshot().state,'unavailable');assert.deepEqual(f.client.snapshot().picks,[]);assert.equal(f.calls.length,1);
  assert.ok(f.destroyed()>0||options.bytes);
 }
});
test('tries only app-provided secure origins and reuses the successful matching server',async t=>{
 const stale='https://stale.fixture.plex.direct:32400';
 const f=fixture({origins:[stale,ORIGIN],failedOrigin:stale,serverId:'fixture-server',address:'203.0.113.7'});t.after(()=>f.client.stop());
 await f.client.refresh();assert.equal(f.client.snapshot().state,'ready');assert.equal(f.calls[0].url,stale+'/identity');
 assert.equal(f.calls[1].url,ORIGIN+'/identity');assert.equal(f.calls.length,5);
 await f.client.refresh();assert.equal(f.calls.filter(c=>c.url.startsWith(stale)).length,1);
 for(const call of f.calls){assert.ok(call.url.startsWith(stale)||call.url.startsWith(ORIGIN));assert.equal(call.opts.rejectUnauthorized,true);assert.ok(!call.url.includes(TOKEN));}
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
test('canonical failure ordering retains a selected movie when the later show lookup fails',async t=>{
 const f=fixture({body:u=>({MediaContainer:u.pathname==='/library/sections'?{Directory:[{key:'1',type:'movie'},{key:'2',type:'show'}]}:
  u.pathname.includes('/1/')?{Metadata:[{ratingKey:'100',type:'movie',title:'Movie',art:'/library/metadata/100/art/1'}]}:{Metadata:new Array(9).fill({})}})});t.after(()=>f.client.stop());
 await f.client.refresh();assert.equal(f.client.snapshot().state,'ready');assert.deepEqual(f.client.snapshot().picks.map(p=>p.id),[-100]);
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
 assert.deepEqual(JSON.parse(merge('null',[{id:-3,kind:'movie',app:'plex',source:'plex'}],false)).picks,[]);
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
test('artwork failures are bounded and metadata retries occur only when explicitly requested',async t=>{
 let clock=0;const options={now:()=>clock},f=fixture(options);t.after(()=>f.client.stop());
 await f.client.refresh();const ref=f.client.snapshot().picks[0].backdrop;options.status=503;
 await assert.rejects(f.client.image(ref,'w1280'),/artwork unavailable/);const count=f.calls.length;
 await assert.rejects(f.client.image(ref,'w300'),/artwork unavailable/);assert.equal(f.calls.length,count);
 clock=6*3600000;await f.client.refresh();assert.equal(f.client.snapshot().state,'unavailable');
 assert.deepEqual(f.client.snapshot().picks,[]);assert.equal(f.client.ownsImage(ref),false);
 const failed=f.calls.length;await f.client.refresh();assert.equal(f.calls.length,failed+1);
 options.status=200;clock+=5*60000;await f.client.refresh();assert.equal(f.client.snapshot().state,'ready');
});
test('Plex joins the original list refresh only after public discovery and verified artwork',async t=>{
 const {createEngine}=require('./native-feed-engine.cjs');let calls=0,prepared=0,release,state='ready';
 const pick={id:-1,kind:'movie',source:'plex',app:'plex',title:'Library',detailed:true,backdrop:'/plex-fixture.jpg'};
 const plex={refresh:async()=>{calls++;},snapshot:()=>({state,picks:[pick]}),stop(){}};
 const engine=createEngine({token:'eyJ.fixture',plex,context:{zone:'Australia/Brisbane',language:'en-AU',prefs:'{"quotes":false}',apps:[{id:'app:1',title:'Netflix'},{id:'app:42',title:'Plex'}]},
  preparePlex:async picks=>{prepared++;assert.deepEqual(picks,[pick]);return new Promise(resolve=>{release=()=>resolve(picks);});},
  request:async url=>{
   if(url.includes('/watch/providers/'))return {status:200,body:{results:[{provider_id:8,provider_name:'Netflix'}]}};
   if(url.includes('/trending/movie/'))return {status:200,body:{results:[{id:1,title:'Public',backdrop_path:'/public.jpg'}]}};
   if(url.includes('/movie/1?'))return {status:200,body:{genres:[],release_date:'2026-01-01','watch/providers':{results:{AU:{flatrate:[{provider_id:8,provider_name:'Netflix'}]}}}}};
   return {status:200,body:{results:[]}};
  }});t.after(()=>engine.stop());
 engine.refresh();await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(prepared,1);assert.ok(engine.snapshot().pending>0);
 release();await new Promise(r=>setImmediate(r));
 assert.equal(JSON.parse(engine.snapshot().cache['fmtv.recs']).picks.filter(p=>p.source==='plex').length,1);
 for(let i=0;i<3;i++){engine.refresh();await new Promise(r=>setImmediate(r));}
 assert.equal(calls,1,'ordinary polling must not independently refresh Plex');assert.equal(prepared,1);assert.equal(engine.snapshot().pending,0);
 state='pending';assert.equal(JSON.parse(engine.snapshot().cache['fmtv.recs']).picks.filter(p=>p.source==='plex').length,1,'retain the committed current-session list during ordinary refresh');
 state='unavailable';assert.equal(JSON.parse(engine.snapshot().cache['fmtv.recs']).picks.filter(p=>p.source==='plex').length,0,'never retain it after failed authorization');
});
test('startup never treats persisted private picks as an authenticated current-session list',t=>{
 const {createEngine}=require('./native-feed-engine.cjs');let state='ready';
 const picks=[{id:-1,kind:'movie',source:'plex',app:'plex',title:'Library',detailed:true}];
 const plex={snapshot:()=>({state,picks:state==='unavailable'?[]:picks}),stop(){}};
 const engine=createEngine({token:'eyJ.fixture',plex,context:{zone:'Australia/Brisbane',apps:[{id:'app:42',title:'Plex'}]},cache:{'fmtv.recs':JSON.stringify({picks})}});t.after(()=>engine.stop());
 const count=()=>JSON.parse(engine.snapshot().cache['fmtv.recs']).picks.filter(p=>p.source==='plex').length;
 assert.equal(count(),0);state='pending';assert.equal(count(),0);state='unavailable';assert.equal(count(),0);
});
test('public discovery failure does not start an independent Plex-only fetch',async t=>{
 const {createEngine}=require('./native-feed-engine.cjs');let calls=0;
 const plex={refresh:async()=>{calls++;},snapshot:()=>({state:'pending',picks:[]}),stop(){}};
 const engine=createEngine({token:'eyJ.fixture',plex,context:{zone:'Australia/Brisbane',prefs:'{"quotes":false}',apps:[{id:'app:1',title:'Netflix'},{id:'app:42',title:'Plex'}]},request:async()=>({status:503,body:null})});t.after(()=>engine.stop());
 engine.refresh();await new Promise(r=>setImmediate(r));assert.equal(calls,0);assert.equal(engine.snapshot().pending,0);
});
test('installed-app gating also prevents Plex refresh with a configured TMDB key',async t=>{
 const {createEngine}=require('./native-feed-engine.cjs');let calls=0;
 const plex={refresh:async()=>{calls++;},snapshot:()=>({state:'ready',picks:[]}),stop(){}};
 const engine=createEngine({token:'eyJ.fixture',plex,context:{zone:'Australia/Brisbane',prefs:'{"quotes":false}',apps:[{id:'app:1',title:'Netflix'}]},request:async()=>({status:503,body:null})});t.after(()=>engine.stop());
 engine.refresh();await new Promise(r=>setImmediate(r));assert.equal(calls,0);assert.equal(engine.snapshot().plexConfigured,false);
});
test('canonical recommendations require TMDB configuration, even when Plex is installed',async()=>{
 const {createEngine}=require('./native-feed-engine.cjs');
 for(const installed of [true,false]){
  let calls=0,stopped=false;
  const plex={refresh:async()=>{calls++;},snapshot:()=>({state:'ready',picks:[{id:-1,source:'plex',app:'plex',kind:'movie',title:'Library',detailed:true}]}),stop:()=>{stopped=true;}};
  const engine=createEngine({token:'',plex,context:{zone:'',prefs:'{"quotes":false}',apps:installed?[{id:'app:7',title:'Plex'}]:[]},request:async()=>{throw Error('No public feed request expected');}});
  engine.refresh();await new Promise(r=>setImmediate(r));const state=engine.snapshot();
  assert.equal(calls,0);assert.equal(state.keyConfigured,false);assert.equal(state.plexConfigured,false);
  assert.equal(JSON.parse(state.cache['fmtv.recs']).picks.length,0);assert.equal(state.pending,0);
  engine.stop();assert.equal(stopped,true);
 }
});
