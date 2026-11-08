'use strict';
// Private worker only. Automatic mode never falls back to a saved/manual token.
const fs=require('node:fs');
const crypto=require('node:crypto');
const {createReader,identity}=require('./native-plex-storage.cjs');
const {serverOrigin,configuration:privateConfiguration}=require('./native-feed-plex.cjs');
const SERVER=/^[A-Za-z0-9_-]{8,128}$/;
function configuration(value){
 if(value.plex_auto===undefined||value.plex_auto===false)return null;
 if(value.plex_auto!==true||typeof value.plex_server_id!=='string'||!SERVER.test(value.plex_server_id))throw new Error('Automatic Plex needs an approved server identity');
 return {...serverOrigin(value.plex_url),serverId:value.plex_server_id};
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
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(active)||!/^[A-Za-z0-9._~-]{8,4096}$/.test(accountToken))return {state:'unavailable'};
 const users=object(settings.OfflineUsersData),servers=object(settings.OfflineServersData),links=object(settings.OfflineUserServersData);
 if(!users||!servers||!links)return {state:'unavailable'};
 const selected=Object.entries(users).filter(([key,user])=>user&&typeof user==='object'&&!Array.isArray(user)&&
  (key===active||user.uuid===active)&&(user.uuid===undefined||user.uuid===active)&&user.authToken===accountToken);
 if(selected.length!==1)return {state:'unavailable'};
 const targets=Object.entries(servers).filter(([key,server])=>server&&typeof server==='object'&&!Array.isArray(server)&&
  (key===binding.serverId||server.id===binding.serverId||server.identifier===binding.serverId)&&
  (server.id===undefined||server.id===binding.serverId)&&(server.identifier===undefined||server.identifier===binding.serverId));
 if(targets.length===0)return {state:'no-access'};
 if(targets.length!==1)return {state:'unavailable'};
 const [serverKey,server]=targets[0],tokens=new Set();
 for(const userKey of new Set([active,selected[0][0],selected[0][1].uuid])){
  const userLinks=own(links,userKey);if(!userLinks||Array.isArray(userLinks))continue;
  for(const key of new Set([serverKey,server.id,server.identifier])){
   const link=own(userLinks,key);if(link&&typeof link.token==='string')tokens.add(link.token);
  }
 }
 if(tokens.size===0)return {state:'no-access'};
 if(tokens.size!==1)return {state:'unavailable'};
 try{
  const credentials={...privateConfiguration({plex_url:binding.origin,plex_token:[...tokens][0]}),serverId:binding.serverId};
  // This fingerprint stays private; never include it or account identifiers in snapshots.
  const signature=crypto.createHash('sha256').update(JSON.stringify([active,credentials.origin,credentials.serverId,credentials.token])).digest('hex');
  return {state:'ready',credentials,signature};
 }catch{return {state:'unavailable'};}
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
