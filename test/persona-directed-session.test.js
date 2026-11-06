'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const {mkdtempSync,rmSync,writeFileSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
const Module=require('node:module');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate){const deadline=Date.now()+2000;while(!predicate()&&Date.now()<deadline)await delay(10);assert.ok(predicate(),'expected session transition');}

test('directed native sessions hold idle, keep structured work and resume without reinterpretation',async()=>{
 const bot=new EventEmitter();bot._client=new EventEmitter();
 const starts=[],idles=[];let interpretations=0,dreams=0,session;
 Object.assign(bot,{loadPlugin(){},username:'Tolik',version:'26.1',health:20,food:20,isAlive:true,
  game:{dimension:'the_nether',gameMode:'creative'},time:{timeOfDay:1000},entities:{},
  players:{Alex:{uuid:'00000000-0000-4000-8000-000000000001',username:'Alex',entity:{position:{x:4,y:64,z:0}}}},
  entity:{position:{x:0,y:64,z:0}},inventory:{items:()=>[]},registry:{itemsByName:{diamond:{id:1}}},
  pathfinder:{setGoal(){}},clearControlStates(){},stopDigging(){},deactivateItem(){},chat(){},
  quit(){bot.emit('end','quit');},waitForChunksToLoad:async()=>{},swingArm(){}});
 const original=Module._load,env={...process.env},dir=mkdtempSync(join(tmpdir(),'tolik-directed-'));
 writeFileSync(join(dir,'localhost-25565-Tolik-directed-dream.json'),JSON.stringify({version:1,dream:'beat_the_game',setBy:'Alex',setAt:new Date().toISOString()}));
 writeFileSync(join(dir,'localhost-25565-Tolik.json'),JSON.stringify({version:1,kind:'obtain',request:'Old request',from:'Alex',status:'blocked',item:'diamond',count:1}));
 Module._load=function(name,parent,isMain){
  if(name==='mineflayer')return {createBot:()=>bot};
  if(name==='./movement'&&parent.filename.endsWith('/session.js'))return {configureMovements(){}};
  if(name==='./lava-escape')return {settleAfterJoin:async()=>{}};
  if(name==='./slow-calls')return {install(){}};
  if(name==='./objectives'&&parent.filename.endsWith('/session.js'))return {...original.call(this,name,parent,isMain),interpret:async()=>{interpretations++;throw Error('Directed controls must not call an interpreter');}};
  if(name==='./dream'&&parent.filename.endsWith('/session.js'))return {...original.call(this,name,parent,isMain),nextDreamRequest:async()=>{dreams++;return {done:true};}};
  if(name==='./work'&&parent.filename.endsWith('/session.js'))return {
   createSurvival:()=>({state:{}}),runIdle:async(_bot,task,goal)=>{idles.push(goal);while(!task.cancelled)await delay(5);},
   runGoal:async(_bot,task,goal)=>{starts.push(goal);while(!task.cancelled)await delay(5);},
  };
  return original.call(this,name,parent,isMain);
 };
 try{
  Object.assign(process.env,{JEV_PERSONA_MODE:'1',JEV_NO_QUIET_RESTART:'1',MC_WORLD_ID:'directed'});
  session=require('../src/session').createSession({host:'localhost',port:25565,username:'Tolik'}, {},
   {stateDirectory:dir,runLedger:null,personaNative:true,personaAutonomous:false,personaVisiblePlayers:true});
  bot.emit('spawn');await waitFor(()=>session.persona.snapshot().connected);await waitFor(()=>idles.length>0);
  const api=session.persona;
  const propose=spec=>{const state=api.snapshot();return {schema_version:1,goal_id:randomUUID(),persona_id:'tolik',session_id:state.session_id,
   observation_id:state.observation_id,issued_at:state.observed_at,expires_at:null,state:'proposed',spec};};
  assert.equal(idles[0].personaHold,true);assert.equal(idles[0].retainedRequest,undefined);assert.equal(idles[0].dream,undefined);assert.equal(dreams,0);
  assert.deepEqual(api.snapshot().control_policy,{mode:'directed',autonomous_idle:false,dreams:false});
  assert.equal(api.snapshot().native_capabilities.enabled,true);assert.equal(api.snapshot().native_capabilities.request,false);
  assert.deepEqual(api.snapshot().native_capabilities.text_controls,['stop','status','resume']);
  for(const request of ['Follow Alex','stop and explore','resume; collect diamonds','dream']){
   const response=await api.submit(propose({kind:'native',request,requester:'Alex'}));
   assert.equal(response.reason,'use_structured_goal');assert.equal(starts.length,0);
  }
  let p=propose({kind:'follow',target:'Alex'});assert.equal((await api.submit(p)).status,'accepted');await waitFor(()=>starts.length===1);
  assert.equal(starts[0].kind,'follow');assert.equal(starts[0].nativeCapabilities,true);assert.equal(starts[0].personaHold,true);
  assert.equal((await api.submit(propose({kind:'native',request:'Explore instead',requester:'Alex'}))).reason,'use_structured_goal');
  assert.equal(api.snapshot().active_goal_id,p.goal_id,'rejected freeform cannot cancel admitted structured work');
  await api.cancel(p.goal_id);
  p=propose({kind:'native',request:' \t ReSuMe \n ',requester:'Alex'});assert.equal((await api.submit(p)).status,'accepted');await waitFor(()=>starts.length===2);
  assert.equal(starts[1].kind,'follow');assert.equal(starts[1].personaHold,true);assert.equal(starts[1].personaGoalId,p.goal_id);
  await api.cancel(p.goal_id);
  for(const request of [' STOP ',' StAtUs ']){
   p=propose({kind:'native',request,requester:'Alex'});assert.equal((await api.submit(p)).status,'accepted');await waitFor(()=>api.snapshot().active_goal_id===null);
   assert.equal(api.snapshot().last_result.status,'complete_unverified');
  }
  assert.equal(interpretations,0);assert.equal(starts.length,2);assert.equal(dreams,0);
 }finally{
  session?.shutdown();await session?.closed;Module._load=original;process.env=env;
  for(const store of require('../src/objectives').GoalStore.stores||[])if(store.file.startsWith(dir)){store.flushSync();require('../src/objectives').GoalStore.stores.delete(store);}
  rmSync(dir,{recursive:true,force:true});
 }
});
