'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Vec3}=require('vec3');
const {Survival}=require('../src/survival');
const retreat=require('../src/shaft-retreat');

// Geometry and observed cap sequence from 205400, translated to the origin.
// Physical actions are simulated; planning, leave selection and persistence are real.
function fixture(){
 const blocks=new Map(),dug=[];let rises=true;
 const put=(p,name)=>blocks.set(`${p.x},${p.y},${p.z}`,name);
 const at=p=>{p=p.floored();const name=blocks.get(`${p.x},${p.y},${p.z}`)??(p.y<64?'stone':'air');return {name,stateId:({air:0,grass_block:9,dirt:10,granite:2,cobblestone:14})[name]??1,position:p,boundingBox:name==='air'?'empty':'block',shapes:name==='air'?[]:[[0,0,0,1,1,1]],diggable:true};};
 for(let y=40;y<64;y++)put(new Vec3(0,y,0),'air');
 const caps=[42,45,48,51,54,57,63].map(y=>{const p=new Vec3(0,y,0),name=y===54?'granite':y===57?'cobblestone':'dirt';put(p,name);return {position:{...p},name,stateId:at(p).stateId};});
 const bot={_client:{write(){}},entity:{position:new Vec3(.5,40,.5),onGround:true},game:{dimension:'overworld',gameMode:'survival',minY:0,height:96},health:20,food:20,oxygenLevel:20,entities:{},time:{timeOfDay:1000},blockAt:at,inventory:{items:()=>[{name:'dirt',count:64},{name:'stone_pickaxe',count:1}],slots:[]}};
 const refuge={origin:{x:0,y:40,z:0},top:{x:0,y:43,z:0},shaft:true,emergency:true,dimension:'overworld'};
 const state={shelters:[refuge],shaftRetreat:{dimension:'overworld',entry:{x:0,y:64,z:0},bottom:{x:0,y:40,z:0},phase:'sheltered',caps,excavationUsed:true}};
 const actions={dig:async(_bot,_task,p)=>{bot._client.write('block_dig',{status:0,location:p});bot._client.write('block_dig',{status:2,location:p});dug.push({...p});put(p,'air');},navigate:async()=>{},pillar:async(_bot,_task,target,options)=>{
  if(!rises)return;
  for(let y=Math.floor(bot.entity.position.y)+2;y<=target+1;y++){const p=new Vec3(0,y,0),b=at(p);if(b.boundingBox==='block'){assert.equal(options.canDig(b),true);await options.dig(bot,{},p,{requireDrops:false});}}
  put(new Vec3(0,target-1,0),'dirt');bot.entity.position.y=target;
 }};
 const survival=Object.assign(Object.create(Survival.prototype),{bot,state,actions,report(goal,save,action){goal.survivalAction=action;save();}});
 const goal={kind:'survive',personaHold:true,survival:state},task={check(){}};
 return {bot,state,refuge,goal,task,survival,dug,put,stopRising(){rises=false;}};
}

test('205400 shaft leave returns up the recorded column instead of digging eight side cells and forgetting it',async()=>{
 const f=fixture();let saved=0;
 const first=await f.survival.leave(f.task,f.goal,()=>saved++,f.refuge);
 assert.equal(first,false,'a partial climb is not a completed leave');
 assert.ok(f.state.shelters.includes(f.refuge),'keep refuge until actual return');
 assert.ok(f.dug.every(p=>p.x===0&&p.z===0),'no side excavation');
 for(let n=0;n<8&&f.bot.entity.position.y<64;n++)await f.survival.leave(f.task,f.goal,()=>saved++,f.refuge);
 assert.equal(f.bot.entity.position.y,64);
 assert.equal(f.state.shaftRetreat.phase,'returned');
 assert.equal(f.state.shelters.includes(f.refuge),false);
 assert.equal(f.goal.survivalAction.action,'returned_from_shaft');
 assert.equal(f.goal.survivalAction.surface,true);
 assert.equal(f.goal.survivalAction.supported,true);
 assert.ok(saved>0);
});

