'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
function api(){let value;try{value=require('../src/persona-pending-work')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e}assert.ok(value,'pending mechanical work is retained in the existing checkpoint');return value;}
const context={worldId:'world-a',personaId:'actor',dimension:'overworld'};
function goal(n=1,extra={}){return {version:1,kind:'craft',item:'copper_ingot',count:4,from:'persona:actor',personaId:'actor',personaWorldId:'world-a',personaGoalId:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,personaSessionId:'expired',status:'cancelled',createdAt:'2026-11-01T00:00:00.000Z',personaCraftPolicy:{source:'carried_inventory'},smelting:{item:'copper_ingot',from:'raw_copper',fuelItem:'coal',position:{x:n,y:64,z:0},dimension:'overworld',count:4,targetInventory:4,startedAt:1793491200000},...extra};}
test('dated pending facts remain separate from inventory and include only matching current scope',()=>{
 const a=api(),g=goal();const list=a.advertise(g,context);assert.equal(list.length,1);assert.deepEqual(list[0],{id:list[0].id,item:'copper_ingot',count:4,dimension:'overworld',position:{x:1,y:64,z:0},recorded_at:1793491200,status:'last_known',access:'unverified',source_goal_id:g.personaGoalId});
 for(const changed of [{worldId:'other'},{personaId:'other'},{dimension:'nether'}])assert.deepEqual(a.advertise(g,{...context,...changed}),[]);
 delete g.personaWorldId;assert.deepEqual(a.advertise(g,context),[],'legacy unscoped record is not silently adopted');
});
test('preservation keeps physical work across unrelated goals and never applies the native eight-history eviction',()=>{
 const a=api(),saved=goal(10,{suspendedTasks:Array.from({length:9},(_,i)=>goal(i+1))});const all=a.retain(saved);assert.equal(all.length,10,'legacy overflow remains visible to backpressure, never evicted');
 assert.equal(a.advertise({...goal(11,{smelting:undefined}),suspendedTasks:all},context).length,8,'bounded advertisement can drain retained entries');
 assert.ok(all.every(g=>!g.personaSessionId&&!g.tried&&!g.recoveryAdvice&&!g.survival));
});
test('exact matching intent binds oldest advertised checkpoint and transfers mechanics under fresh attribution',()=>{
 const a=api(),saved=goal(2,{suspendedTasks:[goal(1,{tried:{old:true},recoveryAdvice:{active:true},survival:{plan:'old'},smelting:{...goal(1).smelting,supplyWork:{kind:'obtain'}}})]}),spec={kind:'craft',item:'copper_ingot',count:4,deliver:false};
 const selected=a.select(saved,spec,context);assert.equal(selected.source_goal_id,goal(1).personaGoalId);
 assert.equal(a.select(saved,{...spec,count:5},context),null);
 const picked=a.adopt(saved,selected,context);assert.equal(picked.mechanical.smelting.position.x,1);assert.equal(picked.mechanical.smelting.supplyWork,undefined);assert.equal(picked.mechanical.personaSessionId,undefined);assert.equal(picked.remaining.length,1);
 assert.throws(()=>a.adopt(saved,{...selected,position:{x:99,y:64,z:0}},context),/changed/);
 assert.throws(()=>a.adopt(saved,selected,{...context,worldId:'other'}),/changed|scope/);
});
test('same typed craft can explicitly select advertised pending work even without carried inputs',async()=>{
 const {createPersona}=require('../src/persona-admission'),{randomUUID}=require('node:crypto'),a=api();const pending=a.advertise(goal(),context)[0];let launched;
 const p=createPersona({worldId:context.worldId,read:()=>({connected:true,health:20,dimension:'overworld',items:['copper_ingot'],players:[],inventory:{copper_ingot:4}}),craftAffordances:()=>({enabled:true,source:'carried_inventory',items:[],max_count:64,quantity_preflight:true,pending_work:[pending]}),checkCraft:()=>({continuation:pending}),impossible:()=>true,start:async g=>{launched=g},stop:async()=>{}});
 const s=p.snapshot();const proposal={schema_version:1,goal_id:randomUUID(),persona_id:'actor',session_id:s.session_id,observation_id:s.observation_id,issued_at:s.observed_at,expires_at:s.observed_at+60,state:'proposed',spec:{kind:'craft',item:'copper_ingot',count:4,deliver:false}};
 assert.equal((await p.submit(proposal)).status,'accepted');assert.deepEqual(launched.personaCraftContinuation,pending);assert.equal(launched.personaWorldId,context.worldId);assert.equal(launched.personaGoalId,proposal.goal_id);assert.notEqual(launched.personaGoalId,pending.source_goal_id);await p.close();
});
test('recorded time uses fixed creation fallback and never turns null into epoch zero',()=>{
 const a=api(),g=goal();delete g.smelting.startedAt;assert.equal(a.advertise(g,context)[0].recorded_at,Date.parse(g.createdAt)/1000);
 g.personaCraftContinuation={id:g.personaGoalId,source_goal_id:g.personaGoalId,recorded_at:null};delete g.createdAt;assert.equal(a.advertise(g,context)[0].recorded_at,null);
});
test('continuation window checks recorded bounds and treats conflict as unresolved',()=>{
 const a=api(),b=goal().smelting;
 assert.equal(a.observeBatch(b,{name:'raw_copper',count:2},{name:'copper_ingot',count:2}),4);
 assert.equal(a.observeBatch(b,null,null),0);
 for(const contents of [[{name:'raw_iron',count:1},null],[null,{name:'iron_ingot',count:1}],[null,{name:'copper_ingot',count:5}]])assert.throws(()=>a.observeBatch(b,...contents),/changed|exceeds/);
});
test('obtain/build invested batches advertise component craft without reviving outer intent, and multiple stations stay separate',()=>{
 const a=api(),g=goal(1,{kind:'build',item:undefined,count:undefined,blueprint:{old:true},smeltingSides:[{...goal(2).smelting,targetInventory:2,count:2,at:1793491201000}],smeltingElsewhere:{nether:{...goal(3).smelting,dimension:'nether'}}});
 const records=a.retain(g);assert.equal(records.length,3);assert.ok(records.every(r=>r.kind==='craft'&&!r.blueprint&&!r.smeltingSides&&!r.smeltingElsewhere));
 const listed=a.advertise(g,context);assert.equal(listed.length,2);assert.equal(listed[0].item,'copper_ingot');assert.equal(listed[0].count,4);assert.equal(listed[0].source_goal_id,g.personaGoalId);
 const selected=a.adopt(g,listed[0],context);assert.equal(selected.remaining.length,2);assert.ok(!selected.mechanical.smeltingSides);assert.equal(a.stations({...goal(4,{smelting:undefined}),suspendedTasks:selected.remaining},context).length,1);
 assert.deepEqual(a.advertise(g,context),a.advertise({suspendedTasks:records},context),'normalization retains stable ids');
});
test('capacity applies before new investment, while an exact retained job stays selectable at the bound',()=>{
 const a=api(),g=goal(8,{suspendedTasks:Array.from({length:7},(_,i)=>goal(i+1))});assert.throws(()=>a.capacity(g),{code:'pending_work_capacity'});
 const caps={pending_work:a.advertise(g,context)};assert.ok(a.prepare(g,{item:'copper_ingot',count:4},context,caps).continuation);assert.throws(()=>a.prepare(g,{item:'copper_ingot',count:4},context,{pending_work:[]}),{code:'stale_pending_craft'});
});
test('same native goal can retain several distinct investments without overwriting their identity',()=>{
 const a=api(),old=goal(1),newer={...old,smelting:{...old.smelting,position:{x:9,y:64,z:0},startedAt:old.smelting.startedAt+1000},suspendedTasks:a.retain(old)};
 assert.equal(a.retain(newer).length,2);assert.equal(a.advertise(newer,context).length,2);
});
