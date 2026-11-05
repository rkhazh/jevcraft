'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Vec3}=require('vec3');
const {Survival,claim}=require('../src/survival');
const arbiter=require('../src/arbiter');

// 232743 began fed and healthy, with no stored food. The ground and inventory
// here are generic; no village, material or route is needed to reproduce it.
function fixture(){
 const items=[],bot={entity:{position:new Vec3(.5,64,.5),height:1.8,width:.6,onGround:true,metadata:{},effects:{}},
  game:{dimension:'overworld',gameMode:'survival',difficulty:'normal',minY:0,height:96},time:{timeOfDay:1000,age:1000},health:20,food:20,oxygenLevel:20,entities:{},
  inventory:{items:()=>items,slots:[]},registry:require('minecraft-data')('1.21.11'),
  blockAt(p){p=p.floored();const solid=p.y<64;return {name:solid?'stone':'air',position:p,stateId:solid?1:0,boundingBox:solid?'block':'empty',shapes:solid?[[0,0,0,1,1,1]]:[],getProperties:()=>({})};},
  world:{raycast:()=>null},clearControlStates(){},setControlState(){},pathfinder:{setGoal(){},movements:{}},on(){},emit(){}};
 const state={shelters:[]},goal={kind:'survive',personaHold:true,survival:state},task={check(){}};
 const survival=Object.assign(Object.create(Survival.prototype),{bot,state,actions:{},report(g,save,step){g.survivalAction=step;save();}});
 return {bot,items,state,goal,task,survival};
}
const work={layer:'work',action:'persona_hold',urgency:'routine',facts:{}};
function winner(f,c=claim(f.bot,f.goal,f.survival)){
 return arbiter.rule(f.bot,[c,work],{goal:f.goal,dry:true}).winner?.layer;
}

test('232743: reserve deficit stays observable but cannot take the persona hold turn',()=>{
 const f=fixture(),c=claim(f.bot,f.goal,f.survival);
 assert.equal(c.action,'obtain_food');assert.equal(c.facts.foodCarried,0);assert.ok(c.facts.foodWanted>0);
 assert.equal(winner(f,c),'work');assert.equal(f.state.foodChoice,undefined);
});

test('recent hurt and a held reserve choice do not turn optional stock into bodily need',()=>{
 const f=fixture();f.bot._recentHurtAt=Date.now();f.bot.health=19;
 require('../src/food-plan').begin(f.state,f.bot,{choice:'food',by:'turn_priority',need:'reserve',supply:0,goal:f.goal});
 const c=claim(f.bot,f.goal,f.survival);assert.equal(c.urgency,'pressing');
 assert.equal(winner(f,c),'work');
});

test('direct survival and its backstop yield without entering optional preparation',async()=>{
 const f=fixture();f.survival.decide=()=>assert.fail('optional question');
 assert.equal(await f.survival.step(f.task,f.goal,()=>{}),false);
 const r=await arbiter.take(f.bot,[{...work,run:async()=>true}],{goal:f.goal,task:f.task,backstop:()=>f.survival.step(f.task,f.goal,()=>{})});
 assert.equal(r.layer,'work');assert.notEqual(r.backstop,true);
});

test('actual hunger and inability to heal still claim a response; ordinary idle retains preparation',()=>{
 for(const [hp,food] of [[20,6],[10,17]]){
  const f=fixture();f.bot.health=hp;f.bot.food=food;
  assert.equal(winner(f),'survival');
 }
 const f=fixture();delete f.goal.personaHold;assert.equal(winner(f),'survival');
});

test('eating carried food remains eligible during persona hold',()=>{
 const f=fixture();f.bot.food=16;f.items.push({name:'bread',count:1,type:f.bot.registry.itemsByName.bread.id});
 const c=require('../src/vitals').claim(f.bot);assert.equal(c.action,'eat');
 assert.equal(winner(f,c),'vitals');
});

test('an approaching threat and an outstanding return remain eligible',()=>{
 const f=fixture();f.bot.entities[1]={id:1,name:'zombie',type:'mob',position:new Vec3(2,64,.5),height:1.95,width:.6,velocity:new Vec3(-.1,0,0),metadata:{}};
 assert.equal(winner(f),'survival');
 const r=fixture();r.state.shaftRetreat={phase:'returning',dimension:'overworld',entry:{x:0,y:68,z:0},bottom:{x:0,y:64,z:0},caps:[],excavationUsed:true};
 assert.equal(claim(r.bot,r.goal,r.survival).facts.pending,true);assert.equal(winner(r),'survival');
});

