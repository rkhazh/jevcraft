'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{Vec3}=require('vec3');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto'),Module=require('node:module');
const {installStructureMutationGuard}=require('../src/structure-mutations');
const {Survival}=require('../src/survival');
const waitFor=async check=>{for(let i=0;i<300;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('local session condition timed out');};

test('real session craft → move → idle survival records the actual controller without a stale craft id',async()=>{
 const bot=new EventEmitter(),blocks=new Map(),audit=[],packets=[],tactics=[],items=[{name:'chest',type:1,count:1}];
 bot._client=new EventEmitter();bot._client.write=(...args)=>packets.push(args);
 Object.assign(bot,{loadPlugin(){},username:'Skipper',version:'26.1',health:20,food:20,isAlive:true,registry:{itemsByName:{chest:{id:1}}},
  game:{dimension:'overworld',gameMode:'survival'},time:{timeOfDay:1000},players:{},entities:{},entity:{position:new Vec3(0,64,0)},inventory:{items:()=>items},
  pathfinder:{setGoal(){}},clearControlStates(){},stopDigging(){},deactivateItem(){},chat(){},quit(){bot.emit('end','quit')},waitForChunksToLoad:async()=>{}});
 for(const x of [10,11,12])blocks.set(new Vec3(x,64,0).toString(),'stone');
 bot.blockAt=p=>{const name=blocks.get(p.toString())||(p.y<64?'stone':'air');return {position:p,name,stateId:name==='air'?0:1,shapes:name==='air'?[]:[[0,0,0,1,1,1]],boundingBox:name==='air'?'empty':'block'};};
 bot.dig=async block=>{await Promise.resolve();bot._client.write('block_dig',{status:0,location:block.position});blocks.set(block.position.toString(),'air');bot._client.emit('block_change',{location:block.position,type:0});};
 let idleDig=false,idleDone=false,preempt=false,lastWorkGoal;
 const survival={state:{},bot,step:Survival.prototype.step,report:Survival.prototype.report,stepScoped:async function(_task,goal,save){
  await this.client.systemOne({state:{phase:'survival'},questions:{}});
  this.report(goal,save,{action:'native_probe',target:{x:preempt?12:11,y:64,z:0}});
  goal.survivalAction={action:'native_direct',target:{x:preempt?12:11,y:64,z:0}};
  await bot.dig(bot.blockAt(new Vec3(preempt?12:11,64,0)));return true;
 }};
 const original=Module._load;
 Module._load=function(name,parent,isMain){
  if(name==='mineflayer')return {createBot:()=>bot};
  if(name==='./movement'&&parent.filename.endsWith('/session.js'))return {configureMovements(){}};
  if(name==='./lava-escape')return {settleAfterJoin:async()=>{}};
  if(name==='./slow-calls')return {install(){}};
  if(name==='./work'&&parent.filename.endsWith('/session.js'))return {
   createSurvival:(_bot,options)=>Object.assign(survival,{client:options.client}),
   runGoal:async(_bot,task,goal,_store,options)=>{
    await options.decisionClient.systemOne({state:{phase:'work'},questions:{}});
    lastWorkGoal=goal;
    if(goal.kind==='move')bot.entity.position=new Vec3(goal.target.x,goal.target.y,goal.target.z);
    else {bot._goal=goal;await bot.dig(bot.blockAt(new Vec3(10,64,0)));}
    if(preempt)await survival.step(task,goal,()=>{});
    goal.status='complete';return {ok:true,goal};
   },
   runIdle:async(_bot,task,goal,_store,options)=>{while(!task.cancelled){if(idleDig&&!idleDone){idleDone=true;await options.decisionClient.systemOne({state:{phase:'idle'},questions:{}});await survival.step(task,goal,()=>{});}await new Promise(r=>setTimeout(r,5));}},
  };
  return original.call(this,name,parent,isMain);
 };
 const oldEnv={...process.env};Object.assign(process.env,{JEV_PERSONA_MODE:'1',JEV_NO_QUIET_RESTART:'1',JEV_PERSONA_ITEMS:'chest',JEV_PERSONA_LOCAL_MOVE:'1'});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jev-attribution-'));let session;
 try{
  session=require('../src/session').createSession({host:'localhost',port:25565,username:'Skipper'},{systemOne:async args=>tactics.push(args)},{stateDirectory:dir,runLedger:null,personaLocalMove:true});
  installStructureMutationGuard(bot,{record:e=>audit.push(e)});bot.emit('spawn');await waitFor(()=>session.persona.snapshot().connected);
  const identity='Configured character.\n'+ 'Background. '.repeat(20)+'Respect shared property.';
  assert.equal(session.persona.setProfile({persona_id:'skipper',identity,motivations:['Build a home'],social_style:'brief'},session.persona.sessionId).status,'ready');
  const submit=async spec=>{const s=session.persona.snapshot(),goal_id=randomUUID();const ack=await session.persona.submit({schema_version:1,goal_id,persona_id:'skipper',session_id:s.session_id,observation_id:s.observation_id,issued_at:Date.now()/1000,expires_at:Date.now()/1000+60,state:'proposed',spec});assert.equal(ack.status,'accepted',JSON.stringify(ack));await waitFor(()=>session.persona.snapshot().last_result?.goal_id===goal_id);return goal_id;};
  const chest=await submit({kind:'craft',item:'chest',count:1,deliver:false});
  assert.equal(audit.at(-1).controller,'work');assert.equal(audit.at(-1).goal_id,chest);
  const move=await submit({kind:'move',target:{x:2,y:64,z:0}});assert.equal(lastWorkGoal.personaGoalId,move);assert.equal(bot._goal.personaGoalId,chest);
  idleDig=true;await waitFor(()=>audit.some(e=>e.position.x===11));
  const idle=audit.find(e=>e.position.x===11);assert.equal(idle.controller,'survival');assert.equal(idle.goal_id,null);assert.equal(idle.interrupted_goal_id,null);
  preempt=true;const next=await submit({kind:'craft',item:'chest',count:1,deliver:false});
  const interrupted=audit.find(e=>e.position.x===12);assert.equal(interrupted.controller,'survival');assert.equal(interrupted.goal_id,null);assert.equal(interrupted.interrupted_goal_id,next);
  const reports=session.persona.snapshot().body_reports.filter(r=>r.report.action==='native_probe');
  assert.equal(reports.length,2);assert.equal(reports[0].goal_id,null);assert.equal(reports[0].interrupted_goal_id,null);
  assert.equal(reports[1].controller,'survival');assert.equal(reports[1].goal_id,null);assert.equal(reports[1].interrupted_goal_id,next);
  assert.equal(reports[1].source_session_id,session.persona.snapshot().session_id);
  const direct=session.persona.snapshot().body_reports.filter(r=>r.report.action==='native_direct');
  assert.equal(direct.length,2);assert.equal(direct[0].goal_id,null);assert.equal(direct[0].interrupted_goal_id,null);
  assert.equal(direct[1].controller,'survival');assert.equal(direct[1].interrupted_goal_id,next);
  assert.equal(packets.length,4);assert.equal(session.persona.snapshot().last_result.verified,true);
  for(const phase of ['work','idle','survival']){
   const wire=tactics.find(t=>t.state.phase===phase);assert.ok(wire,phase);assert.equal(wire.state.actor_profile.identity,identity);
  }
  assert.equal(tactics.find(t=>t.state.phase==='idle').state.persona_context,undefined);
  let release;
  const late=require('../src/action-scope').withActionScope(bot,'survival',null,()=>new Promise(resolve=>{release=resolve;}));
  session.shutdown();await session.closed;
  const closedReports=session.persona.snapshot().body_reports;
  bot.health=5;lastWorkGoal.survivalAction={action:'late_report'};release();await late;
  assert.deepEqual(session.persona.snapshot().body_reports,closedReports);
 }finally{session?.shutdown();await session?.closed;Module._load=original;process.env=oldEnv;fs.rmSync(dir,{recursive:true,force:true});}
});
