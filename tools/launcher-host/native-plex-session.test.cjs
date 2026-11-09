'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const storage=require('./native-plex-storage.cjs');
const {configuration,select,createSession}=require('./native-plex-session.cjs');
const ORIGIN='https://192-168-50-8.fake-server.plex.direct:32400',SERVER='fixture-server-identity';
const binding=()=>configuration({plex_auto:true,plex_url:ORIGIN,plex_server_id:SERVER});
function settings(user='user-a'){
 return {PlexAuthToken:'fake-account-'+user,LastActiveUserUuid:user,
  OfflineUsersData:JSON.stringify({'user-a':{uuid:'user-a',authToken:'fake-account-user-a'},'user-b':{uuid:'user-b',authToken:'fake-account-user-b'}}),
  OfflineServersData:JSON.stringify({[SERVER]:{id:SERVER,identifier:SERVER,connections:[{uri:ORIGIN,isRelay:false}]}}),
  OfflineUserServersData:JSON.stringify({'user-a':{[SERVER]:{token:'fake-server-user-a'}},'user-b':{[SERVER]:{token:'fake-server-user-b'}}})};
}
const integer=n=>{const bytes=[];while(n>=128){bytes.push((n%128)|128);n=Math.floor(n/128);}bytes.push(n);return Buffer.from(bytes);};
const field=b=>Buffer.concat([integer(b.length),b]);
const checksum=b=>{const out=Buffer.alloc(4);out.writeUInt32LE(storage.maskedCRC(b));return out;};
const log=b=>Buffer.concat([checksum(Buffer.concat([Buffer.from([1]),b])),Buffer.from([b.length&255,b.length>>8,1]),b]);
const internal=(key,sequence,type=1)=>{const tail=Buffer.alloc(8);tail.writeBigUInt64LE((BigInt(sequence)<<8n)|BigInt(type));return Buffer.concat([key,tail]);};
const appKey=(key,origin='https://app.plex.tv')=>Buffer.from('_'+origin+'\0\x01'+key);
function block(rows){return Buffer.concat([...rows.map(([key,value])=>Buffer.concat([integer(0),integer(key.length),integer(value.length),key,value])),Buffer.from([0,0,0,0,1,0,0,0])]);}
const framed=b=>Buffer.concat([b,Buffer.from([0]),checksum(Buffer.concat([b,Buffer.from([0])]))]);
function table(rows){
 const data=block(rows),first=framed(data),index=block([[rows.at(-1)[0],Buffer.concat([integer(0),integer(data.length)])]]),footer=Buffer.alloc(48);
 Buffer.concat([integer(0),integer(0),integer(first.length),integer(index.length)]).copy(footer);footer.writeBigUInt64LE(0xdb4775248b80fb57n,40);
 return Buffer.concat([first,framed(index),footer]);
}
function fixture(t,values=settings()){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fmtv-plex-storage-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const rows=Object.entries(values).map(([key,value],i)=>[internal(appKey(key),i+1),Buffer.from('\x01'+value)]);
 rows.push([internal(appKey('PlexAuthToken','https://app.plex.tv.evil.invalid'),90),Buffer.from('\x01fake-foreign-token')]);
 rows.push([internal(appKey('OfflineHomeUsersData'),91),Buffer.from('\x01do-not-decode-unneeded-profile-data')]);rows.sort((a,b)=>Buffer.compare(a[0],b[0]));
 const sst=table(rows),edit=Buffer.concat([integer(1),field(Buffer.from('leveldb.BytewiseComparator')),integer(2),integer(3),integer(7),integer(0),integer(2),integer(sst.length),field(rows[0][0]),field(rows.at(-1)[0])]);
 fs.writeFileSync(path.join(directory,'CURRENT'),'MANIFEST-000001\n');fs.writeFileSync(path.join(directory,'MANIFEST-000001'),log(edit));fs.writeFileSync(path.join(directory,'000002.ldb'),sst);fs.writeFileSync(path.join(directory,'000003.log'),Buffer.alloc(0));
 const obsolete=table([[internal(appKey('PlexAuthToken'),9999),Buffer.from('\x01fake-obsolete-token')]]);fs.writeFileSync(path.join(directory,'000004.ldb'),obsolete);
 return {directory,remove(key){const header=Buffer.alloc(12);header.writeBigUInt64LE(100n);header.writeUInt32LE(1,8);fs.writeFileSync(path.join(directory,'000003.log'),log(Buffer.concat([header,Buffer.from([0]),field(appKey(key))])));}};
}
test('automatic configuration needs no server identity, URL or token',()=>{
 assert.equal(configuration({}),null);assert.equal(configuration({plex_auto:false}),null);
 assert.deepEqual(binding(),{});assert.deepEqual(configuration({plex_auto:true}),{});
 assert.throws(()=>configuration({plex_auto:'true'}));
 assert.deepEqual(configuration({plex_auto:true,plex_server_id:'ignored',plex_url:'ignored-override'}),{});
});
test('selects only the active account server-scoped token, not its cloud token or another cached profile',()=>{
 const a=select(settings(),binding()),b=select(settings('user-b'),binding());
 assert.equal(a.state,'ready');assert.deepEqual(a.credentials.servers[0].origins,[ORIGIN]);assert.equal(a.credentials.servers[0].token,'fake-server-user-a');assert.equal(b.credentials.servers[0].token,'fake-server-user-b');assert.notEqual(a.signature,b.signature);
 const switched=settings();switched.LastActiveUserUuid='user-b';assert.equal(select(switched,binding()).state,'unavailable');
 const noAccess=settings();noAccess.OfflineUserServersData=JSON.stringify({'user-b':{[SERVER]:{token:'fake-server-user-b'}}});assert.equal(select(noAccess,binding()).state,'no-access');
 assert.equal(select(settings(),{serverId:'ignored-legacy-pin'}).credentials.servers[0].serverId,SERVER);
});
test('uses all active-user personal servers, independent of pins, and fingerprints membership changes',t=>{
 const value=settings(),second='second-server-identity',servers=JSON.parse(value.OfflineServersData),links=JSON.parse(value.OfflineUserServersData);
 servers[second]={id:second,type:'pms',connections:[{uri:ORIGIN}]};links['user-a'][second]={token:'fake-second-token'};
 servers['cloud-provider']={id:'cloud-provider',type:'cloudMediaProvider',connections:[{uri:ORIGIN}]};links['user-a']['cloud-provider']={token:'fake-cloud-token'};
 value.OfflineServersData=JSON.stringify(servers);value.OfflineUserServersData=JSON.stringify(links);
 value['user-a-PinnedSources']='unused malformed pins';
 const first=select(value,binding());assert.equal(first.state,'ready');assert.deepEqual(first.credentials.servers.map(s=>s.serverId),[SERVER,second]);
 assert.equal(first.credentials.servers[1].token,'fake-second-token');
 const f=fixture(t,value);const read=storage.readPlex(f.directory).settings;assert.equal(read['user-a-PinnedSources'],undefined);assert.equal(select(read,binding()).signature,first.signature);
 delete links['user-a'][SERVER];value.OfflineUserServersData=JSON.stringify(links);
 const next=select(value,binding());assert.equal(next.credentials.servers.length,1);assert.equal(next.credentials.servers[0].serverId,second);assert.notEqual(next.signature,first.signature);
 value.LastActiveUserUuid='user-b';value.PlexAuthToken='fake-account-user-b';assert.deepEqual(select(value,binding()).credentials.servers.map(s=>s.serverId),[SERVER]);
});
test('an unusable server record does not suppress another server authorized for the active user',()=>{
 const value=settings(),servers=JSON.parse(value.OfflineServersData),links=JSON.parse(value.OfflineUserServersData);
 servers['broken-server']={id:'broken-server',type:'pms',connections:[{uri:'http://localhost:9009'}]};links['user-a']['broken-server']={token:'fake-broken-token'};
 value.OfflineServersData=JSON.stringify(servers);value.OfflineUserServersData=JSON.stringify(links);
 assert.deepEqual(select(value,binding()).credentials.servers.map(s=>s.serverId),[SERVER]);
});
test('only canonical app-advertised HTTPS endpoints are candidates; no saved URL fallback',()=>{
 const value=settings(),remote='https://remote.fixture.plex.direct:32400';
 value.OfflineServersData=JSON.stringify({[SERVER]:{id:SERVER,connections:[{uri:'http://localhost:9009'},{uri:remote},{uri:ORIGIN},{uri:remote},{uri:ORIGIN,isRelay:true}]}});
 assert.deepEqual(select(value,binding()).credentials.servers[0].origins,[remote,ORIGIN]);
 value.OfflineServersData=JSON.stringify({[SERVER]:{id:SERVER,connections:[{uri:'http://localhost:9009'}]}});
 assert.equal(select(value,binding()).state,'unavailable');
});
test('sign-out, incomplete account switches and malformed records never retain credentials',()=>{
 for(const key of ['PlexAuthToken','LastActiveUserUuid']){const value=settings();delete value[key];const result=select(value,binding());assert.equal(result.state,'signed-out');assert.equal(result.credentials,undefined);}
 for(const key of ['OfflineUsersData','OfflineServersData','OfflineUserServersData']){const value=settings();value[key]='not JSON';assert.equal(select(value,binding()).credentials,undefined);}
 const value=settings();value.OfflineUserServersData=JSON.stringify({'user-a':{constructor:{token:'fake-inherited-token'}}});assert.equal(select(value,binding()).credentials,undefined);
 for(const server of [[],{id:'different-server',identifier:SERVER}]){const corrupt=settings();corrupt.OfflineServersData=JSON.stringify({[SERVER]:server});assert.equal(select(corrupt,binding()).credentials,undefined);}
 const conflicting=settings();conflicting.OfflineUsersData=JSON.stringify({'user-a':{uuid:'user-b',authToken:'fake-account-user-a'}});assert.equal(select(conflicting,binding()).credentials,undefined);
});
test('read-only storage follows live manifests and only decodes required HTTPS Plex settings',t=>{
 const f=fixture(t),result=storage.readPlex(f.directory);
 assert.deepEqual({...result.settings},settings());assert.equal(Object.hasOwn(result.settings,'OfflineHomeUsersData'),false);
 f.remove('PlexAuthToken');const signedOut=storage.readPlex(f.directory);assert.equal(signedOut.settings.PlexAuthToken,undefined,'new deletion must beat live and obsolete SST values');
 assert.equal(select(signedOut.settings,binding()).state,'signed-out');
});
test('WAL changes reuse only unchanged live tables; clearing releases cached settings',t=>{
 const f=fixture(t),read=storage.createReader(f.directory),first=read();
 f.remove('PlexAuthToken');const next=read();assert.equal(next.settings.PlexAuthToken,undefined);assert.ok(next.bytesRead<first.bytesRead);
 read.clear();assert.ok(read().bytesRead>next.bytesRead);
});
test('session monitor notices deletion, reuses unchanged files, and clears immediately on read failures',t=>{
 const f=fixture(t);let reads=0,clears=0;
 const read=()=>{reads++;return storage.readPlex(f.directory);};read.clear=()=>{clears++;};
 const monitor=createSession(binding(),{read});
 assert.equal(monitor.read().state,'ready');assert.equal(monitor.read().state,'ready');assert.equal(reads,1);
 f.remove('PlexAuthToken');assert.equal(monitor.read().state,'signed-out');assert.equal(reads,2);
 fs.unlinkSync(path.join(f.directory,'CURRENT'));assert.equal(monitor.read().state,'unavailable');assert.equal(monitor.read().credentials,undefined);
 assert.equal(clears,2,'both stat failures and read failures release table caches');
 monitor.stop();assert.equal(monitor.read().state,'disabled');assert.equal(clears,3);
});
test('torn/corrupt journals, symlinks and unsupported manifests fail closed',t=>{
 const f=fixture(t),file=path.join(f.directory,'000003.log');
 fs.writeFileSync(file,Buffer.from([1,2,3]));assert.throws(()=>storage.readPlex(f.directory),/Incomplete/);
 fs.writeFileSync(file,Buffer.from([1,0,0,0,0,0,0]));assert.throws(()=>storage.readPlex(f.directory),/checksum/);
 const damaged=log(Buffer.from('fake'));damaged[0]^=1;fs.writeFileSync(file,damaged);assert.throws(()=>storage.readPlex(f.directory),/checksum/);
 fs.unlinkSync(file);fs.symlinkSync(path.join(f.directory,'000002.ldb'),file);assert.throws(()=>storage.readPlex(f.directory));fs.unlinkSync(file);fs.writeFileSync(file,Buffer.alloc(0));
 fs.writeFileSync(path.join(f.directory,'CURRENT'),'../foreign\n');assert.throws(()=>storage.readPlex(f.directory),/manifest/);
});
test('Snappy copies are bounded and incomplete fragments cannot expose older session data',()=>{
 assert.equal(storage.snappy(Buffer.from([5,16,...Buffer.from('hello')])).toString(),'hello');
 assert.equal(storage.snappy(Buffer.from([5,0,97,1,1])).toString(),'aaaaa');
 assert.throws(()=>storage.snappy(Buffer.from([5,0,97,1,0])));assert.throws(()=>storage.snappy(integer(9*1024*1024)),/limit/);
 const fragment=Buffer.from('first'),type=Buffer.from([2]);const record=Buffer.concat([checksum(Buffer.concat([type,fragment])),Buffer.from([fragment.length,0,2]),fragment]);
 assert.throws(()=>storage.journal(record,()=>{}),/Incomplete/);
});
