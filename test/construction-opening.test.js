'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
const {designedBuildStep}=require('../src/work');
const {BuildRegistry}=require('../src/builds');
const {buildVerification}=require('../src/persona-build');
const registry=require('minecraft-data')('1.21.4'),Block=require('prismarine-block')(registry);
const WorldSync=require('prismarine-world/src/worldsync');
const key=p=>`${p.x},${p.y},${p.z}`;

// The recorded run had a wrong foundation beneath a matching owned plank.
// Surrounding ground here is synthetic, deliberately fully enclosing it; the
// replay did not archive the six neighbors. No server or model is used.
function fixture({x=0,y=64,z=0,material='cobblestone',cover='oak_planks'}={}){
 const target={x,y,z,material},opening={x,y:y+1,z,material:cover};
 const cells=new Map([[key(target),'diorite'],[key(opening),cover]]);
 const blockAt=p=>{p=p.floored();const value=cells.get(key(p))||(p.y<=target.y?'stone':'air'),name=typeof value==='string'?value:value.name,block=typeof value==='string'?Block.fromStateId(registry.blocksByName[name].defaultState):Block.fromProperties(registry.blocksByName[name].id,value.properties,0);block.position=p;return block;};
 const bot=new EventEmitter();Object.assign(bot,{registry,game:{dimension:'overworld',gameMode:'survival'},entity:{position:new Vec3(x-1.5,y+1,z+.5),height:1.8,width:.6},health:20,food:20,oxygenLevel:20,entities:{},time:{timeOfDay:1000},blockAt,world:{getBlock:blockAt,raycast:WorldSync.prototype.raycast},findBlocks:()=>[],chat:()=>{},lookAt:async()=>{},setControlState:()=>{},getControlState:()=>false,waitForTicks:async()=>{},clearControlStates:()=>{},canDigBlock:()=>true});
 const items=[...new Set([material,cover,'dirt','stone_pickaxe','stone_axe'])].map(name=>({name,type:registry.itemsByName[name].id,count:name==='dirt'?40:3}));
 bot.inventory={items:()=>items};bot.equip=async item=>{bot.heldItem=item};bot._client=new EventEmitter();bot._client.write=()=>{};
 bot.pathfinder={movements:{canDig:true,scafoldingBlocks:[],exclusionAreasPlace:[]},getPathTo:()=>({status:'noPath',path:[]}),setGoal(){}};
 const mutations=[];
 bot.dig=async block=>{mutations.push(['dig',key(block.position)]);cells.set(key(block.position),'air');bot._client.emit('block_change',{location:block.position,type:0});};
 const place=async(ref,face)=>{const p=ref.position.plus(face),old=blockAt(p);mutations.push(['place',key(p),bot.heldItem.name]);cells.set(key(p),bot.heldItem.name);bot.emit('blockPlaced',old,blockAt(p));};
 bot.placeBlock=place;bot._placeBlockWithOptions=place;
 const blueprint={origin:{x,y,z},entrance:{x:x-1,y:y+1,z},blocks:[target,opening],empty:[],bounds:{min:{x,y,z},max:{x,y:y+1,z}},initialBlocks:{},initialNames:{}};
 const goal={kind:'build',from:'persona:test',personaGoalId:'lease',buildId:'building',continueBuild:{id:'building',mode:'repair'},design:{source:{name:'Fixture',description:'Buried repair',size:[1,2,1],palette:[material,cover],regions:[{from:[0,0,0],to:[0,0,0],block:material,properties:null},{from:[0,1,0],to:[0,1,0],block:cover,properties:null}],entrance:null,existingOffset:null,site:null}},blueprint,buildOwned:{[key(target)]:registry.blocksByName[material].defaultState,[key(opening)]:registry.blocksByName[cover].defaultState},buildBatch:{phase:'build',cells:[target]},buildBatchRechosen:true};
 bot.buildRegistry=new BuildRegistry(null);bot.buildRegistry.remember(goal,{dimension:'overworld'});
 bot._restorationPermit={allows:(_bot,_goal,p)=>key(p)===key(target)&&blockAt(p).name==='diorite',needsPlacement:(_bot,_goal,p)=>key(p)===key(target)&&blockAt(p).name==='air'};
 const save=()=>bot.buildRegistry.remember(goal,{dimension:'overworld'}),task={check(){}};
 return {bot,goal,task,save,cells,target,opening,mutations};
}

