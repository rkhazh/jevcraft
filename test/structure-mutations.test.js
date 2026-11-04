'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
const {installStructureMutationGuard,withBuildMutation,routeMutatesStructure,mutationCells}=require('../src/structure-mutations');
const {SurvivalMovements}=require('../src/movement');
function fixture(){
 const bot=new EventEmitter(),p=new Vec3(5,64,5),air={name:'air',stateId:0,shapes:[],boundingBox:'empty'},stone={name:'stone',stateId:1,shapes:[[0,0,0,1,1,1]],boundingBox:'block'},blocks=new Map([[p.toString(),stone]]),events=[];
 bot.game={dimension:'overworld'};bot.entity={position:new Vec3(.5,64,.5)};bot._client=new EventEmitter();bot.buildRegistry={serialized:'a',all:dimension=>dimension==='overworld'?[{blueprint:{blocks:[p],empty:[new Vec3(6,64,5)]}}]:[]};bot.blockAt=q=>({...blocks.get(q.toString())||air,position:q});
 bot.dig=async block=>{blocks.set(block.position.toString(),air);bot._client.emit('block_change',{location:block.position,type:0});};
 bot.placeBlock=async(ref,face)=>{const dest=ref.position.plus(face),old=bot.blockAt(dest);blocks.set(dest.toString(),stone);bot.emit('blockPlaced',old,bot.blockAt(dest));};bot._placeBlockWithOptions=bot.placeBlock;
 const goal={kind:'build',personaGoalId:'goal',buildId:'build',blueprint:{initialBlocks:{'5,64,5':1}},buildOwned:{}};let valid=true;
 installStructureMutationGuard(bot,{validGoal:g=>valid&&g===goal,record:e=>events.push(e)});
 return {bot,p,blocks,events,goal,task:{check(){}},invalidate:()=>{valid=false}};
}
test('registered structures block native digs and placement even while a build goal is active',async()=>{
 const {bot,p,goal}=fixture();bot._goal=goal;
 await assert.rejects(bot.dig(bot.blockAt(p)),/Registered structure/);
 await assert.rejects(bot.placeBlock(bot.blockAt(p.offset(1,-1,0)),new Vec3(0,1,0)),/Registered structure/);
 await assert.rejects(bot._placeBlockWithOptions(bot.blockAt(p.offset(1,-1,0)),new Vec3(0,1,0)),/Registered structure/);
 assert.equal(SurvivalMovements.prototype.safeToBreak.call({bot},bot.blockAt(p)),false);
 assert.equal(routeMutatesStructure(bot,{toBreak:[p]}),true);assert.equal(routeMutatesStructure(bot,{toPlace:[{x:5,y:63,z:5,dx:0,dy:1,dz:0}]}),true);assert.equal(routeMutatesStructure(bot,{toBreak:[],toPlace:[]}),false);
 await bot.dig(bot.blockAt(new Vec3(100,64,100))); // ordinary unclaimed work survives
});
test('validated operation permits exactly one cell and operation, then disappears; replacement remains protected',async()=>{
 const {bot,p,goal,task,blocks,events,invalidate}=fixture();
 await withBuildMutation(bot,task,goal,p,'dig',async()=>{
  await assert.rejects(bot.placeBlock(bot.blockAt(p.offset(0,-1,0)),new Vec3(0,1,0)),/Registered structure/);
  await assert.rejects(bot.dig(bot.blockAt(p.offset(1,0,0))),/Registered structure/);
  await bot.dig(bot.blockAt(p));
 });
 assert.equal(events.at(-1).observed_change,true);assert.equal(events.at(-1).permission,'validated_build_cell');
 await assert.rejects(bot.dig(bot.blockAt(p)),/Registered structure/);
 await withBuildMutation(bot,task,goal,p,'place',()=>bot.placeBlock(bot.blockAt(p.offset(0,-1,0)),new Vec3(0,1,0)));
 assert.equal(events.at(-1).own_placement_event,true);
 blocks.set(p.toString(),{name:'dirt',stateId:9});
 await assert.rejects(withBuildMutation(bot,task,goal,p,'dig',()=>bot.dig(bot.blockAt(p))),/Registered structure/);
 invalidate();await assert.rejects(withBuildMutation(bot,task,goal,p,'dig',()=>bot.dig(bot.blockAt(p))),/Validated current/);
});
test('a concurrently running task cannot borrow a builder permit; old stance cannot grant one',async()=>{
 const {bot,p,goal,task}=fixture();let release;const held=withBuildMutation(bot,task,goal,p,'dig',()=>new Promise(r=>{release=r}));
 bot._goal={kind:'survive',survival:{stance:{choice:'seal',at:Date.now()}}};
 await assert.rejects(bot.dig(bot.blockAt(p)),/Registered structure/);release();await held;
 await assert.rejects(bot.dig(bot.blockAt(p)),/Registered structure/);
});
test('only actual body-solid intersection permits emergency dig, not standing on a slab',async()=>{
 const {bot,p,blocks,events}=fixture();bot.entity.position=new Vec3(5.5,64.5,5.5);blocks.set(p.toString(),{name:'stone_slab',stateId:2,boundingBox:'block',shapes:[[0,0,0,1,.5,1]]});
 await assert.rejects(bot.dig(bot.blockAt(p)),/Registered structure/);
 blocks.set(p.toString(),{name:'stone',stateId:1,boundingBox:'block',shapes:[[0,0,0,1,1,1]]});await bot.dig(bot.blockAt(p));assert.equal(events.at(-1).permission,'body_intersection_escape');
});
test('paired placement and dig cannot enter protected companion from unregistered anchor',async()=>{
 const {bot,p,blocks}=fixture();bot.heldItem={name:'oak_door'};
 await assert.rejects(bot.placeBlock(bot.blockAt(p.offset(0,-2,0)),new Vec3(0,1,0)),/Registered structure/);
 bot.heldItem={name:'white_bed'};bot.entity.yaw=0;
 await assert.rejects(bot.placeBlock(bot.blockAt(p.offset(0,-1,1)),new Vec3(0,1,0)),/Registered structure/);
 const lower=p.offset(0,-1,0);blocks.set(lower.toString(),{name:'oak_door',stateId:3,getProperties:()=>({half:'lower'})});
 await assert.rejects(bot.dig(bot.blockAt(lower)),/Registered structure/);
 const foot=p.offset(0,0,-1);blocks.set(foot.toString(),{name:'white_bed',stateId:4,getProperties:()=>({part:'foot',facing:'south'})});
 await assert.rejects(bot.dig(bot.blockAt(foot)),/Registered structure/);
});
test('packet dispatch rechecks permit after awaited look and prevents optimistic dig finish on expiry',async()=>{
 const bot=new EventEmitter(),p=new Vec3(5,64,5),packets=[],blocks=new Map();bot._client=new EventEmitter();bot._client.write=(...args)=>packets.push(args);bot.game={dimension:'overworld'};bot.entity={position:new Vec3(.5,64,.5)};
 bot.buildRegistry={all:()=>[{blueprint:{blocks:[p]}}]};bot.blockAt=q=>({name:'air',stateId:0,position:q,...blocks.get(q.toString())});
 let release;bot.placeBlock=async(ref,face)=>{await new Promise(r=>{release=r});bot._client.write('block_place',{location:ref.position,direction:1});};
 let updated=false;bot._updateBlockState=()=>{updated=true};
 bot.dig=async()=>{await new Promise(r=>{release=r});bot._client.write('block_dig',{status:2,location:p});bot._updateBlockState(p,0)};
 const goal={kind:'build',personaGoalId:'goal',blueprint:{initialBlocks:{}},buildOwned:{}};let valid=true;installStructureMutationGuard(bot,{validGoal:g=>valid&&g===goal});const task={check(){}};
 let pending=withBuildMutation(bot,task,goal,p,'place',()=>bot.placeBlock(bot.blockAt(p.offset(0,-1,0)),new Vec3(0,1,0)));valid=false;release();await assert.rejects(pending,/Registered structure/);assert.equal(packets.length,0);
 valid=true;pending=withBuildMutation(bot,task,goal,p,'place',()=>bot.placeBlock(bot.blockAt(p.offset(0,-1,0)),new Vec3(0,1,0)));blocks.set(p.toString(),{name:'diamond_block',stateId:9});release();await assert.rejects(pending,/Registered structure/);assert.equal(packets.length,0);
 blocks.clear();pending=withBuildMutation(bot,task,goal,p,'dig',()=>bot.dig(bot.blockAt(p)));valid=false;release();await assert.rejects(pending,/Registered structure/);assert.equal(packets.length,0);assert.equal(updated,false);
});

