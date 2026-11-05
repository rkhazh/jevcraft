'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{Vec3}=require('vec3');
const {fixture,grant}=require('./mutation-authority.test');
const authority=require('../src/mutation-authority');
const {routeMutatesStructure}=require('../src/structure-mutations');
const plain=p=>({x:p.x,y:p.y,z:p.z});
function project(f,{id='project',blocks=[],empty=[plain(f.p)],ack=true}={}){
 const entry={id,from:'persona:actor',dimension:'overworld',status:'unfinished',blueprint:{blocks,empty}};
 if(ack){const write=f.bot._client.write;f.bot._client.write=function(name,packet){const result=write.call(this,name,packet);if(name==='block_dig'&&packet.status===2)f.bot._client.emit('block_change',{location:packet.location,type:0});return result;};}
 const entries=[entry];f.bot.buildRegistry={all:()=>entries,find:id=>entries.find(e=>e.id===id)};return {entry,entries};
}
test('project desired air admits temporary use through the same candidate, route and packet verdict',async()=>{
 const p=new Vec3(8,64,8),f=fixture({grants:[grant(p,{project_id:'project'})]});project(f);
 assert.equal(authority.queryMutation(f.bot,'place',p).allowed,true);
 assert.equal(routeMutatesStructure(f.bot,{toPlace:[plain(p)]}),false);
 await f.bot.placeBlock(f.bot.blockAt(p.offset(0,-1,0)),new Vec3(0,1,0));
 assert.deepEqual(authority.confirmedPlacement(f.bot,p).restore,{project_id:'project',expected:'air'});
 assert.equal(authority.queryMutation(f.bot,'dig',p).allowed,true);
 await f.bot.dig(f.bot.blockAt(p));assert.equal(authority.pendingRestorations(f.bot).length,0);
});
test('ordinary empty permission and unrelated grants cannot bypass another project or solid reservation',async()=>{
 for(const type of ['unscoped','other','solid','overlap']){
  const p=new Vec3(8,64,8),f=fixture({grants:[grant(p,type==='unscoped'?{}:{project_id:type==='other'?'other':'project'})]}),{entries}=project(f,type==='solid'?{blocks:[{...plain(p),material:'oak_planks'}],empty:[]}:{});
  if(type==='overlap')entries.push({id:'neighbor',from:'someone_else',dimension:'overworld',blueprint:{empty:[plain(p)]}});
  assert.equal(authority.queryMutation(f.bot,'place',p).allowed,false,type);
  assert.equal(routeMutatesStructure(f.bot,{toPlace:[plain(p)]}),true,type);
  await assert.rejects(f.bot.placeBlock(f.bot.blockAt(p.offset(0,-1,0)),new Vec3(0,1,0)),{name:'StructureMutationRefused'});
 }
});
test('cancelled temporary placement survives replacement of its goal and restart; foreign replacement only retains the obligation',async()=>{
 const p=new Vec3(8,64,8),grants=[grant(p,{project_id:'project'})],f=fixture({grants});project(f);
 await f.bot.placeBlock(f.bot.blockAt(p.offset(0,-1,0)),new Vec3(0,1,0));
 const restarted=fixture({grants,known:structuredClone(f.world.known)});project(restarted);restarted.set(p,'cobblestone',14);
 assert.equal(authority.pendingRestorations(restarted.bot).length,1);
 const old=restarted.bot.blockAt(p);restarted.set(p,'diamond_block',42);restarted.bot.emit('blockUpdate',old,restarted.bot.blockAt(p));
 assert.equal(authority.confirmedPlacement(restarted.bot,p),null);
 assert.equal(authority.queryMutation(restarted.bot,'dig',p).allowed,false);
 assert.equal(authority.pendingRestorations(restarted.bot)[0].revoked,true);
 restarted.blocks.delete(p.toString());assert.equal(authority.pendingRestorations(restarted.bot).length,0,'observed restoration resolves it without crediting the bot');
});
test('a project scope expiring while aiming cannot dispatch a temporary placement',async()=>{
 const p=new Vec3(8,64,8),f=fixture({grants:[grant(p,{project_id:'project',expires_at:101})]});project(f);
 let release;f.pause(()=>new Promise(r=>{release=r}));const placing=f.bot.placeBlock(f.bot.blockAt(p.offset(0,-1,0)),new Vec3(0,1,0));
 f.time(102);release();await assert.rejects(placing,{name:'StructureMutationRefused'});assert.equal(f.packets.length,0);
});
test('model-selected functional furnishings have deliberate states and isolated container footprints',()=>{
 const blocks=require('../src/build-blocks'),{buildPalette}=require('../src/designer'),registry=require('minecraft-data')('1.21.4');
 for(const name of ['crafting_table','furnace','barrel','chest','stonecutter'])assert.ok(buildPalette(registry).includes(name),name);
 assert.deepEqual(blocks.regionProperties('furnace',{facing:'east'}),{facing:'east'});
 assert.deepEqual(blocks.regionProperties('chest',{facing:'north'}),{facing:'north',type:'single',waterlogged:false});
 assert.equal(blocks.placementFacing('furnace','east'),'west');
 assert.equal(blocks.placementFacing('oak_stairs','east'),'east');
});
test('an optimistic local air update does not discharge restoration without server confirmation',async()=>{
 const p=new Vec3(8,64,8),f=fixture({grants:[grant(p,{project_id:'project'})]});project(f,{ack:false});
 await f.bot.placeBlock(f.bot.blockAt(p.offset(0,-1,0)),new Vec3(0,1,0));await f.bot.dig(f.bot.blockAt(p));
 assert.equal(f.bot.blockAt(p).name,'air');assert.equal(authority.pendingRestorations(f.bot).length,1);
 f.bot._client.emit('block_change',{location:p,type:0});assert.equal(authority.pendingRestorations(f.bot).length,0);
});
test('idle priority resumes confirmed temporary cleanup after cancellation, without forgetting failed cleanup',async()=>{
 const {restoreTemporaryPlacements}=require('../src/work'),{idleBackgroundStep}=require('../src/persona-idle');
 const p=new Vec3(8,64,8),grants=[grant(p,{project_id:'project'})],f=fixture({grants});project(f);
 await assert.rejects((async()=>{await f.bot.placeBlock(f.bot.blockAt(p.offset(0,-1,0)),new Vec3(0,1,0));throw Object.assign(new Error('cancel'),{name:'Cancelled'});})(),{name:'Cancelled'});
 const restart=fixture({grants,known:structuredClone(f.world.known)});project(restart);restart.set(p,'cobblestone',14);restart.bot.entity.position=p.offset(-2,0,0);
 const goal={},task={check(){}},actions={navigate:async()=>{},dig:async()=>{throw new Error('temporarily unreachable');}};
 assert.equal(await restoreTemporaryPlacements(restart.bot,task,goal,()=>{},actions),false);
 assert.match(goal.temporaryCleanup.reason,/unreachable/);
 require('../src/progress').attemptsFor(goal).clearAction('temporary_cleanup');
 assert.equal(authority.pendingRestorations(restart.bot).length,1);
 let cleanupCalls=0;
 const run=()=>idleBackgroundStep({hold:true,survive:async()=>true,restore:async()=>{cleanupCalls++;},stopMotion(){},loot(){throw new Error('loot');},work(){throw new Error('work');}});
 assert.equal(await run(),'survival');assert.equal(cleanupCalls,0);
 assert.equal(await idleBackgroundStep({hold:true,survive:async()=>false,restore:()=>restoreTemporaryPlacements(restart.bot,task,goal,()=>{},{...actions,dig:async(_b,_t,p)=>restart.bot.dig(restart.bot.blockAt(p))}),stopMotion(){throw new Error('hold ran before obligation');}}),'restoration');
 assert.equal(authority.pendingRestorations(restart.bot).length,0);
});
test('isolated container contract checks neighbors again at dispatch and never alters a foreign chest',async()=>{
 const f=fixture();f.bot.registry.blocksByName.chest={id:20};f.bot.heldItem={name:'chest'};
 let release;f.pause(()=>new Promise(r=>{release=r}));const placing=f.bot.placeBlock(f.bot.blockAt(f.p.offset(0,-1,0)),new Vec3(0,1,0));
 f.set(f.p.offset(1,0,0),'chest',32,{type:'single',facing:'north'});release();
 await assert.rejects(placing,e=>e.mutationReason==='unsupported_connected_container_placement');assert.equal(f.packets.length,0);
});
test('temporary occupancy remains unverified, while cleanup does not interrupt an existing workstation job',async()=>{
 const p=new Vec3(8,64,8),f=fixture({grants:[grant(p,{project_id:'project'})]}),{entry}=project(f,{blocks:[{...plain(p.offset(0,-1,0)),material:'stone'}]});
 const {buildVerification}=require('../src/persona-build'),{restoreTemporaryPlacements}=require('../src/work');
 assert.equal(buildVerification(f.bot,{blueprint:entry.blueprint}).verified,true);
 await f.bot.placeBlock(f.bot.blockAt(p.offset(0,-1,0)),new Vec3(0,1,0));
 assert.equal(buildVerification(f.bot,{blueprint:entry.blueprint}).blocked_empty,1);
 for(const job of [{holdWorkstation:true},{smelting:{position:plain(p)}},{smeltingSides:[{position:plain(p)}]}])assert.equal(await restoreTemporaryPlacements(f.bot,{check(){}},job,()=>{},{dig:()=>assert.fail('active utility removed')}),false);
 await f.bot.dig(f.bot.blockAt(p));assert.equal(buildVerification(f.bot,{blueprint:entry.blueprint}).verified,true);
});
test('model furnishing geometry is ordinary validated build data, with exact orientation and static ownership',()=>{
 const {validateSchematic}=require('../src/designer'),blocks=require('../src/build-blocks'),registry=require('minecraft-data')('1.21.4');
 const schematic={name:'Functional room',description:'Model-authored furniture',size:[5,3,5],palette:['oak_planks','furnace','chest'],regions:[
  {from:[0,0,0],to:[4,0,4],block:'oak_planks',properties:null},
  {from:[1,1,1],to:[1,1,1],block:'furnace',properties:{facing:'east'}},
  {from:[3,1,3],to:[3,1,3],block:'chest',properties:{facing:'north'}}
 ],entrance:null,existingOffset:null,site:null};
 const design=validateSchematic(schematic,registry);assert.equal(design.materials.furnace,1);assert.equal(design.materials.chest,1);
 const furnace=design.blocks.find(c=>c.material==='furnace'),block={name:'furnace',stateId:10,getProperties:()=>({facing:'east',lit:false})};
 assert.equal(blocks.matchesBuildBlock(block,furnace),true);assert.equal(blocks.matchesBuildBlock({...block,getProperties:()=>({facing:'west',lit:false})},furnace),false);
 assert.equal(blocks.matchesOwnership({...block,stateId:11,getProperties:()=>({facing:'east',lit:true})},blocks.blockOwnership(block)),true);
 assert.equal(blocks.placementPitch('barrel',Math.PI/2),0,'a six-directional barrel must not become vertical while aiming at its floor');
 schematic.regions.push({from:[2,1,3],to:[2,1,3],block:'chest',properties:{facing:'north'}});
 assert.throws(()=>validateSchematic(schematic,registry),/cannot adjoin/);
});
test('unreachable cleanup rests across unchanged passes and goal changes while alternatives remain usable',async()=>{
 const {restoreTemporaryPlacements}=require('../src/work'),p=new Vec3(8,64,8),q=p.offset(1,0,0),f=fixture({grants:[{...grant(p,{project_id:'project'}),cells:[plain(p),plain(q)]}]});
 project(f,{empty:[plain(p),plain(q)]});f.set(q.offset(0,-1,0),'stone',1);f.bot.entity.position=p.offset(-2,0,0);
 for(const target of [p,q])await f.bot.placeBlock(f.bot.blockAt(target.offset(0,-1,0)),new Vec3(0,1,0));
 const survival={},goal={survival},task={check(){}},calls=[];
 const actions={navigate:async()=>{},dig:async(_b,_t,target)=>{calls.push(target.x);if(target.equals(p))throw new Error('no path to old utility');await f.bot.dig(f.bot.blockAt(target));}};
 assert.equal(await restoreTemporaryPlacements(f.bot,task,goal,()=>{},actions),false);
 assert.equal(await restoreTemporaryPlacements(f.bot,task,goal,()=>{},actions),true);
 for(let i=0;i<3;i++)assert.equal(await restoreTemporaryPlacements(f.bot,task,{survival},()=>{},actions),false);
 assert.deepEqual(calls,[p.x,q.x]);assert.equal(authority.pendingRestorations(f.bot).length,1);
 const unrelated={survival,personaGoalId:'another goal'};
 assert.equal(await restoreTemporaryPlacements(f.bot,task,unrelated,()=>{},{...actions,completion:true}),false);
 assert.equal(unrelated.temporaryCleanup,undefined,'unrelated completion does not acquire this obligation');
 f.bot.entity.position=p.offset(30,0,0);require('../src/progress').attemptsFor(goal).clearAction('temporary_cleanup');
 assert.equal(await restoreTemporaryPlacements(f.bot,task,goal,()=>{},actions),false);assert.equal(goal.temporaryCleanup.reason,'cleanup_out_of_local_reach');assert.deepEqual(calls,[p.x,q.x]);
});
test('a rejected dig echo preserves its original receipt, but confirmed removal followed by replacement never does',async()=>{
 const p=new Vec3(8,64,8),f=fixture({grants:[grant(p,{project_id:'project'})]});project(f,{ack:false});
 await f.bot.placeBlock(f.bot.blockAt(p.offset(0,-1,0)),new Vec3(0,1,0));await f.bot.dig(f.bot.blockAt(p));
 let old=f.bot.blockAt(p);f.set(p,'cobblestone',14);f.bot.emit('blockUpdate',old,f.bot.blockAt(p));f.bot._client.emit('block_change',{location:p,type:14});
 assert.ok(authority.confirmedPlacement(f.bot,p));assert.equal(authority.queryMutation(f.bot,'dig',p).allowed,true);
 await f.bot.dig(f.bot.blockAt(p));f.bot._client.emit('block_change',{location:p,type:0});
 old=f.bot.blockAt(p);f.set(p,'cobblestone',14);f.bot.emit('blockUpdate',old,f.bot.blockAt(p));f.bot._client.emit('block_change',{location:p,type:14});
 assert.equal(authority.confirmedPlacement(f.bot,p),null);assert.equal(authority.queryMutation(f.bot,'dig',p).allowed,false);
});
test('authoritative batched air resolves cleanup through the existing normalized server stream',async()=>{
 for(const modern of [true,false]){
  const p=new Vec3(8,64,8),f=fixture({grants:[grant(p,{project_id:'project'})]});project(f,{ack:false});
  await f.bot.placeBlock(f.bot.blockAt(p.offset(0,-1,0)),new Vec3(0,1,0));await f.bot.dig(f.bot.blockAt(p));
  assert.equal(authority.pendingRestorations(f.bot).length,1);
  f.bot._client.emit('multi_block_change',modern?{chunkCoordinates:{x:0,y:4,z:0},records:[(8<<8)|(8<<4)]}:{chunkX:0,chunkZ:0,records:[{horizontalPos:(8<<4)|8,y:64,blockId:0}]});
  assert.equal(authority.pendingRestorations(f.bot).length,0);
 }
});
module.exports={project};
test('idle and unrelated completion preserve a retained occupied station until its checkpoint is settled',async()=>{
 const p=new Vec3(8,64,8),f=fixture({grants:[grant(p,{project_id:'project'})]});project(f);await f.bot.placeBlock(f.bot.blockAt(p.offset(0,-1,0)),new Vec3(0,1,0));
 const {restoreTemporaryPlacements}=require('../src/work');let occupied=true,calls=0;
 f.bot._pendingWorkstations=()=>occupied?[{id:'invested',goal_id:'old-goal',position:plain(p)}]:[];f.bot.entity.position=p.offset(-2,0,0);
 const actions={navigate:async()=>{calls++},dig:async(_b,_t,p)=>f.bot.dig(f.bot.blockAt(p))};
 for(const current of [{kind:'survive'},{kind:'craft',personaGoalId:'new',placedWorkstations:[`cobblestone:${p}`]}])assert.equal(await restoreTemporaryPlacements(f.bot,{check(){}},current,()=>{},actions),false);
 assert.equal(calls,0);assert.equal(authority.pendingRestorations(f.bot).length,1);
 occupied=false;assert.equal(await restoreTemporaryPlacements(f.bot,{check(){}},{kind:'survive'},()=>{},actions),true);assert.equal(authority.pendingRestorations(f.bot).length,0);
});