test('shaft state survives restarts and held stance cannot spend excavation again after descent or return',async()=>{
 const f=fixture();f.survival.state=JSON.parse(JSON.stringify(f.state));
 assert.equal(f.survival.shaftColumn({radius:0}).bottom,undefined);
 const start=new Vec3(0,40,0),bottom=new Vec3(0,37,0);
 assert.equal(await f.survival.digShaft(f.task,f.goal,()=>{}, {start,bottom,here:start,spot:'0,0',stance:true}),false);
 assert.deepEqual(f.dug,[]);
 f.survival.state.shaftRetreat.phase='returned';
 assert.equal(f.survival.shaftColumn({radius:0}).bottom,undefined);
 assert.deepEqual(f.survival.state.shaftRetreat.entry,{x:0,y:64,z:0});
});

test('shaft leave with no physical rise preserves obligation and never reports success',async()=>{
 const f=fixture();f.stopRising();
 assert.equal(await f.survival.leave(f.task,f.goal,()=>{},f.refuge),false);
 assert.equal(f.bot.entity.position.y,40);
 assert.equal(f.state.shaftRetreat.phase,'returning');
 assert.ok(f.state.shelters.includes(f.refuge));
 assert.match(f.state.shaftRetreat.failure,/no verified progress/);
});

test('changed, foreign, fluid and unloaded caps block ascent without destructive fallback',async()=>{
 for(const obstruction of ['stone','chest','water',null]){
  const f=fixture(),original=f.bot.blockAt;
  f.bot.blockAt=p=>p.x===0&&p.y===45&&p.z===0?(obstruction===null?null:{...original(p),name:obstruction,stateId:777}):original(p);
  assert.equal(retreat.preflight(f.bot,f.state).ok,false);
  assert.equal(await f.survival.leave(f.task,f.goal,()=>{},f.refuge),false);
  assert.deepEqual(f.dug,[]);assert.equal(f.bot.entity.position.y,40);
  assert.equal(f.state.shaftRetreat.phase,'returning');
 }
});

test('unloaded and flooded neighbors of the return column are not assumed safe',()=>{
 for(const neighbor of [null,'water','lava']){
  const f=fixture(),read=f.bot.blockAt;
  f.bot.blockAt=p=>p.x===1&&p.y===45&&p.z===0?(neighbor===null?null:{...read(p),name:neighbor}):read(p);
  assert.equal(retreat.preflight(f.bot,f.state).ok,false);
 }
});

test('cancellation preserves original entry and pending return',async()=>{
 const f=fixture();f.task.check=()=>{throw Object.assign(new Error('cancelled'),{name:'Cancelled'});};
 await assert.rejects(f.survival.leave(f.task,f.goal,()=>{},f.refuge),{name:'Cancelled'});
 assert.equal(f.state.shaftRetreat.phase,'returning');assert.equal(f.state.shaftRetreat.entry.y,64);assert.deepEqual(f.dug,[]);
});

test('unseen distant wardens retain the excavation budget while real closing threats and hits interrupt ascent',async()=>{
 const f=fixture();
 f.bot.world={raycast:()=>({position:new Vec3(1,41,0)})};
 f.bot.entities={1:{id:1,name:'warden',position:new Vec3(17.5,40,.5),velocity:new Vec3(0,0,0),height:2.9}};
 assert.equal(require('../src/danger').threats(f.bot,24)[0].visible,false);
 assert.equal(retreat.urgent(f.bot),false);
 assert.equal(f.survival.shaftColumn({radius:0}).bottom,undefined);
 await f.survival.leave(f.task,f.goal,()=>{},f.refuge);
 assert.ok(f.bot.entity.position.y>40);
 f.bot.entities[1].position=new Vec3(6.5,f.bot.entity.position.y,.5);f.bot.entities[1].velocity=new Vec3(-.2,0,0);
 assert.equal(retreat.urgent(f.bot),true);
 const before=f.bot.entity.position.y;
 await assert.rejects(f.survival.leave(f.task,f.goal,()=>{},f.refuge),{name:'NeedsSafety'});
 assert.equal(f.bot.entity.position.y,before);
 f.bot.entities={};f.bot._recentHurtAt=Date.now();
 await assert.rejects(f.survival.leave(f.task,f.goal,()=>{},f.refuge),{name:'NeedsSafety'});
 assert.equal(f.state.shaftRetreat.entry.y,64);
});

