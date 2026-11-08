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
   const body=options.body?options.body(u):{MediaContainer:section?{Directory:[{key:'1',type:'movie'},{key:'2',type:'show'}]}:{Metadata:
    Array.from({length:8},(_,i)=>({ratingKey:String((kind==='movie'?100:200)+i),type:kind,title:kind+' '+i,
     art:'/library/metadata/'+(100+i)+'/art/1700000000',thumb:'/library/metadata/'+(100+i)+'/thumb/1700000000',
     duration:5400000,childCount:3,Genre:[{tag:'Drama'}]}))}};
   callback(res);if(res.dead)return;
   const bytes=options.bytes||Buffer.from(JSON.stringify(body));
   res.emit('data',bytes);if(!res.dead)res.emit('end');
  }));return req;
 };
 const client=createPlex(config(),{get,lookup,now:options.now||(()=>0),timeoutMs:options.timeoutMs||1000,refreshTimeoutMs:options.refreshTimeoutMs||1000});
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
 assert.equal(f.calls.length,3);
 for(const call of f.calls){assert.equal(call.opts.rejectUnauthorized,true);assert.equal(call.opts.headers['X-Plex-Token'],TOKEN);assert.ok(!call.url.includes(TOKEN));}
 await f.client.refresh();assert.equal(f.calls.length,3,'cached refresh must not poll the server');
 clock=4*3600000;await f.client.refresh();assert.deepEqual(f.client.snapshot().picks.map(x=>x.id),[-104,-204]);
});
test('Plex transport rejects public DNS, redirects, excessive bodies and credential reflection',async t=>{
 for(const options of [{address:'8.8.8.8'},{status:302},{status:401},{headers:{'content-length':3*1024*1024}},
  {bytes:Buffer.alloc(2*1024*1024+1)},{bytes:Buffer.from('invalid json')},{body:()=>({MediaContainer:{echo:TOKEN}})}]){
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
 assert.deepEqual(JSON.parse(merge('null',[{id:-3,app:'plex',source:'plex'}],false)).picks,[{id:-3,app:'plex',source:'plex'}]);
});
test('sleeping servers have bounded metadata and artwork retries, not continuous polling',async t=>{
 let clock=0;const options={now:()=>clock},f=fixture(options);t.after(()=>f.client.stop());
 await f.client.refresh();const ref=f.client.snapshot().picks[0].backdrop;options.status=503;
 await assert.rejects(f.client.image(ref,'w1280'),/artwork unavailable/);const count=f.calls.length;
 await assert.rejects(f.client.image(ref,'w300'),/artwork unavailable/);assert.equal(f.calls.length,count);
 clock=4*3600000;await f.client.refresh();assert.equal(f.client.snapshot().state,'unavailable');
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
