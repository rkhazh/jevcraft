'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {randomUUID}=require('node:crypto');
const Module=require('node:module');
test('real session routes typed goal, rejects chat bypass, cancels without pausing survival',async()=>{
 const bot=new EventEmitter();bot._client=new EventEmitter();Object.assign(bot,{
  loadPlugin(){},username:'Skipper',version:'26.1',health:20,food:20,isAlive:true,
  game:{dimension:'overworld',gameMode:'creative'},time:{timeOfDay:1000},players:{Alex:{uuid:'00000000-0000-4000-8000-000000000001',username:'Alex',entity:{position:{x:0,y:64,z:0}}}},entities:{},
  entity:{position:{x:0,y:64,z:0}},inventory:{items:()=>[]},pathfinder:{setGoal(){}},clearControlStates(){},stopDigging(){},deactivateItem(){},
  chat(){},quit(){bot.emit('end','quit')},waitForChunksToLoad:async()=>{},
 });
 const spoken=[];bot.chat=text=>spoken.push(text);
 let starts=0,idles=0,survival,runMode='normal';
 const original=Module._load;
 Module._load=function(name,parent,isMain){
  if(name==='mineflayer')return {createBot:()=>bot};
  if(name==='./movement'&&parent.filename.endsWith('/session.js'))return {configureMovements(){}};
  if(name==='./lava-escape')return {settleAfterJoin:async()=>{}};
  if(name==='./slow-calls')return {install(){}};
  if(name==='./work'&&parent.filename.endsWith('/session.js'))return {
   createSurvival:()=>survival={state:{}},
   runGoal:async(b,task,goal)=>{starts++;if(runMode==='danger')throw Object.assign(new Error('Threat nearby'),{name:'NeedsSafety'});while(!task.cancelled)await new Promise(r=>setTimeout(r,5));},
   runIdle:async(b,task)=>{idles++;while(!task.cancelled)await new Promise(r=>setTimeout(r,5));},
  };
  return original.call(this,name,parent,isMain);
 };
 const oldEnv={...process.env};Object.assign(process.env,{JEV_PERSONA_MODE:'1',JEV_NO_QUIET_RESTART:'1',JEV_PERSONA_ITEMS:'oak_log',JEV_PERSONA_PLAYERS:'Alex'});
 bot.registry={itemsByName:{oak_log:{id:1}}};
 const dir=mkdtempSync(join(tmpdir(),'jev-session-'));let session;
 try{
  const {createSession}=require('../src/session');session=createSession({host:'localhost',port:25565,username:'Skipper'},{},{stateDirectory:dir,runLedger:null});
  assert.deepEqual(session.persona.snapshot().player_identities,[]);
  bot.emit('spawn');await new Promise(r=>setTimeout(r,30));
  assert.equal(session.persona.snapshot().connected,true);assert.deepEqual(session.persona.snapshot().nearby_entities,[]);assert.equal(session.persona.snapshot().ground_block,null);assert.ok(spoken.some(t=>t.includes('ready to chat')));assert.ok(!spoken.some(t=>t.includes('Call me Jev')));
  bot._client.emit('playerChat',{sender:'00000000-0000-4000-8000-000000000001',plainMessage:'Skipper get me 8 oak logs'});
  await new Promise(r=>setTimeout(r,10));assert.equal(starts,0);assert.equal(session.persona.events(0).events.at(-1).type,'chat');
  const rosterSnapshot=session.persona.snapshot();assert.deepEqual(rosterSnapshot.player_identities,[{uuid:'00000000-0000-4000-8000-000000000001',name:'Alex'}]);assert.ok(Number.isFinite(rosterSnapshot.observed_at));assert.notEqual(rosterSnapshot.observation_id,session.persona.snapshot().observation_id);
  const s=session.persona.snapshot(),p={schema_version:1,goal_id:randomUUID(),persona_id:'skipper',session_id:s.session_id,observation_id:s.observation_id,issued_at:Date.now()/1000,expires_at:Date.now()/1000+60,state:'proposed',spec:{kind:'obtain',item:'oak_log',count:8,deliver:false}};
  assert.equal((await session.persona.submit(p)).status,'accepted');await new Promise(r=>setImmediate(r));assert.equal(starts,1);
  await session.persona.cancel(p.goal_id);assert.equal(survival.state.paused,false);
  await new Promise(r=>setTimeout(r,550));assert.ok(idles>0,'survival idle loop resumes after scoped cancel');
  runMode='danger';const next={...p,goal_id:randomUUID(),observation_id:session.persona.snapshot().observation_id};
  assert.equal((await session.persona.submit(next)).status,'accepted');await new Promise(r=>setTimeout(r,20));
  const before=starts;await session.persona.cancel(next.goal_id);await new Promise(r=>setTimeout(r,1600));
  assert.equal(starts,before,'cancelled goal cannot relaunch after a tactical danger retry');
  session.shutdown();await session.closed;assert.deepEqual(session.persona.snapshot().player_identities,[]);
 }finally{session?.shutdown();await session?.closed;Module._load=original;process.env=oldEnv;rmSync(dir,{recursive:true,force:true});}
});
