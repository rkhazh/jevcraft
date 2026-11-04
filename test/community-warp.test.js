'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
const {warpToAi}=require('../src/community-warp');
function bot(){const b=new EventEmitter();b.entity={position:new Vec3(0,70,0)};b.isAlive=true;b.game={gameMode:'survival'};return b;}
test('one fixed warp waits for server position displacement and fresh chunks',async()=>{
 const b=bot(),sent=[];let checked=false;
 const pending=warpToAi(b,c=>sent.push(c),{waitChunks:async()=>{checked=true;assert.equal(b.entity.position.x,100)}});
 assert.deepEqual(sent,['/warp ai']);assert.equal(checked,false);
 b.emit('forcedMove');assert.equal(checked,false);
 b.entity.position=new Vec3(100,70,0);b.emit('forcedMove');await pending;assert.equal(checked,true);assert.equal(b.listenerCount('forcedMove'),0);
});
test('warp fails closed on no teleport, unloaded chunks, disconnected and non-Survival',async()=>{
 const b=bot();await assert.rejects(warpToAi(b,()=>{}, {timeoutMs:1}),/not observed/);
 await assert.rejects(warpToAi(b,()=>b.emit('end')),/Connection ended/);
 await assert.rejects(warpToAi(b,()=>{b.entity.position.x+=100;b.emit('forcedMove')},{waitChunks:async()=>{throw new Error('unloaded')}}),/unloaded/);
 b.game.gameMode='adventure';await assert.rejects(warpToAi(b,()=>assert.fail('sent')),/Survival/);
});