test('an unseen warden within sonic range and a visible shooter at ten blocks preempt shaft return',async()=>{
 const f=fixture();f.bot.world={raycast:()=>({position:new Vec3(1,41,0)})};
 f.bot.entities={1:{id:1,name:'warden',position:new Vec3(10.5,40,.5),velocity:new Vec3(0,0,0),height:2.9}};
 assert.equal(require('../src/danger').threats(f.bot,24)[0].visible,false);
 await assert.rejects(f.survival.leave(f.task,f.goal,()=>{},f.refuge),{name:'NeedsSafety'});
 f.bot.entities[1].name='skeleton';f.bot.world.raycast=()=>null;
 await assert.rejects(f.survival.leave(f.task,f.goal,()=>{},f.refuge),{name:'NeedsSafety'});
 assert.deepEqual(f.dug,[]);
 f.bot.entities[1].name='blaze';f.bot.entities[1].position=new Vec3(45.5,40,.5);
 await assert.rejects(f.survival.leave(f.task,f.goal,()=>{},f.refuge),{name:'NeedsSafety'});
});

test('a partial descent survives restart as a return obligation before any completed refuge exists',()=>{
 const f=fixture();f.state.shelters=[];delete f.state.shaftRetreat;f.bot.entity.position.y=64;
 const state=retreat.begin(f.bot,f.state,new Vec3(0,64,0),new Vec3(0,61,0));
 assert.equal(state.phase,'descending');
 f.state.shaftRetreat=JSON.parse(JSON.stringify(state));f.bot.entity.position.y=62;
 assert.equal(retreat.resume(f.bot,f.state),true);
 assert.equal(f.state.shaftRetreat.phase,'returning');
 assert.equal(f.state.shaftRetreat.entry.y,64);
 assert.equal(f.survival.shaftColumn().bottom,undefined);
});

test('real shaft dig persists its original entry before mutation and failed descent becomes returning',async()=>{
 const f=fixture();f.state.shelters=[];delete f.state.shaftRetreat;f.bot.entity.position.y=64;let saved;
 f.survival.actions.dig=async()=>{
  assert.equal(saved.shaftRetreat.entry.y,64);assert.equal(saved.shaftRetreat.excavationUsed,true);
  throw Object.assign(new Error('interrupted'),{name:'Cancelled'});
 };
 const start=new Vec3(0,64,0),bottom=new Vec3(0,61,0);
 await assert.rejects(f.survival.digShaft(f.task,f.goal,()=>{saved=JSON.parse(JSON.stringify(f.state));},{start,bottom,here:start,spot:'0,0',stance:true}),{name:'Cancelled'});
 assert.equal(saved.shaftRetreat.phase,'returning');assert.equal(saved.shaftRetreat.entry.y,64);
});

test('a cap receipt requires an actual own-placement receipt, not merely solid material',()=>{
 const f=fixture(),p=new Vec3(0,42,0);f.state.shaftRetreat.caps=[];f.state.shaftRetreat.beganAt=Date.now();
 assert.equal(retreat.noteCap(f.bot,f.state,p,f.goal),false);
 f.goal.laid={'0,42,0':{name:'dirt',at:Date.now()}};
 assert.equal(retreat.noteCap(f.bot,f.state,p,f.goal),false,'persisted worldless goal receipts do not prove this cap');
 require('../src/own-blocks').noteLaid(f.bot,f.bot.blockAt(p),{at:f.state.shaftRetreat.beganAt-1});
 assert.equal(retreat.noteCap(f.bot,f.state,p,f.goal),false,'a current-session receipt predating this descent is insufficient');
 require('../src/own-blocks').noteLaid(f.bot,f.bot.blockAt(p),{goal:f.goal});
 assert.equal(retreat.noteCap(f.bot,f.state,p,f.goal),true);
 assert.equal(retreat.capMatches(f.bot,f.state.shaftRetreat,p),true);
});