test('buried approved repair opens one owned block, repairs the target, then restores the unchanged plan',async()=>{
 const f=fixture(),plan=JSON.stringify(f.goal.blueprint);
 let completed=false;for(let i=0;i<9&&!completed;i++)completed=await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
 assert.equal(completed,true);
 assert.deepEqual(f.mutations,[['dig','0,65,0'],['dig','0,64,0'],['place','0,64,0','cobblestone'],['place','0,65,0','oak_planks']]);
 assert.equal(JSON.stringify(f.goal.blueprint),plan);
 assert.equal(buildVerification(f.bot,f.goal).exact_material_match,true);
});

test('construction with no owned access returns a typed block without digging foreign cells',async()=>{
 const f=fixture();delete f.goal.buildOwned['0,65,0'];f.save();
 await assert.rejects(designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{}),e=>e.name==='ConstructionAccessBlocked'&&e.personaBuildTerminal===true);
 assert.deepEqual(f.mutations,[]);
});

test('another registered structure owns the possible opening, so local access refuses it',async()=>{
 const f=fixture(),foreign={...structuredClone(f.goal),buildId:'foreign',from:'persona:someone-else'};
 f.bot.buildRegistry.remember(foreign,{dimension:'overworld'});
 await assert.rejects(designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{}),e=>e.personaBuildTerminal===true);
 assert.deepEqual(f.mutations,[]);
});

test('new lease recovers the saved opening and repairs its target before filling access',async()=>{
 const f=fixture();await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
 await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
 assert.deepEqual(f.mutations,[['dig','0,65,0']]);
 const entry=f.bot.buildRegistry.find('building');assert.equal(entry.buildAccess.phase,'repairing');
 const next={kind:'build',from:f.goal.from,personaGoalId:'next-lease',continueBuild:{id:'building',mode:'repair'}};
 const save=()=>{if(next.blueprint)f.bot.buildRegistry.remember(next,{dimension:'overworld'});};
 let completed=false;for(let i=0;i<9&&!completed;i++)completed=await designedBuildStep(f.bot,f.task,next,save,null,()=>{});
 assert.equal(completed,true);assert.equal(f.bot.buildRegistry.find('building').buildAccess,undefined);
 assert.deepEqual(f.mutations,[['dig','0,65,0'],['dig','0,64,0'],['place','0,64,0','cobblestone'],['place','0,65,0','oak_planks']]);
});

test('lost target authority restores the opening and blocks without another target dig',async()=>{
 const f=fixture();await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
 await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
 f.bot._restorationPermit.allows=()=>false;
 await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
 await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
 await assert.rejects(designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{}),e=>e.personaBuildTerminal===true);
 assert.deepEqual(f.mutations,[['dig','0,65,0'],['place','0,65,0','oak_planks']]);
 assert.equal(f.goal.buildAccess,undefined);assert.equal(buildVerification(f.bot,f.goal).verified,false);
});

test('opening authorization is rechecked after aiming at actual packet dispatch',async()=>{
 const f=fixture(),packets=[];
 f.goal.blueprint.initialBlocks['0,65,0']=registry.blocksByName.stone.defaultState;f.save();
 f.bot._client.write=(...args)=>packets.push(args);
 f.bot.dig=async block=>{f.cells.set(key(block.position),'stone');f.bot._client.write('block_dig',{status:0,location:block.position});};
 require('../src/structure-mutations').installStructureMutationGuard(f.bot,{validGoal:g=>g===f.goal});
 await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
 await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
 assert.deepEqual(packets,[]);assert.equal(f.goal.buildAccess.phase,'restoring');
 await assert.rejects(designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{}),e=>e.personaBuildTerminal===true);
});

