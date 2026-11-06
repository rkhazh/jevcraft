'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
const Module=require('node:module');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('native intake shares Jev work, preserves recipients, handles feedback and fences cancellation',async()=>{
 const bot=new EventEmitter();bot._client=new EventEmitter();
 const starts=[],plugins=[];let mode='obtain',release,interpretations=0;
 Object.assign(bot,{loadPlugin(plugin){plugins.push(String(plugin));},username:'Tolik',version:'26.1',health:5,food:20,isAlive:true,
  game:{dimension:'the_nether',gameMode:'survival'},time:{timeOfDay:1000},entities:{},
  players:{Alex:{uuid:'00000000-0000-4000-8000-000000000001',username:'Alex',entity:{position:{x:0,y:64,z:0}}}},
  entity:{position:{x:0,y:64,z:0}},inventory:{items:()=>[]},registry:require('minecraft-data')('1.21.11'),
  pathfinder:{setGoal(){}},clearControlStates(){},stopDigging(){},deactivateItem(){},chat(){},
  quit(){bot.emit('end','quit');},waitForChunksToLoad:async()=>{},swingArm(){}});
 const original=Module._load,env={...process.env},dir=mkdtempSync(join(tmpdir(),'tolik-native-'));let session;
 Module._load=function(name,parent,isMain){
  if(name==='mineflayer')return {createBot:()=>bot};
  if(name==='./movement'&&parent.filename.endsWith('/session.js'))return {configureMovements(){}};
  if(name==='./lava-escape')return {settleAfterJoin:async()=>{}};
  if(name==='./slow-calls')return {install(){}};
  if(name==='./objectives'&&parent.filename.endsWith('/session.js'))return {...original.call(this,name,parent,isMain),interpret:async(_client,request,from)=>{
   interpretations++;if(mode==='delayed')await new Promise(r=>release=r);
   if(mode==='error')throw new Error('Interpretation service unavailable');
   return mode==='clarify'?{kind:'clarify',message:'Which fortress?',clarification:{}}:
    mode==='other'?{kind:'other',message:'No supported task in that request'}:
    mode==='unworkable'?{kind:'obtain',request,from,item:'bedrock',count:1,deliver:false}:
    mode==='operator_command'?{kind:'operator_command'}:{kind:'obtain',request,from,item:'diamond',count:128,deliver:true};
  }};
  if(name==='./work'&&parent.filename.endsWith('/session.js'))return {
   createSurvival:()=>({state:{}}),runIdle:async(b,t)=>{while(!t.cancelled)await delay(5);},
   runGoal:async(b,t,g)=>{starts.push(g);while(!t.cancelled)await delay(5);},
  };
  return original.call(this,name,parent,isMain);
 };
 try{
  Object.assign(process.env,{JEV_PERSONA_MODE:'1',JEV_NO_QUIET_RESTART:'1'});
  const {createSession}=require('../src/session');
  session=createSession({host:'localhost',port:25565,username:'Tolik'}, {}, {stateDirectory:dir,runLedger:null,personaNative:true});
  bot.emit('spawn');await delay(30);
  const api=session.persona;
  const propose=request=>{const s=api.snapshot();return {schema_version:1,goal_id:randomUUID(),persona_id:'tolik',session_id:s.session_id,observation_id:s.observation_id,issued_at:s.observed_at,expires_at:null,state:'proposed',spec:{kind:'native',request,requester:'Alex'}};};
  assert.equal(api.snapshot().native_capabilities.enabled,true);
  assert.ok(!plugins.some(s=>s.includes('installStructureMutationGuard')));
  let p=propose('Get me 128 diamonds');assert.equal((await api.submit(p)).status,'accepted');await delay(30);
  assert.equal(starts.length,1);assert.equal(starts[0].kind,'obtain');assert.equal(starts[0].count,128);assert.equal(starts[0].deliver,true);assert.equal(starts[0].from,'Alex');assert.equal(starts[0].personaGoalId,p.goal_id);
  await api.cancel(p.goal_id);
  mode='clarify';p=propose('Find it');await api.submit(p);await delay(30);
  assert.ok(api.events(0).events.some(e=>e.type==='native_feedback'&&e.message==='Which fortress?'));
  assert.equal(api.snapshot().active_goal_id,null);
  assert.equal(api.snapshot().last_result.status,'blocked');assert.equal(api.snapshot().last_result.reason,'Which fortress?');
  for(const [failure,reason] of [['other',/No supported task/],['unworkable',/No supported survival acquisition/],['error',/Interpretation service unavailable/]]){
   mode=failure;p=propose('Do the requested task');await api.submit(p);await delay(30);
   assert.equal(api.snapshot().last_result.status,'blocked',failure);assert.match(api.snapshot().last_result.reason,reason);
  }
  mode='delayed';p=propose('Find diamonds');assert.equal((await api.submit(p)).status,'accepted');await delay(20);
  await api.cancel(p.goal_id);release();await delay(30);assert.equal(starts.length,1,'late interpretation cannot revive cancelled work');
  mode='operator_command';p=propose('Run /op Alex');await api.submit(p);await delay(30);
  assert.ok(api.events(0).events.some(e=>e.type==='native_feedback'&&/fresh.*player/i.test(e.message)));
  assert.equal(starts.length,1);assert.equal(interpretations,6,'literal slash requests need no model interpretation');
 }finally{session?.shutdown();await session?.closed;Module._load=original;process.env=env;rmSync(dir,{recursive:true,force:true});}
});
