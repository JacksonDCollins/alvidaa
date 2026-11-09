'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPlex}=require('./native-feed-plex.cjs');
const servers=['server-alpha','server-bravo','server-sleep'].map(serverId=>({serverId,origins:['https://'+serverId+'.fixture.plex.direct:32400'],token:'fake-'+serverId}));
function pick(serverId,kind,addedAt,key='1'){
 return {id:-Number(key),kind,title:'Fixture',source:'plex',app:'plex',detailed:true,addedAt,
  backdrop:'/plex-'+serverId+'-'+kind+'.jpg',poster:'/plex-'+serverId+'-'+kind+'-poster.jpg',plexTitle:{providerId:serverId,ratingKey:key}};
}
function fixture(data,options={}){
 const made=[],images=[];let clock=0;
 const client=createPlex({servers},{now:()=>clock,refreshTimeoutMs:50,...options,clientFactory:(config,opts)=>{
  assert.equal(opts.allCandidates,true);const value={stopped:false,state:'pending',config,
   async refresh(){const items=data[config.serverId];if(items===null){this.state='unavailable';return;}this.items=items||[];this.state='ready';},
   snapshot(){return {state:this.state,picks:this.items||[]};},ownsImage(){return !this.stopped;},
   async image(ref,size){assert.equal(this.stopped,false);images.push({server:config.serverId,token:config.token,ref,size});return Buffer.from(config.serverId);},
   stop(){this.stopped=true;this.state='disabled';this.items=[];}};made.push(value);return value;
 }});
 return {client,made,images,hour:n=>{clock=n*3600000;}};
}
test('all servers share the newest-eight pool and only one movie/show is selected overall',async t=>{
 const data={'server-alpha':[pick('server-alpha','movie',10),pick('server-alpha','tv',40)],'server-bravo':[pick('server-bravo','movie',30),pick('server-bravo','tv',20)],'server-sleep':null};
 const f=fixture(data);t.after(()=>f.client.stop());await f.client.refresh();
 let s=f.client.snapshot();assert.equal(s.state,'ready');assert.equal(s.picks.length,2);
 assert.deepEqual(s.picks.map(p=>p.plexTitle.providerId),['server-bravo','server-alpha']);
 for(const p of s.picks){assert.equal(Object.hasOwn(p,'addedAt'),false);assert.ok(Number.isSafeInteger(p.id)&&p.id<0);await f.client.image(p.backdrop,'original');await f.client.image(p.poster,'poster');}
 assert.deepEqual(f.images.map(i=>i.server),['server-bravo','server-bravo','server-alpha','server-alpha']);
 const original=s.picks[0].id;f.hour(1);await f.client.refresh();s=f.client.snapshot();
 assert.equal(s.picks[0].plexTitle.ratingKey,'1');assert.notEqual(s.picks[0].id,original,'same numeric key on different servers never aliases');
 assert.deepEqual(s.picks.map(p=>p.plexTitle.providerId),['server-alpha','server-bravo']);
 assert.ok(!JSON.stringify(s).includes('fake-server'));assert.ok(!JSON.stringify(s).includes('plex.direct'));
 f.client.stop();assert.deepEqual(f.client.snapshot().picks,[]);await assert.rejects(f.client.image(s.picks[0].backdrop,'original'),/Unknown/);
 assert.ok(f.made.every(c=>c.stopped));
});
test('only the newest eight across servers rotate, with stable tie ordering and duplicate removal',async t=>{
 const data={'server-alpha':Array.from({length:8},(_,i)=>pick('server-alpha','movie',100-i,String(i+1))),
  'server-bravo':[pick('server-bravo','movie',1000),pick('server-bravo','movie',1000)],'server-sleep':null};
 const f=fixture(data);t.after(()=>f.client.stop());f.hour(7);await f.client.refresh();assert.equal(f.client.snapshot().picks[0].plexTitle.ratingKey,'7');
 f.hour(8);await f.client.refresh();assert.equal(f.client.snapshot().picks[0].plexTitle.providerId,'server-bravo');
});
test('failure removes only the failed server contribution; total failure clears private artwork ownership',async t=>{
 const data={'server-alpha':[pick('server-alpha','movie',20)],'server-bravo':[pick('server-bravo','movie',10)],'server-sleep':null};
 const f=fixture(data);t.after(()=>f.client.stop());await f.client.refresh();const ref=f.client.snapshot().picks[0].backdrop;
 data['server-alpha']=null;await f.client.refresh();assert.equal(f.client.snapshot().picks[0].plexTitle.providerId,'server-bravo');assert.equal(f.client.ownsImage(ref),false);
 data['server-bravo']=null;await f.client.refresh();assert.equal(f.client.snapshot().state,'unavailable');assert.deepEqual(f.client.snapshot().picks,[]);
});
test('global deadline isolates a sleeping server and preserves a responsive server',async t=>{
 let resolveSleep,stops=0;const client=createPlex({servers:servers.slice(0,2)},{refreshTimeoutMs:15,clientFactory:config=>{
  let state='pending';return {refresh:()=>config.serverId==='server-alpha'?new Promise(resolve=>{resolveSleep=resolve;}):Promise.resolve().then(()=>{state='ready';}),
   snapshot:()=>({state,picks:state==='ready'?[pick(config.serverId,'movie',10)]:[]}),ownsImage:()=>true,image:async()=>Buffer.from('fixture'),
   stop(){stops++;state='disabled';if(config.serverId==='server-alpha'&&resolveSleep)resolveSleep();}};
 }});t.after(()=>client.stop());await client.refresh();assert.equal(client.snapshot().state,'ready');assert.equal(client.snapshot().picks[0].plexTitle.providerId,'server-bravo');assert.ok(stops>=1);
});
test('stop during multi-server refresh rejects late publication and stops every client',async()=>{
 const releases=[];let stopped=0;const client=createPlex({servers},{clientFactory:config=>({refresh:()=>new Promise(resolve=>releases.push(resolve)),snapshot:()=>({state:'ready',picks:[pick(config.serverId,'movie',1)]}),stop(){stopped++;},ownsImage:()=>true})});
 const pending=client.refresh();client.stop();for(const release of releases)release();await pending;assert.equal(stopped,3);assert.deepEqual(client.snapshot().picks,[]);
});