test('bed placement footprint follows Mineflayer protocol yaw for every cardinal',()=>{
 const p=new Vec3(5,64,5),bot={heldItem:{name:'white_bed'},entity:{yaw:0}};
 for(const [yaw,dx,dz] of [[0,0,-1],[Math.PI/2,-1,0],[Math.PI,0,1],[-Math.PI/2,1,0]]){bot.entity.yaw=yaw;assert.deepEqual(mutationCells(bot,'place',p),[p,p.offset(dx,0,dz)]);}
});

test('offhand placement is refused rather than guessing the main-hand footprint',async()=>{
 const {bot,p}=fixture();bot.heldItem={name:'stone'};
 await assert.rejects(bot._placeBlockWithOptions(bot.blockAt(p.offset(0,-2,0)),new Vec3(0,1,0),{offhand:true}),/Registered structure/);
});

test('completed chest then move cannot attribute later unscoped terrain work to the cached chest goal',async()=>{
 const {bot,events}=fixture();
 // 205400 replay: craft wrote _goal, move returned before updating it, and
 // idle survival dug natural terrain with that completed craft id cached.
 bot._goal={kind:'craft',personaGoalId:'completed-chest',status:'complete'};
 bot._turn={holder:'survival',phase:'step',since:Date.now()};
 await bot.dig(bot.blockAt(new Vec3(100,64,100)));
 assert.equal(events.at(-1).goal_id,null);
 assert.equal(events.at(-1).controller,'unknown');
 assert.equal(bot._goal.personaGoalId,'completed-chest','native cached goal is preserved');
});