test('continuation does not turn a matching unrecorded cover into recorded ownership',async()=>{
 const f=fixture();delete f.goal.buildOwned['0,65,0'];f.save();
 const next={kind:'build',from:f.goal.from,personaGoalId:'next-lease',continueBuild:{id:'building',mode:'repair'},buildBatch:{phase:'build',cells:[f.target]},buildBatchRechosen:true};
 const save=()=>{if(next.blueprint)f.bot.buildRegistry.remember(next,{dimension:'overworld'});};
 await designedBuildStep(f.bot,f.task,next,save,null,()=>{});
 await assert.rejects(designedBuildStep(f.bot,f.task,next,save,null,()=>{}),e=>e.personaBuildTerminal===true);
 assert.equal(f.bot.buildRegistry.find('building').buildOwned['0,65,0'],undefined);
 assert.deepEqual(f.mutations,[]);
});

test('sealed foundation access does not trigger unrelated dirt gathering',async()=>{
 const f=fixture();f.bot.inventory.items().find(i=>i.name==='dirt').count=0;delete f.goal.buildOwned['0,65,0'];f.save();
 await assert.rejects(designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{}),e=>e.personaBuildTerminal===true);
 assert.deepEqual(f.mutations,[]);
});

test('failed closure preserves its saved obligation and returns terminal access failure',async()=>{
 const f=fixture();for(let i=0;i<4;i++)await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
 assert.equal(f.bot.blockAt(new Vec3(0,64,0)).name,'cobblestone');
 f.bot._placeBlockWithOptions=async()=>{throw new Error('placement rejected by server');};
 await assert.rejects(designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{}),e=>e.personaBuildTerminal===true);
 assert.equal(f.goal.buildAccess.phase,'restoring');assert.ok(f.bot.buildRegistry.find('building').buildAccess);
});

test('the same repair mechanism works at unrelated coordinates with other ordinary materials',async()=>{
 for(const options of [{x:-87,y:104,z:33,material:'stone_bricks',cover:'birch_planks'},{x:203,y:40,z:-112,material:'cobblestone',cover:'bricks'}]){
  const f=fixture(options);let completed=false;
  for(let i=0;i<9&&!completed;i++)completed=await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
  assert.equal(completed,true);assert.equal(buildVerification(f.bot,f.goal).exact_material_match,true);
  assert.deepEqual(f.mutations.map(m=>m[0]),['dig','dig','place','place']);
  assert.equal(f.mutations[2][2],options.material);assert.equal(f.mutations[3][2],options.cover);
 }
});

test('unknown neighbors, fluids, fragile and oriented blocks are not opening candidates',()=>{
 const {openingCandidates}=require('../src/construction-opening');
 for(const obstacle of ['unknown','water','sand','glass','oak_stairs','chest']){
  const f=fixture(),at=f.bot.blockAt;
  if(obstacle==='unknown')f.bot.blockAt=p=>p.equals(new Vec3(0,66,0))?null:at(p);
  else f.cells.set('0,66,0',obstacle);
  assert.deepEqual(openingCandidates(f.bot,f.goal,[f.target]),[],obstacle);
 }
 const f=fixture();f.goal.blueprint.blocks[1].properties={facing:'north'};f.save();
 assert.deepEqual(openingCandidates(f.bot,f.goal,[f.target]),[]);
});

test('survival or lease interruption leaves the opening obligation for a later checked turn',async()=>{
 for(const name of ['NeedsSafety','NeedsAir','Cancelled']){
  const f=fixture();await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
  await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
  const before=structuredClone(f.mutations),saved=structuredClone(f.goal.buildAccess);
  await assert.rejects(designedBuildStep(f.bot,{check(){throw Object.assign(new Error('interrupted'),{name});}},f.goal,f.save,null,()=>{}),e=>e.name===name);
  assert.deepEqual(f.mutations,before);assert.deepEqual(f.goal.buildAccess,saved);
 }
});

