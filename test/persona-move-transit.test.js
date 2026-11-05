'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
const registry=require('minecraft-data')('1.21.11'),Block=require('prismarine-block')('1.21.11');
const {SurvivalMovements}=require('../src/movement'),{moveStep}=require('../src/persona-move');
const Move=require('mineflayer-pathfinder/lib/move');
function fixture(){
 const bot=new EventEmitter(),cells=new Map(),packets=[];
 Object.assign(bot,{username:'actor',registry,version:'1.21.11',game:{dimension:'overworld',gameMode:'survival'},entity:{position:new Vec3(.5,64,.5),yaw:0,height:1.8},entities:{},health:20,food:20,oxygenLevel:20,inventory:{items:()=>[],slots:Array(45)},heldItem:null});
 bot._client=new EventEmitter();bot._client.write=(...packet)=>packets.push(packet);bot.setQuickBarSlot=()=>{bot.heldItem=null};
 bot.blockAt=p=>{const q=p.floored(),record=cells.get(q.toString());if(record===null)return null;const [name,properties]=record||[q.y<64?'stone':'air',{}],block=Block.fromProperties(registry.blocksByName[name].id,properties,0);block.position=q;return block;};
 const set=(x,y,z,name,properties={})=>cells.set(new Vec3(x,y,z).toString(),name===null?null:[name,properties]);
 bot.clearControlStates=()=>{};bot.lookAt=async()=>{};
 bot.activateBlock=async block=>{bot._client.write('block_place',{location:block.position,direction:1,hand:0});const p=block.position;for(const dy of [0,1])set(p.x,p.y+dy,p.z,block.name,{...block.getProperties(),half:dy?'upper':'lower',open:true});};
 const original=new SurvivalMovements(bot);Object.assign(original,{canDig:true,allow1by1towers:true,allowParkour:true,scafoldingBlocks:[1]});
 bot.pathfinder={movements:original,goal:null,setMovements(m){this.movements=m},setGoal(g){this.goal=g},goto:async()=>assert.fail('test must exercise the route')};
 const goal={kind:'move',target:{x:4.5,y:64,z:.5},personaMovePolicy:{anchor:{x:.5,y:64,z:.5},dimension:'overworld'}};
 return {bot,set,packets,goal,original,node:new Move(0,64,0,0)};
}
for(const [name,properties]of [['stone_brick_stairs',{facing:'east',half:'bottom',shape:'straight',waterlogged:false}],['stone_slab',{type:'bottom',waterlogged:false}]])test(`local transit retains native collision-aware ${name} neighbor`,async()=>{
 const f=fixture();f.set(1,64,0,name,properties);
 const native=[];Object.assign(f.original,{canDig:false,allow1by1towers:false,scafoldingBlocks:[]});f.original.getMoveJumpUp(f.node,{x:1,z:0},native);
 assert.ok(native.some(n=>n.x===1&&n.y===65&&n.z===0&&!n.toBreak.length&&!n.toPlace.length),'real native method offers this no-edit transit');
 f.bot.pathfinder.goto=async()=>{assert.ok(f.bot.pathfinder.movements.getNeighbors(f.node).some(n=>n.x===1&&n.y===65&&n.z===0),'persona must retain native transit geometry');f.bot.entity.position=new Vec3(4.5,64,.5);};
 assert.equal(await moveStep(f.bot,{check(){}},f.goal,()=>{}),true);assert.equal(f.bot.pathfinder.movements,f.original);assert.equal(f.packets.length,0);
});
for(const open of [true,false])test(`local transit uses the native ${open?'open':'closed'} doorway contract`,async()=>{
 const f=fixture();for(const y of [64,65])f.set(0,y,1,'oak_door',{facing:'north',half:y===64?'lower':'upper',hinge:'left',open,powered:false});
 const authority=require('../src/mutation-authority');authority.installMutationAuthority(f.bot,{policy:authority.validateMutationAuthority({version:1,world_id:'test',principal:'actor',temporary_empty_placement:false,grants:[]},{worldId:'test',principal:'actor'}),worldId:'test',principal:'actor',world:{known:{},store:{save(){}}}});
 require('../src/structure-mutations').installStructureMutationGuard(f.bot);
 f.bot.pathfinder.goto=async g=>{
  f.bot.pathfinder.goal=g;
  const door=f.bot.pathfinder.movements.getNeighbors(f.node).find(n=>n.x===0&&n.y===64&&n.z===1);assert.ok(door,'native doorway survives persona transit filtering');
  assert.equal(door.toBreak.length,0);assert.equal(door.toPlace.length,open?0:1);if(!open)assert.equal(door.toPlace[0].useOne,true);
  const route={path:[{...door,x:.5,y:65,z:1.5}]};f.bot.emit('path_update',route);assert.deepEqual([route.path[0].x,route.path[0].y,route.path[0].z],[.5,64,1.5],'existing door guard restores floor waypoint');
  if(!open){f.bot.heldItem={name:'stone_pickaxe'};await f.bot.activateBlock(f.bot.blockAt(new Vec3(0,64,1)));assert.equal(f.bot.heldItem,null);assert.equal(f.bot.blockAt(new Vec3(0,64,1)).getProperties().open,true);}
  assert.equal(authority.queryMutation(f.bot,'place',new Vec3(0,64,1)).allowed,false,'door interaction grants no block placement permission');
  f.bot.entity.position=new Vec3(4.5,64,.5);
 };
 assert.equal(await moveStep(f.bot,{check(){}},f.goal,()=>{}),true);assert.equal(f.packets.length,open?0:1);assert.equal(f.bot.listenerCount('path_update'),0);
});
test('an interrupted door approach restores the original interaction hook and sends no click',async()=>{
 const f=fixture();for(const y of [64,65])f.set(0,y,1,'oak_door',{facing:'north',half:y===64?'lower':'upper',hinge:'left',open:false,powered:false});
 const activate=f.bot.activateBlock;f.bot.lookAt=async()=>{throw Object.assign(new Error('cancelled while aiming'),{name:'Cancelled'});};
 f.bot.pathfinder.goto=async g=>{f.bot.pathfinder.goal=g;await f.bot.activateBlock(f.bot.blockAt(new Vec3(0,64,1)));};
 await assert.rejects(moveStep(f.bot,{check(){}},f.goal,()=>{}),{name:'Cancelled'});
 assert.equal(f.bot.activateBlock,activate);assert.equal(f.bot.listenerCount('path_update'),0);assert.equal(f.bot.pathfinder.movements,f.original);assert.equal(f.packets.length,0);
});
test('door failure propagates when the pathfinder swallows activation errors and leaves its goal pending',async()=>{
 const f=fixture();for(const y of [64,65])f.set(0,y,1,'oak_door',{facing:'north',half:y===64?'lower':'upper',hinge:'left',open:false,powered:false});
 const activate=f.bot.activateBlock;f.bot.lookAt=async()=>{throw new Error('door approach failed');};
 f.bot.pathfinder.goto=async g=>{f.bot.pathfinder.goal=g;try{await f.bot.activateBlock(f.bot.blockAt(new Vec3(0,64,1)));}catch(_){}return new Promise(()=>{});};
 await assert.rejects(moveStep(f.bot,{check(){}},f.goal,()=>{},{timeoutMs:100,checkIntervalMs:1}),{name:'Blocked',message:'door approach failed'});
 assert.equal(f.bot.activateBlock,activate);assert.equal(f.bot.listenerCount('path_update'),0);assert.equal(f.bot.pathfinder.movements,f.original);assert.equal(f.bot.pathfinder.goal,null);assert.equal(f.packets.length,0);
});
test('local transit still refuses actual edits, hazards, unloaded cells and excursions beyond the admitted bounds',async()=>{
 const f=fixture(),nodes=[
  {x:1,y:64,z:0,toBreak:[new Vec3(1,64,0)],toPlace:[]},
  {x:2,y:64,z:0,toBreak:[],toPlace:[{x:2,y:63,z:0,dy:1}]},
  {x:3,y:64,z:0,toBreak:[],toPlace:[]},
  {x:0,y:64,z:2,toBreak:[],toPlace:[]},
  {x:30,y:64,z:0,toBreak:[],toPlace:[]},
 ];
 f.original.getNeighbors=()=>nodes;f.set(3,64,0,'water');f.set(0,64,2,null);
 f.bot.pathfinder.goto=async()=>{assert.deepEqual(f.bot.pathfinder.movements.getNeighbors(f.node),[]);f.bot.entity.position=new Vec3(4.5,64,.5);};
 assert.equal(await moveStep(f.bot,{check(){}},f.goal,()=>{}),true);
 for(const [name,y]of [['lava',64],['fire',64],['stone',65],['magma_block',63]]){
  const g=fixture();g.set(4,y,0,name);await assert.rejects(moveStep(g.bot,{check(){}},g.goal,()=>{}),/target is no longer safe/);
 }
});
