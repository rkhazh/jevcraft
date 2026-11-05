'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const registry=require('minecraft-data')('1.21.11');
const {createPersona}=require('../src/persona-admission');
function fixture(stock={diorite:21,granite:28,raw_copper:16,furnace:1,crafting_table:1,oak_planks:1}){
 const bot={registry,game:{gameMode:'survival',dimension:'overworld'},inventory:{items:()=>Object.entries(stock).filter(([,n])=>n>0).map(([name,count])=>({name,count,type:registry.itemsByName[name].id})),count:id=>stock[registry.items[id]?.name]||0}};
 require('mineflayer/lib/plugins/craft')(bot);
 return {bot,stock};
}
function api(){let m;try{m=require('../src/persona-craft')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e}assert.ok(m,'inventory recipe capability exists');return m;}
test('opt-in craft admission is separate from obtain names and installs carried-only execution policy',async()=>{
 let launched;
 const p=createPersona({read:()=>({connected:true,health:20,dimension:'overworld',items:['oak_log','polished_diorite'],players:[],inventory:{diorite:21}}),items:['oak_log'],craftAffordances:()=>({enabled:true,source:'carried_inventory',items:['polished_diorite'],max_count:64,quantity_preflight:true}),checkCraft:()=>true,start:async g=>{launched=g},stop:async()=>{}});
 const proposal=kind=>{const s=p.snapshot();return {schema_version:1,goal_id:randomUUID(),persona_id:'test',session_id:s.session_id,observation_id:s.observation_id,issued_at:s.observed_at,expires_at:s.observed_at+60,state:'proposed',spec:{kind,item:'polished_diorite',count:16,deliver:false}}};
 assert.equal((await p.submit(proposal('craft'))).status,'accepted');assert.deepEqual(launched.personaCraftPolicy,{source:'carried_inventory'});assert.equal(launched.personaHold,true);
 assert.equal((await p.submit(proposal('obtain'))).status,'rejected');assert.deepEqual(p.snapshot().items,['oak_log']);await p.close();
});
test('native actual recipes advertise carried transformations beyond the old item list, not harvesting',()=>{
 const f=fixture(),a=api(),c=a.capabilities(f.bot,{enabled:true});
 for(const n of ['polished_diorite','polished_granite','copper_ingot'])assert.ok(c.items.includes(n),n);
 assert.ok(!c.items.includes('diamond'));assert.ok(!c.items.includes('water_bucket'));assert.equal(c.quantity_preflight,true);assert.deepEqual(a.capabilities(f.bot,{enabled:false}).items,[]);
 assert.ok(a.plan(f.bot,{item:'polished_diorite',count:16}).every(s=>s.action==='craft'));
 assert.ok(a.plan(f.bot,{item:'copper_ingot',count:1}).every(s=>['craft','smelt'].includes(s.action)));
 assert.throws(()=>a.plan(f.bot,{item:'copper_ingot',count:16}),/carried/);
});
test('changed carried inputs and raw-source requests fail before resource acquisition',async()=>{
 const f=fixture(),a=api();a.plan(f.bot,{item:'polished_diorite',count:16});f.stock.diorite=0;
 assert.throws(()=>a.plan(f.bot,{item:'polished_diorite',count:16}),e=>e.personaCraftTerminal&&/carried/.test(e.message));
 assert.ok(!a.capabilities(f.bot,{enabled:true}).items.includes('polished_diorite'));
 const task={check(){}};const goal={kind:'craft',item:'polished_diorite',count:16,personaCraftPolicy:{source:'carried_inventory'}};
 await assert.rejects(require('../src/work').craftFromInventoryStep(f.bot,task,goal,()=>{}),e=>e.personaCraftTerminal===true);
});
test('inventory-only smelting waits through existing wait path without consulting resource opportunities',async()=>{
 const result=await require('../src/work').whileCooking({}, {opportunityClient:{async decide(){assert.fail('must not ask for mining')}}}, {kind:'craft',personaCraftPolicy:{source:'carried_inventory'}},()=>{}, {cooking:30000,oreInReach:()=>assert.fail('must not inspect mining')});
 assert.equal(result,'wait_here');
});
test('delayed first-step observation is rechecked at acquisition dispatch, not harvested',async()=>{
 const f=fixture();let dispatches=0;
 f.bot.craft=async()=>{dispatches++;assert.fail('stale craft must not dispatch')};
 const g={kind:'craft',item:'polished_diorite',count:16,personaCraftPolicy:{source:'carried_inventory'}};
 await assert.rejects(require('../src/work').craftFromInventoryStep(f.bot,{check(){}},g,()=>{f.stock.diorite=0}),e=>e.personaCraftTerminal&&/changed/.test(e.message));
 assert.equal(dispatches,0);assert.equal(g.step.action,'craft');
});
test('reusable observed station is not a consumable inventory ingredient',()=>{
 const f=fixture({iron_ingot:5,smooth_stone:3,crafting_table:1});
 assert.throws(()=>api().plan(f.bot,{item:'blast_furnace',count:1},{available:{...f.stock,furnace:1}}),/furnace not carried/);
});
test('quantity and inventory changes revalidate admission; default-off legacy remains compatible',async()=>{
 const f=fixture(),a=api();let started=0;
 const p=createPersona({read:()=>({connected:true,health:20,dimension:'overworld',items:Object.keys(registry.itemsByName),players:[],inventory:{...f.stock}}),items:['oak_log'],craftAffordances:()=>a.capabilities(f.bot,{enabled:true}),checkCraft:s=>a.plan(f.bot,s),start:async()=>{started++},stop:async()=>{}});
 const s=p.snapshot(),proposal={schema_version:1,goal_id:randomUUID(),persona_id:'test',session_id:s.session_id,observation_id:s.observation_id,issued_at:s.observed_at,expires_at:s.observed_at+60,state:'proposed',spec:{kind:'craft',item:'polished_diorite',count:64,deliver:false}};
 assert.equal((await p.submit(proposal)).reason,'craft_inputs_unavailable');f.stock.diorite=0;proposal.goal_id=randomUUID();proposal.spec.count=16;
 assert.equal((await p.submit(proposal)).reason,'craft_inputs_unavailable');assert.equal(started,0);await p.close();
 const legacy=createPersona({read:()=>({connected:true,health:20,dimension:'overworld',items:['oak_log'],players:[],inventory:{}}),items:['oak_log'],start:async()=>{},stop:async()=>{}}),o=legacy.snapshot();
 assert.equal((await legacy.submit({...proposal,goal_id:randomUUID(),session_id:o.session_id,observation_id:o.observation_id,spec:{kind:'craft',item:'oak_log',count:4,deliver:false}})).status,'accepted');await legacy.close();
});
test('native catalog is cached by inventory and never implies site or contents permission',()=>{
 const f=fixture(),a=api(),native=f.bot.recipesFor;let reads=0;f.bot.recipesFor=(...args)=>{reads++;return native(...args)};
 const first=a.capabilities(f.bot,{enabled:true}),n=reads;assert.ok(n>0);assert.equal(first.workstation_access,'unverified');
 first.items.push('diamond');assert.ok(!a.capabilities(f.bot,{enabled:true}).items.includes('diamond'));assert.equal(reads,n);
 delete f.stock.crafting_table;delete f.stock.furnace;const later=a.capabilities(f.bot,{enabled:true});assert.ok(reads>n);assert.ok(!later.items.includes('copper_ingot'));assert.ok(!later.items.includes('granite_slab'));
});
for(const failure of [null,'changed','stall','capacity'])test(`real work loop recipe ${failure||'completes'} keeps inventory boundary and avoids generic preparation`,{timeout:5000},async()=>{
 const {EventEmitter}=require('node:events'),{Vec3}=require('vec3'),Block=require('prismarine-block')(registry),{SurvivalMovements}=require('../src/movement'),{Survival}=require('../src/survival'),{Task}=require('../src/skills');
 const f=fixture(),bot=Object.assign(new EventEmitter(),f.bot);let crafts=0,reads=0;
 Object.assign(bot,{version:'1.21.11',entities:{},players:{},time:{timeOfDay:1000,age:1000},health:20,food:20,oxygenLevel:20,entity:{position:new Vec3(.5,64,.5),onGround:true,metadata:{},effects:{}},world:{raycast:()=>null},findBlocks:()=>[],controlState:{},setControlState(){},chat(){},_syncWindow:async()=>{if(++reads===1&&failure==='changed')f.stock.diorite=0;},craft:async(recipe)=>{crafts++;if(failure==='changed')assert.fail('inputs changed before click');if(failure==='stall')throw Object.assign(new Error('recipe stalled'),{name:'Stalled'});for(const d of recipe.delta){const name=registry.items[d.id].name;f.stock[name]=(f.stock[name]||0)+d.count;}}});
 bot.inventory.slots=[];bot.game.minY=-64;bot.game.height=384;
 bot.blockAt=p=>{const q=p.floored(),b=Block.fromStateId(registry.blocksByName[q.y<64?'stone':'air'].defaultState,0);b.position=q;return b;};
 bot.pathfinder={movements:new SurvivalMovements(bot),setGoal(){},goto:async()=>assert.fail('no unrelated route')};
 const client={systemOne:async()=>assert.fail('recipe must not commission preparation or persistence')},survival=Object.assign(Object.create(Survival.prototype),{bot,state:{shelters:[]},actions:{},client});
 const goal={kind:'craft',item:'polished_diorite',count:4,personaHold:true,personaCraftPolicy:{source:'carried_inventory'},request:'craft an item from carried ingredients'};
 if(failure==='capacity'){Object.assign(goal,{kind:'obtain',item:'copper_ingot',count:1,navigationOnly:true});delete goal.personaCraftPolicy;bot._checkPhysicalWorkCapacity=()=>{throw Object.assign(new Error('physical capacity full'),{code:'pending_work_capacity'})};}
 const running=require('../src/work').runGoal(bot,new Task('craft','craft'),goal,{save(){}},{survival,decisionClient:client,maxSteps:3});
 if(failure==='capacity')await assert.rejects(running,{code:'pending_work_capacity'});
 else if(failure)await assert.rejects(running,e=>e.personaCraftTerminal&&e.message.includes(failure==='changed'?'changed':'stalled'));
 else {assert.equal((await running).goal.status,'complete');assert.equal(f.stock.polished_diorite,4);}
 assert.equal(crafts,['changed','capacity'].includes(failure)?0:1);
});