test('lost closure material is requested by the saved repair without dropping its obligation',async()=>{
 const {continueOpening}=require('../src/construction-opening'),f=fixture();
 for(let i=0;i<4;i++)await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
 f.bot.inventory.items().find(i=>i.name==='oak_planks').count=0;
 const needs=[];
 await continueOpening(f.bot,f.task,f.goal,f.save,{choose:()=>{throw new Error('must acquire before choosing a mutation');},execute:()=>{throw new Error('must acquire before mutation');},acquire:async(item,count)=>needs.push([item,count])});
 assert.deepEqual(needs,[['oak_planks',1]]);assert.equal(f.goal.buildAccess.phase,'restoring');
 assert.equal(f.bot.blockAt(new Vec3(0,65,0)).name,'air');
});

test('approach scaffolding cannot spend the still-matching opening replacement',async()=>{
 const f=fixture({cover:'cobblestone'}),{constructionMovement}=require('../src/construction-access');
 f.bot.inventory.items().find(i=>i.name==='cobblestone').count=2;f.bot.inventory.items().find(i=>i.name==='dirt').count=0;
 await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
 const restore=constructionMovement(f.bot,f.goal);
 try{assert.equal(f.bot.pathfinder.movements.countScaffoldingItems(),0);assert.equal(f.bot.pathfinder.movements.getScaffoldingItem(),null);}finally{restore();}
});

test('terminal access evidence retains the failed target and reason in observable goal state',async()=>{
 const f=fixture();delete f.goal.buildOwned['0,65,0'];f.save();
 await assert.rejects(designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{}),e=>e.personaBuildTerminal===true);
 const step=require('../src/persona-execution').normalizeStep(f.goal.step);
 assert.equal(step.action,'build_access_blocked');assert.deepEqual(step.position,{x:0,y:64,z:0});
 assert.match(f.goal.lastError,/access/i);assert.match(f.goal.lastError,/0, 64, 0/);
});

test('opening obligation survives process loss when normal saves only write the goal store',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{GoalStore}=require('../src/objectives');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-opening-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const f=fixture(),file=path.join(dir,'builds.json'),store=new GoalStore(path.join(dir,'goal.json'));
 f.bot.buildRegistry=new BuildRegistry(file);f.bot.buildRegistry.remember(f.goal,{dimension:'overworld'});f.goal.version=1;
 const save=()=>store.save(f.goal);
 await designedBuildStep(f.bot,f.task,f.goal,save,null,()=>{});
 await designedBuildStep(f.bot,f.task,f.goal,save,null,()=>{});store.flushSync();
 const recovered=new BuildRegistry(file);
 assert.equal(recovered.find('building').buildAccess.phase,'repairing');
 assert.equal(recovered.find('building').buildOwned['0,65,0'],undefined);
 f.bot.buildRegistry=recovered;
 const next={kind:'build',from:f.goal.from,personaGoalId:'after-process-loss',continueBuild:{id:'building',mode:'repair'}};
 let completed=false;for(let i=0;i<9&&!completed;i++)completed=await designedBuildStep(f.bot,f.task,next,()=>{},null,()=>{});
 assert.equal(completed,true);assert.equal(new BuildRegistry(file).find('building').buildAccess,undefined);
});

test('tool acquisition without a dig does not advance past the still-closed opening',async()=>{
 const f=fixture({cover:'cobblestone'}),{continueOpening}=require('../src/construction-opening');
 await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
 await continueOpening(f.bot,f.task,f.goal,f.save,{choose:async candidates=>candidates[0],execute:async()=>{f.bot.inventory.items().push({name:'iron_pickaxe',type:registry.itemsByName.iron_pickaxe.id,count:1});},acquire:async()=>{throw new Error('materials already carried');}});
 assert.equal(f.goal.buildAccess.phase,'opening');assert.equal(f.bot.blockAt(new Vec3(0,65,0)).name,'cobblestone');
});

test('a new edit cannot discard the saved temporary access restoration',async()=>{
 const f=fixture(),{prepareBuild}=require('../src/persona-build');
 await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
 const spec={mode:'edit',build_id:'building',schematic:{...structuredClone(f.goal.design.source),existingOffset:[0,0,0]}};
 assert.throws(()=>prepareBuild(f.bot,spec,f.goal.from,{enabled:true}),/pending local access restoration/);
 assert.ok(f.bot.buildRegistry.find('building').buildAccess);
});

