'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {buildProgram,dataSource,readSources}=require('./native-web-program.cjs');
function frontend(){
 const sources=readSources(),compiled=buildProgram().source;
 const start=compiled.indexOf('    nativeSnapshot: function'),end=compiled.indexOf('    COINS: COINS,',start);
 assert.ok(start>0&&end>start);
 const data=dataSource(sources['data.js']).replace('    COINS: COINS,',compiled.slice(start,end)+'    COINS: COINS,');
 const scope={window:{CONFIG:{tmdbKey:''}},document:{documentElement:{}},navigator:{language:'en-AU'},TV:{zone:()=> 'Australia/Brisbane'},
  localStorage:{getItem:()=>null,setItem(){}},setTimeout:()=>0,clearTimeout(){},XMLHttpRequest:function(){throw Error('Browser network forbidden');}};
 vm.createContext(scope);new vm.Script([sources['i18n.js'],sources['strings.js'],sources['zones.js'],'window.ZONES=ZONES;',data].join('\n')).runInContext(scope);
 scope.I18N.set('en');scope.Data.setApps([{id:'app:7',title:'Plex'},{id:'app:8',title:'Netflix'}]);return scope;
}
const picks=[{id:1,kind:'movie',title:'Public movie',app:'netflix',detailed:true},
 {id:-2,kind:'movie',title:'Personal movie',app:'plex',source:'plex',detailed:true,minutes:95,genre:'Drama'},
 {id:-3,kind:'tv',title:'Personal show',app:'plex',source:'plex',detailed:true,seasons:3,genre:'Drama'}];
test('actual web data adapter shows Plex-only picks without pretending TMDB is configured',()=>{
 const s=frontend();s.Data.nativeSnapshot({'fmtv.recs':JSON.stringify({picks})},'',false);
 assert.equal(s.Data.hasKey(),false);assert.equal(s.Data.appFor('plex').id,'app:7');
 assert.deepEqual(Array.from(s.Data.picks('movie'),x=>x.id),[-2]);assert.deepEqual(Array.from(s.Data.picks('tv'),x=>x.id),[-3]);
 assert.equal(s.Data.picks(null).length,1,'one Plex pick per tab');
 assert.equal(s.Data.showcase().length,2,'both kinds are available to the screensaver');
 assert.match(s.Data.picks('movie')[0].meta,/1h 35m.*Plex/);
 assert.ok(s.Data.picks('tv')[0].meta.includes(s.tr('Series')));
 s.Data.setApps([{id:'app:7',title:'Plexiglass'}]);assert.equal(s.Data.appFor('plex'),null);assert.equal(s.Data.picks(null).length,0);
});
test('Plex blends with public picks, localizes metadata and disappears when disconnected',()=>{
 const s=frontend();s.I18N.set('pt-BR');s.Data.nativeSnapshot({'fmtv.recs':JSON.stringify({picks})},'',true);
 const both=Array.from(s.Data.picks(null));assert.equal(both.filter(x=>x.source==='plex').length,1);assert.ok(both.some(x=>x.app==='netflix'));
 assert.ok(s.Data.picks('tv')[0].meta.includes(s.tr('Series')));
 s.Data.nativeSnapshot({'fmtv.recs':JSON.stringify({picks:[picks[0]]})},'',true);
 assert.ok(s.Data.showcase().every(x=>x.source!=='plex'));
});
