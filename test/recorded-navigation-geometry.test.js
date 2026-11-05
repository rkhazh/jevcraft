'use strict';
// Normalized, record-derived geometry regression. No live calls; no proposed
// navigation bypass. The snapshot's stair+railing state IDs are reproduced at
// the origin to distinguish a clear stair from one whose body cell is occupied.
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
// Recorded snapshot: 20261105T023338.505434Z/navigation.json, SHA256
// 1faddf1835bc448d57a8c8bc08d1067b01df95f014559b7965be0a19c0a8f151.
// Source version: df911c1 plus the recorded movement-builder extraction.
// This normalized fixture isolates one observed constraint; it does not prove
// global unreachability or replay the original server world.
const req=p=>p.startsWith('src/')?require('../'+p):require(p.replace(/^node_modules\//,''));
const registry=req('node_modules/minecraft-data')('1.21.11'),Block=req('node_modules/prismarine-block')('1.21.11'),{Vec3}=req('node_modules/vec3'),Move=req('node_modules/mineflayer-pathfinder/lib/move');
const {SurvivalMovements}=req('src/movement'),{localMovements,canMove}=req('src/persona-move');
function scene(cap){
 const bot=new EventEmitter();Object.assign(bot,{registry,entity:{position:new Vec3(.5,64,.5),height:1.8,effects:{}},game:{dimension:'overworld',gameMode:'survival',minY:-64},health:20,food:20,entities:{},inventory:{items:()=>[]}});
 bot.blockAt=p=>{const q=p.floored(),id=q.y<64?registry.blocksByName.stone.defaultState:q.x===1&&q.y===64&&q.z===0?8608:cap&&q.x===1&&q.y===65&&q.z===0?7787:0,b=Block.fromStateId(id,0);b.position=q;return b;};
 const native=new SurvivalMovements(bot);Object.assign(native,{canDig:false,allow1by1towers:false,scafoldingBlocks:[],allowParkour:false,maxDropDown:3});bot.pathfinder={movements:native};
 return {bot,native,persona:localMovements(bot,{anchor:bot.entity.position}),node:new Move(0,64,0,0)};
}
test('recorded railing above a stair blocks native transit before persona filtering',()=>{
 const blocked=scene(true),clear=scene(false),direction={x:1,z:0};
 assert.equal(blocked.bot.blockAt(new Vec3(1,64,0)).name,'stone_brick_stairs');assert.equal(blocked.bot.blockAt(new Vec3(1,65,0)).name,'iron_bars');
 for(const movement of [blocked.native,blocked.persona]){const candidates=[];movement.getMoveJumpUp(blocked.node,direction,candidates);assert.deepEqual(candidates,[]);}
 for(const movement of [clear.native,clear.persona]){const candidates=[];movement.getMoveJumpUp(clear.node,direction,candidates);assert.ok(candidates.some(n=>n.x===1&&n.y===65&&n.z===0&&!n.toBreak.length&&!n.toPlace.length));}
 // Loaded supported destination admission never promised a connecting route.
 assert.equal(canMove(blocked.bot,{x:1.5,y:66,z:.5},{enabled:true,anchor:blocked.bot.entity.position}),true);
 assert.ok(blocked.persona.getNeighbors(blocked.node).every(n=>n.y<65));
});
