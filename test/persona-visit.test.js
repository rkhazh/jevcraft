'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{Vec3}=require('vec3'),{randomUUID}=require('node:crypto');
const registry=require('minecraft-data')('1.21.11'),Block=require('prismarine-block')('1.21.11');
const visit=require('../src/persona-visit'),{createPersona}=require('../src/persona-admission');
function fixture(){
 const cells=new Map(),projects=[{id:'project',dimension:'overworld',label:'Observed room',bounds:{min:{x:8,y:63,z:0},max:{x:12,y:72,z:4}},entrance:{x:9.5,y:64,z:0.5},updatedAt:'2026-11-05T00:00:00Z'}],places=[{id:'place',label:'Saved bank',position:{x:6,y:64,z:3},dimension:'overworld',at:'2026-11-04T00:00:00Z'}],known={landmarks:[{kind:'ruined_portal',x:20,y:65,z:0,dimension:'overworld',firstAt:'2026-11-03T00:00:00Z'}]};
 const bot={registry,entity:{position:new Vec3(.5,64,.5),onGround:true,width:.6,height:1.8},game:{dimension:'overworld',gameMode:'survival'},buildRegistry:{all:()=>projects},companionMemory:{context:()=>({places})},pathfinder:{setGoal(){}},clearControlStates(){}};
 bot.blockAt=p=>{const q=p.floored(),record=cells.get(q.toString()),b=record?Block.fromProperties(registry.blocksByName[record[0]].id,record[1]||{},0):Block.fromStateId(registry.blocksByName[q.y<64?'stone':'air'].defaultState,0);b.position=q;return b;};
 const opts={known,principal:'persona:actor',enabled:true},resolve=id=>visit.resolveDestination(bot,id,opts),set=(x,y,z,name,properties)=>cells.set(new Vec3(x,y,z).toString(),[name,properties]);
 return {bot,projects,places,known,opts,resolve,set,goal:()=>({kind:'visit',target:'project:project',from:'persona:actor',destination:resolve('project:project'),personaVisitPolicy:{destination:resolve('project:project'),startedAt:Date.now()}})};
}
test('visit catalog reuses existing identities and prefers recorded entrances; resolving is independent of the nearest-list cap',()=>{
 const f=fixture(),cap=visit.capabilities(f.bot,f.opts);assert.equal(cap.enabled,true);assert.equal(cap.max_distance,96);assert.equal(cap.destinations.length,3);assert.ok(cap.destinations.every(d=>d.access==='unverified'));
 const project=cap.destinations.find(d=>d.id==='project:project');assert.deepEqual(project.position,f.projects[0].entrance);assert.equal(project.observed_at,Date.parse(f.projects[0].updatedAt)/1000);
 f.known.landmarks[0].firstAt=1700000000000;assert.equal(visit.capabilities(f.bot,f.opts).destinations.find(d=>d.id.startsWith('landmark:')).observed_at,1700000000);
 assert.equal(visit.capabilities(f.bot,{...f.opts,enabled:false}).enabled,false);assert.deepEqual(visit.capabilities(f.bot,{...f.opts,enabled:false}).destinations,[]);
 for(let i=0;i<40;i++)f.places.push({id:`p${i}`,label:'Nearby',position:{x:.5,y:64,z:.5},dimension:'overworld'});
 assert.equal(visit.capabilities(f.bot,f.opts).destinations.length,32);assert.ok(f.resolve('project:project'));
 f.bot.entity.position.x=200;assert.equal(visit.capabilities(f.bot,f.opts).destinations.length,0);assert.ok(f.resolve('project:project'));
});
test('current footing allows fractional slabs and low stairs but rejects airborne, hazards and collision',()=>{
 const f=fixture();assert.equal(visit.safeFooting(f.bot),true);
 f.set(0,64,0,'stone_slab',{type:'bottom',waterlogged:false});f.bot.entity.position.y=64.5;assert.equal(visit.safeFooting(f.bot),true);
 f.set(0,64,0,'stone_brick_stairs',{half:'bottom',facing:'east',shape:'straight',waterlogged:false});f.bot.entity.position.x=.19;assert.equal(visit.safeFooting(f.bot),true);
 f.bot.entity.position.x=.5;assert.equal(visit.safeFooting(f.bot),false);f.bot.entity.position.x=.19;f.bot.entity.onGround=false;assert.equal(visit.safeFooting(f.bot),false);
 f.bot.entity.onGround=true;f.set(0,64,0,'lava');assert.equal(visit.safeFooting(f.bot),false);
});
test('bounded visit uses native visitPlace radius with navigation-only options and proves current near-arrival',async()=>{
 const f=fixture(),goal=f.goal();let calls=0;
 const result=await visit.visitStep(f.bot,{check(){}},goal,()=>{},{resolve:f.resolve,navigate:async(_b,_t,g,opts)=>{calls++;assert.equal(g.rangeSq,4);assert.equal(opts.onFoot,true);assert.equal(opts.passing,false);assert.equal(opts.navigationOnly,true);assert.ok(opts.timeoutMs<=60000);f.bot.entity.position=new Vec3(7.5,64,.5);}});
 assert.equal(result,true);assert.equal(calls,1);assert.equal(goal.visitArrival.distance,2);assert.equal(visit.verifyVisit(f.bot,goal,{resolve:f.resolve}),true);
});
test('visit acknowledgement is insufficient and moved/deleted/dimension-changed references refuse execution',async()=>{
 const f=fixture();await assert.rejects(visit.visitStep(f.bot,{check(){}},f.goal(),()=>{},{resolve:f.resolve,navigate:async()=>{}}),/arrival/);
 for(const change of [()=>f.projects[0].entrance.x++,()=>f.projects[0].dimension='nether',()=>f.projects.splice(0)]){
  const g=f.goal();change();await assert.rejects(visit.visitStep(f.bot,{check(){}},g,()=>{},{resolve:f.resolve,navigate:async()=>assert.fail('must not dispatch')}),/destination/);
  f.projects.splice(0,f.projects.length,{id:'project',label:'Room',dimension:'overworld',entrance:{x:9.5,y:64,z:.5}});
 }
});
test('reference changes and cancellation during native navigation unwind without retrying; metadata refresh is harmless',async()=>{
 const f=fixture(),g=f.goal();f.projects[0].label='Renamed';f.projects[0].updatedAt=new Date().toISOString();assert.equal(visit.destinationMatches(g.destination,f.resolve(g.target)),true);
 await assert.rejects(visit.visitStep(f.bot,{check(){}},g,()=>{},{resolve:f.resolve,navigate:async(_b,t)=>{f.projects[0].entrance.x++;t.check();}}),/destination/);
 const cancelled=Object.assign(new Error('cancelled'),{name:'Cancelled'});await assert.rejects(visit.visitStep(f.bot,{check(){throw cancelled}},f.goal(),()=>{},{resolve:f.resolve,navigate:async()=>assert.fail()}),{name:'Cancelled'});
 const expired=f.goal();expired.personaVisitPolicy.startedAt=Date.now()-60001;await assert.rejects(visit.visitStep(f.bot,{check(){}},expired,()=>{},{resolve:f.resolve,navigate:async()=>assert.fail()}),/deadline/);
});
test('visit admission binds an advertised ref and completion uses the existing observed goal receipt',async()=>{
 const f=fixture();let goal;const body={connected:true,health:20,dimension:'overworld',position:f.bot.entity.position,items:[],players:[],inventory:{}};
 const persona=createPersona({read:()=>({...body,position:f.bot.entity.position}),start:async spec=>{goal=spec;},stop:async()=>goal,visitAffordances:()=>visit.capabilities(f.bot,f.opts),resolveVisit:f.resolve,verifyVisit:g=>visit.verifyVisit(f.bot,g,{resolve:f.resolve})});
 const proposal=()=>{const s=persona.snapshot();return {schema_version:1,goal_id:randomUUID(),persona_id:'actor',session_id:s.session_id,observation_id:s.observation_id,issued_at:Date.now()/1000,expires_at:Date.now()/1000+60,state:'proposed',spec:{kind:'visit',target:'project:project'}};};
 const stale=proposal();f.projects[0].entrance.x++;assert.equal((await persona.submit(stale)).reason,'stale_visit_destination');
 const p=proposal();p.expires_at=p.issued_at+120;const accepted=await persona.submit(p);assert.equal(accepted.status,'accepted');assert.ok(accepted.expires_at<=Date.now()/1000+60);assert.ok(goal.navigationOnly);assert.ok(goal.personaHold);persona.finish(p.goal_id,'complete',goal);assert.equal(persona.snapshot().last_result.verified,false);
 const next=proposal();await persona.submit(next);f.bot.entity.position=new Vec3(8.5,64,.5);persona.finish(next.goal_id,'complete',goal);assert.equal(persona.snapshot().last_result.verified,true);assert.equal(persona.snapshot().last_result.visit_arrival.distance,2);
 assert.equal((await persona.submit(proposal())).reason,'already_near_visit_destination');
 await persona.close();
});
test('real native navigate excludes flight, boat clearing, way-down and opportunistic preparation in navigation-only mode',async t=>{
 const {EventEmitter}=require('node:events'),{goals}=require('mineflayer-pathfinder'),{SurvivalMovements}=require('../src/movement');
 const f=fixture(),bot=Object.assign(new EventEmitter(),f.bot),flight=require('../src/flight'),boats=require('../src/boats'),wayDown=require('../src/way-down'),motion=require('../src/motion');
 Object.assign(bot,{version:'1.21.11',entities:{},health:20,food:20,oxygenLevel:20,inventory:{items:()=>[],slots:[]},controlState:{},_ownedBoats:new Map([['boat',{}]]),setControlState(){}});
 const called={flight:0,boat:0,descent:0,route:0};
 t.mock.method(flight,'canFly',()=>true);t.mock.method(flight,'flyNavigate',async()=>{called.flight++;});
 t.mock.method(boats,'clearOwnedBoatAtFeet',async()=>{called.boat++;});t.mock.method(wayDown,'comeDownFirst',async()=>{called.descent++;});t.mock.method(motion,'fallUnder',()=>null);
 const movements=new SurvivalMovements(bot);Object.assign(movements,{canDig:true,allow1by1towers:true,scafoldingBlocks:[1]});
 bot.pathfinder={movements,setGoal(){},goto:async()=>{called.route++;assert.equal(movements.canDig,false);assert.equal(movements.allow1by1towers,false);assert.deepEqual(movements.scafoldingBlocks,[]);bot.entity.position=new Vec3(8.5,64,.5);}};
 const task={check(){},opportunityClient:{systemOne:()=>assert.fail('no preparation model call')}};
 await require('../src/skills').navigate(bot,task,new goals.GoalNear(9,64,0,2),{navigationOnly:true,timeoutMs:500});
 assert.deepEqual(called,{flight:0,boat:0,descent:0,route:1});assert.equal(movements.canDig,true);assert.deepEqual(movements.scafoldingBlocks,[1]);
 await require('../src/skills').navigate(bot,task,new goals.GoalNear(20,64,0,2),{timeoutMs:500});assert.equal(called.flight,1,'ordinary upstream flight behavior preserved');
});
test('native recovery settles before a visit releases control; a delayed look cannot move or clear the next action',async()=>{
 const {EventEmitter}=require('node:events'),{SurvivalMovements}=require('../src/movement'),skills=require('../src/skills');
 const f=fixture(),bot=Object.assign(new EventEmitter(),f.bot);let clock=0,releaseLook,startedLook;const looking=new Promise(r=>{startedLook=r;}),controls=[];
 Object.assign(bot,{version:'1.21.11',entities:{},health:20,food:20,oxygenLevel:20,inventory:{items:()=>[],slots:[]},controlState:{},setControlState:(...args)=>controls.push(args),clearControlStates:()=>controls.push(['clear']),lookAt:()=>{startedLook();return new Promise(r=>{releaseLook=r;});}});
 bot.entity.position=new Vec3(.1,64,.5);const movements=new SurvivalMovements(bot);bot.pathfinder={movements,setGoal(){},goto:async()=>new Promise(()=>{})};
 const goal=f.goal();goal.personaVisitPolicy.startedAt=0;
 const running=visit.visitStep(bot,{check(){}},goal,()=>{},{now:()=>clock,resolve:f.resolve,navigate:(b,t,g,o)=>skills.navigate(b,t,g,{...o,stallMs:1})});
 await looking;clock=60001;await assert.rejects(running,/deadline/);
 controls.push(['replacement_action']);const before=controls.length;releaseLook();await new Promise(r=>setTimeout(r,100));assert.equal(controls.length,before,'late recovery must neither write nor clear replacement controls');
});
test('refused hanging, stale and expired visits preserve an existing protective crouch',async()=>{
 const {EventEmitter}=require('node:events'),{SurvivalMovements}=require('../src/movement');
 for(const refusal of ['hanging','stale','expired']){
  const f=fixture(),bot=Object.assign(new EventEmitter(),f.bot),controls=[];
  Object.assign(bot,{version:'1.21.11',entities:{},health:20,food:20,oxygenLevel:20,inventory:{items:()=>[],slots:[]},controlState:{sneak:true},setControlState:(name,value)=>{controls.push([name,value]);bot.controlState[name]=value;},clearControlStates:()=>{controls.push(['clear']);bot.controlState.sneak=false;}});
  bot.entity.position=new Vec3(1.1,64,.5);
  bot.blockAt=p=>{const q=p.floored(),b=Block.fromStateId(registry.blocksByName[q.y<=40||q.x===0&&q.y===63?'stone':'air'].defaultState,0);b.position=q;return b;};
  bot.pathfinder={movements:new SurvivalMovements(bot),setGoal(){},goto:async()=>assert.fail('no hanging route dispatch')};
  const goal=f.goal();if(refusal==='stale')f.projects[0].entrance.x++;if(refusal==='expired')goal.personaVisitPolicy.startedAt=Date.now()-60001;
  await assert.rejects(visit.visitStep(bot,{check(){}},goal,()=>{},{resolve:f.resolve}),/fall|destination|deadline/);
  assert.equal(bot.controlState.sneak,true,refusal);assert.deepEqual(controls,[],refusal);
 }
});
for(const failure of [false,true])test(`real work loop ${failure?'terminates NoPath without generic persist':'completes bounded visit before optional preparation'}`,{timeout:5000},async()=>{
 const {EventEmitter}=require('node:events'),{SurvivalMovements}=require('../src/movement'),{Survival}=require('../src/survival'),{Task}=require('../src/skills');
 const f=fixture(),bot=Object.assign(new EventEmitter(),f.bot),goal={...f.goal(),personaHold:true,navigationOnly:true,request:'Visit an observed reference'};
 Object.assign(bot,{version:'1.21.11',entities:{},players:{},time:{timeOfDay:1000,age:1000},health:20,food:20,oxygenLevel:20,inventory:{items:()=>[],slots:[]},world:{raycast:()=>null},findBlocks:()=>[],controlState:{},setControlState(){},chat:()=>assert.fail('no unrelated chat'),_personaVisitResolve:f.resolve});
 bot.game.minY=-64;bot.game.height=384;bot.entity.metadata={};bot.entity.effects={};let walks=0;
 bot.pathfinder={movements:new SurvivalMovements(bot),setGoal(){},goto:async()=>{walks++;if(failure)throw Object.assign(new Error('No path to recorded reference'),{name:'NoPath'});bot.entity.position=new Vec3(8.5,64,.5);}};
 const client={systemOne:async()=>assert.fail('bounded visit must not commission preparation or persistence')},state={shelters:[]};
 const survival=Object.assign(Object.create(Survival.prototype),{bot,state,actions:{},client});
 const running=require('../src/work').runGoal(bot,new Task('visit','visit'),goal,{save(){}},{survival,decisionClient:client,maxSteps:3});
 if(failure)await assert.rejects(running,e=>e.personaVisitTerminal&&e.name==='NoPath');else assert.equal((await running).goal.status,'complete');
 assert.equal(walks,1);
});
