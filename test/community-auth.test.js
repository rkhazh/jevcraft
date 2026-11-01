'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {communityAuth}=require('../src/community-auth');
const config={host:'mc.agicraft.ru',port:25565};
function bot(){let b=new EventEmitter();b.sent=[];b.chat=x=>b.sent.push(x);b.quit=x=>{b.reason=x;b.emit('end')};return b}
test('login only once for system prompt; player spoof cannot unlock',async()=>{const b=bot(),g=communityAuth(b,config,{password:'secret',successText:'auth ok'});assert.equal(b.physicsEnabled,false);b.emit('messagestr','/login password','chat',{},'player');b.emit('messagestr','auth ok','system',{},'player');assert.equal(g.authenticated,false);assert.equal(b.sent.length,0);b.emit('messagestr','/login password','system',{},null);b.emit('messagestr','/login password','system',{},null);assert.deepEqual(b.sent,['/login secret']);b.emit('messagestr','auth ok','system',{},null);await g.ready;assert.equal(g.authenticated,true);assert.equal(b.physicsEnabled,false);b.emit('end')});
test('challenge requires manual intervention and never sends registration',async()=>{const b=bot(),g=communityAuth(b,config,{password:'secret',successText:'ok'});b.emit('messagestr','/register password password','system',{},null);await assert.rejects(g.ready);assert.equal(b.sent.length,0)});
test('wrong host is rejected before credentials can be sent',()=>assert.throws(()=>communityAuth(bot(),{host:'elsewhere',port:25565},{password:'secret',successText:'ok'})));
