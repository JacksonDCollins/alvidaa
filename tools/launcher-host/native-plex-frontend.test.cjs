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
 {id:-2,kind:'movie',title:'Personal movie',app:'plex',source:'plex',detailed:true,minutes:95,genre:'Drama',poster:'/plex-fixture.jpg',plexTitle:{providerId:'fixture-server',ratingKey:'2'}},
 {id:-3,kind:'tv',title:'Personal show',app:'plex',source:'plex',detailed:true,seasons:3,genre:'Drama'}];
test('actual web data retains the original TMDB requirement and personal-card metadata',()=>{
 const s=frontend();s.Data.nativeSnapshot({'fmtv.recs':JSON.stringify({picks})},'',false);
 assert.equal(s.Data.hasKey(),false);assert.equal(s.Data.picks(null).length,0);assert.equal(s.Data.showcase().length,0);
 s.Data.nativeSnapshot({'fmtv.recs':JSON.stringify({picks})},'',true);
 const movie=Array.from(s.Data.picks('movie')).find(p=>p.source==='plex');
 assert.equal(movie.plexTitle.ratingKey,'2');assert.equal(movie.poster,'/plex-fixture.jpg');
 assert.equal(s.Data.appFor('plex').id,'app:7');
 assert.deepEqual(Array.from(s.Data.picks('tv'),x=>x.id),[-3]);
 assert.equal(Array.from(s.Data.picks(null)).filter(p=>p.source==='plex').length,1);
 assert.equal(Array.from(s.Data.showcase()).filter(p=>p.source==='plex').length,2);
 assert.match(movie.meta,/1h 35m.*Plex/);
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