function door(f,p,facing='south'){
 for(const [dy,half]of [[0,'lower'],[1,'upper']])f.cells.set(key(p.offset(0,dy,0)),{name:'oak_door',properties:{facing,half,hinge:'left',open:false,powered:false}});
 f.cells.set(key(p.offset(0,-1,0)),'cobblestone');
}

test('recorded remaining repair beside the front door opens its independent wall support and restores it',async()=>{
 // 203106 replay: saved plan and final verification (103 matched, 1 mismatch,
 // 0 unknown) establish these planned neighbors. The exterior air here is
 // synthetic: target diagnostics did not archive the opening's outer neighbor.
 const f=fixture({x:-527,y:62,z:-393}),p=new Vec3(-527,63,-393);
 f.cells.set(key(f.target),'oak_planks');
 for(const [x,y,z,name]of [[-526,62,-393,'cobblestone'],[-528,62,-393,'cobblestone'],[-527,62,-392,'cobblestone'],[-527,62,-394,'grass_block'],[-527,61,-393,'dirt']])f.cells.set(`${x},${y},${z}`,name);
 f.bot._restorationPermit.allows=(_bot,_goal,q)=>key(q)===key(f.target)&&f.bot.blockAt(q).name==='oak_planks';
 f.cells.set(key(p.offset(0,1,0)),'oak_planks');f.cells.set(key(p.offset(-1,0,0)),'oak_planks');f.cells.set(key(p.offset(0,0,1)),'oak_planks');
 door(f,p.offset(1,0,0));f.bot.entity.position=new Vec3(-526.4965,63,-394.3103);
 const doorBefore=[f.bot.blockAt(p.offset(1,0,0)).stateId,f.bot.blockAt(p.offset(1,1,0)).stateId];
 let completed=false;for(let i=0;i<9&&!completed;i++)completed=await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
 assert.equal(completed,true);assert.equal(buildVerification(f.bot,f.goal).exact_material_match,true);
 assert.deepEqual(f.mutations.map(m=>m.slice(0,2)),[['dig','-527,63,-393'],['dig','-527,62,-393'],['place','-527,62,-393'],['place','-527,63,-393']]);
 assert.deepEqual([f.bot.blockAt(p.offset(1,0,0)).stateId,f.bot.blockAt(p.offset(1,1,0)).stateId],doorBefore);
});

test('door dependencies permit lateral openings for every facing but preserve support and paired halves',()=>{
 const {safeOpening}=require('../src/construction-opening');
 for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]])for(const facing of ['north','east','south','west']){
  const f=fixture({x:23,y:90,z:-88}),p=new Vec3(f.opening.x,f.opening.y,f.opening.z),d=p.offset(dx,0,dz);door(f,d,facing);
  assert.equal(safeOpening(f.bot,f.goal,f.opening),true,`${dx},${dz} ${facing}`);
  f.cells.set(key(d.offset(0,1,0)),'air');assert.equal(safeOpening(f.bot,f.goal,f.opening),false,'broken pair');
 }
 const f=fixture(),p=new Vec3(0,65,0);door(f,p.offset(0,1,0));f.cells.set(key(p),'oak_planks');
 assert.equal(safeOpening(f.bot,f.goal,f.opening),false,'door directly supported by opening');
});

test('wall attachment direction permits independent support but rejects the opening as its actual support',()=>{
 const {safeOpening}=require('../src/construction-opening');
 for(const [facing,dx,dz]of [['east',1,0],['west',-1,0],['south',0,1],['north',0,-1]]){
  const f=fixture(),p=new Vec3(0,65,0),at=p.offset(dx,0,dz);
  f.cells.set(key(at),{name:'wall_torch',properties:{facing}});
  assert.equal(safeOpening(f.bot,f.goal,f.opening),false,'attached to opening');
  const opposite={east:'west',west:'east',north:'south',south:'north'};
  f.cells.set(key(at),{name:'wall_torch',properties:{facing:opposite[facing]}});f.cells.set(key(at.offset(dx,0,dz)),'stone');
  assert.equal(safeOpening(f.bot,f.goal,f.opening),true,'supported away from opening');
  f.cells.set(key(at.offset(dx,0,dz)),'air');assert.equal(safeOpening(f.bot,f.goal,f.opening),false,'missing independent support');
 }
});