test('physical lava and air reflexes remain eligible with full food and no reserve',()=>{
 for(const [fluid,oxygen,layer] of [['lava',20,'survival'],['water',1,'vitals']]){
  const f=fixture(),read=f.bot.blockAt;f.bot.oxygenLevel=oxygen;
  f.bot.blockAt=p=>p.y>=64&&p.y<66?{...read(p),name:fluid,type:f.bot.registry.blocksByName[fluid].id}:read(p);
  const c=layer==='survival'?claim(f.bot,f.goal,f.survival):require('../src/vitals').claim(f.bot);
  assert.equal(c.urgency,'body');assert.equal(winner(f,c),layer);
 }
});

test('a stale selected response yields when the need disappears before execution',async()=>{
 const f=fixture();f.bot.food=6;assert.equal(winner(f),'survival');f.bot.food=20;
 f.survival.decide=()=>assert.fail('need disappeared, no reserve question');
 assert.equal(await f.survival.step(f.task,f.goal,()=>{}),false);
});

test('an old night or item-recovery plan cannot mask current hunger or start optional preparation',async()=>{
 for(const pending of [{nightPlan:{plan:'hunt',until:Date.now()+60000}},
  {recovery:{status:'pending',position:{x:20,y:64,z:0},dimension:'overworld'}}]){
  const f=fixture();Object.assign(f.state,pending);f.bot.time.timeOfDay=14000;
  assert.equal(winner(f),'work');
  assert.equal(await f.survival.step(f.task,f.goal,()=>{}),false);
  f.bot.food=6;const c=claim(f.bot,f.goal,f.survival);
  assert.equal(c.action,'obtain_food');assert.equal(winner(f,c),'survival');
 }
});

test('a threat does not grant an optional bed-retrieval chore the turn',async()=>{
 const f=fixture();f.state.bedLeft={x:5,y:64,z:0};
 f.bot.entities[1]={id:1,name:'zombie',type:'mob',position:new Vec3(2,64,.5),height:1.95,width:.6,velocity:new Vec3(-.1,0,0),metadata:{}};
 f.survival.fetchLeftBed=async()=>assert.fail('optional bed retrieval');
 let fled=0;f.survival.flee=async()=>{fled++;return true;};
 assert.equal(await f.survival.step(f.task,f.goal,()=>{}),true);assert.equal(fled,1);
});

test('a real carried meal ends the response without falling through into reserve gathering',async()=>{
 const f=fixture();f.bot.food=16;f.items.push({name:'bread',count:1,type:f.bot.registry.itemsByName.bread.id});
 f.bot.equip=async()=>{};f.bot.consume=async()=>{f.bot.food=20;f.items.length=0;};
 f.bot.deactivateItem=()=>{};
 f.survival.decide=()=>assert.fail('meal ended need; no reserve question');
 const decisions=require('../src/decisions');
 decisions.useStandIn({decide(id,{tree}){assert.equal(id,'meal');return {path:['eat_bread'],action:tree.eat_bread};}});
 try{assert.equal(await f.survival.step(f.task,f.goal,()=>{}),true);}finally{decisions.useStandIn(null);}
 assert.equal(f.bot.food,20);assert.equal(f.goal.survivalAction.action,'eat');assert.equal(f.state.foodChoice,undefined);
});

test('a response that disappears while its decision is pending cannot dispatch its old action',async()=>{
 const f=fixture();f.bot.food=6;
 const decisions=require('../src/decisions');
 decisions.useStandIn({decide(_id,{tree}){f.bot.food=20;return {path:['obtain_food'],action:tree.obtain_food};}});
 try{
  const answer=await f.survival.decide(f.task,f.goal,()=>{}, {id:'survival_priority',tree:{obtain_food:{description:'Meet the current bodily need',run:()=>assert.fail('old response dispatched')},continue_request:{description:'Continue the request',run:()=>false}},state:{health:20,food:6}});
  assert.equal(f.bot.food,20,'the delayed answer fixture must change the actual need');
  assert.equal(answer.stale,true);
 }finally{decisions.useStandIn(null);}
});

