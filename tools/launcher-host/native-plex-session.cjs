'use strict';
// Private worker only. Automatic mode never falls back to a saved/manual token.
const fs=require('node:fs');
const crypto=require('node:crypto');
const {createReader,identity}=require('./native-plex-storage.cjs');
const {serverOrigin,TOKEN}=require('./native-feed-plex.cjs');
const SERVER=/^[A-Za-z0-9_-]{8,128}$/;
function configuration(value){
 if(value.plex_auto===undefined||value.plex_auto===false)return null;
 if(value.plex_auto!==true)throw new Error('Invalid automatic Plex configuration');
 return {};
}
function scalar(value){
 if(typeof value!=='string'||!value||value==='null')return null;
 if(value[0]==='"'){try{const parsed=JSON.parse(value);return typeof parsed==='string'?parsed:null;}catch{return null;}}
 return value;
}
function object(value){
 if(typeof value!=='string')return null;
 try{const parsed=JSON.parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;}catch{return null;}
}
function own(value,key){return value&&typeof value==='object'&&typeof key==='string'&&Object.hasOwn(value,key)?value[key]:undefined;}
function select(settings,binding){
 const accountToken=scalar(settings.PlexAuthToken),active=scalar(settings.LastActiveUserUuid);
 if(!accountToken||!active)return {state:'signed-out'};
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(active)||!TOKEN.test(accountToken))return {state:'unavailable'};
 const users=object(settings.OfflineUsersData),servers=object(settings.OfflineServersData),links=object(settings.OfflineUserServersData);
 if(!users||!servers||!links)return {state:'unavailable'};
 const selected=Object.entries(users).filter(([key,user])=>user&&typeof user==='object'&&!Array.isArray(user)&&
  (key===active||user.uuid===active)&&(user.uuid===undefined||user.uuid===active)&&user.authToken===accountToken);
 if(selected.length!==1)return {state:'unavailable'};
 const userKeys=new Set([active,selected[0][0],selected[0][1].uuid]);
 const targets=Object.entries(servers).filter(([key,server])=>server&&typeof server==='object'&&!Array.isArray(server)&&
  SERVER.test(key)&&(server.type===undefined||server.type==='pms')&&
  (server.id===undefined||server.id===key)&&(server.identifier===undefined||server.identifier===key)&&
  [...userKeys].some(userKey=>typeof own(own(links,userKey),key)?.token==='string'));
 if(targets.length===0)return {state:'no-access'};
 if(targets.length>64)return {state:'unavailable'};
 const accessible=[];
 for(const [serverKey,server] of targets.sort(([a],[b])=>a.localeCompare(b))){
 const tokens=new Set();
 for(const userKey of userKeys){
  const userLinks=own(links,userKey);if(!userLinks||Array.isArray(userLinks))continue;
  for(const key of new Set([serverKey,server.id,server.identifier])){
   const link=own(userLinks,key);if(link&&typeof link.token==='string')tokens.add(link.token);
  }
 }
 if(tokens.size!==1)continue;
 try{
  if(!Array.isArray(server.connections)||server.connections.length>32)continue;
  const origins=[];
  for(const connection of server.connections){
   if(!connection||connection.isRelay)continue;
   try{const {origin}=serverOrigin(connection.uri);if(!origins.includes(origin))origins.push(origin);}catch{/* Not a canonical secure Plex connection. */}
  }
  if(!origins.length||origins.length>8)continue;
  const token=[...tokens][0];if(!TOKEN.test(token))continue;
  accessible.push({origins,token,serverId:serverKey});
 }catch{/* One malformed server must not hide another accessible library. */}
 }
 if(!accessible.length)return {state:'unavailable'};
 const credentials={servers:accessible};
 // Membership and token changes revoke the entire previous account generation.
 const signature=crypto.createHash('sha256').update(JSON.stringify([active,accessible])).digest('hex');
 return {state:'ready',credentials,signature};
}
function createSession(binding,options={}){
 const read=options.read||createReader(options.directory),stat=options.stat||fs.lstatSync;
 let stopped=false,cached=null,files=[];
 return {
  read(){
   if(stopped)return {state:'disabled'};
   try{
    if(cached&&files.length&&files.every(item=>{const value=stat(item.file);return value.isFile()&&identity(value)===item.identity;}))return cached;
    // Re-read on any manifest/WAL change. A torn read clears, never retains, the old account.
    cached=null;files=[];
    const result=read();cached=select(result.settings,binding);files=result.files||[];
    return cached;
   }catch{cached=null;files=[];if(read.clear)read.clear();return {state:'unavailable'};}
  },
  stop(){stopped=true;cached=null;files=[];if(read.clear)read.clear();}
 };
}
module.exports={configuration,select,createSession};