test('blocked opening diagnostics identify the bounded candidate and actual support dependency in goal outcome',async()=>{
 const f=fixture(),p=new Vec3(0,65,0);door(f,p.offset(0,1,0));f.cells.set(key(p),'oak_planks');
 const diagnostics={};assert.deepEqual(require('../src/construction-opening').openingCandidates(f.bot,f.goal,[f.target],diagnostics),[]);
 assert.equal(diagnostics.rejected.length,1);assert.equal(diagnostics.rejected[0].reason,'supports_neighbor');
 assert.equal(diagnostics.rejected[0].neighbor.material,'oak_door');assert.deepEqual(diagnostics.rejected[0].position,{x:0,y:65,z:0});
 await assert.rejects(designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{}),e=>e.personaBuildTerminal===true);
 assert.match(f.goal.lastError,/supports_neighbor.*oak_door/);assert.match(f.goal.lastError,/0, 65, 0/);assert.ok(f.goal.lastError.length<1000);
});

test('neighbor waterlogging remains unsafe even when its dependency points away from the opening',()=>{
 const f=fixture(),{safeOpening}=require('../src/construction-opening');
 f.cells.set('1,65,0',{name:'ladder',properties:{facing:'west',waterlogged:true}});f.cells.set('2,65,0','stone');
 assert.equal(safeOpening(f.bot,f.goal,f.opening),false);
});

test('a newly attached neighbor during aiming cancels the actual opening dig packet',async()=>{
 const f=fixture(),packets=[];door(f,new Vec3(1,65,0));
 f.bot._client.write=(...args)=>packets.push(args);
 f.bot.dig=async block=>{f.cells.set('1,65,0',{name:'wall_torch',properties:{facing:'east'}});f.bot._client.write('block_dig',{status:0,location:block.position});};
 require('../src/structure-mutations').installStructureMutationGuard(f.bot,{validGoal:g=>g===f.goal});
 await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
 await designedBuildStep(f.bot,f.task,f.goal,f.save,null,()=>{});
 assert.deepEqual(packets,[]);assert.equal(f.bot.blockAt(new Vec3(0,65,0)).name,'oak_planks');
 assert.equal(f.goal.buildAccess.phase,'restoring');
});

test('falling blocks and fluids remain closed in all neighboring directions',()=>{
 const {safeOpening}=require('../src/construction-opening');
 for(const name of ['sand','gravel','anvil','water','lava'])for(const [x,y,z]of [[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,-1,0]]){
  const f=fixture();f.cells.set(key(new Vec3(0,65,0).offset(x,y,z)),name);
  assert.equal(safeOpening(f.bot,f.goal,f.opening),false,`${name} ${x},${y},${z}`);
 }
 const f=fixture();f.cells.set('0,66,0','torch');assert.equal(safeOpening(f.bot,f.goal,f.opening),false,'floor torch depends on opening');
});

test('opening rejection diagnostics and outcome summary stay bounded across a large plan',()=>{
 const f=fixture(),{openingCandidates,openingFailureSummary}=require('../src/construction-opening');
 const missing=Array.from({length:40},(_,i)=>({x:i*4,y:64,z:0,material:'cobblestone'}));
 f.goal.blueprint.blocks=missing.flatMap(t=>[t,{...t,y:65,material:'oak_planks'}]);f.save();
 const diagnostic={};openingCandidates(f.bot,f.goal,missing,diagnostic);
 assert.equal(diagnostic.checked_count,16);assert.equal(diagnostic.rejected.length,8);
 assert.ok(openingFailureSummary(diagnostic).length<600);assert.equal((openingFailureSummary(diagnostic).match(/\) (?:opening_changed|no_exact_ownership_receipt)/g)||[]).length,3);
});