test('an answered response rechecks eligibility at action dispatch',async()=>{
 const f=fixture();f.bot.food=6;
 const answer=await f.survival.decide(f.task,f.goal,()=>{}, {id:'survival_priority',tree:{obtain_food:{description:'Meet the current bodily need',run:()=>assert.fail('old response dispatched')}},state:{health:20,food:6}});
 f.bot.food=20;assert.equal(await answer.action.run(),false);
});

test('an old response cannot borrow an unrelated newly arriving need',async()=>{
 for(const first of ['hunger','threat']){
  const f=fixture(),threat={id:1,name:'zombie',type:'mob',position:new Vec3(2,64,.5),height:1.95,width:.6,velocity:new Vec3(-.1,0,0),metadata:{}};
  if(first==='hunger')f.bot.food=6;else f.bot.entities[1]=threat;
  const answer=await f.survival.decide(f.task,f.goal,()=>{}, {id:'survival_priority',tree:{obtain_food:{description:'A response to the original cause',run:()=>assert.fail('a different need authorized the old response')}},state:{}});
  if(first==='hunger'){f.bot.food=20;f.bot.entities[1]=threat;}else{f.bot.entities={};f.bot.food=6;}
  assert.equal(f.survival.eligibleNow(f.goal),true,'the new need still requires a fresh response');
  assert.equal(await answer.action.run(),false);
 }
});

test('a hungry bot retains pocket exit and exposure context without optional pocket chores',async()=>{
 const f=fixture(),refuge={origin:{x:0,y:64,z:0},dimension:'overworld',verifiedAt:Date.now()},read=f.bot.blockAt;
 f.state.shelters=[refuge];f.bot.food=6;f.bot.time.timeOfDay=14000;
 const shell=new Set(require('../src/shelter').enclosure(refuge).map(p=>`${p.x},${p.y},${p.z}`));
 f.bot.blockAt=p=>shell.has(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`)?{...read(p),name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]}:read(p);
 f.survival.actions.planFor=()=>[];
 let seen;
 f.survival.decide=async(_task,_goal,_save,question)=>{seen=question;return {stale:true};};
 await f.survival.step(f.task,f.goal,()=>{});
 assert.equal(seen?.id,'pocket_next','the existing pocket response describes its exits and exposure');
 assert.ok(seen.tree.stay);assert.ok(seen.tree.leave);assert.equal(seen.tree.night_mine,undefined);assert.equal(seen.tree.stash_valuables,undefined);
});

test('a food hunt already chosen for actual hunger continues, but yields when fed',async()=>{
 const f=fixture();f.bot.food=6;f.state.nightPlan={plan:'hunt',food:true,until:Date.now()+60000};
 let hunted=0;f.survival.huntStep=async()=>{hunted++;return true;};
 f.survival.decide=()=>assert.fail('already admitted food hunt should continue');
 assert.equal(await f.survival.step(f.task,f.goal,()=>{}),true);assert.equal(hunted,1);
 f.bot.food=20;assert.equal(await f.survival.step(f.task,f.goal,()=>{}),false);assert.equal(hunted,1);
});

test('held protective waiting really yields time and remains cancellable without renewing its deadline',async()=>{
 const f=fixture(),refuge={origin:{x:0,y:64,z:0},dimension:'overworld',emergency:true,verifiedAt:new Date().toISOString()},read=f.bot.blockAt;
 f.state.shelters=[refuge];f.bot.health=4;f.bot.food=17;f.bot.time.timeOfDay=14000;
 const shell=new Set(require('../src/shelter').enclosure(refuge).map(p=>`${p.x},${p.y},${p.z}`));
 f.bot.blockAt=p=>shell.has(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`)?{...read(p),name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]}:read(p);
 f.bot.world.raycast=()=>f.bot.blockAt(new Vec3(1,65,0));
 f.bot.entities[7]={id:7,name:'pillager',type:'mob',position:new Vec3(4.5,64,.5),velocity:new Vec3(0,0,0),height:1.95,width:.6,metadata:{}};
 const until=Date.now()+60000;f.state.sealedWait={until};f.survival.actions.planFor=()=>[];
 f.survival.decide=()=>assert.fail('the protective wait was already chosen');
 let cancelled=false,finished=false;f.task.check=()=>{if(cancelled)throw Object.assign(new Error('cancelled'),{name:'Cancelled'});};
 const pending=f.survival.step(f.task,f.goal,()=>{}).then(value=>{finished=true;return {value};},error=>{finished=true;return {error};});
 await new Promise(r=>setTimeout(r,150));const premature=finished;cancelled=true;
 const result=await pending;
 assert.equal(premature,false,'a protected wait cannot become a millisecond non-action loop');
 assert.equal(result.error?.name,'Cancelled');assert.equal(f.goal.survivalAction.action,'wait_in_shelter');assert.equal(f.state.sealedWait.until,until);
});