test('unsupported footing blocks return without selecting a side resting cell',async()=>{
 const f=fixture();f.put(new Vec3(0,39,0),'air');
 assert.equal(await f.survival.leave(f.task,f.goal,()=>{},f.refuge),false);
 assert.equal(f.bot.entity.position.y,40);assert.deepEqual(f.dug,[]);
 assert.match(f.state.shaftRetreat.failure,/supported/);
});

test('quiet must be stable in this connection before excavation can be used again',()=>{
 const f=fixture();f.state.shaftRetreat.phase='returned';f.bot.entity.position.y=64;
 assert.equal(retreat.endQuietEncounter(f.bot,f.state,1000),false);
 assert.equal(retreat.endQuietEncounter(f.bot,f.state,9999),false);
 delete f.bot._shaftQuiet; // A reconnect has no continuous entity observations.
 assert.equal(retreat.endQuietEncounter(f.bot,f.state,20000),false);
 assert.equal(retreat.endQuietEncounter(f.bot,f.state,30001),true);
 assert.equal(f.state.shaftRetreat,undefined);assert.equal(f.state.shaftRetreatHistory.length,1);
});

test('a visible shooter outside thirty-two blocks does not reset the encounter budget',()=>{
 const f=fixture();f.state.shaftRetreat.phase='returned';f.bot.entity.position.y=64;
 f.bot.world={raycast:()=>null};f.bot.entities={1:{id:1,name:'blaze',position:new Vec3(45.5,64,.5),velocity:new Vec3(0,0,0),height:1.8}};
 assert.equal(retreat.endQuietEncounter(f.bot,f.state,1000),false);
 assert.equal(retreat.endQuietEncounter(f.bot,f.state,11001),false);
 assert.ok(f.state.shaftRetreat);
});

test('respawn away from the shaft preserves its record without holding all survival actions',()=>{
 const f=fixture();f.state.shaftRetreat.phase='returning';f.bot.entity.position=new Vec3(100.5,64,100.5);
 assert.equal(retreat.resume(f.bot,f.state),true);assert.equal(f.state.shaftRetreat.phase,'displaced');
 assert.equal(f.state.shaftRetreat.entry.y,64);
});

test('a one-cell knockback releases return priority while preserving the original obligation',()=>{
 const f=fixture();f.state.shaftRetreat.phase='returning';f.bot.entity.position.x=1.5;
 assert.equal(retreat.resume(f.bot,f.state),true);assert.equal(f.state.shaftRetreat.phase,'displaced');
 assert.equal(f.state.shaftRetreat.entry.y,64);
});

test('real pillar can opt out of opportunistic excavation while ordinary callers retain it',async()=>{
 const motion=require('../src/motion'),mining=require('../src/opportunistic-mining');
 const oldMove=motion.move,oldMine=mining.mineWithinReach;
 try{
  for(const allowed of [false,true]){
   const f=fixture();let opportunities=0;
   f.bot.entity.position.y=64;f.bot.entity.velocity=new Vec3(0,0,0);f.bot.entity.yaw=0;
   f.bot.equip=async item=>{f.bot.heldItem=item;};f.bot.look=async()=>{};
   f.bot.placeBlock=async ref=>{f.put(ref.position.offset(0,1,0),'dirt');f.bot.entity.position.y=65;};
   motion.move=async()=>{f.bot.entity.position.y=65.2;};mining.mineWithinReach=async()=>opportunities++;
   await require('../src/pillar-recovery').pillarUp(f.bot,f.task,65,{threats:false,opportunisticMining:allowed,allowDetours:false});
   assert.equal(opportunities,allowed?1:0);
  }
 }finally{motion.move=oldMove;mining.mineWithinReach=oldMine;}
});

