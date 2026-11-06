'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os'),{join}=require('node:path');
const Module=require('node:module');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate){
 const deadline=Date.now()+2000;
 while(!predicate()&&Date.now()<deadline)await delay(10);
 assert.ok(predicate(),'expected native lifecycle transition');
}

for(const operation of ['pause','clear'])test(`a late native dream decision cannot undo ${operation}`,async()=>{
 const bot=new EventEmitter();bot._client=new EventEmitter();
 const starts=[];let mode='set',release,reject,dreamStarted=false,session;
 Object.assign(bot,{loadPlugin(){},username:'Tolik',version:'26.1',health:20,food:20,isAlive:true,
  game:{dimension:'the_nether',gameMode:'creative'},time:{timeOfDay:1000},entities:{},
  players:{Alex:{uuid:'00000000-0000-4000-8000-000000000001',username:'Alex',entity:{position:{x:0,y:64,z:0}}}},
  entity:{position:{x:0,y:64,z:0}},inventory:{items:()=>[]},registry:{itemsByName:{diamond:{id:1}}},
  pathfinder:{setGoal(){}},clearControlStates(){},stopDigging(){},deactivateItem(){},chat(){},
  quit(){bot.emit('end','quit');},waitForChunksToLoad:async()=>{},swingArm(){}});
 const original=Module._load,env={...process.env},dir=mkdtempSync(join(tmpdir(),'tolik-dream-race-'));
 const sessionPath=require.resolve('../src/session');delete require.cache[sessionPath];
 Module._load=function(name,parent,isMain){
  if(name==='mineflayer')return {createBot:()=>bot};
  if(name==='./movement'&&parent.filename.endsWith('/session.js'))return {configureMovements(){}};
  if(name==='./lava-escape')return {settleAfterJoin:async()=>{}};
  if(name==='./slow-calls')return {install(){}};
  if(name==='./objectives'&&parent.filename.endsWith('/session.js'))return {
   ...original.call(this,name,parent,isMain),
   interpret:async()=>({kind:'dream',dream:{operation:mode,key:'beat_the_game'}}),
  };
  if(name==='./dream'&&parent.filename.endsWith('/session.js'))return {
   ...original.call(this,name,parent,isMain),
   nextDreamRequest:async()=>{
    dreamStarted=true;await new Promise((resolve,fail)=>{release=resolve;reject=fail;});
    return {kind:'obtain',dream:'beat_the_game',from:'Alex',request:'Old dream',item:'diamond',count:1,deliver:false};
   },
  };
  if(name==='./work'&&parent.filename.endsWith('/session.js'))return {
   createSurvival:()=>({state:{}}),runIdle:async(_bot,task)=>{while(!task.cancelled)await delay(5);},
   runGoal:async(_bot,task,goal)=>{starts.push(goal);while(!task.cancelled)await delay(5);},
  };
  return original.call(this,name,parent,isMain);
 };
 try{
  Object.assign(process.env,{JEV_PERSONA_MODE:'1',JEV_NO_QUIET_RESTART:'1'});
  session=require('../src/session').createSession({host:'localhost',port:25565,username:'Tolik'}, {},
   {stateDirectory:dir,runLedger:null,personaNative:true});
  bot.emit('spawn');await waitFor(()=>session.persona.snapshot().connected);
  const api=session.persona;
  const propose=request=>{const state=api.snapshot();return {schema_version:1,goal_id:randomUUID(),persona_id:'tolik',session_id:state.session_id,
   observation_id:state.observation_id,issued_at:state.observed_at,expires_at:null,state:'proposed',spec:{kind:'native',request,requester:'Alex'}};};
  await api.submit(propose('Set the dream'));await waitFor(()=>dreamStarted);
  mode=operation;await api.submit(propose(`${operation} the dream`));await waitFor(()=>api.snapshot().active_goal_id===null);
  if(operation==='pause')release();else reject(new Error('Old dream decision failed'));
  await delay(40);
  assert.equal(starts.length,0,'cancelled dream inference must not launch physical work');
  const dreamStore=[...require('../src/objectives').GoalStore.stores].find(store=>store.file.startsWith(dir)&&store.file.endsWith('-dream.json'));
  const saved=dreamStore.read();
  if(operation==='pause')assert.equal(saved.paused,true);
  else assert.equal(saved.dream,null,'late failure must not restore the cleared dream');
 }finally{
  release?.();session?.shutdown();await session?.closed;
  for(const store of require('../src/objectives').GoalStore.stores)if(store.file.startsWith(dir)){
   store.flushSync();require('../src/objectives').GoalStore.stores.delete(store);
  }
  Module._load=original;process.env=env;delete require.cache[sessionPath];rmSync(dir,{recursive:true,force:true});
 }
});