test('a fresh sheltered retreat can assess safe return without forced ascent or optional chores',async()=>{
 const f=fixture(),refuge={origin:{x:0,y:64,z:0},top:{x:0,y:68,z:0},dimension:'overworld',shaft:true,verifiedAt:Date.now()},read=f.bot.blockAt;
 f.state.shelters=[refuge];
 const shell=new Set(require('../src/shelter').enclosure(refuge).map(p=>`${p.x},${p.y},${p.z}`));
 f.bot.blockAt=p=>shell.has(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`)?{...read(p),name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]}:read(p);
 f.state.shaftRetreat={phase:'sheltered',dimension:'overworld',entry:{x:0,y:68,z:0},bottom:{x:0,y:64,z:0},caps:[],excavationUsed:true};
 assert.equal(winner(f),'survival');assert.equal(claim(f.bot,f.goal,f.survival).facts.pending,true);
 f.survival.actions.planFor=()=>[];f.survival.stepShaftReturn=()=>assert.fail('pocket assessment must choose whether to leave');
 let seen;f.survival.decide=async(_task,_goal,_save,q)=>{seen=q;return {stale:true};};
 await f.survival.step(f.task,f.goal,()=>{});
 assert.equal(seen.id,'pocket_next');assert.ok(seen.tree.stay);assert.ok(seen.tree.leave);assert.equal(seen.tree.night_mine,undefined);
 assert.equal(f.state.shaftRetreat.phase,'sheltered');
 for(const record of [null,{...f.state.shaftRetreat,dimension:'the_nether'}, {...f.state.shaftRetreat,entry:{x:1,y:68,z:0}}, {...f.state.shaftRetreat,entry:{x:0,y:64,z:0}}]){
  f.state.shaftRetreat=record;delete f.bot._arbiter;assert.equal(winner(f),'work','an arbitrary sealed position is not a retreat obligation');
 }
});

test('suspending a fed food hunt releases its threat exemption before a direct survival pass',async()=>{
 const f=fixture();f.bot.game.dimension='the_nether';
 f.survival.foodHunt(f.goal,()=>{},'hoglin');f.bot._nightHunt={name:'hoglin',until:f.state.nightPlan.until};
 f.bot.entities[1]={id:1,name:'hoglin',type:'mob',position:new Vec3(2,64,.5),height:1.4,width:1.4,velocity:new Vec3(0,0,0),metadata:{}};
 assert.equal(require('../src/danger').immediateThreat(f.bot),undefined);
 let fled=0;f.survival.flee=async()=>{fled++;return true;};
 await f.survival.step(f.task,f.goal,()=>{});
 assert.equal(f.bot._nightHunt,undefined);assert.equal(fled,1);assert.ok(f.state.nightPlan,'keep the historical plan without its threat exemption');
});

test('claim-first arbitration releases only a hunt whose current executor is ineligible',()=>{
 const f=fixture();f.bot.game.dimension='the_nether';f.bot.food=6;
 f.survival.foodHunt(f.goal,()=>{},'hoglin');f.bot._nightHunt={name:'hoglin',until:f.state.nightPlan.until};
 f.bot.entities[1]={id:1,name:'hoglin',type:'mob',position:new Vec3(2,64,.5),height:1.4,width:1.4,velocity:new Vec3(0,0,0),metadata:{}};
 assert.equal(claim(f.bot,f.goal,f.survival).facts.need,'hunger');assert.ok(f.bot._nightHunt,'the admitted food hunter still owns this mob');
 f.bot.food=20;const c=claim(f.bot,f.goal,f.survival);
 assert.equal(c.action,'escape_threat');assert.equal(f.bot._nightHunt,undefined);assert.equal(winner(f,c),'survival');
});