test('return guard stops a lateral knockback before any further placement',async()=>{
 const f=fixture();let mutations=0;
 f.survival.actions.pillar=async(_b,task)=>{f.bot.entity.position.x=1.5;task.check();mutations++;};
 await assert.rejects(f.survival.leave(f.task,f.goal,()=>{},f.refuge),{name:'Blocked'});
 assert.equal(mutations,0);assert.equal(f.state.shaftRetreat.phase,'displaced');
});

test('a changed cap or newly waterlogged neighbor during aim prevents the actual dig packet',async()=>{
 for(const change of ['cap','waterlogged']){
  const f=fixture();let writes=0;f.bot._client.write=()=>writes++;
  f.survival.actions.dig=async(bot,_task,p)=>{
   if(change==='cap')f.put(p,'chest');
   else{const read=bot.blockAt;bot.blockAt=c=>c.x===1&&c.y===42&&c.z===0?{...read(c),name:'oak_stairs',getProperties:()=>({waterlogged:true})}:read(c);}
   bot._client.write('block_dig',{status:0,location:p});
  };
  await assert.rejects(f.survival.leave(f.task,f.goal,()=>{},f.refuge));
  assert.equal(writes,0);assert.equal(f.bot.entity.position.y,40);assert.equal(f.state.shaftRetreat.phase,'returning');
 }
});

test('213212 owned dirt becoming grass permits exact observed removal without rewriting the original receipt',async()=>{
 const f=fixture(),p=new Vec3(0,63,0),original=JSON.parse(JSON.stringify(f.state.shaftRetreat.caps));
 f.put(p,'grass_block');f.state.shaftRetreat.failure='old grass blocker';f.state.shaftRetreat.retryAfter=0;assert.equal(retreat.preflight(f.bot,f.state).ok,true);
 const reports=[];f.survival.report=(goal,save,action)=>{if(action.action==='return_from_shaft'){assert.equal(f.state.shaftRetreat.failure,undefined);assert.equal(f.state.shaftRetreat.retryAfter,undefined);}reports.push(action);goal.survivalAction=action;save();};
 for(let n=0;n<8&&f.bot.entity.position.y<64;n++)await f.survival.leave(f.task,f.goal,()=>{},f.refuge);
 assert.equal(f.bot.entity.position.y,64);assert.ok(f.dug.some(c=>c.y===63));
 assert.deepEqual(f.state.shaftRetreat.caps,original);
 assert.ok(reports.some(r=>r.action==='shaft_cap_evolution'&&r.inferred===true&&r.original.name==='dirt'&&r.observed.name==='grass_block'));
});

test('natural-growth compatibility is limited to recorded dirt and grass, with an exact dispatch fence',async()=>{
 for(const material of ['mycelium','podzol','coarse_dirt','rooted_dirt','dirt_path','farmland','stone']){
  const f=fixture();f.put(new Vec3(0,63,0),material);assert.equal(retreat.preflight(f.bot,f.state).ok,false);
 }
 for(const phase of [0,2]){
  const f=fixture(),p=new Vec3(0,42,0);f.put(p,'grass_block');let writes=0;f.bot._client.write=()=>writes++;
  f.survival.actions.dig=async(bot,_task,cell)=>{
   if(phase===2)bot._client.write('block_dig',{status:0,location:cell});
   f.put(cell,'dirt');bot._client.write('block_dig',{status:phase,location:cell});
  };
  await assert.rejects(f.survival.leave(f.task,f.goal,()=>{},f.refuge));
  assert.equal(writes,phase===2?1:0);assert.equal(f.bot.entity.position.y,40);
 }
 const f=fixture();f.put(new Vec3(0,57,0),'grass_block');assert.equal(retreat.preflight(f.bot,f.state).ok,false,'a cobblestone receipt cannot acquire grass compatibility');
});

