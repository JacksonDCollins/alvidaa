'use strict';
// Read-only Chromium LevelDB session reader. Never open/repair/unlock the live DB.
// Format: github.com/google/leveldb/doc/{table_format,log_format}.md; Snappy raw blocks.
const fs=require('node:fs');
const path=require('node:path');
const DIRECTORY='/var/local/webengine/odin_home_browser/Normal/Local Storage/leveldb';
const ORIGIN=Buffer.from('_https://app.plex.tv\0');
const KEYS=new Set(['PlexAuthToken','LastActiveUserUuid','OfflineUsersData','OfflineServersData','OfflineUserServersData']);
const LIMIT=8*1024*1024,TOTAL=32*1024*1024;
const crcTable=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0x82f63b78:0);return c>>>0;});
function maskedCRC(bytes){
 let c=0xffffffff;for(const byte of bytes)c=(c>>>8)^crcTable[(c^byte)&255];c=(c^0xffffffff)>>>0;
 return (((c>>>15)|(c<<17))+0xa282ead8)>>>0;
}
function variable(bytes,position){
 let n=0,m=1;
 for(let i=0;i<8;i++){
  if(position.i>=bytes.length)throw new Error('Incomplete storage integer');
  const v=bytes[position.i++];n+=(v&127)*m;
  if(!Number.isSafeInteger(n))throw new Error('Storage integer limit');
  if(!(v&128))return n;m*=128;
 }
 throw new Error('Storage integer limit');
}
function field(bytes,position){
 const size=variable(bytes,position);
 if(size>LIMIT||position.i+size>bytes.length)throw new Error('Storage field limit');
 const value=bytes.subarray(position.i,position.i+size);position.i+=size;return value;
}
function journal(bytes,visit){
 let pieces=[],size=0;
 for(let block=0;block<bytes.length;block+=32768){
  const end=Math.min(block+32768,bytes.length);let i=block;
  while(i+7<=end){
   const checksum=bytes.readUInt32LE(i),length=bytes.readUInt16LE(i+4),type=bytes[i+6];i+=7;
   if(type===0&&length===0&&checksum===0){if(bytes.subarray(i,end).some(x=>x!==0))throw new Error('Storage journal padding');i=end;break;}
   if(i+length>end)throw new Error('Incomplete storage journal');
   const part=bytes.subarray(i,i+length);i+=length;
   if(maskedCRC(Buffer.concat([Buffer.from([type]),part]))!==checksum)throw new Error('Storage journal checksum');
   if(type===1){if(pieces.length)throw new Error('Incomplete storage fragment');visit(part);}
   else if(type===2){if(pieces.length)throw new Error('Incomplete storage fragment');pieces=[part];size=part.length;}
   else if((type===3||type===4)&&pieces.length){
    size+=part.length;if(size>LIMIT)throw new Error('Storage journal limit');pieces.push(part);
    if(type===4){visit(Buffer.concat(pieces));pieces=[];size=0;}
   }else throw new Error('Storage journal fragment');
  }
  if(bytes.subarray(i,end).some(x=>x!==0))throw new Error('Incomplete storage journal header');
 }
 if(pieces.length)throw new Error('Incomplete storage fragment');
}
function snappy(bytes){
 const p={i:0},length=variable(bytes,p);if(length>LIMIT)throw new Error('Storage expansion limit');
 const out=Buffer.alloc(length);let at=0;
 while(p.i<bytes.length){
  const tag=bytes[p.i++],type=tag&3;let size,offset;
  if(type===0){
   size=tag>>>2;
   if(size<60)size++;
   else{const extra=size-59;if(p.i+extra>bytes.length)throw new Error('Storage literal length');size=1;for(let j=0;j<extra;j++)size+=bytes[p.i++]*2**(8*j);}
   if(p.i+size>bytes.length||at+size>length)throw new Error('Storage literal bounds');
   bytes.copy(out,at,p.i,p.i+size);p.i+=size;at+=size;
  }else{
   if(type===1){if(p.i>=bytes.length)throw new Error('Storage copy length');size=4+((tag>>>2)&7);offset=((tag&224)<<3)|bytes[p.i++];}
   else{size=1+(tag>>>2);const width=type===2?2:4;if(p.i+width>bytes.length)throw new Error('Storage copy length');offset=bytes.readUIntLE(p.i,width);p.i+=width;}
   if(!offset||offset>at||at+size>length)throw new Error('Storage copy bounds');
   for(let j=0;j<size;j++){out[at]=out[at-offset];at++;}
  }
 }
 if(at!==length)throw new Error('Storage expansion length');return out;
}
function block(file,handle,budget){
 const p={i:0},offset=variable(handle,p),size=variable(handle,p);
 if(size>LIMIT||offset+size+5>file.length)throw new Error('Storage block bounds');
 const bytes=file.subarray(offset,offset+size),type=file[offset+size];
 if(maskedCRC(file.subarray(offset,offset+size+1))!==file.readUInt32LE(offset+size+1))throw new Error('Storage block checksum');
 let expanded;
 if(type===0)expanded=size;
 else if(type===1)expanded=variable(bytes,{i:0});
 else throw new Error('Unsupported storage compression');
 budget.decoded+=expanded;if(expanded>LIMIT||budget.decoded>TOTAL)throw new Error('Storage expansion budget');
 return type===0?bytes:snappy(bytes);
}
function entries(bytes,visit,budget){
 if(bytes.length<4)throw new Error('Incomplete storage block');
 const restarts=bytes.readUInt32LE(bytes.length-4),end=bytes.length-4*(restarts+1);
 if(end<0)throw new Error('Storage restart bounds');
 const p={i:0};let previous=Buffer.alloc(0);
 while(p.i<end){
  if(++budget.entries>100000)throw new Error('Storage entry budget');
  const shared=variable(bytes,p),extra=variable(bytes,p),length=variable(bytes,p);
  if(shared>previous.length||shared+extra>4096||p.i+extra+length>end)throw new Error('Storage entry bounds');
  const key=Buffer.concat([previous.subarray(0,shared),bytes.subarray(p.i,p.i+extra)]);p.i+=extra;
  const value=bytes.subarray(p.i,p.i+length);p.i+=length;visit(key,value);previous=key;
 }
}
function table(bytes,visit,budget){
 if(bytes.length<48||bytes.readBigUInt64LE(bytes.length-8)!==0xdb4775248b80fb57n)throw new Error('Unsupported storage table');
 const p={i:bytes.length-48};variable(bytes,p);variable(bytes,p);const start=p.i;variable(bytes,p);variable(bytes,p);
 entries(block(bytes,bytes.subarray(start,p.i),budget),(_key,handle)=>entries(block(bytes,handle,budget),visit,budget),budget);
}
function decode(bytes){
 if(bytes[0]===0){if((bytes.length-1)%2)throw new Error('Storage string encoding');return bytes.subarray(1).toString('utf16le');}
 if(bytes[0]===1)return bytes.subarray(1).toString('latin1');
 throw new Error('Unsupported storage string encoding');
}
function identity(stat){return [stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');}
function readPlex(directory=DIRECTORY,options={}){
 const latest=new Map(),reads=[],live=new Set(),cache=options.cache||new Map(),used=new Set();
 const budget={read:0,cached:0,retained:0,decoded:0,entries:0};let logNumber=0,previousLog=0;
 function read(name){
  if(!/^(CURRENT|MANIFEST-\d+|\d+\.(ldb|sst|log))$/.test(name))throw new Error('Storage filename rejected');
  const file=path.join(directory,name),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
   const before=fs.fstatSync(fd);
   if(!before.isFile()||before.size>LIMIT||budget.read+before.size>TOTAL)throw new Error('Storage file budget');
   const bytes=Buffer.alloc(before.size+1);let size=0,n;
   while(size<bytes.length&&(n=fs.readSync(fd,bytes,size,bytes.length-size,null))>0)size+=n;
   if(size!==before.size||identity(fs.fstatSync(fd))!==identity(before))throw new Error('Storage changed during read');
   budget.read+=size;reads.push({file,identity:identity(before)});return bytes.subarray(0,size);
  }finally{fs.closeSync(fd);}
 }
 const manifest=read('CURRENT').toString('ascii').trim();
 if(!/^MANIFEST-\d+$/.test(manifest))throw new Error('Unsupported storage manifest');
 journal(read(manifest),bytes=>{
  const p={i:0};while(p.i<bytes.length){
   const tag=variable(bytes,p);
   if(tag===1){if(field(bytes,p).toString()!=='leveldb.BytewiseComparator')throw new Error('Unsupported storage comparator');}
   else if(tag===2)logNumber=variable(bytes,p);
   else if(tag===9)previousLog=variable(bytes,p);
   else if(tag===3||tag===4)variable(bytes,p);
   else if(tag===5){variable(bytes,p);field(bytes,p);}
   else if(tag===6){variable(bytes,p);live.delete(variable(bytes,p));}
   else if(tag===7){variable(bytes,p);live.add(variable(bytes,p));variable(bytes,p);field(bytes,p);field(bytes,p);}
   else throw new Error('Unsupported storage manifest tag');
  }
 });
 function accept(key,value,sequence,type,target=latest){
  if(!key.subarray(0,ORIGIN.length).equals(ORIGIN))return;
  const name=decode(key.subarray(ORIGIN.length));if(!KEYS.has(name))return;
  if(value&&value.length>2*1024*1024)throw new Error('Plex setting size limit');
  const old=target.get(name);
  if(!old||old.sequence<sequence){
   const kept=type===1?value:null;
   if(target!==latest){budget.retained+=(kept?kept.length:0)-(old&&old.value?old.value.length:0);if(budget.retained>4*1024*1024)throw new Error('Plex table cache budget');}
   // Copy only the required Plex values; do not retain unrelated origins' raw tables.
   target.set(name,{sequence,value:kept&&target!==latest?Buffer.from(kept):kept});
  }
 }
 if(live.size>64)throw new Error('Storage table budget');
 for(const id of live){
  const name=String(id).padStart(6,'0')+'.ldb',file=path.join(directory,name),stat=fs.lstatSync(file),stamp=identity(stat);
  if(!stat.isFile())throw new Error('Storage table is not a regular file');
  used.add(name);let saved=cache.get(name);
  if(saved&&saved.identity===stamp){
   budget.read+=stat.size;budget.cached+=stat.size;
   for(const record of saved.records.values())budget.retained+=record.value?record.value.length:0;
   if(budget.read>TOTAL||budget.retained>4*1024*1024)throw new Error('Plex table cache budget');
   reads.push({file,identity:stamp});
  }else{
   const records=new Map(),bytes=read(name);
   table(bytes,(internal,value)=>{
   if(internal.length<8)throw new Error('Storage internal key');
   const trailer=internal.readBigUInt64LE(internal.length-8),type=Number(trailer&255n);
   if(type!==0&&type!==1)throw new Error('Unsupported storage value');
    accept(internal.subarray(0,-8),value,trailer>>8n,type,records);
   },budget);
   saved={identity:reads[reads.length-1].identity,records};cache.set(name,saved);
  }
  for(const [key,record] of saved.records){const previous=latest.get(key);if(!previous||previous.sequence<record.sequence)latest.set(key,record);}
 }
 for(const name of cache.keys())if(!used.has(name))cache.delete(name);
 for(const id of new Set([previousLog,logNumber]))if(id){
  journal(read(String(id).padStart(6,'0')+'.log'),bytes=>{
   if(bytes.length<12)throw new Error('Incomplete storage batch');
   const sequence=bytes.readBigUInt64LE(0),count=bytes.readUInt32LE(8),p={i:12};
   if(count>100000)throw new Error('Storage batch budget');
   for(let i=0;i<count;i++){
    const type=bytes[p.i++];if(type!==0&&type!==1)throw new Error('Unsupported storage batch');
    const key=field(bytes,p),value=type===1?field(bytes,p):null;accept(key,value,sequence+BigInt(i),type);
   }
   if(p.i!==bytes.length)throw new Error('Storage batch trailing bytes');
  });
 }
 for(const item of reads){const stat=fs.lstatSync(item.file);if(!stat.isFile()||identity(stat)!==item.identity)throw new Error('Storage changed during read');}
 const settings=Object.create(null);let total=0;
 for(const [key,record] of latest)if(record.value){total+=record.value.length;if(total>4*1024*1024)throw new Error('Plex settings budget');settings[key]=decode(record.value);}
 return {settings,files:reads,bytesRead:budget.read-budget.cached};
}
function createReader(directory=DIRECTORY){
 const cache=new Map();
 const read=()=>{try{return readPlex(directory,{cache});}catch(error){cache.clear();throw error;}};
 read.clear=()=>cache.clear();return read;
}
module.exports={DIRECTORY,readPlex,createReader,identity,maskedCRC,variable,journal,snappy,entries,table};
