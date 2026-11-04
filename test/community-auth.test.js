'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {communityAuth}=require('../src/community-auth');
const config={host:'mc.agicraft.ru',port:25565};
function bot(){let b=new EventEmitter();b.sent=[];b.chat=x=>b.sent.push(x);b.quit=x=>{b.reason=x;b.emit('end')};return b}
test('login only once for system prompt; player spoof cannot unlock',async()=>{const b=bot(),g=communityAuth(b,config,{password:'secret',successText:'auth ok'});assert.equal(b.physicsEnabled,false);b.emit('messagestr','/login password','chat',{},'player');b.emit('messagestr','auth ok','system',{},'player');assert.equal(g.authenticated,false);assert.equal(b.sent.length,0);b.emit('messagestr','/login password','system',{},null);b.emit('messagestr','/login password','system',{},null);assert.deepEqual(b.sent,['/login secret']);b.emit('messagestr','auth ok','system',{},null);b.emit('messagestr','SkipperJev joined the game','system',{},null);await g.ready;assert.equal(g.authenticated,true);assert.equal(b.physicsEnabled,false);b.emit('end')});
test('challenge requires manual intervention and never sends registration',async()=>{const b=bot(),g=communityAuth(b,config,{password:'secret',successText:'ok'});b.emit('messagestr','/register password password','system',{},null);await assert.rejects(g.ready);assert.equal(b.sent.length,0)});
test('wrong host is rejected before credentials can be sent',()=>assert.throws(()=>communityAuth(bot(),{host:'elsewhere',port:25565},{password:'secret',successText:'ok'})));

test('cached login requires trusted self join and actual Survival game mode',async()=>{const b=bot(),g=communityAuth(b,config,{password:'secret'});b.emit('messagestr','Вы в лобби. Выберите сервер /server имя','system',{},null);assert.equal(g.authenticated,false);b.emit('messagestr','SkipperJev joined the game','chat',{},'player');assert.equal(g.authenticated,false);b.emit('messagestr','SkipperJev joined the game','system',{},null);await g.ready;assert.throws(()=>g.assertGameplay());b.game={gameMode:'adventure'};assert.throws(()=>g.assertGameplay());b.game.gameMode='survival';g.assertGameplay();assert.equal(b.sent.length,0);b.emit('end')});
test('explicit registration sends once only for trusted server and still waits for own join',async()=>{
 const b=bot(),g=communityAuth(b,{...config,username:'TolikScheben'},{password:'secret',allowRegister:true});b.emit('messagestr','/reg password password','chat',{},'player');assert.equal(b.sent.length,0);b.emit('messagestr','/reg password password','system',{},null);b.emit('messagestr','/register password password','system',{},null);assert.deepEqual(b.sent,['/reg secret secret']);assert.equal(g.authenticated,false);b.emit('messagestr','SkipperJev joined the game','system',{},null);assert.equal(g.authenticated,false);b.emit('messagestr','TolikScheben joined the game','system',{},null);await g.ready;b.emit('end');
});
test('registration opt-in never bypasses CAPTCHA',async()=>{const b=bot(),g=communityAuth(b,config,{password:'secret',allowRegister:true});b.emit('messagestr','CAPTCHA /reg password password','system',{},null);await assert.rejects(g.ready);assert.equal(b.sent.length,0)});
test('real Mineflayer plugin injection captures auth sender before real command guard',async()=>{
 const b=new EventEmitter();b.sent=[];b.quit=()=>b.emit('end');b.players={};
 require('mineflayer/lib/plugin_loader')(b,{});
 b.loadPlugin(()=>{b.chat=text=>b.sent.push(text)});
 const g=communityAuth(b,{...config,username:'TolikScheben'},{password:'secret',allowRegister:true});
 let commands;b.loadPlugin(()=>{commands=require('../src/commands').createCommandAccess(b,{users:[]})});
 b.emit('inject_allowed');
 assert.throws(()=>b.chat('/op anyone'),/fresh explicit/);assert.throws(()=>b.chat('/reg guessed guessed'),/fresh explicit/);
 b.emit('messagestr','/reg password password','system',{},null);b.emit('messagestr','/login password','system',{},null);assert.deepEqual(b.sent,['/reg secret secret','/login secret']);
 assert.throws(()=>b.chat('/login secret'),/fresh explicit/);assert.ok(!('send' in commands));assert.ok(!('sendAuth' in g));
 b.emit('messagestr','TolikScheben joined the game','system',{},null);await g.ready;b.emit('messagestr','/login password','system',{},null);assert.equal(b.sent.length,2);b.emit('end');
});
test('authentication diagnostics are trusted, bounded and redact secrets/command arguments',async()=>{
 const b=bot(),events=[],g=communityAuth(b,config,{password:'secret',allowRegister:true,diagnostic:e=>events.push(e)});
 b.emit('messagestr','private player text','chat',{},'player');assert.equal(events.length,0);
 b.emit('messagestr','password secret /reg secret secret','system',{},null);
 assert.ok(!JSON.stringify(events).includes('secret'));assert.ok(!JSON.stringify(events).includes('/reg'));assert.ok(events.some(e=>e.event==='registration_sent'));
 for(let i=0;i<30;i++)b.emit('messagestr','x'.repeat(1000),'system',{},null);assert.equal(events.length,12);assert.ok(events.every(e=>!e.text||e.text.length<=240));b.emit('end');await assert.rejects(g.ready);
});