test('blocked return retains priority and waits through its cooldown without a false movement or completion report',async t=>{
 const f=fixture();f.state.shaftRetreat.phase='returning';f.put(new Vec3(0,45,0),'chest');
 let now=Date.now(),waited=0,checks=0,saves=0;const reports=[];
 t.mock.method(Date,'now',()=>now);
 f.task.check=()=>checks++;f.survival.report=(goal,save,action)=>{reports.push(action);goal.survivalAction=action;save();};
 const realWait=retreat.waitStep;
 t.mock.method(retreat,'waitStep',(...args)=>realWait(...args.slice(0,5),{...args[5],now:()=>now,sleep:async ms=>{assert.equal(require('../src/stillness').excused(f.bot,'wait_for_shaft_return',now),true);waited+=ms;now+=ms;}}));
 assert.equal(await f.survival.stepShaftReturn(f.task,f.goal,()=>saves++),true,'the reported action is an actual bounded wait');
 assert.ok(waited>=4900);assert.ok(checks>=45);assert.equal(f.bot.entity.position.y,40);assert.deepEqual(f.dug,[]);
 assert.equal(f.state.shaftRetreat.phase,'returning');assert.equal(f.state.shaftRetreat.excavationUsed,true);
 assert.ok(reports.some(r=>r.action==='wait_for_shaft_return'&&r.pending===true&&r.reason.includes('chest')));
 assert.ok(!reports.some(r=>r.action==='returned_from_shaft'));
 assert.equal(require('../src/survival').claim(f.bot,f.goal,f.survival).action,'wait_for_shaft_return');
 assert.equal(require('../src/stillness').excused(f.bot,'wait_for_shaft_return',now),false);
 for(let i=0;i<3;i++){
  assert.equal(await f.survival.stepShaftReturn(f.task,f.goal,()=>saves++),true);
  assert.equal(require('../src/survival').claim(f.bot,f.goal,f.survival).action,'wait_for_shaft_return','unchanged obstruction keeps the same claim across retry expiry');
 }
 assert.ok(waited>=20000);assert.equal(f.bot.entity.position.y,40);assert.deepEqual(f.dug,[]);
 assert.ok(saves>0);
});

test('cooldown waiting responds to cancellation and immediate danger',async()=>{
 for(const interruption of ['Cancelled','NeedsSafety']){
  const f=fixture();f.state.shaftRetreat.phase='returning';let now=Date.now();f.state.shaftRetreat.retryAfter=now+5000;
  let sleeps=0;f.task.check=()=>{if(sleeps&&interruption==='Cancelled')throw Object.assign(new Error('cancelled'),{name:'Cancelled'});};
  await assert.rejects(retreat.waitStep(f.bot,f.task,f.state,f.goal,()=>{},{now:()=>now,sleep:async ms=>{now+=ms;sleeps++;if(interruption==='NeedsSafety')f.bot._recentHurtAt=Date.now();}}),{name:interruption});
  assert.equal(sleeps,1);assert.equal(f.state.shaftRetreat.phase,'returning');assert.deepEqual(f.dug,[]);
 }
});

test('return interruption records the specific threat that stopped it',async()=>{
 for(const kind of ['recent_damage','incoming_projectile','warden_sonic_range','visible_shooter']){
  const f=fixture();f.bot.world={raycast:()=>null};
  if(kind==='recent_damage')f.bot._recentHurtAt=Date.now();
  else if(kind==='incoming_projectile')f.bot.entities={7:{id:7,name:'arrow',position:new Vec3(.5,41.5,1.5),velocity:new Vec3(0,0,-.2)}};
  else f.bot.entities={7:{id:7,name:kind==='warden_sonic_range'?'warden':'skeleton',position:new Vec3(10.5,40,.5),height:1.8}};
  await assert.rejects(f.survival.leave(f.task,f.goal,()=>{},f.refuge),{name:'NeedsSafety'});
  assert.equal(f.state.shaftRetreat.lastInterrupt.reason.kind,kind);
  assert.equal(f.goal.survivalAction.action,'shaft_return_interrupted');
  if(kind!=='recent_damage')assert.equal(f.state.shaftRetreat.lastInterrupt.reason.entityId,7);
 }
});
