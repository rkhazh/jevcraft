'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
 const {installMutationAuthority,validateMutationAuthority,queryMutation,loadMutationAuthority}=require('../src/mutation-authority');
const {installStructureMutationGuard,withBuildMutation,routeMutatesStructure}=require('../src/structure-mutations');
function fixture({grants=[],temporary=true,known={},now=100,placeEffect}={}){
 const bot=new EventEmitter(),p=new Vec3(8,64,8),blocks=new Map(),packets=[],saves=[];
 bot.username='actor';bot.game={dimension:'minecraft:overworld'};bot.entity={position:new Vec3(0,64,0),yaw:0};bot.heldItem={name:'cobblestone'};
 bot._client=new EventEmitter();bot._client.write=(...a)=>packets.push(a);bot.buildRegistry={all:()=>[]};
 bot.registry={blocksByName:Object.fromEntries(['cobblestone','dirt','furnace','oak_door','white_bed','wheat','carrots','potatoes'].map((name,id)=>[name,{id}]))};
 bot.blockAt=q=>({name:'air',stateId:0,boundingBox:'empty',shapes:[],position:q,...blocks.get(q.toString())});
 const set=(q,name,stateId,properties={})=>blocks.set(q.toString(),{name,stateId,boundingBox:'block',shapes:[[0,0,0,1,1,1]],getProperties:()=>properties});
 set(p.offset(0,-1,0),'stone',1);
 let pause=async()=>{};
 bot.inventory={slots:Array(45),items:()=>[]};bot.setQuickBarSlot=()=>{bot.heldItem=null};
 bot.activateBlock=async block=>{await pause();bot._client.write('block_place',{location:block.position,direction:1,hand:0});};
 bot.dig=async b=>{await pause();bot._client.write('block_dig',{status:0,location:b.position});bot._client.write('block_dig',{status:2,location:b.position});blocks.delete(b.position.toString());bot.emit('blockUpdate',b,bot.blockAt(b.position));};
 bot.placeBlock=async(ref,face)=>{await pause();bot._client.write('block_place',{location:ref.position,direction:1,hand:0});const q=ref.position.plus(face),old=bot.blockAt(q);if(placeEffect)placeEffect({bot,set,old,q});else set(q,bot.heldItem.name,14);bot.emit('blockPlaced',old,bot.blockAt(q));};
 const policy=validateMutationAuthority({version:1,world_id:'world',principal:'actor',temporary_empty_placement:temporary,grants},{worldId:'world',principal:'actor'});
 const world={known,store:{save:v=>saves.push(structuredClone(v))}};
 const authority=installMutationAuthority(bot,{policy,worldId:'world',principal:'actor',world,now:()=>now});
 installStructureMutationGuard(bot,{validGoal:g=>g?.personaGoalId==='goal'});
 return {bot,p,blocks,packets,set,saves,world,authority,pause:fn=>{pause=fn},time:n=>{now=n}};
}
const grant=(p,extra={})=>({id:'grant',dimension:'overworld',operations:['dig','place'],source:'trusted operator fixture',cells:[{x:p.x,y:p.y,z:p.z}],...extra});
test('unknown digging is refused for arbitrary materials, regardless of native or persona intent',async()=>{
 for(const name of ['stone','hay_block','oak_log','dirt','diamond_block']){
  const f=fixture();f.set(f.p,name,7);f.bot._goal={personaGoalId:'finished',survivalAction:{action:'urgent'}};
  assert.equal(queryMutation(f.bot,'dig',f.p).allowed,false);
  await assert.rejects(f.bot.dig(f.bot.blockAt(f.p)),{name:'StructureMutationRefused'});assert.equal(f.packets.length,0);
 }
});
test('temporary empty placement and exact own retrieval survive task and process changes',async()=>{
 const f=fixture();await f.bot.placeBlock(f.bot.blockAt(f.p.offset(0,-1,0)),new Vec3(0,1,0));
 assert.equal(queryMutation(f.bot,'dig',f.p).source,'own_placement');assert.ok(f.saves.length);
 const restarted=fixture({known:structuredClone(f.world.known)});restarted.set(f.p,'cobblestone',14);
 await restarted.bot.dig(restarted.bot.blockAt(f.p));assert.equal(queryMutation(restarted.bot,'dig',f.p).allowed,false);
});
test('legacy ownership, nearby updates and foreign replacements never produce fresh receipts',async()=>{
 const f=fixture();f.set(f.p,'dirt',10);f.bot._laid=new Map([['8,64,8',{name:'dirt',at:1}]]);f.bot._goal={laid:{'8,64,8':{name:'dirt',at:1}}};
 f.bot.emit('blockUpdate',{name:'air',stateId:0,position:f.p},f.bot.blockAt(f.p));assert.equal(queryMutation(f.bot,'dig',f.p).allowed,false);
 f.bot.emit('blockPlaced',{name:'air',stateId:0,position:f.p},f.bot.blockAt(f.p));assert.equal(queryMutation(f.bot,'dig',f.p).allowed,false,'an event outside a guarded own placement is not promoted');
 f.blocks.delete(f.p.toString());f.bot.heldItem={name:'dirt'};await f.bot.placeBlock(f.bot.blockAt(f.p.offset(0,-1,0)),new Vec3(0,1,0));assert.equal(queryMutation(f.bot,'dig',f.p).allowed,true);
 const old=f.bot.blockAt(f.p);f.set(f.p,'stone',1);f.bot.emit('blockUpdate',old,f.bot.blockAt(f.p));assert.equal(queryMutation(f.bot,'dig',f.p).allowed,false);
 f.set(f.p,'dirt',10);assert.equal(queryMutation(f.bot,'dig',f.p).allowed,false);
});
test('project permits also need trusted cells and cannot borrow temporary placement permission',async()=>{
 const p=new Vec3(8,64,8),f=fixture({grants:[grant(p,{project_id:'project'})]}),task={check(){}},goal={kind:'build',personaGoalId:'goal',buildId:'project',blueprint:{initialBlocks:{'8,64,8':1}},buildOwned:{}};
 f.set(p,'stone',1);assert.equal(queryMutation(f.bot,'dig',p).allowed,false);
 await withBuildMutation(f.bot,task,goal,p,'dig',()=>f.bot.dig(f.bot.blockAt(p)));
 for(const id of ['other','project']){
  const q=id==='other'?p:p.offset(1,0,0);
  await assert.rejects(withBuildMutation(f.bot,task,{...goal,buildId:id},q,'place',()=>f.bot.placeBlock(f.bot.blockAt(q.offset(0,-1,0)),new Vec3(0,1,0))),{name:'StructureMutationRefused'});
 }
});
test('standing scope and empty state are rechecked after aiming and at direct packet dispatch',async()=>{
 const p=new Vec3(8,64,8),f=fixture({grants:[grant(p,{expires_at:101})]});f.set(p,'stone',1);let release;f.pause(()=>new Promise(r=>{release=r}));
 const pending=f.bot.dig(f.bot.blockAt(p));f.time(102);release();await assert.rejects(pending,{name:'StructureMutationRefused'});assert.equal(f.packets.length,0);
 assert.throws(()=>f.bot._client.write('block_dig',{status:0,location:p}),{name:'StructureMutationRefused'});
 assert.throws(()=>f.bot._client.write('block_place',{location:p.offset(0,-1,0),direction:1,hand:0}),{name:'StructureMutationRefused'});
 const other=fixture();let placeRelease;other.pause(()=>new Promise(r=>{placeRelease=r}));const placing=other.bot.placeBlock(other.bot.blockAt(p.offset(0,-1,0)),new Vec3(0,1,0));other.set(p,'short_grass',20);placeRelease();await assert.rejects(placing,{name:'StructureMutationRefused'});assert.equal(other.packets.length,0);
});
test('paired temporary placement checks every cell and navigation uses the same authority',async()=>{
 const f=fixture();f.bot.heldItem={name:'oak_door'};f.set(f.p.offset(0,1,0),'water',21);
 await assert.rejects(f.bot.placeBlock(f.bot.blockAt(f.p.offset(0,-1,0)),new Vec3(0,1,0)),{name:'StructureMutationRefused'});
 f.set(f.p,'stone',1);assert.equal(routeMutatesStructure(f.bot,{toBreak:[f.p]}),true);
 assert.equal(routeMutatesStructure(f.bot,{toPlace:[{...f.p,dy:0}]}),true);
});
test('only an actual intersecting solid permits immediate escape without standing land permission',async()=>{
 const f=fixture();f.set(f.p,'stone',1);f.bot.entity.position=f.p.offset(.5,.2,.5);
 await f.bot.dig(f.bot.blockAt(f.p));assert.equal(f.packets.length,2);
});
test('temporary permission never clears vegetation, fluids, slabs, or unknown cells',()=>{
 const f=fixture();for(const name of ['short_grass','water','lava','stone_slab','snow']){f.set(f.p,name,2);assert.equal(queryMutation(f.bot,'place',f.p).allowed,false);}
 f.bot.blockAt=()=>null;assert.equal(queryMutation(f.bot,'place',f.p).allowed,false);
});
test('safe same-block state changes preserve a receipt, replacements and changed orientation do not',async()=>{
 const f=fixture();f.bot.heldItem={name:'furnace'};await f.bot.placeBlock(f.bot.blockAt(f.p.offset(0,-1,0)),new Vec3(0,1,0));
 // A confirmed source block with its ordinary properties, as Mineflayer emits.
 const r=Object.values(f.world.known.mutationReceipts)[0];r.properties={facing:'north',lit:false};
 f.set(f.p,'furnace',14,{facing:'north',lit:false});let old=f.bot.blockAt(f.p);f.set(f.p,'furnace',15,{facing:'north',lit:true});f.bot.emit('blockUpdate',old,f.bot.blockAt(f.p));assert.ok(require('../src/mutation-authority').confirmedPlacement(f.bot,f.p));
 old=f.bot.blockAt(f.p);f.set(f.p,'furnace',16,{facing:'south',lit:true});f.bot.emit('blockUpdate',old,f.bot.blockAt(f.p));assert.equal(queryMutation(f.bot,'dig',f.p).allowed,false);
});
test('receipt scope and closed callbacks cannot transfer ownership to another world, principal or dimension',async()=>{
 const f=fixture();await f.bot.placeBlock(f.bot.blockAt(f.p.offset(0,-1,0)),new Vec3(0,1,0));
 const rec=Object.values(f.world.known.mutationReceipts)[0];
 for(const changed of [{world_id:'other'},{principal:'other'}]){const g=fixture({known:{mutationReceipts:{saved:{...rec,...changed}}}});g.set(g.p,'cobblestone',14);assert.equal(queryMutation(g.bot,'dig',g.p).allowed,false);}
 f.bot.game.dimension='the_nether';assert.equal(queryMutation(f.bot,'dig',f.p).allowed,false);f.bot.game.dimension='minecraft:overworld';
 const saved=f.saves.length;f.authority.close();f.bot.emit('blockUpdate',f.bot.blockAt(f.p),{name:'air',stateId:0,position:f.p});assert.equal(f.saves.length,saved);assert.equal(queryMutation(f.bot,'dig',f.p).allowed,false);
});
test('native door/container activation empties a held tool and fences a changed hand after aiming',async()=>{
 const f=fixture();f.set(f.p,'oak_door',7,{half:'lower'});f.bot.heldItem={name:'stone_axe'};await f.bot.activateBlock(f.bot.blockAt(f.p));assert.equal(f.bot.heldItem,null);assert.equal(f.packets.length,1);
 let release;f.pause(()=>new Promise(r=>{release=r}));const pending=f.bot.activateBlock(f.bot.blockAt(f.p));await new Promise(setImmediate);f.bot.heldItem={name:'dirt'};release();await assert.rejects(pending,{name:'StructureMutationRefused'});assert.equal(f.packets.length,1);
});
test('strict policy loader rejects oversized, mismatched, duplicate, and symlink configurations without echoing contents',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mutation-policy-')),file=path.join(dir,'policy.json');
 const config={version:1,world_id:'world',principal:'actor',temporary_empty_placement:true,grants:[]},scope={worldId:'world',principal:'actor'};
 try{
  fs.writeFileSync(file,JSON.stringify(config));assert.equal(loadMutationAuthority(file,scope).world_id,'world');
  fs.symlinkSync(file,path.join(dir,'link.json'));assert.throws(()=>loadMutationAuthority(path.join(dir,'link.json'),scope),/^Error: Invalid shared-world mutation policy$/);
  for(const data of ['private-test-data',JSON.stringify({...config,principal:'another'}),JSON.stringify({...config,grants:[{...grant(new Vec3(1,64,1)),model_says_allowed:true}]}),' '.repeat(131073),JSON.stringify(config).replace('"version":1','"version":1,"version":1')]){
   fs.writeFileSync(file,data);assert.throws(()=>loadMutationAuthority(file,scope),/^Error: Invalid shared-world mutation policy$/);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('observed village resources retain their factual counts but are not offered or touched without standing permission',async()=>{
 const {villageFood,eatFromVillage}=require('../src/villages');
 for(const permitted of [false,true]){
  const p=new Vec3(8,64,8),f=fixture({grants:permitted?[grant(p)]:[]});f.set(p,'hay_block',7);
  f.bot.registry={blocksByName:{hay_block:{id:1}}};f.bot.findBlocks=({matching})=>matching.includes(1)?[p]:[];
  const village={x:8,y:64,z:8,dimension:'overworld',hay:1},goal={villages:[village]},blocked=[];
  const food=villageFood(f.bot,goal,{onBlocked:x=>blocked.push(x)});
  if(permitted){assert.equal(food.hayBales,1);assert.equal(blocked.length,0);}
  else{
   assert.equal(food,null);assert.equal(village.hay,1);assert.equal(blocked[0].reason,'dig_requires_standing_grant_or_own_placement');
   let dispatched=0;await assert.rejects(eatFromVillage(f.bot,{check(){}},goal,()=>{},village,{navigate(){dispatched++},dig(){dispatched++}}),{name:'StructureMutationRefused'});assert.equal(dispatched,0);
  }
 }
});
test('a confirmed paired placement can be retrieved, but a lookalike companion without its placement update is not owned',async()=>{
 for(const witnessed of [true,false]){
  const f=fixture({placeEffect:({bot,set,q})=>{
   const old=bot.blockAt(q.offset(0,1,0));set(q,'oak_door',14,{half:'lower',facing:'north',hinge:'left',open:false,powered:false});set(q.offset(0,1,0),'oak_door',15,{half:'upper',facing:'north',hinge:'left',open:false,powered:false});
   if(witnessed)bot.emit('blockUpdate',old,bot.blockAt(q.offset(0,1,0)));
  }});f.bot.heldItem={name:'oak_door'};await f.bot.placeBlock(f.bot.blockAt(f.p.offset(0,-1,0)),new Vec3(0,1,0));
  assert.equal(queryMutation(f.bot,'dig',f.p.offset(0,1,0)).allowed,witnessed);
  if(witnessed)await f.bot.dig(f.bot.blockAt(f.p));else await assert.rejects(f.bot.dig(f.bot.blockAt(f.p)),{name:'StructureMutationRefused'});
 }
});
test('placement validates a block effect rather than allowing tools or buckets to change the reference cell',async()=>{
 for(const name of ['stone_axe','water_bucket','bone_meal']){
  const f=fixture();f.bot.heldItem={name};await assert.rejects(f.bot.placeBlock(f.bot.blockAt(f.p.offset(0,-1,0)),new Vec3(0,1,0)),e=>e.mutationReason==='unsupported_item_block_effect');assert.equal(f.packets.length,0);
 }
 for(const [seed,crop]of [['wheat_seeds','wheat'],['carrot','carrots'],['potato','potatoes']]){
  const f=fixture({placeEffect:({set,q})=>set(q,crop,14,{age:0})});f.set(f.p.offset(0,-1,0),'farmland',4);f.bot.heldItem={name:seed};
  await f.bot.placeBlock(f.bot.blockAt(f.p.offset(0,-1,0)),new Vec3(0,1,0));assert.equal(f.bot.blockAt(f.p).name,crop);assert.equal(queryMutation(f.bot,'dig',f.p).allowed,true);
 }
});
test('build admission requires trusted permanent cells, while concrete sites cannot borrow temporary placement permission',()=>{
 const {prepareBuild,assertBuildPolicy}=require('../src/persona-build'),{validateSchematic}=require('../src/designer'),registry=require('minecraft-data')('1.21.4');
 const schematic={name:'Floor',description:'A floor',size:[3,2,3],palette:['oak_planks'],regions:[{from:[0,0,0],to:[2,0,2],block:'oak_planks',properties:null}],entrance:null,existingOffset:null,site:null},design=validateSchematic(schematic,registry),origin={x:8,y:64,z:8};
 const worldCells=list=>list.map(p=>({...p,x:p.x+origin.x,y:p.y+origin.y,z:p.z+origin.z})),blueprint={origin,blocks:worldCells(design.blocks),empty:worldCells(design.empty)},cells=[...blueprint.blocks,...blueprint.empty].map(({x,y,z})=>({x,y,z}));
 const f=fixture({grants:[{...grant(new Vec3(8,64,8),{project_id:'project'}),cells}]});f.bot.registry=registry;
 const entry={id:'project',from:'persona:p',origin,dimension:'overworld',design:{source:schematic},blueprint};f.bot.buildRegistry.find=id=>id===entry.id?entry:null;
 assert.equal(prepareBuild(f.bot,{mode:'repair',build_id:'project',schematic:null},'persona:p',{enabled:true}).continueBuild.id,'project');
 assert.throws(()=>prepareBuild(f.bot,{mode:'fresh',build_id:null,schematic},'persona:p',{enabled:true}),/standing.*permission/i);
 assert.throws(()=>prepareBuild(f.bot,{mode:'edit',build_id:'project',schematic:{...schematic,size:[4,2,3],existingOffset:[0,0,0]}},'persona:p',{enabled:true}),/standing.*permission/i);
 const goal={personaBuildPolicy:{anchor:origin},buildId:'project',blueprint:{...blueprint,blocks:[...blueprint.blocks,{x:11,y:64,z:8,material:'oak_planks'}]}};
 assert.throws(()=>assertBuildPolicy(goal,f.bot),/standing.*permission/i);
 const g=fixture({grants:[{id:'area',dimension:'overworld',operations:['dig','place'],source:'explicit area fixture',area:{min:{x:0,y:60,z:0},max:{x:20,y:75,z:20}}}]});g.bot.registry=registry;
 assert.ok(prepareBuild(g.bot,{mode:'fresh',build_id:null,schematic},'persona:p',{enabled:true}).design);
});
test('unknown bucket use cannot mutate a source or pour fluid; food, milk and shields remain usable',()=>{
 const f=fixture();for(const name of ['bucket','water_bucket','lava_bucket','powder_snow_bucket','axolotl_bucket']){f.bot.heldItem={name};assert.throws(()=>f.bot._client.write('use_item',{hand:0}),e=>e.mutationReason==='unsupported_item_world_effect');}
 for(const name of ['bread','milk_bucket','shield']){f.bot.heldItem={name};f.bot._client.write('use_item',{hand:0});}assert.equal(f.packets.length,3);
});
test('a placement cannot use adjacent air permission to merge or otherwise modify the clicked reference',async()=>{
 for(const [name,properties]of [['oak_slab',{type:'bottom'}],['snow',{layers:1}],['candle',{candles:1}],['sea_pickle',{pickles:1}],['turtle_egg',{eggs:1}]]){
  const f=fixture({placeEffect:({set,q})=>set(q.offset(0,-1,0),name,99,properties)});f.bot.registry.blocksByName[name]={id:50};f.bot.heldItem={name};f.set(f.p.offset(0,-1,0),name,7,properties);
  await assert.rejects(f.bot.placeBlock(f.bot.blockAt(f.p.offset(0,-1,0)),new Vec3(0,1,0)),e=>e.mutationReason==='unsupported_reference_block_effect');assert.equal(f.packets.length,0);assert.equal(f.bot.blockAt(f.p.offset(0,-1,0)).stateId,7);
 }
});
test('confirmed own dirt may grow grass once without losing its original placement provenance',async()=>{
 const f=fixture();f.bot.heldItem={name:'dirt'};await f.bot.placeBlock(f.bot.blockAt(f.p.offset(0,-1,0)),new Vec3(0,1,0));
 let old=f.bot.blockAt(f.p);f.set(f.p,'grass_block',15,{snowy:false});f.bot.emit('blockUpdate',old,f.bot.blockAt(f.p));
 assert.equal(queryMutation(f.bot,'dig',f.p).allowed,true);const receipt=Object.values(f.world.known.mutationReceipts)[0];assert.equal(receipt.material,'dirt');assert.equal(receipt.current.material,'grass_block');
 const restart=fixture({known:structuredClone(f.world.known)});restart.set(restart.p,'grass_block',15,{snowy:false});assert.equal(queryMutation(restart.bot,'dig',restart.p).allowed,true);
 old=f.bot.blockAt(f.p);f.set(f.p,'dirt',14);f.bot.emit('blockUpdate',old,f.bot.blockAt(f.p));assert.equal(queryMutation(f.bot,'dig',f.p).allowed,false,'reversion is not evidence of the original placement');
});
test('receipt revocation reaches a file-backed store before abrupt-restart replay can resurrect it',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{GoalStore}=require('../src/objectives'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mutation-revoke-')),file=path.join(dir,'world.json'),store=new GoalStore(file),f=fixture();f.world.store=store;
 try{
  f.bot.heldItem={name:'dirt'};await f.bot.placeBlock(f.bot.blockAt(f.p.offset(0,-1,0)),new Vec3(0,1,0));store.flushSync();
  const old=f.bot.blockAt(f.p);f.set(f.p,'stone',1);f.bot.emit('blockUpdate',old,f.bot.blockAt(f.p));f.set(f.p,'dirt',14);
  const disk=JSON.parse(fs.readFileSync(file,'utf8')),restarted=fixture({known:disk.known});restarted.set(restarted.p,'dirt',14);assert.equal(queryMutation(restarted.bot,'dig',restarted.p).allowed,false);
 }finally{store.flushSync();GoalStore.stores.delete(store);fs.rmSync(dir,{recursive:true,force:true});}
});
test('unsupported equipped-item effects are refused honestly instead of becoming empty-hand no-ops',async()=>{
 const f=fixture();for(const [block,item]of [['cauldron','water_bucket'],['dirt','iron_hoe'],['vault','trial_key'],['end_portal_frame','ender_eye']]){
  f.set(f.p,block,3);f.bot.heldItem={name:item};await assert.rejects(f.bot.activateBlock(f.bot.blockAt(f.p)),e=>e.mutationReason==='unsupported_item_block_effect');assert.equal(f.bot.heldItem.name,item);assert.equal(f.packets.length,0);
 }
 f.bot.inventory.items=()=>[{name:'cauldron',count:1},{name:'water_bucket',count:1}];
 for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)f.set(new Vec3(x,63,z),'stone',1);
 assert.ok(require('../src/cauldron').placeSpot(f.bot),'a physically usable spot exists');
 assert.equal(require('../src/cauldron').plans(f.bot).carry,null);
});
test('receipt eviction is durable and a revocation write failure disables further authority',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{GoalStore}=require('../src/objectives'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mutation-evict-')),file=path.join(dir,'world.json'),store=new GoalStore(file);
 const records=Object.fromEntries(Array.from({length:512},(_,i)=>[String(i),{world_id:'world',principal:'actor',dimension:'overworld',position:{x:100+i,y:64,z:8},material:'dirt',state_id:14,properties:{},at:i+1,source:'bot_block_placed'}]));
 const f=fixture({known:{mutationReceipts:records},now:1000});f.world.store=store;
 try{
  store.save({version:1,known:f.world.known});store.flushSync();await f.bot.placeBlock(f.bot.blockAt(f.p.offset(0,-1,0)),new Vec3(0,1,0));
  const restarted=fixture({known:JSON.parse(fs.readFileSync(file,'utf8')).known}),oldCell=new Vec3(100,64,8);restarted.set(oldCell,'dirt',14);assert.equal(queryMutation(restarted.bot,'dig',oldCell).allowed,false);
 }finally{store.flushSync();GoalStore.stores.delete(store);fs.rmSync(dir,{recursive:true,force:true});}
 const g=fixture();await g.bot.placeBlock(g.bot.blockAt(g.p.offset(0,-1,0)),new Vec3(0,1,0));g.world.store.flushSync=()=>{throw new Error('simulated disk failure')};const old=g.bot.blockAt(g.p);g.set(g.p,'stone',1);
 assert.throws(()=>g.bot.emit('blockUpdate',old,g.bot.blockAt(g.p)),{name:'MutationAuthorityPersistenceError'});assert.equal(queryMutation(g.bot,'place',g.p.offset(1,0,0)).allowed,false);
});
test('effect grants are explicit; an owned container does not by itself authorize its unknown contents',async()=>{
 const {confirmedPlacement}=require('../src/mutation-authority'),f=fixture();f.bot.registry.blocksByName.chest={id:20};f.bot.heldItem={name:'chest'};await f.bot.placeBlock(f.bot.blockAt(f.p.offset(0,-1,0)),new Vec3(0,1,0));
 assert.ok(confirmedPlacement(f.bot,f.p));assert.equal(queryMutation(f.bot,'container_withdraw',f.p).allowed,false);assert.equal(queryMutation(f.bot,'entity_attack',f.p).allowed,false);
 const g=fixture({grants:[grant(f.p,{operations:['container_withdraw','entity_attack']})]});assert.equal(queryMutation(g.bot,'container_withdraw',g.p).allowed,true);assert.equal(queryMutation(g.bot,'entity_attack',g.p).allowed,true);assert.equal(queryMutation(g.bot,'dig',g.p).allowed,false);
 const scope=g.authority.summary().scopes[0];assert.deepEqual(scope.bounds,{min:{x:8,y:64,z:8},max:{x:8,y:64,z:8}});assert.match(scope.bounds_note,/exact cell/);assert.equal(scope.cells,undefined);
});
test('digging an owned container cannot bypass contents permissions, including its paired chest',async()=>{
 const f=fixture();
 for(const name of ['chest','copper_chest','waxed_oxidized_copper_chest']){
  const own=fixture();own.bot.registry.blocksByName[name]={id:20};own.bot.heldItem={name};await own.bot.placeBlock(own.bot.blockAt(own.p.offset(0,-1,0)),new Vec3(0,1,0));
  assert.equal(queryMutation(own.bot,'dig',own.p).allowed,false);await assert.rejects(own.bot.dig(own.bot.blockAt(own.p)),e=>e.mutationReason==='container_contents_permission_required');
 }
 for(const both of [false,true]){
  const cells=[f.p,...(both?[f.p.offset(1,0,0)]:[])].map(({x,y,z})=>({x,y,z})),g=fixture({grants:[{...grant(f.p,{operations:['dig','container_withdraw']}),cells}]});
  g.set(g.p,'chest',17,{type:'left',facing:'north'});g.set(g.p.offset(1,0,0),'chest',18,{type:'right',facing:'north'});assert.equal(queryMutation(g.bot,'dig',g.p).allowed,both);
 }
});
module.exports={fixture,grant};
