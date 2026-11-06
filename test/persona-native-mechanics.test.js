'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{Vec3}=require('vec3');
const registry=require('minecraft-data')('1.21.11'),Block=require('prismarine-block')('1.21.11');
const builds=require('../src/persona-build'),edits=require('../src/persona-edit'),moves=require('../src/persona-move'),visits=require('../src/persona-visit');
const design=()=>({name:'Village square',description:'A broad floor',size:[40,2,40],palette:['stone'],regions:[{from:[0,0,0],to:[39,0,39],block:'stone',properties:null}],entrance:null,existingOffset:null,site:null});
function fixture(){
 const bot=new EventEmitter(),cells=new Map(),projects=[];
 Object.assign(bot,{registry,version:'1.21.11',username:'Tolik',_personaNativeCapabilities:true,game:{dimension:'overworld',gameMode:'survival',minY:-64,height:384},entity:{position:new Vec3(.5,64,.5),onGround:true,width:.6,height:1.8},entities:{},players:{},health:20,food:20,oxygenLevel:20,inventory:{items:()=>[],slots:[]},buildRegistry:{all:()=>projects,find:id=>projects.find(p=>p.id===id)},companionMemory:{context:()=>({places:[]})},controlState:{},setControlState(){},clearControlStates(){},getControlState:()=>false});
 const set=(p,name,properties={})=>{const block=Block.fromProperties(registry.blocksByName[name].id,properties,0);block.position=p.clone();cells.set(p.toString(),block);return block;};
 bot.blockAt=p=>{const q=p.floored();if(cells.has(q.toString()))return cells.get(q.toString());const block=Block.fromStateId(registry.blocksByName[q.y<64?'stone':'air'].defaultState,0);block.position=q;return block;};
 bot._client=new EventEmitter();bot._client.write=()=>{};
 bot.canDigBlock=()=>true;bot.equip=async item=>{bot.heldItem=item;};bot.look=async()=>{};bot.waitForTicks=async()=>{};
 bot.dig=async block=>{bot._client.write('block_dig',{status:0,location:block.position});bot._client.write('block_dig',{status:2,location:block.position});set(block.position,'air');};
 const expected=b=>({name:b.name,state_id:b.stateId,properties:b.getProperties()});
 const edit=(p,name,properties={})=>({kind:'edit',dimension:'overworld',cells:[{position:{...p},expected:expected(bot.blockAt(p)),desired:{name,properties}}],preserve:[],source_task_id:null});
 return {bot,cells,projects,set,expected,edit};
}
test('native build uses upstream geometry limits and verifies a floor beyond persona size and cell caps',()=>{
 const {bot}=fixture(),spec={mode:'fresh',build_id:null,schematic:design()};
 assert.throws(()=>builds.prepareBuild({...bot,_personaNativeCapabilities:false},spec,'persona:p',{enabled:true}));
 const goal=builds.prepareBuild(bot,spec,'persona:p',{enabled:true,nativeCapabilities:true});
 assert.equal(goal.design.blocks.length,1600);
 goal.blueprint={origin:{x:0,y:63,z:0},blocks:goal.design.blocks.map(p=>({...p,y:p.y+63})),empty:[]};
 assert.equal(builds.buildVerification(bot,goal).verified,true);
 assert.ok(builds.capabilities(bot,true,true).max_blocks>=1600);
 assert.throws(()=>builds.prepareBuild(bot,{...spec,schematic:{...design(),size:[49,2,40]}},'persona:p',{enabled:true,nativeCapabilities:true}),/most Jev can build/);
});
test('native builds can continue distant registered work from another principal while honoring a requested site',()=>{
 const {bot,projects}=fixture();projects.push({id:'town',from:'persona:earlier',dimension:'overworld',origin:{x:4000,y:63,z:0},design:{source:design()},blueprint:{origin:{x:4000,y:63,z:0},blocks:[],empty:[]}});
 const goal=builds.prepareBuild(bot,{mode:'repair',build_id:'town',schematic:null},'persona:Tolik',{enabled:true,nativeCapabilities:true});
 assert.equal(goal.continueBuild.id,'town');assert.equal(goal.personaBuildReturn.target.x,4000);
 assert.throws(()=>builds.prepareBuild(bot,{mode:'repair',build_id:'town',schematic:null,site_binding:{dimension:'overworld',position:{x:0,y:63,z:0},radius:5}},'persona:Tolik',{enabled:true,nativeCapabilities:true}),e=>e.code==='build_site_mismatch');
 const fresh=builds.prepareBuild(bot,{mode:'fresh',build_id:null,schematic:design(),site_binding:{dimension:'overworld',position:{x:4000,y:63,z:0},radius:100}},'persona:Tolik',{enabled:true,nativeCapabilities:true});
 fresh.blueprint={origin:{x:4000,y:63,z:0},blocks:[],terrain:{clear:Array.from({length:2049},(_,x)=>({x:4000+x,y:64,z:0})),fill:[]}};
 assert.doesNotThrow(()=>builds.assertBuildPolicy(fresh,bot));
 fresh.blueprint.origin.x=5000;assert.throws(()=>builds.assertBuildPolicy(fresh,bot),e=>e.code==='build_site_mismatch');
});
test('native build binding matches actual Nether dimension names and still rejects a changed requested dimension',()=>{
 const {bot}=fixture();bot.game.dimension='minecraft:the_nether';
 const spec={mode:'fresh',build_id:null,schematic:design(),site_binding:{dimension:'the_nether',position:{x:100,y:64,z:0},radius:64}};
 const goal=builds.prepareBuild(bot,spec,'persona:Tolik',{enabled:true,nativeCapabilities:true});
 assert.equal(builds.siteAllowed(goal.personaBuildPolicy.site_binding,{x:80,y:64,z:-20},[40,2,40],'nether'),true);
 assert.throws(()=>builds.prepareBuild(bot,{...spec,site_binding:{...spec.site_binding,dimension:'the_end'}},'persona:Tolik',{enabled:true,nativeCapabilities:true}),e=>e.code==='build_site_mismatch');
 goal.blueprint={origin:{x:80,y:64,z:-20},blocks:[{x:80,y:64,z:-20,material:'stone'}]};bot.game.dimension='the_end';
 assert.throws(()=>builds.assertBuildPolicy(goal,bot),e=>e.code==='build_site_mismatch');
});
test('native build policy rejects corrupted geometry even though persona size limits are lifted',()=>{
 const {bot}=fixture(),goal=builds.prepareBuild(bot,{mode:'fresh',build_id:null,schematic:design()},'persona:Tolik',{enabled:true,nativeCapabilities:true});
 goal.blueprint={origin:{x:0,y:63,z:0},blocks:[{x:NaN,y:63,z:0,material:'stone'}]};
 assert.throws(()=>builds.assertBuildPolicy(goal,bot),/geometry|finite|site/);
 assert.equal(builds.buildVerification(bot,goal).verified,false);
});
test('native exact edits admit larger distant batches and dig native logs without accepting stale targets',async()=>{
 const f=fixture(),p=new Vec3(2,64,0);f.set(p,'oak_log',{axis:'y'});const goal=f.edit(p,'air');
 const many={...goal,cells:Array.from({length:65},(_,x)=>({position:{x:100+x,y:64,z:0},expected:f.expected(f.bot.blockAt(new Vec3(100+x,64,0))),desired:{name:'stone',properties:{}}}))};
 assert.doesNotThrow(()=>edits.validateEdit(many,{dimension:'overworld',position:f.bot.entity.position},{nativeCapabilities:true}));
 assert.throws(()=>edits.validateEdit(many,{dimension:'overworld',position:f.bot.entity.position}));
 assert.equal(edits.checkEdit(f.bot,goal),true);
 assert.equal(await edits.executeEdit(f.bot,goal,{task:{check(){}},save(){}}),true);
 assert.equal(f.bot.blockAt(p).name,'air');
 f.set(p,'oak_log',{axis:'x'});await assert.rejects(edits.executeEdit(f.bot,goal,{task:{check(){}},save(){}}),/changed/);
});
test('native exact placement uses the native block placer and requires the observed requested result',async()=>{
 const f=fixture(),p=new Vec3(2,64,0),goal=f.edit(p,'crafting_table');
 f.bot.inventory.items=()=>[{name:'crafting_table',type:registry.itemsByName.crafting_table.id,count:1}];
 f.bot.placeBlock=async(ref,face)=>{const target=ref.position.plus(face);f.bot._client.write('block_place',{location:ref.position,direction:1});f.set(target,'crafting_table');};
 assert.equal(edits.checkEdit(f.bot,goal),true);
 assert.equal(await edits.executeEdit(f.bot,goal,{task:{check(){}},save(){}}),true);
 assert.equal(goal.editVerification.verified,true);assert.equal(f.bot.blockAt(p).name,'crafting_table');
});
test('native exact edits still reject changed preserve cells and undiggable targets',async()=>{
 const f=fixture(),p=new Vec3(2,64,0);f.set(p,'oak_log');const goal=f.edit(p,'air'),kept=new Vec3(3,64,0);
 goal.preserve=[{position:{...kept},expected:f.expected(f.bot.blockAt(kept))}];f.set(kept,'stone');
 await assert.rejects(edits.executeEdit(f.bot,goal,{task:{check(){}},save(){}}),/preserve cell changed/);
 f.set(p,'bedrock');assert.throws(()=>edits.checkEdit(f.bot,f.edit(p,'air')),/unsupported|dig/);
});
test('native exact edit checks cancellation and target replacement after tool equip before network mutation',async()=>{
 for(const reason of ['cancelled','replacement']){
  const f=fixture(),p=new Vec3(2,64,0);f.set(p,'stone');const goal=f.edit(p,'air');let cancelled=false,packets=0;
  f.bot._client.write=()=>{packets++;};f.bot.inventory.items=()=>[{name:'iron_pickaxe',type:registry.itemsByName.iron_pickaxe.id,count:1}];
  f.bot.equip=async item=>{f.bot.heldItem=item;if(reason==='cancelled')cancelled=true;else f.set(p,'diamond_block');};
  await assert.rejects(edits.executeEdit(f.bot,goal,{task:{check(){if(cancelled)throw Object.assign(new Error('cancelled'),{name:'Cancelled'});}},save(){}}),reason==='cancelled'?/cancelled/:/changed|expectation/);
  assert.equal(packets,0);assert.notEqual(f.bot.blockAt(p).name,'air');
 }
});
test('native edit uses dimension aliases and rechecks an exact target after automatic approach',async t=>{
 const f=fixture(),p=new Vec3(100,64,0);f.bot.game.dimension='minecraft:the_nether';f.set(p,'oak_log');const goal={...f.edit(p,'air'),dimension:'nether'};let packets=0;
 assert.equal(edits.checkEdit(f.bot,goal),true);
 f.bot._client.write=()=>{packets++;};
 t.mock.method(require('../src/skills'),'navigate',async bot=>{bot.entity.position=new Vec3(98,64,0);f.set(p,'diamond_block');});
 await assert.rejects(edits.executeEdit(f.bot,goal,{task:{check(){}},save(){}}),/changed/);
 assert.equal(packets,0);assert.equal(f.bot.blockAt(p).name,'diamond_block');
});
test('native move admits distant targets in the Nether and uses native navigation without restricted movement settings',async t=>{
 const f=fixture();f.bot.game.dimension='the_nether';const target={x:200,y:64,z:.5};
 assert.equal(moves.canMove(f.bot,target,{enabled:true}),true);
 assert.equal(moves.canMove({...f.bot,_personaNativeCapabilities:false},target,{enabled:true}),false);
 t.mock.method(require('../src/skills'),'navigate',async(bot,task,destination,options)=>{task.check();assert.equal(destination.x,200);assert.notEqual(options?.navigationOnly,true);bot.entity.position=new Vec3(200,64,.5);});
 assert.equal(await moves.moveStep(f.bot,{check(){}},{kind:'move',nativeCapabilities:true,target,personaMovePolicy:{anchor:{x:.5,y:64,z:.5},dimension:'nether'}},()=>{}),true);
 assert.equal(f.bot.entity.position.x,200);
});
test('native visits advertise distant references and do not expire after the persona minute',async()=>{
 const f=fixture();f.projects.push({id:'town',dimension:'overworld',entrance:{x:500,y:64,z:.5}});
 const options={enabled:true,principal:'persona:Tolik'},resolve=id=>visits.resolveDestination(f.bot,id,options),destination=resolve('project:town');
 const advertised=visits.capabilities(f.bot,options).destinations;assert.equal(advertised.length,1);assert.equal(advertised[0].position.x,500);
 assert.deepEqual(visits.capabilities({...f.bot,_personaNativeCapabilities:false},options).destinations,[]);
 const goal={kind:'visit',nativeCapabilities:true,destination,personaVisitPolicy:{destination,startedAt:Date.now()-120000}};
 assert.equal(await visits.visitStep(f.bot,{check(){}},goal,()=>{},{resolve,navigate:async(bot,task,_goal,opts)=>{task.check();assert.notEqual(opts.navigationOnly,true);assert.notEqual(opts.onFoot,true);bot.entity.position=new Vec3(499,64,.5);}}),true);
 assert.equal(goal.visitArrival.distance,1);
});
test('native visit keeps a boat leg unfinished and checks current destination during travel',async()=>{
 const f=fixture();f.projects.push({id:'town',dimension:'overworld',entrance:{x:500,y:64,z:.5}});
 const resolve=id=>visits.resolveDestination(f.bot,id),destination=resolve('project:town'),goal={kind:'visit',nativeCapabilities:true,destination,personaVisitPolicy:{destination}};
 assert.equal(await visits.visitStep(f.bot,{check(){}},goal,()=>{},{resolve,boatTravel:async()=>true,navigate:async()=>assert.fail('boat leg already acted')}),false);
 await assert.rejects(visits.visitStep(f.bot,{check(){}},goal,()=>{},{resolve,navigate:async(_b,task)=>{f.projects[0].entrance.x++;task.check();}}),/destination/);
});