test('survival mutation reports its executing controller separately from interrupted persona intent',async()=>{
 const {withActionScope}=require('../src/action-scope'),{bot,events,goal}=fixture();bot._goal=goal;
 await withActionScope(bot,'work',goal,async()=>{
  await withActionScope(bot,'survival',goal,()=>bot.dig(bot.blockAt(new Vec3(100,64,100))));
  assert.equal(events.at(-1).controller,'survival');assert.equal(events.at(-1).goal_id,null);assert.equal(events.at(-1).interrupted_goal_id,'goal');
  await bot.dig(bot.blockAt(new Vec3(101,64,100)));
  assert.equal(events.at(-1).controller,'work');assert.equal(events.at(-1).goal_id,'goal');assert.equal(events.at(-1).interrupted_goal_id,null);
 });
});

test('closed action scopes and other bots cannot lend their task identity to later callbacks',async()=>{
 const {withActionScope}=require('../src/action-scope'),{bot,events,goal}=fixture();let detached,release;
 await withActionScope(bot,'work',goal,async()=>{
  detached=new Promise(r=>{release=r}).then(()=>bot.dig(bot.blockAt(new Vec3(100,64,100))));
 });
 await withActionScope(bot,'work',{personaGoalId:'new-goal'},async()=>{release();await detached;});
 assert.equal(events.at(-1).goal_id,null);assert.equal(events.at(-1).controller,'unknown');
 await withActionScope({},'work',goal,()=>bot.dig(bot.blockAt(new Vec3(101,64,100))));
 assert.equal(events.at(-1).goal_id,null);
});

test('actual dispatch keeps its async owner across aiming and drops a finished detached owner',async()=>{
 const {withActionScope}=require('../src/action-scope'),bot=new EventEmitter(),events=[],packets=[],p=new Vec3(10,64,10);
 bot._client=new EventEmitter();bot._client.write=(...args)=>packets.push(args);bot.game={dimension:'overworld'};bot.entity={position:new Vec3(0,64,0)};
 bot.blockAt=q=>({position:q,name:'stone',stateId:1});let release;
 bot.dig=async block=>{await new Promise(r=>{release=r});bot._client.write('block_dig',{status:0,location:block.position});};
 installStructureMutationGuard(bot,{record:e=>events.push(e)});
 const goal={personaGoalId:'original'},other={personaGoalId:'new'},pending=withActionScope(bot,'work',goal,()=>bot.dig(bot.blockAt(p)));
 await withActionScope(bot,'survival',other,async()=>{bot._goal=other;release();await pending;});
 assert.equal(events.at(-1).controller,'work');assert.equal(events.at(-1).goal_id,'original');
 let detached;await withActionScope(bot,'work',goal,async()=>{detached=bot.dig(bot.blockAt(p));});
 await withActionScope(bot,'work',other,async()=>{release();await detached;});
 assert.equal(events.at(-1).controller,'unknown');assert.equal(events.at(-1).goal_id,null);assert.equal(packets.length,2);
});
